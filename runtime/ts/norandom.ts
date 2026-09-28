// Tests only (the first import of a build's test entry, so it runs before the app module): every
// random value in a test comes from the harness (the Draws of the generated interface, steerable and
// the same in twin builds). Randomness the app module makes itself, in whatever spelling a static
// reading missed (compiler/draws.ts `ownRandomness`), throws here instead of passing by luck.
const refuse = (what: string) => () => {
  throw new Error(`${what}: an app does not make its own randomness; use the Draws of the generated interface`);
};
Math.random = refuse("Math.random");
const real = (globalThis as { crypto?: Crypto }).crypto;
if (real) {
  const guarded = new Proxy(real, {
    get(target, key) {
      if (key === "getRandomValues" || key === "randomUUID") return refuse(`crypto.${String(key)}`);
      if (key === "subtle") return new Proxy({}, { get: (_, k) => refuse(`crypto.subtle.${String(k)}`) });
      const v = Reflect.get(target, key, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  Object.defineProperty(globalThis, "crypto", { value: guarded, configurable: true, writable: true });
}
export {};
