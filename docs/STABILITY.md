# Intent 1: the stability promise

Status: in force from language 1 (stamped on 2026-09-28, on the language of v73). Pre-1 versions
(v1–v73) are the development history in CHANGELOG.md. Section 10 records the decisions this promise
rests on.

## 1. The promise in one paragraph

A spec that checks and passes its examples under `language 1` keeps checking, keeps passing, and
keeps meaning the same thing under every later `language 1.x` compiler. Change arrives as
additions (`1.1`, `1.2`, …). When a change would break specs, it goes into an edition
(`language 2`) that a spec opts into. Every such change ships with an `intent fix` rewrite, and
specs of different editions can use each other's bundles. The spec is what is promised. Generated
code is not: it can be thrown away and rebuilt at any time.

## 2. Who relies on what

| You | You rely on | Promised in |
|---|---|---|
| write specs | syntax, meaning, §9 defaults, compiler diagnostics | §3, §4 |
| build on bundles | computed versions, examples and `always` rules as conformance tests | §6 |
| host generated apps | `data-el`, `sourcemap.json`, `manifest.json`, `job.mjs`, the transport, the wire, the audit, stored data | §5 |

## 3. The language

**Versions and their spelling.** A spec names the version it needs on a line of its own:

```
language 1        # Intent 1
language 1.2      # needs something added in 1.2
language 2        # opts into the second edition
```

- `1.x` releases only add things: a new form, a new element kind, a lifted `NOT_YET`, a new
  optional param. A spec that declares `1.2` and is checked by a `1.1` compiler is an error that
  says which language it needs (`NEWER_LANGUAGE`, `compiler/load.ts`). It is not read as far as it
  goes. (Go does the same since 1.21.)
- The `language` line is the lowest version the spec needs, not the compiler it was written
  with. `intent fix` writes it (`compiler/fix.ts`, `fixText`): it adds `language 1` where the line
  is missing and leaves a `language 1.x` line as it is.
- **A spec without a `language` line means `language 1`**, as a Go module without a `go` line gets
  old semantics. It never means "the newest language": a spec does not change meaning because the
  compiler moved on. `intent fix` adds the line, and `intent publish` refuses a spec without one
  (`compiler/registry.ts`, `publish`).
- Pre-1 lines (`language v12` … `language v73`) keep working. They are read as `language 1` with
  the `LANGUAGE` warning, and `intent fix` rewrites them to `language 1` (`compiler/parse.ts`, the
  `language` block).
- In language 1 no rule depends on the line. The one pre-1 rule that did (`NO_ACCESS` was a hint
  before v70 and an error from v70 on) collapsed to its language 1 behaviour: an api with a key
  layer and no `access` block is an error whatever its line says. An edition will be the first rule
  keyed to the line again, on purpose and on a schedule (§4).

**What counts as breaking.** Following Rust RFC 1122, a change is breaking when a spec that
checked and passed its examples under 1.x then:

1. gets a compiler error it did not have (a new error, a changed type rule, a new reserved name),
2. means something else: a §9 default, a phrase's reading, a keyword's scope, or an example step's
   semantics changes, or
3. makes the harness write something else to the wire, the DOM or the stored data (§5).

A new compiler *warning* is not breaking. Neither is a new quality hint, or an error where the
spec was already `NOT_YET` or ambiguous (a twin disagreement).

**§9 defaults are frozen.** "Silence has a default" only works if the default holds still. In 1.x
a default is only ever added, for a case that was an error or `NOT_YET` before. Changing one (for
example the Decimal display in §9.2) needs an edition.

**Diagnostics.**

- *Stable:* the compiler's codes and their levels (`SYNTAX`, `UNKNOWN_NAME`, `TYPE`, `NOTHING`,
  `NOT_YET`, `ACCESS`, `NO_ACCESS`, `CONTRACT`, `NEWER_LANGUAGE`, … the error rows of the code
  table in TOOLS.md §6, plus the compiler's own warnings `LANGUAGE`, `LOCK`, `BASE_CHANGED`). A
  code is never renamed and never reused for another meaning. An error never becomes a warning
  silently, and a warning never becomes an error outside an edition. The message text is not
  stable.
- *Not frozen:* the quality rule sets, `std.quality` included (`compiler/quality/std.ts`: `SPELLING`,
  `UNPROVEN`, `UNCHECKED`, …). A new hint may appear in any release. Rules are about completeness
  and style, not meaning, and a quality error fails `intent check`, never the build. A new
  std.quality rule ships at `warning` or `off`, never at `error` (every rule of std.quality is one
  of the two today). It is promoted to an error only in an edition, or by a project's own levels
  in `intent.project`.
- `NOT_YET` is the only way the checker says "the language cannot say this yet". It is always an
  error, and lifting it is an addition. The candidates live in CHANGELOG.md, "Next candidates".

## 4. How change arrives

1. **Deprecation first.** The old spelling keeps working and becomes a `SPELLING` warning in a
   1.x release, with an `intent fix` rewrite in the same release. The warning lasts at least two
   minor releases or six months, whichever is longer, and it becomes an error only in the next
   edition. That is Kotlin's warning, then error, cycle, stretched across an edition. Editions come
   at most once a year, and only when there is something to remove; none is scheduled for its
   own sake.
2. **Every breaking change ships with `intent fix`.** `compiler/fix.ts` sets the bar: a fix is
   kept only if it adds no error (a code on a line that did not have one), fixes are tried by kind
   and then one by one, refused fixes are reported with the error they would add, anything that
   needs judgement is reported and never guessed, and a second run changes nothing
   (`tests/fix.test.ts`). An edition that cannot meet this bar for a change does not make that
   change.
3. **A compatibility suite gates every release.** Before a release, every spec in the suite checks
   clean (`intent check`: no error, and no `LANGUAGE`, `SPELLING` or `LOCK` warning) and `intent
   fix` changes nothing on it; `npm test` passes, which checks the checker, harness and ambiguity
   fixtures and runs `intent fix` on the snapshots in `tests/fix/` (pre-1 specs: the migration must
   keep working, and a second run changes nothing); and the release's converge round builds the
   measured apps and runs their examples (`runs/history.jsonl`). The suite is `apps/` (all levels),
   `lib/` (all levels), the test fixtures, and every registry version published under language 1.
   Registry consumers may opt their specs in, as Swift's suite takes outside projects; none has
   yet. The result is recorded with each release in CHANGELOG.md. This is Rust's crater and
   Swift's source compatibility suite at Intent's scale. A 1.x release that breaks one of them is
   itself a bug.

   Outside the suite, and why:
   - **The registry's 1.0.0 versions** (`std.list`, `std.feedback`, `std.text`, `ui.admin`,
     `support.tickets`, `support.ticketsApi`, `support.helpdesk`) were published before language 1,
     without a `language` line. A published version is immutable, so they are history:
     `support.helpdesk` 1.0.0 has a pre-1 `NO_ROW` error (`its status` in `on click send`). The
     next publish of each is a language 1 version and joins the suite.
   - **`runs/openouros/`** is the v21 snapshot that the OurOS review (`docs/reviews/openouros.md`)
     was written from; its `# GAP:` notes describe the language as it was then. It keeps its
     `language v21` lines. After `intent fix` it still has ten errors that need judgement, not a
     rewrite: `01-notes.intent` (`PROVIDER`: its provider has an error), `02-notifications.intent`
     (`NO_ACCESS` at `layer auth`: which component may call what is a design question; `NO_ROW`:
     `that placement`, a concept the snapshot marks as a GAP), `03-yoga-booking.intent` (six
     `NO_ANSWER`: the endpoints `classOpened`, `approve`, `reject`, `revokePermission`, `setStop`
     and `steerConnector` answer in prose), and `providers/notes-api.intent` (`NO_ROW`: `the new
     note`), besides some forty `needs you` judgements about which word is a request param. Nine
     of the ten were errors before language 1 as well; `NO_ACCESS` was a hint for a v21 spec. The
     OurOS lessons live on in the language (v22–v60) and in `apps/`.
4. **Editions compose.** A `language 2` app can import a `language 1` bundle and the other way
   round. Each file is checked under its own line, as Rust crates of different editions link
   together. The rule RFC 2052 sets for Rust holds here too: a spec with no deprecation warnings
   under the last 1.x checks under `language 2` and behaves the same. Only the edition line
   changes.
5. **Security and soundness are the exception.** A fix for a security hole in the harness or the
   access checks, or for a checker that accepted a spec with two meanings, may break specs in a
   1.x release without a deprecation period. Go and Rust make the same exception. As RFC 1122
   asks, the suite measures the impact first, and a warning goes out a release ahead whenever the
   hole allows the wait. Each one is listed in CHANGELOG.md under a **Breaking (security)**
   heading, with the codes it adds and its `intent fix` rewrite when there is one. The `LOCK`
   check makes every project see it: the reference's hash changes, and `intent check` warns until
   someone runs `intent lock` again. v71 is the model: an access permit that held only because a
   row was missing was closed.

## 5. Behaviour: "same spec in, same app out"

An LLM writes part of every build, so the promise is about behaviour we can observe, not about
the code. Every accepted build of a `language 1` spec:

- passes every example, `always` rule, change rule and access rule of the spec and of every
  bundle it uses. A build that fails one is never accepted (LANGUAGE.md §8).
- applies the §9 defaults wherever the spec is silent.
- agrees with an independent twin build on random sessions (`twin auto`: twin unless a verified
  build is already cached, `compiler/config.ts`). A disagreement stops the build and names the
  spec line to sharpen.
- is pinned by `intent.lock`: `@language 1 sha256:…` (the reference's version and hash) and
  `@model`. The build cache is keyed on the canonical spec plus a digest of the harness. An
  unchanged spec on an unchanged pin is a cache hit, so it is the same app byte for byte. A changed
  pin never goes unnoticed: a changed reference or model is a `LOCK` warning for `intent check`,
  and a changed model stops `intent build` and `intent converge` until `intent lock` pins it
  (`compiler/load.ts`, `modelPinProblem`).

Not promised: that two builds have the same code, or that behaviour the spec, its examples and §9
leave open stays the same across builds. Twin builds and `intent converge` measure that gap. They
do not close it. The fix is always a spec change. **Generated code is never hand-patched**: a patch
is lost on the next build and breaks the trace back to the spec.

**Harness contracts.** The harness writes these, not the LLM, and they are stable across 1.x:

| Contract | What is fixed |
|---|---|
| `data-el` | every element carries its spec name, qualified in a component instance (`pager.next`) |
| `sourcemap.json` | per build: element, handler, step, endpoint, event, layer, rule, example → file:line |
| `manifest.json` | per api the app uses: its contract, endpoints and events (the `uses … only` list) |
| `job.mjs` | ES module, default export `{ run }`; `run({ event: { event, body } })` or `run()`, resolving with the job's data |
| `globalThis.__intentTransport` | the host transport a job or screen uses when calls do not go over HTTP |
| `<meta name="intent-api" content="alias=url">` | where a browser build sends calls, else the page's origin |
| the wire | JSON; nothing is `null`; a choice value is its wire name, or else its spec name; fixed answers `400/404/405/413 {"error": …}`, `401`/`403 {"error": …}` from access; `idempotency-key` kept 24 h; retries of lost/5xx/429 answers, three attempts |
| `x-intent-source` | with `INTENT_TRACE=1` only: the spec line that gave the answer, as `file:line`. A debug contract: the header's name and form are stable, it is off by default, and nothing in production may rely on it (it names files) |
| the audit | JSON lines in `INTENT_AUDIT` (default `audit.jsonl`): `at`, `caller`, `endpoint`, `decision` (`allowed`/`refused`), `rules` (`file:line`), `status`, `key?`; never a secret (`runtime/ts/access.ts`, `AuditEntry`) |
| stored data | `INTENT_DATA` (default `data.json`) on a server, local storage in a browser; migrated, not reset, when records change (LANGUAGE.md §3) |
| server | `node server.mjs`, `PORT`, `INTENT_MAX_BODY` |

A field may be added to any of these files. Removing or renaming one needs an edition.

## 6. Bundles

A version is computed by `intent publish`, not chosen (`compiler/registry.ts`, `nextVersion`,
`apiOf`; `tests/registry.test.ts`). It compares the exported surface with the last release, and the
fingerprints of the demo's examples:

- **major:** an entry is removed or changed: a name, a record field or its type, a choice value or
  its wire name, a component param, element, state or derived value, an `always` or change rule
  (the bundle's or a component's: its conformance tests); a param becomes required; a demo example
  changed or disappeared. For a contract, the endpoint signatures, the param and answer types and
  its events (with their payload types) count as well.
- **minor:** something is added (an entry, or a new demo example).
- **patch:** neither.

A published spec has a `language` line; `intent publish` refuses one without it.

This is Elm's enforced semver (`elm diff`/`elm bump`) with one step further: Elm compares types
only, Intent compares behaviour too, through the examples. Resolution is minimal version selection
within one major. Versions are pinned with their hash in `intent.lock`. The registry is static
files, so a published version stays immutable. A bundle's examples and `always` rules are its
conformance tests, and every app that uses it must pass them.

## 7. Targets and providers

Elm (screens) and TypeScript (screens, apis, jobs) are the targets of Intent 1. A new target or a
new model or provider is a module (`compiler/targets/`, `compiler/providers/`) plus a line in a
registry. It must pass the same examples, `always` rules and twin builds, with a converge run
recorded in `runs/history.jsonl`. A target changes how an app is made, never what counts as
correct (`compiler/targets/target.ts`). Dropping a target is announced one minor release ahead.

## 8. Outside the promise

- Generated code: its layout, its names and the generated interface (`Screen`, `Msg`, `Fmt`).
- Prompt text, including the wording of LANGUAGE.md as a prompt. The *meaning* it states is
  promised; the words may be sharpened.
- The model's choices where the spec is silent and §9 has no default, and cost, speed and the
  number of repairs.
- Tool output formats: `check`, `converge`, `review`, `expand`, diagnostic message text,
  `units.json`, the `// @spec` region marks, and the formatting that `intent fmt` produces.
- The quality rule sets and their hints (§3).
- Tuning variables: `INTENT_BUDGET`, `INTENT_SESSIONS`, `INTENT_LENGTH`, `INTENT_REPAIRS`,
  `INTENT_INCREMENTAL`, `INTENT_CLEAN_CHECK`. Incremental builds (off by default) are
  experimental: which regions they keep may change, but what they accept may not.
- Anything the checker reports as `NOT_YET`, and everything under "Next candidates".

## 9. How Intent compares

| Language | What it promises | Intent |
|---|---|---|
| **Go 1** [1][2] | "Programs written to the Go 1 specification will continue to compile and run correctly, unchanged". The exceptions are security, specification errors, bugs, unspecified behaviour, unkeyed struct literals, dot imports and `unsafe`. The toolchain itself is not covered. Since 1.21 the `go` line in `go.mod` is a minimum: behaviour changes are keyed to it through GODEBUG, kept "for a minimum of two years", and a newer toolchain is fetched when a module needs one. "There will not be a Go 2 that breaks Go 1 programs." | **Follows:** the promise, its exceptions (security, spec errors), tools left out, and the `language` line as a minimum version. **Departs:** Intent has editions. Its wording is younger than Go's, and a vague default costs more when an LLM reads it. |
| **Rust** [3][4][5][6] | "If your code compiles on Rust stable 1.0, it should compile with Rust stable 1.x". RFC 1122 allows breaking changes in a minor release only for compiler bugs and soundness, after a crater run, a warning first and outreach. RFC 1105: "all major changes are breaking, but not all breaking changes are major". Editions are opt-in per crate, "must seamlessly interoperate", and "Warning-free code on edition N must compile on edition N+1 and have the same behavior". `cargo fix --edition` migrates. | **Follows most closely:** the definition of breaking, the soundness exception, editions that compose, and the rule that warning-free 1.x specs check unchanged under 2. The compatibility suite is Intent's crater. |
| **Kotlin** [7] | Stability levels (Experimental, Alpha, Beta, Stable). Incompatible changes are announced by a warning with automated migration aids, and then become errors (`@Deprecated` levels WARNING, ERROR, HIDDEN). They land only in language releases (2.x.0). `-language-version` and `-api-version` keep old semantics. | **Follows:** the deprecation cycle (a `SPELLING` warning plus `intent fix`, then an error in an edition), and "language releases" as editions. **Departs:** there are no feature stages. A construct that is not ready is `NOT_YET`, not an opt-in flag. |
| **Elm** [8] | `elm diff` and `elm bump` compute the version from the exposed types. The known gap is that "behavior is also part of an API" and is not checked. | **Follows** (`intent publish` computes the version) and **closes that gap in part:** a changed or removed demo example is a major change. |
| **SemVer 2.0** [9] | MAJOR for incompatible changes, MINOR for compatible additions, PATCH for fixes. "Anything MAY change" in 0.y.z. "It is unacceptable to modify versioned releases." | **Used for bundles.** Published versions are immutable. The language uses `1.x` plus editions. |
| **Swift** [10][11] | A source compatibility suite of 200+ real projects is built in CI against development compilers. Language modes (`-swift-version 4/5/6`, SE-0441) keep old code compiling. The Swift 6 mode is opt-in, after the same checks shipped as warnings in 5.10. ABI stability arrived in 5.0. | **Follows:** the compatibility suite, a mode per file (the `language` line), and warnings before errors. **ABI does not apply:** the stable binary surface is the harness contracts in §5. |
| **TypeScript** [12][13] | TypeScript "never claimed to follow semantic versioning" in the sense that breaking changes imply major versions. "If we followed semver rules exactly, literally every single release would be a major version bump." Users learned to pin to `~major.minor`. Since 5.0 a deprecation is an error that `ignoreDeprecations` silences, then a no-op, then an error in the next major. | **Departs:** a 1.x release does not break specs. **Learns:** pin the compiler (`intent.lock` does), make every change visible (`LOCK`, `LANGUAGE`), and give each deprecation a dated end. |

[1] https://go.dev/doc/go1compat · [2] https://go.dev/blog/compat, https://go.dev/doc/godebug,
https://go.dev/doc/toolchain · [3] https://blog.rust-lang.org/2014/10/30/Stability/ ·
[4] https://rust-lang.github.io/rfcs/1122-language-semver.html ·
[5] https://rust-lang.github.io/rfcs/1105-api-evolution.html ·
[6] https://rust-lang.github.io/rfcs/2052-epochs.html, https://doc.rust-lang.org/edition-guide/editions/index.html,
https://github.com/rust-lang/crater · [7] https://kotlinlang.org/docs/kotlin-evolution-principles.html,
https://kotlinlang.org/docs/components-stability.html · [8] https://elm-lang.org/,
https://github.com/elm/elm-lang.org/issues/868 · [9] https://semver.org/spec/v2.0.0.html ·
[10] https://www.swift.org/documentation/source-compatibility/ ·
[11] https://github.com/swiftlang/swift-evolution/blob/main/proposals/0441-formalize-language-mode-terminology.md,
https://www.swift.org/blog/announcing-swift-6/, https://www.swift.org/blog/abi-stability-and-more/ ·
[12] https://github.com/microsoft/TypeScript/issues/14116 (maintainers' comments) ·
[13] https://github.com/microsoft/TypeScript/issues/51000,
https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html

## 10. Decided

The draft of this promise left ten questions open. Each was decided as the draft recommended:

1. **The version line** is `language 1`, `language 1.2`, `language 2`, with no `v`; a pre-1
   `language vNN` reads as `language 1` (§3).
2. **No `language` line** means `language 1`; `intent fix` adds it and `intent publish` requires
   it (§3).
3. **Deprecations** last at least two minor releases or six months, whichever is longer; errors
   come only with an edition (§4).
4. **Editions** come at most once a year, and only when there is something to remove (§4).
5. **The bundle version** counts a contract's events, choice wire names, a bundle's `always` and
   change rules, and record field types in every bundle (§6).
6. **The model pin** is a warning for `intent check`, and `intent build` and `intent converge`
   refuse a changed one until `intent lock` (§5).
7. **`x-intent-source`** is a debug contract: its name and `file:line` form are stable, it is off
   by default, and production never relies on it (§5).
8. **New std.quality rules** never start at `error` (§3).
9. **The compatibility suite** takes the specs of registry consumers who opt in, and its result is
   published with each release (§4).
10. **A pinned older compiler** may be run: `intent.lock` names `@language`, and a project may
    stay on a 1.x compiler until it chooses to move. Installing `intent` versions side by side
    (Go's toolchain line) is not built yet; it is needed from the first 1.x release after 1.
