// The api runtime answers bad input itself, with fixed messages: every build must answer the same.
import { conforms, fromWire, route, toWire, type EndpointDesc, type TypeDesc } from "../../runtime/ts/api.ts";
import { toHttp } from "../../runtime/ts/calls.ts";

const Email = { k: "Refined" as const, name: "Email", base: { k: "Text" as const }, pattern: "^(?:[^@\\s]+@[^@\\s]+\\.[^@\\s]+)$" };
const Title = { k: "Refined" as const, name: "Title", base: { k: "Text" as const }, minLength: 1, maxLength: 3 }; // characters, not UTF-16 units
const Age = { k: "Refined" as const, name: "Age", base: { k: "Int" as const }, min: 0, max: 150 };
// Wire names: `choice Level: Info = "info" | Urgent = "urgent"`.
const Level: TypeDesc = { k: "Choice", name: "Level", values: ["Info", "Urgent"], wire: ["info", "urgent"] };
const Alert: TypeDesc = { k: "Record", name: "Alert", fields: [{ name: "level", type: Level }, { name: "levels", type: { k: "List", of: Level } }] };
const Note: TypeDesc = { k: "Record", name: "Note", fields: [{ name: "text", type: { k: "Text" } }, { name: "due", type: { k: "Maybe", of: { k: "Date" } } }] };
const wired: EndpointDesc[] = [{ name: "raise", method: "POST", path: "/alerts/{level}", params: [{ in: "path", name: "level", type: Level }, { in: "body", name: "also", type: { k: "Maybe", of: Level } }] }];
const eps: EndpointDesc[] = [
  { name: "signUp", method: "POST", path: "/people", params: [{ in: "body", name: "email", type: Email }, { in: "body", name: "age", type: { k: "Maybe", of: Age } }, { in: "body", name: "kind", type: { k: "Choice", name: "Kind", values: ["Member", "Guest"] } }] },
  { name: "person", method: "GET", path: "/people/{id}", params: [{ in: "path", name: "id", type: { k: "Int" } }] },
];
const cases: [string, unknown, unknown][] = [
  ["valid", route(eps, "POST", "/people", {}, { email: "ann@x.nl", kind: "Member" }), { request: { endpoint: "signUp", email: "ann@x.nl", age: null, kind: "Member" } }],
  ["refined text", route(eps, "POST", "/people", {}, { email: "ann", kind: "Member" }), { response: { status: 400, body: { error: "email must be a valid Email" } } }],
  ["refined number", route(eps, "POST", "/people", {}, { email: "ann@x.nl", age: 200, kind: "Member" }), { response: { status: 400, body: { error: "age must be a valid Age" } } }],
  ["missing", route(eps, "POST", "/people", {}, { kind: "Member" }), { response: { status: 400, body: { error: "email is required" } } }],
  ["choice", route(eps, "POST", "/people", {}, { email: "ann@x.nl", kind: "Boss" }), { response: { status: 400, body: { error: "kind must be one of Member, Guest" } } }],
  ["path type", route(eps, "GET", "/people/abc", {}, undefined), { response: { status: 400, body: { error: "id must be a whole number" } } }],
  ["unknown route", route(eps, "GET", "/nothing", {}, undefined), { response: { status: 404, body: { error: "Not found" } } }],
  ["wrong method", route(eps, "DELETE", "/people/1", {}, undefined), { response: { status: 405, body: { error: "Method not allowed" } } }],
  ["contract ok", conforms({ 201: Email }, { status: 201, body: "ann@x.nl" }), undefined],
  ["contract status", conforms({ 201: Email }, { status: 200, body: "ann@x.nl" }), "answered 200, which the contract does not declare (201)"],
  ["contract body", conforms({ 201: Email }, { status: 201, body: "nope" }), "answered 201, but the body must be a valid Email"],
  ["wire out", toWire({ level: "Urgent", levels: ["Info", "Urgent"] }, Alert), { level: "urgent", levels: ["info", "urgent"] }],
  ["wire in", fromWire({ level: "urgent", levels: ["info"] }, Alert), { level: "Urgent", levels: ["Info"] }],
  ["wire request", route(wired, "POST", "/alerts/urgent", {}, { also: "info" }), { request: { endpoint: "raise", level: "Urgent", also: "Info" } }],
  ["wire request refuses", route(wired, "POST", "/alerts/loud", {}, {}), { response: { status: 400, body: { error: "level must be one of info, urgent" } } }],
  ["wire call", toHttp([{ name: "a.raise", method: "POST", path: "/alerts/{level}", params: [{ in: "path", name: "level", type: Level }, { in: "body", name: "also", type: Level }] }], { endpoint: "a.raise", args: { level: "Urgent", also: "Info" } }), { method: "POST", path: "/alerts/urgent", query: {}, body: { also: "info" } }],
  ["wire answer fits", conforms({ 200: Alert }, { status: 200, body: { level: "urgent", levels: [] } }), undefined],
  ["length ok", conforms({ 200: Title }, { status: 200, body: "🎉🎉🎉" }), undefined],
  ["length long", conforms({ 200: Title }, { status: 200, body: "four" }), "answered 200, but the body must be a valid Title"],
  ["length empty", conforms({ 200: Title }, { status: 200, body: "" }), "answered 200, but the body must be a valid Title"],
  // Nothing on the wire: a `T or nothing` is always written as null; on input null and a missing key are
  // both nothing; for a `T`, a missing key is "is required" and null is "must be <type>".
  ["nothing: null in", route(eps, "POST", "/people", {}, { email: "ann@x.nl", age: null, kind: "Member" }), { request: { endpoint: "signUp", email: "ann@x.nl", age: null, kind: "Member" } }],
  ["nothing: missing in", route(eps, "POST", "/people", {}, { email: "ann@x.nl", kind: "Member" }), { request: { endpoint: "signUp", email: "ann@x.nl", age: null, kind: "Member" } }],
  ["T: missing is required", route(eps, "POST", "/people", {}, { age: 3, kind: "Member" }), { response: { status: 400, body: { error: "email is required" } } }],
  ["T: null must be", route(eps, "POST", "/people", {}, { email: null, kind: "Member" }), { response: { status: 400, body: { error: "email must be a valid Email" } } }],
  ["T: null choice must be", route(eps, "POST", "/people", {}, { email: "ann@x.nl", kind: null }), { response: { status: 400, body: { error: "kind must be one of Member, Guest" } } }],
  ["T: null in a record field", conforms({ 200: Note }, { status: 200, body: { text: null, due: null } }), "answered 200, but the body.text must be text"],
  ["T: missing in a record field", conforms({ 200: Note }, { status: 200, body: { due: null } }), "answered 200, but the body.text is required"],
  ["nothing: missing in a record field fits", conforms({ 200: Note }, { status: 200, body: { text: "a" } }), undefined],
  ["nothing: written as null", toWire({ text: "a" }, Note), { text: "a", due: null }],
  ["nothing: null stays null", toWire({ text: "a", due: null }, Note), { text: "a", due: null }],
  ["nothing: in a list of records", toWire([{ text: "a" }], { k: "List", of: Note }), [{ text: "a", due: null }]],
  ["nothing: read as null", fromWire({ text: "a" }, Note), { text: "a", due: null }],
  ["nothing: a call writes null", toHttp([{ name: "a.note", method: "POST", path: "/notes", params: [{ in: "body", name: "text", type: { k: "Text" } }, { in: "body", name: "due", type: { k: "Maybe", of: { k: "Date" } } }] }], { endpoint: "a.note", args: { text: "a" } }), { method: "POST", path: "/notes", query: {}, body: { text: "a", due: null } }],
];
let failures = 0;
for (const [name, got, want] of cases)
  if (JSON.stringify(got) !== JSON.stringify(want)) (failures++, console.log(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
// Maps (1.1): a JSON object of any keys, checked value by value, written and read in key order; a key
// `__proto__` is a key like any other (it never reaches the object's prototype); kept data migrates.
{
  const { migrate } = await import("../../runtime/ts/api.ts");
  const colors: TypeDesc = { k: "Map", of: { k: "Refined", name: "Color", base: { k: "Text" }, pattern: "^(?:#[0-9a-f]{6})$" } };
  const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) (failures++, console.log(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)); };
  eq("map: written in key order", JSON.stringify(toWire({ b: "#000002", a: "#000001", "10": "#000003" }, colors)), JSON.stringify({ "10": "#000003", a: "#000001", b: "#000002" }));
  eq("map: read in key order", Object.keys(fromWire({ z: "#000001", m: "#000002" }, colors) as object), ["m", "z"]);
  const proto = fromWire(JSON.parse('{"__proto__": "#000001"}'), colors) as Record<string, unknown>;
  eq("map: __proto__ is a key", [Object.keys(proto), Object.getPrototypeOf(proto) === Object.prototype], [["__proto__"], true]);
  eq("map: a bad value is refused", conforms({ 200: colors }, { status: 200, body: { primary: "blue" } }), 'answered 200, but the body["primary"] must be a valid Color');
  eq("map: not an object", conforms({ 200: colors }, { status: 200, body: ["#000001"] }), `answered 200, but the body must be an object of a valid Color by key`);
  eq("map: kept data migrates", migrate({ theme: { b: "#000002", a: "#000001" }, gone: 1 }, { theme: colors }), { data: { theme: { a: "#000001", b: "#000002" } }, dropped: [] });
  eq("map: one value that cannot migrate drops the field", migrate({ theme: { a: "red" } }, { theme: colors }).dropped, ["theme"]);
}
// Instants (1.1): every ISO 8601 form with a zone is read into one form, UTC to the second; a moment
// without a zone, an impossible date or an offset beyond ±14:00 is not an instant.
{
  const { parseInstant } = await import("../../runtime/ts/fmt.ts");
  const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) (failures++, console.log(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)); };
  const cases: [string, string | null][] = [
    ["2026-09-24T07:00:00Z", "2026-09-24T07:00:00Z"], ["2026-09-24T09:00:00+02:00", "2026-09-24T07:00:00Z"], ["2026-09-24T09:00+02:00", "2026-09-24T07:00:00Z"],
    ["2026-01-01T00:30:00.999+01:00", "2025-12-31T23:30:00Z"], ["2026-12-31T23:30:00-01:00", "2027-01-01T00:30:00Z"], ["0026-09-24T07:00:00Z", "0026-09-24T07:00:00Z"],
    ["2024-02-29T12:00:00Z", "2024-02-29T12:00:00Z"], [" 2026-09-24T07:00:00Z ", "2026-09-24T07:00:00Z"],
    ["2026-09-24T07:00:00", null], ["2026-09-24 07:00:00Z", null], ["2023-02-29T12:00:00Z", null], ["2026-09-24T24:00:00Z", null], ["2026-09-24T07:00:60Z", null], ["2026-09-24T07:00:00+15:00", null],
  ];
  for (const [x, want] of cases) eq(`instant ${x}`, parseInstant(x), want);
  const at: TypeDesc = { k: "Instant" };
  eq("instant: read into its form", fromWire("2026-09-24T09:00:00+02:00", at), "2026-09-24T07:00:00Z");
  eq("instant: no zone is refused", conforms({ 200: at }, { status: 200, body: "2026-09-24T07:00:00" }), "answered 200, but the body must be an instant with a zone (YYYY-MM-DDTHH:MM:SSZ)");
}
// Unions (1.1): the tag says which record, by its wire name or its own; the app reads its own name and
// the wire gets the wire name; an unknown tag, a missing field and a non-object are refused; kept data migrates.
{
  const { migrate } = await import("../../runtime/ts/api.ts");
  const eq = (name: string, got: unknown, want: unknown) => { if (JSON.stringify(got) !== JSON.stringify(want)) (failures++, console.log(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)); };
  const trigger: TypeDesc = { k: "Union", name: "Trigger", tag: "kind", variants: [{ name: "Daily", wire: "daily", fields: [{ name: "at", type: { k: "Text" } }] }, { name: "Weekly", wire: "weekly", fields: [{ name: "day", type: { k: "Text" } }, { name: "at", type: { k: "Text" } }] }] };
  eq("union: read by its wire name", fromWire({ kind: "weekly", day: "Mon", at: "02:00", extra: 1 }, trigger), { kind: "Weekly", day: "Mon", at: "02:00" });
  eq("union: and by its own name", fromWire({ kind: "Daily", at: "09:00" }, trigger), { kind: "Daily", at: "09:00" });
  eq("union: written by its wire name, the tag first", toWire({ kind: "Daily", at: "09:00" }, trigger), { kind: "daily", at: "09:00" });
  eq("union: in one order, however it was built", JSON.stringify(toWire({ at: "02:00", day: "Mon", kind: "Weekly" }, trigger)), JSON.stringify({ kind: "weekly", day: "Mon", at: "02:00" }));
  eq("union: an unknown kind", conforms({ 200: trigger }, { status: 200, body: { kind: "hourly", at: "02:00" } }), "answered 200, but the body.kind must be one of daily, weekly");
  eq("union: a missing field", conforms({ 200: trigger }, { status: 200, body: { kind: "weekly", at: "02:00" } }), "answered 200, but the body.day is required");
  eq("union: no tag", conforms({ 200: trigger }, { status: 200, body: { at: "02:00" } }), "answered 200, but the body.kind must be one of daily, weekly");
  eq("union: kept data migrates", migrate({ t: { kind: "Weekly", day: "Mon", at: "02:00" } }, { t: trigger }), { data: { t: { kind: "Weekly", day: "Mon", at: "02:00" } }, dropped: [] });
  eq("union: a removed kind cannot migrate", migrate({ t: { kind: "Hourly" } }, { t: trigger }).dropped, ["t"]);
}
console.log(failures ? `${failures} api runtime failure(s)` : "api runtime tests pass");
process.exit(failures ? 1 : 0);
