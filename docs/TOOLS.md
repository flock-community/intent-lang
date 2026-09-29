# Intent — the tools

The language reference (`docs/LANGUAGE.md`) says what a spec means: it is the compiler's prompt,
and holds nothing else. This file is about the tools around it: the command line, projects and the
registry, locking, the checker's codes, `intent fix`, and the settings of a build. Section numbers
like "§4f" point into the reference.

## 1. Commands

```
intent check <file.intent>... [--json] [--typed]   syntax and consistency check; --typed: how much is typed
intent lock <file.intent>...             pin the bundles these specs import (intent.lock)
intent install [<file.intent>...]        download intent.project's requirements (minimal version selection)
intent publish <lib/x/y.intent> [--registry dir]   publish with a computed version (needs its demo app)
intent client <contract.intent> [--out file.ts]    a typed client for a contract
intent fmt <file.intent>... [--check]    rewrite specs in the canonical layout (braces)
intent fix <file.intent>... [--check]    apply the mechanical fixes the checker names
intent expand <file.intent>              print the canonical, expanded spec the compiler reads
intent review <file.intent>              list what the spec leaves to defaults (one LLM call)
intent build <file.intent> [--target elm,ts] [--out dir] [--styled --kit] [--twin auto|always|off]
intent converge <file.intent>... [--builds N] [--targets elm,ts] [--traces N] [--length N]
intent config                            the compiler's options for this project, and where each came from
```

- `intent fmt <file>` lays a file out in the canonical form: blocks with braces, two spaces per
  level. A file written by indentation alone is turned into braces.
- `intent expand <app>` prints the app as the compiler reads it: imports resolved, components
  expanded, and each line marked with where it came from. Its first line says the spec is expanded
  (`# expanded by intent expand: …`): only such a spec may declare a component's qualified names
  (`pager.page: Int = 1`, `button pager.next`), so the expanded spec reads back as it is printed.
  An author who writes one gets a `SYNTAX` error.
- `intent client support/ticketsApi.intent` writes the typed client of a contract (§4h), for a
  consumer outside Intent.

## 2. Locking

`intent.lock` (one per repository, at its root) pins every bundle by content hash, plus the
language reference and the model the compiler uses. A bundle that changed since it was locked
fails the check (`LOCK`) until someone reviews it and runs `intent lock <app>`. Builds never pick
up a library change silently. A refining spec's base (§4e) is locked with a fingerprint of every
part the spec overrides: when the base changes, the check stops (`LOCK`) and marks each override
whose base part changed (`BASE_CHANGED`). A changed language reference or model is a `LOCK` warning
for `intent check`; `intent build` and `intent converge` refuse a changed model until `intent lock`
pins it. A spec's `language` line (§4d) is the lowest version it needs: `language 1`, later
`language 1.2`. A version newer than the compiler's is an error (`NEWER_LANGUAGE`); a line from
before language 1 (`language v73`) reads as `language 1`, with a `LANGUAGE` warning that `intent
fix` rewrites. A spec without the line means `language 1`.

## 3. Projects, dependencies and the registry

A project is the folder with `intent.project` or `intent.lock` nearest to where a command runs,
or that folder itself when there is none yet (`intent lock` starts its lock there). Its `lib/`,
lock and `.intent/` cache are its own. A bundle comes from the project's `lib/`, else the version
pinned in its lock, else, for `std.*`, the standard library of the Intent installation (shown
as `intent:lib/std/…`). A contract, a layer and a published app are found the same way: `support.ticketsApi`
is `lib/support/ticketsApi.intent`, and its first line says `contract support.ticketsApi`. Only a
file in `lib/` has a name; apps, services and their tests live anywhere else in the project, and
`tested with "…"` gives a service's file from the project's root. After writing or changing a file
in `lib/`, run `intent lock` on the specs that use it (`LOCK` until then).

A project lists the bundles it needs in `intent.project`, at its root:

```
project our-desk
registry https://registry.example.org       # or a folder: ./registry
requires {
  support.helpdesk 1.0
  std.list 1.2
}
```

`intent install` (and `intent build`, before compiling) picks versions with **minimal version
selection**: for every bundle, the highest of the minimum versions required anywhere, within
the same major version. It never picks a release that nobody asked for. Downloads go to
`.intent/deps/`, and `intent.lock` pins each version with its hash. A bundle in the project's
own `lib/` always wins, so bundles can be developed in place.

`intent publish lib/x/y.intent` publishes a bundle with a **computed** version:

- **major:** a name, field, choice value, param, element, state or derived value is removed or
  changed: a record field's type, a choice value's wire name, a bundle's `always` or change rule,
  a contract's endpoint signature, param and answer types, and its events; a param becomes
  required, or an example of the bundle's demo app changed or disappeared (its behaviour changed);
- **minor:** something is added;
- **patch:** anything else.

A bundle is published together with its demo app (`lib/x/y.demo.intent`), which must pass the
checker. A published app is its own demo. A published spec says its `language` line: without one,
`intent publish` refuses (`intent fix` adds it). The registry is static files (`index.json` plus one
file per version), so any file server can host it.

## 4. `intent fix`

`intent fix <file>` applies the fixes that need no judgement, so an author never retypes them:

- every `SPELLING` form (§6's table): the language's one spelling replaces the other word;
- an unmarked declared name gets its `@` (`UNMARKED`), never the name a line declares;
- a missing `import` is added (`IMPORT`);
- an api example's `see x.body.f is absent` on a declared `T or nothing` becomes `= nothing` (`STEP`);
- the `language 1` line is written: added after the header, or rewritten from a pre-1 `language vNN`
  (a `language 1.x` line stays: it is the lowest version the spec needs).

Each fix is checked before it is kept: a fix may not add any error, compared as (file, line, code),
even one that removes another. Fixes are tried per kind, and one by one when a kind as a whole would
add an error; the others are reported with the error they would add (`not fixed — …`). What needs
judgement is reported, never guessed (`needs you — …`): a word that is both the endpoint's param and
a field (`whose id is id`), a word that is in its sentence twice, what happens when there is none,
`returns T` where the status it answers with is not clear, `if no ticket has that @id` where the
param is not a reference (declare it `path id: ref Ticket`, in the contract when there is one).
Running `intent fix` twice changes nothing the second time. It lists every error left and says when
to run `intent lock` (a bundle that changed). A profile file (`profile ui { element … }`) is not a
spec and is left alone.

## 5. Settings

The build's options come from `intent.project` (a `build` block), else the environment, else the
defaults; `intent config` shows each and where it came from.

| Option | Environment | Takes |
|---|---|---|
| `llm` | `INTENT_LLM` | a provider name |
| `model` | `INTENT_MODEL` | a model name (pinned in `intent.lock`) |
| `probeLlm` | `INTENT_PROBE_LLM` | the twin's probe provider (empty: the same as `llm`) |
| `probeModel` | `INTENT_PROBE_MODEL` | the twin's probe model (empty: the same as `model`) |
| `targets` | `INTENT_TARGETS` | targets separated by commas (`elm`, `ts`) |
| `twin` | `INTENT_TWIN` | `auto`, `always` or `off` |
| `incremental` | `INTENT_INCREMENTAL` | `auto` (reuse the clean regions of the previous verified build of the same spec file, never of another spec with the same app name; the build log says why when it reuses nothing) or `off` |
| `cleanCheck` | `INTENT_CLEAN_CHECK` | `always` (after an incremental build, also build from scratch and compare) or `off` |
| `sessions` | `INTENT_SESSIONS` | random sessions per build, at least 1 |
| `length` | `INTENT_LENGTH` | steps per random session, at least 1 |
| `repairs` | `INTENT_REPAIRS` | repair rounds, 0 or more |
| `budget` | `INTENT_BUDGET` | US dollars, 0 for no limit (a run stops calling the LLM after this) |

A built service (§4f) reads these on the server:

| Variable | Default | What |
|---|---|---|
| `PORT` | | the port `node server.mjs` listens on |
| `INTENT_DATA` | `data.json` | the file that keeps the `stored` state (§3) |
| `INTENT_AUDIT` | `audit.jsonl` | the access audit (§4f), appended together with the stored state of the same request |
| `INTENT_MAX_BODY` | 1 MiB | the largest request body; a larger one is answered 413 (§9.16) |
| `INTENT_TRACE` | off | `1`: every answer carries `x-intent-source`, the spec line that gave it. Leave it off in production: it names files |

A build's `sourcemap.json` maps every element, handler, step, endpoint, event, layer, rule and
example to its file and line, and its `manifest.json` lists, per api, the endpoints and events the
screen uses (§4i).

## 6. The checker and its codes (`intent check`)

The checker runs before any compile (the reference's §7). Errors stop the build; warnings are the
backlog of places where the spec is not yet precise. `intent check --typed <files>` reports, per
spec, how many sentences with references are typed whole, and lists the rest: the places where
judgement lives.

**Two kinds of checks.** The compiler's checks decide whether a spec means one thing: syntax,
references, types, relations, which row "that ticket" is. They are built in; a spec that fails one
does not build. **Quality rules** are about completeness, style and a team's policy. They come in
rule sets: `std.quality` by default, and a project can add its own and set each rule's level in
`intent.project`:

```
quality {
  use std.quality
  use ./quality/team.ts          # a module whose default export is { name, rules }
  UNMARKED off
  STATUS_UNPROVEN error
}
```

A rule has an id, a level (`off`, `warning`, `error`), what it asks for and a check over the spec
(the loaded spec, its units, source map, typed coverage and sentences), returning findings with a
line, a message and optionally a fix. A quality error fails `intent check` (and so CI); the build
only enforces the compiler's checks. The compiler's errors cannot be switched off.
`examples/quality/team.ts` is a small rule set to start from.

`std.quality` holds the hints in the table below (`UNPROVEN`, `UNMARKED`,
`UNCHECKED`, `UNTYPED`, `UNANCHORED`, `UNSTRUCTURED`, `SPELLING`, `PIVOT`, `NO_EXAMPLES`,
`NO_HANDLER`, `SHADOWED`, `UNUSED`, `OVERRIDES_PROOF`, `BREAKS_RULE`, `TRANSITION_UNPROVEN`, `HAND_ACCESS`, `REUSED_KEY`): the compiler only records what it worked
out (which elements the examples check, which components are used, what a refinement changes), and
the rules judge it. Every `intent check`, build and `intent fix` applies std.quality at the
project's levels; `intent check` also runs the project's own rule sets. It adds these rules:

| Rule | Default | Asks for |
|---|---|---|
| `NEVER_UNCHECKED` | warning | a promise in the purpose (never, always, at most, no two) is an `always` rule |
| `STATUS_UNPROVEN` | warning | every status an endpoint answers is seen in some example (a contract is proven by its implementation) |
| `LONG_SENTENCE` | warning | a sentence stays under 40 words; name its parts in `derive` |
| `REDRAW` | warning | an endpoint that stores a drawn value answers with it, not with a new draw of the same type (keep it and refer to it) |
| `UNSTEERED` | warning | an example that compares a value it drew with a literal steers it first (`steer random T = …`), or carries it forward; a seeded value, or one read before the example did anything, was never drawn and needs no steering |
| `GUESSABLE` | warning | it warns when a type the api draws is taken back as input (a path, query or body param, also one its contract declares) and has fewer than 128 bits: without an attempt limit such a code can be guessed. It asks for 128 bits or more, or an attempt limit |
| `REUSED_KEY` | warning | a new key is never a removed row's: where rows of a list are removed and something keeps their keys (a `ref`, a kept row for an undo, an api's clients), a key comes from a counter in state (`@id = @nextId`, then `increase @nextId by 1`), not `the highest @id in @xs + 1` |
| `ACCESS_UNPROVEN` | warning | every access rule is proven both ways by the examples: one call it permits (as a caller it covers, answered neither 401 nor 403) and one it refuses (a forbid's with its message) |
| `UNENFORCED` | warning | a screen-only app or a job (it calls no service) does not promise who may do what ("only the owner", "a manager approves", "cannot approve their own"): nothing can keep that promise without a service |
| `JUDGEMENT` | off | each sentence left untyped is listed, so it is judgement on purpose |

| Code | Level | When |
|---|---|---|
| `SYNTAX` | error | a line does not match any form; a `}` without its `{`, or a `{` that is never closed; a qualified declared name (`pager.page: Int = 1`, `button pager.next`) in a spec that is not an expanded one; a file where a name belongs (`implements "./x.intent"`, `uses "lib/…"`: a contract is named, `implements area.name`, and lives in `lib/area/name.intent`); `uses area.name` without `as <alias>` |
| `INDENT` | error | a block under a line that takes none (a state field, a binding, an example step); in a file without braces also tabs, odd indentation, or a line indented more than one step |
| `UNKNOWN_NAME` | error | a reference to an undeclared element, field, type or value; a contract or bundle that is not in `lib/` (the message says the file it looked for, and what it must start with) |
| `NO_ROW` | error | "that ticket", "this habit", "the new charge" or "its @f" with no such row before it (the clicked row, a loop row, a lookup, a new record); in an access rule, "that ticket" for an endpoint without a `ref Ticket` param (or with two), or in a rule about an event |
| `NO_KEY` | error | a `ref X` where `X` has no key: no field marked `key` and none named `id`; also a change rule about the rows of such a record (`a @Note is never removed`, `the new @notes`): rows are matched by key before and after a step |
| `BAD_BINDING` | error | e.g. `field x` where state `x` is not Text, `select x from …` where `x` is not a `Text or nothing` (or a `Text`); a code `Text of n from "…"` with a character twice or fewer than two, or fewer than 1 character; `import` of a contract (its names come with `uses` or `implements`); a file in `lib/` whose first line names another contract or bundle than its path |
| `TYPE` | error | a reference that does not fit where a phrase puts it (`increase @draft` on a Text, `set @count to @draft`, `@status is @Urgent` for another choice); a type that cannot hold what is declared; a steered value that is not of its type (`steer random PickupCode = "12345"`); `ref X in xs` where `xs` is not a state list of X; `@x exists` where `@x` is not a reference, `there is a @x` where it is one; a change rule its subject does not fit (`never goes down` on a Text or a row, `only changes from` on a Text, a value that is not the field's choice, `from @A to @A`, `is never removed` on a value); alternatives without `otherwise` whose conditions do not name every value of one choice (`1 when @f is @A; 2 when @f is @B` with a `C`); a `sorted by` key that is not a field of the rows, or a direction its type has not (`earliest` on a text, `A to Z` on a number); a time form on the wrong kind (`2 hours after @today`: minutes and hours move a moment; `the days between` two moments); in an access rule, a role that is a value of another choice, a comparison a param cannot make (`@amount is at most "x"`, an order on a text), a field compared with the caller that is not text |
| `DUPLICATE` | error | a choice value named like a record, choice or refined type (they share one namespace); a name declared twice in one scope (a row and the rows of a list inside it are one scope); two seeded rows with one key in a list a reference points into; two items with one key in a seeded row's inner list; a pair listed twice in `only changes from … to …` |
| `RESERVED` | error | a name that is one of Intent's own words (the reference's §7): `key`, `nothing`, `true`, `false`, `random`, a type word; in an api `path`, `query`, `body`; `random` as an api's alias (it is what `steer random` steers) |
| `STEP` | error | an example step that does not match the element (click a text, …), or names another number of rows than the element is deep (one `on row` per level, innermost first); `steer random T` where no sentence draws a `T` (in the spec, or in a screen's provider), or where both the screen and its provider draw one, `steer random shuffle` / `pick` with nothing shuffled / picked; `click` on a button that is disabled at that step, where the checker can tell (its `enabled when` over what the example has set: defaults, seeded rows, fields typed into, selects chosen, boxes ticked; a step it cannot follow leaves it to the harness): prove it with `see x is disabled`; `wait` in an app that reads no clock and whose provider reads none; `see x.body.f is absent` on a declared `T or nothing` (it is written `= nothing`), `see x.body.f = nothing` on a `T` |
| `NOT_YET` | error | a construct the language does not have yet: examples inside a component, a list inside a row of a list that is itself inside a row (a third level), a record field `List R` where `R` holds a list of records itself (or of its own kind: a tree), a `table` inside a `table` row, a base that extends another spec, a path param that is not an Int, Text, Date or DateTime, a draw in a loop inside a loop (docs/CHANGELOG.md lists the candidates for the next version) |
| `NO_HANDLER` | warning | a button without `on click` |
| `UNPROVEN` | warning | a dynamic element never checked by any `see` |
| `UNANCHORED` | warning | a rule or handler sentence that mentions no declared name |
| `NO_EXAMPLES` | warning | the app has no examples |
| `LOCK` | error | a bundle is not locked, or changed since it was locked (§4d); a warning when the language reference or the model changed since `intent lock` (a changed model stops `intent build` and `intent converge`) |
| `UNSCOPED` | warning | inside a component, one of its own names is not written with `@` |
| `IMPORT` | error | a name comes from a spec this file does not import itself (add the `import` it names) |
| `UNREACHABLE` | error | a step after `stop` or `answer` in the same block |
| `NO_ANSWER` | error | an endpoint that does not `answer` on every path |
| `UNSTRUCTURED` | warning | control words written as prose ("and stop", "otherwise"): write `if … { } else { }`, `answer`, `stop` |
| `EFFECT` | error | an `effect` or `undone by` that cannot hold: a GET with an effect, an undo endpoint that does not exist, is not bound completely, or has an undo of its own; `undo @alias.endpoint` in a handler names an endpoint that cannot be undone; `its status is held` or `rejected` in the answer handler of a call that is not `effect external` through `std.actions` |
| `PIVOT` | warning | in one handler, a call that cannot be undone comes before one that can |
| `NOTHING` | error | a value that may be nothing (a `T or nothing`, a lookup, `the highest …`, a read through a reference) where a `T` is needed, with no `…, or X when there is none` and no smart cast (§2); also a sentence the checker cannot type whole that reads one without saying what then; "that ticket" in an endpoint with a `ref Ticket` param read before `if that ticket does not exist { answer 404 … }`; an order (`is at most`) on a `T or nothing` in an access condition; an order on a row's field that may be nothing in a filter (`the @items whose @due is before @today`: ask first, `whose there is a @due and @due is before @today`); `the hours between` or `N hours after` a value that may be nothing |
| `HOME` | error | a sentence follows a `ref Ticket` (`@c's @ticket's @subject`), or a change rule reads `a @Ticket`, and the app has no state list of Tickets, or several: name it on the field (`ticket: ref Ticket in tickets`), or in the rule (`a @Ticket in @tickets`). A record whose rows live only inside the rows of one state list (a list inside a row) is a change rule's subject there, matched by its row's key and its own; a reference cannot find such a row (its key is unique within its row only) |
| `CHANGE` | error | a change form outside `always` (`@x before` in a handler, `was` in a condition, `the removed @xs` in a derived value): a handler, a derived value and the screen read one state; name the old value first (`set @previous to @x`). In a condition or a derived value, also written loosely: `@x used to be`, `the previous @x`, `that item was done`, `that item's done was true`. Also a named rule on a record's key (`a @Ticket's @id never changes`): rows are matched by their key, so a new key is another row; say `a @Ticket is never removed`. And a change rule through a reference (`a @Comment's @ticket's @subject never changes`): write it on the record it belongs to, `a @Ticket's @subject never changes` |
| `BREAKS_RULE` | warning | a handler step writes what a change rule freezes (or removes what it keeps) with no condition before it on the field the rule picks its rows by: `set the @amount of that expense …` while `an @Expense whose @status was @Approved never changes`, without `if that expense's @status is @Approved { stop }` |
| `TRANSITION_UNPROVEN` | warning | a pair of `only changes from … to …` that no example makes (a step sets the field to the second value after it was the first) |
| `RANDOM` | error | a draw that cannot be made: `a random @T` where `T` does not list its values (a `Text matching …`, a `Text of length …`, an `Int` with one bound or more than 2^32 values, a `Decimal`, a record), `not among` with a list of another type, `a random one of` or `shuffled` on what is not a list (or a list whose type is not known), `2.5 random`; or a draw where nothing may draw: an element, a screen's derived value, `always`, `on start`; or `random` / `shuffled` outside the five forms (`a random number from 1 to 6`, `pick one at random`): a draw is one of the forms, with a type that lists its values |
| `COLLISION` | error | a record's key filled from a draw without `not among` while its type has fewer than 2^128 values (the message says after how many a repeat is likely); a key unique within its row is drawn `not among that task's @items's @code` |
| `NAV_WRITE` | error | a step writes through a reference (`set @c's @ticket's @status …`) where its row may be gone: ask first (`if … does not exist { stop }`) and write to that ticket |
| `SPELLING` | warning | a form written with another word than the language's (each is rewritten by `intent fix`, below): a lookup `the ticket where …` is `the ticket whose …`; a lookup of a reference's own row is following it (`@c's @ticket's @subject`); a change rule's `only goes up` is `never goes down`, `stays the same` / `is immutable` is `never changes`, `is never deleted` is `is never removed`, `used to be` is `was`, `the previous @x` is `@x before`; `@x is set` / `@x is not nothing` is `there is a @x`, `@x is nothing` / `@x is not set` is `there is no @x`; `A (B when there are none)` and `, or B when there is no @x` are `A, or B when there is none`; `Maybe T` is `T or nothing`; `@newToken` is `a random @Token`; `for each @n in @ns where @n.f …` is `for each @n in @ns whose @f …`, and `@n.f` in the loop is `@n's @f`; `if no ticket has that @id` in an endpoint with a `ref Ticket` param is `if that ticket does not exist`; `returns T` is `answers <status> T` (with a line for each status the endpoint answers); `use auth = std.http.apiKey` is `layer auth = …`; `the error in its body` is `the error`, `the @f in its body` is `its body's @f`; `that ticket is @Archived` in an access rule is `that ticket's @status is @Archived`, `anyone may call` is `anyone, without a key, may call`; `sizes compact | standard` is `sizes Compact | Standard` (and `size standard` is `size Standard`); `@today + 14` is `14 days after @today`; a `select … from` state `x: Text = ""` is `x: Text or nothing = nothing`, and `set @x to ""` is `set @x to nothing`; an order written before `sorted by` (`, highest @id first`, `, earliest @start first, then lowest @id first`, `, @name from A to Z`) is `sorted by @id, highest first` (`sorted by @start, earliest first, then by @id, lowest first`, `sorted by @name, A to Z`) |
| `UNCHECKED` | warning | a `rules` sentence reads like an invariant: move it to `always { - … }` so it is checked (one about before and after a step, "never changes", "only goes up", "is never deleted", as a change rule) |
| `UNMARKED` | warning | a sentence uses a declared name without `@` (mark it, or reword if it is English) |
| `UNTYPED` | warning | a derived value is used where its type matters, but its type is neither declared nor known from its form: declare it (`total: Decimal = …`) |
| `UNUSED` | warning | a declared component is never used, or `only` lists a name the app never uses |
| `UNDECLARED` | error | the app calls, undoes through or handles an endpoint or event its `uses … only` does not list |
| `CONTRACT` | error | an implementation does not match its contract (missing or extra endpoint or event, a different method or path, params written again, undeclared status); with an `access` block, an endpoint that can be refused whose contract does not declare 403 (or 401, where a key is needed) |
| `PROVIDER` | error | the provider named in `tested with` has errors, or does not implement the contract it is tested for |
| `PROFILE` | error | a profile file (`profile ui { element … }`) is not well formed: a line that is no profile line, no name, or no `element` |
| `SHADOWED` | warning | inside a list, an element's name is both a field of the row and an app-level name; inside a row of a list inside a row, a field of both rows' records (it shows the inner row's) |
| `LANGUAGE` | warning | a `language` line from before language 1 (`language v73`): it reads as `language 1`, and `intent fix` rewrites it |
| `NEWER_LANGUAGE` | error | the spec needs a newer language version (`language 1.2`) than the compiler reads |
| `NO_ACCESS` | error | an api with a layer that says who calls does not say what they may do: without an `access` block every key holder may call every endpoint |
| `OVERRIDES_PROOF` | warning | a base example or `always` check is about something this spec overrides |
| `BASE_CHANGED` | warning | the base changed a part this spec overrides (see §4e) |
| `ACCESS` | error | an `access` block that cannot be enforced: in a screen (`ui`) or a job, a contract or a bundle; no layer provides `caller` (or two do); `roles =` names a list whose record lacks `who: Text` or exactly one choice field; a rule names a role without `roles =`; a condition that is not one of the typed forms (§4h); a forbid without a condition; `anyone, without a key, may` with a condition, or with a key layer that has no `public`; `public` bound by hand in an app with an `access` block; `may call every event`; a param or `its body` where the rule has none; `as "Zed"` for a caller no key belongs to (or a key layer without `acts as`); `any caller with a role` without `roles =` |
| `UNGRANTED` | warning | with an `access` block, an endpoint or event no rule permits: nobody can call or hear it |
| `HAND_ACCESS` | warning | in an api with an `access` block, an endpoint answers 401 or 403 on a condition about the caller: say it in the block, where it is enforced before the endpoint runs and audited |

## 7. The standard library

What the Intent installation brings (`std.*`, and the layers in `std.http`), so a spec can use it
without reading its files. Each is proven by its own examples (a bundle by its demo app).

| Name | Kind | Gives | Params (default) |
|---|---|---|---|
| `std.list` | bundle | `Pager` (as a footer): shows a list one page at a time; `@pager.visible` is the page's rows, `@pager.page` the page asked for, `pageInfo` ("Page 2 of 3"), `previous`, `next` | `items` (a state or derived list, required), `size` (`5`) |
| `std.feedback` | bundle | `Toast`: a message at the bottom right until dismissed; set `@toast.message`, `dismiss` clears it | none |
| `std.text` | bundle | refined types: `Email` (something@domain.tld, no spaces), `Token` (`Text of 32 hex digits`: a secret of 128 bits) | none |
| `std.crypto` | platform | `sha256(text: Text): Text` (64 lower-case hex digits), for screens and services | none |
| `std.actions` | client layer | agreement before an `effect external` call (§4i): `Permission` (`endpoint`, `count`, `per`, `upTo`, `approver`) | `agree` (`[]`), `rejected` (`[]`), `stop` (`false`), `fourEyes` (`false`), `requester` (`nothing`) |
| `std.http.secure` | layer | safe headers on every answer | none |
| `std.http.cors` | layer | which web pages may call; answers a preflight `204`, another origin `403 "Origin not allowed"` | `origins` (`[]`: any), `headers` (`"content-type"`), `maxAge` (`600`) |
| `std.http.apiKey` | layer | who calls: provides `caller`; answers `401 "Missing API key"` / `401 "Unknown API key"` with `www-authenticate: ApiKey`; `ApiKey` (`secret`, `owner`) | `keys` (required), `keyHeader` (`"x-api-key"`), `public` (`[]`; with an `access` block, bound from its `anyone, without a key, may` rules) |
| `std.http.sendKey` | client layer | sends the user's key with every call and on the event stream | `key` (required: bind it to state), `keyHeader` (`"x-api-key"`) |
| `intent.tools` | platform | `check`: a spec's checker result, public names, example fingerprints and digest (services only) | none |
