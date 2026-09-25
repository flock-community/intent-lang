# Design: profiles are specs

Status: step 1 done. `lib/profile/ui.intent` and `lib/profile/api.intent` describe the element kinds,
verbs, presentations and meanings; `uiProfile()` reads them (no hard-coded table), a test keeps
LANGUAGE.md's presentation table in line, and `intent check` now checks a profile file like any
other spec (`compiler/profile.ts` `checkProfile`). Steps 2–5 (generic element lines, an API harness,
a profile-driven UI harness, Kotlin) remain.

## Why

Intent should be one language for many kinds of software, not a UI language with an API
language beside it. What differs between an interactive screen, an HTTP API, a CLI or a
scheduled job is small and describable:

- which **element kinds** exist (text, button, … / endpoint, … / command, …);
- what each kind **shows** (its observable properties: a value, a label, enabled / a status
  and a body / an exit code and output);
- which **verbs** a user or client can perform on it (click, type / call / run);
- which **presentations** it has, and what each one means (dialog, table / none);
- the **defaults** that fill silences (§9).

Everything else is the shared core and is already profile-neutral: records, choices, state,
derive, `on <verb> <element>`, rules, `always`, examples, `see`, modules, refinement, locking.

So a profile is written *as a spec*, in Intent itself. It is versioned, published and locked
like any bundle. The compiler reads it instead of hard-coding it. A new profile, whether an
API, a CLI or a community one, is a new profile file plus a harness implementation per
target (types, runtime, driver).

## The format

```
profile ui
  "Interactive screens: what people see and do."

element field "an editable text box"
  shows value: Text
  edits Text                              # binds a state field of this type
  verb type "the user types into it"      # `on type x`, example step `type "…" into x`
  presentation search "a search box: its label is the placeholder"
  presentation textarea "several lines"

element button "a button"
  shows label: Text
  shows enabled: Bool
  verb click "the user clicks it"
  modifier enabled when

clock
  verb tick "one clock interval passes"
```

An API profile would read:

```
profile api
  "HTTP services: what clients send and get back."

element endpoint "a route"
  shows status: Int
  shows body: Record
  verb call "a client sends a request"    # `on call createTicket`, step `call createTicket with …`
```

## Steps

1. **The UI profile as a spec, read by the checker.** `lib/profile/ui.intent` describes the
   element kinds, their verbs, presentations and meanings. The checker takes the element kinds,
   verbs and presentations from it (no hard-coded tables), and a test keeps the reference's
   presentation table in line with the profile.
2. **A generic element line and generic steps.** Every element is
   `<kind> <name> ["label"] [= expr] [as presentation]`. Example steps are derived from verbs
   (`<verb> <element> [with …]`) and from what a kind shows (`see x.<property>`). The
   UI-specific step syntax (`type "…" into x`) is kept as sugar that the profile declares.
3. **An API profile and its harness (TypeScript/Node first):** `endpoint` elements, `call` steps
   with a JSON body, `see createTicket.status = 201` and body checks. Records are the schemas,
   and state is the store. Twin compilation, examples, `always` and fuzzing work unchanged,
   because they only depend on verbs and observations.
4. **The UI harness reads its profile too:** generated types, renderer and driver per element
   kind are driven by the profile, so a community can add an element kind with its harness part.
5. **Kotlin** as a second target for the API profile.
