# Local data backup and restore

The local Supabase database and the `openllms-data` Docker volume contain private application records and gateway credentials. Keep backup directories private and outside this repository. The backup script defaults to:

```text
${XDG_DATA_HOME:-~/.local/share}/allinsimple-edge/backups/local-<timestamp>/
```

Run it from the repository root:

```sh
scripts/backup-local.sh
```

You can pass a new destination directory outside the repository. Existing directories are never overwritten:

```sh
scripts/backup-local.sh /Volumes/private-backups/sports-desk-20260924
```

Each backup contains `supabase.dump` (a PostgreSQL custom archive), `openllms-data.tar.gz` (the full `/data` volume, including SQLite and secrets), `SHA256SUMS`, and a small format manifest. The script verifies the Postgres archive with `pg_restore --list`, checks the copied SQLite database with `PRAGMA integrity_check`, checks the volume tar archive, and writes SHA-256 checksums for both data files. OpenLLMs is briefly paused while its database and WAL files are copied, then resumed automatically, including on backup errors. The output reports only the backup path, not database rows or credentials.

## Restore

`restore-local.sh` is deliberately validation-only. It verifies checksums, inspects the Postgres archive, safely unpacks the gateway archive into a private temporary directory, and runs SQLite `PRAGMA integrity_check`. It never changes local data:

```sh
scripts/restore-local.sh /path/to/local-<timestamp>
```

There is no one-command live restore because restoring Supabase auth/storage schemas and replacing the gateway volume have not been tested end-to-end. Before attempting a recovery, use this operator procedure in a disposable local copy of the project:

1. Verify the selected backup with `scripts/restore-local.sh` and create a fresh backup of the current local Supabase database and gateway volume.
2. Stop the app and gateway, and confirm the target container and Docker volume belong to this local project. Keep the original volume intact until recovery has been verified.
3. Restore `supabase.dump` into a disposable Supabase Postgres instance using a compatible Postgres/Supabase version and `pg_restore --clean --if-exists --no-owner --no-acl`. Confirm that `auth`, `storage`, application schemas, roles, extensions, and expected row counts are present.
4. Extract `openllms-data.tar.gz` into a separate disposable volume. Start the gateway against that volume and check its health and configured routes without printing or copying secret values.
5. Verify sign-in, application data, gateway routes, and a read-only health request. If any check fails, discard the disposable environment and retain both the original data and safety backup.
6. Only after the disposable recovery is understood, decide separately whether to repeat it against the live local stack. Confirm the exact target and have a current safety backup before doing so.

The validation script does not prove application-level recovery, Supabase auth/storage compatibility, or gateway behavior. No live restore has been executed or claimed as tested.
