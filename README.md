# Restaurant Orders

Replaces the paper tickets and the corkboard an independent restaurant runs on. A manager keeps the
menu, its prices and what is available; waiters take orders from table to kitchen and back; and an
order that has been sitting too long says so without anyone walking to the pass to check.

**Live:** https://busy-with-orders.onrender.com

## Where things are

| | |
|---|---|
| [`SUBMISSION.md`](SUBMISSION.md) | Start here — links, demo credentials, and each of the ten goals with how it was met |
| [`docs/`](docs) | The design: architecture, schema, decisions, the plan, and the AI prompts behind all of it |
| [`backend/`](backend) | The API — Node, Express and hand-written SQL on PostgreSQL |
| [`frontend/`](frontend) | The browser client — React, Vite, React Router |

## Running it locally

Set up the database and `backend/.env` first — [`backend/README.md`](backend/README.md) covers
Supabase, the migrations and the seed. Then:

```bash
npm install --prefix backend
npm start --prefix backend
```

The client needs `VITE_API_URL` pointing at that API; `frontend/.env.example` documents it.

```bash
npm install --prefix frontend
npm run dev --prefix frontend
```

`npm test --prefix backend` runs the API tests against the live database, and
`npm run db:verify --prefix backend` checks that the database still enforces what
[`docs/schema.md`](docs/schema.md) says it does.

## On `§1`–`§10`

The documents cite the assignment brief’s ten numbered goals as §1 to §10 — §7 is the bulk menu
update, §10 is slow-order alerts, and so on. The brief is the company’s document, kept here
unedited as [`project_assignment.md`](project_assignment.md) so those references have something to
point at.
