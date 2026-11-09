# Migration safeguards

Schema changes are additive. A migration may add a table, column, or index. It does not drop or replace a table, column, or settings key that already holds customer data.

- Add columns with `ADD COLUMN IF NOT EXISTS` and a safe default. Existing rows keep their values.
- Create new tables with `CREATE TABLE IF NOT EXISTS`. Do not recreate a table to change it.
- Settings JSON is merged. New keys are added. Old keys stay.
- When two branches both change a migration or an API route, keep both changes. Do not take one side of the conflict if that deletes a column, a route, or a settings field.
- A destructive statement (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`) needs the comment `-- destructive-allowed` on that line and a reason a reviewer can check.

`node lib/db/scripts/check-migrations.mjs` checks `lib/db/drizzle/*.sql` for those rules.
