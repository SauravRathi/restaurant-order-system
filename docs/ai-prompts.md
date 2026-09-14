# AI prompts

Grouped by what I was trying to do, in the order I did it. For each: what I asked, what came back,
and what I kept or changed.

Implementation prompts will be added in the same session as the code they produce.

---

## 1. Review of the initial data model

*Cursor-AUTO*

**Aim:** Check my first design against the assignment before building anything on top of it.

**Asked:** Gave it the assignment README and my initial list of entities and their attributes, and
asked for a review.

**Result:** It agreed with the structure.

**Kept / changed:** Kept as it was. Nothing changed at this stage.

---

## 2. SQL or NoSQL for this project

*Cursor-AUTO*

**Aim:** Decide the database model.

**Asked:** Which model suits this project, and why.

**Result:** The reasoning now recorded in
[`decisions.md` → Decision 1](decisions.md#decision-1--choosing-the-database-model) — the schema here is fixed, the
entities are densely related, and neither of NoSQL's two main benefits (variable schema, horizontal
scaling) applies at this data volume.

**Kept / changed:** Adopted. Recorded as
[Decision 1](decisions.md#decision-1--choosing-the-database-model).

---

## 3. Table design review, and how to store collaborators

*Cursor-AUTO*

**Aim:** Turn the entities into tables, and settle one open question about collaborators.

**Asked:** Two things in the same prompt. First, review the tables I had drawn up from my entities.
Second, how should collaborators be stored — I gave it the two options I was choosing between, an
array of user IDs on the order, or a separate join table.

**Result:**

- Agreed with the table design, and gave a specific data type for every field.
- Suggested fields I had not included: `display_name` and `created_at` on `users`, `from_status` and
  `to_status` on `order_timeline`.
- On collaborators, the reasoning now recorded in
  [`decisions.md` → Decision 2](decisions.md#decision-2--a-join-table-for-collaborators-not-an-array).

**Kept / changed:** Adopted the data types and all. Took the join table.

---

## 4. Listing every action, then deriving the API from it

*Claude Opus 5*

**Aim:** List everything each role can do, and map those actions to endpoints. 

**Asked:** Listed all the actions a manager and a waiter can perform. I told it the purpose was to map
those actions onto API endpoints, so it had that context while listing.

**Result:**

- It surfaced actions I had missed, including viewing your own identity. These are easy to miss
  because there are a lot of small ones and I was working from the main ones I remembered.
- Mapped each action to an endpoint, using placeholder paths.
- Produced the failure codes and the condition that causes each one, tied to specific actions rather
  than listed on their own.

---

## 5. Writing the five documents

*Claude Opus 5*

**Aim:** Turn the design work into the five required files in `docs/`.

**Asked:** Dictated the content for each file and asked for well-formatted Markdown. One file at a
time.

**Result:** Drafts of all five, with three problems.

1. **The language was unnecessarily complicated**, and padded with detail that did not need to be
   there.
2. **It wrote notes addressed to me into the documents.** Things it wanted to bring to my attention
   kept appearing inside the files themselves. Those are for me, not for the repository.
3. **In [`architecture.md`](architecture.md) it named specific technologies and hosting platforms for choices I had not
   made** — where the database would be hosted, what would handle authorization. The document then
   read as though those were settled, which was inaccurate.

**What I did:**

- For 1 and 2, edited by hand: cut the padding, simplified the wording, removed the asides.
- For 3, directed it to mark every technology as either **decided** or a **candidate placeholder**.
  That convention is at the top of [`architecture.md`](architecture.md) now. 

---

## 6. Final review before the first commit

*Claude Opus 5*

**Aim:** Check every document before committing, and make the references between them clickable.

**Asked:** Review all six Markdown files, and add anchors wherever one file refers to another.

**Result:** It pointed out some minor inconsistencies across the files, and added the reference
anchors I asked for.

**Kept / changed:** Fixed the inconsistencies it found. Kept the anchors.

---

## 7. Building the database from the design documents

*Claude Opus 5*

**Aim:** Turn the design work from sessions 1 and 2 into a real PostgreSQL database on Supabase.

**Asked:** "Help me setup my database. It will be hosted on the free tier of Supabase. The
information that you need to know will be found in README.md and docs."

**Result:** The contents of `backend/` — `src/db.js`, two numbered migrations, the demo seed, four
`db:*` scripts, and `backend/README.md`.

**Kept / changed:** Kept. The migrations and the seed were applied to Supabase.

---

## 8. Reading each file before applying it

*Claude Opus 5*

**Aim:** Understand code written in a previous session while applying it to a real database.

**Asked:** Walk through each file before that file is run — `db.js`, both migrations, the seed, then
each script.

**Result:** The explanation and the execution happened together: read `001_init.sql`, then apply it;
read `002_lockdown.sql`, then apply it; read the seed, then run it. Two things surfaced that the
comments did not mention. `db:status` is not read-only — it creates `schema_migrations` before
deciding what to print. And the seed disables both append-only triggers before its `TRUNCATE`, where
only the statement-level one is needed, because `TRUNCATE` does not fire row-level triggers at all.

**Kept / changed:** No code changed — both are harmless. The understanding went into the commit
messages instead.

---

## 9. Whether the lockdown migration was needed at all

*Claude Opus 5*

**Aim:** Check whether a Supabase account setting could do the same job as
[`002_lockdown.sql`](../backend/migrations/002_lockdown.sql).

**Asked:** Did we need a migration to lock the database down, or could I change a setting on the
Supabase account so it does not generate those endpoints in the first place?

**Result:** It had been presenting the migration as the only route. It is not — Supabase lets you
disable the Data API for a project outright, or change which schemas are exposed. It also withdrew
an earlier claim it had never measured, that `anon` and `authenticated` held read and write grants
on the tables before `002` ran.

**Kept / changed:** Kept the migration. It is already written, and it is *testable* — `db:verify`
asserts that RLS is on and that those grants are gone. A dashboard setting is neither: it is not in
the repository, and nothing in the project can assert that someone clicked it.

---

## 10. The check that passed because of when it ran

*Claude Opus 5*

**Aim:** Have a script I can run at any time that proves the database still enforces the rules
[`schema.md`](schema.md) says it enforces.

**Asked:** Write that script, separate from the tests.

**Result:** `db:verify`, twenty-two checks. One of them was quietly broken.

The rule being checked was this one: an order left too long raises an alert, and if someone
dismisses that alert the order goes quiet for ten minutes and then starts alerting again. The demo
data includes an order whose alert was dismissed two minutes ago, so it should still be quiet. The
check said: that order is quiet.

Which is true for the next eight minutes only. After that the ten minutes are up, the order starts
alerting again, and the check is wrong. But it never ran late enough to find out, because
`db:rebuild` loads the demo data and runs the checks one after the other, seconds apart. So it
passed every single time it was run.

**What the AI got wrong, and what I did:** The check described the data as it happened to look at
that moment, instead of setting up the situation it wanted to test. That made it a check that could
only pass — until it couldn't. It went red the first time I ran `db:verify` on its own, minutes
after loading the data rather than seconds, in the final testing of the session.

A green check that is wrong is worse than one that fails, because the whole point of `db:verify` is
that I do not have to go and look for myself. I had it replaced with three checks that set up the
state they need, look at it, and then undo it, so they give the same answer whenever they are run.
One of the three covers the alert coming back after ten minutes, which nothing had tested before.

---

## 11. Nothing to deploy yet

*Claude Opus 5*

**Aim:** Run the deployment test.

**Asked:** Let's run the deployment test now. (It had prior context)

**Result:** It pushed back. The repository holds no start script or server. It suggested deployment after we have built the complete backend, which was risky, since deployment is a necessary part in the presentation of this project and can't be left till the last hour. 

**Kept / changed:** Directed it to create a throw-away server.

---

## 12. A throwaway server, and the deployment test

*Claude Opus 5*

**Aim:** Test the deployment path without waiting for the API to exist.

**Asked:** Write a throwaway server for the test. I

**Result:** A 60-line server using Node's built-in `http` module and `src/db.js` as it already stood.

---

## 13. Handing over session 4

*Claude Opus 5*

**Aim:** Hand over control with enough context that the coding could run without stopping to ask me
which direction to take at each step.

**Asked:** Read `CLAUDE.md` for the current state and the API design, then build the pieces
everything else would need — password hashing, token signing, the middleware that turns a token into
an identity, one error handler, one payload validator, and the rule for who can see an order written
once as a reusable SQL fragment. Check each piece against the live database rather than asserting it
works.

**Result:** Those pieces in that order, each run against the seeded users before the next. The
visibility rule went in before anything used it.


---

## 14. The routes

*Claude Opus 5*

**Aim:** Build the API logic on top of those pieces.

**Asked:** The endpoints in the order `api.md` sets them out — users, then the menu, then orders,
then alerts and the dashboard.

**Result:** 26 routes. Each group was run against the live database as it was finished: sign-in and
the role refusals, the menu's case-insensitive name collisions, the order lifecycle end to end, the
alert window at nine minutes and eleven, the dashboard headlines against counts computed separately
in SQL.

---

## 15. What §7 actually asks for in a bulk update

*Claude Opus 5*

**Aim:** Settle the bulk update. Applying one price to several different products does not make sense
on a real menu, and giving each its own price would be no different from updating them one at a time.

**Asked:** Why can we only set a single price across the selection?

**Result:** It went back to the brief rather than arguing from our own notes. §7 says *"apply one
change to all of them — a new price or a change in availability"*, so the single shared price is the
brief's wording. 

**Kept / changed:** Kept the single price. I considered a percentage increase instead, which is the
operation a real menu would actually want, and dropped it against the time budget, marked as review,
if there is time left at the end.

---

## 16. Keeping the checks instead of discarding them

*Claude Opus 5*

**Aim:** Stop throwing away the scripts that tested each slice.

**Asked:** We should build a re runnable test.

**Result:** 75 (updated from 66) tests on Node's built-in test runner. [`plan.md` → Session 4](plan.md#session-4--the-api).

---

## 17. Handing over session 5

*Claude Opus 5*

**Aim:** Build the browser client without re-explaining the project first.

**Asked:** Read `CLAUDE.md` for the current state, the design and the API as built, then write the
client one component at a time in the order I set — scaffold, sign-in, the order board, one order,
the menu, then the dashboard and alerts. 

**Result:** The whole frontend in that order, each screen exercised against the live API before the
next one started.

---

## 18. The negative price §7 asks for

*Claude Opus 5*

**Aim:** Make the bulk update actually do what §7 describes.

**Asked:** We are not allowing negative prices, so a thing the brief explicitly mentions is not
being tested. We are not handling each request individually.

**Result:** It confirmed the gap rather than defending the code. The strict price validator ran
before anything per-item could happen, so `price: -5` came back as a `422` with nothing touched and
no report — the whole-batch failure the goal rules out, for the exact case the goal names.

**What the AI got wrong, and what I did:** Two faults in the same feature. In the menu
editor, choosing a price and then switching to availability threw the price away, the two
actions overrode each other instead of both being kept. And a negative price could not be
tested at all, because the API refused the whole request on basis of invalid input (price >= 0). I found both by using the menu screen in UI testing. 

I told it what was wrong and set out how the bulk feature should work instead. It still got
the next two or three attempts wrong. What finally fixed it was me specifying the queue:
each change is banked with the items chosen for it, and nothing is sent until Done.


---


## 19. Deploying, with no experience of deploying

*Claude Opus 5*

**Aim:** Get the app onto Render. I have not deployed anything before.

**Asked:** Help me deploy this. What goes where, and in what order.

**Result:** Both services live, in an order where each one's URL was the next one's input. It also
caught two platform-specific faults I would not have known to look for: the connection string on the
host was the direct one rather than the pooler, so nothing could reach the database; and
`public/_redirects`, which it had written in session 5, is a Netlify convention that Render ignores,
so every deep link returned 404.

**Kept / changed:** Kept. The rewrite moved to a rule in Render.
