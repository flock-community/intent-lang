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
console.log(failures ? `${failures} api runtime failure(s)` : "api runtime tests pass");
process.exit(failures ? 1 : 0);
