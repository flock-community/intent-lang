# Wirespec: what we learned (September 2026)

Question: should Intent adopt Wirespec (Flock's contract language) as its only type and
contract layer? Decision: **no. Intent has its own contract system in the spirit of
Wirespec** (language v18, §4f).

Findings (checked against the Wirespec source at commit 9f39cfc and `@flock/wirespec@0.21.1`,
with the tickets API compiled to TypeScript, Kotlin, Java, Python, Rust, Scala, OpenAPI and Avro):

- **What Wirespec does well, and Intent takes over:**
  - one contract generating code for every side;
  - responses typed per status code;
  - refined types (`String(/re/)`, `Integer(0, _)`);
  - unions of named types;
  - headers;
  - transport-free `rpc` and one-way `channel`;
  - generated test data.
- **What Intent needs and Wirespec lacks:**
  - a decimal type;
  - field defaults;
  - display labels for enum values;
  - field notes;
  - seed data;
  - modules, imports and versioning;
  - an Elm target;
  - runtime validation. Wirespec's TypeScript output does not reject `{subject: 42,
    priority: "Soon"}`, and path params typed as numbers arrive as strings.
- **Wirespec only covers the wire.** Contracts inside an app (between components, or a screen
  and its logic) are outside its scope, so Intent would keep its own type layer regardless.
  Adopting Wirespec would mean maintaining two layers, not one.
