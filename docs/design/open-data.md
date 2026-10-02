# Design: open data — a JSON value the spec does not own (`Json`, 1.1)

Status: proposed (2026-10-02), for 1.1 (in progress). Asked for by OurOS (its decision 0070:
intentlang builds OurOS), measured on main 6ada394. Nothing here is built yet; the test plan is
what a coder writes first.

## The problem, measured

A record without fields (`record Ping`, 1.1) reads incoming JSON as `{}`. That is what the
harness does for every record: the runtime's reader builds the value from the declared fields and
nothing else (`runtime/ts/api.ts`, `check`, case `Record`: `for (const f of t.fields) …`), the
migration does the same (`coerce`, "an extra field is dropped"), the Elm decoder of an empty record
is `D.keyValuePairs D.value |> D.map (\_ -> {})` and its encoder `J.object []`
(`compiler/targets/elm.ts`), and the TypeScript type is `Record<string, never>`
(`compiler/targets/ts.ts`). So a contract field declared as a list of empty records,
`{ "actions": [{ "label": "Open", "type": "open" }] }`, arrives as `{ "actions": [{}] }`, and goes
out the same way. Dropping what the spec did not declare is right for everything the spec owns. It
is wrong for the three places where OurOS's contracts carry content whose shape is decided
somewhere else:

| OurOS contract | Field | Who owns the shape |
|---|---|---|
| `std.notify` (params and schema) | `actions: array of object` | the kern: each `{ label, type, … }` is what the notification surface offers |
| `std.chat.said` (event) | `answer: object` | the kern: text, a component, a mode switch or knowledge |
| `std.trigger.schedule` (params) | `effect.payload: object` | another contract: the payload of the action the trigger will perform |

Without a way to carry such a value, a built spec can only schedule an action with an empty
payload, and a notification loses its actions on the way. The kern's contract adapter already
refuses the shapes it cannot say (`IntentContractAdapter.kt`, "a map from any name to a value" for
`additionalProperties`), so this gap is visible and counted on the OurOS side.

What the spec's own code must be able to do with such a value: **hold** it (state, stored state, a
record's field, a param, an event's payload), **pass it on** (to a call, an answer, an event, a
list), and **compare** it (an example, a change rule, `is`). What it must not do: read into it, or
be shown it, because nothing in the spec says what is in there, and a sentence about it would be
the one place two builds disagree with nothing to check them.

## Options

**A. An opaque type, `Json`: a JSON value the program holds, passes on and compares, never reads.**
One type word, following the `Map T` and `Instant` additions of 1.1 step for step (the files are
the ones commit `ae62a3f` touched). Readable: `actions: Json` says "whatever the host puts here".
Precise: a JSON value with one canonical form, so twin builds write the same bytes and an example
compares it as JSON. Silence has a default: canonical on the wire, `null` a value, nothing drawn.
Additive: a new type word that was `UNKNOWN_NAME`, not reserved, a spec's own `Json` kept (as
`Instant` is). Both targets have the value already (Elm `Json.Decode.Value`, TypeScript a JSON
union). Checkable: reading into it is a `TYPE` error, so nothing is left to judgement.

**B. `open` records: `record Action open { label: Text; type: Text }` keep the fields they do not
declare.** It serves the notification case alone (known fields plus the rest) and not `answer`
or `effect.payload`, whose shape is wholly someone else's. It changes what every record is on both
targets (an extra `rest` dictionary in each Elm record, in `Data`, in migration, in equality), it
raises questions a record literal in an example cannot answer (what are the unknown fields of
`{ label = "Open" }`?), and it invites the model to read the rest. A larger surface for a narrower
need. Not now; and once `Json` exists it is `rest: Json` in a record of one's own, if ever wanted.

**C. `Map Text` / `Map Json`.** `Map Text` cannot hold `[{…}]` or a nested object. `Map Json` is
option A with one shape fixed (an object), which `answer` is but `actions` is not. With A in the
language, `Map Json` comes free where a spec wants to say "an object of unknown values".

**D. Typing the payload per action (type parameters on records or contracts; a contract as a
value).** The honest type for `effect.payload` is "the params of the contract named in
`effect.contract`", chosen at run time by the kern. That needs a contract to be a value and a type
to depend on one, on both targets, with generated code for each: a `language 2`-sized design for a
value the spec will never inspect. Option A is the seam for it: a later, additive typed read
(`its @payload as a @Reservation, or …`) narrows a `Json` without changing what a `Json` is.

**Recommendation: A, spelled `Json`.** Two spellings were weighed. `Data` is the generated name of
the app's own data record on both targets (`export type Data` in `spec.ts`, `type alias Data` in
`Spec.elm`, and in `TARGET_WORDS`), so the prompt would carry one word with two meanings and the
generated code a mangled `Data_`. `Json` says what the value is — what goes over the wire (§4h,
STABILITY §5: "the wire: JSON") — and names the Elm and TypeScript types it becomes. It is not
reserved: as with `Instant` (`compiler/parse.ts`, `ownInstant`), a spec's own record, choice or
type named `Json` keeps its meaning, so no checked spec gets a new error (STABILITY §3, "a new
reserved name" is breaking; this adds none).

## The language

```
record Notice {
  id: Int
  title: Text
  actions: Json                    # what the host offers with it; the host decides the shape
}

state {
  stored answer: Json or nothing = nothing     # the kern's last answer, kept as it came
  actions: List Action = table {               # what this app itself sends: its own record
    label  | type
    "Open" | "open"
  }
}

on click send {
  - call @notices.notify with @title = @draft and @actions = @actions   # a List Action fits a Json
}

on event chat.said {
  - set @answer to its body's @answer          # held, never read
}
```

- **`Json`** is a value whose shape the spec does not own: any JSON (an object, a list, a text, a
  number, true or false, null). It goes wherever a type goes: a field, a state field (also
  `stored`), a param, an answer, an event's payload, `List Json`, `Map Json`, `Json or nothing`.
- **Hold, pass on, compare.** `set @x to …`, `add … to @xs`, `call … with @p = @x`,
  `publish … with @x`, `answer 200 with @x`, and `@a is @b` / `is not` (the same JSON). A change
  rule may freeze one (`@answer never changes`).
- **Never read.** `@answer's @text`, a template hole `{@answer}`, `sorted by @payload`, and any
  sentence about what is inside (`the number of items in @answer`) are `TYPE` errors, with the
  message "a Json is whatever arrived: hold it, pass it on or compare it; say what you own as a
  record". A screen does not show it (`text shown = "{@answer}"` is `TYPE`). A job's state
  screen, which the harness writes, shows it as its JSON text, so a job's example can `see` it.
- **Fit.** Any value fits a `Json` (as an Int fits a Decimal): a record of the spec's own, a list
  of them, a text. It goes out as that value's JSON (wire names, `null` for nothing). A `Json` fits
  only a `Json` (and a `Json or nothing`).
- **`null`.** Inside a `Json`, `null` is a value and is kept. A `Json` field that is `null` is JSON
  null; a missing key is "is required" as for every `T` (§9.18). In a `Json or nothing`, `null` and
  a missing key are both nothing (§9.18 wins): a spec that must carry null says `Json`.
- **Not drawn.** `a random @Json` is `RANDOM` ("a Json is whatever arrived; there is nothing to
  draw from").
- **Literals.** Where a literal is written (a default, a seeded cell, a call's argument in an
  example, a `see`), a `Json` takes any literal the language has: `"text"`, `12`, `true`,
  `nothing`, `[]`, `{}`, `[1, "a"]`, `{ label = "Open", type = "open" }`,
  `[{ label = "Open", type = "open" }]`; a key that is not a name is quoted, as a map's
  (`{ "x-id" = 1 }`). One literal syntax, the spec's own, for all of JSON.

## The wire, stored data and equality: one canonical form

A `Json` has one written form, everywhere the harness writes it: every object's keys in order (by
their text, code point by code point, as a `Map`'s, §9.21), at every depth; lists in their order;
numbers as read; `null` kept. The runtime canonicalises on the way in (`check`, case `Json`: the
same `entriesInOrder`/`mapOf` as a map, so a key `__proto__` is a key and never reaches a
prototype) and on the way out (`toWire`), and keeps it so in stored data (`coerce`). So:

- two builds that assembled a value in different key orders send the same bytes (twin-identical
  on the wire, and `calls()` of `screen.mjs` and `job-host.mjs` carry it so);
- **equality is "the same canonical text"**, in the harness (examples, change rules, random
  sessions) and in the app (`sameJson` below);
- what the spec did not declare passes through untouched: `{ "label": "Open", "type": "open",
  "payload": { "deep": [1] } }` comes back as itself, keys in order.

`wireType` (`compiler/calls.ts`) and `hasWire` (runtime) say yes for a type that holds a `Json`,
as they do for a `Map`, so the Elm glue runs bodies through the runtime's translation and an Elm
build sees canonical values too.

## The targets

**TypeScript.** `tsType(Json)` is `Json`; the prelude of `spec.ts` gets
`export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };` when the
spec (or an api it uses) holds one (`usesTypeKind(app, "Json")`, next to `usesMap`/`usesInstant`),
and `export const sameJson = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b)` (values
are canonical by then). `typeDescOf(Json)` is `{ k: "Json" }`; the runtime's `TypeDesc` gains that
member, and `check`, `coerce`, `toWire`, `describe` ("a JSON value") a case each. The `Json` case
in `check` comes before the `null` refusal: null is a value.

**Elm.** `elmType(Json)` is `Json`; `Spec.elm` gets `type alias Json = D.Value` when used, with
`import Json.Decode as D` and `import Json.Encode as J` under that condition too (today they come
with `hasClients || hasData`). Decoder `D.value`, encoder the value itself, so stored data and
answers pass through `encodeData`/`decodeStored` unchanged. The alias must compile next to the
module `Json.Decode`; there is no module named `Json`, as `Html.Html` is a type named like its
module, so it should (the first Elm twin build proves it; the fallback is a mangled generated
name, which touches no spec). And one rule the prompt must state, because Elm's `==` on a `Value`
is wrong in a way no test would find by luck: `_Utils_eqHelp` walks the keys of its left operand
only, so `{a:1} == {a:1,b:2}` is `True`. `Spec.elm` gets `sameJson : Json -> Json -> Bool`,
`J.encode 0 a == J.encode 0 b`, and the Elm rules say: "`Json` is `Json.Decode.Value`, a value the
spec does not own: hold it, pass it on, compare it with `sameJson`, never `==`, never decode it;
where a job's state screen shows one, its text is `J.encode 0 v`." The TypeScript rules say the
same without the `==` clause, with `JSON.stringify(v)` for the text. That fixed function is what
makes `see last = [{ … }]` on a job the same in every build.

**Literals in generated code.** `elmValue`/`tsValue` of a `Json` literal (a default, a seeded cell)
write it canonical (fields sorted at generation): `J.object [ ( "label", J.string "Open" ), ( "type",
J.string "open" ) ]`, `{ "label": "Open", "type": "open" }`.

## The checker and the api layer

`intent check` (`compiler/fit.ts`, `parse.ts`): `parseType` reads `Json` (a `Named` read in its
place unless the spec declares one, exactly `ownInstant`); `fits(to: Json, from: any) = true`,
`fits(to: T ≠ Json, from: Json) = false`; `comparable` follows; `literalFits(l, Json) = true` and
`valueFits(Json, v) = true`; a chain hop from a `Json` (`chainInfo`: `recordOf(cur)` is none) and a
template hole, a sort key, a numeric or text form on a `Json` are `TYPE`; a sentence the checker
cannot type that mentions a `Json` reference (the `untyped` set) is `TYPE` too, not `JUDGEMENT`;
`notDrawable` (`compiler/draws.ts`) says why it cannot be drawn; `since` marks it 1.1
(`NEEDS_LANGUAGE`, as `Map T`); `typeToString`, the printer and `registry.ts`'s `apiOf` spell it
`Json` (a field that changes from `Ping` to `Json` is a changed type: a major version, as it
should be).

The api layer: `runApiJobs` compares a `see` as today (`shown(v) === c.value`, `shown` being
`JSON.stringify` for an object), with both sides canonical: the literal's `literalJson`, sorted,
and the response's value, canonical since `check`. Random api sessions (`apiTraces`, `valueFor`)
draw a `Json` param from a fixed set that covers every JSON shape, including the ugly ones: `null`,
`true`, `0`, `-1.5`, `""`, `"x"`, `[]`, `{}`, `[1, "a", null]`, `{ "a": { "b": [1, 2] }, "key": "x" }`,
`{ "__proto__": 1 }`, and the values the spec's own examples pass. Every published payload and
every answer is still checked against its type: a `Json` always fits, a missing one never.

## Examples

`see x = <literal>` compares as JSON wherever `x` is a `Json`: an answer's or event's field, or a
job's state field. The literal is a record or list literal in the spec's syntax; key order does
not matter; `nothing` is JSON null. Today `see … = { … }`/`[ … ]` is refused except `{}` on a body
(`parse.ts`, the `see … =` form); the parser accepts a record or list literal as a `see` value and
`checkFit` requires the target to be a `Json` (a record target keeps only `{}`, as today).

```
example "a notice carries its actions" {
  call notify with title = "Server down", actions = [{ type = "open", label = "Open" }]
  see notify.status = 201
  see notify.body.actions = [{ label = "Open", type = "open" }]      # the same JSON, any key order
  see noticeCreated.body.actions = [{ label = "Open", type = "open" }]
  restart
  call latest
  see latest.body.actions = [{ label = "Open", type = "open" }]      # stored and read back as it was
}
```

What an example cannot say: anything inside a `Json` by path (`see notify.body.actions[1].label`),
because the spec does not own that path. It compares the whole value, or `is absent`, or
`= nothing` on a `Json or nothing`.

## What it is not, and what comes after

- Not a way to read a value: no `its @payload's @classId`. The additive next step, when a spec
  needs it, is a typed read, `its @payload as a @Reservation, or … when it does not fit`, which
  checks the value against a record the spec owns at run time (the runtime's `check` does that
  already) and gives a `Reservation or nothing`. It changes nothing about `Json`.
- Not `open` records (B). If a spec wants known fields plus the rest, it declares the known ones and
  a `rest: Json`, once the other side writes it so.
- Not a schema language: a contract that knows the shape writes the record.

## Changes to the documents

**`docs/LANGUAGE.md`** (the reference says only what the language is):

- §3, the types line: `…, List T, Map T, Json, T or nothing, …`. After the `Map T` paragraph:

  > `Json` is a value whose shape the spec does not own: whatever JSON another system sends or
  > expects there (a notification's `actions`, which the host decides; a chat's `answer`; an
  > action's `payload`, whose shape belongs to another contract). An app holds it (`answer: Json or
  > nothing = nothing`, a record's field, a param, a payload), passes it on (`set`, `add … to`,
  > `call … with`, `publish … with`, `answer … with`) and compares it (`@a is @b`: the same JSON);
  > it never reads into it: `@answer's @text`, a template hole, `sorted by` it and a sentence about
  > what is inside are `TYPE`, and a screen does not show it. Any value fits a `Json` (a record of
  > your own goes out as its JSON: a `List Action` where the contract says `Json`), and a `Json`
  > fits only a `Json`. In JSON it is written as it is, with every object's keys in order (§9.22);
  > `null` inside it is a value, and a `Json` that is `null` is JSON null, not nothing (a `Json or
  > nothing` reads `null` as nothing, §9.18). In an example, `see notify.body.actions = [{ label =
  > "Open", type = "open" }]` compares it as JSON, in any key order; the literal is a record or
  > list literal, with a key that is not a name in quotes (`{ "x-id" = 1 }`). A spec's own record,
  > choice or type named `Json` keeps its meaning.

- §6, after the steps list: "`see x = <literal>` on a `Json` (an answer's or event's field, a job's
  state field) compares the whole value as JSON, in any key order; `nothing` is null."
- §9, a new default: "22. **Json.** A `Json` is written on the wire, in stored data and in a
  job's state as it arrived, with every object's keys in order (by their text, code point by code
  point) at every depth, so every build writes the same bytes; nothing else changes (a number as
  read, `null` kept). Two `Json` values are the same when that text is the same. A missing `Json`
  is required (§9.18); `null` is a value. A `Json` cannot be drawn."
- §7 (reserved names): unchanged. `Json` is read in its place, not reserved.

**`docs/STABILITY.md`**, §5, the `the wire` row, appended: "a `Json` value (since 1.1) is written
canonically: objects with their keys in code-point order at every depth, `null` kept, nothing else
changed; the same in stored data and in `calls()` and `stored()` of the host entries".

**`docs/CHANGELOG.md`**, in the 1.1 entry after unions: "and `Json` (a JSON value the spec does
not own: a notification's `actions`, a chat's `answer`, an action's `payload` for another contract;
held, passed on and compared, never read into — `TYPE`; canonical on the wire and in stored data,
keys in order, §9.22; any value fits it, it fits only itself; Elm `Json.Decode.Value` with
`sameJson`, TypeScript `Json`; a spec's own name `Json` keeps its meaning; an example compares it
with a literal, `see notify.body.actions = [{ label = "Open", type = "open" }]`; asked for by OurOS:
`record Ping` dropped every field it did not declare, so an action could only be scheduled with an
empty payload; docs/design/open-data.md; example: `lib/notify/noticesApi`,
`apps/api/notice-actions-api.intent`, `apps/45-notices.intent` and `apps/46-notices-watch.intent`,
twin-verified on both targets)".

**`docs/TOOLS.md`** §6: the `TYPE` row gains "a read into a `Json` (`@answer's @text`, a template
hole, `sorted by`, a sentence about what is inside), a `Json` where another type is needed"; the
`RANDOM` row "a `Json`"; the `NEEDS_LANGUAGE` row lists `Json` among the 1.1 forms. No new code:
every diagnostic is one that exists.

**`skills/intent-spec/SKILL.md`**: the version paragraph ("1.1 adds … and `Json`, a value whose
shape someone else owns: hold it and pass it on, never describe or read it"); §5e *Contracts
between services*, after "A payload with nothing to say is a record without fields": "A payload
whose shape belongs to someone else — the host decides a notification's `actions`, another
contract owns an action's `payload` — is `Json`: carry it, compare it, never read it. What you send
yourself you write as your own record; it fits a `Json` param as it is. Never declare an empty
record for it: an empty record drops every field it did not declare."; *Lessons from authors*:
"OurOS wrote `record Ping` for a free-form payload and every field arrived as `{}` (1.1: `Json`)."

## Test plan: write these first

Exact values; each is a failing test before the change.

1. **Runtime (`tests/api/runtime.ts`, a `Json` block like the maps block).** With
   `Notice = Record { title: Text; actions: Json }` and `J = { k: "Json" }`:
   - `JSON.stringify(fromWire({ title: "x", actions: [{ type: "open", label: "Open" }] }, Notice))`
     is `{"title":"x","actions":[{"label":"Open","type":"open"}]}` (the record's fields as
     declared; inside the `Json`, keys in order);
   - `JSON.stringify(toWire({ title: "x", actions: [{ type: "open", label: "Open" }] }, Notice))`
     is the same text;
   - passthrough: `fromWire([{ type: "open", label: "Open", payload: { deep: [1], a: null } }], J)`
     stringifies to `[{"label":"Open","payload":{"a":null,"deep":[1]},"type":"open"}]`;
   - `conforms({ 200: J }, { status: 200, body: null })` is `undefined` (null is a value);
     `conforms({ 200: Notice }, { status: 200, body: { title: "x" } })` is `answered 200, but the
     body.actions is required`;
   - `fromWire({ a: null }, Record { a: Maybe Json })` is `{ a: null }`, and so is `fromWire({}, …)`;
   - `__proto__`: `fromWire(JSON.parse('{"__proto__":{"p":1}}'), J)` has own key `__proto__` and
     `Object.getPrototypeOf(v) === Object.prototype`;
   - `migrate({ answer: { kind: "text", text: "hi" } }, { answer: J })` keeps it canonical
     (`{"kind":"text","text":"hi"}`), `migrate({ answer: "x" }, …)` keeps `"x"`, nothing dropped.
2. **Checker (`tests/checker/json.intent`; `tests/checker/load/json-needs.intent` and
   `json-own.intent` as `instant-needs`/`instant-own`).** `record Notice { title: Text; actions:
   Json }` (expect-not `SYNTAX`); state `stored answer: Json or nothing = nothing`, `last: Json =
   {}`, `many: List Json = []`, `title: Text = ""`, `n: Int = 0`; in a handler: `set @answer to its
   body's @answer` (expect-not `TYPE`), `set @last to @title` (expect-not `TYPE`: any value fits),
   `set @title to @last` (`TYPE`), `set @title to @last's @text` (`TYPE`), `set @n to the number of
   items in @last` (`TYPE`), `set @last to a random @Json` (`RANDOM`), `add @title to the end of
   @many` (expect-not `TYPE`); `text shown = "{@last}"` (`TYPE`); a derived list `sorted by
   @actions` (`TYPE`); `if @last is @answer` (expect-not `TYPE`); `see x.body.actions = [{ label =
   "Open", type = "open" }]` (expect-not `SYNTAX`) and the same on a `Text` field (`TYPE`); a spec
   on `language 1` with a `Json` (`NEEDS_LANGUAGE`); a spec with its own `record Json { x: Int }`
   and `j: Json = { x = 1 }` (no error: the spec's own record).
3. **The pair, twin-verified on both targets, first attempt** (the 1.1 habit): `lib/notify/
   noticesApi.intent` (contract: `record Notice { id: Int; title: Text; actions: Json }`;
   `endpoint notify POST "/notices" { body title: Text; body actions: Json; answers 201 Notice }`;
   `endpoint latest GET "/notices/latest" { answers 200 Notice; answers 404 Problem }`;
   `event noticeCreated: Notice`), `apps/api/notice-actions-api.intent` (named so because `apps/api/notices-api.intent` is an older, unrelated service; `stored notices: List Notice`;
   the example of the *Examples* section above, plus `see latest.body.actions = [{ type = "open",
   label = "Open" }]` in the other key order), `apps/45-notices.intent` (a screen on both targets:
   `record Action { label: Text; type: Text }`, a seeded `actions: List Action`, `on click send`
   calls `notify` with `@actions = @actions`, `on event notices.noticeCreated` adds its body to a
   stored list and sets `stored last: Json or nothing` to `its body's @actions`; example: `type
   "Server down" into draft`, `click send`, `see shown has 1 row`, `see title on row 1 = "Server
   down"`, `restart`, `see shown has 1 row`), and `apps/46-notices-watch.intent` (`profile job`:
   `on event notices.noticeCreated` sets `stored last: Json or nothing` and counts; example: `call
   notices.notify with title = "Server down", actions = [{ label = "Open", type = "open" }]`, `see
   count = 1`, `see last = [{ type = "open", label = "Open" }]`).
4. **Host entries, both targets (`tests/screen-host.test.ts`, `tests/job-host.test.ts` style, every
   platform global throwing).** Screen: after `click send`, `calls()` is exactly one
   `{ endpoint: "notices.notify", args: { title: "Server down", actions: [{ label: "Open", type:
   "open" }] } }` (compare as JSON text; the Elm build too); then `send({ on: "answer", target:
   "notices.notify", answer: { endpoint: "notices.notify", status: 201, body: { id: 1, title:
   "Server down", actions: [{ type: "open", label: "Open", payload: { deep: [1] } }] } } })`
   followed by the event, and `stored().last` is
   `[{"label":"Open","payload":{"deep":[1]},"type":"open"}]`; `start({ saved: stored() })` gives it
   back unchanged. Job: `run({ event: { event: "notices.noticeCreated", body: { id: 1, title: "x",
   actions: [{ type: "open", label: "Open" }] } } })` resolves with `last` equal to
   `[{"label":"Open","type":"open"}]`, `stored()` the same, and a `start({ transport, saved })`
   brings it back.
5. **Equality in an example** is step 3's two `see` lines in opposite key orders; both pass.
6. **The Elm alias compiles** (`type alias Json = D.Value` next to `import Json.Decode as D`): the
   Elm twin build of `apps/45-notices.intent` is the proof; if the Elm compiler refuses the name,
   the generated alias is mangled and the spec word stays `Json`.
7. `npm test`, `npx tsc --noEmit -p .`, `node compiler/cli.ts check apps/*.intent lib/**/*.intent`,
   and the snapshot (below).

## Where the code goes

The same files as the `Map T`/`Instant` commit (`ae62a3f`): `compiler/ast.ts` (`{ k: "Json" }`),
`compiler/parse.ts` (`parseType`, `literalFits`, `valueFits`, the `since` mark, the `see … =`
literal, `typeToString`), `compiler/fit.ts` (`fits`, `comparable`, the chain hop, the template
hole, the untyped-sentence rule), `compiler/draws.ts` (`notDrawable`), `compiler/calls.ts`
(`wireType`, `showT`), `compiler/api.ts` (`valueFor`), `compiler/registry.ts` (`apiOf`'s `ty`),
`compiler/print.ts`, `compiler/targets/shared.ts` (`usesTypeKind` for `Json`),
`compiler/targets/ts.ts` and `ts-service.ts` (`tsType`, `tsValue`, the prelude, `sameJson`,
`typeDescOf`, the rules), `compiler/targets/elm.ts` (`elmType`, `elmValue`, `elmDecoder`,
`elmEncoder`, the prelude and imports, `sameJson`, the rules), `runtime/ts/api.ts` (`TypeDesc`,
`describe`, `check`, `coerce`, `toWire`, `hasWire`), the four documents and the skill above, and
the specs and tests of the plan.

## Snapshot impact (`tests/harness/snapshot.txt`)

`docs/LANGUAGE.md` is read into every prompt (`compiler/prompt.ts`), so every `prompt`,
`prompt-probe`, `repair` and `invariants-prompt` row changes, for every spec and target: the price
of any addition to the reference. `runtime/ts/api.ts` is copied into every build that talks to an
api (an api, and a screen or job with `uses`: 66 rows today; a plain screen has none), so those
`api.ts` rows change. **Nothing else of an existing spec may change:** the preludes are emitted only
when a spec holds a `Json`, so every `spec.ts`, `src/Spec.elm`, `glue.ts`, `main.ts`, `test-entry`
and `screen-entry` row of an existing app keeps its hash, and a plain screen (`apps/01-counter`)
changes in its prompt rows alone; the review of the `--update` diff checks exactly that. The three new specs (and the contract's `client` row) add rows. A `Json`
nowhere in `apps/`, `lib/` or the fixtures except the new ones keeps the compatibility suite
(STABILITY §4) as it is.

## Open questions, with a recommendation

1. **`Json` or `Data`?** `Json`: `Data` is already the generated data record on both targets.
2. **Refuse a sentence that reads into a `Json`, or leave it to the model as a union's sentences
   are?** Refuse (`TYPE`). It is the one place two builds would differ with nothing to check them;
   the typed read comes later, as an addition.
3. **`null` inside a `Json or nothing`?** Nothing, by §9.18; a spec that needs JSON null says
   `Json`. A rule that reads null as a value there would be the first exception to §9.18.
4. **Shown on a screen?** No (`TYPE`), as a map is not shown. The job's state screen, which the
   harness writes, shows the canonical text so an example can `see` it.
5. **A record or list literal in `see` for a record-typed target too?** Not now: only `{}` stays
   allowed there, as today. Lifting it is a separate addition.
6. **Join 1.1 or open 1.2?** 1.1, while it is unreleased: one `since` string moves it if 1.1 is
   stamped first.

## On the OurOS side

The kern's contract adapter maps a schema `{ "type": "object" }` without `properties` (and an array
of them) to `Json`, and keeps refusing `additionalProperties` with a schema until `Map T` covers
it; the three fields above change type from an empty record to `Json`, a major version of the
bundles it writes, which the kern owns on both sides. A built component then carries a
notification's actions, a chat answer and a trigger's payload as the kern sent them.
