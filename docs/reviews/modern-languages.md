# What makes a modern language good, and what it means for Intent

Research done on 2026-09-24, against Intent v29. Sources are listed at the end and cited as
[n]. Where a sentence is my own reading rather than what a source says, it is marked
*(inference)*.

## 1. Summary

1. The best-loved languages are small and consistent: few features that combine predictably, one obvious way to say a thing (Go, Gleam, Zig) [3][10][11].
2. They are read far more than written, so they choose clarity at the point of use over brevity (Swift, Go) [3][14].
3. One canonical format with no options ends style debates and makes diffs small (gofmt, `roc fmt`, `gleam format`) [5][13].
4. The compiler is an assistant: errors say where, why and what to do, with examples, links and fixes a tool can apply (Elm, Rust) [6][7][8].
5. Types make wrong states impossible to write down, so there is nothing to check later (Rust, Elm, Kotlin null safety) [15][16][17].
6. Nothing important is hidden: control flow, effects and allocations are visible in the text (Zig, Roc) [11][13].
7. Tooling is part of the language: one binary with formatter, tests, package manager, and editor support over LSP. Cargo is as admired as Rust itself [1][13][20].
8. Old code keeps working: a version line in each project picks the behaviour, and tools move code forward (Go 1 promise, Rust editions, `go fix`, Kotlin deprecation cycles) [21][22][23][24][25].
9. Dependencies are reproducible and versions mean something (Go MVS, Elm computed semver, Dhall and Unison hashes) [26][27][28][29].
10. For LLM writers the same things matter more, plus two more: well-known forms (LLMs write what they saw most) and fast, precise feedback [25][32][33][34][35].

## 2. The principles

Each principle: what it is, who shows it, and what it means for Intent (does, misses, one proposal).

### 2.1 A small core, one obvious way

**What.** Few features, each covering a separate part of the space, that combine without
surprises. Where there are two ways, people waste time choosing.

**Who.** Rob Pike: "Readability is paramount", it is "preferable to have just one way, or at
least fewer, simpler ways", and "adding features to Go would not make it better, just bigger"
[3]. Gleam aims to be "a small and cohesive language with a minimal feature set" and leaves
out type classes and macros because they hurt readability and error messages [10]. Zig's whole
syntax is a 580-line PEG grammar [11]. Hickey's "Simple Made Easy": simple means not
interleaved ("complected"), which is not the same as familiar [4].

**Intent does:** a closed vocabulary (principle 4 in `LANGUAGE.md` §1), UI vocabulary moved out
of the core into a profile spec (v16), one block form (v24), one reference form (v25), control
words as structure (v29). Old forms get hints (`UNSTRUCTURED`, `UNMARKED`).

**Intent misses:** the core is still large (scorecard v26, criterion 4: "the core is large").
There is no single, short grammar to point at, so nobody can say how big the core is. Two
block forms are still accepted (indentation-only files are read, `LANGUAGE.md` §2).

**Proposal.** Publish the grammar as a file, `docs/grammar.peg`, generated from or checked
against `compiler/parse.ts`, and report its size with every version, like Zig's 580 lines.
A new construct must say which rules it adds. *(inference: a counted core is the only way the
"small core" claim can be scored.)* Set a date after which indentation-only files are an error.

### 2.2 Clarity at the point of use

**What.** A thing is declared once and used many times, so judge a design by how its uses
read, not its declaration. Clarity beats brevity.

**Who.** Swift's API guidelines: "Clarity at the point of use" is the most important goal;
"Clarity is more important than brevity"; and "If you are having trouble describing your API's
functionality in simple terms, you may have designed the wrong API" [14]. The Cognitive
Dimensions framework names the failure modes: hidden dependencies, low role-expressiveness,
high viscosity (resistance to change) [18]. Stefik and Siebert found that novices were as
accurate with Java's and Perl's syntax as with randomly chosen keywords, and more accurate with
Quorum, Python and Ruby [19].

**Intent does:** braces, `@` marks and quoted literals make the structure visible in plain
text. Words instead of symbols match [19].

**Intent misses:** long `derive` sentences and implicit row words (`that`, `its`) still need
the reference (v26 score, criterion 3). Example: `apps/02-todo.intent` has
`shown = the @items that match @filter: @All shows every item, @Open the @items not @done, @Finished the @items that are @done`
— three rules in one line.

**Proposal.** A checker hint for sentences that do more than one thing, with the structured
form as the fix *(inference)*:

```
LONG apps/02-todo.intent:15  this derive holds 3 cases; write them as cases:
  shown = the @items that match @filter {
    @All: every item
    @Open: the @items not @done
    @Finished: the @items that are @done
  }
```

This fits direction item 2 in `AGENTS.md` (structured behaviour, English in the leaves).

### 2.3 One canonical format

**What.** A formatter with no options, applied everywhere. Code looks the same in every
project, and a diff shows only real changes.

**Who.** Go proverb: "Gofmt's style is no one's favorite, yet gofmt is everyone's favorite"
[5]. `roc fmt` has "no configuration options" [13]. Gleam ships a formatter in its one binary
[12].

**Intent does:** `intent fmt` and `fmt --check` exist.

**Intent misses:** `fmt` only turns indentation into braces (`compiler/cli.ts`, `case "fmt"`
calls `toBraces`). It does not order blocks, space steps, or normalise example steps. A
canonical printer exists already (`compiler/print.ts`, used by `expand`), but it prints the
expanded spec, not the file as written.

**Proposal.** Make `fmt` print the spec as written in one canonical form, reusing
`print.ts` where it fits: fixed spacing, one step per line, blank line between top-level
blocks, `import` lines sorted, trailing comments aligned. Run `fmt --check` on `apps/` and
`lib/` in `npm test`. For review on GitHub: one rule, one example step and one field per line,
so a small wish is a one-line diff *(inference)*.

### 2.4 The compiler as an assistant

**What.** An error message is a user interface. It shows the code, says what it expected,
gives an example of the right form, and offers a fix a tool can apply.

**Who.** Elm's errors say where the parser "got stuck", give examples ("like in these
examples: import Dict…"), suggest a fix ("Try putting a } next") and link to a page that
explains it [6][7]. Rust's diagnostics carry structured suggestions with an applicability
level from `MachineApplicable` to `MaybeIncorrect`, emitted as JSON so `rustfix` and editors
can apply them [8]; every error code has a long explanation (`rustc --explain E0308`) [9]. Roc
lists "friendly error messages" as a core goal [13].

**Intent does:** stable codes (`UNKNOWN_NAME`, `STEP`, …), file and line (v27), "did you mean"
for misspellings (`compiler/parse.ts`), lists of valid choice values, `check --json`, and
build failures stated in spec terms (the failing example, the ambiguous sentence).

**Intent misses:** the `Diagnostic` type (`compiler/ast.ts`) has `level, code, line, col,
message` and no fix. There is no `explain`. The v26 reviewer hit messages that state a fact
without the way out (`[1, 2] is not a literal`) and one that contradicted the reference.

**Proposal.**

```
error UNMARKED apps/rooms.intent:60:27  "end" is a declared field; mark it or reword
  - add a @Booking to the end of @bookings
                          ^^^
  fix (sure):   add a @Booking at the end of @bookings
  fix (maybe):  add a @Booking to the @end of @bookings
  more: intent explain UNMARKED
```

- add `fixes: { replace: string, span, sure: boolean }[]` to `Diagnostic` and to `check --json`;
- `intent check --fix` applies only the sure fixes;
- `intent explain <CODE>` prints a page with a wrong and a right example (reuse the text in
  `LANGUAGE.md` §7 and the skill);
- a test that every error code has an explanation and at least one message with a fix.

For an LLM writer, a sure fix turns a round of guessing into one edit *(inference, supported
by [33]: agents in unfamiliar languages spend tokens on code that does not compile)*.

### 2.5 Make illegal states unrepresentable

**What.** Model the domain so that wrong states cannot be written at all. At the edge of the
system, turn loose input into precise types once ("parse, don't validate").

**Who.** Yaron Minsky coined "make illegal states unrepresentable" [15]; Alexis King's "Parse,
don't validate" applies it to input [16]. Kotlin separates nullable from non-nullable types to
end the "billion dollar mistake" [17]. Elm has no null and no runtime exceptions [6].

**Intent does:** `choice` for closed sets, refined types (`type Age = Int from 0 to 150`, v19)
checked at every edge, contracts with typed answers.

**Intent misses:** "nothing" has no type. `apps/10-helpdesk.intent:72` writes
`selected: Int = 0  # id of the ticket open in the drawer; 0 for none`, and later
`current = the ticket whose @id is @selected`. What `current` is when no ticket matches is left
to the compiler. This is direction item 3 in `AGENTS.md` (references and "a selection points
at nothing").

**Proposal.** A reference type with an explicit empty case, and a checker that makes every use
say what happens when it is empty *(inference, modelled on Kotlin [17])*:

```
state {
  selected: Ticket or none = none
}

screen {
  drawer detail {
    visible when @selected is not none
    text subject = @selected.subject
  }
}

on click reply {
  if @selected is none {
    stop
  }
  - add a @Comment to the end of @comments with @ticket = @selected
}
```

`NONE_UNHANDLED` (error): `@selected.subject` is used where `@selected` may be none, and no
`visible when`, `if` or rule covers it. The harness generates `Maybe` / `| null`, so the target
type checker backs the rule up.

### 2.6 Nothing important is hidden

**What.** A reader can see from the text what runs, what can fail and what touches the world.

**Who.** Zig: "no hidden control flow, no hidden memory allocations, no preprocessor, and no
macros" [11]. Roc keeps effects explicit and separate from pure code [13]. Hyrum's law: "all
observable behaviors of your system will be depended on by somebody", whatever the contract
promises [30].

**Intent does:** v29 made early exits and branches structure. §9 defaults make silence
decided, not guessed. `expand` shows the spec as the compiler reads it. Effects on actions are
planned (`std.actions`, direction item 7).

**Intent misses:** the defaults in §9 are invisible in a spec. A reader cannot see that a
`Decimal` shows two decimals, or that text comparison is case-sensitive, without the reference.
By Hyrum's law, users will come to rely on these defaults, so they are behaviour, not detail
*(inference)*.

**Proposal.** `intent expand --defaults` prints the spec with the defaults that apply written
as comments, so a reviewer sees them:

```
state {
  price: Decimal = 0    # shown with 2 decimals, half away from zero (§9.2)
}
on click add {
  if no item in @items has the same @title as @draft {   # exact, case-sensitive (§9.1)
```

The same data feeds editor hovers (2.8).

### 2.7 Tests are part of the language, written as behaviour

**What.** Tests live next to the code, run with one command, and describe what the user gets,
not the keystrokes.

**Who.** Roc has `expect` in the language and `roc test` in the binary [13]; MoonBit ships
built-in expect tests [34]. Cucumber's own guide: describe behaviour, not implementation; ask
"will this wording need to change if the implementation does?" [31]. SQL separates what data
you want from how it is fetched, so the engine can improve under unchanged queries [36].

**Intent does:** this is Intent's strongest part: `example`, `always`, per-row checks,
contracts at run time, twin builds and random sessions, and bundles whose examples every user
must pass.

**Intent misses:** examples are imperative UI scripts (`type "Milk" into draft`, `click add`).
A bundle's examples break when a refining spec renames or moves a button, which is exactly
what `OVERRIDES_PROOF` warns about.

**Proposal.** Named steps, declared once in the spec or bundle, built only from existing steps
(so the vocabulary stays closed) *(inference, from [31])*:

```
steps {
  add item "{title}" {
    type title into draft
    click add
  }
}

example "finishing and filtering" {
  add item "Milk"
  add item "Bread"
  toggle done on row 1
  see remaining = "1 left"
}
```

A refinement that overrides `draft` overrides the step, and the base's examples still run.

### 2.8 Tooling is part of the language

**What.** Formatter, tests, packages, docs and editor support come with the language, in one
tool, working the same everywhere.

**Who.** In the 2025 Stack Overflow survey Rust is the most admired language (72%), then Gleam
(70%), Elixir (66%) and Zig (64%); Cargo is the most admired build tool (71%) [1]. Roc and
Gleam ship one binary with formatter and test runner [12][13]. The Language Server Protocol
turns M editors × N languages into M + N [20].

**Intent does:** one CLI with `check`, `fmt`, `lock`, `install`, `publish`, `client`,
`expand`, `review`, `build`, `converge`; `check --json` "for editors and CI".

**Intent misses:** no language server, so no go-to-definition (the scorecard's anchor 5 for
criterion 6 asks for it), no hover, no live diagnostics.

**Proposal.** A small LSP server over what exists: diagnostics from `check --json` (with the
fixes of 2.4 as code actions), go-to-definition from the resolved references (v26 already knows
where every name comes from), hover with the type and the §9 defaults (2.6). No new analysis
is needed *(inference, from reading `compiler/cli.ts` and the v26 changelog)*.

### 2.9 Evolve without breaking users

**What.** Each project states which version of the language it was written for. Old code keeps
its behaviour; new behaviour is opt-in; tools rewrite old code.

**Who.** Go 1: programs "will continue to compile and run correctly, unchanged" [21]. Since Go
1.21 the `go` line in `go.mod` selects behaviour, and changed defaults are kept for at least two
years [22]. Rust editions are opt-in per crate, crates of different editions must interoperate,
and all editions compile to the same internal form; `cargo fix --edition` does the rewrite
[23]. Kotlin announces a change, warns, ships an automatic migration, then changes [24]. The Go
team rebuilt `go fix` as a modernizer because LLM assistants "tended … to produce Go code in a
style similar to the mass of Go code used during training, even when there were newer, better
ways", and even denied new features existed [25].

**Intent does:** a `language vN` line, a `LANGUAGE` warning for older specs, the lock pins the
language hash and the model (`compiler/load.ts`), `fmt` migrated indentation to braces, the
changelog in `LANGUAGE.md`.

**Intent misses:** no spec in `apps/` or `lib/` has a `language` line (checked with grep), so
the pin is never used. `fmt` is the only migration. Old forms (`and stop`, `{page}` in
components, indentation) are still read or hinted, with no date when they stop.

**Proposal.**

- every spec starts with `language v29`; `intent fmt` adds it when missing;
- `intent fix` runs one rewriter per version step, like `cargo fix --edition`:
  `v28→v29: "- … and stop" → "stop"`, `v24→v25: "{page}" → "@page"`; unsure rewrites become
  diagnostics with a fix (2.4), never silent edits;
- a deprecation rule: a form is a hint in the version that replaces it, an error two versions
  later, and `intent fix` handles it in between;
- specs of different language versions import each other; the loader brings each to the
  current internal form before checking (the Rust rule) *(inference)*;
- a test that `apps/`, `lib/`, the guide and the skill pass `intent fix --check` with no
  changes. The Go lesson [25] applies directly: the LLM writes the idioms it has seen, and
  Intent's corpus is this repository.

### 2.10 Reproducible dependencies, versions that mean something

**What.** The same inputs give the same dependency set, and a version number says what
changed.

**Who.** Go's Minimal Version Selection picks the minimum version that satisfies every
requirement, which is reproducible without a lockfile solver [26]. Elm computes version numbers
from the API's types [27]; a known limit is that behaviour is part of the API too [27]. Dhall
pins imports with a hash of the normal form, so reformatting or comments do not change it
[28]. Unison names every definition by the hash of its syntax tree, so the same code is never
compiled twice [29].

**Intent does:** MVS in `intent install`, versions computed from names *and* demo examples
(this answers the Elm critique), sha256 pins in `intent.lock`, a build cache so an unchanged
spec is not recompiled.

**Intent misses:** the lock hashes the file text (`sha(text)` in `compiler/load.ts`), so a comment or `fmt` change forces a re-lock. There is no
way to see what changed between two versions of a bundle.

**Proposal.** Hash the canonical form (the `expand` output without comments), like Dhall, and
add `intent diff <bundle> 1.2.0 1.3.0`, like `elm diff`, listing added, removed and changed
names and examples, and the version bump each one caused.

### 2.11 Learning and documentation

**What.** The common case is short and needs no configuration; complexity shows only when
needed. Docs are layered: a tour, a guide, a reference.

**Who.** SwiftUI's progressive disclosure: find the simple cases and give them good defaults
[14]. Gleam's interactive tour, Elm's guide, Rust's book *(common knowledge; see [12])*.
`llms.txt` proposes one Markdown entry page for LLMs, with links to the detailed docs [37].

**Intent does:** the counter is 52 lines with no configuration; `GUIDE.md` (by example),
`LANGUAGE.md` (reference and compiler prompt) and the skill form three layers.

**Intent misses:** three documents that must agree, and the v26 reviewer found a doc/checker
mismatch. `GUIDE.md` says every snippet is taken from a file that passes the checker, but
nothing enforces it (no file in `tests/` or `compiler/` refers to `GUIDE.md`).

**Proposal.** A test that extracts every ```` ``` ```` block in `GUIDE.md`, `LANGUAGE.md` and
`SKILL.md` that looks like Intent and runs `check` on it (with a marker for deliberate
fragments). Doc drift then fails `npm test`.

### 2.12 Designing for LLM writers

**What.** LLMs write well what they have seen often, write badly in rare syntax, invent names,
and do better with precise, fast feedback.

**Who.**
- Quality drops sharply on low-resource languages and DSLs; it follows the amount of
  training data [32].
- Coding agents in less familiar languages (Rust, OCaml vs Python) use far more tokens; they
  write code that does not compile, revise solutions that already worked, and write their own
  tests instead of trusting the given ones [33].
- Code LLMs invent package names: about 20% of recommended packages in one large study did not
  exist [35].
- Constraining decoding by the type system removes most compile errors in TypeScript; only 6%
  of the compile errors were syntax [38]. MoonBit feeds parser and type checker results back
  during generation and reports much higher compile rates [34].
- Strict output formats (JSON, XML, YAML) can hurt reasoning while helping classification
  [39].
- Go found that LLMs keep old idioms from their training data [25].

**Intent does:** most of what this research asks. A closed vocabulary and `UNKNOWN_NAME` stop
invented names; v26 imports make every name's source explicit; English in the leaves keeps the
model's reasoning in natural language, and structure only where the parser needs it (this
matches [39]); a millisecond checker; the harness owns types, so the LLM compiler never writes
them.

**Intent misses:** Intent is by definition a zero-resource language; everything the writer
knows comes from the docs in context *(inference)*. There is no measure of how much a writer
struggles beyond "rounds to check".

**Proposal.**
- Choose forms LLMs already know when there is a choice: `if / else`, braces, `@` mentions,
  `key: Type` fields are all familiar; keep it that way for new constructs *(inference from
  [32][25])*.
- Measure tokens and rounds to a checked spec for each held-out author, per version, next to
  `converge` (from [33]).
- Use the grammar of 2.1 for constrained generation where the writer runs on a model that
  allows it, and `check --json` with fixes in the loop everywhere else (from [34][38]).

## 3. What does not transfer

- **Speed and memory.** Ownership (Rust), allocators (Zig) and GC design (Go) are about the
  generated code's runtime. In Intent the harness and targets own that.
- **Types as the main safety net.** Rust, Elm and Kotlin rely on the type checker for most
  correctness. Intent's behaviour is English checked by examples, invariants and twin builds;
  types only cover the harness interfaces. More types help (2.5), but examples stay the proof.
- **A deterministic compiler.** Every language above assumes the compiler gives the same output
  twice. Intent's compiler is an LLM; sameness comes from pinning (lock, model), caching, and
  twin builds, not from the compiler. "Same spec, same app" is a measured property here, not a
  given.
- **Fast compile loops.** Roc and Go prize fast builds. An Intent build costs money and minutes,
  so the fast loop can only be the checker. That raises the value of 2.4: everything that can be
  caught must be caught by `check`.
- **Running with errors.** Roc lets you run a program with compile errors [13]. Intent must stop
  on ambiguity; a guessed build is the failure it exists to avoid.
- **Macros, metaprogramming, user-defined steps with glue code.** Gleam and Zig leave macros out
  [10][11]; Intent should too. Gherkin's step definitions are code [31]; Intent's named steps (2.7)
  may only combine existing steps, or the closed vocabulary is gone.
- **Token efficiency by terseness.** Ruby-style brevity saves tokens [33], but people review
  Intent without tooling, and specs are short anyway. Clarity wins [14].
- **Unsound-but-pragmatic type systems.** TypeScript chose not to be sound, to support all of
  JavaScript [40]. Intent has no legacy to carry; it can stay strict.
- **Content-addressed code with no text files** (Unison [29]). Specs must stay readable plain
  text on GitHub; only the hashing idea (2.10) transfers.
- **Admiration surveys.** They measure developers who chose a language, not the fitness of a
  spec language that LLMs write. Use them for the themes, not as targets.

## 4. Suggested changes to the scorecard

Recommendation: keep the eleven criteria and the weights, so v26 and later scores stay
comparable, and sharpen the anchors. Add two measured numbers to every score.

**Anchors.**

- **2. Writable by an LLM**, anchor 5, add: "every error names the fix; most fixes can be
  applied by a tool (`check --fix`)". Anchor 3: "errors say what is wrong but not what to write".
- **3. Readable without tooling**, add a test from Cognitive Dimensions [18]: "a reader can
  find every dependency of a sentence (what it reads, what it changes) from the text alone, and
  the §9 defaults that apply to it are visible (`expand --defaults`)".
- **4. Language and content apart**, anchor 5, add: "the grammar is published and small, and
  its size is reported per version".
- **9. Verifiable**, add: "the docs' own examples are checked".
- **10. Consistent**, anchor 5, add: "`fmt` has one output for any input, and the repository
  is `fmt`-clean".
- **11. Evolvable**, replace anchors 3–5 with:
  - 3: specs are local to change; language changes need manual migration.
  - 4: every spec pins its language version; old forms warn, with a fix.
  - 5: as 4, and `intent fix` moves specs across versions, forms are removed on a published
    schedule, and specs of different versions work together; the corpus (apps, lib, docs,
    skill) is always on the newest forms.

**Measured numbers,** recorded with each score (not weighted): *rounds to check* and *tokens to
a checked spec*, averaged over the held-out authors [33].

If a new criterion is wanted later, it is "Feedback: diagnostics, fixes, editor support"; for
now it is covered by the anchors in 2, 6 and 11.

## 5. The five most valuable next steps

Ranked by expected effect on the scorecard per unit of work *(inference)*.

1. **Diagnostics with fixes.** Add fixes to `Diagnostic` and `check --json`, `check --fix`,
   and `intent explain CODE` (2.4). Cheap, and it helps every writer on every spec
   (criterion 2, 12 points).
2. **Editions and `intent fix`.** Every spec pins `language vN`, one rewriter per version, a
   deprecation schedule, and a test that the repository is fix-clean (2.9). Criterion 11, and
   it keeps LLMs from learning old forms from the repo [25].
3. **A type for "nothing".** `X or none` with a checker that forces the empty case to be
   handled (2.5). It removes a whole class of guesses, and is direction item 3.
4. **A canonical `fmt` and a canonical hash.** `fmt` prints the whole spec in one form; the lock
   hashes the canonical form, not the text (2.3, 2.10). Small diffs for reviewers, fewer
   re-locks.
5. **A published grammar and an LSP over it.** `docs/grammar.peg` with a size count, then a
   thin language server over `check --json`: diagnostics, fixes, go-to-definition, hover with
   defaults (2.1, 2.6, 2.8). Criteria 4 and 6.

Close behind: named example steps (2.7), checked doc snippets (2.11), `expand --defaults` (2.6).

## 6. Sources

1. Stack Overflow Developer Survey 2025, Technology: https://survey.stackoverflow.co/2025/technology (admired figures as reported in the survey's summary and search results; the page's admired section did not load in full)
2. Stack Overflow Developer Survey 2025: https://survey.stackoverflow.co/2025/
3. Rob Pike, "Simplicity is Complicated", dotGo 2015: https://go.dev/talks/2015/simplicity-is-complicated.slide
4. Rich Hickey, "Simple Made Easy", 2011: https://www.infoq.com/presentations/Simple-Made-Easy/ and transcript https://github.com/matthiasn/talk-transcripts/blob/master/Hickey_Rich/SimpleMadeEasy.md
5. Go Proverbs: https://github.com/andriisoldatenko/proverbs
6. Evan Czaplicki, "Compiler Errors for Humans", 2015: https://elm-lang.org/news/compiler-errors-for-humans
7. InfoQ, Elm 0.19.1 syntax error messages: https://www.infoq.com/news/2020/01/elm-learn-syntax-error-message
8. Rust compiler dev guide, Errors and lints (suggestions, applicability): https://rustc-dev-guide.rust-lang.org/diagnostics.html
9. Rust error codes index, E0308: https://doc.rust-lang.org/error_codes/E0308.html
10. Gleam FAQ: https://gleam.run/frequently-asked-questions/
11. Zig overview: https://ziglang.org/learn/overview/
12. Gleam language tour: https://tour.gleam.run/everything/
13. Roc, "Friendly": https://www.roc-lang.org/friendly
14. Swift API Design Guidelines: https://www.swift.org/documentation/api-design-guidelines/ ; SwiftUI progressive disclosure, WWDC22: https://developer.apple.com/videos/play/wwdc2022/10059/
15. Yaron Minsky, "Make illegal states unrepresentable" (summary): https://functional-architecture.org/make_illegal_states_unrepresentable/
16. Alexis King, "Parse, don't validate" (discussion): https://lobste.rs/s/uon7sc/parse_don_t_validate_2019
17. Kotlin null safety and the "billion dollar mistake": https://en.wikipedia.org/wiki/Void_safety
18. Cognitive dimensions of notations: https://en.wikipedia.org/wiki/Cognitive_dimensions_of_notations ; Green 1989: https://www.cl.cam.ac.uk/~afb21/CognitiveDimensions/papers/Green1989.pdf
19. Stefik and Siebert, "An Empirical Investigation into Programming Language Syntax", TOCE 2013: https://dl.acm.org/doi/10.1145/2534973 ; summary https://neverworkintheory.org/2014/01/29/stefik-siebert-syntax.html
20. Language Server Protocol: https://en.wikipedia.org/wiki/Language_Server_Protocol
21. Go 1 and the Future of Go Programs: https://go.dev/doc/go1compat
22. Russ Cox, "Backward Compatibility, Go 1.21, and Go 2": https://go.dev/blog/compat
23. Rust Edition Guide, What are editions: https://doc.rust-lang.org/edition-guide/editions/
24. Kotlin evolution principles: https://kotlinlang.org/docs/kotlin-evolution-principles.html
25. Alan Donovan, "Using go fix to modernize Go code", 2026: https://go.dev/blog/gofix
26. Russ Cox, "Minimal Version Selection": https://research.swtch.com/vgo-mvs ; "Reproducible, Verifiable, Verified Builds": https://research.swtch.com/vgo-repro
27. Elm home (enforced semantic versioning): https://elm-lang.org/ ; the behaviour caveat: https://github.com/elm/elm-lang.org/issues/868
28. Dhall safety guarantees: https://docs.dhall-lang.org/discussions/Safety-guarantees.html
29. Unison, The big idea: https://www.unison-lang.org/docs/the-big-idea/
30. Hyrum's Law: https://www.hyrumslaw.com/
31. Cucumber, Writing better Gherkin: https://cucumber.io/docs/bdd/better-gherkin/
32. Joel et al., "A Survey on LLM-based Code Generation for Low-Resource and Domain-Specific Programming Languages", TOSEM: https://arxiv.org/abs/2410.03981
33. Wu, Anderson, Guha, "The Best Programming Language for Tokenmaxxing", 2026: https://arxiv.org/abs/2607.22807
34. MoonBit, "The future of programming languages in the era of LLM": https://www.moonbitlang.com/blog/ai-coding ; Fei et al., "MoonBit: Explore the Design of an AI-Friendly Programming Language", LLM4Code 2024: https://dl.acm.org/doi/10.1145/3643795.3648376
35. Spracklen et al., "We Have a Package for You! A Comprehensive Analysis of Package Hallucinations by Code Generating LLMs": https://arxiv.org/html/2406.10279v1
36. Codd, "A Relational Model of Data for Large Shared Data Banks", 1970: https://rebelsky.cs.grinnell.edu/Courses/CS302/2007S/Readings/codd-1970.pdf ; Jaffray, "What is a query optimizer for?": https://justinjaffray.com/what-is-a-query-optimizer-for/
37. The /llms.txt file: https://llmstxt.org/
38. Mündler et al., "Type-Constrained Code Generation with Language Models", PLDI 2025: https://dl.acm.org/doi/10.1145/3729274
39. Tam et al., "Let Me Speak Freely? A Study on the Impact of Format Restrictions on Performance of Large Language Models", 2024: https://arxiv.org/abs/2408.02442
40. TypeScript design goals (non-goal: a sound type system): https://github.com/microsoft/TypeScript-wiki/blob/main/TypeScript-Design-Goals.md
