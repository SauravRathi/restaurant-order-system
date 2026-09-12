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

**Kept / changed:** adopted the data types and all four suggested fields. Took the join table.

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
