# Database migration workflow

## Authoritative workflow for new changes

All new database changes are authored as forward-only, timestamped SQL migrations in `supabase/migrations/` and reviewed/applied with the Supabase CLI. Do not generate or apply new Drizzle migrations for this application. `drizzle/migrations/` is a retained legacy bootstrap/history set; it is not a second active migration stream. Existing files in either directory must not be replayed against a database without first reconciling that database's migration ledger and actual catalog.

## Compatibility and deployment safety

The repository contains legacy Drizzle SQL (`0000`–`0012`) and later Supabase SQL migrations. Their ordering and the deployed database's applied ledger cannot be proven from this checkout: there is no database connection, Supabase CLI, or migration ledger in the repository. Before applying a pending Supabase migration to an existing environment, compare the environment's applied migration list and catalog with each migration's effects; mark already-present equivalent changes as reconciled using the team's approved Supabase migration-repair procedure. Do not re-run bootstrap SQL or infer applied state from file names.

New migrations must be additive or safely replace a function/policy, preserve existing rows, include ownership/RLS behavior, and document rollback limits. For destructive or data-transforming changes, add an explicit backup/forward-recovery plan and test against a sanitized clone first. Production application remains a separately reviewed deployment step.

## Rollback considerations for the November 2026 migrations

- `20261106000000_provider_usage_quotas.sql`: rolling back the functions and tables removes quota history and active reservations. Prefer leaving the additive tables in place during an application rollback; if removal is required, first stop new provider calls, retain/export the daily usage rows if they are needed for billing or abuse review, then drop the RPCs before dropping their tables. Do not delete active reservations while provider calls are in flight.
- `20261106010000_progression_permissions.sql`: the card RPC can be dropped only after reverting the application code that calls it. Reverting the progression trigger/column privileges requires an explicit security review; restoring table-wide `UPDATE`/`INSERT` grants reopens writes to admin-managed fields. Existing progression and flashcard rows are not transformed by this migration.
- Neither rollback has been executed or tested against a database in this environment.

## Current migration ownership

- Legacy base tables, RLS, and indexes: `drizzle/migrations/0000`–`0012`.
- Supabase-managed later changes: timestamped files in `supabase/migrations/`.
- New quota/accounting and progression/card-write protections: `supabase/migrations/20261106000000_provider_usage_quotas.sql` and `20261106010000_progression_permissions.sql`.

This document standardizes future authoring. A true normalized migration ledger for already-deployed environments still requires read-only catalog/ledger inspection and environment-specific reconciliation; no live database was available during this work.
