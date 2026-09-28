# Intent — changelog and next candidates

How the language grew, version by version, and what may come next. The reference
(`docs/LANGUAGE.md`) says only what the language is: it is the compiler's prompt, so its history
and this repository's files stay here.

## Next candidates

Intent is a language in progress. When a spec needs something the language cannot say
yet, the checker reports `NOT_YET`. That is a candidate for the next version, not a rule.
A version is added when specs need it; each should serve many apps, not one. Next candidates:

- a list inside a list row (sub-items), and a list in a table cell: rows need addressing by level;
- navigating a reference (`@comment's @ticket's @subject`) instead of a lookup;
- `clock` in styled apps;
- effects the harness owns, such as randomness with a seed;
- restyling a bundle component's elements from the app;
- type parameters and slots, so a component can render the app's own rows;
- a checker warning for templates whose hole can be empty (`"{date} · {location}"` showing ` · `);
- invariants over changes ("an approved expense never changes"): `always` sees one moment, so a
  rule about before and after is a guard in the handlers, proven by an example, for now;
- a random code of digits or letters of a given length (`@newToken` is 32 hex characters);
- explicit layout sizes (`look` is still words; a closed size vocabulary could replace them);
- a terminal target: a second renderer of the same screens (sizes are the first step).

## Changelog

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
