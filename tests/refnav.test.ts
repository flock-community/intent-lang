// Following a reference (v66): the lookups the harness generates for both targets, the facts the
// checker records (source map, expanded spec), and the key check the driver runs after every step.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { load, sourceMap } from "../compiler/load.ts";
import { printApp } from "../compiler/print.ts";
import { genElmSpec, tsDomain } from "../compiler/gen.ts";
import { duplicateKey } from "../compiler/keys.ts";

const { app } = load("apps/34-ref-navigation.intent");
assert.ok(app, "apps/34-ref-navigation.intent loads");

// TypeScript: the lookups run on data, and give null when the row is gone.
const dir = mkdtempSync(join(tmpdir(), "refnav-"));
try {
  writeFileSync(join(dir, "domain.ts"), tsDomain(app!));
  const d = await import(pathToFileURL(join(dir, "domain.ts")).href);
  const tickets = [{ id: 1, subject: "A", status: "Open" }, { id: 2, subject: "B", status: "Open" }];
  assert.equal(d.commentTicket(tickets, { id: 1, ticket: 2, body: "x" })?.subject, "B", "a comment's ticket is found by its key");
  assert.equal(d.commentTicket(tickets.slice(0, 1), { id: 1, ticket: 2, body: "x" }), null, "a removed ticket is null");
  assert.equal(d.ticketInTickets(tickets, 1)?.subject, "A", "a state reference is followed by key");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// A reference that may be nothing: its lookup passes nothing through.
const optional = `app O {\n  "x"\n}\n\nrecord T {\n  id: Int\n}\n\nrecord C {\n  t: ref T or nothing\n}\n\nstate {\n  ts: List T = []\n}\n\nscreen {\n  text a = "a"\n}\n`;
const odir = mkdtempSync(join(tmpdir(), "refnav-opt-"));
try {
  writeFileSync(join(odir, "o.intent"), optional);
  const o = load(join(odir, "o.intent"), { ignoreLock: true });
  assert.ok(o.app, o.diagnostics.map((x) => x.message).join("; "));
  writeFileSync(join(odir, "domain.ts"), tsDomain(o.app!));
  const d = await import(pathToFileURL(join(odir, "domain.ts")).href);
  assert.equal(d.cT([{ id: 1 }], { t: null }), null, "nothing stays nothing");
  assert.deepEqual(d.cT([{ id: 1 }], { t: 1 }), { id: 1 });
  assert.match(genElmSpec(o.app!), /cT : List T -> C -> Maybe T\ncT rows row =\n    Maybe.andThen \(tInTs rows\) row\.t/, "Elm: Maybe.andThen for a reference that may be nothing");
} finally {
  rmSync(odir, { recursive: true, force: true });
}

// Elm: the same lookups, in Spec.
assert.match(genElmSpec(app!), /commentTicket : List Ticket -> Comment -> Maybe Ticket/, "Elm: the comment's ticket, or Nothing");
assert.match(genElmSpec(app!), /ticketInTickets : List Ticket -> Int -> Maybe Ticket/, "Elm: a ticket by key");

// What the checker records: each read through a reference, in the source map and the expanded spec.
const map = sourceMap(app!);
assert.deepEqual(map["comments[].about"].follows, ["Comment.ticket in tickets"], "the source map says which reference a value follows");
assert.deepEqual(map["derive onOpen"].follows, ["Comment.ticket in tickets"]);
assert.match(printApp(app!), /its @ticket's @subject: follows Comment\.ticket in @tickets; none → the sentence's fallback/, "the expanded spec notes how it reads");

// The driver's key check: two rows of a home list with one key fail the step that made them.
const keys = [{ field: "tickets", list: "tickets", key: "id", record: "Ticket", line: 29 }];
assert.equal(duplicateKey(keys, { tickets: [{ id: 1 }, { id: 2 }] }), undefined, "unique keys hold");
const dup = duplicateKey(keys, { tickets: [{ id: 1 }, { id: 2 }, { id: 1 }] });
assert.ok(dup && dup.line === 29 && /two rows of `tickets` have id 1 \(rows 1 and 3\)/.test(dup.message), `a repeated key is reported (${dup?.message})`);

console.log("ok refnav: lookups for both targets, nothing passed through, source map and expanded notes, unique keys");
