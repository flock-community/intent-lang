# Design: effects on actions

Status: design (for v33 and later). Nothing here is built yet.

Most of what an app does can be taken back: a changed field, a new row. Some actions reach
outside and cannot be taken back just by changing state: charging a card, sending an email,
booking a table, posting to someone else's system. Real apps treat these with care:

- **who agrees** before it happens (the user confirms, or a standing permission covers it);
- **exactly once**: a retry after a lost answer must not charge twice;
- **what if it fails**: try again, how often, and what the user sees meanwhile;
- **undo**: the matching action that takes it back (cancel the booking, refund the charge).

Openouros does all four by hand (an action gate, standing permissions with bounds, an outbox
with idempotency keys, compensations, an emergency stop; `docs/reviews/openouros.md` G3). So
does almost every SaaS that touches money, mail or bookings. The rules are the same everywhere
and are easy to get subtly wrong. That makes them harness work plus reusable specs, and only a
little language.

## What the language says: the effect of an endpoint

An effect is a fact about an endpoint, so it goes on the contract, next to its answers:

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

- `effect local | shared | external`:
  - `local` changes only data of the one who calls (a draft, a preference);
  - `shared` changes data others see (a ticket everybody reads);
  - `external` reaches outside the system (money, mail, another company's service).
  Without `effect`, a GET is `local` and reads only; any other method is `shared`. That is a
  documented default (§9), never a guess.
- `undone by <endpoint> with …` names the endpoint that takes it back, with its arguments bound
  to this call's answer. Whether an effect can be undone is whether it has `undone by`. That keeps
  one way to say it, instead of a separate "reversible" word that could contradict it.

The checker verifies that the `undone by` endpoint exists in the same contract, that its
arguments are bound, and that the bindings read fields the answer has. An `external` effect
without `undone by` is allowed (an email cannot be unsent); it then always needs agreement
(below), and the checker says so once as a hint.

## What the harness does: `std.actions`

Like the key and CORS layers, the rules live in verified specs that apps use, not in each app.

**On the service side, `std.http.once` (a layer).** A request with an `idempotency-key` header
that the service has answered before gets the same answer again, and the endpoint is not run a
second time. The layer keeps the answered keys as stored state (v32), so it holds across a
restart. Its own examples prove: same key twice → one effect, same answer; different key → two
effects; a key reused with a different body → 422.

**On the calling side, in the runtime (for both targets).** Every call to an `external` or
`shared` endpoint gets an idempotency key (the app's name, the session, a counter: stable in
tests). When the answer is lost (no answer, or a 5xx), the call is sent again with the same key,
up to 3 times, with the waits in the runtime. After that, the app receives the call's `Failed`
answer as today. Apps write nothing for this.

**Agreement, on the calling side, `through std.actions` (a client layer).**

```
uses booking.api as booking {
  tested with "apps/api/booking-api.intent"
  through std.actions {
    agree = @permissions        # standing permissions, from the app's state
  }
}
```

An `external` call waits until it is agreed to: the app shows it as pending (the harness adds
`on pending booking.reserve` and `approve` / `reject` messages, like answers), or a standing
permission covers it. A permission is a record in the app's state:
`{ endpoint: "reserve", count: 3, per: 1w }`. The layer counts what ran under it. An emergency
stop is a param: while it is on, nothing external goes out, and pending calls stay pending.

**Undo.** A step `undo @reserve` (in a handler) calls the `undone by` endpoint with the bound
arguments, through the same outbox. An undo of something that was never done, or was already
undone, does nothing, and says so in the answer the app receives.

## How it is tested

The point of all this is behaviour when things go wrong, so the tests must be able to make
them go wrong:

- `steer booking lose 1` (an example step): the next answer from that provider is lost after the
  provider did the work. The outbox sends again with the same key, and `std.http.once` must
  answer without doing it twice. The example then sees one reservation, not two.
- `steer booking fail 2`: the next two calls answer 503.
- Random sessions steer too, now and then, so twin builds must agree on what happens after a
  loss, a failure and a retry.
- `always` sentences on the service's data state the rules directly: "no two @reservations have
  the same @idempotencyKey", "no @charge is refunded twice".
- A screen's example can say `see booking.reserve is pending`, `click approve on row 1`.

## Phases

1. **v33: effects on contracts.** `effect …` and `undone by …` in the grammar, checker, printer
   and source map; the generated call types carry them (as documentation for the LLM); the §9
   default. A hint when a screen calls an `external` endpoint without `through std.actions`.
2. **v34: exactly once.** `std.http.once` with its examples; idempotency keys and retries in
   `runtime/ts/calls.ts` (used by both targets); `steer … lose / fail` in examples and random
   sessions. Rebuild the ticket and desk APIs and screens with it.
3. **v35: agreement and undo.** `std.actions` as a client layer (pending calls, approve,
   reject, standing permissions with count and period, emergency stop); `undo @x`.
4. **Then:** openouros's six action scenarios (UC4) written as specs against these, as the
   held-out test: if they need faking, the design is not done.

## What stays out

- Sagas across several services, and distributed transactions. `undone by` is one step back,
  not a workflow engine.
- Which payment or mail provider is used. That is deployment, like an API's address.
- Retry timing in production (backoff, jitter). The runtime has one sensible default; tests
  only see "sent again", never the waits.
