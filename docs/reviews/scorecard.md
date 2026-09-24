# Intent language scorecard

A fixed yardstick for judging the language, so that each version can be scored the same way
and compared. The criteria and weights come from what matters for this project (see
`AGENTS.md` and the owner's decisions so far):

- the main writers are LLMs, and people read and review the specs, often without tooling
  (GitHub, diffs);
- the same spec must give the same app, and a vague spec must be caught instead of guessed;
- the language must stay general: lessons from one app become constructs for many;
- language and content must be easy to tell apart; the core is small, and vocabulary lives in
  profiles and reusable specs;
- anything in an app must lead back to a spec line, and every name to its declaration;
- quality comes from reusing well-proven specs (bundles, components, layers, contracts).

## How to score

Score each criterion from 1 to 5 using the anchors (2 and 4 lie between them). Give evidence
for every score: a file and line, a command and its result, or a measurement. A score without
evidence does not count. The total is the weighted average, scaled to 100:
`sum(score × weight) / (5 × sum(weights)) × 100`.

Score the language as it is (reference, specs, harness), not as it could be. For each
criterion, name the one change that would raise it most.

## The criteria

| # | Criterion | Weight | What it asks |
|---|---|---|---|
| 1 | Same spec, same app | 12 | Do repeated and independent builds of an unchanged spec behave the same, and is a vague spec caught? |
| 2 | Writable by an LLM | 12 | Does an LLM with only the docs write specs that check and build, on the first try? |
| 3 | Readable without tooling | 10 | Can a person read a spec on GitHub, without colour or IDE, and tell what it does? |
| 4 | Language and content apart | 8 | Is it clear what is language (core), vocabulary (profiles), names, literal text and prose? |
| 5 | General, not tied to one app or medium | 10 | Do the constructs serve many kinds of apps, and is the intent separable from the medium (web, terminal, API)? |
| 6 | Traceable | 10 | Does everything in a running app lead to a spec line, and every name to where it is declared? |
| 7 | Reuse and composition | 10 | Can proven specs be reused and improved (bundles, components, layers, contracts, refinement, registry)? |
| 8 | Covers real apps | 10 | How much of a real application (openouros, a typical SaaS) can be written without faking? |
| 9 | Verifiable | 8 | Do examples, `always` rules and contracts catch real mistakes (planted bugs, ambiguities)? |
| 10 | Consistent | 5 | Is there one way to say a thing, with the same form for the same idea everywhere? |
| 11 | Evolvable | 5 | Are changes small and local in a spec, and can the language itself change without breaking specs (versions, `fmt`, migrations)? |

Total weight: 100.

## Anchors

**1. Same spec, same app**
- 1: builds of the same spec often behave differently; ambiguity goes unnoticed.
- 3: most builds agree; differences are found by comparing builds after the fact.
- 5: independent builds agree in (nearly) all measured sessions, across targets; every new spec
  is compiled twice and an ambiguity stops the build with the sentence to fix.

**2. Writable by an LLM**
- 1: an LLM needs many rounds of checker errors to get a spec that checks.
- 3: specs check after a few rounds; builds often need repairs.
- 5: a fresh LLM with only the docs writes specs that check with at most a hint or two, and
  that build on the first attempt.

**3. Readable without tooling**
- 1: structure, names and prose are hard to tell apart in plain text.
- 3: readable with effort; some constructs need the reference.
- 5: a newcomer reads a spec in plain text and can say what the app does, what each sentence
  refers to, and where each block ends.

**4. Language and content apart**
- 1: keywords, names and prose look the same; the core is large and domain-specific.
- 3: most names are marked or positional; vocabulary is partly in profiles.
- 5: the core is small; vocabulary comes from profile specs; every reference in prose is marked;
  literal text is quoted.

**5. General**
- 1: constructs are shaped around one app or one medium.
- 3: constructs are general, but intent and medium are mixed (a spec is a web screen).
- 5: constructs serve many apps; the same intent can be built for several media through profiles.

**6. Traceable**
- 1: generated code cannot be tied back to spec lines.
- 3: UI elements and errors lead to spec lines; names from other files are hard to find.
- 5: every element, error and answer leads to its spec line; every name leads to its declaration,
  in plain text (imports) and in an editor (go to definition).

**7. Reuse and composition**
- 1: every app starts from scratch.
- 3: libraries exist, but reuse means copying or has no versioning or proof.
- 5: bundles, components, layers, contracts and refinement, versioned and proven by their own
  examples, with a registry; verified code is reused without recompiling.

**8. Covers real apps**
- 1: only toy apps.
- 3: CRUD screens and APIs; real apps need faking for time, events, persistence, auth or effects.
- 5: most features of a real application can be written directly.

**9. Verifiable**
- 1: examples only; mistakes surface in use.
- 3: examples plus invariants; some planted bugs slip through.
- 5: examples, invariants, contracts and random sessions catch planted bugs and ambiguities, and
  the measurement itself is checked.

**10. Consistent**
- 1: many ways to say the same thing; forms differ per construct.
- 3: mostly consistent, with some historical exceptions.
- 5: one form per idea (blocks, references, bindings, verbs) everywhere.

**11. Evolvable**
- 1: a small wish means rewriting large parts; language changes break specs silently.
- 3: changes are local; language changes need manual migration.
- 5: wishes map to small local spec changes (a sentence, a rule, an example, an override); the
  language is versioned, specs pin it, and `fmt`/migrations move specs forward.

## Scores

| Version | Date | Total | Scored by | File |
|---|---|---|---|---|
| v26 | 2026-09-24 | see file | independent reviewer | [scores/v26.md](scores/v26.md) |
