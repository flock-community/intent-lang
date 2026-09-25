# Design: platform functions

Status: built in v37 for services (TypeScript); screens and Elm later. Asked for by the registry
(Spectavity): a service that computes a release's
version itself must hash the uploaded spec and run the Intent checker on it, instead of
trusting what the publisher sends.

## The problem

Some work needs no judgement but cannot be written well in sentences either: a SHA-256, a
signature check, parsing a format, running a checker. Letting the LLM write it per app is wrong
twice: it is error-prone (a hash written by hand), and two builds could differ. The harness
already owns such work for formatting and dates (`Fmt`, identical in Elm and TypeScript) and for
the clock and secrets (`@now`, `@newToken`). This generalises that.

## The idea: functions a platform provides

A bundle declares signatures; the Intent installation implements them in reviewed code (never
the LLM), per target. As in Roc, where a platform provides every effect and apps stay pure;
here the platform provides pure functions.

```
platform std.crypto {
  "Hashes and checks that need exact, reviewed code."
}

function sha256(text: Text): Text        # lower-case hex
```

```
platform intent.tools {
  "The Intent toolchain, for services about specs (a registry)."
}

record Checked {
  ok: Bool
  problems: List Text
  api: List Text                # the public names, as `intent publish` computes them
  examples: List Text           # the demo examples' fingerprints
  sha: Text
}

function check(source: Text): Checked
```

An app imports a platform like a bundle and uses its functions in sentences, marked like any
name: `- set @digest to @sha256(@source)`, or in words: `the @check of the given @source`.

- The generated interface hands the functions to the app (`platform.sha256(…)` in TypeScript, a
  record of functions in Elm), so compiled code calls them and cannot reimplement them.
- The functions are pure and deterministic, so builds and twin builds agree, and examples can
  state results (`see publish.body.sha = "…"`).
- Each function ships with its own examples in the platform file, run against its
  implementation like a bundle's demo.
- A platform is versioned and locked like a bundle; its implementation is part of the harness
  digest, so a change rebuilds.

## What it is not

- Not effects: platform functions never do I/O. Effects stay declared on contracts
  (`docs/design/effects.md`).
- Not an escape hatch for app logic: a platform function must be generally useful and exactly
  specifiable (a standard, a format, a tool). Review is the gate.

## First steps

1. `std.crypto.sha256` for api targets (TypeScript; Elm later, with a parity test like `Fmt`).
2. `intent.tools.check`, built on `compiler/parse.ts` and the publish code (`apiOf`, example
   fingerprints), so the registry computes versions itself.
3. Then the registry spec uses them, and `intent publish` stops sending `api` and `examples`.
