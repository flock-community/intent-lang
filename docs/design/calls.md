# Design: a screen that calls an API through its contract

Status: done (v20). The reference is §4g of docs/LANGUAGE.md; the first app is apps/15-tickets-ui.intent.

## The spec

```
app HelpdeskUi
uses support.ticketsApi as tickets              # a client of the contract
  tested with "apps/api/tickets-api.intent"     # the provider the examples run against

on start
  - call tickets.listTickets

on answer tickets.listTickets
  - if its status is 200, set rows to its body
  - otherwise set problem to "Could not load tickets"

on click add
  - call tickets.createTicket with subject = {draft}, customer = "Web", priority = Normal

on answer tickets.createTicket
  - if its status is 201: clear draft and call tickets.listTickets
  - otherwise set problem to the error of its body
```

- `uses <contract> as <name>` makes the contract's types available and its endpoints callable
  as `<name>.<endpoint>`.
- `call` in a handler step sends a request. The answer arrives later as the event
  `on answer <name>.<endpoint>`, where "its status" and "its body" are the answer, typed per status
  by the contract.
- `on start` runs once when the app starts.

## Determinism and tests

- In tests, a call is answered right after the action that made it, before the next observation.
  Calls made in one step are answered in the order they were made. Answers that trigger new
  calls are answered in turn, until nothing is pending. The screen after a step is therefore the
  settled screen, the same in every build.
- The answers come from the **real provider**: the build of the app named in `tested with`, run
  in-process through its router and handlers. There are no mocks. UI examples become end-to-end
  examples, and random sessions exercise both sides.
- The provider is built (twin-verified and cached) before the screen. The screen's cache key
  includes the provider's spec.

## Harness

- The logic module returns calls next to the model: Elm `update : Msg -> Model -> ( Model, List Call )`,
  `init : ( Model, List Call )`; TypeScript `{ model, calls }`. Apps without `uses` keep the plain
  signatures.
- Generated per contract endpoint: a typed call constructor (`Spec.ticketsCreateTicket { … }`) and
  an answer message carrying the per-status response (`TicketsCreateTicketAnswered Response`), with
  JSON decoders and encoders for Elm.
- In the browser, the runtime performs calls with `fetch` against a base URL (the `api` query
  parameter, default the page's origin). In tests, the driver sends them to the provider's test
  client.
