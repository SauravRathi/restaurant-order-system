# Plan

## How I am breaking the work into sessions

I broke down the project into 6 major sessions.

At the bottom of this document, there's a section 'Notes' which follows the timeline of this project. After each session I review and log my progress there.

| Session | What it is about| Est. | Actual |
|---------|------------|------|--------|
| **1. Designing**| Decide the tech stack for UI and backend. Identify actors at play, entites and their attributes. Decide on a database model (SQL v/s NoSQL). Convert the entities into tables. Identify the operations that need to be performed on each table, for better indexing.  | 3 h | ~3 h | 
| **2. API endpoints, Formalize docs and first commit** | Identify all the actions a user (Manger/Waiter)can perform. Turn those actions into corresponding API endpoints. Turn the design work from the first session into the five `docs/` files and put them on github. | 3 h | ~4 h |
| **3. Database, Test Hosting** | Create and connect to a Postgres Database. Initialize it with seed data. Test all required functions. Test run deployment. | 2 h | ~2 h | 
| **4. Backend** | Implement the server (Node/Express) logic. Map what managers vs waiters can do to functions in our code and API endpoints. Run tests. | 3 h | — |
| **5. Frontend** | Design components based on user needs. Decide on a theme. Run tests against all core requirements.| 3 h | — | 
| **6. Deploy + submit** | Host the app, demo seed, finish `SUBMISSION.md` / README. Final tests on the deployed app. | 2 h | — | 


## Order and why

1. **Design first** — So I have a well defined base to work on, going into further sessions. Without it I will most likely have to rewrite a lot of code. With a project broken into multiple components (Client, Server, Database), we need to plan ahead on how they will connect and communicate, otherwise we need to make adjustments later which is costlier. Also, with a clear design, I will be able to use AI tools much more effectively, feeding them context will be more efficient. 
2. **API endpoints before Database** — So the APIs represent the actions a user can perform instead of how the data is stored. We want the database schema and APIs to be independent of each other, so a change in one does not prompt a change in the other. Example : If our APIs mirror the table structure, then to access a join table (like collaborators table), we will have to make a messy, complex API call. 
3. **Deployment Test** - So we're not surprised by any failures on the last day. 
4. **Database before Backend** — So we have testing data for each further feature, instead of having to create data for each test.
5. **Backend before frontend** — We will have a clear idea of what data the client can obtain and display, and how they will obtain it. This removes any ambiguities while designing the UI. 
6. **Deploy / submit ** — This is a natural last step.


## What I cut when I ran short

Nothing has been cut yet. 

---

# Notes

A running log, in order. I add to this at the end of each session.

## Session 1 — Designing

*10–11 Sep 2026*

MERN is the stack I have learned, so it was the go-to choice by default.

I started by identifying the actors in the system, then the entities and their attributes, and I
reviewed those with AI.

Next I looked at which data model to use for this project. MongoDB is the default with MERN, but it
seemed to me that a relational database would be the better fit here: the schema is fixed, the data
volume is low, and there is no need for horizontal scaling. That is what made me stop and research
the question properly rather than take the default.

That research took longer than I had planned for it. I also asked AI for the comparison. I settled
on SQL.

After that I converted the entities into tables, and worked out which operations each table would
need to support, so I could look for bottlenecks before building anything on top of the design. I
reviewed that with AI too — logged in [`ai-prompts.md`](ai-prompts.md).

## Session 2 — API endpoints, docs, first commit

*12–13 Sep 2026*

I started by creating a new workspace in Claude and giving it the context it needed to understand
what was going on.

Then I went back through the README the company gave us and wrote down the actions each user can
perform. I handed that list to the AI and told it the aim was to map those actions onto API
endpoints, so it had the purpose in front of it while working. That is logged in
[`ai-prompts.md`](ai-prompts.md).

After that I dictated my content for the five documents that make up the initial commit, working on
one file at a time and directing the AI to produce well-formatted Markdown for each.

**The manual editing of those documents is what took the longest — about 2.5 hours of the session.**

I spent that much time on documentation deliberately. I am banking on well-defined documentation
from the start being easier to maintain as more of it accumulates, and on it making my prompts and
context much more useful once the AI is writing the actual code. It is a front-loaded approach:
more effort at the design end, on the expectation that it pays back across sessions 3 to 6.

## Session 3 — Database, deployment test

*13–14 Sep 2026*

I gave the AI the design documents and asked it to set up the database and the connections from
them. That produced the migrations, the seed and the `db:*` scripts.

Before running any of it I settled where the database would live: one hosted Supabase database for
development and deployment both —
[Decision 7](decisions.md#decision-7--one-hosted-database-for-development-and-deployment). Then I
created the project.

Creating the database → creating the tables through migration files → sending the seed data →
verifying and resetting.

I ran the checks, reset the database and rebuilt it from nothing to prove it could be.
**`db:verify` went red when I ran it on its own later.** One of its checks was only true for the
eight minutes after seeding, so it had passed every time since `db:rebuild` runs seed and verify seconds
apart. Logged in [`ai-prompts.md`](ai-prompts.md) as the prompt that produced bad output. I replaced
it with three checks that set the state they need and roll it back.

Last, a new web service on Render running a throwaway server, to test the deployment path before the
API exists. It proved the thing that mattered: Render can reach Supabase through the transaction
pooler.
