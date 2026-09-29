// The generated server (server.mjs), run for real around a stand-in app module: an open event stream
// passes the layers again before every event, so a key revoked after it opened closes it (with an
// access block and without one); a request body over the limit is answered 413. No LLM.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { scaffoldApi } from "../compiler/api.ts";
import { scaffoldLayer } from "../compiler/layer.ts";
import { targetModule } from "../compiler/targets/index.ts";

const SPEC = (access: boolean) => `app Pings {
  "Key holders hear pings; a key can be revoked."
}
language 1

profile api

layer auth = std.http.apiKey {
  keys = apiKeys
}

record Ping {
  n: Int
}

event pinged: Ping

state {
  stored apiKeys: List ApiKey = table {
    secret    | owner
    "k-ann-1" | "Ann"
    "k-bob-2" | "Bob"
  }
}
${access ? "\naccess {\n  - any caller may call @ping and @revoke\n  - any caller may hear every event\n}\n" : ""}
endpoint ping POST "/ping" {
  returns Ping
  - publish @pinged with a @Ping with @n = 1
  answer 200 with a @Ping with @n = 1
}

endpoint revoke POST "/revoke" {
  body owner: Text
  returns Ping
  - remove from @apiKeys every api key whose @owner is @owner
  answer 200 with a @Ping with @n = 0
}

example "a ping" {
  call ping as "Ann"
  see ping.status = 200
  see pinged.body.n = 1
  call revoke as "Ann" with owner = "Bob"
  see revoke.status = 200
}
`;

const KEY_LAYER = `import type { Before, Config, HttpRequest, HttpResponse } from "./spec.ts";
import { header, refuse, sameSecret } from "./http.ts";
export function before(req: HttpRequest, config: Config): Before {
  if (req.method === "OPTIONS") return { pass: { caller: "" } };
  const v = header(req, config.keyHeader);
  if (v === undefined || v.trim() === "") return { answer: refuse(401, "Missing API key", { "www-authenticate": "ApiKey" }) };
  const k = config.keys.find((x) => sameSecret(v, x.secret));
  return k ? { pass: { caller: k.owner } } : { answer: refuse(401, "Unknown API key", { "www-authenticate": "ApiKey" }) };
}
export function after(req: HttpRequest, res: HttpResponse): HttpResponse {
  return res;
}
`;

const APP = (access: boolean) => `import type { ApiKey, Handlers${access ? ", Data" : ""}, Stored } from "./spec.ts";
import { apiKeysInitial } from "./spec.ts";
import { answer } from "./api.ts";
export type Model = { apiKeys: ApiKey[] };
export function init(): Model {
  return { apiKeys: apiKeysInitial };
}
export const data = (m: Model)${access ? ": Data" : ""} => ({ apiKeys: m.apiKeys });
export const restore = (saved: Stored, m: Model): Model => ({ ...m, apiKeys: saved.apiKeys });
export const handlers: Handlers<Model> = {
  ping: (req, model) => ({ model, response: answer(200, { n: 1 }), publish: [{ event: "pinged", body: { n: 1 } }] }),
  revoke: (req, model) => ({ model: { ...model, apiKeys: model.apiKeys.filter((k) => k.owner !== req.owner) }, response: answer(200, { n: 0 }) }),
};
`;

const root = mkdtempSync(join(tmpdir(), "server-"));
const children: ReturnType<typeof spawn>[] = [];
try {
  let port = 43100 + Math.floor(Math.random() * 500);
  for (const access of [true, false]) {
    const dir = join(root, access ? "access" : "plain");
    mkdirSync(dir, { recursive: true });
    // Without an access block a spec behind keys is a NO_ACCESS error in language 1, so the harness's
    // path without one is tested on the checked spec with its block taken out after the check.
    writeFileSync(join(dir, "Pings.intent"), SPEC(true));
    const loaded = load(join(dir, "Pings.intent"), { ignoreLock: true });
    assert.deepEqual(loaded.diagnostics.filter((d) => d.level === "error").map((d) => `${d.line} ${d.code} ${d.message}`), []);
    const app = loaded.app!;
    if (!access) delete app.access;
    const layerDir = join(dir, "layer-auth");
    scaffoldLayer(app.layers![0].spec!, layerDir);
    writeFileSync(join(layerDir, "layer.ts"), KEY_LAYER);
    const build = join(dir, "build");
    scaffoldApi(app, build, { auth: layerDir });
    writeFileSync(join(build, "app.ts"), APP(access));
    const problems = await targetModule("ts").service!.compileApi(build);
    assert.equal(problems, "", `the stand-in compiles: ${problems}`);

    const p = ++port;
    const server = spawn(process.execPath, ["server.mjs"], { cwd: build, env: { ...process.env, PORT: String(p), INTENT_DATA: join(build, "data.json"), INTENT_AUDIT: join(build, "audit.jsonl"), INTENT_MAX_BODY: "2000" }, stdio: ["ignore", "pipe", "pipe"] });
    children.push(server);
    await new Promise<void>((resolve, reject) => {
      server.stdout!.on("data", (d) => String(d).includes("listening") && resolve());
      server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    const base = `http://127.0.0.1:${p}`;
    const post = (path: string, key: string, body: unknown = {}) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-api-key": key }, body: JSON.stringify(body) });

    // Bob opens a stream and hears a ping.
    const stream = await fetch(base + "/events", { headers: { "x-api-key": "k-bob-2" } });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    const text = new TextDecoder();
    let got = "";
    const readFor = async (ms: number) => {
      const until = Date.now() + ms;
      for (;;) {
        const left = until - Date.now();
        if (left <= 0) return "open";
        const r = await Promise.race([reader.read(), new Promise<"wait">((res) => setTimeout(() => res("wait"), left))]);
        if (r === "wait") return "open";
        if (r.done) return "closed";
        got += text.decode(r.value);
      }
    };
    assert.equal((await post("/ping", "k-ann-1")).status, 200);
    await readFor(300);
    assert.ok(got.includes('"event":"pinged"'), `Bob hears the ping (${access ? "access" : "no access block"}): ${JSON.stringify(got)}`);
    // Bob's key is revoked; the next event closes his stream instead of reaching it.
    got = "";
    assert.equal((await post("/revoke", "k-ann-1", { owner: "Bob" })).status, 200);
    assert.equal((await post("/ping", "k-ann-1")).status, 200);
    assert.equal(await readFor(1000), "closed", `a revoked key's stream is closed (${access ? "access" : "no access block"})`);
    assert.ok(!got.includes('"event":"pinged"'), "and hears nothing after the revocation");

    // A body over the limit: 413, not read on.
    const big = await post("/ping", "k-ann-1", { pad: "x".repeat(5000) }).catch((e) => e as Error);
    assert.ok(!(big instanceof Error) && big.status === 413, `a body over the limit is refused: ${big instanceof Error ? big.message : big.status}`);
    server.kill();
  }
} finally {
  for (const c of children) c.kill();
  rmSync(root, { recursive: true, force: true });
}

console.log("ok server: a stream passes the layers before every event (a revoked key's stream closes, with and without an access block); a body over the limit is 413");
