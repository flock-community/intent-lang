# Intent: a language-design review

Reviewed: `docs/LANGUAGE.md` (the header says v5, the changelog goes to v10), `AGENTS.md`,
`skills/intent-spec/SKILL.md`, `apps/02-todo`, `09-board`, `13-crm`, `06-expenses`,
`apps/held-out/events` and `inventory`, every bundle in `lib/`, `intent.lock`,
`compiler/load.ts`/`parse.ts`/`llm.ts`, and the held-out run `runs/r14-heldout/report.md`.
Date: 2026-09-23.

---

## 1. Summary: the five most important recommendations, ranked

1. **Give behaviour sentences a small structured grammar. Leave only the leaves free.**
   Guards and early exits, "A when C; otherwise B" values, list operations, and template
   holes should be forms that the parser recognises and checks. Free English should stay
   only inside conditions and phrases, where the checker can still anchor it. The held-out
   specs already say "do nothing else" / "skip all remaining steps (… stay unchanged)" /
   "do not add anything" for the same thing, and they use three template syntaxes. This is
   the AppleScript/Inform 7 lesson (easy to read, hard to write) and the EARS/ACE lesson
   (constrained English removes ambiguity without losing readability). *Large.*
2. **Make identity and references first-class, and write defaults for dangling
   references and empty selections.** Today relations are text columns documented in
   comments (`contact: Text  # the name of the contact`, `title: Text  # unique; sign-ups
   refer to it`). Every divergence in the held-out run came from this silence: builds
   disagreed on `"Managing ."` and `"Cannot pick 5 × : only 0 in stock"`, which are states
   where a `select … from` value points at nothing. The checker reported 0 warnings. This is
   the Terraform `count` → `for_each` lesson: identity by position or by accident breaks
   first. *Large.*
3. **Check the real invariants, not screen proxies.** `always` can only count rows on
   screen, so the important rules stay unchecked prose in `rules` ("the number of
   Confirmed signups never exceeds its capacity"). Authors then write proxies that happen
   to be true, such as `see attendeeList has at most 10 rows`, where 10 is simply the
   largest capacity in the seed data. Add a small, closed expression form for model-level
   properties (each/unique/count/sum), and warn about every `rules` sentence that has no
   check. Evidence: QuickCheck, Alloy's small-scope hypothesis, TLA+ at AWS, design by
   contract. *Large.*
4. **Turn bundles into versioned behavioural contracts.** Examples should live in the
   bundle. `intent diff` should compute the semantic version from the public names *and*
   from the examples, which goes beyond Elm, whose enforced semver sees only types. Imports
   should be namespaced instead of sharing one flat namespace, and design should be applied
   explicitly instead of as a side effect of `import`. Registry versions should be
   immutable and resolved by minimal version selection. Today `std.feedback` has no
   examples at all, the lock has hashes but no versions, and one `intent.lock` serves every
   app in the repo. *Large (in stages).*
5. **Pin the whole compiler, not only the bundles, and let each spec declare its
   language version.** "Same spec in, same app out" is the core claim. But the model comes
   from an environment variable (`INTENT_MODEL ?? "claude-opus-5-5"`), and `LANGUAGE.md`
   *is* the compiler prompt, so a doc edit changes every build. Neither is recorded in the
   lock. Specs do not say which language version they target, and the docs disagree about
   the current version (v5 in the header, v10 in the skill). This is the Nix flake.lock
   and Go `go` directive lesson. *Small.*

---

## 2. Lessons from other languages

### 2.1 Specification by example: Gherkin/Cucumber, SbE

**Lesson.** Examples work as a *collaboration* artefact and as proof, but imperative,
UI-level scenarios rot. Cucumber's own guide: imperative scenarios, "because they are so
closely tied to the mechanics of the current UI, … often require more work to maintain"
([Cucumber, Writing better Gherkin](https://cucumber.io/docs/bdd/better-gherkin/)). Its
creator calls it "the world's most misunderstood collaboration tool": it is not a test
runner ([Hellesøy](https://cucumber.io/blog/collaboration/the-worlds-most-misunderstood-collaboration-tool/)).
The "Cucumber test trap" is trying to describe *everything* through scenarios, which
gives slow, brittle suites ([Tooke](https://tooky.co.uk/the-cucumber-test-trap/)). Adzic's
Specification by Example stresses *key examples* that are refined collaboratively, not
exhaustive ones ([Manning](https://www.manning.com/books/specification-by-example)).

**How it applies.**
- *Right:* Intent removes Gherkin's worst cost, the glue layer. Steps are a closed set
  (`type/click/choose/see`) bound to declared element names, so there are no step
  definitions to maintain and no regex drift. "The screen is the contract" also makes UI
  steps less of an implementation detail than in Cucumber, because the element names *are*
  the spec.
- *Right:* examples gate every build, and divergences come back as paste-ready example
  steps. That is living documentation that cannot go stale.
- *Risk:* the examples are still fully imperative, and they grow like Cucumber suites.
  `inventory.intent` repeats `type "1" into amount` / `click receive` eight times to set
  up a history. Many assertions use positional rows tied to the seed data
  (`see stock on row 6 = 3`), so a new seed row breaks unrelated examples. The same line
  appears twice in one example (`see history is hidden`, lines 153 and 156), and the
  checker says nothing about it.
- *Risk:* the Cucumber test trap. The skill says "one per important behaviour and edge
  case", but `events.intent` has 17 examples and 414 lines. Nobody reviews a spec like
  that for intent any more; it is a test file.

### 2.2 English-like languages: COBOL, SQL, AppleScript, Inform 7; controlled English

**Lesson.** "Reads like English" helps readers, hurts writers, and hides ambiguity.
William Cook, one of AppleScript's designers: "It is easy to read AppleScript, but quite
hard to write it … In hindsight, we believe that AppleScript should have adopted the
Professional Dialect that was developed but never shipped", and "Most people just run
scripts — they don't read or write them"
([Cook, HOPL III](https://www.cs.utexas.edu/~wcook/Drafts/2006/ashopl.pdf)). Inform 7
is often called a "read-only language" for the same reason
([Dorophone](https://procyonic.org/blog/on-inform-7-natural-language-programming-and-the-principle-of-least-surprise/)).
SQL was designed as "Structured English" for non-programmers and ended up as a language
for programmers ([Chamberlin, Early History of SQL](https://ieeexplore.ieee.org/document/6359709/)).
Dijkstra's warning is that natural language makes it easy to write "statements the
nonsense of which is not obvious"
([EWD667](https://www.cs.utexas.edu/~EWD/transcriptions/EWD06xx/EWD667.html)). What
worked was *controlled* natural language: EARS constrains requirement sentences to a few
clause templates and is used at Rolls-Royce, Airbus and NASA
([EARS](https://alistairmavin.com/ears/)), and Attempto Controlled English is a subset
of English with an unambiguous mapping to logic
([ACE](https://attempto.ifi.uzh.ch/site/pubs/papers/reasoningweb2008_fuchs.pdf)).

**How it applies.**
- *Right:* Intent is already a hybrid. The skeleton (blocks, elements, steps, types) is
  formal, and only leaves are English. Principle 4 ("closed vocabulary; unknown words are
  errors") is the right instinct. The LLM is also a much better reader of English than
  AppleScript's parser was, so the "hard to write" cost is lower when an LLM writes.
- *Risk:* the English parts have grown far beyond leaves. `06-expenses.intent` has a
  complete algorithm in a derive ("while someone has a negative balance, take the person
  with the lowest balance … on a tie the one earlier in people …"), which breaks Principle 1
  ("No functions, loops or code"). Control flow is prose, with no defined semantics for
  whether later steps run (§5: "Sentences may be conditional"). Authors show that they
  don't trust it by repeating themselves in parentheses: "skip all remaining steps (parts,
  history and amount stay unchanged)". This is the AppleScript failure in a new form: a
  reader feels certain, and an author cannot know what is legal or what it means.
- *Risk:* Cook's point that people run scripts rather than read them applies directly.
  AGENTS.md says specs will mostly be written by an LLM interviewing a user. The human
  audience of the prose is therefore the reviewer of a *diff*, not someone writing from
  scratch. Optimise for that.

### 2.3 Elm

**Lesson.** Strictness pays when the compiler explains itself and there is an escape
hatch the community can live with. Elm's "compiler errors for humans" made strictness
teachable ([elm-lang.org](https://elm-lang.org/news/compiler-errors-for-humans)). Its
enforced semver is famous, but it checks only types: "An API is more than its types:
behavior is also part of an API"
([elm-lang.org#868](https://github.com/elm/elm-lang.org/issues/868)). Elm 0.19's removal
of native modules for everyone outside the core organisations drove experienced users
away ([Luke Plant, Why I'm leaving Elm](https://lukeplant.me.uk/blog/posts/why-im-leaving-elm/)).

**How it applies.**
- *Right:* checker codes with file:line and `SPEC CONFLICT` messages follow Elm's
  approach. `NOT_YET` ("a candidate, not a prohibition") is a friendlier way to handle
  missing features than Elm's.
- *Opportunity:* Intent can do what Elm cannot: its bundles carry *behaviour* (examples,
  `always`), so a version bump can be computed from behaviour as well as from names. See
  R14.
- *Risk:* there is no escape hatch. When the language cannot say something, the author
  writes an algorithm in English (expenses) or waits for `NOT_YET` to turn into a feature.
  The low-code evidence (2.8) says this wall arrives early in real apps.

### 2.4 Go and Python: small spec, one obvious way, gofmt, compatibility

**Lesson.** A small, exact spec and one canonical form scale better than expressiveness
([Pike, Less is exponentially more](https://commandcenter.blogspot.com/2012/06/less-is-exponentially-more.html);
PEP 20, "There should be one — and preferably only one — obvious way to do it",
[peps.python.org/pep-0020](https://peps.python.org/pep-0020/)). Go's compatibility
promise made the spec version a contract ([go.dev/doc/go1compat](https://go.dev/doc/go1compat)).
Minimal version selection made dependency resolution predictable without a SAT solver
([Cox, MVS](https://research.swtch.com/vgo-mvs)).

**How it applies.**
- *Right:* the reference is short (391 lines), and the element and step sets are small
  and closed.
- *Risk:* "one obvious way" is broken in several places. Braces are both template holes
  and component-scoped names, and they are optional at app level: CRM writes
  `set {contactPager.page} to 1`, events writes `set pager.page to 1`, and both pass with
  0 warnings. Templates use `{x}`, `{email, trimmed}`, `{a} … where a is …` and
  `<the new name>`. Filters are either hand-mirrored choices or sentences.
- *Risk:* there is no canonical formatter (`intent expand` prints the expanded form, not
  a formatted source). With LLMs doing the refinements, noise in diffs is the main cost
  for reviewers.

### 2.5 Rust: the compiler as a teacher

**Lesson.** Errors that put the user's own source first and suggest the fix change how
people learn a strict language ([Rust, Shape of errors to come](https://blog.rust-lang.org/2016/08/10/Shape-of-errors-to-come/)).

**How it applies.** The checker's output already puts the source line first. The next
step is *suggested spec text*: for `UNPROVEN`, a `see` line with the current computed value;
for a divergence, the example (which the pipeline already produces). Also give each code a
"why" link into LANGUAGE.md. For an LLM author, a suggested line is worth more than prose.

### 2.6 Configuration languages: YAML, HCL/Terraform, CUE, Dhall, Nix

**Lessons.**
- Implicit typing and "helpful" coercion bite: the Norway problem
  ([StrictYAML](https://hitchdev.com/strictyaml/why/implicit-typing-removed/)).
- Identity by position is fragile: Terraform's `count` re-creates resources when a list
  changes, and `for_each` fixes it with keys
  ([HashiCorp](https://support.hashicorp.com/hc/en-us/articles/31348158569363-Terraform-count-versus-for-each-meta-argument)).
- Validation belongs in the language: CUE unifies types, constraints and values
  ([cuelang.org](https://cuelang.org/docs/concept/how-cue-enables-configuration/)).
- Dhall pins imports with *semantic* integrity hashes (hash of the normal form), so
  formatting or comment changes don't break the pin
  ([Dhall safety guarantees](https://docs.dhall-lang.org/discussions/Safety-guarantees.html);
  [Gonzalez](https://www.haskellforall.com/2017/11/semantic-integrity-checks-are-next.html)).
- Nix flakes: reproducibility comes only from pinning *every* input and evaluating
  hermetically ([nix.dev](https://nix.dev/concepts/flakes.html)).

**How it applies.**
- *Right:* §9 "silence has a default" is the anti-Norway principle, applied to behaviour.
  Choices are closed and typed. The lock refuses silent changes.
- *Risk (YAML):* semantics hide in whitespace and position. An end-of-line comment is a
  note that the compiler reads, while a comment on its own line is not (§4b). So
  `history: List Movement = []  # newest first, at most 8` is a load-bearing invariant
  inside a comment that nothing checks. `as <word>` at the end of a line is a presentation
  if the word is known or UpperCamel, and part of the sentence otherwise (`parse.ts:490`).
  So `= pipelineValue as money` works by luck, and a sentence ending in "as code" or
  "as title" silently becomes a presentation.
- *Risk (Terraform):* rows by position in examples. Relations by display text instead of
  keys, so renaming a workshop orphans its sign-ups.
- *Risk (Nix/Dhall):* the lock hashes raw text truncated to 16 hex characters
  (`load.ts:23`), so a whitespace change forces a re-review. The model, the harness and
  LANGUAGE.md are not pinned at all (R16).

### 2.7 Package ecosystems: npm, Go modules, Elm, Hickey, Hyrum

**Lessons.**
- Mutable registries break the world: left-pad ([npm postmortem](https://blog.npmjs.org/post/141577284765/kik-left-pad-and-npm)).
- "Breaking changes are broken": grow by accretion, and give a changed thing a new name
  ([Hickey, Spec-ulation](https://github.com/matthiasn/talk-transcripts/blob/master/Hickey_Rich/Spec_ulation.md)).
- Hyrum's law: "all observable behaviors of your system will be depended on by somebody"
  ([hyrumslaw.com](https://www.hyrumslaw.com/)).
- Minimal version selection gives reproducible builds without a lockfile solver
  ([Cox](https://research.swtch.com/vgo-mvs)).

**How it applies.**
- *Right:* content-hash pinning and "builds never pick up a library change silently".
  The source map traces a `data-el` back to the bundle line.
- *Risk (Hyrum):* in Intent *everything* observable is contract by design: element
  names (`data-el`, examples reference `pager.pageInfo`), exact texts ("Page 1 of 3"), and
  order. Renaming `pageInfo` or changing "Page" to "Pg" breaks every consuming app's
  examples. The ecosystem needs rules for what a bundle promises, and tools that detect
  when a change breaks that promise.
- *Risk (Hickey/Elm):* the design has regressed from v0.1. The original `language.md`
  pinned `<registry-id>@<version>` plus a hash in `ouros.lock`. The v10 lock pins only a
  hash, and there is one lock for the whole repo, so two apps cannot use two versions of
  `std.list`.
- *Risk (namespaces):* "All imported names share one namespace; a name declared twice is
  an error." With two community bundles that both export `Status` or `Badge`, users
  can't combine them. `import ui.admin` also replaces the app's design as a side effect.

### 2.8 Low-code and model-driven engineering

**Lessons.** MDE succeeded where companies built *small, domain-specific* languages, not
general UML, and "code generation isn't the key driver". Organisational fit decided the
outcome ([Whittle, Hutchinson et al., The State of Practice in MDE](https://www.infoq.com/articles/the-state-of-practice-in-model-driven-engineering/)).
In an analysis of about 5,000 Stack Overflow posts on low-code platforms, over 40% of
the questions were about customisation, and many event-handling questions had no
accepted answer ([Alamin et al.](https://arxiv.org/pdf/2103.11429)). A literature review
with case studies lists vendor lock-in, limited testing support and lack of flexibility
among the main inhibitors
([Acta Economica](https://ae.ef.unibl.org/index.php/ae/article/view/582)).
Böckeler's review of today's spec-driven tools (Kiro, spec-kit, Tessl) sees the same
pattern: spec-as-source raises non-determinism and review overhead, and she explicitly
warns to learn from MDD ([martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)).

**How it applies.**
- *Right:* Intent is a narrow profile (single-screen interactive apps), which is the MDE
  success pattern. It measures convergence instead of claiming it. Generated code is never
  hand-edited. Traceability is a first-class requirement.
- *Risk:* "the last 20%" shows up as prose that the harness cannot own: settle-up
  algorithms, email validation written out twice in different words (`13-crm.intent:62`
  and `events.intent:63`), and look sentences with column headers ("A header row: Event,
  Date, Location, Places, and an empty header over the Manage column"). Without a typed,
  traceable escape hatch, each of these either becomes a language feature or stays
  unverified English.
- *Risk (lock-in):* the backend is one model through one CLI. The spec is portable in
  principle. The *behaviour* of a vague spec is not, because it depends on the model.

### 2.9 Formal-ish specification: TLA+, Alloy, OpenAPI/JSON Schema, design by contract, property testing

**Lessons.** Engineers adopt precise invariants when they get cheap, automatic
counterexamples. At AWS, TLA+ found subtle bugs that reviews and tests missed
([Newcombe et al., CACM](https://cacm.acm.org/research/how-amazon-web-services-uses-formal-methods/)).
Alloy's small-scope hypothesis says most specification errors have small counterexamples
([Jackson](https://groups.csail.mit.edu/sdg/pubs/2002/alloy-journal.pdf)). Property-based
testing finds bugs that example tests miss
([Hughes](https://www.cs.utexas.edu/~hunt/FMCAD/fmcad11/papers/inv8.pdf)). Design by
contract puts pre- and postconditions and invariants next to the operation
([Eiffel](https://www.eiffel.com/values/design-by-contract/introduction/)). OpenAPI and
JSON Schema show that a machine-checkable schema becomes the shared contract only when the
tools *enforce* it ([OpenAPI spec](https://spec.openapis.org/oas/latest.html)).

**How it applies.**
- *Right:* `always` checked after every action of every fuzzed session is property-based
  testing. The guided fuzzer that starts from example prefixes is a good, cheap version of
  small-scope exploration. The r4 result, where all six builds refused with the same
  `SPEC CONFLICT` about a missing guard, is exactly the TLA+ experience.
- *Risk:* the property language is too weak, so the real invariants go into unchecked
  `rules`, and the fuzzer can only check what the screen shows. Preconditions are written
  as prose guards inside handlers instead of as a contract on the action.

### 2.10 Languages for LLM authors and readers

**Evidence.** LLMs do markedly worse on low-resource and domain-specific languages
([Joel et al., survey of 111 papers](https://arxiv.org/abs/2410.03981)). Type constraints
during generation cut compile errors by more than half, and 94% of compile errors are type
errors ([Mündler et al., PLDI 2025](https://arxiv.org/abs/2504.09246)). Spec-driven tools
suffer from agents that "ignored the notes" and produce specs that are tedious to review
([Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)).

**How it applies.**
- *Right:* Intent keeps the novel syntax tiny, and English carries most of the meaning.
  That plays to the model's highest-resource "language". The harness generates typed
  interfaces (`Screen`, `Event`), which is the type-constraint lesson applied at the
  program level. The measured result is 100% same-app on phase-1 apps.
- *Risk:* the held-out specs fall to 70% (events) and 93% (inventory) same-app, and 0/6
  "page = logic" for inventory. They were written from the docs alone, and they drifted
  into the free-English parts. That is where the language's precision ends, so that is
  where the next investment belongs.

---

## 3. Critique of Intent as it is now

**3.1 The version story is inconsistent.** `docs/LANGUAGE.md` opens with "language
reference (v5, app profile)". Its changelog lists v10, v9, v8, v6, v5 in that order, and v7
is missing, although the README credits v7 with the Kit. The skill says it matches
"**v10**". The root `language.md` is the Dutch v0.1 design with `package`, `ouros.lock`
and versioned refs. It is still in the repo and AGENTS.md cites it as the lock design, yet
the implementation dropped versions. No `.intent` file says which version it targets.
LANGUAGE.md is also the compiler prompt, so this confusion goes straight into every build.

**3.2 Three template syntaxes, none of them fully defined.** §2 defines `{…}` only
"inside a template string". In practice:
- `text remaining = "{number of items not done} left"`: a sentence inside a hole (todo).
- `"{email, trimmed} is already on the list for {chosenEvent}."`: a hole with a
  modifier, inside a handler string (events:164). Handler strings are not documented as
  templates at all.
- `"… is number {n} on the waiting list." where n is the number of waitingList after
  adding`: a hole bound by a trailing `where` clause (events:166, 174).
- `"Added <the new name>"`, `"<title> moved to <its new stage>"`: angle brackets (crm:143,
  151; helpdesk; expenses). They appear nowhere in LANGUAGE.md.

The checker accepts all four. An LLM compiler guesses what each means, and a new author
copies whichever one they saw last.

**3.3 Control flow is prose with no semantics.** §5 says only "Sentences may be
conditional". The same concept, "stop here", is written as:
- "if an item with the same title … exists, do not add anything" / "clear draft in both
  cases" (todo)
- "set toast.message to … and do nothing else" (events)
- "skip all remaining steps (parts, history and amount stay unchanged)" (inventory)
- "otherwise …" meaning the complement of *all* previous `if` lines, or only of the one
  just before? (events:165–166: after three guarded early exits, "if placesLeft is above
  0 … otherwise …")

There are no defaults in §9 for this. The parenthetical reassurances show that authors
know it.

**3.4 `as` is overloaded and parsed heuristically.** `text places = "Full" when this
workshop has no places left; "1 place left" when it has exactly 1; otherwise "{n} places
left" where n is its capacity minus its number of Confirmed signups as badge` (events:82).
The reader has to guess whether "as badge" belongs to the last clause. `as money` (crm:79,
109) is not a presentation. It survives because `parse.ts:490` keeps unknown lowercase
words in the sentence. It is not documented, and §9 only mentions `Fmt.cents`.

**3.5 Relations are text, and uniqueness lives in comments.** `contact: Text  # the name
of the contact`, `workshop: Text  # the title of the workshop`, `part: Text  # the name of
the part that moved`, `title: Text  # unique; sign-ups refer to it`. Nothing checks the
uniqueness or the reference, and seed data could violate either. `select chosenEvent
"Event" from events.title` stores a text that may match nothing. The held-out divergences
("Managing .", "Cannot pick 5 × : only 0 in stock") are exactly this unwritten case: which
option is chosen when the selection is empty or stale. That is the biggest measured
weakness, and the checker gave 0 warnings.

**3.6 "All" filters are hand-written mirror choices.** `choice CategoryFilter:
AllCategories "All categories" | OnlyBrakes "Brakes" | OnlyCables "Cables" | …` duplicates
`Category`, and the derive has to map them ("OnlyBrakes matches Brakes, and so on"). CRM
repeats the pattern with `StageFilter`. Adding a category silently leaves the filter
behind. This is the most common UI pattern, and it has no construct.

**3.7 Derived values are untyped.** `full = there are 3 cards in Doing` could mean
exactly 3 or at least 3. `quantity = amount read as a whole number (Fmt.parseInt); "not a
number" when it is not a whole number` is either an Int or a text. `Maybe` exists in the
type system but cannot be used here. The generated `Screen` is typed, but the model behind
it is not specified.

**3.8 The important rules are not checked.** Events' `rules` block holds the four
properties that define the app (capacity, promotion, one email per workshop, order). None
of them can be an `always` check. The `always` block that exists (`attendeeList has at most
10 rows`) encodes the maximum seed capacity, not the rule. Inventory's "stock is never
below 0" is in `rules` and in a comment, but not in `always`.

**3.9 Comments with semantics.** "A comment at the end of a line … is a note: the
compiler reads it too. A comment on a line of its own is only for people." Whether a line
has meaning depends on its position. Notes carry invariants (`# newest first, at most 8`),
and nothing checks them. People who learned `#` from any other language will be surprised.

**3.10 "What, never how" is broken where the language runs out.** `06-expenses`
`transfers = settle up … while someone has a negative balance, take …` is an imperative
algorithm in English. Email validity is specified twice, in different words, in two apps.
AGENTS.md itself says "the harness owns everything that needs no judgement". A settle-up
algorithm or an email check needs no judgement, so it should be a harness-owned or
bundle-owned function.

**3.11 Bundles fall short of AGENTS.md's promise.** AGENTS.md says "A bundle carries its
own examples and `always` rules. They are its conformance tests, and every app that uses
it must pass them too." In reality:
- components cannot contain examples. `std.list` is proven by a separate demo app, and
  `std.feedback` (Toast) has no examples or demo at all;
- only component `always` checks carry over into apps (`expand.ts:96–103`), and Pager has
  none;
- one flat namespace, and design is imported as a side effect;
- no versions, one repo-wide lock, and hashes of raw text.

**3.12 Examples are long, positional and imperative.** See 2.1. Every example starts from
the initial state, so reaching a state means replaying keystrokes (inventory: 16 lines to
fill the history). Row numbers tie assertions to the seed order. The checker does not
catch duplicate lines or unreachable assertions.

**3.13 The checker is blind to what actually diverged.** All held-out specs pass with 0
warnings, yet they diverge in 30% of sessions. `UNANCHORED` catches only sentences that
name nothing. A sentence that names three things and is still ambiguous passes. `intent
review` (an LLM call) finds gaps, but its findings are not checker codes, so they are not
tracked, not reproducible and not counted in `converge`.

**3.14 Look sentences carry structure.** "Column headers: Part, SKU, Category, In stock,
Reorder at, and an empty last header." Column headers are content. They affect
accessibility and tests, and they belong to the element (a label per row element), not in
a free sentence that the §9.5 rule ("no … column headers … unless a `look` sentence asks")
has to override.

---

## 4. Recommendations

Effort: **small** fits in a version bump (docs + parser/checker); **large** needs new
semantics, codegen or tools.

### Language

**R1. Structured statement forms (the "professional dialect").** *Large.*
Define a handful of statement shapes that the parser recognises, with fixed meaning:
- guard: `- if <cond>: <step>[, <step>]; stop`. Later steps don't run, and a default in
  §9 says that a stopped handler changes nothing except what its own steps did;
- branch: `- if <cond>: …` / `- otherwise: …`, where `otherwise` is the complement of the
  directly preceding `if` chain (write that down);
- value choice: `<value> when <cond>; <value> when <cond>; otherwise <value>`, usable in
  `text x =`, `button x =`, `set … to`;
- list operations: `add <Record> with … to the end|front of <list>`, `remove that <item>`,
  `keep the first N of <list>`, `set <field> of that <item> to …`;
- `where <name> is <phrase>` for local names in templates.

Free English stays legal inside `<cond>` and `<phrase>`, where the checker still wants at
least one anchor. The goal is not full formality. The goal is that *structure* (order,
branching, stopping, what changes) is never prose. Lesson: AppleScript's unshipped
Professional Dialect, EARS clause templates, ACE. It also makes branch coverage possible
(R12).

**R2. One template syntax.** *Small.* `{…}` holes only, holding a declared name, a
qualified name, or a `where`-bound local name, and legal in any string literal, including
handler strings. `<…>` becomes a `SYNTAX` error with a suggested rewrite. Arbitrary
sentences inside holes (`{number of items not done}`) get a warning that suggests a named
derive. Lesson: PEP 20. Reasoning: holes that are names can be checked and traced to the
source map, and sentences inside holes cannot.

**R3. Braces mean one thing.** *Small.* Either braces are only for template holes, and
component-own names are resolved by scope (the checker already knows the scope), or braces
are required for every qualified name everywhere. The first is simpler. Today both
`{pager.page}` and `pager.page` pass. Lesson: one obvious way.

**R4. `as` only for presentations; a closed format vocabulary.** *Small.* Add
`format money|percent|clock|int|decimal N` as a modifier (or `as` with a closed list of
formats), and document each in §9. Unknown lowercase words after `as` become a `SYNTAX`
error instead of a silent sentence. Lesson: YAML's implicit typing, where heuristics that
guess meaning eventually guess wrong.

**R5. Keys and references.** *Large.* `record Workshop` + `key title` (or `id: Int key`),
and a field type `Workshop` inside another record meaning a reference by key.
`select chosen from events` holds a reference, not a text. The checker validates seed data
(duplicate keys, dangling references). §9 gains defaults for "the selection points at
nothing": show the first option, or show nothing and disable the dependent actions. Pick
one and write it down. Rows in examples can be addressed by key (`on row "Bike Repair"`).
Lesson: Terraform `for_each`. Evidence: every held-out divergence.

**R6. "Any" selections.** *Small.* `select category "Category" from Category or All "All
categories"` gives state of type `Maybe Category`, with the label shown for `nothing`, and
"matches category" is defined in §9 as "equal, or anything when nothing". This removes the
mirror choices (3.6). Lesson: CUE-style reuse of one type for data and constraint, and not
duplicating a closed set.

**R7. Optional types on `derive`, required where the type is ambiguous.** *Small.*
`full: Bool = …`, `quantity: Maybe Int = amount read as a whole number`. The generated
model then has typed derived values, which is the type-constraint lesson for LLM codegen.

**R8. Model-level invariants.** *Large.* Extend `always` with a small closed expression
form over state, not only the screen:
```
always
  each workshop in events: count of signups with workshop = it and status Confirmed is at most its capacity
  unique email ignoring case per workshop in signups
  each part in parts: stock is at least 0
```
The harness evaluates these on the Model after every action. The generated test driver
already reads state, and the grammar stays small enough to evaluate without an LLM. Then
add `UNCHECKED_RULE` (warning) for every `rules` sentence that no `always` covers. Lesson:
property-based testing, Alloy, TLA+ invariants, DbC class invariants.

**R9. No semantics in comments.** *Small.* Replace end-of-line notes with an explicit
form (`note "seconds left"` under the line, or a trailing `-- note`) and turn the common
notes into constraints the checker knows (`key`, `newest first`, `at most 8`). `#` stays a
plain comment. Lesson: YAML/position-dependent meaning, and "ignored notes" in spec-driven
tools.

**R10. Reusable named functions in bundles, owned by the harness.** *Large.* Let bundles
export typed derivations and predicates (`std.text.isEmail`, `std.number.parseWhole`,
`std.money.settleUp`). A bundle that needs an algorithm may carry a *typed, reviewed,
pinned* implementation per target (Elm/TS), the way `Fmt` already is. This is the escape
hatch, made traceable. Lesson: low-code's "last 20%", Elm 0.19's closed escape hatch, and
AGENTS.md's own "the harness owns everything that needs no judgement".

### Examples and the checker

**R11. Shorter, declarative examples.** *Small.* Add
- `given` at the top of an example: state overrides in literal form
  (`given history = table …`, `given stock of "Brake cable" = 0`), checked against the
  types. This is the Gherkin `Background`/Given without its glue code;
- `repeat N times` for step blocks;
- lints: duplicate `see` lines, `on row N` when a key or `row with` would work
  (`POSITIONAL`), and examples longer than a threshold (`LONG_EXAMPLE`, a Cucumber-trap
  warning).

Keep the imperative UI steps as the *proof* layer. Intent's contract is the screen, so
they are not the Cucumber anti-pattern they seem. But the `given` form lets examples state
behaviour instead of replaying keystrokes.

**R12. Coverage that follows the structure.** *Small once R1 exists.* Every guard and
branch from R1 needs at least one example whose run takes it (`UNCOVERED_BRANCH`). Every
`always` needs at least one example that comes close to its boundary (for example a list
at its maximum). Every `select … from` needs an example with an empty or changed source
list. These are the exact gaps behind the held-out divergences.

**R13. Make `review` findings checker codes.** *Small.* When `intent review` finds a
silence, report it with a stable code (`SILENT_ORDER`, `SILENT_EMPTY_SELECTION`,
`SILENT_TIE`, …) and a suggested line. Record the counts in `runs/history.jsonl` next to
same-app, so "precision of the spec" becomes a measured number. Lesson: Rust/Elm errors
that teach; measure before and after (AGENTS.md).

### Bundles and versioning

**R14. Bundles with examples and a computed semantic version.** *Large.*
- Allow `example` inside a `component` (run against a fixture declared in the bundle) and
  at bundle level. The demo app becomes optional.
- `bundle std.list 1.3.0` in the header. `intent diff std.list` classifies a change:
  removed or renamed public name, element, param, or a changed expected value in an
  example → **major**; added param with a default, added element or example → **minor**;
  anything else (look, notes, wording that keeps every example) → **patch**. Behaviour is
  part of the API, which answers elm-lang.org#868 in a way Elm cannot.
- Say what the contract is (Hyrum): public names, examples and `always` are contract.
  Look sentences and layout are not.
- A breaking change gets a new name (`std.list2`, Hickey) or a major version. Resolve by
  minimal version selection (Go). A published version is immutable, and there is no
  unpublish after dependents exist (npm after left-pad).

**R15. Namespaced imports and explicit design.** *Small.* `import std.list` exposes
`list.Pager`, and `import std.list exposing (Pager)` exposes `Pager` (Elm's form).
`design from ui.admin` applies a design explicitly. Collisions between bundles then become
impossible instead of fatal.

**R16. Lock the compiler, not only the libraries.** *Small.*
- Each spec gets a language line: `app Crm` / `intent 10`, like go.mod's `go` directive.
  The checker refuses constructs from a newer version and explains what changed.
- Per-app lock (or per-app sections) with: bundle name, version, *semantic* hash of the
  canonical `expand` form (Dhall), model id, and hashes of `LANGUAGE.md`, the prompt and
  the Kit. A change to any of them is a `LOCK` warning, like a bundle change.
- The build manifest (`sourcemap.json` or next to it) records the same values, so a
  running app says what produced it. Lesson: Nix flake.lock, hermetic evaluation.

### Docs

**R17. One version number and a changelog in order.** *Small.* The LANGUAGE.md header,
the changelog (add v7, order it), the skill's version line and the spec's `intent N` line
all say the same thing. Mark `language.md` as the historical v0.1 design (it is also the
only Dutch document). Document `as money`, handler-string templates, and the stop and
branch semantics (R1) in §5/§9. The prompt reads LANGUAGE.md, so an undocumented form is
a form the compiler guesses.

**R18. Separate "what the compiler must know" from "how to write well".** *Small.*
LANGUAGE.md is both the human reference and the compiler prompt. Keep it that way, but
treat edits to it as compiler changes: versioned, measured with `converge`, and pinned
(R16). Rationale belongs in the skill or in the reviews folder, not in the prompt.

### Authoring workflow

**R19. `intent fmt`.** *Small.* A canonical source formatter (column alignment in tables,
block order from the skill, one blank line between blocks). LLM refinements then produce
minimal diffs, and the diff becomes the unit of review. Lesson: gofmt; Cook's "people
run scripts, they don't read them"; Böckeler's review-overhead finding.

**R20. Interview towards key examples first, and show the user examples, not the spec.**
*Small.* In SKILL.md §1, make the interview produce a table of key examples with their
expected values (SbE), confirm those with the user, and only then write sentences. When
reviewing a change with the user, show the changed and added examples as the primary
artefact. Users can check "after cancelling Sara, Eva moves up", but they cannot check
"`otherwise` refers to the chain above".

**R21. Make held-out authoring the regression suite for the language.** *Small.* Every
language version is measured on held-out specs written from the docs only, not only on
the tuned `apps/`. Record the "prose forms" that authors invented (the four ways to
stop, the three template syntaxes) as input for R1/R2. The r14 result (70%/93% vs 100%) is
the most honest number in the repo.

---

## 5. Open questions (where the evidence conflicts)

1. **How formal should the sentences become?** Dijkstra, AppleScript and Inform 7 argue
   for a formal core. The LLM-codegen evidence (low-resource DSLs do worse) argues for
   staying close to English, which is the model's best-trained language, and phase 1
   reached 100% convergence with free sentences. R1 bets on structured skeleton + free
   leaves. Whether that keeps the LLM-authoring advantage is an empirical question:
   measure held-out convergence and LLM authoring error rates before and after.

2. **Imperative UI examples: anti-pattern or contract?** Cucumber's guidance says avoid
   "click a button" steps. In Intent the screen *is* the contract and the steps are
   checked against declared names, so the classic brittleness (glue code, selectors)
   mostly disappears. What remains is length and positional coupling. Whether `given`
   (R11) helps, or instead lets examples skip the behaviour they should prove (setting a
   state that the app could never reach), is not settled. Possibly `given` should only
   accept states reachable through handlers, which the fuzzer could check.

3. **Enforced semver when everything is observable.** Hyrum's law says every text and
   order will be depended on. Intent makes that official: examples assert exact texts. A
   strict behavioural semver (R14) could turn nearly every useful bundle change into a
   major version. The alternatives are declaring texts non-contract (and letting consumer
   examples break), or Hickey's accretion-only policy. There is no evidence yet from a
   real multi-author bundle ecosystem.

4. **Strictness vs. the escape hatch.** Elm's closed native code drove people away.
   Low-code platforms without escape hatches hit the customisation wall. But an escape
   hatch (R10) weakens "every line traces to the spec" and "same spec, same app". Is a
   typed, pinned, per-target implementation inside a bundle still "intent"? It is the same
   deal `Fmt` already makes, but at community scale it becomes a supply-chain question.

5. **Should look be words or a closed vocabulary?** The v7–v9 results show that closing
   the vocabulary (Kit, presentations, layout defaults) moved box agreement from 58–93% to
   97–99%. The held-out looks fall back to 32–43% as soon as authors write look sentences
   the Kit does not know. The evidence says to keep closing the vocabulary. The vision
   (describe what you want) says keep words. The likely answer is words only for the
   difference from a closed base (`component X as card "…"`), but where that boundary
   lies is open.

6. **Who is the reader?** AGENTS.md says the language "must stay readable for people".
   Cook's evidence and the SDD reviews say people mostly won't read it. They will read
   diffs, examples and the running app. If the primary reader is an LLM plus a diff
   reviewer, some readability-driven choices (English templates, prose control flow) cost
   more than they earn. Deciding this explicitly would settle several of the questions
   above.
