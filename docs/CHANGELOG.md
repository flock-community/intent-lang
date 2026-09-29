# Intent — changelog and next candidates

How the language grew, version by version, and what may come next. The reference
(`docs/LANGUAGE.md`) says only what the language is: it is the compiler's prompt, so its history
and this repository's files stay here.

## Next candidates

When a spec needs something the language cannot say yet, the checker reports `NOT_YET`. That is
a candidate for a later version, not a rule. Each should serve many apps, not one. Since language 1
(docs/STABILITY.md), a candidate that only adds (a new form, a lifted `NOT_YET`) is a candidate for
a `1.x` release; one that would change what a checked spec means waits for an edition, `language 2`.
The candidates, for 1.x unless marked:

- a third level of rows, and trees (a record that holds a list of its own kind: comment threads),
  with a tree or treegrid presentation (ARIA tree; expand and collapse);
- `row state` for view-only fields of a row (a per-row draft that is not stored with the row);
- a reference to a row inside a row (it needs both keys: a path type, or a globally unique key);
- reverse navigation (`@ticket's @comments`): `the @comments whose @ticket is @id` says it now;
- `for each` over a chain (`for each @tag in @ticket's @tags`), and a `List T or nothing` type (it
  reads as a list of `T or nothing`);
- `clock` in styled apps;
- restyling a bundle component's elements from the app;
- type parameters and slots, so a component can render the app's own rows;
- a checker warning for templates whose hole can be empty (`"{date} · {location}"` showing ` · `);
- liveness over changes ("a pending expense is eventually decided"): it needs fairness and
  unbounded runs, which random bounded sessions cannot check honestly;
- `…, unless it is removed` on a frozen row, if specs ask for a row rule that allows removal;
- random sessions that try every way to touch a frozen row also through fields in rows whose key is
  not the record's key (the poke matches a row on screen by its key);
- UUIDs and ULIDs as types (an opaque id is `Text of 22 letters and digits` now); weighted choices
  (`choice Prize: Car 1 | Nothing 99`) and other distributions; `secret` types (constant-time
  comparison, kept out of logs); an attempt limit as a layer (`std.http.limit`), the honest answer to
  `GUESSABLE`; a draw in a loop inside a loop; `Int` ranges above 2^32 values;
- explicit layout sizes (`look` is still words; a closed size vocabulary next to them is 1.x,
  replacing them would be `language 2`);
- a terminal target: a second renderer of the same screens (sizes are the first step), and Kotlin
  as a second target for apis (a target is a module and must pass the same examples, STABILITY.md §7);
- from held-out round 4 (runs/r1-held-out-4/report.md), each a 1.x addition: a rule for some roles
  only (G8: a deadline for patients, not the desk: `no one may call @cancel when … unless the caller is
  a @Desk`, which needs `@now` in a condition and an exception by role in the access plan); viewport
  breakpoints for `sizes` (G9: `sizes Compact below 640px | Standard`, the host's choice now); next in
  turn, wrapping (G10: `the one after @x in @xs, from the first after the last`); a date input (a
  `field` that edits a `Date`, read with `Fmt.parseDate`); `enabled when` on a checkbox (the harness's
  checkbox has no disabled state yet, on either target); comparing a `ref` with the caller (a `ref
  Person` whose key is the key layer's owner); frozen but deletable (`…, unless it is removed`, below);
  grants with several roles per person (G11: `roles: List Role` in one grant). An alphabet without
  0/O/1/I/L is already `Text of 6 from "23456789ABCDEFGHJKMNPQRSTUVWXYZ"`;
- access beyond v70 (`docs/design/v1-access.md`, "Not in v1"): field-level access (which fields of an
  answer a caller may see or change), lists filtered by access, role hierarchies, a server-side hold
  until approved, tenants and bearer tokens (a token layer that `provides caller`), `@now` in a
  condition, a `hidden` rule that answers 404 instead of 403, a per-endpoint `audited` line for
  sensitive reads, a generated `GET /access` a screen asks what its user may do, `override access` in
  a refinement, and a screen that uses an api both `through std.actions` and `through
  std.http.sendKey` (one `through` per `uses` so far).

## Changelog

Versions v1–v73 are the development history before the first stable version: specs said
`language vNN`, and any version could change what a spec meant. From language 1 on, versions are
`1`, `1.1`, `1.2`, … (additions only) and editions (`language 2`); docs/STABILITY.md is the promise.

- 1 — the first stable version (stamped on v73's language). **What language 1 is:** a spec says
  what an app must be — its records, choices and refined types (`ref` references with declared
  keys, `T or nothing` with nothing-safety, random values drawn from types), its state (`stored`
  state survives a restart), derived values, one or several screens with elements and
  presentations, handlers written as structured steps (`if`/`else`, `for each`, `answer`,
  `stop`) with English only in the leaves, `always` rules (checks, sentences over the data, and
  rules over changes), access rules, and examples that prove it. The same language describes
  services (`profile api`: endpoints, events, contracts with declared effects, layers such as
  CORS and API keys, access with default deny and an audit), jobs (`profile job`), bundles that
  carry their own examples and rules, and refinement of a published app (`extends` with named
  overrides). §9 of the reference gives a default wherever a spec is silent. What a `language 1`
  spec means, the harness contracts (`data-el`, `sourcemap.json`, `manifest.json`, `job.mjs`, the
  wire, the audit, stored data) and the compiler's error codes stay the same across 1.x.
  **What this round changed:** the version line is `language 1` (later `language 1.2`, or
  `language 2` for an edition), with no `v`; it is the lowest version the spec needs, and a newer
  one than the compiler's is an error (`NEWER_LANGUAGE`). A spec without the line means `language
  1` (v71 read it as "the current language"). A pre-1 `language vNN` reads as `language 1`, with a
  `LANGUAGE` warning that `intent fix` rewrites. Every version-conditional rule collapses to its
  language 1 behaviour: an api with a key layer and no `access` block is a `NO_ACCESS` error
  whatever its line says (std.quality's `NO_ACCESS` hint for older specs is gone). The reference's
  header is `language reference (1)` and intent.lock pins `@language 1 sha256:…`. A changed
  `@model` in intent.lock stays a `LOCK` warning for `intent check`, and `intent build` and
  `intent converge` refuse until `intent lock` (tests/cli.test.ts). `intent publish` refuses a
  spec without a `language` line. A bundle's computed version now also counts every record field's
  type (not only a contract's), each choice value's wire name, the bundle's `always` and change
  rules (a component's too), and a contract's events: removing or changing one is a major
  version (compiler/registry.ts `apiOf`, tests/registry.test.ts). An `answer` message is a
  template like any other: `answer 409 "Already taken by {that ticket's @assignee}"` is a
  `NOTHING` error when the hole can be nothing (tests/checker/holes.intent,
  tests/checker/holes-screen.intent); it found one in apps/api/desk-api.intent, which now says
  `{that ticket's @assignee, or "someone" when there is none}` (the same answer, since the
  condition asks for an assignee). Every spec in apps/, lib/ and the checker, harness and ambiguity
  fixtures says `language 1`; tests/fix/ keeps its inputs as they are (they test the migration).
  runs/openouros stays at `language v21`: it is the v21 snapshot the OurOS review
  (docs/reviews/openouros.md) was written from, and after `intent fix` it still has ten errors that
  need judgement (docs/STABILITY.md §4 lists them), so it is history, not part of the
  compatibility suite. docs/STABILITY.md is final; docs/TOOLS.md, the skill, README.md, AGENTS.md,
  docs/PLAN.md and docs/GUIDE.md say `language 1`.
  **From held-out round 4** (runs/r1-held-out-4/report.md: three independent authors wrote a chores
  app, a clinic booking app and a to-do list from the reference alone; codes H/K/R/G are the
  report's). *Harness:* a screen's examples run against a provider that draws and reads the clock
  (H1, G5): every request the driver sends a provider carries the example's clock (the screen's, or
  the provider's `examples start at` when the screen reads none) and the provider's own draws,
  seeded from the example's name and the alias; `steer random T` in a screen's example goes to the
  provider when only the provider draws a T (a type both draw is a `STEP` error), a steered value
  the provider never draws fails the example, random sessions write the provider's draws down, and
  a screen's `wait` moves the provider's clock and runs its recurring work (compiler/exec.ts,
  compiler/drawer.ts `routed`; tests/provider-draws.test.ts, with the new pair apps/38-raffle.intent
  and apps/api/raffle-api.intent over lib/raffle/raffleApi.intent). The incremental store is keyed
  by the spec file, not the app's name (two specs named `app Todo` shared one), and a build logs
  why it reuses nothing (H2; compiler/incremental.ts, tests/units.test.ts). Elm and TypeScript word
  an answer that does not fit the contract the same way: "<endpoint> answered <status>, but the body
  does not fit the contract", also for a body where the contract declares none
  (tests/answers-parity.test.ts). `intent converge`'s cost column includes the twin builds of an
  app's providers and of its service and client layers, each counted once per run
  (compiler/twin.ts `buildDeps`, compiler/converge.ts). *Where a contract lives* (G1, G2, K4): like
  a bundle, in `lib/<area>/<name>.intent`, named and never given as a path, locked, and never
  imported (its names come with `uses` / `implements`); the errors say so exactly (`implements
  "./x.intent"`, `uses "lib/…"`, `uses x` without `as`, importing a contract, a contract not
  found). The authors' chores and clinic contracts moved to lib/home/choresApi.intent and
  lib/clinic/bookingsApi.intent (content unchanged), and every apps/held-out-4 file checks clean in
  the repository (tests/heldout4.test.ts). *Checker:* the hint for `its @due exists` on a `T or
  nothing` names the form that works, `there is a @due` (K1); a click on a button that is disabled at
  that step is a `STEP` error wherever the checker can tell (K2, R1: §4 and §9.6 now agree that an
  example may not click it; compiler/disabled.ts); no `ACCESS` cascade from a provider with errors
  (K3); `GUESSABLE` for a drawn code a contract takes back as input (K5); `UNSTEERED` only for a
  value the example drew, never a seeded one (K6); `UNENFORCED` reads `only the @owner … may` (K7);
  `the minutes between @now and that booking's @start is below 1440` compares the minutes (K8);
  `used to be`, `the previous @x` and `was` on an unmarked field outside `always` are `CHANGE`, and
  an order on a `T or nothing` row field in a filter is `NOTHING` (K9; apps/held-out-4/todo.intent
  says `whose … there is a @due and @due is before @today`). *Language:* an order is typed, `<list>
  sorted by @due, earliest first, then by @id` (G3; §2, §9.19: a stable sort, nothing last, text by
  character codes), sorted by the harness (`Fmt.sortBy`, the same on both targets,
  tests/fmt-parity); `, highest @id first` and `, @name from A to Z` are `SPELLING` that `intent fix`
  rewrites (it rewrote apps/api/{desk,expenses,payouts,tickets}-api, held-out-3/approvals and
  held-out-4/clinic-api). `for each` is a step of an endpoint too, also over a row's inner list (G4).
  Time is typed in words (G6, §3b): `N minutes / hours / days / weeks after (before) A`, `the minutes
  / hours between two moments` (whole, toward zero: `Fmt.hoursBetween`), `the days between two
  days`; months and years are not units. A new id comes from a counter in state (G14, §5: `@id =
  @nextId`, `increase @nextId by 1`); std.quality's new `REUSED_KEY` warns where `the highest @id + 1`
  hands out a removed row's id while something keeps ids (apps/held-out-4/todo.intent, which has an
  undo, now counts). `any caller with a role may call …` is a permit (G11). Alternatives without
  `otherwise` must name every value of one choice (`TYPE`), and a choice value named like a refined
  type is `DUPLICATE` (G12, G13). Documented (G7, G12, G13): the key layer's 401 messages and the
  other std layers' answers (§4j), the std library's params (TOOLS §7), where `language 1` goes after
  a header with a purpose, one namespace for types and choice values, a `ref` param in the body
  (`body slotId: ref Slot`, then "that slot"), refined path params, `there is a booking in @xs whose
  …` naming "that booking", an inner row reading `that task's @f`, `ref X or nothing`, plain lists in
  table cells, `answers 200 List T`, `every endpoint answers 401 Problem` in an api without a
  contract. The skill's interview covers apis, roles, deadlines and generated codes, says which edge
  cases the interviewer decides and which it asks, and points at no file of this repository (G15,
  G16). *Found by the builds after these fixes:* the harness ran `init` (the spec's `on start`)
  before it put the stored fields back, on both targets and in the browser, so the chores screen's
  `on start { if @apiKey is blank { stop } … }` saw the default after a restart and loaded nothing.
  Now the rule is stated (§4 Stored state, `on start` in §4i and §5, §9.20: stored fields are
  restored before `on start` runs; `on start` sees what the app remembered) and the harness owns
  the order: in an app with stored fields and `on start`, `on start` is the message `Started`, not
  `init` (which is the app from its defaults); every entry (the Elm browser entry and test worker,
  the TypeScript browser entry and test entry, with several screens too, the job entry, the styled
  entries) starts with `init`, puts the stored fields back and then sends `Started`, whose calls go
  out after `init`'s. The driver's restart check reads the data right after the restore (the test
  entries' `restored`), since `on start` may change a stored field. An api has no `on start`
  (`NOT_YET`; it was accepted and ignored). Apps without both are unchanged
  (tests/start.test.ts: stand-ins on both targets, the drivers and a real browser).

- v73: the language review's round before the v1 freeze: one spelling per form, and two meanings
  made exact. Every old spelling still reads, as a `SPELLING` warning that `intent fix` rewrites
  (a generic rewrite: a diagnostic worded "`A` is written `B` … (`intent fix` rewrites it)"), and
  every spec in apps/, lib/ and the test fixtures (not the deliberate `# expect:` lines) was
  migrated with it, by hand where it reported a judgement.
  **Nothing.** Asking is only `there is a @x` / `there is no @x` (`@x is set`, `@x is not nothing`,
  `@x is nothing` are spellings); `nothing` is only a value (`set @x to nothing`, `from nothing to
  @A`, `= nothing` in examples); the fallback is only `…, or B when there is none` (`A (B when there
  are none)` and `, or B when there is no @x` are spellings; `(none when there is no @x)` on a list
  is dropped: the list is empty anyway). A cast from `visible when` reaches values shown inside the
  element, never the handlers of its buttons. `Maybe T` and `@newToken` left the reference (`intent
  fix` still rewrites them). **Nothing on the wire:** a `T or nothing` is always written as `null`,
  never left out; on input `null` and a missing key are both nothing; for a `T`, a missing key is
  "is required" and `null` "must be <type>" — the TS runtime (api input and output, calls, the
  typed client) and the Elm decoders (`jsonOptional`: a wrongly typed value is no longer read as
  `Nothing`) do exactly that. `see x.body.f = nothing` is allowed in examples; `is absent` is for
  headers, events and paths outside the declared type, and on a declared field a `STEP` error that
  `intent fix` rewrites. **Access and nothing:** in an access condition a value that is nothing (a
  `T or nothing` field, an absent param, a hop to a gone row, a request without a key) makes the
  condition undecided — a permit does not hold, a forbid does — the one place Kotlin's `==` does
  not apply, so `is not the @caller` on an unassigned ticket refuses; an order on a `T or nothing`
  in a condition is `NOTHING`; the missing-root 404 exception stays. support.tickets' `assignee` is a
  `Text or nothing` now (desk-api proves the unassigned case). **The endpoint's row:** `path id: ref
  Ticket`, then `if that ticket does not exist { answer 404 "…" }`, and "that ticket" is the row
  (a smart cast, as in access rules; a read before asking is `NOTHING`); `if no ticket has that
  @id` is the spelling, and the tickets and payments contracts take `ref` params. **Loops:** `for
  each @notice in @notices whose @expiresAt is …`, and `@notice's @expiresAt` inside (`where` and
  `.` are spellings). **Other spellings:** `answers <status> <Type>` everywhere (`returns T` is
  rewritten to one `answers` line per status the endpoint answers, 401/403 included where access
  can refuse); a server's layers are `layer auth = std.http.apiKey { … }` (`use` stays for
  components and `intent.project`, `uses` for clients); `the error` and `its body's @f` (not `the
  error in its body`, `the @f in its body`); `that ticket's @status is @Archived` in access;
  `anyone, without a key, may call`; `sizes Compact | Standard` and `size Standard`; `14 days
  after @today` (not `@today + 14`). **Selects without a sentinel:** `select x from list.f` edits a
  `Text or nothing` (nothing: none chosen; `clear @x` / `set @x to nothing` un-picks); the
  harness's `Pick.selected` is optional on both targets; a select that always has a choice may keep
  a `Text` with a default of its own. **Derived draws** are drawn once per event (request, click,
  tick, recurring run) and keep that value for the whole event, also after what they exclude
  changed; the harness keeps the value (`drawsFrom`), never the build. **Names:** the reserved set
  is Intent's own words (`key`, `nothing`, `true`, `false`, `random`, the type words); the harness
  mangles an identifier that is a target's keyword or a generated name (`type_`, `Model_`), and
  tests/harness/compile.ts builds and runs specs with fields `type`, `in`, `of`, `new`, `class`,
  `when`, `fun`, `val`, `object`, `is`, `as` and records `Model`, `Msg`. Qualified declared names
  (`pager.page: Int = 1`) read only in an expanded spec (its first line says so); an author gets a
  `SYNTAX` error. A change rule through a reference is `CHANGE` (write it on the record it belongs
  to); `COLLISION` for a key unique within its row suggests `not among that task's @items's @code`.
  **The reference** is renumbered in order (§4a…§4j); tooling moved out of the compiler's prompt
  into docs/TOOLS.md (commands, locking, projects and the registry, `intent fix`, settings and
  `INTENT_*` variables, the checker's code tables — tests/diagnostics.test.ts reads them there);
  rules stated twice are stated once (§9 keeps the default and a pointer); §8 and §9 say behaviour,
  not helper names; row counts moved to the example steps; every `app` example has its purpose;
  one step per line. Its examples are checked: a block tagged `intent-excerpt` must use the
  language's syntax and one spelling (tests/docs/snippets.ts, 41 excerpts, and docs/TOOLS.md
  too). A new §5 idiom says which phrase names which row ("the ticket", "the new ticket", "that
  ticket"). The prompt: LANGUAGE.md from 120,496 to 106,045 bytes (docs/TOOLS.md: 23,991).

- v72: robustness. No language change: the reference stays at v71. Offline soundness tests (a fuzz
  driver over mutated and generated specs, and `intent fix` on six old snapshots of this repository
  and on openouros) found the checker, `intent fix`, the printer and the command line wrong in ways
  that a v73 of many `intent fix` rewrites could not rest on. The checker: a key that is a reference
  (`key id: ref Item`, or two records whose keys refer to each other) is a `TYPE` error, where it
  recursed until the stack ran out. A step of many parts (`clear @a and clear @a and …`) is split in
  one pass (1,000 parts took 75 s: cubic), and so are alternatives (`A when C; B when D; …`) and sums
  (`1 plus 1 plus …`, which also overflowed the stack); a condition of more than 100 joined parts is
  left untyped (`LONG_SENTENCE` already asks to name its parts); a line with a `SYNTAX` error is not
  typed; where an example's click goes is worked out once per button. Each mistake is said once: a
  choice value listed three times, a key type that several references meet, an undeclared name used
  twice on a line (a value and its `visible when` count as one line), `that task` twice in a step, a
  reserved word in a job's state (also its screen), a table column named twice, empty choice values and
  call arguments (said as empty); an inner row's unknown field names its item (`items of row 1, item
  2`); a second `answers 201` in one endpoint is a `DUPLICATE`; `on event tickets` / `on answer
  tickets` without the event or endpoint is a `SYNTAX` error (it said "no event `undefined`"), and a
  design line `constructor: x` is an unknown setting (it crashed the checker). A platform without a `function` says so
  instead of `see undefined = …`; the `UNMARKED` hint no longer takes `read as a whole number` or
  `is a number` for a name `number`. A declaration identical to the one an import brings (same fields,
  same values) is that declaration, not a clash. `intent fix`: only references get their `@` (never
  the name a line declares, `text total = total as money`); a word that is also the endpoint's request
  param (`whose id is id` with `path id`), is in its sentence twice, or follows `that`/`something` is
  reported (`needs you — …`), never guessed; fixes are tried per kind, then one by one until none is
  left to keep, and each is kept only when it adds no error, compared as (file, line, code), so a fix
  that trades one error for another is refused and said (`not fixed — …: it would add …`); the
  `language vN` line is written unless it breaks the syntax, and what the newer language makes an
  error (`NO_ACCESS` from v70) is reported as the author's; it lists every error left (with the lock)
  and says when to run `intent lock`; `language` goes after the header, also in the old indentation
  syntax; a second run changes nothing. `intent expand` reads back clean for every spec in apps/ and
  lib/: an endpoint's `answers` (an app's and a contract's) are printed, a contract's endpoints have no
  steps and no components, a platform's `function`s and an app's `import` of a platform are printed, a
  client's endpoints are notes under `uses`, `only` is printed, an empty label stays (`button add ""`),
  and a component's qualified names (`pager.page: Int = 1`, `button pager.next`) read back.
  The command line: a missing file or a directory is one line on stderr for every command, never a
  stack; `intent expand` writes only the spec to stdout (its report to stderr). A clean checkout: a
  service's generated tsconfig.json no longer holds this machine's path (Node's types are named on
  tsc's command line), nor does a styled build's; the README says what a fresh machine needs
  (`npx playwright install chromium`, Elm's packages on the first build), and `intent doctor` checks
  Chromium and Elm's packages. New tests: tests/mutants.test.ts (mutants of every spec, a fixed seed:
  no throw, nothing said twice, no `undefined`, every line exists), tests/perf.test.ts, tests/cli.test.ts,
  checker specs (`keyref`, `once`, `platform-empty`, `handlers`), the expanded form of every spec in
  tests/print.test.ts, and `intent fix`'s cases and idempotence in tests/fix.test.ts. The harness
  snapshot changed only where the printed spec changed (the prompts of 17 specs that have endpoints,
  clients or platforms) and in the services' tsconfig.json.
- v71: security and verification fixes, from an independent review of the compiler, the harness and
  the runtime. No new syntax. Access: a refinement's `access` rules are checked rule by rule on their
  own lines (they were skipped, as the merged block kept the base's line), and the checker and the
  plan share one compile step, so a condition the plan cannot enforce is an error instead of being
  dropped (a wider permit); a `hear` rule reading the payload is compiled per event. An api without a
  `language` line is read as the current language (`NO_ACCESS` is an error there);
  `apps/held-out-3/lockers-api.intent` and `apps/api/members-api.intent` got access blocks. The key
  layer's 401s are audited (no caller, no key). A permit that held only because the request's row was
  missing no longer lets a 2xx on that row through. An open event stream passes the layers again before
  every event (a revoked key's stream closes), with or without an access block. The server's plan no
  longer carries the test keys. Generated code: spec text in a comment goes through one escaper (`*/`,
  `-}`, `{-`, line breaks), Elm strings use Elm's escapes, the page title is HTML-escaped, and a path
  (an endpoint's, a screen's) is `/` with letters, digits, `. _ ~ - /` and `{x}` holes (`SYNTAX`).
  The browser takes an api's address from the page's `<meta name="intent-api">`, never from its URL
  (`?api=` sent calls, and their keys, wherever a link said). Once: keys are stored per `[caller, key]`
  (no caller can spell another's), an anonymous key is kept only with 128 bits (32 hex digits), new keys
  are 128 bits from `crypto.getRandomValues` (never `Date.now`/`Math.random`), an undo's key is
  `undo-` and a SHA-256 hex digest naming the call it takes back (header-safe, fixed length), and a
  clock with seconds no longer keeps keys forever. Chance: `random`/`shuffled` outside the five forms
  is `RANDOM` (`a random number from 1 to 6` was read as English), `@deck shuffled.` and `a random one
  of the @deck` are the forms they look like, `@key is <draw>` is `COLLISION` too; a build may import
  only the generated interface and the harness's helpers (TypeScript: `./spec.ts`, `./fmt.ts`,
  `./api.ts`; Elm: `Spec`, `Fmt`, elm/core's pure modules), no spelling of `Math.random`, `crypto`,
  `performance`, `Date.now` gets through a string-aware reading, and in tests `Math.random` and Web
  Crypto throw; draws never fall back to a fixed seed (the server refuses, an Elm page draws nothing
  without one, styled pages of apps that draw are not built yet). Change rules: a rule on a record's
  key is `CHANGE` (rows are matched by key, so it could never fail); `the @x never goes down` is the
  named form. Verification: a session a build crashed on is a disagreement, also when every build
  crashed, and a build that crashes on most sessions fails; a hunt whose sessions crashed or could not
  run is a failure, not a clean hunt; `see every` in an example fails on a missing list or field; a
  number with a `,` on screen is refused, not read as a decimal; a raw `request` step is checked like
  a call (contract, refusals, `always`); a mutant is caught only by an example that was green. The
  build cache is keyed on the harness's import closure, the runtime, the standard library, the tool
  versions and the verification depth (sessions, length, repairs), runs the examples again on a hit,
  and several processes share it safely (a lock per key, directories that appear whole); the
  invariants cache is keyed on its prompt and Fmt too. The server refuses a body over 1 MiB (413,
  `INTENT_MAX_BODY`). The TypeScript and Elm code readers and steered picks share one test table.
- v70: access control (`docs/design/v1-access.md`, the last v1 feature). An api's `access` block says
  who may call which endpoint and hear which event, and the harness enforces it on the server before
  the endpoint runs, with default deny once a spec has the block. Permits: `anyone may call …` (no
  key; the harness binds the key layer's `public` from these rules, and binding `public` by hand next
  to the block is `ACCESS`), `any caller may call …`, `a @Role may call …` (`a @Clerk, an @Approver or
  a @Lead`), `… may call every endpoint`; forbids: `no one may call … when …`, which win over permits;
  `may hear @event` / `every event` for events, filtered per stream on `GET /events`. Roles are a
  `choice`, and who holds them is data: `roles = grants`, a state list with `who: Text` and one choice
  field, read on every request (a revoked role counts from the next request, also before a remembered
  idempotent answer is replayed). Conditions are typed whole, never judgement: a field of the row is
  (not) the caller (through references too: `that ticket's @project's @owner`), the caller is (not)
  in a list field of the row, the row is (not) a choice value, a param against a literal or a state
  field, a field of an event's payload is the caller; joined with `and`. "That ticket" is the row a
  `ref` param names (`path id: ref Ticket`; the wire keeps the key). A missing row has nothing to
  protect (its row conditions do not refuse); a condition that cannot be decided (a reference whose
  row is gone, an absent param) makes a permit not hold and a forbid hold (ASVS 4.1.5, departing from
  Cedar); an anonymous caller equals nothing. Refusals: `403 {"error": …}` with the deciding rule's
  message (a forbid's, or a covering permit's whose condition failed), `"Not allowed"` otherwise; the
  key layer's 401 where a key is needed. The harness: the block compiles to a plan (`accessPlan.ts` in
  the build, `access.json` for the drivers) that one reviewed decision reads (`runtime/ts/access.ts`,
  the order: layers, route and input, access, remembered answer, endpoint); the handler never runs for
  a refused request, and every test checks that a refusal changed no data and published nothing (a
  built-in rule); an audit of every refusal and every permitted non-safe request (`at`, `caller`,
  `endpoint`, `decision`, `rules` as file:line, `status`, the idempotency key; never a secret), kept
  outside the app's state, appended to `INTENT_AUDIT` on the server; `x-intent-source` names the
  deciding rule or the block's default denial; `sourcemap.json` lists each rule with what it covers,
  each endpoint's and event's rules, and a screen handler's provider rules per call. Examples: `call x
  as "Ann" with …` (the key layer's new `acts as` line says how), also another client's call in a
  screen's example, and `see audit has 2 rows` / `see audit[1].caller = "Ann"`. Random api sessions
  call as every example caller, every key's owner and anonymously, and twin builds compare the
  audit. `intent mutate <api> --build <dir> [--screen <spec>=<dir>]` drops each rule (and each
  condition) and reports the mutants no example catches, on existing builds, no LLM calls. Checker:
  `ACCESS` (a block in a screen, job, contract or bundle; no layer, or two, provides `caller`; bad
  grants; a role without `roles =`; a condition outside the forms; a forbid without a condition;
  `anyone` with a condition; `public` bound by hand; `as "Zed"` with no key), `UNGRANTED` (warning:
  nothing permits an endpoint or event), and the existing `UNKNOWN_NAME`, `TYPE`, `NO_ROW`, `HOME`
  and `CONTRACT` (a restricted endpoint must declare 403, and 401 where a key is needed). std.quality:
  `NO_ACCESS` (a key layer and no block; an error for specs that declare `language v70`),
  `HAND_ACCESS` (a 401/403 on a condition about the caller next to a block), `ACCESS_UNPROVEN` (a
  rule no example proves both ways), `UNENFORCED` (a screen-only app that promises who may do what;
  `apps/held-out-3/approvals.intent` gets it, unedited). Apps: `apps/api/desk-api.intent` migrated (its
  hand-written 403 is now a rule; Eve holds a key and no role; a lead solves any ticket), with
  `lib/support/deskApi.intent` taking `ref Ticket` params and declaring 403; `apps/api/payments-api.intent`
  behind keys (anyone pays; the shop refunds; the till looks up and sends receipts), so
  `apps/18-checkout.intent` gives refunds with a staff key through `std.http.sendKey`; new
  `apps/api/expenses-api.intent` (`lib/expenses/`: four eyes as a forbid, change rules, events per
  submitter) with its screen `apps/37-expenses-ui.intent`, and `apps/api/payouts-api.intent` (an
  amount limit, a second approver, a lead who may do both but never on their own payout, roles
  granted and revoked by an admin, separation of duty in `always`). `std.actions` is documented as a
  brake, not access control (`apps/20-approval.intent` says so in its purpose). `parseString`,
  `typeToString` and `suggest` moved to `compiler/words.ts` (re-exported by the parser), so the
  harness can read access rules without importing the checker.
- v69: random values (`docs/design/v1-random.md`). A value is drawn from a type that lists its
  values: a choice, an `Int from a to b` (both bounds, at most 2^32 values), or a new refined form,
  the code: `type PickupCode = Text of 6 digits`, from a closed set of alphabets (`digits`, `hex
  digits`, `capitals and digits`, `letters and digits`, `unambiguous letters and digits` = Crockford's
  32, or `from "…"`; `BAD_BINDING` for a character twice or fewer than two). An `unambiguous` code
  is read forgivingly as input (lower case, `o` for 0, `i`/`l` for 1, hyphens ignored) and kept in
  its normal form; the interface has `readX` next to `isX` (TypeScript `readCode` in the runtime's
  api.ts, Elm `Draw.readCode`); an api reads a code param as its alphabet says (`400 "<name> must be
  a valid X"` otherwise); in JSON a code is a string. Five typed draw forms: `a random @T`, `a random
  @T not among @xs` (a `T or nothing` under 2^64 values, handled as any nothing: v66), `3 random
  @T`, `a random one of @xs` (an item or nothing), `@xs shuffled`, plus `the first 5 of @xs`.
  Checker: `RANDOM` (a type that does not list its values, a list of another type, not a list, a
  non-whole count, a draw in an element, a screen's derived value, `always` or `on start`),
  `COLLISION` (a key filled from a draw without `not among` under 2^128 values, with the birthday
  estimate), `NOT_YET` for a draw in a loop inside a loop, `RESERVED` for an api alias `random`,
  and for steering `TYPE` (a value not of its type) and `STEP` (a type nothing draws). std.quality:
  `REDRAW` (an answer that draws the stored type again), `UNSTEERED` (an example compares a drawn
  value with a literal it did not steer), `GUESSABLE` (a drawn type under 128 bits taken as input),
  `SPELLING` for `@newToken` (`a random @Token`; `intent fix` rewrites it where its endpoint uses
  it once and imports `std.text`, which now has `type Token = Text of 32 hex digits`).
  `TRANSITION_UNPROVEN` now counts a record field's default as where a new row's field starts.
  Examples steer: `steer random PickupCode = "308122", "555001"`, `steer random shuffle keeps order`
  / `reverses order`, `steer random pick 3`; a steered value `not among` excludes is skipped; one
  still queued when the example ends fails it. The harness: every draw is HMAC-SHA-256(event seed,
  "site|row|index|block") on std.crypto's reviewed SHA-256 (now also exposed on bytes: `sha256Bytes`
  in TypeScript and Elm), rejection sampling, Fisher–Yates, `not among` listing the free values when
  half or more are taken (runtime/ts/draw.ts, runtime/elm/Draw.elm, the same values: tests/random.test.ts);
  a value depends only on its place, so twin builds agree whatever order they evaluate in. Each
  place a sentence draws is a typed function of the generated `Draws` (`roll1()`, `deposit1(taken)`),
  passed to `update` (TypeScript: last; Elm: before the message), to an endpoint's handler (third)
  and to recurring work; `sourcemap.json` lists them (`draw roll1`: its unit, form, type and bits),
  `draws.json` tells the driver. Production seeds: Web Crypto per event in the browser (Elm: a
  base seed in the flags and an event counter), 32 bytes from the OS per request on the server. In
  tests every event's seed is HMAC(SHA-256(the example's name, or the session's), its number); the
  steered values go to the draws in the spec's order (site, row, index): with values queued, the
  entry runs the event once with a steer that only notes the places asked (its result dropped), then
  for real (Elm evaluates a `let` bottom-up, so the order it asks in is not the steps' order). Random
  sessions hand out an edge value for about one draw in five (a range's bounds, an alphabet's first
  and last character, a value already drawn for `not among`, a kept or reversed order) and write
  every unsteered draw before its action as `steer random …`, so a failing session pastes as an
  example that draws the same on any seed; api sessions steer edge codes (sometimes twice). A module
  that makes its own randomness (`Math.random`, crypto, Elm's `Random`) is rejected before its
  examples run. New apps: `apps/36-table.intent` (dice, a deck, a card; both targets),
  `apps/api/invites-api.intent` (unambiguous codes, a key drawn `not among`, read forgivingly);
  `apps/held-out-3/lockers-api.intent` draws its pickup code (`not among` the waiting parcels'),
  and `lockers.lockers` declares `PickupCode = Text of 6 digits`; `apps/api/members-api.intent`
  draws its keys (`a random @Token`).

- v68: lists inside list rows (`docs/design/v1-nested-lists.md`). A record may hold a list of
  another record it owns (`items: List Item = []` in `record Task`), seeded in its table cell with the
  literal of call arguments (`[{ id = 1, label = "Milk" }, { id = 2, label = "Eggs", done = true }]`:
  `UNKNOWN_NAME` for a field the inner record lacks, `TYPE` for a value that does not fit,
  `BAD_BINDING` for a missing required one, `DUPLICATE` for two with one key in a row). Inside a list
  row, `list items of Item { … }` shows the row item's field (`BAD_BINDING` without one, `TYPE` for a
  list of another record), or with `= …` a value computed per row (`its @items whose @done is false`,
  `TYPE` when it is not a list of that record). A row and its inner rows are one scope (`DUPLICATE`).
  Two levels: a list inside an inner row, a record field `List R` whose `R` holds a list of records,
  and a record that holds a list of its own kind are `NOT_YET` (the list inside a row, and the list
  in a table cell, were). In a handler of an inner row's element "that item" is the inner row,
  "that task" the row around it, `its` the inner one (`NO_ROW` for "that item" on an outer element);
  a checkbox, field or select in a row now introduces its row too, not only a button. Typed forms:
  `add a @R to (the end of) that task's @items with …`, `remove that item from that task's @items`,
  `clear that task's @newItem`, `its @items whose …`, `the X in that task's @items whose …`, `there is
  no line in that order's @lines whose …`, `every @done in that task's @items is …`, `the sum of
  @qty times @price over its @lines` (the value read per row, before `times` splits it), and a chain
  through two lists flattens: `@orders's @lines` is a `List Line`, every line of every order. Steps
  name a row inside a row with one `on row …` per level, innermost first (`toggle done on row 2 on
  row 1`, `click removeItem on row with "Milk" on row with "Groceries"`, `on row 2 of items on row 1
  of tasks`); `see items on row 1 has 3 rows` counts one row's inner list; `see every row of items`
  checks every inner row. `STEP` names the rows a step needs (too few, too many, levels swapped).
  `RowRef` gets a `parent` (the outer level). `SHADOWED` also hints at an inner element named like
  a field of both rows' records. The harness: the Screen has a row type per list (`TasksItemsRow`,
  a field of `TasksRow`); an inner row's events carry both keys (wire `target:
  "tasks.items.removeItem"`, `key`, `keys: [outer, inner]`; TypeScript `{ outerKey, key }`, Elm
  `TasksItemsRemoveItemClicked outer key`); per nested list both targets get the row keys
  (`taskRowKey`, `itemRowKey`: the record's key, else its place) and the update of one inner row by
  the two keys (`updateTaskItems`, `removeFromTaskItems`), so the model never writes the nested
  update; seeds carry their inner rows. Apps with lists inside rows hand over their data: after every
  step the driver checks that inner keys are unique within each row and outer keys are unique
  (`keys.json` with `inner`). The driver walks a path of rows (outer list → row → inner list → row);
  random sessions pick an outer row, then an inner one (fields and selects in rows now carry their
  row too), and print nested steps paste-ready. Change rules read a record whose rows live only
  inside one state list's rows (`a @Line's @price never changes`), matched by the path of keys. The
  DOM contract: an element belongs to its nearest `data-row`; the styled driver walks the path;
  `Rects` keys are `tasks[1].items[2].removeItem`. The source map keys an inner element
  `tasks[].items[].removeItem`. Runtime: `Wire` has `keys` (Elm `keys : List String`), the plain
  renderers pass the path. A `table` inside a `table` row is `NOT_YET`. Elm: a record named like a
  type `Basics` exposes (`Order`) gets a note in `Spec` to write it `Spec.Order` (it is ambiguous in
  `App.elm` otherwise). An api that stores nothing starts from its defaults when a random session
  restarts it (`steer … restart after effect`); its test client crashed before. New apps: `apps/32-checklists.intent`, `apps/33-order-lines.intent`,
  `apps/35-recipes.intent` with `apps/api/recipes-api.intent` (contract `kitchen.recipesApi`, bundle
  `kitchen.recipes`: recipes with their ingredients inside them, read-only from an api).

- v67: invariants over changes (`docs/design/v1-changes.md`). A `- sentence` in `always` may relate
  the data before a step to the data after it. Four named forms need no judgement and the harness
  checks them itself (`compiler/changes.ts`, `changes.json` in a build, both targets, no LLM):
  `<subject> never changes`, `never goes down` / `never goes up`, `only changes from @A to @B [or
  @C][, from @D to @E]` (a transition table for a choice or yes/no field) and `<rows> is never
  removed`. Subjects are a state field (or a field of one), `a @Ticket's @id` (every row's field),
  or rows, `an @Expense [in @expenses] [whose … was/is …]`, read in the record's home list (the
  same rule as following a `ref`, `compiler/homes.ts`: `HOME` without one) and matched by key
  (`NO_KEY`). The general form, for the stage with its probe: `@x before` (of `@x`'s type; a row's
  field before is `T or nothing`, since the row may be new), `was` in a condition, `the new @xs`
  and `the removed @xs` (the stage's Fmt gets `added` / `removed`; the invariants prompt a second
  export, `changes: (before, after, clock) => boolean`). The checker types the named forms whole
  (`TYPE`: an order on a Text or a row, a transition on a Text, a value of another choice, `from
  @A to @A`, removal of a value; `DUPLICATE` pairs; `NOTHING` for an order on a `T or nothing`) and
  refuses the change forms outside `always` (`CHANGE`, new). Checked per event, not per settled
  step: the screen driver takes the data before and after every wire (the user's event, each
  answer and event the provider settles, ticks, `on open`), the api driver per request and per
  run of recurring work; stuttering passes, a restart is not a step. A violation names the rule's
  line, the event and the rows that changed; the build and converge shrink the session (drop
  steps while it still fails) and show it as an example to paste. Random sessions weigh actions
  in rows a rule freezes (reach, then poke), converge notes declared transitions no session made,
  and fields and selects inside rows now carry their row. std.quality: `BREAKS_RULE` (a write to
  what a rule freezes with no condition on the field that picks its rows), `TRANSITION_UNPROVEN`
  (a declared pair no example makes), `SPELLING` for `only goes up`, `stays the same`, `is never
  deleted`, `used to be`, `the previous @x` (`intent fix` rewrites them); `UNCHECKED` and
  `NEVER_UNCHECKED` point to the change forms. A component's `- sentence` lines in `always` are
  now expanded (renamed) into the app, one-moment and change rules alike. The source map lists
  every `always` sentence (`always <file>:<line>`, kind `change` with its form). New apps:
  `apps/31-frozen-approvals.intent`, `apps/api/ledger-api.intent`; `apps/held-out-3/approvals.intent`
  states its promise as change rules instead of a `rules` sentence.
- v66: nothing-safety and following a reference. `T or nothing` works like Kotlin's `T?`: it is not
  a `T`, and using it where a `T` is needed (arithmetic, an order, `trimmed`, a template's hole or
  an element's value, `increase … by`, a field or state of type `T`) is an error, `NOTHING`, which
  replaces the `UNGUARDED` hint. Lookups, `the highest / lowest …` of a list and reads through a
  reference give one. It is handled by the elvis (`…, or X when there is none`, `(X when there are
  none)`, under which nothing propagates through the whole value), by smart casts that follow the
  flow (inside `if there is a @x`, after `if there is no @x { stop }`, in `else` branches, the rest
  of `… and …`, the other alternatives of `A when C, otherwise B`, an element `visible when there
  is a @x`, and after `if there is no <row> in @xs whose … { stop }` for `the highest … of` that
  list), ended by any step that may change what they are about, or by assigning it to a
  `T or nothing`. Equality is Kotlin's `==` (§9.12). A sentence the checker cannot type whole that
  reads a value that may be nothing, a lookup or a reference's row without saying what then is a
  `NOTHING` error too. A reference is **followed** (`its @ticket's @subject`, several hops,
  `the @subject of @comment's @ticket`) in the record's home list — its one state `List Ticket`, or
  the list the field names (`ticket: ref Ticket in tickets`; without one, `HOME`); each `'s` is a
  safe call, and one fallback covers the chain; through a list, missing targets are left out.
  `@x exists` / `does not exist` asks for the row (and names "that ticket"); a write through a
  reference outside such a guard is `NAV_WRITE`. A lookup of a reference's own row is a `SPELLING`
  hint that `intent fix` rewrites into navigation. The home's key is unique: seeded rows are checked
  (`DUPLICATE`), and the driver checks the app's data after every step (such apps hand over their
  data). Both targets get a lookup per reference in the generated interface (`commentTicket`,
  `ticketInTickets`; Elm `Maybe`, TypeScript `null`), the invariants stage too; the expanded spec
  notes what each sentence follows, and the source map lists it (`follows`). Nothing in JSON is
  `null`.
- v65: tests and checks for v1. Every diagnostic code is expected by a test and listed in §7 (a
  test fails when one is not). `its status is held` / `rejected` in the answer handler of a call that
  is not `effect external` through `std.actions` is an `EFFECT` error (only the agreement holds or
  rejects a call). A job (`profile job`) builds on the TypeScript target only: on Elm the build stops
  with the reason instead of making a page no host can run, and `intent build` / `intent converge`
  build a job with TypeScript. The TypeScript page of an app with `sizes` and no apis is shown
  again when the host changes the size (`intentsize`), as the other entries already were. A
  `ref X` with a default reports a missing key once, and `UNSCOPED` in a component's handler is on
  the step's own line. §7 adds `PROVIDER` and `PROFILE`, says which `INDENT` cases a file with
  braces has, and names the `NOT_YET` cases; the reference says where each of those is not in the
  language yet (a list in a table cell, a list inside a list row, examples inside a component) and
  no longer claims `NOT_YET` for restyling a bundle component; relations are `ref` fields, not
  values, and the `relations` block is gone from the block list.

- v64: from the third held-out round (expense approvals, parcel lockers): `@x reads as a decimal
  (above 0)` is a typed condition; `every @x in @xs is …`, `no two @xs have the same @f`, `no @R in
  @xs has a blank @f`, `there is no ticket in @xs whose …`, `remove from @xs every ticket whose …`
  and `every @A's @f is the @g of a b in @bs` (a relation stated as a rule) are typed; "at or before"
  and "3 or more" are one comparison; `set that ticket's @f to …` is checked. The printed spec keeps
  `on row N` of `type` and `choose`. Money, dates in JSON and the random-code gap are documented.
  The reference no longer carries this changelog or paths into this repository: it is the
  compiler's prompt, and says only what the language is.

- v63: "that ticket" / "its" must refer to a row introduced before it (`NO_ROW`), so no two compilers
  pick different rows; quality rules are pluggable rule sets (`std.quality` by default, a team's
  own module, a level per rule in `intent.project`'s `quality` block), apart from the compiler's
  built-in checks (§7).

- v62: the common operators have types (`plus`, `divided by`, `trimmed`, `read as`, `rounded`, `the
  number of`, `the sum of`, `the highest`, `is empty`, `contains`, `is a valid`, alternatives with
  `when`/`otherwise`), so values built with them are typed whole; `intent check --typed` reports how
  much of each spec is typed and lists the sentences left to judgement (§2).

- v61: references fit where they are used. The phrases the language knows (`set … to`,
  `increase`, `is`, `is above`, `'s`, `of the`, `whose`, `add … with`, `add … to`, `call … with`)
  are checked on the types of the references they relate, relations on their records (a `ref` is
  compared with its record's key only, looked up rather than read, and seeded references point at
  seeded rows); guards narrow `T or nothing`; derived values have a type from their form or a
  declared one (`name: Type = …`, `UNTYPED` when neither). The English between references stays
  free (§2).

- v60: requests from a host (OurOS).
  - A manifest per api: `uses ouros.notes as notes only listNotes, noteCreated`; using anything
    else is `UNDECLARED`; builds write `manifest.json`.
  - `rules by ai { … }`: rules an LLM wrote, kept apart from the person's (and in the source map).
  - Bounded text: `type Title = Text of length 1 to 80` (`at most`, `at least`), counted in
    characters on every target.
  - `profile job`: an app without a screen (an agent, a worker); the harness shows its state, and
    `job.mjs` exports `{ run }` for its host (§4k).
  - `sizes compact | standard`: the size a host shows the app at, read as `@size`; the example
    step `size standard` (§3b).
  - Wire names for choice values: `choice Level: Info = "info" | Urgent = "urgent"`; the harness
    translates at the edge, the spec keeps its names (§4f).
  - A held call answers `its status is held` at once, and `its status is rejected` when a person
    rejects it, so the screen shows the wait without keeping its own flag.
  - A 429 or 503 with `Retry-After` is sent again after that wait (up to 10 s).
  - In an api, state and derived values cannot be named `path`, `query` or `body` (`@body.x`).
  - §9.10 says what a row's key is: the record's key, else its place in the state list.

- v59: a review of v38–v58, for fewer ways to say one thing and no stand-ins.
  - **Keys and references.** A record's key is its field marked `key` (`key code: Text`), or else
    its field named `id`, never the first field that fits. `ref X` holds that key. The `relations`
    block (v47) is gone: the relation is said once, on the field (`ticket: ref Ticket`). Removing a
    row does not cascade (§9.12).
  - **Agreement.** `Permission`'s optional fields are `or nothing` (`per`, `upTo`, `approver`; and
    the `requester` param), not `0` or `""`. Each permission counts the calls it let through, so two
    one-time grants are two calls. A rejection drops the calls held when it is given; a later call
    is held again. The amount limit reads the param the contract names with `effect external of
    @amount`. What was let through, the held calls and the rejections survive a reload.
  - **One spelling for a lookup:** `the ticket whose …`. `where` (v53) still reads as a lookup, with
    a `SPELLING` hint that `intent fix` applies. The lookup check (v57) covers every sentence.
  - **Element properties by name (v58) are removed:** `see x.enabled is disabled` repeated
    `see x is disabled` (and `.rows`, `.value`, `.label`, `.checked` the existing checks), and the
    dot clashed with component instances (`pager.next`).
  - **Several screens (v48):** a name reused across screens is one kind of element with one
    handler (`DUPLICATE` otherwise); `sourcemap.json` and `units.json` key it by screen
    (`about/title`), and list each screen with its address.
  - **Loops:** a loop visits the rows the list had when it began (§9.13); its row's name exists only
    inside the block, does not hide an app name, and `in @xs` must be a list.
  - An undo's idempotency key is what it undoes, so undoing twice is recognised as a repeat.

- v58: element properties by name in `see` (removed in v59).

- v57: the `@` of a lookup (`the @tickets whose …`) must name a state list or a derived value.

- v56: a `select … from …` inside a list row: choosing sets that row's item's field to the option.

- v55: a `select` inside a list row sets that row's item's choice field (§9.7);
  `choose Done in status on row 1`.

- v54: a field inside a list row edits that row's item (§9.7); `type "Bread" into title on row 1`.
  A list inside a list row stays `NOT_YET`.

- v53: a lookup written with `where` is recognised (a `SPELLING` hint since v59).

- v52: a path param may be a `Date` or a `DateTime` (a `Bool`, list or record stays `NOT_YET`).

- v51: `import bundle.Name as Alias` renames records, choices and refined types too, with their
  references inside the bundle, so two bundles that declare one name can be used side by side.

- v50: three more `steer` faults: `slow` (a retry while the first attempt still runs, answered
  409 in progress), `restart after effect` (the service restarts between the effect and the answer)
  and `expire keys` (a retry after the keys expired runs again).

- v49: `ticket: ref Ticket`, a field holding another record's key (the key: §3, since v59).

- v48: a name is unique within a screen; two screens may reuse one, with one handler.

- v47: the `relations` block (removed in v59: `ref` says it on the field).

- v46: `@path.x` / `@query.x` / `@body.x` in an endpoint's step name a request param, told apart
  from a field with the same name.

- v45: agreement, four eyes: `fourEyes` and `requester`; a permission the requester granted
  themselves does not cover the call.

- v44: a screen can use platform functions, on both targets (a platform that runs in the harness
  stays for services).

- v43: agreement, permissions with bounds: `agree` is a list of `Permission` records.

- v42: agreement, pending: a call with no standing permission is held for approval; approving
  sends it with its original key, rejecting drops it.

- v41: `list x of Text` (or another plain type) shows each value as a row.

- v40: agreement, first slice: `through std.actions` gates a screen's external calls; the
  emergency stop answers at once with the reason.

- v39: loops as structure: `for each @x in @xs where <condition> { … }` in a handler, an endpoint
  or an `every` block.

- v38: undo on the calling side: `undo @alias.endpoint` calls the `undone by` endpoint with its
  arguments from the original call's answer.

- v37: platform functions: `platform <name>` with `function f(x: T): R` and examples, implemented by
  the installation (`runtime/ts/platform/`); `std.crypto.sha256`, `intent.tools.check`;
  `apps/api/specs-api.intent` records what it computes, never what a sender claims.

- v36: several screens: `screen <name> "<path>"` with `path x: T`, `go to @screen with …`,
  `go back`, `on open <screen>`; `open`, `go back`, `see screen`, `see path` in examples. The harness
  owns the route and the history (the address after `#` in the browser).

- v35: from building a registry with Intent: the project is where the command runs (never the
  installation by accident), and `std.*` comes from the installation; a service layer's param can
  be bound to the app's state (`keys = apiKeys`), and its records are the app's; `@newToken`, a
  fresh secret per request (`apps/api/members-api.intent`: sign-up); `public` entries by prefix
  and method in `std.http.apiKey`; lists and records as `call` arguments; `\n` and `\t` in
  strings; `NOT_YET` for lists of plain values; fewer false `UNMARKED` / `UNCHECKED` hints.

- v34: effectively once. Services recognise a repeated request by its idempotency key (IETF
  draft, Stripe): the same answer again, 422 for another request, 400 without a key for `effect
  external`, kept 24 hours with the stored state. Screens send a key per call and send it again on a
  lost answer, 5xx or 429 (three attempts in all); an external call with no answer is `unknown`.
  `steer <api> …` in examples and random sessions; api sessions deliver keyed requests twice.

- v33: effects on contract endpoints: `effect external` and `undone by <endpoint> with …`; the
  checker (`EFFECT`, `PIVOT`); effects per handler in the source map. `lib/pay` (payments: charge,
  refund, receipt) and `apps/api/payments-api.intent`. The harness part follows
  `docs/design/effects.md`.

- v32: `stored` state fields survive a restart (a screen keeps them in the browser, an api in a
  data file); `restart` in examples, also in random sessions, and a check that stored fields come
  back unchanged. The app hands over `data` and a `restore` for them (generated interface).

- v31: `- sentence` lines in `always`: invariants over the data, checked after every step by a
  separately compiled check; the app hands over its data (`Data`); `UNCHECKED` hint for rules that
  read like invariants; `UNGUARDED` hint when a `T or nothing` value is used without saying what
  happens when there is none (the helpdesk's drawer now says it).

- v30: `T or nothing` for a value that may be absent (was `Maybe T`, which still reads); the
  helpdesk's "0 for none" became `Int or nothing`.

- v29: control words are structure: `if <condition> { … } else if … { … } else { … }`, `answer …`
  (ends an endpoint), `stop` (ends a handler). Unreachable steps and endpoints that do not answer
  on every path are errors; prose "and stop" / "otherwise" gets a hint.

- v28: time: `Date` and `DateTime` types and literals, `@today` and `@now` in sentences,
  `examples start at …`, `wait 1d` moves the clock in tests, date helpers in Fmt (the same in
  every target), and `every 15m { … }` recurring work in apis.

- v27: traceability: checker errors point at the step's own line; `see x.body… = value` must
  be a value the field can hold; the source map covers endpoints, steps, events, layers, rules
  and examples; `INTENT_TRACE=1` makes every api answer name its spec line.

- v26: import what you use: names in a file's sentences and declarations must come from the
  file or from a spec it names itself (`import`, `uses`, `implements`, `extends`).

- v25: references in sentences are marked with `@` (`@draft`, `@Item`, `@pager.visible`), also
  inside components (was `{page}`); unknown `@names` are errors, unmarked names a hint.

- v24: blocks with braces (`screen { … }`), the canonical form; files without braces are still
  read by indentation. `intent fmt` lays a file out in braces. The compiler reads braces.

- v23: a client's layers: `before every call` in a layer, `through <layer>` under `uses` with
  params bound to state or literals (`std.http.sendKey`); `given` in a layer's examples;
  `every endpoint answers 401 Problem` in contracts; a base URL per api in the browser
  (`api.<alias>`); event streams in tests only reach a screen the provider's layers let through.

- v22: events: `event name: Type` in contracts and apis, `publish x with …` in endpoint steps,
  `see x.body…` / `see x is absent` on what a call published, `on event <alias>.<event>` in
  screens, another client's `call <alias>.<endpoint>` in a screen's examples; Server-Sent
  Events at `/events`. The checker checks `see x.body.<path>` against the answer types.

- v21: layers (`layer`, `param`, `provides`, `before every request`, `after every answer`,
  `examples with`) and `use <name> = <layer>` in api apps; `std.http.secure`, `std.http.cors`
  and `std.http.apiKey`; request and answer headers in api examples (`call … with header h =
  …`, `see x.header.h`), raw `request` steps and `is absent`.

- v20: screens call APIs through contracts: `uses <contract> as <alias>` (with `tested with
  "<provider spec>"`), `call <alias>.<endpoint> with …` in handlers, `on answer <alias>.<endpoint>`
  and `on start`. Examples run against the real provider build, settled after every step.

- v19: refined types (`type Email = Text matching /…/`, `type Age = Int from 0 to 150`) with
  generated checks for every target, checked seed data and api validation; `std.text`.
- v18: contracts: `contract`, `answers <status> [Type]`, `implements`, endpoints by name only in
  the implementation, `Problem`; checked by the checker, the TypeScript compiler (typed
  handlers) and at run time; `intent client`; `{endpoint.body.x}` in `call` arguments.
- v17: the api profile (`profile api`, `endpoint`, `call` / `see x.status|body…`), with a
  TypeScript/Node harness; the same domain bundle serves a screen and an API.
- v16: the UI vocabulary is a profile spec (`lib/profile/ui.intent`): element kinds, what they
  show, their verbs, presentations and meanings; the checker reads it (docs/design/profiles.md).
- v15: projects: `intent.project` (`registry`, `requires`), `intent install` with minimal
  version selection, `intent publish` with computed versions (names + demo behaviour).
- v14: numeric checks (`is at least|at most|above|below`) and per-row checks
  (`see every row of <list>: …`), in `always` and in examples.
- v13: refinement: `extends`, `override`, `add to … after …`, `drop`; base proofs run on the
  refining spec; overrides fingerprinted in `intent.lock` (`BASE_CHANGED`).
- v12: `empty` presentation; a select's `""` is a placeholder, never an option; template holes
  and display formats documented; `language vN` line; the lock pins the language and model;
  `SHADOWED` warning; header/toolbar grouping; a screen without a sidebar is one
  centered column; plain sections stack; table columns size themselves.
- v11: `visible when` and `look` on `use`; `as` on its own line; handler idioms (`and stop`,
  `otherwise`, `its`); reserved names listed and narrowed (domain words like `Event` are free;
  the generated message type is now `Msg`); `std.list.Pager` never shows a page past the end.
- v10: modules: `bundle`, `import`, `intent.lock`; behaviour components (`param`, `state`,
  `derive`, `screen`, `on`, `always` inside `component`; `use x = Component`); end-of-line
  comments are notes; `search` fields defined (placeholder label, fixed width).
- v9: components with a base presentation (`component X as card "…"`).
- v8: sections inside list rows (component cards); `NOT_YET` instead of hard "unsupported";
  layout defaults: spec order, button rows, sidebar footer.
- v7: no language change; the harness gained the Kit (class recipes derived from `design`).
- v6: `snapshot "…"` visual checkpoints; the look shows only what the spec names.
- v5: styling: `design`, `component`, `as <presentation>`, `look`, `progress`, choice labels,
  label + value on `progress`.
- v4: `always` invariants, `has at most/at least N rows`.
- v3: `on row with "…"` in examples, `Fmt.decimal`.
- v2: `table` seed data, `select … from list.field`, rounding vocabulary (`Fmt.roundTo`, …).
- v1: records, choices, state, screen, events, examples, §9 defaults.
