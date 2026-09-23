// Visual sameness of styled builds: pixel difference between screenshots of the same state,
// and layout agreement of the elements' boxes. Plus contact sheets for a human eye.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { Rects } from "./browser.ts";

function load(file: string): PNG {
  return PNG.sync.read(readFileSync(file));
}

/** Share of pixels that differ; images of different size are compared on the larger canvas (the overhang counts as different). */
export function pixelDiff(a: PNG, b: PNG): number {
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const pad = (img: PNG) => {
    if (img.width === w && img.height === h) return img.data;
    const out = new PNG({ width: w, height: h });
    out.data.fill(0); // transparent black: differs from any page pixel
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out.data;
  };
  const diff = pixelmatch(pad(a), pad(b), undefined, w, h, { threshold: 0.1 });
  return diff / (w * h);
}

/** Boxes of the same elements: share within 8px on every edge, and the median deviation. */
export function layoutAgreement(a: Rects, b: Rects): { within8: number; median: number; common: number; missing: number } {
  const keys = Object.keys(a).filter((k) => k in b && !k.startsWith("__"));
  const missing = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !k.startsWith("__"))).size - keys.length;
  const devs = keys.map((k) => Math.max(...a[k].map((v, i) => Math.abs(v - b[k][i]))));
  devs.sort((x, y) => x - y);
  return { within8: keys.length ? devs.filter((d) => d <= 8).length / keys.length : 0, median: devs.length ? devs[Math.floor(devs.length / 2)] : 0, common: keys.length, missing };
}

/**
 * Local layout: each element's position relative to its nearest element-ancestor, plus its size.
 * One taller header then counts as one difference, not as a shift of everything below it.
 */
export function localAgreement(a: Rects, b: Rects): number {
  const pa = ((a as any).__parents ?? {}) as Record<string, string>;
  const pb = ((b as any).__parents ?? {}) as Record<string, string>;
  const keys = Object.keys(a).filter((k) => k in b && !k.startsWith("__"));
  if (!keys.length) return 0;
  const rel = (r: Rects, p: Record<string, string>, k: string) => {
    const box = r[k];
    const parent = p[k] && r[p[k]] ? r[p[k]] : [0, 0, 0, 0];
    return [box[0] - parent[0], box[1] - parent[1], box[2], box[3]];
  };
  const same = keys.filter((k) => {
    // Compare relative to the parent only when both builds nest the element under the same parent.
    const ra = pa[k] === pb[k] ? rel(a, pa, k) : a[k];
    const rb = pa[k] === pb[k] ? rel(b, pb, k) : b[k];
    return ra.every((v, i) => Math.abs(v - rb[i]) <= 8);
  });
  return same.length / keys.length;
}

export interface VisualReport {
  states: string[];
  pairs: { a: string; b: string; pixelDiff: number; within8: number; median: number; local: number }[];
  byGroup: Record<string, { pixelDiff: number; within8: number; median: number; local: number }>; // elm, ts, cross
}

export function compareVisuals(builds: { id: string; dir: string }[]): VisualReport {
  const withShots = builds.filter((b) => existsSync(join(b.dir, "shots/initial.png")));
  const states = withShots.length ? readdirSync(join(withShots[0].dir, "shots")).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort() : [];
  const pairs: VisualReport["pairs"] = [];
  for (let i = 0; i < withShots.length; i++)
    for (let j = i + 1; j < withShots.length; j++) {
      let px = 0, w8 = 0, med = 0, loc = 0, n = 0;
      for (const st of states) {
        const fa = join(withShots[i].dir, "shots", st), fb = join(withShots[j].dir, "shots", st);
        if (!existsSync(fa + ".png") || !existsSync(fb + ".png")) continue;
        px += pixelDiff(load(fa + ".png"), load(fb + ".png"));
        const la = layoutAgreement(JSON.parse(readFileSync(fa + ".json", "utf8")), JSON.parse(readFileSync(fb + ".json", "utf8")));
        w8 += la.within8;
        med += la.median;
        loc += localAgreement(JSON.parse(readFileSync(fa + ".json", "utf8")), JSON.parse(readFileSync(fb + ".json", "utf8")));
        n++;
      }
      if (n) pairs.push({ a: withShots[i].id, b: withShots[j].id, pixelDiff: px / n, within8: w8 / n, median: med / n, local: loc / n });
    }
  const group = (p: (x: { a: string; b: string }) => boolean) => {
    const xs = pairs.filter(p);
    const avg = (f: (x: (typeof pairs)[0]) => number) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : NaN);
    return { pixelDiff: avg((x) => x.pixelDiff), within8: avg((x) => x.within8), median: avg((x) => x.median), local: avg((x) => x.local) };
  };
  const t = (id: string) => id.split("-")[0];
  return {
    states,
    pairs,
    byGroup: { elm: group((x) => t(x.a) === "elm" && t(x.b) === "elm"), ts: group((x) => t(x.a) === "ts" && t(x.b) === "ts"), cross: group((x) => t(x.a) !== t(x.b)) },
  };
}

/** One image with the same state of every build side by side, scaled down. */
export function contactSheet(builds: { id: string; dir: string }[], state: string, out: string, scale = 0.35) {
  const imgs = builds.filter((b) => existsSync(join(b.dir, "shots", state + ".png"))).map((b) => load(join(b.dir, "shots", state + ".png")));
  if (!imgs.length) return;
  const cols = Math.min(5, imgs.length);
  const cw = Math.ceil(Math.max(...imgs.map((i) => i.width)) * scale) + 8;
  const ch = Math.ceil(Math.max(...imgs.map((i) => i.height)) * scale) + 8;
  const rows = Math.ceil(imgs.length / cols);
  const sheet = new PNG({ width: cols * cw, height: rows * ch });
  sheet.data.fill(255);
  imgs.forEach((img, n) => {
    const ox = (n % cols) * cw + 4, oy = Math.floor(n / cols) * ch + 4;
    const w = Math.floor(img.width * scale), h = Math.floor(img.height * scale);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // box filter: average the source pixels that map to this one
        let r = 0, g = 0, b = 0, c = 0;
        for (let sy = Math.floor(y / scale); sy < Math.min(img.height, Math.floor((y + 1) / scale)); sy++)
          for (let sx = Math.floor(x / scale); sx < Math.min(img.width, Math.floor((x + 1) / scale)); sx++) {
            const i = (sy * img.width + sx) * 4;
            r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; c++;
          }
        const o = ((oy + y) * sheet.width + ox + x) * 4;
        sheet.data[o] = r / c; sheet.data[o + 1] = g / c; sheet.data[o + 2] = b / c; sheet.data[o + 3] = 255;
      }
  });
  writeFileSync(out, PNG.sync.write(sheet));
}
