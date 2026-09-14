# Assignment 09 — Restaurant Orders

## The scenario

Picture a busy independent restaurant taking orders on paper tickets that get carried by hand from
the counter to the kitchen and pinned to a corkboard until someone remembers to take them down. The
menu lives on a printed sheet and a chalkboard of specials, and when a price changes or the kitchen
runs out of an ingredient, someone has to physically cross it out and hope every waiter notices
before taking the next order.

The result is predictable. A ticket falls off the corkboard and an order never reaches the kitchen,
so a table sits wondering where their food is while the kitchen has no idea anyone is waiting. A
price changes on the chalkboard but not in anyone's head, so two customers at the same table get
charged differently for the same dish depending on who rang it up. Nobody can say how long an order
has actually been sitting without physically walking back and asking the kitchen.

They want one system: a manager keeps the menu, its prices and what's currently available up to date
in one place, and waiters place and track orders from table to kitchen to table again without a
paper ticket ever leaving the building. Anyone should be able to tell which orders have been sitting
too long without walking back to check. Build the system that replaces the corkboard.

## What it must do

Everything below is required. Several of the ten spell out exact rules — what happens on an illegal
move, what a bulk action must report back, when a dismissed alert is allowed to reappear — and those
specifics are the actual ask, not just the bold headline in front of them.

1. **Accounts and roles.** People sign in with an email and password, and there are at least two
roles — a manager role and a waiter role. Managers create and archive menu items, set their name,
price and availability, and can see and act on every order. Waiters create orders and act on the
ones they created or are added to, but cannot create menu items, change prices, or act on another
waiter's order unless added to it. The difference must be enforced on the server, not just hidden in
the interface.

2. **Orders.** Waiters and managers create orders for a table, identified by a table number; the
waiter who creates an order becomes its primary waiter. Orders can be archived and restored.
Archiving removes old orders from the default active queue without destroying their history.

3. **Order lines.** Every order line belongs to exactly one order and carries a menu item, a
quantity, and any special instructions. Lines can be added to an order at any point before it is
served. Opening an order shows its lines and their running total, calculated by the server from the
menu items' current prices at the time each line was added.

4. **An order lifecycle with rules.** An order moves through *Placed → Accepted → Preparing → Ready
→ Served*. It can be cancelled, marked *Cancelled*, but only while it is still Placed or Accepted —
once the kitchen has begun Preparing, the order can no longer be cancelled as a whole. Any line on
an order can be voided, marked *Void*, with a required reason for as long as the order remains open,
meaning any state before Served or Cancelled; voiding marks the line rather than deleting it, so the
order's original record stays intact. Any other move must be rejected by the server with a message
explaining why.

5. **Collaborators.** An order has one primary waiter, but any number of other waiters can be added
to it as collaborators who can also update it, and a single waiter can collaborate on any number of
orders. Every waiter can see one list of every order where they are the primary waiter or a
collaborator.

6. **Finding orders.** One list shows orders across every table the viewer can see, with a text
search over the table number, filters for status, waiter and date, sorting by placed time, status or
table, and pagination showing the total number of matches. All of this must happen on the server —
do not load every order into the browser and filter there.

7. **Acting on many menu items at once.** Managers can select several menu items and apply one
change to all of them — a new price or a change in availability — in a single action. Because some
items in the selection may be invalid, such as a negative price, the result must report per item
what succeeded and what was rejected and why, not just fail the whole batch. Separately, export the
day's orders — every order placed that day with its lines, total and status — as a CSV file.

8. **A dashboard.** A landing view shows headline numbers — open orders, orders placed today, orders
served today, and revenue today. It also breaks orders down by status and by waiter, and charts
orders served per day over the last fourteen days.

9. **History you cannot rewrite.** Every order has a timeline showing every status change with the
old and new status and who made it, every line added or voided with its reason, and any notes left
on it. Nothing in this timeline can be edited or deleted after the fact, including by managers.

10. **Slow-order alerts.** An order that has been open for more than a set number of minutes without
reaching Ready appears in an alerts area, with a count badge visible in the navigation. A waiter or
manager can acknowledge the alert for that order, clearing it from the list. If the order is still
not Ready a further set number of minutes later, the alert returns.

## Stretch ideas (optional)

None of these are required, and none substitute for a goal above. If you finish all ten with time
left over, pick whichever of these sounds most useful and build it:

- A kitchen display screen instead of printed tickets.
- Table-side ordering from a handheld device.
- Split checks across multiple payers.
- A loyalty or repeat-customer program.
- Ingredient-level stock deduction per order.
- Reservation and table management.
- Printable or emailed receipts.
- Time-of-day pricing for happy-hour specials.
- Multiple locations with per-location pricing.


---

## What we are assessing

A working application is table stakes. Almost every serious candidate will produce something that runs, has a login, and roughly does what was asked. That's the floor, not the differentiator.

What actually separates submissions is the record of thinking behind the app: the decisions you made and why, the trade-offs you weighed, what you built first and what you deliberately left out, and whether you can explain any part of your own system when asked. We are hiring for judgement. The app is the evidence for that judgement, not the deliverable in itself.

We also read the code itself for structure and readability, which counts for a small share of the overall score.

## Time budget

Budget about 12 hours total, spent roughly 2 hours a day across a week.

This is not a race. We are not timing you against other candidates, and submitting early scores nothing extra. Twelve hours is a size guide so you know how much to attempt — pace yourself, stop when you're tired, and spend some of that time thinking and documenting, not only typing code.

## Pick any stack you like

Use any language, any framework, any UI library, any ORM, and any database access approach you want. We have no house stack, and no stack scores better than another — this round is not a test of whether you know particular tools.

Use whatever you are fastest and most confident in. Time spent learning something new to impress us is time not spent on the ten goals above, and it will show.

## Using AI is allowed and encouraged

Use AI tools however you want — to scaffold code, debug a stuck problem, write tests, draft documentation, or anything else that helps you move faster. A few things to know about how we treat it:

- We do not penalise AI use, and we make no attempt to detect it.
- We care about whether you understood, directed and verified the output — not about who or what produced the first draft of it.
- `docs/ai-prompts.md` must contain the prompts you actually used, including the ones that produced bad output and what you changed afterwards. If you used no AI at all, say so here and describe how you worked instead — that is assessed the same way.
- Submitting generated code you cannot explain is the single most common way candidates fail this round.

You are accountable for everything in your submission. If a reviewer points at a piece of code and asks why it's there, or why it works the way it does, "the AI wrote it" is not an answer.

## Use git properly

Publish to a public GitHub repository, and commit incrementally as the work actually happens — after each meaningful step, not in one pass at the end.

A repository whose entire history is a single "initial commit" containing a finished app scores zero on git history, and it colours how we read everything else in your submission, however good the app itself is. Your history is how we see the order you built in, where you got stuck, and how the design changed along the way. If it isn't there, we can't assess it, and we won't assume the best.

## What you must commit

Alongside your code, commit these five files under `docs/`. Your zip includes a stub for each with the questions it needs to answer — fill them in as you go, not from memory at the end.

| File | What it must answer |
|------|----------------------|
| `docs/architecture.md` | What the moving pieces are, how they talk to each other, where each one runs, the request path for one representative user action end to end, and what you decided not to build. |
| `docs/schema.md` | Every table's columns and types, which relationships are one-to-many versus many-to-many, which constraints live in the database versus the application, what you deliberately denormalised, and what would break first at 100x the data. |
| `docs/plan.md` | How you split the work into sessions, what order you built in and why, what you estimated versus what it actually took, and what you cut when you ran short. |
| `docs/decisions.md` | At least five real decisions — what you chose, what you rejected, and why — including at least one you later reversed. |
| `docs/ai-prompts.md` | The prompts you actually used, in order, grouped by what you were trying to do, including at least one that produced something wrong and what you did about it. |

## Host it for free

Deploy the whole thing somewhere reachable by URL, using free tiers only.

One combination that works, if you would rather not decide:

- **Database** — a managed service such as Supabase.
- **Server-side code** — Render.
- **Browser-side code** — Vercel.

Deploy in that order: create the database first, give the server its connection details as environment variables, then point the browser-side part at the server's public URL.

This is one option, not a requirement. Any free host is equally acceptable — everything on a single provider, one virtual machine, a container platform, a static host with serverless functions. The choice earns and loses nothing.

Requirements:

- A working live URL.
- Seeded with enough demo data to show the system doing something, not an empty shell.
- Demo credentials for every role recorded in `SUBMISSION.md`.
- Connection strings, keys and passwords kept in environment variables, never in the repository.
- Free tiers often sleep when idle and can take a minute or more to wake. Note it in `SUBMISSION.md` if yours does, so a slow first load is not read as a broken deployment.
- If you cannot get it hosted, submit anyway and record in `SUBMISSION.md` what you tried and where it broke.

## How to submit

Send us:

- The URL of your public GitHub repository.
- The URL of your live, deployed application.
- Your completed `SUBMISSION.md`, committed to the repository.

That's the whole submission. Nothing else to prepare, no separate form.

## What happens next

If your submission clears the bar, we'll set up a short call. We will ask about specific decisions we can see in your repository and its history — why you modelled something a particular way, what a certain commit was fixing, what you'd change if you kept going.

We're telling you this now because it should change how carefully you document as you go. Write `docs/decisions.md` for a version of yourself who has to explain it three weeks from now.

## Scope

The 10 goals stated in this brief are the cutoff. Meet all 10, solidly, and you have a complete submission.

Stretch ideas are optional. They exist for candidates who finish the 10 with time left and want to keep building — they are never required, and they do not make up for a goal you didn't hit. Doing 8 goals well beats doing 10 goals badly. If time is short, finish fewer goals properly rather than leaving all ten half-done.
