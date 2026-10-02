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

`screen.mjs` is an ES module bundled for no platform, in TypeScript and Elm builds alike. Its
default export is `{ meta, start }`. A host awaits `start(…)` and `send(…)`: an Elm build answers
through its worker's ports, asynchronously (a TypeScript build answers at once; awaiting it costs
nothing). The Elm worker is bundled with a scope and timers of its own (promise microtasks), so it
touches no global either.

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

## Jobs (`job-host.mjs`, `intent.job/1`)

Asked for by OurOS (request 4, the job half): a sandboxed job may not touch `globalThis`, but
`job.mjs` reads its transport from `__intentTransport`, keeps its stored state and outbox in
`localStorage`, mints keys with `crypto` and waits with timers, all from the moment it is imported.

**The choice: a second module, mirroring the screen host.** A job build also holds `job-host.mjs`,
bundled for no platform, default export `{ meta, start }`, on the same core as `screen.mjs` (the step
machine the examples run):

- `meta`: as a screen's, without `sizes` and `screens`: `contract` (`"intent.job/1"`), `name`,
  `clock`, `stored`, `draws`, `uses`.
- `start({ transport, clock?, saved?, seed? })`: `clock`, `saved` and `seed` as for a screen.
  `transport` has the shape of `__intentTransport` (calls.ts `Transport`); only `send` is used.
  Required when the job calls an api (an error otherwise).
- It returns `run({ event?, tick?, clock? })` and `stored()`. `run` hands the job an api event
  (`{ event: "alerts.alertRaised", body }`, wire names read back), a tick or a new clock, or nothing;
  it resolves with the job's data, as `job.mjs`'s `run` does, once every call it made, and every
  call their answers made, has been answered. `stored()` is a screen's.

Each call goes to `transport.send` once, as `job.mjs` sends it (the HTTP-shaped request after the
api's client layer, with `alias` and `endpoint`; an undo also carries `undo` and `of`), but without
an idempotency key: as for a screen, the host owns keys, retries, the outbox and approval. Answers are
fed back in the order of the calls, not of their arrival, so a run does not depend on timing; a
`send` that throws is an answer with status 0 (`no answer: …`). No timers: `run` awaits the
transport's promises.

**The alternative: a `start` on `job.mjs`, or `run({ event, transport, saved })` there.** One module
is simpler to name, but `job.mjs` starts at import: it reads `localStorage`, opens its event
streams through `__intentTransport` and keeps a timer. Making that lazy would change when an existing
host's job starts and hears events; leaving it eager means a sandboxed host cannot import the module
at all. A one-shot `run({ event, transport, saved })` that returns the data and the stored fields
would also differ from `job.mjs`'s `run`, which resolves with the data alone. A second module keeps
`job.mjs` exactly as it is and gives the job the screen's names and shapes (`start`, `saved`,
`stored()`, `meta`). Reversible: `job.mjs` could later be generated on top of `job-host.mjs`.

**Verified:** `tests/job-host.test.ts` builds `apps/30-urgent-watch.intent` with a stand-in app and
runs `job-host.mjs` where `__intentTransport`, `localStorage`, `crypto`, `fetch`, the timers and
`Math.random` throw on access: the exact requests sent through a fake transport, the data after each
run, a 400 answer and a failing transport, `stored()` and a start from `saved`; and `job.mjs` on the
global transport, unchanged.

## Not yet

- Answers carry no call id in `screen.mjs`: two calls to the same endpoint in flight are told apart
  only by order (`job-host.mjs` performs the calls itself, so it pairs them).
- A job host entry for Elm (jobs build on TypeScript only).
