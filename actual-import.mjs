import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';

export function cents(value) {
  const match = /^(-?)(\d+)(?:[,.](\d{1,2}))?$/.exec(value?.trim());
  if (!match) throw new Error(`Invalid amount: ${value}`);
  const result = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('Amount exceeds supported range');
  return match[1] ? -result : result;
}

export function date(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || '');
  if (!match) throw new Error(`Invalid date: ${value}`);
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso)
    throw new Error(`Invalid date: ${value}`);
  return iso;
}

export function transactions(text, filename) {
  const records = parse(text, { delimiter: ';', columns: h => h.map(c => c.toLowerCase().replaceAll(' ', '_')), bom: true, skip_empty_lines: true });
  if (!records.length) throw new Error(`${filename}: empty CSV`);
  const processed = ['fecha_fiscal', 'variable', 'value'].every(k => k in records[0]);
  const raw = ['fecha_fiscal', 'inversión', 'resultado_fiscal'].every(k => k in records[0]);
  if (!processed && !raw) throw new Error(`${filename}: unsupported CSV columns`);
  const fund = /fondo\s+(.+)\.csv$/i.exec(basename(filename))?.[1];
  if (!processed && !fund) throw new Error(`${filename}: raw export filename must contain "fondo FUND_CODE.csv"`);
  return records.flatMap(row => {
    const entries = processed ? [[row.variable, row.value]] :
      ['inversión', 'resultado_fiscal'].map(k => [`${k} Fund : ${fund}`, row[k]]);
    return entries.map(([notes, value]) => {
      if (!notes?.trim()) throw new Error(`${filename}: missing transaction notes`);
      return { date: date(row.fecha_fiscal), notes, amount: cents(value), cleared: true };
    });
  });
}

export async function replace(api, account, incoming, { apply = false, backupDir = '.actual-backups' } = {}) {
  const existing = await api.getTransactions(account.id, '0001-01-01', '9999-12-31');
  // Deleting a transfer also affects its other account. Refuse that scope expansion.
  const hasTransfer = tx => tx.transfer_id || tx.subtransactions?.some(hasTransfer);
  if (existing.some(hasTransfer)) throw new Error('Account contains transfers; replacement would affect other accounts. Aborting.');
  const total = incoming.reduce((sum, tx) => sum + tx.amount, 0);
  if (!incoming.length || !Number.isSafeInteger(total)) throw new Error('Invalid replacement transactions');
  console.log(`${account.name} (${account.id}): replace ${existing.length} transactions with ${incoming.length}; new balance ${(total / 100).toFixed(2)}`);
  if (!apply) { console.log('Preview only. Add --apply to replace transactions.'); return; }
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const backup = join(backupDir, `budget-${Date.now()}-${process.pid}.zip`);
  await writeFile(backup, await api.exportBudget(), { flag: 'wx', mode: 0o600 });
  console.log(`Budget backup: ${resolve(backup)}`);
  try {
    await api.batchBudgetUpdates(async () => {
      for (const tx of existing) await api.deleteTransaction(tx.id);
      // Exact replacement: avoid import matching that could merge legitimate equal rows.
      await api.addTransactions(account.id, incoming);
    });
    await api.sync();
    const result = await api.getTransactions(account.id, '0001-01-01', '9999-12-31');
    if (result.length !== incoming.length || result.reduce((s, t) => s + t.amount, 0) !== total)
      throw new Error('Replacement verification failed');
    console.log('Replacement synced and verified.');
  } catch (error) {
    throw new Error(`Replacement failed and may be partial. Restore the backup ${resolve(backup)} before retrying. ${error.message}`);
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    apply: { type: 'boolean', default: false }, account: { type: 'string' },
    'backup-dir': { type: 'string', default: '.actual-backups' },
    help: { type: 'boolean' },
  }});
  if (values.help) {
    console.log('node --env-file=.env actual-import.mjs --account MyInvestor [--apply] [--backup-dir PATH] file1.csv file2.csv ...');
    return;
  }
  if (!positionals.length) throw new Error('Provide one or more complete raw or processed CSV exports');
  if (new Set(positionals.map(p => resolve(p))).size !== positionals.length) throw new Error('Same input file provided more than once');
  const incoming = (await Promise.all(positionals.map(async p => transactions(await readFile(p, 'utf8'), p))))
    .flat().sort((a, b) => a.date.localeCompare(b.date));
  for (const key of ['ACTUAL_SERVER_URL', 'ACTUAL_SYNC_ID'])
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  if (!process.env.ACTUAL_PASSWORD && !process.env.ACTUAL_API_KEY) throw new Error('Set ACTUAL_PASSWORD or ACTUAL_API_KEY');
  const target = values.account || process.env.ACTUAL_ACCOUNT;
  if (!target) throw new Error('Set --account to an account name or ID');
  const api = await import('@actual-app/api');
  const cache = await mkdtemp(join(tmpdir(), 'actual-import-'));
  try {
    await api.init({ dataDir: cache, serverURL: process.env.ACTUAL_SERVER_URL,
      ...(process.env.ACTUAL_API_KEY ? { sessionToken: process.env.ACTUAL_API_KEY } : { password: process.env.ACTUAL_PASSWORD }) });
    await api.downloadBudget(process.env.ACTUAL_SYNC_ID,
      process.env.ACTUAL_ENCRYPTION_PASSWORD ? { password: process.env.ACTUAL_ENCRYPTION_PASSWORD } : undefined);
    await api.sync();
    const accounts = await api.getAccounts();
    const matches = accounts.filter(a => a.id === target || a.name === target);
    if (matches.length !== 1 || matches[0].closed) throw new Error('Account must uniquely match an open account name or ID');
    await replace(api, matches[0], incoming, { apply: values.apply, backupDir: values['backup-dir'] });
  } finally {
    try { await api.shutdown(); } finally { await rm(cache, { recursive: true, force: true }); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
