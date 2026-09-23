// Fmt must behave identically in Elm and TypeScript; otherwise cross-target comparison is meaningless.
import { createRequire } from "node:module";
import * as Fmt from "../../runtime/ts/fmt.ts";
const floats = [0, 1.005, 2.675, -1.005, 1.875, 0.125, -0.001, 36.666666, 1e9 + 0.5, 14.38, 115, 0.1 + 0.2, -2.5, 2.5, 1234567.891];
const texts = ["", " ", "12", " 12,50 ", "12.5", "-3", "-", ".5", "5.", "1,2,3", "1.2.3", "abc", "0012", "-0", "1e5", "+4", "3,75", "  -12.25 "];
const ts = {
  fixed2: floats.map((x) => Fmt.fixed(2, x)),
  fixed0: floats.map((x) => Fmt.fixed(0, x)),
  fixed3: floats.map((x) => Fmt.fixed(3, x)),
  clock: [0, 59, 60, 1500, 3599, 3600, 3661, -5, 86399].map(Fmt.clock),
  parseDecimal: texts.map(Fmt.parseDecimal),
  parseInt: texts.map(Fmt.parseInt),
  roundTo: floats.map((x) => Fmt.roundTo(2, x)),
  roundUpTo: floats.map((x) => Fmt.roundUpTo(2, x)),
  roundDownTo: floats.map((x) => Fmt.roundDownTo(2, x)),
  cents: floats.map(Fmt.cents),
  decimal: [...floats, 1 / 3, -0.5, 100, 1e-9, -1e-9, 20].map((x) => Fmt.decimal(8, x)),
  int: [0, -3, 1200].map(Fmt.int),
};
const { Elm } = createRequire(import.meta.url)("./probe.cjs");
const app = Elm.Probe.init();
app.ports.out.subscribe((elm: any) => {
  let bad = 0;
  for (const k of Object.keys(ts) as (keyof typeof ts)[]) {
    const a = JSON.stringify(ts[k]);
    const b = JSON.stringify(elm[k]);
    if (a !== b) {
      bad++;
      console.log(`MISMATCH ${k}\n  ts:  ${a}\n  elm: ${b}`);
    } else console.log(`ok ${k}: ${a}`);
  }
  process.exit(bad ? 1 : 0);
});
