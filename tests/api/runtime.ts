// The api runtime answers bad input itself, with fixed messages: every build must answer the same.
import { conforms, route, type EndpointDesc } from "../../runtime/ts/api.ts";

const Email = { k: "Refined" as const, name: "Email", base: { k: "Text" as const }, pattern: "^(?:[^@\\s]+@[^@\\s]+\\.[^@\\s]+)$" };
const Age = { k: "Refined" as const, name: "Age", base: { k: "Int" as const }, min: 0, max: 150 };
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
];
let failures = 0;
for (const [name, got, want] of cases)
  if (JSON.stringify(got) !== JSON.stringify(want)) (failures++, console.log(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
console.log(failures ? `${failures} api runtime failure(s)` : "api runtime tests pass");
process.exit(failures ? 1 : 0);
