// Target: TypeScript services, the api profile and layers (Node). The generated interface
// (typed handlers, endpoint descriptions), the fixed router, server and test client, the typed
// client for a contract, a layer's interface and stub app, what the prompt says, and the toolchain.
// The drivers that run examples and random requests against a build stay in api.ts and layer.ts.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App, Endpoint, Type } from "../ast.ts";
import { LINE_BASE } from "../ast.ts";
import { usesClock, usesToken } from "../refs.ts";
import { layerConfig } from "../layer.ts";
import { dataField, hasData, ROOT } from "./shared.ts";
import { tsData, tsDomain, tsStoredFields, tsType } from "./ts.ts";
import { bin, clean, run } from "../tools.ts";
import type { ServiceModule } from "./target.ts";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const q = (s: string) => JSON.stringify(s);

/** The files an app build needs from a verified layer build. */
export const LAYER_FILES = ["layer.ts", "spec.ts", "http.ts", "fmt.ts"];

// ---------------------------------------------------------------- generated interface

export function typeDesc(app: App, t: Type): string {
  switch (t.k) {
    case "Text": case "Int": case "Decimal": case "Bool": case "Date": case "DateTime": return `{ k: ${q(t.k)} }`;
    case "List": return `{ k: "List", of: ${typeDesc(app, t.of)} }`;
    case "Maybe": return `{ k: "Maybe", of: ${typeDesc(app, t.of)} }`;
    case "Named": {
      const rf = app.refined?.find((x) => x.name === t.name);
      if (rf) return `{ k: "Refined", name: ${q(rf.name)}, base: { k: ${q(rf.base)} }${rf.pattern !== undefined ? `, pattern: ${q(`^(?:${rf.pattern})$`)}` : ""}${rf.min !== undefined ? `, min: ${rf.min}` : ""}${rf.max !== undefined ? `, max: ${rf.max}` : ""} }`;
      const c = app.choices.find((x) => x.name === t.name);
      if (c) return `{ k: "Choice", name: ${q(c.name)}, values: ${JSON.stringify(c.values)} }`;
      const r = app.records.find((x) => x.name === t.name)!;
      return `{ k: "Record", name: ${q(r.name)}, fields: [${r.fields.map((f) => `{ name: ${q(f.name)}, type: ${typeDesc(app, f.type)} }`).join(", ")}] }`;
    }
  }
}

const typeName = (e: { name: string }) => cap(e.name);

/** \`file:line\` of a line of an app (lines of imported files are offset by their file index). */
export function specLine(app: App, line: number): string {
  const file = app.sources?.[Math.floor(line / LINE_BASE)]?.file ?? `${app.name}.intent`;
  return `${file}:${line % LINE_BASE}`;
}

export function genApiSpec(app: App): string {
  const eps = app.endpoints ?? [];
  // What the layers hand to every endpoint (\`provides caller: Text\` in std.http.apiKey).
  const provided = [
    ...(app.layers ?? []).flatMap((l) => (l.spec?.provides ?? []).map((p) => ({ ...p, from: `layer ${l.alias}` }))),
    // The clock (@now, @today) comes with every request of an api that reads it.
    ...(usesClock(app) ? [{ name: "now", type: { k: "DateTime" } as Type, note: "the time of the request", from: "the clock", line: 0 }, { name: "today", type: { k: "Date" } as Type, note: "its day", from: "the clock", line: 0 }] : []),
    // A fresh secret for the request (@newToken): a key, an invitation code, a reset link.
    ...(usesToken(app) ? [{ name: "newToken", type: { k: "Text" } as Type, note: "a fresh random secret, 32 hex characters; use it as it is", from: "the harness", line: 0 }] : []),
  ];
  const jobs = app.jobs ?? [];
  const respType = (e: Endpoint) =>
    e.answers?.length
      ? e.answers.map((a) => `{ status: ${a.status}; body: ${a.type ? tsType(a.type) : "null"} }`).join(" | ")
      : "Response";
  return `// Generated from ${app.name}.intent — do not edit. The interface the app module must satisfy.
import type { EndpointDesc, Response, TypeDesc } from "./api.ts";
export type { Response } from "./api.ts";
${(app.platforms ?? []).map((p) => `/** Platform ${p.name}: ${p.functions.map((f) => f.name).join(", ")}. Exact, reviewed code from the Intent installation: use these, never write your own. */\nexport { ${p.functions.map((f) => f.name).join(", ")} } from "./platform/${p.name}.js";\n`).join("")}
${tsDomain(app)}${hasData(app) ? tsData(app) : ""}${provided.length ? `/** What the layers hand to every endpoint: ${provided.map((p) => `\\\`${p.name}\\\` from ${p.from}${p.note ? ` (${p.note})` : ""}`).join("; ")}. */\nexport type Provided = { ${provided.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };\n\n` : ""}/** One variant per endpoint, with its validated input (path, query and body params together)${provided.length ? ", and what the layers provide" : ""}. */
export type Request =
${eps.map((e) => `  | { endpoint: ${q(e.name)}${e.params.map((p) => `; ${p.name}: ${tsType(p.type)}`).join("")}${provided.map((p) => `; ${p.name}: ${tsType(p.type)}`).join("")} }`).join("\n")};

${eps
  .map(
    (e) => `/** ${e.method} ${e.path} */
export type ${typeName(e)}Request = Extract<Request, { endpoint: ${q(e.name)} }>;
/** What ${e.name} may answer${e.answers?.length ? " (its contract)" : ""}. */
export type ${typeName(e)}Response = ${respType(e)};`,
  )
  .join("\n\n")}

${(app.events ?? []).length ? `/** An event this api announces (\\\`publish x\\\` in a step): the name and its payload. */\nexport type Published =\n${(app.events ?? []).map((ev) => `  | { event: ${q(ev.name)}; body: ${tsType(ev.type)} }`).join("\n")};\n\n/** The payload type of every event, checked on every publish in tests. */\nexport const eventTypes: Record<string, TypeDesc> = { ${(app.events ?? []).map((ev) => `${ev.name}: ${typeDesc(app, ev.type)}`).join(", ")} };\n\n` : `export type Published = never;\nexport const eventTypes: Record<string, TypeDesc> = {};\n\n`}/** One handler per endpoint: the request and the model in; the new model, the answer, and the events it publishes (in step order) out. */
export type Handlers<M> = {
${eps.map((e) => `  ${e.name}: (req: ${typeName(e)}Request, model: M) => { model: M; response: ${typeName(e)}Response; publish?: Published[] };`).join("\n")}
};

${jobs.length ? `/** Recurring work (\\\`every …\\\` in the spec): the model and the clock at its time in; the new model and the events it publishes out. */\nexport type Jobs<M> = {\n${jobs.map((j) => `  ${j.name}: (model: M, clock: Clock) => { model: M; publish?: Published[] };`).join("\n")}\n};\n\n` : ""}/** Recurring work and how often it runs (ms). */
export const jobList: { name: string; every: number }[] = ${JSON.stringify(jobs.map((j) => ({ name: j.name, every: j.every })))};
${tsStoredFields(app)}/** Endpoints with \\\`effect external\\\`: a request without an idempotency key is refused (400). */
export const externalEndpoints: string[] = ${JSON.stringify((app.endpoints ?? []).filter((e) => e.effect).map((e) => e.name))};
/** Whether endpoints get a fresh secret (\\\`@newToken\\\`). */
export const usesToken = ${usesToken(app)};


/** The endpoints, for the router: methods, paths and parameter types. */
export const endpoints: EndpointDesc[] = [
${eps.map((e) => `  { name: ${q(e.name)}, method: ${q(e.method)}, path: ${q(e.path)}, params: [${e.params.map((p) => `{ in: ${q(p.in)}, name: ${q(p.name)}, type: ${typeDesc(app, p.type)} }`).join(", ")}] },`).join("\n")}
];

/** Where each endpoint is in the spec: \`file:line\`, for tracing an answer back to its source. */
export const sources: Record<string, string> = { ${eps.map((e) => `${e.name}: ${q(specLine(app, e.line))}`).join(", ")} };

/** Per endpoint and status: the one step that answers it (\`answer 409 …\`), when exactly one does. */
export const answerSources: Record<string, Record<number, string>> = { ${eps
  .map((e) => {
    const by = new Map<number, number[]>();
    e.steps.forEach((st, i) => [...st.matchAll(/\banswer\s+([1-5]\d\d)\b/g)].forEach((m) => by.set(Number(m[1]), [...(by.get(Number(m[1])) ?? []), e.stepLines?.[i] ?? e.line])));
    return `${e.name}: { ${[...by].filter(([, ls]) => ls.length === 1).map(([st, ls]) => `${st}: ${q(specLine(app, ls[0]))}`).join(", ")} }`;
  })
  .join(", ")} };

/** The contract's answers per endpoint (status → body type), checked on every answer in tests. */
export const answers: Record<string, Record<number, TypeDesc | null>> = {
${eps.filter((e) => e.answers?.length).map((e) => `  ${e.name}: { ${e.answers!.map((a) => `${a.status}: ${a.type ? typeDesc(app, a.type) : "null"}`).join(", ")} },`).join("\n")}
};
`;
}

export const API_APP_SKELETON = `import type { Handlers /* , Ticket, … */ } from "./spec.ts";
import { answer, fail } from "./api.ts";
import * as Fmt from "./fmt.ts";

export type Model = { /* … */ };

export function init(): Model { /* … */ }

export const handlers: Handlers<Model> = {
  someEndpoint: (req, model) => { /* … */ return { model, response: answer(200, …) }; },
  /* one per endpoint */
};
`;

/** One request through the layers (in order), the router and the handlers, and back out through the layers. */
const PIPELINE = `import * as App from "./app.ts";
import { route } from "./api.ts";
import { normalize, type HttpRequest, type HttpResponse } from "./http.ts";
import type { Clock } from "./clock.ts";
import { answerSources, endpoints, externalEndpoints, sources, usesToken } from "./spec.ts";
import { layers } from "./layers.ts";
import { fingerprint, keyed, KEY_HEADER, recall, remember, type Keys } from "./once.ts";

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

export type Handled = HttpResponse & { endpoint?: string; appAnswer?: { status: number; body: unknown }; events: { event: string; body: unknown }[]; source?: string };

/** \`token\`: where fresh secrets (@newToken) come from; numbered in tests (token-1, token-2, …), random on the server. */
export function pipeline(token?: () => string) {
  let tokens = 0;
  const newToken = token ?? (() => \`token-\${++tokens}\`);
  let model = App.init();
  /** Answers remembered by idempotency key (once.ts): kept with the stored state, and across a restart. */
  let keys: Keys = {};
  /** Recurring work (\`every …\`): runs with the clock at its time; returns the events it published. */
  const runJob = (name: string, clock: Clock): { event: string; body: unknown }[] => {
    const job = (App as any).jobs?.[name];
    if (!job) return [];
    const out = job(copy(model), clock);
    model = out.model;
    return copy(out.publish ?? []);
  };
  const handle = (req: HttpRequest, clock?: Clock): Handled => {
    const passed: typeof layers = [];
    const provided: Record<string, unknown> = {};
    let res: HttpResponse | undefined;
    let endpoint: string | undefined;
    let appAnswer: { status: number; body: unknown } | undefined;
    let events: { event: string; body: unknown }[] = [];
    let source: string | undefined; // the spec line that answered: a layer that refused, or the endpoint
    // A layer's config: its bound literals, and the params bound to the app's state as they are now.
    const configOf = (l: (typeof layers)[number]) => (l.state ? { ...(l.config as object), ...Object.fromEntries(Object.entries(l.state).map(([p, f]) => [p, (data() as Record<string, unknown>)[f]])) } : l.config);
    for (const l of layers) {
      passed.push(l);
      const b = l.before(copy(req), copy(configOf(l)));
      if ("answer" in b) {
        res = normalize(b.answer);
        source = \`\${l.source} (layer \${l.name})\`;
        break;
      }
      Object.assign(provided, copy(b.pass));
    }
    // The event stream (\`GET /events\` on the server) passes the layers, then opens; it is not an endpoint.
    if (!res && (req as { stream?: boolean }).stream) res = { status: 200, headers: {}, body: null };
    if (!res) {
      const r = route(endpoints, req.method, req.path, req.query, req.body === undefined ? undefined : copy(req.body));
      // Effectively once: a request with a key the service answered before gets that answer again.
      const key = keyed(req.method) ? req.headers[KEY_HEADER] : undefined;
      const caller = typeof provided.caller === "string" ? provided.caller : "";
      const fp = fingerprint(req.method, req.path, req.body);
      const earlier = key ? recall(keys, caller, key, fp, clock?.now) : undefined;
      if ("response" in r) res = { ...r.response, headers: {} };
      else if (earlier && "conflict" in earlier) {
        res = { status: 422, headers: {}, body: { error: earlier.conflict } };
        source = \`the idempotency key \${JSON.stringify(key)} (harness)\`;
      } else if (earlier) {
        endpoint = earlier.replay.endpoint;
        appAnswer = copy({ status: earlier.replay.status, body: earlier.replay.body });
        res = { status: earlier.replay.status, headers: { "idempotent-replayed": "true" }, body: copy(earlier.replay.body) };
        source = \`the answer to the idempotency key \${JSON.stringify(key)}, replayed (endpoint \${endpoint})\`;
      } else if (!key && externalEndpoints.includes(r.request.endpoint as string)) {
        res = { status: 400, headers: {}, body: { error: "An idempotency-key header is required" } };
        source = \`\${sources[r.request.endpoint as string]} (endpoint \${r.request.endpoint}: effect external)\`;
      } else {
        endpoint = r.request.endpoint as string;
        source = \`\${sources[endpoint]} (endpoint \${endpoint})\`;
        const out = (App.handlers as any)[endpoint]({ ...r.request, ...provided, ...(clock ? { now: clock.now, today: clock.today } : {}), ...(usesToken ? { newToken: newToken() } : {}) }, model);
        model = out.model;
        appAnswer = copy({ status: out.response.status, body: out.response.body });
        events = copy(out.publish ?? []);
        res = { status: out.response.status, headers: {}, body: out.response.body };
        // Remembered together with the change it made (one update of the service's state).
        if (key) remember(keys, caller, key, { fingerprint: fp, endpoint, status: appAnswer!.status, body: appAnswer!.body, at: clock?.now ?? "" });
        const step = answerSources[endpoint]?.[out.response.status];
        if (step) source = \`\${step} (endpoint \${endpoint})\`;
      }
    }
    for (const l of passed.reverse()) res = normalize(l.after(copy(req), copy(res), copy(configOf(l))));
    return { ...normalize(res), endpoint, appAnswer, events, source };
  };
  /** The app's data, for the checks in \`always\` and to keep what is stored. */
  const data = () => ((App as any).data ? copy((App as any).data(model)) : undefined);
  /** Stored state: the api starts again with the stored fields of its data (a restart, or the data file on the server). */
  const restore = (saved: unknown) => {
    model = (App as any).restore(copy(saved), App.init());
  };
  /** The remembered answers, for the data file on the server. */
  const remembered = { get: () => copy(keys), set: (k: Keys) => (keys = copy(k ?? {})) };
  return Object.assign(handle, { runJob, data, restore, remembered });
}
`;

const SERVER = `import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pipeline } from "./pipeline.ts";
import { jobList, storedFields } from "./spec.ts";
import { fits } from "./api.ts";
import { localClock } from "./clock.ts";

// Fresh secrets (@newToken) on the server: 16 random bytes from the operating system, as hex.
const handle = pipeline(() => randomBytes(16).toString("hex"));
// Stored state (\`stored\` in the spec) lives in a JSON file (INTENT_DATA, default data.json): read at the
// start, written after every request and every run of recurring work.
const DATA_FILE = process.env.INTENT_DATA ?? "data.json";
const stored = Object.keys(storedFields);
const pick = (d: any) => Object.fromEntries(stored.map((f) => [f, d?.[f]]));
if (stored.length && existsSync(DATA_FILE)) {
  let saved: any;
  try {
    saved = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch (e) {
    console.error(\`\${DATA_FILE} cannot be read (\${(e as Error).message}); starting from the spec's defaults\`);
  }
  const wrong = saved === undefined ? undefined : stored.find((f) => !fits(saved?.[f], storedFields[f]));
  if (wrong) console.error(\`\${DATA_FILE}: \${wrong} does not fit the spec's type; starting from the spec's defaults\`);
  else if (saved !== undefined) {
    handle.restore(saved);
    handle.remembered.set(saved.idempotencyKeys);
  }
}
// The stored fields and the answers remembered by idempotency key, in one write.
const keep = () => {
  if (stored.length) writeFileSync(DATA_FILE, JSON.stringify({ ...pick(handle.data()), idempotencyKeys: handle.remembered.get() }));
};
// Events go to every open \`GET /events\` stream (Server-Sent Events), as \`{ "event": name, "body": payload }\`.
const streams = new Set<import("node:http").ServerResponse>();
createServer((req, res) => {
  if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/events") {
    // The stream passes the layers like any request (a key, an origin); only then does it open.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k.toLowerCase()] = v;
    const url = new URL(req.url ?? "/", "http://localhost");
    const gate = handle({ method: "GET", path: "/events", query: Object.fromEntries(url.searchParams), headers, body: undefined, stream: true } as any);
    if (gate.status !== 200) {
      res.writeHead(gate.status, { "content-type": "application/json", ...gate.headers });
      res.end(JSON.stringify(gate.body));
      return;
    }
    res.writeHead(200, { ...gate.headers, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": open\\n\\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let body: unknown = undefined;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = null;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k.toLowerCase()] = v;
    const out = handle({ method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body }, localClock());
    keep();
    for (const ev of out.events) for (const s of streams) s.write(\`data: \${JSON.stringify(ev)}\\n\\n\`);
    const noBody = out.status === 204 || out.status === 304 || req.method === "HEAD";
    // INTENT_TRACE=1: every answer says which spec line gave it (never on in production: it names files).
    const trace = process.env.INTENT_TRACE === "1" && out.source ? { "x-intent-source": out.source } : {};
    res.writeHead(out.status, { ...(noBody ? {} : { "content-type": "application/json" }), ...out.headers, ...trace });
    res.end(noBody ? undefined : JSON.stringify(out.body));
  });
}).listen(Number(process.env.PORT ?? 3000), () => console.log("listening on " + (process.env.PORT ?? 3000)));
// Recurring work on timers; what it publishes goes to the open event streams.
for (const j of jobList) setInterval(() => {
  for (const ev of handle.runJob(j.name, localClock())) for (const s of streams) s.write(\`data: \${JSON.stringify(ev)}\\n\\n\`);
  keep();
}, j.every);
`;

const TEST_ENTRY = `import { conforms } from "./api.ts";
import { answers, eventTypes } from "./spec.ts";
import { pipeline } from "./pipeline.ts";
import type { Clock } from "./clock.ts";

/** A client for tests: the same layers, routing and validation as the server, without the network. */
export function start() {
  const handle = pipeline();
  return {
    /** Would an event stream with these headers open (GET /events through the layers)? Its status. */
    stream(headers: Record<string, string> = {}, query: Record<string, string> = {}) {
      return handle({ method: "GET", path: "/events", query, headers, body: undefined, stream: true } as any).status;
    },
    /** The app's data, for the checks in \`always\`. */
    data() {
      return handle.data();
    },
    /** Stored state: the api starts again with these stored fields (a \`restart\` in an example). */
    restart(saved: unknown) {
      handle.restore(saved);
    },
    /** Recurring work, run by the driver when a \`wait\` moves the clock past its time. */
    runJob(name: string, clock: Clock) {
      return handle.runJob(name, clock);
    },
    send(method: string, path: string, query: Record<string, string>, body: unknown, headers: Record<string, string> = {}, clock?: Clock) {
      const out = handle({ method, path, query, headers, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) }, clock);
      const response = { status: out.status, body: out.body, headers: out.headers, events: out.events, source: out.source };
      // The contract is checked on every answer of the app (a status it does not declare, or a body of the wrong shape) and on every event it publishes.
      let problem = out.endpoint && out.appAnswer ? conforms(answers[out.endpoint], out.appAnswer) : undefined;
      for (const ev of out.events) {
        const t = eventTypes[ev.event];
        const bad = !t ? \`published \${ev.event}, which is not a declared event\` : conforms({ 200: t }, { status: 200, body: ev.body });
        if (bad && !problem) problem = t ? \`published \${ev.event} with a payload that does not fit: \${bad.replace(/^answered 200, but /, "")}\` : bad;
      }
      return problem ? { ...response, contractError: \`\${out.endpoint} \${problem}\` } : response;
    },
  };
}
`;

export function scaffoldApi(app: App, dir: string, layerDirs: Record<string, string> = {}): { appFile: string; specSource: string } {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/api.ts"), join(dir, "api.ts"));
  copyFileSync(join(ROOT, "runtime/ts/http.ts"), join(dir, "http.ts"));
  copyFileSync(join(ROOT, "runtime/ts/clock.ts"), join(dir, "clock.ts"));
  copyFileSync(join(ROOT, "runtime/ts/once.ts"), join(dir, "once.ts"));
  // Each layer's verified module, as built once for that layer spec, and the composition with the bound config.
  for (const l of app.layers ?? []) {
    mkdirSync(join(dir, "layers", l.alias), { recursive: true });
    for (const f of LAYER_FILES) copyFileSync(join(layerDirs[l.alias], f), join(dir, "layers", l.alias, f));
  }
  writeFileSync(
    join(dir, "layers.ts"),
    `// Generated — do not edit. The layers this api runs behind, in order, with their bound params.
import type { HttpRequest, HttpResponse } from "./http.ts";
${(app.layers ?? []).map((l) => `import * as ${l.alias} from "./layers/${l.alias}/layer.ts";`).join("\n")}

export type Layer = { name: string; source: string; before: (req: HttpRequest, config: any) => { pass: Record<string, unknown> } | { answer: HttpResponse }; after: (req: HttpRequest, res: HttpResponse, config: any) => HttpResponse; config: unknown; state?: Record<string, string> };

export const layers: Layer[] = [
${(app.layers ?? []).map((l) => `  { name: ${q(l.alias)}, source: ${q(specLine(app, l.line))}, before: ${l.alias}.before as Layer["before"], after: ${l.alias}.after as Layer["after"], config: ${JSON.stringify(layerConfig(l.spec!, l.bindings.filter((b) => !b.state)))}${l.bindings.some((b) => b.state) ? `, state: ${JSON.stringify(Object.fromEntries(l.bindings.filter((b) => b.state).map((b) => [b.name, dataField(b.state!)])))}` : ""} },`).join("\n")}
];
`,
  );
  writeFileSync(join(dir, "pipeline.ts"), PIPELINE);
  copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
  const spec = genApiSpec(app);
  writeFileSync(join(dir, "spec.ts"), spec);
  // Platform functions: their declared signatures here; the compile step bundles the installation's code.
  if (app.platforms?.length) {
    mkdirSync(join(dir, "platform"), { recursive: true });
    for (const p of app.platforms) writeFileSync(join(dir, "platform", `${p.name}.d.ts`), platformDeclarations(p));
  }
  writeFileSync(join(dir, "server.ts"), SERVER);
  writeFileSync(join(dir, "test-entry.ts"), TEST_ENTRY);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022"], types: ["node"], typeRoots: [join(ROOT, "node_modules/@types")], skipLibCheck: true }, include: ["*.ts", "layers/*/*.ts"] }, null, 2),
  );
  writeFileSync(join(dir, "README.md"), `# ${app.name}\n\nRun: \`node server.mjs\` (PORT, default 3000).\n\n${(app.endpoints ?? []).map((e) => `- ${e.method} ${e.path}`).join("\n")}\n`);
  return { appFile: join(dir, "app.ts"), specSource: spec };
}

export const API_TARGET_RULES = `Target: TypeScript (strict mode), a pure HTTP handler. You write \`app.ts\`.
- The harness already routes requests and validates their input: \`handle\` only receives valid requests (the \`Request\` union in spec.ts). Unknown routes and bad input never reach you.
- Answer with \`answer(status, body)\` or \`fail(status, message)\` from "./api.ts" (\`answer(204)\` for no body). A body is records, lists of records, or plain values, exactly as the endpoint \`returns\`. "answer 404 \\"No such ticket\\"" means \`fail(404, "No such ticket")\`.
- Available: the standard library, "./spec.ts", "./api.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Model is immutable: return a new model from handle. Handle every endpoint in the switch.
- A step "publish ticketCreated with the new ticket" adds \`{ event: "ticketCreated", body: ticket }\` to the handler's \`publish\` list, in step order. Publish only what the steps say; an answer that stops early publishes nothing the steps after it would have.
- The module must export exactly Model, init and handlers (one handler per endpoint, typed by \`Handlers<Model>\` in spec.ts). When an endpoint has a contract, its handler's answers are typed: only the declared statuses and body types compile.`;


/**
 * A typed client for a contract: one function per endpoint, answering the contract's response
 * union. Generated from the same contract as the provider's handlers, so the two cannot drift.
 */
export function genClient(contract: App): string {
  const eps = contract.endpoints ?? [];
  const respType = (e: Endpoint) => (e.answers?.length ? e.answers.map((a) => `{ status: ${a.status}; body: ${a.type ? tsType(a.type) : "null"} }`).join(" | ") : "{ status: number; body: unknown }");
  return `// Generated from contract ${contract.name} — do not edit. A typed client: provider and consumer share this contract.
${tsDomain(contract).replace(/\/\*\* Initial value[\s\S]*?\n\];\n\n/g, "")}
${eps.map((e) => `/** ${e.method} ${e.path} */\nexport type ${cap(e.name)}Response = ${respType(e)};`).join("\n\n")}

export function client(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const call = async (method: string, path: string, query: Record<string, unknown>, body: Record<string, unknown> | undefined) => {
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(String(v))}\`).join("&");
    const res = await fetchFn(baseUrl.replace(/\\/$/, "") + path + (qs ? "?" + qs : ""), { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
${eps
  .map((e) => {
    const params = e.params.map((p) => `${p.name}${p.type.k === "Maybe" ? "?" : ""}: ${tsType(p.type)}`).join("; ");
    const path = e.path.replace(/\{(\w+)\}/g, (_, n) => `\${encodeURIComponent(String(args.${n}))}`);
    const query = e.params.filter((p) => p.in === "query").map((p) => `${p.name}: args.${p.name}`).join(", ");
    const body = e.params.some((p) => p.in === "body") ? `{ ${e.params.filter((p) => p.in === "body").map((p) => `${p.name}: args.${p.name}`).join(", ")} }` : "undefined";
    return `    ${e.name}: (args: { ${params} }${e.params.length ? "" : " = {}"}) => call(${q(e.method)}, \`${path}\`, { ${query} }, ${body}) as Promise<${cap(e.name)}Response>,`;
  })
  .join("\n")}
  };
}
`;
}

// ---------------------------------------------------------------- generated interface

export function genLayerSpec(app: App): string {
  const params = app.params ?? [];
  const provides = app.provides ?? [];
  if (app.beforeCall)
    return `// Generated from layer ${app.name} — do not edit. The interface the layer module must satisfy.
import type { HttpRequest } from "./http.ts";
export type { HttpRequest } from "./http.ts";

${tsDomain(app)}/** The params, as a screen binds them (to its state, or literals; defaults filled in). */
export type Config = { ${params.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };
`;
  return `// Generated from layer ${app.name} — do not edit. The interface the layer module must satisfy.
import type { HttpRequest, HttpResponse } from "./http.ts";
export type { HttpRequest, HttpResponse } from "./http.ts";

${tsDomain(app)}/** The params, as an app binds them (defaults filled in). */
export type Config = { ${params.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };

/** What this layer hands to the app's endpoints when a request passes. */
export type Provided = { ${provides.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };

/** \`before\` either answers (the app is not reached, and no later layer runs) or passes the request on. */
export type Before = { pass: Provided } | { answer: HttpResponse };
`;
}

export const LAYER_SKELETON = `import type { Before, Config, HttpRequest, HttpResponse } from "./spec.ts";
import { … } from "./http.ts"; // what you use of: header, refuse, respond, sameSecret, withHeaders

/** Runs first, for every request. */
export function before(req: HttpRequest, config: Config): Before { /* … */ }

/** Runs last, for every answer: the app's, the harness's (404, 400, 405) and any layer's. */
export function after(req: HttpRequest, res: HttpResponse, config: Config): HttpResponse { /* … */ }
`;

/** A client's layer: one function over every call as it leaves the screen (and the event stream's request). */
export const CLIENT_LAYER_SKELETON = `import type { Config, HttpRequest } from "./spec.ts";
import { … } from "./http.ts"; // what you use of: header, lower

/** Runs for every call a screen makes through this layer, and for its event stream: returns the call as it leaves. */
export function before(req: HttpRequest, config: Config): HttpRequest { /* … */ }
`;

export const CLIENT_LAYER_RULES = `Target: TypeScript (strict mode), a layer around a client's calls. You write \`layer.ts\`.
- Export exactly \`before(req, config)\`, which returns the call as it leaves: the same method, path, query and body unless the spec says otherwise, with the headers the spec says. Header names are lower case.
- It runs in the browser and in tests, for every call and for the event stream (\`GET /events\`). Config values come from the screen's state and change over time: never cache them.
- Available: the standard library, "./spec.ts", "./http.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Pure function: never mutate the request you receive; return a new object.
- Every example must pass. Walk through each one step by step before you answer. Write plain code, no comments.`;

export const LAYER_RULES = `Target: TypeScript (strict mode), a layer around an HTTP API. You write \`layer.ts\`.
- Export exactly \`before\` and \`after\` with the signatures below. Without \`before every request\`, \`before\` passes every request on: \`{ pass: {} }\` (plus what the layer provides). Without \`after every answer\`, \`after\` returns the answer unchanged.
- Requests and answers are plain data. Header names are lower case; read request headers with \`header(req, name)\`. Build answers with \`respond(status, body, headers)\` (body \`null\` for none) or \`refuse(status, message, headers)\` (a Problem), and add headers with \`withHeaders(res, {…})\`. Never drop headers or change the status or body of an answer unless the spec says so.
- Secrets (keys, tokens, passwords) are compared only with \`sameSecret(a, b)\`, never with ===.
- Available: the standard library, "./spec.ts", "./http.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Pure functions: never mutate the request or the answer you receive; return new objects.
- Every example must pass. Walk through each one step by step before you answer. Write plain code, no comments.`;

const LAYER_TEST_ENTRY = `import * as L from "./layer.ts";
import { normalize, type HttpRequest, type HttpResponse } from "./http.ts";

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

/** The layer around a stub app that answers 200 { reached: true, …what the layer provided }. */
export function start(config: any) {
  return {
    send(req: HttpRequest): HttpResponse {
      const b = L.before(copy(req), copy(config));
      const res: HttpResponse = "answer" in b ? normalize(b.answer) : { status: 200, headers: {}, body: { reached: true, ...copy(b.pass) } };
      return normalize(L.after(copy(req), copy(res), copy(config)));
    },
  };
}
`;

/** A client's layer in its examples: \`request …\` is a call the screen makes; what is seen is the call as it leaves. */
const CLIENT_TEST_ENTRY = `import * as L from "./layer.ts";
import { lower, type HttpRequest, type HttpResponse } from "./http.ts";

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

export function start(config: any) {
  return {
    send(req: HttpRequest): HttpResponse {
      const out = L.before(copy(req), copy(config));
      return { status: 200, headers: lower(out.headers ?? {}), body: copy({ method: out.method, path: out.path, query: out.query ?? {}, body: out.body ?? null }) };
    },
  };
}
`;

export function scaffoldLayer(app: App, dir: string): { appFile: string; specSource: string } {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/http.ts"), join(dir, "http.ts"));
  copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
  const spec = genLayerSpec(app);
  writeFileSync(join(dir, "spec.ts"), spec);
  writeFileSync(join(dir, "test-entry.ts"), app.beforeCall ? CLIENT_TEST_ENTRY : LAYER_TEST_ENTRY);
  writeFileSync(join(dir, "config.json"), JSON.stringify(layerConfig(app, app.exampleConfig ?? []), null, 2));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022", "dom"], skipLibCheck: true }, include: ["*.ts"] }, null, 2),
  );
  return { appFile: join(dir, "layer.ts"), specSource: spec };
}



// ---------------------------------------------------------------- prompts and toolchain

export const API_CODING_RULES = `Rules that keep every build identical:
1. Model mirrors the spec's \`state\`: same names, same meaning. Add only what you truly need.
2. Each endpoint: implement its steps in order, literally. "answer 404 \\"…\\" and stop" returns \`fail(404, "…")\` at once, leaving the model unchanged. "answer 201 with X" returns \`answer(201, X)\`.
3. Bodies are exactly the declared \`returns\` type: records with their declared fields, lists in the order the steps say.
4. Where the spec is silent, apply the defaults in §9 of the language reference. Never add behaviour the spec does not ask for.
5. Every example in the spec must pass. Walk through each one step by step before you answer.
6. All rounding goes through Fmt. For every refined type the interface has a check (\`isEmail\`); "is a valid Email" means that check. Write plain, straightforward code. No comments needed.`;

/** Apis that read the clock or run recurring work. */
export const API_CLOCK_RULE = `This api reads the clock: every request carries \`now\` (@now, a DateTime) and \`today\` (@today, a Date); never read the time any other way.
Each \`every <interval> { … }\` block is recurring work: export \`jobs\` typed \`Jobs<Model>\` from spec.ts, one function per block (\`every15m\` for \`every 15m\`), taking the model and the clock at its time and returning \`{ model, publish }\`. The module then exports Model, init, handlers and jobs.`;

/** api profile: type-check, then bundle the test client and the server. */
async function compileApi(dir: string): Promise<string> {
  // Platform functions: the installation's reviewed implementation, bundled next to its declaration.
  const platformDir = join(dir, "platform");
  for (const d of existsSync(platformDir) ? readdirSync(platformDir).filter((f) => f.endsWith(".d.ts")) : []) {
    const name = d.slice(0, -".d.ts".length);
    const b = await run(bin("esbuild"), [join(ROOT, "runtime/ts/platform", `${name}.ts`), "--bundle", "--format=esm", "--platform=node", `--outfile=${join(platformDir, `${name}.js`)}`, `--define:INTENT_UI_PROFILE=${JSON.stringify(readFileSync(join(ROOT, "lib/profile/ui.intent"), "utf8"))}`, "--log-level=error"], dir);
    if (!b.ok) return clean(b.out);
  }
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  for (const [entry, out] of [["test-entry.ts", "test.mjs"], ["server.ts", "server.mjs"]]) {
    const b = await run(bin("esbuild"), [entry, "--bundle", "--format=esm", "--platform=node", `--outfile=${out}`, "--log-level=error"], dir);
    if (!b.ok) return clean(b.out);
  }
  return "";
}

/** A layer: type-check, then bundle its test entry (the layer around a stub app). */
async function compileLayer(dir: string): Promise<string> {
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  const b = await run(bin("esbuild"), ["test-entry.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=test.mjs", "--log-level=error"], dir);
  return b.ok ? "" : clean(b.out);
}

/** A platform's functions as TypeScript declarations (the implementation is the installation's). */
function platformDeclarations(p: NonNullable<App["platforms"]>[number]): string {
  return `// Generated from platform ${p.name} — do not edit. Implemented by the Intent installation (runtime/ts/platform/${p.name}.ts).
${p.records.map((r) => `export type ${r.name} = { ${r.fields.map((f) => `${f.name}: ${tsType(f.type)}`).join("; ")} };\n`).join("")}
${p.functions.map((f) => `/**${f.note ? ` ${f.note}` : ""} */\nexport declare function ${f.name}(${f.params.map((x) => `${x.name}: ${tsType(x.type)}`).join(", ")}): ${tsType(f.returns)};\n`).join("\n")}`;
}

// ---------------------------------------------------------------- the service module

export const tsService: ServiceModule = {
  scaffoldApi,
  compileApi,
  scaffoldLayer,
  compileLayer,
  layerFiles: LAYER_FILES,
  prompt: { rules: API_TARGET_RULES, skeleton: API_APP_SKELETON, coding: API_CODING_RULES, clock: API_CLOCK_RULE, platform: "This api imports platform functions (their names are in spec.ts, from `./platform/…`): a sentence that names one (`the @sha256 of the given @source`) calls exactly that function, imported from `./spec.ts`. They are the installation's reviewed code: never write your own version of what they do." },
  layerPrompt: { rules: LAYER_RULES, skeleton: LAYER_SKELETON, clientRules: CLIENT_LAYER_RULES, clientSkeleton: CLIENT_LAYER_SKELETON },
};
