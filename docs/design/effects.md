# Design: effects on actions

Status: design (for v33 and later). Nothing here is built yet. This design follows the
practice of people and systems that handle effects for a living (sources at the end); where it
departs from them, it says why.

Most of what an app does can be taken back: a changed field, a new row. Some actions reach
outside and cannot be taken back by changing state: charging a card, sending an email, booking
a table, posting to someone else's system. Mature systems handle four questions:

- **once:** a retry after a lost answer must not charge twice;
- **failure:** what is retried, how often, and what the user sees when the outcome is unknown;
- **undo:** the matching action that takes it back, which is a new action, not a rollback;
- **agreement:** who agrees before it happens (a person, or a standing permission).

Openouros does all four by hand (`docs/reviews/openouros.md` G3), and so does almost every
service that touches money, mail or bookings. The rules are the same everywhere and easy to get
subtly wrong, so they belong to the harness and to reusable specs. The language adds little.

The guarantee is **effectively once**: delivery at least once, and a receiver that recognises a
repeat. Nobody can promise "exactly once" across a network (Kleppmann, Helland), and the docs
never say it.

## What the language says

The effect is a fact about an endpoint, so it goes on the contract, next to its answers:

```
endpoint reserve POST "/reservations" {
  body classId: Int
  body day: Date
  answers 201 Reservation
  answers 409 Problem               # full
  effect external
  undone by cancelReservation with id = @reserve.body.id
}
```

- `effect external`: the endpoint reaches outside the system (money, mail, another company).
  It is the only effect word. Keys and retries follow from the HTTP method, not from a class
  (Stripe keys every POST), so a `local` / `shared` distinction would have no consequence, and
  a word with no consequence is one an author can get wrong for free.
- `undone by <endpoint> with …`: the endpoint that compensates, with its arguments bound to
  this call's answer. An `external` endpoint without `undone by` is a **pivot**, a point of no
  return (Azure Saga pattern). Having `undone by` is the only way to say it can be undone.
- Nobody annotates handlers or screens. What effects a handler can cause is **inferred** from
  the endpoints it calls (as Koka infers effect rows) and shown in the source map.

Checker:
- the `undone by` endpoint exists, its arguments are bound, and the bindings read fields the
  answer has;
- an `undone by` endpoint is not itself a pivot: a compensation must be able to finish
  (Garcia-Molina & Salem);
- a hint when a handler calls a pivot *before* an endpoint that can be undone: irreversible steps
  go last, after everything that can still fail (Azure Compensating Transaction).

## Once: `std.http.once` on the service

A layer, like the key and CORS layers, proven once by its own examples. It follows the IETF
Idempotency-Key draft (expired, not an RFC, but the common ground of Stripe, AWS and others):

- A request with a non-safe method and an `idempotency-key` header is remembered per **caller
  and key**: a fingerprint (method, path, body), whether it is still running or done, and the
  answer's status and body, with the time it was made.
- The same key again, done → the same answer again, marked `idempotent-replayed: true`, and the
  endpoint does not run. The answer is *semantically the same*, never "already exists" (AWS).
- The same key while the first is still running → 409. The same key with a different body →
  422. No key where the service requires one → 400.
- Keys expire after a documented time (24 hours, as Stripe).
- The key is recorded **together with the endpoint's own change** (both in the same stored-state
  update). A crash between "did it" and "wrote it down" must not be possible, or the retry does it
  again (Brandur Leach's atomic phases; Richardson's outbox).
- Only answers from an endpoint that ran are remembered. A request refused before it ran (a 400
  from validation, a 503 from overload) is not, so a retry runs normally (Stripe).

## Failure: the runtime on the calling side

One place retries, the runtime, used by both targets (Brooker: retry at one layer only):

- Every call with a non-safe method gets an idempotency key made **when the action is made**
  and kept in stored state (v32) with the pending call: a durable outbox. A double click, a page
  reload and a restart all reuse the key, and a pending call is sent again after a restart
  (Stripe, Restate, Brandur's completer).
- Retried: no answer, 5xx, 429, and 409-while-running. Never retried: other 4xx, because the
  request itself is wrong. At most 3 attempts (Google SRE), backoff with jitter in the browser and
  on the server (Brooker). Tests never see the waits; the test clock stands in (Temporal's time
  skipping).
- After the last attempt, an `external` call whose outcome is unknown (no answer, or 5xx)
  arrives as **`Unknown`**, not `Failed`: the effect may have happened (Stripe treats 500 as
  indeterminate). A screen then says "we don't know yet" instead of offering a fresh try, which
  would get a new key. The outbox keeps trying later with the same key.

## Undo

A step `undo @reserve` (in a handler) calls the `undone by` endpoint with the bound arguments,
through the same outbox:

- it has its own key and is retried until it succeeds; a compensation cannot give up
  (Garcia-Molina & Salem, McCaffrey), and when retries run out it becomes a task for a person,
  with the details (Azure);
- undoing something that never happened, or was already undone, does nothing and says so
  (Temporal: a compensation must cope with the forward step never having run);
- undo is semantic: a cancelled booking may refund less than was paid. That is the undo
  endpoint's own behaviour, proven by its own examples.

## Agreement: `through std.actions` on the calling side

```
uses booking.api as booking {
  tested with "apps/api/booking-api.intent"
  through std.actions {
    agree = @permissions        # standing permissions, from the app's stored state
  }
}
```

- An `external` call waits until it is agreed to. The app shows it as pending (the harness adds
  `on pending booking.reserve`), and the decisions are **approve, edit, reject** (LangGraph's
  human-in-the-loop; "respond" is a message to the requester and stays the app's own business).
- A standing permission covers calls without asking: `{ endpoint, count, per, upTo }`, a number
  of calls per period and, for money, a maximum amount (OpenAI rates financial impact
  separately). A grant is one-time or standing (Anthropic).
- Pending calls live in stored state, so a restart does not lose them (LangGraph's
  checkpointer).
- An emergency stop is a param: while on, nothing external goes out and pending calls stay
  pending. Four eyes (the approver is not the requester) is an optional param.

## How it is tested

Effects matter when things go wrong, so tests must make them go wrong, reproducibly from a seed
(FoundationDB, TigerBeetle's VOPR). Example steps, per provider:

```
steer booking lose request       # never arrived
steer booking lose answer        # done, but the answer is lost: the same as a timeout after success
steer booking duplicate          # arrives twice
steer booking slow               # a retry arrives while the first still runs (409)
steer booking fail 2             # the next two answer 503
steer booking restart after effect   # the service stops between doing it and answering
steer booking expire keys        # a late retry after the keys expired
```

- Random sessions draw these from their seed and report it, so every failure can be replayed.
- `always` sentences on the service state the rules directly: "no two @reservations have the
  same @idempotencyKey", "no @charge is refunded twice".
- A screen's example can `see booking.reserve is pending`, `click approve on row 1`, and see an
  `Unknown` outcome.

## Phases

1. **v33: effects on contracts.** `effect external` and `undone by …` in the grammar, checker,
   printer and source map (with inferred effects per handler); pivot-order hint; §9 defaults.
2. **v34: once.** `std.http.once` with its examples; keys, the durable outbox and retries in the
   runtime; the `Unknown` answer; `steer` faults in examples and random sessions. Rebuild the
   ticket and desk APIs and screens with it.
3. **v35: undo and agreement.** `undo @x`; `std.actions` (pending, approve / edit / reject,
   standing permissions with count, period and amount, emergency stop, four eyes).
4. **Then:** openouros's six action scenarios (UC4) as specs against these, as the held-out test.

## What stays out

- Sagas over several services and distributed transactions: `undone by` is one step back, not a
  workflow engine.
- Undo that only works for a while (`undone by X within 24h`): a `NOT_YET` candidate.
- Which payment or mail provider is used: deployment, like an API's address.

## Sources

- IETF, The Idempotency-Key HTTP Header Field (draft-07, expired):
  https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
- Stripe, idempotent requests and low-level errors: https://docs.stripe.com/api/idempotent_requests,
  https://docs.stripe.com/error-low-level
- Brandur Leach, Implementing Stripe-like idempotency keys: https://brandur.org/idempotency-keys
- AWS Builders' Library, Making retries safe with idempotent APIs:
  https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- Marc Brooker, Timeouts, retries and backoff with jitter:
  https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter
- Google SRE book, Handling overload: https://sre.google/sre-book/handling-overload/
- Chris Richardson, Transactional outbox: https://microservices.io/patterns/data/transactional-outbox.html
- Pat Helland, Idempotence is not a medical condition: https://queue.acm.org/detail.cfm?id=2187821
- Martin Kleppmann, Designing Data-Intensive Applications (2nd ed.), exactly-once revisited
- Garcia-Molina & Salem, Sagas (1987): https://dl.acm.org/doi/10.1145/38714.38742
- Caitie McCaffrey, Applying the Saga pattern (2015)
- Azure Architecture Center, Saga and Compensating Transaction patterns:
  https://learn.microsoft.com/en-us/azure/architecture/patterns/saga,
  https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
- Temporal, saga pattern, workflow definitions, retry policies, testing:
  https://docs.temporal.io/design-patterns/saga-pattern
- Restate, durable execution: https://docs.restate.dev/concepts/durable_execution
- Koka effect rows: https://arxiv.org/pdf/1406.2061; Unison abilities; Roc platforms
- OpenAI, A practical guide to building agents; Anthropic, framework for safe agents;
  LangGraph human-in-the-loop
- FoundationDB testing: https://apple.github.io/foundationdb/testing.html; TigerBeetle VOPR
