-- 001_demo.sql — demo data for the hosted deployment.
--
-- The brief requires the live URL to be "seeded with enough demo data to show the system
-- doing something, not an empty shell", so this seed is built to light up every goal:
--
--   §1  one manager and three waiters, bcrypt-hashed
--   §2  active orders plus one archived order
--   §3  lines with quantities, instructions, and price snapshots
--   §4  orders resting in every status, including cancelled, plus a voided line with a reason
--   §5  collaborators on two orders
--   §6  enough rows, tables and waiters that filters and pagination have something to do
--   §8  revenue and counts for today, and ~14 days of served history for the chart
--   §9  a real timeline behind every order, written as the events happened
--   §10 one order slow and unacknowledged (alert fires) and one slow but just acknowledged
--       (alert suppressed until the repeat window elapses)
--
-- Re-runnable: it TRUNCATEs first, so `npm run db:seed` always lands on the same fixture.
--
-- !! The TRUNCATE is why this file disables the append-only trigger for a moment. That is a
-- !! development-only escape hatch and the reason this lives in seed/ rather than migrations/:
-- !! it needs table ownership, it is never run against real data, and re-enabling is in the
-- !! same transaction, so a failure rolls the disable back with it. Nothing in the API can do
-- !! this — the app role never gets to turn that trigger off.

BEGIN;

SET LOCAL search_path = public, extensions;

ALTER TABLE order_timeline DISABLE TRIGGER order_timeline_immutable;
ALTER TABLE order_timeline DISABLE TRIGGER order_timeline_immutable_truncate;

TRUNCATE order_timeline, order_lines, order_collaborators, orders, menu_items, users
  RESTART IDENTITY CASCADE;

ALTER TABLE order_timeline ENABLE TRIGGER order_timeline_immutable;
ALTER TABLE order_timeline ENABLE TRIGGER order_timeline_immutable_truncate;

-- ---------------------------------------------------------------------------
-- Users. Passwords are hashed here with pgcrypto's bcrypt rather than being pasted in as
-- pre-computed strings, so the seed stays readable and nobody is tempted to copy a hash
-- around. These are throwaway demo credentials that go in SUBMISSION.md by design; real
-- accounts are created by a manager through POST /users.
-- ---------------------------------------------------------------------------
INSERT INTO users (email, password_hash, display_name, role, phone) VALUES
  ('manager@demo.test', crypt('Manager@123', gen_salt('bf', 10)), 'Priya Nair',      'manager', '+91 98200 11111'),
  ('arjun@demo.test',   crypt('Waiter@123',  gen_salt('bf', 10)), 'Arjun Mehta',     'waiter',  '+91 98200 22222'),
  ('meera@demo.test',   crypt('Waiter@123',  gen_salt('bf', 10)), 'Meera Iyer',      'waiter',  '+91 98200 33333'),
  ('ravi@demo.test',    crypt('Waiter@123',  gen_salt('bf', 10)), 'Ravi Kulkarni',   'waiter',  NULL);

-- ---------------------------------------------------------------------------
-- Menu. One item is unavailable (the kitchen ran out) and one is archived, so the UI has a
-- real example of each state rather than a uniformly happy menu.
-- ---------------------------------------------------------------------------
INSERT INTO menu_items (name, category, price, is_available) VALUES
  ('Paneer Tikka',        'Starters', 320.00, true),
  ('Chicken 65',          'Starters', 340.00, true),
  ('Veg Manchurian',      'Starters', 280.00, true),
  ('Masala Papad',        'Starters',  90.00, true),
  ('Butter Chicken',      'Mains',    420.00, true),
  ('Dal Makhani',         'Mains',    300.00, true),
  ('Palak Paneer',        'Mains',    330.00, true),
  ('Goan Fish Curry',     'Mains',    460.00, false),   -- kitchen out of fish today
  ('Butter Naan',         'Breads',    70.00, true),
  ('Garlic Naan',         'Breads',    90.00, true),
  ('Tandoori Roti',       'Breads',    45.00, true),
  ('Jeera Rice',          'Rice',     190.00, true),
  ('Hyderabadi Biryani',  'Rice',     390.00, true),
  ('Gulab Jamun',         'Desserts', 140.00, true),
  ('Kulfi',               'Desserts', 160.00, true),
  ('Masala Chai',         'Drinks',    60.00, true),
  ('Sweet Lassi',         'Drinks',   120.00, true),
  ('Fresh Lime Soda',     'Drinks',    90.00, true);

INSERT INTO menu_items (name, category, price, is_available, archived_at) VALUES
  ('Seasonal Mango Lassi', 'Drinks', 150.00, true, now() - interval '9 days');

-- ---------------------------------------------------------------------------
-- A seed-only helper that plays an order forwards through its lifecycle and writes the
-- timeline as it goes, so seeded history looks like history rather than a bulk insert with
-- one timestamp. Dropped at the end of this file.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_place_order(
  p_table         text,
  p_waiter        bigint,
  p_final_status  order_status,
  p_placed_at     timestamptz,
  p_lines         jsonb,                                -- [{"item":"Butter Naan","qty":3,"instructions":"…"}]
  p_collaborators bigint[] DEFAULT '{}'::bigint[],
  p_archived      boolean  DEFAULT false
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  v_order_id bigint;
  v_line     jsonb;
  v_item     menu_items%ROWTYPE;
  v_line_id  bigint;
  v_qty      integer;
  v_collab   bigint;
  v_prev     order_status := 'placed';
  v_next     order_status;
  v_path     order_status[];
  v_mins     integer[];
  v_ts       timestamptz;
  i          integer;
BEGIN
  INSERT INTO orders (table_number, primary_waiter_id, status, placed_at)
  VALUES (p_table, p_waiter, 'placed', p_placed_at)
  RETURNING id INTO v_order_id;

  INSERT INTO order_timeline (order_id, actor_id, action, to_status, created_at)
  VALUES (v_order_id, p_waiter, 'created', 'placed', p_placed_at);

  -- Lines snapshot the menu item's name and price at add time (§3).
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    SELECT * INTO v_item
      FROM menu_items
     WHERE lower(name) = lower(v_line->>'item') AND archived_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'seed: no live menu item named %', v_line->>'item';
    END IF;

    v_qty := COALESCE((v_line->>'qty')::integer, 1);

    INSERT INTO order_lines (order_id, menu_item_id, item_name, unit_price, quantity, instructions, created_at)
    VALUES (v_order_id, v_item.id, v_item.name, v_item.price, v_qty,
            v_line->>'instructions', p_placed_at + interval '1 minute')
    RETURNING id INTO v_line_id;

    INSERT INTO order_timeline (order_id, actor_id, action, line_id, details, created_at)
    VALUES (v_order_id, p_waiter, 'line_added', v_line_id,
            jsonb_build_object('item', v_item.name, 'qty', v_qty, 'unit_price', v_item.price),
            p_placed_at + interval '1 minute');
  END LOOP;

  FOREACH v_collab IN ARRAY p_collaborators
  LOOP
    INSERT INTO order_collaborators (order_id, user_id, added_by, added_at)
    VALUES (v_order_id, v_collab, p_waiter, p_placed_at + interval '2 minutes');

    INSERT INTO order_timeline (order_id, actor_id, action, details, created_at)
    VALUES (v_order_id, p_waiter, 'collaborator_added',
            jsonb_build_object('collaborator_id', v_collab,
                               'collaborator', (SELECT display_name FROM users WHERE id = v_collab)),
            p_placed_at + interval '2 minutes');
  END LOOP;

  IF p_final_status <> 'placed' THEN
    IF p_final_status = 'cancelled' THEN
      -- Cancelling is only legal while Placed or Accepted (§4), so the seeded path stops there.
      v_path := ARRAY['accepted', 'cancelled']::order_status[];
      v_mins := ARRAY[3, 9];
    ELSE
      v_path := ARRAY['accepted', 'preparing', 'ready', 'served']::order_status[];
      v_mins := ARRAY[3, 7, 21, 31];
    END IF;

    FOR i IN 1 .. array_length(v_path, 1)
    LOOP
      v_next := v_path[i];
      v_ts   := LEAST(p_placed_at + make_interval(mins => v_mins[i]), now());

      INSERT INTO order_timeline (order_id, actor_id, action, from_status, to_status, created_at)
      VALUES (v_order_id, p_waiter, 'status_changed', v_prev, v_next, v_ts);

      v_prev := v_next;
      EXIT WHEN v_next = p_final_status;
    END LOOP;

    -- The denormalised stamps (docs/schema.md) are set in the same breath as the status.
    UPDATE orders
       SET status       = p_final_status,
           ready_at     = CASE WHEN p_final_status IN ('ready', 'served')
                               THEN LEAST(p_placed_at + interval '21 minutes', now()) END,
           served_at    = CASE WHEN p_final_status = 'served'
                               THEN LEAST(p_placed_at + interval '31 minutes', now()) END,
           cancelled_at = CASE WHEN p_final_status = 'cancelled'
                               THEN LEAST(p_placed_at + interval '9 minutes', now()) END
     WHERE id = v_order_id;
  END IF;

  IF p_archived THEN
    UPDATE orders SET archived_at = LEAST(p_placed_at + interval '2 hours', now())
     WHERE id = v_order_id;

    INSERT INTO order_timeline (order_id, actor_id, action, note, created_at)
    VALUES (v_order_id, p_waiter, 'archived', 'Cleared from the active queue at end of service',
            LEAST(p_placed_at + interval '2 hours', now()));
  END IF;

  RETURN v_order_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Orders.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- scripts/seed.mjs passes RESTAURANT_TZ in as app.restaurant_tz, so the seeded "days" and
  -- the dashboard's idea of a day cannot drift apart (Decision 11). The fallback keeps this
  -- file runnable on its own in the Supabase SQL editor.
  tz          text := COALESCE(NULLIF(current_setting('app.restaurant_tz', true), ''), 'Asia/Kolkata');
  today_local date := (now() AT TIME ZONE tz)::date;
  mgr bigint; w_arjun bigint; w_meera bigint; w_ravi bigint;
  o_slow bigint; o_acked bigint; o_void bigint;
  v_line_id bigint;
  d integer; k integer; n integer;
  v_at timestamptz;
  v_waiter bigint;
BEGIN
  SELECT id INTO mgr     FROM users WHERE email = 'manager@demo.test';
  SELECT id INTO w_arjun FROM users WHERE email = 'arjun@demo.test';
  SELECT id INTO w_meera FROM users WHERE email = 'meera@demo.test';
  SELECT id INTO w_ravi  FROM users WHERE email = 'ravi@demo.test';

  -- --- Thirteen days of finished service, for the served-per-day chart (§8) ---------------
  -- Deterministic on purpose: the same seed produces the same demo every time, so a
  -- screenshot in SUBMISSION.md keeps matching the live site.
  FOR d IN 1 .. 13
  LOOP
    n := 3 + (d % 4);                                   -- 3-6 orders a day
    FOR k IN 1 .. n
    LOOP
      v_waiter := CASE (d + k) % 3 WHEN 0 THEN w_arjun WHEN 1 THEN w_meera ELSE w_ravi END;
      v_at := ((today_local - d)::timestamp
               + make_interval(hours => 12 + (k % 8), mins => (d * 7 + k * 11) % 60))
              AT TIME ZONE tz;

      PERFORM seed_place_order(
        CASE (d * k) % 5
          WHEN 0 THEN 'Patio ' || (1 + (k % 3))::text
          WHEN 1 THEN 'Bar'
          ELSE        'T' || (1 + ((d * k) % 16))::text
        END,
        v_waiter,
        'served',
        v_at,
        CASE (d + k) % 3
          WHEN 0 THEN '[{"item":"Butter Chicken","qty":1},{"item":"Butter Naan","qty":3},{"item":"Jeera Rice","qty":1},{"item":"Masala Chai","qty":2}]'::jsonb
          WHEN 1 THEN '[{"item":"Paneer Tikka","qty":1},{"item":"Dal Makhani","qty":2},{"item":"Garlic Naan","qty":2},{"item":"Sweet Lassi","qty":2}]'::jsonb
          ELSE        '[{"item":"Hyderabadi Biryani","qty":2},{"item":"Masala Papad","qty":1},{"item":"Gulab Jamun","qty":2}]'::jsonb
        END
      );
    END LOOP;
  END LOOP;

  -- --- Today: served, so the dashboard has revenue -----------------------------------------
  PERFORM seed_place_order('T7', w_arjun, 'served', now() - interval '4 hours',
    '[{"item":"Chicken 65","qty":1},{"item":"Butter Chicken","qty":2,"instructions":"One mild, one regular"},
      {"item":"Butter Naan","qty":4},{"item":"Fresh Lime Soda","qty":3}]'::jsonb);

  PERFORM seed_place_order('Patio 3', w_meera, 'served', now() - interval '2 hours',
    '[{"item":"Palak Paneer","qty":1},{"item":"Tandoori Roti","qty":4},{"item":"Kulfi","qty":2}]'::jsonb,
    ARRAY[w_arjun]);

  -- --- Today: still moving -----------------------------------------------------------------
  PERFORM seed_place_order('Bar', w_ravi, 'ready', now() - interval '24 minutes',
    '[{"item":"Veg Manchurian","qty":1},{"item":"Masala Chai","qty":2}]'::jsonb);

  PERFORM seed_place_order('T9', w_ravi, 'placed', now() - interval '6 minutes',
    '[{"item":"Masala Papad","qty":2},{"item":"Sweet Lassi","qty":2}]'::jsonb);

  PERFORM seed_place_order('T2', w_arjun, 'cancelled', now() - interval '95 minutes',
    '[{"item":"Hyderabadi Biryani","qty":1}]'::jsonb);

  -- --- §10: open, pre-Ready and old. This one shows up in alerts and the nav badge. --------
  o_slow := seed_place_order('T12', w_arjun, 'preparing', now() - interval '48 minutes',
    '[{"item":"Hyderabadi Biryani","qty":2},{"item":"Garlic Naan","qty":2},{"item":"Gulab Jamun","qty":2}]'::jsonb);

  -- --- §10: equally old, but acknowledged two minutes ago, so it is currently suppressed ---
  o_acked := seed_place_order('T4', w_meera, 'accepted', now() - interval '38 minutes',
    '[{"item":"Dal Makhani","qty":1},{"item":"Jeera Rice","qty":2}]'::jsonb,
    ARRAY[w_ravi]);

  UPDATE orders
     SET alert_acked_at = now() - interval '2 minutes',
         alert_acked_by = mgr
   WHERE id = o_acked;

  INSERT INTO order_timeline (order_id, actor_id, action, note, created_at)
  VALUES (o_acked, mgr, 'alert_acknowledged', 'Chasing the kitchen, table has been told',
          now() - interval '2 minutes');

  -- --- §4/§9: a line voided with a reason, plus a note, on a live order --------------------
  o_void := seed_place_order('Patio 1', w_arjun, 'preparing', now() - interval '70 minutes',
    '[{"item":"Goan Fish Curry","qty":1},{"item":"Butter Chicken","qty":1},{"item":"Butter Naan","qty":2}]'::jsonb,
    ARRAY[w_meera]);

  SELECT id INTO v_line_id
    FROM order_lines
   WHERE order_id = o_void AND item_name = 'Goan Fish Curry';

  UPDATE order_lines
     SET voided_at   = now() - interval '61 minutes',
         voided_by   = w_meera,
         void_reason = 'Kitchen out of fish; guest switched to Butter Chicken'
   WHERE id = v_line_id;

  INSERT INTO order_timeline (order_id, actor_id, action, line_id, note, details, created_at)
  VALUES (o_void, w_meera, 'line_voided', v_line_id,
          'Kitchen out of fish; guest switched to Butter Chicken',
          jsonb_build_object('item', 'Goan Fish Curry', 'qty', 1),
          now() - interval '61 minutes');

  INSERT INTO order_timeline (order_id, actor_id, action, note, created_at)
  VALUES (o_void, mgr, 'note_added', 'Comped the dessert for the wait', now() - interval '55 minutes');

  -- The order the void happened on is also the slow one the manager is watching, so the
  -- timeline shows two different people acting on one order (§5, §9).
  INSERT INTO order_timeline (order_id, actor_id, action, note, created_at)
  VALUES (o_slow, mgr, 'note_added', 'Biryani is 20 minutes out; keep the table informed',
          now() - interval '30 minutes');

  -- --- §2: an archived order, out of the active queue but with its history intact ----------
  PERFORM seed_place_order('T15', w_meera, 'served', now() - interval '6 hours',
    '[{"item":"Chicken 65","qty":2},{"item":"Tandoori Roti","qty":6},{"item":"Masala Chai","qty":4}]'::jsonb,
    '{}'::bigint[], true);

  RAISE NOTICE 'Seed complete for % (restaurant day %)', tz, today_local;
END $$;

DROP FUNCTION seed_place_order(text, bigint, order_status, timestamptz, jsonb, bigint[], boolean);

COMMIT;
