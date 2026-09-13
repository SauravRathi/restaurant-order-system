-- 001_init.sql — Restaurant Orders schema (PostgreSQL 14+, targeted at Supabase)
--
-- Design notes live in docs/schema.md. Two rules this file follows throughout:
--   * money is NUMERIC(10,2), never a float;
--   * "soft" states (archived, voided, acknowledged) are TIMESTAMPTZ, not booleans, so one
--     column answers both "is it?" and "since when?".
--
-- The whole file is idempotent (IF NOT EXISTS / DO-block guards), so it is safe to re-run —
-- including by pasting it into the Supabase SQL editor after a partial failure.

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions.
-- Supabase convention is to keep extensions out of `public`; the schema already exists there
-- and CREATE SCHEMA IF NOT EXISTS keeps this file runnable on a plain local Postgres too.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS citext   WITH SCHEMA extensions;  -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS pg_trgm  WITH SCHEMA extensions;  -- ILIKE '%x%' on table_number (§6)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;  -- bcrypt hashes for the seed

-- Type/operator lookup for this session. Column types are resolved at DDL time, but the
-- citext `=` operator and the gin_trgm_ops opclass are looked up through search_path.
SET LOCAL search_path = public, extensions;

-- ...and for every future connection, so the API does not have to remember. New connections
-- only; harmless (and skipped) if the role lacks the privilege, e.g. on a managed host.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO %s',
                 current_database(), '"$user", public, extensions');
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE NOTICE 'Could not set database-level search_path; the connection pool sets it instead.';
END $$;

-- ---------------------------------------------------------------------------
-- Enums. The lifecycle and the timeline vocabulary live in the database so an invalid value
-- cannot be written even by a buggy code path (Decision 2).
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('manager', 'waiter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('placed', 'accepted', 'preparing', 'ready', 'served', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE timeline_action AS ENUM (
    'created',              -- order opened (to_status = 'placed')
    'status_changed',       -- carries from_status / to_status
    'line_added',
    'line_voided',          -- carries line_id; reason in note
    'collaborator_added',
    'note_added',
    'archived',
    'restored',
    'alert_acknowledged'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- users — sign-in is by email (§1), so email is the unique key and a surrogate id is the
-- primary key: email can change without cascading through four foreign keys (Decision 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL   PRIMARY KEY,
  email         CITEXT      NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,          -- bcrypt; never a raw password
  display_name  TEXT        NOT NULL,          -- shown in "orders by waiter" (§8) and filters (§6)
  role          user_role   NOT NULL,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_shape CHECK (position('@' IN email) > 1)
);

-- ---------------------------------------------------------------------------
-- menu_items — managers create and archive (§1). Archived rows stay forever because old
-- order lines still point at them; nothing here is ever hard-deleted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
  id           BIGSERIAL     PRIMARY KEY,
  name         TEXT          NOT NULL,
  category     TEXT          NOT NULL,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_available BOOLEAN       NOT NULL DEFAULT true,
  archived_at  TIMESTAMPTZ,                    -- NULL = live
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT menu_items_name_not_blank CHECK (length(trim(name)) > 0)
);

-- Two *live* items may not share a name; re-creating an archived name is fine.
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_live_name_uq
  ON menu_items (lower(name)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS menu_items_live_idx
  ON menu_items (category, name) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- orders — status is an enum, not a boolean. table_number is TEXT because §6 asks for a text
-- *search* over it and real floor plans use 'Patio 3' and 'Bar' as much as '12'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                BIGSERIAL    PRIMARY KEY,
  table_number      TEXT         NOT NULL,
  primary_waiter_id BIGINT       NOT NULL REFERENCES users(id),
  status            order_status NOT NULL DEFAULT 'placed',
  placed_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ready_at          TIMESTAMPTZ,               -- set on -> ready (alerts stop here, §10)
  served_at         TIMESTAMPTZ,               -- set on -> served ("served today", revenue, §8)
  cancelled_at      TIMESTAMPTZ,
  archived_at       TIMESTAMPTZ,               -- NULL = in the active queue (§2)
  alert_acked_at    TIMESTAMPTZ,               -- slow-order acknowledgement (§10)
  alert_acked_by    BIGINT       REFERENCES users(id),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT orders_table_number_not_blank CHECK (length(trim(table_number)) > 0),
  -- An acknowledgement is a fact about who and when: both columns or neither.
  CONSTRAINT orders_alert_ack_shape CHECK (num_nulls(alert_acked_at, alert_acked_by) <> 1)
);

CREATE INDEX IF NOT EXISTS orders_active_placed_idx  ON orders (placed_at DESC)    WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_active_status_idx  ON orders (status, placed_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_primary_waiter_idx ON orders (primary_waiter_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_served_at_idx      ON orders (served_at)         WHERE served_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_table_trgm_idx     ON orders USING gin (table_number extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- order_collaborators — the many-to-many of §5. The composite primary key makes adding the
-- same collaborator twice impossible in the database rather than a check in code; the second
-- index covers the other direction, "which orders am I on" (Decision 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_collaborators (
  order_id BIGINT      NOT NULL REFERENCES orders(id),
  user_id  BIGINT      NOT NULL REFERENCES users(id),
  added_by BIGINT      NOT NULL REFERENCES users(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, user_id)
);
CREATE INDEX IF NOT EXISTS order_collaborators_user_idx ON order_collaborators (user_id);

-- ---------------------------------------------------------------------------
-- order_lines — item_name and unit_price are SNAPSHOTS taken when the line is added (§3,
-- Decision 6). A later menu price change must not rewrite old totals or CSV rows.
-- Voiding marks the line; it never deletes it (§4).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_lines (
  id           BIGSERIAL     PRIMARY KEY,
  order_id     BIGINT        NOT NULL REFERENCES orders(id),
  menu_item_id BIGINT        NOT NULL REFERENCES menu_items(id),   -- may point at an archived item
  item_name    TEXT          NOT NULL,
  unit_price   NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity     INTEGER       NOT NULL CHECK (quantity > 0),
  instructions TEXT,
  voided_at    TIMESTAMPTZ,
  voided_by    BIGINT        REFERENCES users(id),
  void_reason  TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- The three void columns are all-NULL or all-set, and a void needs a non-blank reason.
  -- The API validates first so the waiter reads a sentence, not a constraint name; this is
  -- the backstop for any code path that forgets.
  CONSTRAINT order_lines_void_shape CHECK (
    num_nulls(voided_at, voided_by) = 2
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
        AND void_reason IS NOT NULL AND length(trim(void_reason)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id);
-- Running total = SUM(quantity * unit_price) WHERE voided_at IS NULL. No stored total column
-- (Decision 7) — nothing to forget updating on a void.

-- ---------------------------------------------------------------------------
-- order_timeline — append-only (§9). Rows belong to a timeline simply by sharing order_id;
-- chronological order is (created_at, id). Written in the SAME transaction as the change it
-- records, so history can never be missing an event that happened.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_timeline (
  id          BIGSERIAL       PRIMARY KEY,
  order_id    BIGINT          NOT NULL REFERENCES orders(id),
  actor_id    BIGINT          NOT NULL REFERENCES users(id),
  action      timeline_action NOT NULL,
  from_status order_status,
  to_status   order_status,
  line_id     BIGINT          REFERENCES order_lines(id),
  note        TEXT,                                             -- free text / void reason body
  details     JSONB           NOT NULL DEFAULT '{}'::jsonb,     -- {"item":"Paneer Tikka","qty":2}
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT timeline_status_change_shape CHECK (
    action <> 'status_changed' OR (from_status IS NOT NULL AND to_status IS NOT NULL)
  ),
  CONSTRAINT timeline_line_event_shape CHECK (
    action NOT IN ('line_added', 'line_voided') OR line_id IS NOT NULL
  ),
  CONSTRAINT timeline_void_needs_reason CHECK (
    action <> 'line_voided' OR (note IS NOT NULL AND length(trim(note)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS order_timeline_order_idx ON order_timeline (order_id, created_at, id);
CREATE INDEX IF NOT EXISTS order_timeline_actor_idx ON order_timeline (actor_id);

-- "History you cannot rewrite" — enforced by the database, not by convention (Decision 5).
-- Even a privileged psql session cannot rewrite it; there are no edit routes in the API either.
CREATE OR REPLACE FUNCTION order_timeline_forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_timeline is append-only (attempted %)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS order_timeline_immutable ON order_timeline;
CREATE TRIGGER order_timeline_immutable
  BEFORE UPDATE OR DELETE ON order_timeline
  FOR EACH ROW EXECUTE FUNCTION order_timeline_forbid_change();

-- TRUNCATE is a separate privilege and fires a different trigger, so block it too —
-- otherwise the one statement that erases all of history is the one the trigger misses.
DROP TRIGGER IF EXISTS order_timeline_immutable_truncate ON order_timeline;
CREATE TRIGGER order_timeline_immutable_truncate
  BEFORE TRUNCATE ON order_timeline
  FOR EACH STATEMENT EXECUTE FUNCTION order_timeline_forbid_change();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS orders_touch ON orders;
CREATE TRIGGER orders_touch     BEFORE UPDATE ON orders     FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS menu_items_touch ON menu_items;
CREATE TRIGGER menu_items_touch BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
