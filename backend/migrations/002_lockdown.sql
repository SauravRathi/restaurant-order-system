-- 002_lockdown.sql — Supabase-specific: make sure nothing here is reachable except through our API.
--
-- Why this exists. Supabase auto-exposes every table in `public` over PostgREST to the `anon`
-- and `authenticated` roles using the project's publishable/anon key — a key that ships in
-- browser code. Our architecture (docs/architecture.md) says the Express API is the only
-- writer and every rule is enforced server-side; an open REST surface on the same tables
-- would quietly make that untrue, and §1 says the manager/waiter difference must be enforced
-- on the server, not hidden in the interface.
--
-- Two layers, because either one alone has a failure mode:
--   1. RLS on with zero policies  -> anon/authenticated can read and write nothing.
--   2. Grants revoked             -> they cannot even see the relation.
-- The API connects as the table owner (`postgres`), which bypasses RLS, so nothing changes
-- for us. We deliberately do NOT use FORCE ROW LEVEL SECURITY, which would lock out the owner
-- as well. If this app ever moved to Supabase Auth + client-side queries, the policies would
-- be written here and this comment would be the thing to revisit.
--
-- Idempotent and portable: the whole file is a no-op on a plain Postgres with no anon role.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'menu_items', 'orders', 'order_collaborators', 'order_lines', 'order_timeline'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- schema_migrations is created by scripts/migrate.mjs before this file runs.
DO $$ BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      -- ...and for tables added by a later migration, so this does not rot.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;
