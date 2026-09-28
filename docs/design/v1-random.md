# Design: random values (v1)

Status: built in v69 (see "As built" at the end); proposed for v1. Next to the clock (§3b) this is the second value the harness owns
because no build may choose it: a code, a die, a shuffle. Today the only random value is the
server's `@newToken` (32 hex characters, `token-1`, `token-2`, … in tests), and specs that need
anything else improvise. The third held-out round shows how: `apps/held-out-3/lockers-api.intent`
makes a six-digit pickup code from "the first 6 digits (0 to 9) in the @sha256 of @newToken, padded
with 0 at the end when it has fewer". The code works, but the sentence carries four judgements
(which digits, what padding, what distribution, whether codes may repeat), and its example has to
hard-code `"308122"`, the digest of `token-1`. The changelog lists the gap twice ("effects the
harness owns, such as randomness with a seed"; "a random code of digits or letters of a given
length"). The spec-writing skill tells authors that it has no form yet.

**Recommendation: in v1.** The need shows up in many kinds of app (invites, pickup and reset
codes, ids that cannot be guessed, games, sampling), the mechanism belongs to the harness, and it
fits the existing shape of the clock: an input the harness supplies, which tests steer.

## Sources, and where this design follows or departs from them

| Source | What it says | Here |
|---|---|---|
| Elm `elm/random`: `Random.generate : (a -> msg) -> Generator a -> Cmd msg`, `Random.step : Generator a -> Seed -> (a, Seed)`; the docs say the generator is not cryptographically secure | Randomness is an effect handed to the runtime; a pure program only ever sees a value or a seed | **Follows.** An app never makes randomness. The harness passes draws in with the event, as it passes the clock. **Departs:** no `Seed` threaded through the model and no non-secure generator (below). |
| Salmon, Moraes, Dror, Shaw, "Parallel random numbers: as easy as 1, 2, 3" (SC'11, Philox/Threefry); JAX `random.split` / `fold_in`; Steele, Lea, Flood, "Fast splittable pseudorandom number generators" (OOPSLA'14, SplitMix, used by QuickCheck) | Counter-based and splittable generators: a value is a pure function of (key, counter). It does not depend on how many values were taken before it, so parallel or reordered code gets the same numbers | **Follows**, and this is what makes twin builds work: a draw is `PRF(eventSeed, site, index)`, so two builds that evaluate in a different order, or that evaluate a draw they then discard, still see the same values. |
| NIST SP 800-108r1 (KDF in counter mode with HMAC); NIST SP 800-90A (HMAC_DRBG) | HMAC-SHA-256 keyed with a secret, over a counter and a label, is an approved way to derive many independent values from one secret | **Follows.** In production each event's seed is 256 bits from the operating system's CSPRNG and the PRF is HMAC-SHA-256, built from the reviewed `sha256` that `std.crypto` already ships for both targets (`runtime/ts/platform/std.crypto.ts`, `runtime/elm/Crypto.elm`). |
| Claessen & Hughes, QuickCheck (ICFP 2000); Hypothesis docs (`@seed`, `derandomize`, the example database: "the next time the test is run, Hypothesis will replay any failures"); MacIver & Donaldson, "Test-case reduction via test-case generation" (ECOOP 2020) | Tests generate random inputs from a reported seed, replay failures, and shrink them to the simplest failing input by simplifying the underlying choices | **Follows** in random sessions: each session has a seed (as today), draws are biased toward edges, and a failure is shrunk and reported as ready-to-paste `steer random` steps. **Departs:** examples do not generate. They are fixed proofs, and a draw in an example is either steered or comes from a seed derived from the example's name (like Hypothesis's `derandomize`, but per example, so adding an example changes no other one). |
| OWASP ASVS 5.0, V11.5.1: "all random numbers and strings which are intended to be non-guessable must be generated using a cryptographically secure pseudo-random number generator (CSPRNG) and have at least 128 bits of entropy"; OWASP Cryptographic Storage Cheat Sheet (`Math.random` is not secure; use `crypto.getRandomValues`) | Secure randomness for anything that must not be guessed; 128 bits for tokens | **Follows**, as a default and not a choice: every draw is secure. Entropy is computed per type, and the checker warns under 128 bits when a random type is accepted as input (`GUESSABLE`). |
| Go 1.22, "Secure randomness in Go 1.22" (Russ Cox, 2024): `math/rand` became ChaCha8 because "Go aims to help developers write code that is secure by default" | Developers pick the fast generator by mistake, so make the default secure | **Follows, further:** there is only one generator. A spec author cannot know whether a "random order" will later be used to hand out a prize, and the cost (one HMAC per draw) is negligible for an app. |
| NIST SP 800-63B-4, §3.1.2.1 (look-up secrets "at least six decimal digits"), §3.2.2 (at most 100 consecutive failed attempts) | Short codes are acceptable only with attempt limits | **Follows** in the `GUESSABLE` message: a six-digit code is 20 bits and needs an attempt limit. The limit itself is not in this design (it is a layer, `std.http.limit`, later). |
| NanoID (Node `crypto` / Web Crypto; no `random % alphabet` because of the bias; 21 symbols ≈ 126 bits); Lemire, "Fast random integer generation in an interval" (ACM TOMACS 2019); Fisher–Yates as Durstenfeld (CACM 1964) and Knuth TAOCP vol. 2, Algorithm P | Uniformity needs rejection, not modulo; shuffles are Fisher–Yates | **Follows.** The harness guarantees exact uniformity (rejection sampling for ranges and alphabets, Fisher–Yates for shuffles); no build writes its own. |
| Crockford Base32: 10 digits and 22 letters, without I and L (confused with 1), O (with 0) and U; on decoding, lower case is accepted and `i`/`l` are read as 1 and `o` as 0 | An alphabet for codes that people read out and type | **Follows**, as the named alphabet `unambiguous letters and digits`, including the forgiving read on input. |
| RFC 9562 (UUIDv4: 122 random bits; UUIDv7: a 48-bit Unix-millisecond timestamp and 74 other bits; "MUST NOT assume that UUIDs are hard to guess … MUST NOT be used as security capabilities"); ULID (48-bit time + 80 random bits, Crockford) | Standard id formats, some ordered by time | **Departs for v1:** no UUID or ULID type. An opaque id is `Text of 22 letters and digits` (131 bits, more than UUIDv4). The formats matter for interoperation, not for behaviour, and v7/ULID bring in the clock and monotonicity rules. `NOT_YET` (open question 4). |
| Birthday bound: with n values drawn from N, P(some two equal) ≈ 1 − e^(−n²/2N) | When codes must be unique, the chance of a repeat is not negligible for small N | **Follows:** the checker computes it. A `key` filled from a draw must say `not among` unless the type has 128 bits or more (`COLLISION`). |

## The language

### 1. A random value comes from a type

A value is drawn from a **type that says exactly which values exist**, so the type is the space.
This reuses refined types (§3a) and adds one refined form, the code:

```
type PickupCode = Text of 6 digits                              # 10^6 values, 19.9 bits
type InviteCode = Text of 8 unambiguous letters and digits      # 32^8, 40 bits; read forgivingly
type ApiToken = Text of 32 letters and digits                   # 62^32, 190 bits
type Die = Int from 1 to 6
choice Suit: Hearts | Diamonds | Clubs | Spades
```

`Text of <n> <alphabet>` is a text of exactly n characters from the alphabet. It is a refined type
like the others: seed data, defaults, literals and api input are checked against it (`400 {"error":
"code must be a valid PickupCode"}`), and `is a valid @PickupCode` means exactly that. The alphabets
are a closed set:

| Alphabet | Characters | Bits per character |
|---|---|---|
| `digits` | `0`–`9` | 3.32 |
| `hex digits` | `0`–`9`, `a`–`f` | 4 |
| `capitals and digits` | `A`–`Z`, `0`–`9` | 5.17 |
| `letters and digits` | `A`–`Z`, `a`–`z`, `0`–`9` | 5.95 |
| `unambiguous letters and digits` | Crockford's 32: `0`–`9` and `A`–`Z` without `I L O U` | 5 |
| `from "…"` | the characters given, each once, at least two | log2 of the count |

An `unambiguous` code is always made in capitals. As input (a request body, a field checked with
`is a valid`) it is read Crockford's way: lower case is accepted, `o` and `O` are read as `0`, and
`i`, `I`, `l` and `L` as `1`. The value is normalised before the app sees it, so `"k7mq-…"` typed by a
person matches the stored code.

### 2. Draw forms

Five forms, all typed (they join the operator table in §2):

| Form | Takes | Gives |
|---|---|---|
| `a random @T` | `T` is a choice, an `Int from a to b` (both bounds), or a `Text of n …` | a `T` |
| `a random @T not among <list of T>` | as above, and a list of `T` (`the @code of @waiting`, `@usedCodes`) | a `T` when the type has at least 2^64 values, else a `T or nothing` |
| `<n> random @T` | `n` a whole number (literal or Int) | a `List T` (independent: values may repeat) |
| `a random one of @xs` | a list | an item, or nothing (the list may be empty) |
| `@xs shuffled` | a list | the same list in a random order |

Every draw is uniform over its space. Anything else (weights, a random decimal, a normal
distribution) is `NOT_YET`. Drawing "without repeats" reuses a shuffle, and needs no new form:
`the first 6 of @balls shuffled`.

**Each draw is one value.** A draw in a step gives a new value each time the step runs (and each row,
in a `for each`). To use it twice, keep it and refer to it: `add an @ApiKey … with @secret = a
random @ApiToken`, then `answer 201 with … @apiKey = the new api key's @secret`. Two draws of one type
in one endpoint where the second is in an `answer` step get a `REDRAW` hint: an endpoint that stores one token and
answers another is the usual mistake (it is what `@newToken`, one value per request, used to hide).

**Uniqueness is asked for, never assumed.** `not among` excludes the values given. When the type is
small enough to run out (under 2^64 values), the result is `T or nothing`, and the sentence says
what happens when none is left, as it does for a lookup (else `UNGUARDED`):

```
endpoint deposit {
  - …
  if there is no @freeCode {
    answer 503 "No pickup code is free"
  }
  - set the new parcel's @code to @freeCode
}

derive {
  freeCode = a random @PickupCode not among the @code of @waiting
}
```

(A derived value with a draw has one value per event, wherever it is read: the guard and the step
above see the same code, as long as the list it excludes has not changed in between. This follows from how draws are made (below: the value depends on the
event, the site and the index, never on how often it is read). `@now` behaves the same way.)

### 3. Examples: steering

Examples do not depend on the values a seed happens to give. Where an example needs to know a value,
it steers it, as `steer pay lose answer` steers an api and `wait 1d` steers the clock:

```
steer random PickupCode = "308122"           # the next PickupCode drawn is this one
steer random Die = 6, 6, 1                   # the next three dice
steer random Suit = Spades
steer random shuffle keeps order             # the next shuffle leaves the list as it is
steer random shuffle reverses order          # … or turns it around
steer random pick 3                          # the next `a random one of` takes the third item
```

- A steered value is used by the next draw of that type, in the step that follows or later. Values
  queue in the order written.
- The checker checks each steered value against its type (`TYPE`: `"12345"` is not a PickupCode)
  and that the type is drawn somewhere in the spec (`STEP`: a type never drawn cannot be steered).
- A steered value that is excluded by `not among` is skipped, just as a real draw of it would be.
  That lets an example prove the collision path: steer the used value first, then a fresh one.
- A steered value still queued when the example ends fails the example ("steered PickupCode
  `"111111"` was never drawn"). That catches a draw that did not happen where the author expected.
- An unsteered draw in an example comes from a seed derived from the example's name. It is the same
  in every run and every build, and adding or changing another example does not change it. An
  example may carry such a value forward (`call pickup with code = {deposit.body.code}`), but a
  `see` of it as a literal gets `UNSTEERED`: that value changes when the spec's draws change.

## Three specs

**A parcel locker's pickup code** (the held-out lockers api, rewritten; the held-out file itself is
left as its author wrote it):

```
type PickupCode = Text of 6 digits          # in the bundle lockers.lockers

derive {
  freeCode = a random @PickupCode not among the @code of @waiting
}

endpoint deposit {
  if there is no locker in @empty whose @size is @body.size {
    answer 409 "No {size} locker is free"
  }
  if there is no @freeCode {
    answer 503 "No pickup code is free"
  }
  - add a @Parcel to the end of @parcels with @locker = the lowest @number of the @empty whose @size is @body.size, @code = @freeCode, @depositedAt = @now and @expiresAt = 72 hours after @now
  answer 201 with a @Deposit with @locker, @code and @expiresAt of the new parcel
}

always {
  - no two @parcels in @waiting have the same @code
}

example "two parcels never share a code" {
  steer random PickupCode = "308122", "308122", "555001"
  call deposit with header x-api-key = "k-courier-a1", size = Small
  see deposit.body.code = "308122"
  call deposit with header x-api-key = "k-courier-a1", size = Small
  see deposit.body.code = "555001"             # "308122" is taken, so it is skipped
}

example "a wrong code is refused" {
  steer random PickupCode = "308122"
  call deposit with header x-api-key = "k-courier-a1", size = Small
  call pickup with number = 1, code = "308123"
  see pickup.status = 403
}
```

**Invitations with codes people read out** (a new api):

```
app InvitesApi {
  "A team owner invites people with a code they can read over the phone; a code works once."
}
profile api

type InviteCode = Text of 8 unambiguous letters and digits

record Invite {
  key code: InviteCode
  email: Text
  used: Bool = false
}

state {
  stored invites: List Invite = []
}

endpoint invite POST "/invites" {
  body email: Text
  returns Invite
  - add an @Invite to the end of @invites with @code = a random @InviteCode not among the @code of @invites and @email = @email trimmed
  answer 201 with the new invite
}

endpoint accept POST "/invites/{code}/accept" {
  path code: InviteCode
  if there is no invite in @invites whose @code is @path.code {
    answer 404 "No such invitation"
  }
  if that invite is @used { … }
  …
}

example "a code is read forgivingly" {
  steer random InviteCode = "K7MQ0R1Z"
  call invite with email = "ann@example.com"
  see invite.body.code = "K7MQ0R1Z"
  call accept with code = "k7mqor1z"           # lower case, o for 0: the same code
  see accept.status = 200
}
```

`code` is the key, 40 bits, so `not among` is required (`COLLISION` otherwise). The code is also
accepted as input with 40 bits, so the checker warns `GUESSABLE`: with no attempt limit, codes can be
guessed. The honest answers are a longer code or an attempt limit.

**Dice and a deck** (a screen):

```
app Table {
  "Roll two dice, or deal five cards from a shuffled deck."
}

type Die = Int from 1 to 6

state {
  first: Die = 1
  second: Die = 1
  rolled: Bool = false
  deck: List Card = table { … 52 rows … }
  hand: List Card = []
}

derive {
  total: Int = @first plus @second
}

screen {
  button roll "Roll"
  text total = "{total}" {
    visible when @rolled
  }
  button deal "Deal"
  list hand of Card {
    text name
  }
}

on click roll {
  - set @first to a random @Die
  - set @second to a random @Die
  - set @rolled to true
}

on click deal {
  - set @hand to the first 5 of @deck shuffled
}

always {
  see total is at least 2
  see total is at most 12
  - no two cards in @hand have the same @name
}

example "a double six" {
  steer random Die = 6, 6
  click roll
  see total = 12
}

example "dealing from an unshuffled deck gives the top five" {
  steer random shuffle keeps order
  click deal
  see hand has 5 rows
  see name on row 1 = "Ace of Hearts"
}
```

The two dice are two draws on purpose: two values. `2 random @Die` gives the same as a `List Die`,
for a game that rolls a handful.

## Checker

| Code | Level | When |
|---|---|---|
| `RANDOM` | error | `a random @T` where `T` has no finite, listed space: a `Text matching /…/`, a `Text of length …`, an `Int from 0` (one bound), a `Decimal`, a record; `not among` with a list of another type; `a random one of` something that is not a list; `<n> random` with a non-whole `n`. The message names the form that works (`type PickupCode = Text of 6 digits`). |
| `BAD_BINDING` | error | a `Text of n from "…"` with repeated characters or fewer than two; `n` below 1 |
| `COLLISION` | error | a record's `key` is filled from a draw without `not among` while the type has fewer than 2^128 values. The message gives the birthday estimate: "a repeat is likely (50 %) after about 1,180 PickupCodes" |
| `UNGUARDED` | warning | (existing) a `not among` draw of a small type, or `a random one of`, used without saying what happens when there is none |
| `TYPE` | error | (existing) a steered value that is not of its type, or a draw put where its type does not fit |
| `STEP` | error | (existing) `steer random X` where `X` is never drawn; `steer random shuffle …` in a spec with no shuffle |
| `RESERVED` | error | (existing) `random` as an api alias (it is the steering target) |
| `REDRAW` | warning, std.quality | an endpoint draws a type and then draws it again in an `answer` step: keep the first and refer to it (`the new api key's @secret`) |
| `UNSTEERED` | warning, std.quality | an example `see`s a literal of a drawn type (`"308122"` against a `PickupCode` value) without a `steer random` of that type before it |
| `GUESSABLE` | warning, std.quality | a random type under 128 bits is accepted as input (a `path`, `query` or `body` param): it can be guessed, so it needs an attempt limit or more characters (OWASP ASVS 11.5.1; NIST SP 800-63B-4 §3.2.2) |
| `SPELLING` | warning, std.quality | `@newToken`: write `a random @Token` (`std.text` gives `type Token = Text of 32 hex digits`); `intent fix` rewrites it when the endpoint uses it once |

`intent check --typed` counts draws as typed. `intent expand` and the printer show each random type's
size ("PickupCode: 1,000,000 values, 19.9 bits").

## Harness and runtime

**One source, keyed by place.** Every draw is `PRF(eventSeed, site, index)`:

- `eventSeed`: 32 bytes per event (a click, a request, a tick, an `every` run). In production it
  comes from `crypto.getRandomValues` (browser) or `randomBytes` (Node). In tests it comes from
  `HMAC(runSeed, eventNumber)`, where `runSeed` is the example's seed (from its name) or the random
  session's seed. The event number keeps counting across a `restart`, so a restarted app does not
  draw the same values again.
- `site`: the checker gives each draw in the spec an id, `<unit>#<n>` (`endpoint deposit#1`,
  `on click roll#1`, `derive freeCode#1`), stable when unrelated parts of the spec change. The source
  map lists the draws (`draws`: id → file:line, type, size in bits).
- `index`: the position within the draw (the nth die of `2 random @Die`, the nth swap of a shuffle,
  the nth attempt of a `not among`, the row of a `for each`).
- `PRF` is HMAC-SHA-256 on both targets, from the reviewed `sha256` of `std.crypto`. Bytes become
  values by rejection sampling (no modulo bias). `not among` rejects taken values; when half or more
  of a small space is taken, it lists the free values and picks one of them uniformly, so it always
  ends and stays uniform. Shuffles are Fisher–Yates.

Because a value depends only on its place and never on how many draws came before, two builds that
evaluate differently (Elm's eager `let` against a TypeScript `if`) see the same values. This is the
counter-based idea of Philox and JAX, and the reason not to thread a seed through the model as Elm's
`Random.step` does.

**What the LLM sees.** The generated interface gets a typed function per draw site, as it gets the
`Clock`: `draws.deposit1(taken: PickupCode[]): PickupCode | null`, `draws.roll1(n: number): Die[]`,
`draws.deal1<T>(xs: T[]): T[]`, passed with the event as the last argument (`update(msg, model,
clock, draws)`; in Elm a `Draws` record in `Spec.elm`, implemented in the runtime's `Draw.elm`). The
prompt says: call a draw only where its sentence runs, and nowhere else. A build whose app module
uses `Math.random`, `crypto`, `Date.now` or Elm's `Random` is rejected before its examples run
("draws come from the harness").

**Steering in tests.** The executor keeps a queue per type. The first time a (site, index) is asked
for in a step, it takes the head of its type's queue if there is one, else the seeded value, and
remembers the answer for that (site, index). A build that asks for a draw on a path that does not
run takes a steered value too early; the "steered but never drawn" failure and the twin comparison
show that (open question 2).

**Random sessions** (the fuzzer, `compiler/fuzz.ts`) draw from the session seed, which is already
reported. They lean toward edges, about one draw in five: an Int range's bounds; the first and the
last character of an alphabet; a value that is already taken, for `not among` (so the rejection
path runs); keeping or reversing the order of a shuffle; `a random one of` an empty list when the
spec allows one. On a failure they shrink the draws: each is replaced by the simplest value of its
type (the lowest number, the first choice value, a code of the alphabet's first character, the list
unshuffled) for as long as the failure remains. The report lists the steps with `steer random …`
lines, ready to paste as an example. `always` sentences such as "no two @parcels in @waiting have
the same @code" are then checked over every session's draws: property-based testing, with the
spec's own properties.

**Twin builds** get the same seeds in every example and session, so they must agree on every value.
A build that makes its own randomness is rejected before it runs, and a twin that consumes a draw
differently diverges at that step, with the step named.

**Production.** Browser: Web Crypto. Server and jobs: Node `crypto`. Elm: the glue passes the event
seed through the same port that carries the clock, and `Draw.elm` computes the values in Elm, so
Elm never needs `Random`. A screen's draws are secret from other people but not from the user of
that browser: a code that protects something from other users (an invitation, a pickup code) is
drawn by the service. The reference says so.

## Changes to the reference

- §3a: `Text of n <alphabet>`, the alphabet table, the forgiving read of `unambiguous`.
- §2 operator table: the five draw forms.
- A new §3c "Chance", next to §3b "Time": draws, one value per draw, `not among`, secure by default,
  and "in tests the chance is the harness's".
- §4e: `@newToken` is replaced by `a random @Token` (kept one version with `SPELLING`).
- §6: `steer random …` steps.
- §7: the codes above. §9.8: "Time and chance have no randomness in tests: both come from the
  harness."
- Skill (`skills/intent-spec/SKILL.md`): a "Chance" section (draw from a type, `not among` for
  anything unique, steer in examples, never compare a seeded value literally), the lockers lesson,
  and the version line.

## Test plan

Checker (`tests/checker/random.intent`, `# expect:` lines as usual):

```
type Code = Text of 6 digits
type Bad = Text of 3 from "aab"                        # expect: BAD_BINDING
type Email = Text matching /[^@]+@[^@]+/
type Open = Int from 0
record Parcel {
  key code: Code
}
…
- set @pin to a random @Email                           # expect: RANDOM
- set @n to a random @Open                              # expect: RANDOM
- add a @Parcel to the end of @parcels with @code = a random @Code    # expect: COLLISION
- set @pin to a random @Code not among @used            # expect: UNGUARDED   (Code is small)
- set @hand to a random one of @deck                    # expect: TYPE        (a Card or nothing into a List)
steer random Code = "12345"                             # expect: TYPE
steer random Suit = Spades                              # expect: STEP        (Suit is never drawn)
```

Plus: `tests/checker/load/random-api.intent` for `GUESSABLE` (a body param of a 20-bit type) and
`REDRAW`; `tests/quality.test.ts` for `UNSTEERED`; `tests/fix.test.ts` for `@newToken` →
`a random @Token` (fixed once, left alone when used twice).

Runtime (`tests/random.test.ts`):

- the same (seed, site, index) gives the same value in TypeScript and Elm (the `Draw.elm` port run
  through the Elm test worker), on a table of vectors;
- uniformity: chi-square over 100,000 draws of `Int from 1 to 6`, `Text of 1 from "abc"` (3 is not a
  power of two, so modulo bias would show), and all 120 orders of a five-item shuffle;
- `not among` terminates and stays uniform with 5 of 6 values taken, and gives nothing with all 6
  taken;
- Crockford reading: `"k7mqor1z"` normalises to `"K7MQ0R1Z"`; `"U"` is invalid;
- the ban: a generated module that contains `Math.random` is rejected.

Examples and measurement:

- `apps/31-table.intent` (dice and a deck, screen; both targets);
- `apps/api/invites-api.intent` (unambiguous codes, a key drawn `not among`, the forgiving read);
- `apps/api/lockers-codes-api.intent`: the lockers api with `a random @PickupCode`, next to the
  held-out original, which stays as its author wrote it;
- `apps/api/members-api.intent` migrated from `@newToken`;
- a planted bug per app, to check that the measurement is sound: a build that ignores `not among`
  must fail "two parcels never share a code"; a build with `Math.random` must be rejected; an
  off-by-one die (0 to 5) must be caught by a random session through `always`;
- `intent converge` before and after on these apps and on every app that used `@newToken`; the
  harness snapshot changes only for specs with draws, and for the prompt's new "Chance" lines.

## What is not in v1

- **UUID and ULID** formats (`NOT_YET`): an opaque id is `Text of 22 letters and digits`. Add them
  when a contract must speak those formats. v7/ULID also need a monotonic rule within one
  millisecond.
- **Weights, decimals and distributions** (`NOT_YET`): no app has needed them. When one does, it will
  be a weighted choice (`choice Prize: Car 1 | Nothing 99`) and not a float.
- **Seeds chosen by the user** (a daily puzzle, a replayable level): that is not chance but a
  function of the date or of a number, and is written as one (`the word at position … of @words`).
- **`secret` types** (constant-time comparison, kept out of logs and traces): useful, and a small
  follow-up; `GUESSABLE` covers the main risk for now.

## Open questions, with a recommendation

1. **`T or nothing` for small `not among` draws: is 2^64 the right line?** Recommend yes. Below it a
   space can run out in a real app (a million six-digit codes), and the language's rule is to say what
   happens when there is none. Above it, running out would take more rows than any store holds, and
   asking for a guard there would teach authors to write guards that never run.
2. **A draw asked for on a path that is not taken** consumes a steered value. Recommend: accept it
   in v1, with the prompt rule, the "steered but never drawn" failure and twin comparison as the
   net. The alternative, assigning steered values to sites after the step in a canonical order,
   cannot work, because the value is needed while the step runs.
3. **Seeded values in examples: opaque, or a readable sequence like `token-1`?** Recommend opaque,
   from the example's name. A readable sequence cannot be valid for every type (`token-1` is not
   hex), and a seeded value that is stable but unreadable nudges authors toward `steer`, which says
   what the example means.
4. **UUIDs now?** Recommend no (above). Revisit with the first contract that needs them.
5. **Should a screen be allowed to draw a `Text of n` at all?** Recommend yes (a local game, a
   draft id) with the reference's warning. A checker rule cannot tell a private draft id from an
   invitation.

## As built (v69), and where it departs

Built in v69 on top of v66's nothing-safety (a small `not among` is a `T or nothing`, handled like
any other: `NOTHING`, never a forced unwrap), v67's change rules and v68's lists inside rows. The
open questions are answered as recommended: the line is 2^64 (1), unsteered example values are
opaque and come from the example's name (3), no UUIDs (4), a screen may draw codes, with the
reference's warning (5). Question 2 is answered differently (below). What was built:

- **The language.** `Text of <n> <alphabet>` (`RefinedDecl.code`; the alphabets are
  `compiler/alphabets.ts`), the five forms typed in `fit.ts` (and `the first 5 of @xs`, which a deal
  needs: `the first 5 of @deck shuffled` is five of the shuffled deck), `steer random …` steps (a
  step of its own, `do: "random"`), and the checks in `compiler/draws.ts`: `RANDOM`, `COLLISION`,
  `STEP`/`TYPE` for steering, `RESERVED` for an alias `random`, `BAD_BINDING` for an alphabet.
  std.quality has `REDRAW`, `UNSTEERED`, `GUESSABLE` and `SPELLING` for `@newToken`; `intent fix`
  rewrites a single `@newToken` to `a random @Token` and imports `std.text`, which has `type Token =
  Text of 32 hex digits`. `intent expand` notes each code's size (`1,000,000 values, 19.9 bits`),
  `intent check --typed` counts draws as typed, and `sourcemap.json` has `draw <id>` entries.
- **The runtime.** `runtime/ts/draw.ts` and `runtime/elm/Draw.elm`: HMAC-SHA-256 on the reviewed
  SHA-256 of std.crypto, which now also works on bytes (`sha256Bytes`, the same code), rejection
  sampling, `not among` that lists the free values when half or more are taken, Fisher–Yates. 98
  vectors (every form, a non-ASCII alphabet, a range of 3 billion) give the same values on both
  targets (`tests/random.test.ts`, through the Elm of the parity test); chi-square bounds hold for
  a die, `Text of 1 from "abc"`, all 120 orders of a five-item shuffle and Crockford's alphabet.
- **What the LLM sees.** A `Draws` type with one function per site (`roll1()`, `deposit1(taken)`,
  `deal1(xs)`), `drawsFrom(src)` generated by the harness. TypeScript: the last argument of
  `update`; Elm: right before the message (`update : Clock -> Draws -> Msg -> …`, after the route);
  an endpoint's handler gets it third, recurring work after the clock. A module that uses
  `Math.random`, crypto or `import Random` is rejected before its examples run.
- **Seeds.** Browser: 32 bytes of Web Crypto per event (TypeScript); Elm gets a base seed in its
  flags and derives each event's seed with a counter (`Draw.fromBase`), since Elm cannot ask the
  platform for bytes. Server: 32 bytes from `randomBytes` per request. Tests: HMAC(SHA-256(the
  example's name), event number); a trace's seed is the hash of its actions, a random session's is
  its own seed.

Departures:

- **Steered values go by the spec's order, not by the order a build asks (open question 2).** The
  design accepted consumption in evaluation order. Built that way, the first Elm stand-in failed
  `steer random Die = 2, 5`: Elm emits independent `let` bindings bottom-up, so it asked for the
  second die first. With values queued, the test entry (TypeScript's test entry, Elm's worker, the
  api pipeline) now runs the update twice: once with a steer that only notes the places asked (on a
  copy of the model, its result dropped), then for real, with the queued values planned onto those
  places in site order (site, row, index). A place the real run reaches that the first did not (a
  taken value skipped, another branch) still takes the next queued value; a planned value its place
  did not use goes back to the front of its queue. Updates are pure, so the two runs agree; the cost
  is one extra run of an update, in tests only, and only when something is steered. The Elm side
  reads the driver's steering through a JavaScript object (a `Proxy`) decoded with `Json.Decode`,
  which is also how Elm tells the driver what it drew.
- **The row is its own coordinate.** A place is (site, row, index): the row of a `for each`, and the
  index within the draw (the n-th die, the n-th attempt of `not among`). A draw in a loop inside a
  loop is `NOT_YET`.
- **Where draws may be.** In handlers, endpoints, recurring work and an api's derived values. A
  screen's derived value, an element, `always` and `on start` are `RANDOM`: a screen shows state,
  and a draw in what is computed each time it is shown would change on every look.
- **An `Int` range is drawn up to 2^32 values** (one 32-bit word per rejection try, the same in Elm);
  larger is `RANDOM`, with a code (`Text of 12 digits`) as the way out.
- **`UNGUARDED` is `NOTHING`** (v66 replaced it), for a small `not among` and for `a random one of`.
- **Random sessions.** The driver hands out edge values (about one draw in five) itself and hears
  every value drawn, so each action of a session is written with the `steer random` steps of the
  draws before it: a replay, a shrunk session and a pasted example draw the same on any build and any
  seed. A shuffle that was neither kept nor reversed cannot be written as a step; shrinking tries
  "keeps order" (every draw at its simplest, after the steps are shrunk). Api sessions, made from the
  spec alone, steer edge codes before some calls (sometimes the same one twice, so `not among` must
  skip it).
- **The ban** covers `Math.random`, Web and Node crypto and Elm's `Random` in the module the LLM
  writes (comments do not count); `Date.now` is a matter of the clock and is left to its rule.
- **The lockers api.** At the caller's request the held-out `apps/held-out-3/lockers-api.intent`
  itself draws its pickup code (instead of a copy next to it); its contract is unchanged, so running
  out of codes answers 409 (declared) rather than 503, and `lockers.lockers` declares
  `PickupCode = Text of 6 digits` (the same values as its old pattern). `apps/api/members-api.intent`
  draws its keys (`a random @Token`), and the design's table and invitations are
  `apps/36-table.intent` and `apps/api/invites-api.intent` (which keeps its `GUESSABLE` warning: a
  40-bit code with no attempt limit, as the design says).
- **Measured without an LLM** (`tests/random-builds.test.ts`): stand-in modules for the table on both
  targets and for the invitations api pass every example; the same session gives the same screens on
  Elm and TypeScript; a planted off-by-one die is caught by a random session through `always`, and
  a build that ignores `not among` fails the example that proves it.

