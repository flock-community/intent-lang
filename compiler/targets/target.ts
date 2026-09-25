// A target is a language the compiler writes apps in. Each is a module (targets/elm.ts,
// targets/ts.ts) behind this interface: it writes the generated interface and the entries,
// tells the LLM what it needs to know about the language, compiles, and opens a test session.
// Everything else (the checker, the examples, the random sessions, twin builds) is the same for
// every target: a target changes how an app is made, never what counts as correct.
import type { App } from "../ast.ts";
import type { CallOut } from "../../runtime/ts/calls.ts";

/** A running build under test: observations (the Ui node tree as JSON) out, wire events in. */
export interface Session {
  observe(): Promise<any>;
  send(w: object): Promise<void>;
  calls?(): Promise<CallOut[]>;
  through?(): Promise<Record<string, Record<string, unknown>>>;
  data?(): Promise<unknown>;
  clock?(): Promise<{ now: string; today: string }>;
  /** Several screens: the address the app asked for since last asked (`go to`), "back", or null. */
  nav?(): Promise<string | null>;
}

export interface TargetModule {
  name: "elm" | "ts";
  /** The file the LLM writes, the generated interface it reads, and the fence for code blocks. */
  appFile: string;
  specFile: string;
  fence: string;
  /** Write a build directory: runtime, generated interface, entries. */
  scaffold(app: App, dir: string, layerDirs?: Record<string, string>): { appFile: string; specSource: string };
  /** Compile what the LLM wrote: "" when it compiled, else the errors. */
  compile(dir: string): Promise<string>;
  /** Styled builds: the browser bundle with the LLM-written look (Tailwind runs after). */
  compileStyled(dir: string): Promise<string>;
  /** What the prompt says about this language. */
  prompt: {
    rules: string; // the target and what the module must export
    fmt: string; // the standard helpers' signatures
    skeleton(calls: boolean, through: boolean): string;
    calls: string; // apps that call apis
    through: string; // apis with a client layer
    clock: string; // apps that read the clock
    data: string; // apps with sentences in `always`
    stored: string; // apps with stored state
    screens?: string; // apps with several screens (a target without it cannot build them yet)
  };
  /** A test session on a compiled build, with the clock the driver starts it at. */
  open(dir: string, clock?: { now: string; today: string }): Promise<Session>;
  /** Services (the api profile, layers), for a target that can build them. */
  service?: ServiceModule;
}

/** A target's services: an api (typed handlers behind a fixed router and server) and layers. */
export interface ServiceModule {
  scaffoldApi(app: App, dir: string, layerDirs?: Record<string, string>): { appFile: string; specSource: string };
  compileApi(dir: string): Promise<string>;
  scaffoldLayer(app: App, dir: string): { appFile: string; specSource: string };
  compileLayer(dir: string): Promise<string>;
  /** The files an api build copies from a verified layer build. */
  layerFiles: string[];
  prompt: { rules: string; skeleton: string; coding: string; clock: string };
  layerPrompt: { rules: string; skeleton: string; clientRules: string; clientSkeleton: string };
}
