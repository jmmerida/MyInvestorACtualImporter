import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cents, date, transactions, replace } from '../actual-import.mjs';

test('raw and processed sample exports produce the same 20 transactions and balance', async () => {
  const read = async suffix => (await Promise.all(['IE00BYX5NX33', 'LU1598719752'].map(async fund => {
    const filename = `Plusvalías y minusvalías fondo ${fund}${suffix}.csv`;
    return transactions(await readFile(filename, 'utf8'), filename);
  }))).flat();
  const raw = await read('');
  const processed = await read('_processed');
  const sorted = rows => rows.map(t => JSON.stringify(t)).sort();
  assert.deepEqual(sorted(raw), sorted(processed));
  assert.equal(raw.length, 20);
  assert.equal(raw.reduce((s, t) => s + t.amount, 0), 513602);
  assert.equal(raw.filter(t => t.amount < 0).length, 2);
});

test('reject invalid amounts, dates, and empty files before connecting', () => {
  for (const value of ['NaN', '1,234', '', '1.234,56']) assert.throws(() => cents(value));
  assert.equal(cents('-4,83'), -483);
  for (const value of ['31/02/2026', '2026-01-01', '01/13/2026']) assert.throws(() => date(value));
  assert.throws(() => transactions('fecha_fiscal;variable;value\n', 'empty.csv'));
});

function fake() {
  const calls = [];
  let rows = [{ id: 'old', amount: 100 }];
  return { calls, async getTransactions() { return rows; },
    async exportBudget() { calls.push('backup'); return new Uint8Array([1, 2]); },
    async batchBudgetUpdates(fn) { calls.push('batch'); await fn(); },
    async deleteTransaction(id) { calls.push(`delete:${id}`); rows = []; },
    async addTransactions(id, incoming) { calls.push(`add:${id}`); rows = incoming; },
    async sync() { calls.push('sync'); },
  };
}
const account = { id: 'myinvestor', name: 'MyInvestor' };
const incoming = [{ date: '2026-01-01', notes: 'test', amount: 100, cleared: true }];

test('preview makes no writes', async () => {
  const api = fake();
  await replace(api, account, incoming);
  assert.deepEqual(api.calls, []);
});

test('replacement backs up first, deletes, adds, syncs and verifies', async () => {
  const api = fake();
  const dir = await mkdtemp(join(tmpdir(), 'actual-test-'));
  try {
    await replace(api, account, incoming, { apply: true, backupDir: dir });
    assert.deepEqual(api.calls, ['backup', 'batch', 'delete:old', 'add:myinvestor', 'sync']);
    assert.equal((await readdir(dir)).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('backup failure prevents deletion; transfer accounts are refused', async () => {
  const api = fake();
  api.exportBudget = async () => { throw new Error('backup failed'); };
  const dir = await mkdtemp(join(tmpdir(), 'actual-test-'));
  try {
    await assert.rejects(replace(api, account, incoming, { apply: true, backupDir: dir }), /backup failed/);
    assert.deepEqual(api.calls, []);
    api.getTransactions = async () => [{ id: 'transfer', transfer_id: 'other-account-tx' }];
    await assert.rejects(replace(api, account, incoming, { apply: true, backupDir: dir }), /transfers/);
    assert.deepEqual(api.calls, []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('partial failure reports the recovery backup', async () => {
  const api = fake();
  api.addTransactions = async () => { throw new Error('failed to add'); };
  const dir = await mkdtemp(join(tmpdir(), 'actual-test-'));
  try {
    await assert.rejects(replace(api, account, incoming, { apply: true, backupDir: dir }), /may be partial.*Restore the backup/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
