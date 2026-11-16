Replace an Actual Budget account through its API (Node.js 22+):

```sh
npm ci
cp .env.example .env
```

Fill in `.env` with your server URL, server password (or API key), budget Sync ID,
and target account. Find Sync ID in Actual's advanced settings. For encrypted
budgets, also set `ACTUAL_ENCRYPTION_PASSWORD`. Keep `.env` private; it is ignored
by Git. The devcontainer includes Node.js after rebuilding it.

Preview the replacement using several **complete** exports:

```sh
npm run actual:replace -- "Plusvalías y minusvalías fondo IE00BYX5NX33.csv" "Plusvalías y minusvalías fondo LU1598719752.csv"
```

Run the replacement:

```sh
npm run actual:replace -- --apply "Plusvalías y minusvalías fondo IE00BYX5NX33.csv" "Plusvalías y minusvalías fondo LU1598719752.csv"
```

Raw exports and `_processed.csv` exports are both supported. Include every fund's
full history exactly once; do not supply both raw and processed versions of the
same data. `--account NAME_OR_ID` overrides the configured account.

The command validates all inputs, downloads the budget, previews the transaction
counts and resulting balance, and exits without changing transactions unless
`--apply` is present. With `--apply`, it exports a full budget ZIP to
`.actual-backups/`, deletes all transactions in the selected account, adds the CSV
transactions as cleared entries, syncs, and checks the count and balance. Existing
payees, categories, reconciled status and manual edits are replaced. Accounts
containing transfers are refused because deleting transfers affects other accounts.
Avoid editing the budget in another client during replacement.

Replacement is not atomic: if it fails after deletion, it reports the backup path.
Restore that ZIP using Actual's budget import before retrying. Backups contain your
financial data; keep them private. Server connectivity has to be tested with your
own settings. Run `npm test` for local parsing and mocked API workflow tests.

This uses the [official Actual Node API](https://actualbudget.org/docs/api/).
Use a client version compatible with your Actual server; the installed version is
pinned by `package-lock.json`.

To generate CSVs only, process a MyInvestor export:

```sh
uv run --project myInvestorActualImporter myInvestorActualImporter/main.py "Path/to/file.csv"
```

Combine the processed exports into one complete Actual Budget import:

```sh
uv run --project myInvestorActualImporter myInvestorActualImporter/main.py --combine "Plusvalías y minusvalías fondo IE00BYX5NX33_processed.csv" "Plusvalías y minusvalías fondo LU1598719752_processed.csv" -o complete_processed.csv
```

Include each fund's complete processed export once. Rows are sorted by date;
the command preserves all rows, including identical transactions.

To replace the MyInvestor account's transactions in Actual Budget:

1. Export a backup of your budget first.
2. Open **MyInvestor**, clear searches and filters, and show reconciled transactions if hidden.
3. Use the checkbox beside **Date** to select all transactions in this account, then choose **Delete** from the selection menu.
4. Click **Import** and select `complete_processed.csv`.
5. Use `;` as the delimiter, `DD/MM/YYYY` for dates, and decimal commas for amounts. Map `fecha_fiscal` to Date, `variable` to Notes, and `value` to Amount. Positive values are deposits; negative values are payments.
6. Check the preview before completing the import.

For the two sample exports, expect **20 transactions** and a **€5,136.02** balance
after replacing all transactions. Replacing transactions also removes their existing
payees, categories, cleared/reconciled status, and other edits; the CSV only contains
dates, notes, and amounts. The Python script creates files locally and does not delete or
upload anything on your Actual server.
