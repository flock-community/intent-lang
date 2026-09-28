// The manifest (`manifest.json` in a build, compiler/calls.ts manifest): what an app may use of each
// api, which a host grants. With `uses … only …` it is the list the spec declares (declared: true);
// without it, what the app's handlers use (declared: false). Endpoints and events apart, sorted.
import assert from "node:assert/strict";
import { load } from "../compiler/load.ts";
import { manifest } from "../compiler/calls.ts";

const of = (file: string) => {
  const { app, diagnostics } = load(new URL(`../${file}`, import.meta.url).pathname, { ignoreLock: true });
  assert.ok(app, `${file} loads: ${diagnostics.filter((d) => d.level === "error").map((d) => d.message).join("; ")}`);
  return manifest(app!);
};

assert.deepEqual(
  of("apps/28-alerts.intent"),
  { alerts: { contract: "notify.alertsApi", declared: true, endpoints: ["listAlerts", "raise"], events: ["alertRaised"] } },
  "a screen with `only raise, listAlerts, alertRaised`",
);
assert.deepEqual(
  of("apps/30-urgent-watch.intent"),
  { alerts: { contract: "notify.alertsApi", declared: true, endpoints: ["raise"], events: ["alertRaised"] } },
  "a job with `only raise, alertRaised`: listAlerts, which the contract also has, is not granted",
);
assert.deepEqual(
  of("apps/20-approval.intent"),
  { pay: { contract: "pay.paymentsApi", declared: false, endpoints: ["charge"], events: [] } },
  "without `only`: what the handlers use (charge), not the whole contract",
);

console.log("ok manifest: `only` lists as declared (28-alerts, 30-urgent-watch), and what is used without one");
