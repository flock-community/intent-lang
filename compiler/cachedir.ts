// Shared build directories (.intent/cache, .intent/providers, .intent/layers, .intent/invariants) and
// the processes that race for them: two `intent build`s, a build next to a converge run. Each key has
// a lock (a file made with O_EXCL, so exactly one process holds it; a lock whose process is gone is
// taken over), and a directory appears only whole: it is made next to its place and renamed into it
// (a rename in one file system is atomic), so no process ever reads a half-written build, and a crash
// leaves no half-written one behind.
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Is the process that holds a lock still there (on this host)? */
function holderAlive(lock: string): boolean {
  try {
    const [pid, host] = readFileSync(lock, "utf8").split(" ");
    if (host !== hostname()) return true; // another machine's process: wait for it
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // alive, not ours to signal
  }
}

/** Hold the lock of a directory (`<dir>.lock`) while `fn` runs. Waits for another holder; takes over a lock whose process is gone. */
export async function withLock<T>(dir: string, fn: () => Promise<T> | T, waitMs = 2 * 60 * 60 * 1000): Promise<T> {
  const lock = `${dir}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const until = Date.now() + waitMs;
  for (let delay = 20; ; delay = Math.min(delay * 2, 1000)) {
    try {
      const fd = openSync(lock, "wx");
      writeSync(fd, `${process.pid} ${hostname()}`);
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (!holderAlive(lock)) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > until) throw new Error(`${lock} is held by another process for too long`);
      await sleep(delay);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** A fresh directory next to `dir` to make its new contents in (same file system: the rename is atomic). */
export function stagingFor(dir: string): string {
  mkdirSync(dirname(dir), { recursive: true });
  const tmp = `${dir}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  return tmp;
}

/** Put a directory made in `staged` in place of `dir`, whole: the old one (if any) is moved aside first and removed after. */
export function publish(staged: string, dir: string) {
  const old = existsSync(dir) ? `${dir}.old-${process.pid}-${Math.random().toString(36).slice(2)}` : undefined;
  if (old) renameSync(dir, old);
  renameSync(staged, dir);
  if (old) rmSync(old, { recursive: true, force: true });
}

/** Copy `from` into `dir` as a whole directory (with `extra` files written into it first). Call it under `withLock(dir)`. */
export function putDir(from: string, dir: string, extra: Record<string, string> = {}) {
  const staged = stagingFor(dir);
  try {
    cpSync(from, staged, { recursive: true });
    for (const [f, text] of Object.entries(extra)) {
      mkdirSync(dirname(join(staged, f)), { recursive: true });
      const fd = openSync(join(staged, f), "w");
      writeSync(fd, text);
      closeSync(fd);
    }
    publish(staged, dir);
  } catch (e) {
    rmSync(staged, { recursive: true, force: true });
    throw e;
  }
}
