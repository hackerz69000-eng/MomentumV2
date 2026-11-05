# Generated question registry setup

The updated Regular Quiz, Practice Exam, Comprehensive Exam, and image quiz flows use a database reservation to stop two tabs/devices from finalizing the same question for the same study set at the same time.

## Before using the updated app

Apply `supabase/migrations/20261106000000_generated_question_registry.sql` to the Supabase project used by this app. The migration creates an RLS-protected registry, gives authenticated users read access only to their own rows, and allows writes only through a security-checked database function. It also copies question text from existing quiz attempts into the registry so earlier questions stay in the exclusion history. It does not delete existing app data.

This migration has **not** been applied to any database by this repair. Apply it through your normal Supabase migration workflow before deploying/using this version. If you use the Supabase CLI, inspect the migration and your project link first, then use your usual reviewed migration push workflow. Do not run it against production until you have verified the target project and have a database backup.

If the app reports that it could not check prior questions or safely finalize an assessment, first confirm this migration has been applied to the same Supabase project as the app.
