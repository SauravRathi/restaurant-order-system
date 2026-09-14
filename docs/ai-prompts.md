# AI prompts

Grouped by what I was trying to do, in the order I did it. For each: what I asked, what came back,
and what I kept or changed.

Implementation prompts will be added in the same commits as the code they produce.

---

## 1. Review of the initial data model

*Cursor-AUTO*

**Aim:** check my first design against the assignment before building anything on top of it.

**Asked:** gave it the assignment README and my initial list of entities and their attributes, and
asked for a review.

**Result:** it agreed with the structure.

**Kept / changed:** kept as it was. Nothing changed at this stage.

---

## 2. SQL or NoSQL for this project

*Cursor-AUTO*

**Aim:** decide the database model.

**Asked:** which model suits this project, and why.

**Result:** the reasoning now recorded in
[`decisions.md` → Decision 1](decisions.md#decision-1--choosing-the-database-model) — the schema here is fixed, the
entities are densely related, and neither of NoSQL's two main benefits (variable schema, horizontal
scaling) applies at this data volume.

**Kept / changed:** adopted. Recorded as
[Decision 1](decisions.md#decision-1--choosing-the-database-model).

---

## 3. Table design review, and how to store collaborators

*Cursor-AUTO*

**Aim:** turn the entities into tables, and settle one open question about collaborators.

**Asked:** two things in the same prompt. First, review the tables I had drawn up from my entities.
Second, how should collaborators be stored — I gave it the two options I was choosing between, an
array of user IDs on the order, or a separate join table.

**Result:**

- Agreed with the table design, and gave a specific data type for every field.
- Suggested fields I had not included: `display_name` and `created_at` on `users`, `from_status` and
  `to_status` on `order_timeline`.
- On collaborators, the reasoning now recorded in
  [`decisions.md` → Decision 2](decisions.md#decision-2--a-join-table-for-collaborators-not-an-array).

**Kept / changed:** adopted the data types and all. Took the join table.

---

## 4. Listing every action, then deriving the API from it

*Claude Opus 5*

**Aim:** list everything each role can do, and map those actions to endpoints. 

**Asked:** listed all the actions a manager and a waiter can perform. I told it the purpose was to map
those actions onto API endpoints, so it had that context while listing.

**Result:**

- It surfaced actions I had missed, including viewing your own identity. These are easy to miss
  because there are a lot of small ones and I was working from the main ones I remembered.
- Mapped each action to an endpoint, using placeholder paths.
- Produced the failure codes and the condition that causes each one, tied to specific actions rather
  than listed on their own.

**Kept / changed:** kept. The paths are still placeholders and are marked as such in
[`api.md`](api.md).

---

## 5. Writing the five documents

*Claude Opus 5*

**Aim:** turn the design work into the five required files in `docs/`.

**Asked:** dictated the content for each file and asked for well-formatted Markdown. One file at a
time.

**Result:** drafts of all five, with three problems.

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

**Aim:** check every document before committing, and make the references between them clickable.

**Asked:** review all six Markdown files, and add anchors wherever one file refers to another.

**Result:** it pointed out some minor inconsistencies across the files, and added the reference
anchors I asked for.

**Kept / changed:** fixed the inconsistencies it found. Kept the anchors.

---

## 7. Building the database from the design documents

*Claude Opus 5*

**Aim:** turn the design work from sessions 1 and 2 into a real PostgreSQL database on Supabase.

**Asked:** "Help me setup my database. It will be hosted on the free tier of Supabase. The
information that you need to know will be found in README.md and docs."

**Result:** the contents of `backend/` — `src/db.js`, two numbered migrations, the demo seed, four
`db:*` scripts, and `backend/README.md`.

**Kept / changed:** kept. The migrations and the seed were applied to Supabase.

---

## 8. Reading each file before applying it

*Claude Opus 5*

**Aim:** understand code written in a previous session while applying it to a real database.

**Asked:** walk through each file before that file is run — `db.js`, both migrations, the seed, then
each script.

**Result:** the explanation and the execution happened together: read `001_init.sql`, then apply it;
read `002_lockdown.sql`, then apply it; read the seed, then run it. Two things surfaced that the
comments did not mention. `db:status` is not read-only — it creates `schema_migrations` before
deciding what to print. And the seed disables both append-only triggers before its `TRUNCATE`, where
only the statement-level one is needed, because `TRUNCATE` does not fire row-level triggers at all.

**Kept / changed:** no code changed — both are harmless. The understanding went into the commit
messages instead.

---

## 9. Whether the lockdown migration was needed at all

*Claude Opus 5*

**Aim:** check whether a Supabase account setting could do the same job as
[`002_lockdown.sql`](../backend/migrations/002_lockdown.sql).

**Asked:** did we need a migration to lock the database down, or could I change a setting on the
Supabase account so it does not generate those endpoints in the first place?

**Result:** it had been presenting the migration as the only route. It is not — Supabase lets you
disable the Data API for a project outright, or change which schemas are exposed. It also withdrew
an earlier claim it had never measured, that `anon` and `authenticated` held read and write grants
on the tables before `002` ran.

**Kept / changed:** kept the migration. It is already written, and it is *testable* — `db:verify`
asserts that RLS is on and that those grants are gone. A dashboard setting is neither: it is not in
the repository, and nothing in the project can assert that someone clicked it.

---

## 10. Nothing to deploy yet

*Claude Opus 5*

**Aim:** run the deployment test.

**Asked:** Let's run the deployment test now. (It had prior context)

**Result:** it pushed back. The repository holds no start script or server. It suggested deployment after we have built the complete backend, which was risky, since deployment is a necessary part in the presentation of this project and can't be left till the last hour. 

**Kept / changed:** directed it to create a throw-away server.

---

## 11. A throwaway server, and the deployment test

*Claude Opus 5*

**Aim:** test the deployment path without waiting for the API to exist.

**Asked:** write a throwaway server for the test. I

**Result:** a 60-line server using Node's built-in `http` module and `src/db.js` as it already stood.

---
