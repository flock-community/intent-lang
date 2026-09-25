// Every platform's examples, run against its implementation (runtime/ts/platform/<name>.ts): the
// platform file is the contract, the installation's code must keep it.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "../compiler/parse.ts";
import { readFileSync } from "node:fs";
import { literalJson } from "../compiler/api.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const files: string[] = [];
const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith(".intent") && files.push(join(d, f))));
walk(join(ROOT, "lib"));
let failures = 0;
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/^platform\s/m.test(text)) continue;
  const { app, diagnostics } = parse(text);
  if (!app) {
    console.log(`${file}: does not check: ${diagnostics.filter((d) => d.level === "error").map((d) => `${d.line}: ${d.message}`).join("; ")}`);
    failures++;
    continue;
  }
  const impl = join(ROOT, "runtime/ts/platform", `${app.name}.ts`);
  if (!existsSync(impl)) {
    console.log(`${app.name}: no implementation at runtime/ts/platform/${app.name}.ts`);
    failures++;
    continue;
  }
  const mod = await import(pathToFileURL(impl).href);
  for (const f of app.functions ?? []) if (typeof mod[f.name] !== "function") (failures++, console.log(`${app.name}: the implementation has no function ${f.name}`));
  for (const ex of app.examples) {
    const last: Record<string, unknown> = {};
    for (const s of ex.steps) {
      if (s.do === "call") {
        const f = app.functions!.find((x) => x.name === s.endpoint)!;
        last[f.name] = mod[f.name](...f.params.map((p) => literalJson(s.args.find((a) => a.name === p.name)?.value ?? { k: "nothing" })));
      } else if (s.do === "see") {
        const [fn, ...path] = s.target.split(".");
        let v: any = last[fn];
        for (const k of path) v = v?.[k];
        const c = s.check;
        const ok = c.is === "eq" ? String(v) === c.value : c.is === "rows" ? Array.isArray(v) && v.length === c.count : false;
        checked++;
        if (!ok) (failures++, console.log(`${app.name} "${ex.name}" line ${s.line}: expected ${s.target} ${c.is === "rows" ? `to have ${c.count} rows` : `= ${JSON.stringify((c as { value: string }).value)}`}, got ${JSON.stringify(v)?.slice(0, 200)}`));
      }
    }
  }
}
if (failures) process.exit(1);
console.log(`ok platforms: ${checked} checks`);
