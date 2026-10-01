# The screen host contract (`screen.mjs`, 1.1)

Asked for by OurOS (its decision 0070: intentlang builds OurOS; requests 1, 2 and 4): a host that
runs a built screen itself, in a sandbox, needs a promised module instead of bundling `app.ts` and
`spec.ts` itself, a store it owns instead of `localStorage`, and no globals (`__intentTransport`,
`__intentSize`, `crypto`, `location`, `document`, `fetch`).

## The idea

The example driver already runs every screen build headless: the test entry is a synchronous step
machine that takes the clock, user events, answers and api events as data and hands back the screen,
the calls and the data. Every example and random session of every build runs through it. The host
entry is that same code, promised: `screen-core.ts` is generated once, `test-entry.ts` is the guards
(`norandom.ts`) plus a re-export of it, and `screen-entry.ts` wraps it for a host. What the examples
verify is what ships.

## The contract (`intent.screen/1`)

`screen.mjs` is an ES module bundled for no platform. Its default export is `{ meta, start }`.

- `meta`: `contract` (`"intent.screen/1"`), `name`, `clock` (`{ tickMs }`, or `null` when the app reads
  no clock), `sizes` (or `null`), `stored` (the stored field names), `draws` (whether it draws random
  values), `screens` (`[{ name, path }]`, or `null`), and `uses` (per api: alias, contract, the
  endpoints and events this app uses).
- `start({ clock?, size?, saved?, seed? })`:
  - `clock` `{ now: "YYYY-MM-DDTHH:MM", today: "YYYY-MM-DD" }`, required when `meta.clock`.
  - `size`, one of `meta.sizes` in any case; default the first.
  - `saved`, what `stored()` gave last time. It is migrated to this version's types (§3 of the
    reference), put back before `on start` runs, and the app starts once.
  - `seed`, 64 hex digits from the host's CSPRNG, required when `meta.draws` (an error otherwise,
    never a fixed fallback). Each event draws from `HMAC(sha256(seed), "event|n")`.
- It returns, on every app:
  - `observe()`: the screen as a node tree (`ui.ts` `Node`; `data-el` names; rows with their keys).
  - `send(wire)`: a user event (`click`, `input`, `toggle`, `choose` with `target`, `key`, `keys`,
    `text`, `value`), `navigate`, an answer (`{ on: "answer", target, answer: { endpoint, status,
    body } }`), an api event (`{ on: "event", target: "alias.event", event: { event, body } }`), a
    `tick`, `{ on: "size", value }`, or any wire with a new `clock`.
  - `calls()`: the calls made since last asked, in order: `{ endpoint, args, config?, undo?, of? }`.
    The host performs them: keys, retries, client layers (`config` is what the layer gets from the
    state), approval, transport. It sends each answer back.
  - `stored()`: the stored fields, for the host to keep.
  - `nav()`: the address the app asked for (`go to`), `"back"`, or `null`.
  - `through()`: what the client layers get from the state, per api.

The module touches no platform global: no `fetch`, `crypto`, `localStorage`, `document`, `window`,
`location`, timers or `Math.random`. It needs ECMAScript and the two platform-neutral built-ins
`TextEncoder` and `structuredClone` (both in every browser, worker, Node and Deno). App code is held
to that statically (`compiler/draws.ts`, `ownRandomness`: the platform is refused like randomness).

## What the host owns

Transport, idempotency keys and undo keys, retries, the outbox, the `std.actions` agreement (held
and rejected answers), timers (a tick every `meta.clock.tickMs`; a new clock as time passes), the
event streams, and where stored data lives. Answers are matched to the app by endpoint, as in the
browser entry.

## Verified

- `tests/screen-host.test.ts`: a build with a stand-in app, run where every platform global throws:
  `meta`, the clock requirement, the size at start and from the host, the neutral methods.
- Real builds (twin-verified app code, harness regenerated, run with every platform global guarded):
  Habits (stored data round trip, no calls made twice), Table (seed required; the same seed gives the
  same run, another seed another), Weather (api events, no calls), Sized (sizes).

## Not yet

- The Elm target has no `screen.mjs` yet: its headless worker is driven through an adapter inside the
  compiler (`openElm`), asynchronously. A host uses a TypeScript build.
- Jobs keep `job.mjs`, which still takes the transport from `__intentTransport`.
- Answers carry no call id: two calls to the same endpoint in flight are told apart only by order.
