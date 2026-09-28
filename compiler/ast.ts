// IR for an .intent file. Produced by parse.ts, consumed by the generators and the test driver.

export type Type =
  | { k: "Text" }
  | { k: "Int" }
  | { k: "Decimal" }
  | { k: "Bool" }
  | { k: "Date" } // a day: "2026-09-24"
  | { k: "DateTime" } // a moment, to the minute: "2026-09-24T09:00"
  | { k: "List"; of: Type }
  | { k: "Maybe"; of: Type }
  | { k: "Named"; name: string }
  // `ticket: ref Ticket`: a field that holds another record's key. `key` is the referenced
  // record's key field's type, filled in by the checker; storage and reads use it. `in`: the
  // state list the key is looked up in when the reference is followed (`ref Ticket in tickets`);
  // without it, the record's one home list (compiler/fit.ts `homeOf`).
  | { k: "Ref"; name: string; key?: Type; in?: string };

export type Literal =
  | { k: "text"; v: string }
  | { k: "number"; v: number; raw: string }
  | { k: "bool"; v: boolean }
  | { k: "emptyList" }
  | { k: "nothing" }
  | { k: "value"; v: string } // a choice value
  | { k: "date"; v: string } // 2026-09-24
  | { k: "dateTime"; v: string } // 2026-09-24 09:00, kept as "2026-09-24T09:00"
  | { k: "table"; columns: string[]; rows: Literal[][] } // seed data for List Record
  // \`call\` arguments in examples (\`needs = [{ bundle = "std.list", minimum = "1.0" }]\`), and a
  // table cell that holds a row's inner list (\`[{ id = 1, label = "Milk" }]\`).
  | { k: "list"; items: Literal[] }
  | { k: "record"; fields: { name: string; value: Literal }[] };

export interface Field {
  name: string;
  type: Type;
  default?: Literal;
  line: number;
  note?: string;
  stored?: boolean; // `stored name: T = …` in `state`: survives a restart
}

/** `type Email = Text matching /re/`, `type Age = Int from 0 to 150`: a base type with a rule. */
export interface RefinedDecl {
  name: string;
  base: "Text" | "Int" | "Decimal";
  pattern?: string; // Text: the whole text must match
  min?: number;
  max?: number;
  minLength?: number; // Text `of length a to b`: characters (code points), not bytes
  maxLength?: number;
  // `Text of 6 digits`: a code of exactly n characters from a closed alphabet (compiler/alphabets.ts),
  // or `from "…"` (the characters given). A type with a listed space: it can be drawn (`a random @T`).
  code?: { n: number; alphabet: string; chars: string };
  line: number;
}

export interface RecordDecl {
  name: string;
  fields: Field[];
  key?: string; // `key id: Int`: the field a `ref` holds (without one, the field named `id`)
  line: number;
}

export interface ChoiceDecl {
  name: string;
  values: string[];
  labels: Record<string, string>; // value → display text (defaults to the value)
  wire?: Record<string, string>; // value → its name in JSON (`Info = "info"`); the value itself when absent
  line: number;
}

export type ElementKind = "heading" | "text" | "field" | "button" | "checkbox" | "select" | "list" | "section" | "progress" | "use";

export interface Element {
  kind: ElementKind;
  name: string; // "" for heading
  label?: string; // static label / heading text / section title
  expr?: string; // `= expr` (text value, dynamic button label, list source)
  of?: string; // list row type
  visibleWhen?: string;
  enabledWhen?: string;
  from?: { list: string; field: string }; // dynamic select options
  as?: string; // presentation: a built-in (dialog, table, tabs, badge, …) or a declared component
  look?: string; // styling intent in words
  component?: string; // `use name = Component`: the component to instantiate
  bindings?: { name: string; value: string; line: number }[]; // its parameter values
  children: Element[];
  line: number;
  note?: string;
  screen?: string; // the screen this element is on, when an app has several
}

export type Verb = "click" | "toggle" | "type" | "choose" | "tick" | "start" | "answer" | "event" | "open";

/** `screen ticket "/tickets/{id}" { path id: Int … }`: one of an app's screens, with its address. */
export interface ScreenDecl {
  name: string;
  path: string;
  params: { name: string; type: Type; line: number }[];
  line: number;
  note?: string;
}

/**
 * The body of a handler, an endpoint, recurring work or a layer: steps (prose), and the structure
 * the language owns: `if … { } else if … { } else { }`, `answer …` (ends an endpoint), `stop`.
 */
export type Stmt =
  | { k: "step"; text: string; line: number }
  | { k: "if"; branches: { cond?: string; body: Stmt[]; line: number }[] } // cond undefined: `else`
  | { k: "for"; name: string; list: string; where?: string; body: Stmt[]; line: number } // `for each @x in @xs where … { … }`
  | { k: "answer"; text: string; line: number } // `answer 404 "No such ticket"`, `answer 200 with the ticket`
  | { k: "stop"; line: number };

export interface Handler {
  verb: Verb;
  target: string; // "" for tick
  body?: Stmt[]; // the structure; `steps` is its flat text (conditions and answers included), for checks
  steps: string[];
  stepLines?: number[]; // the line of each step, for diagnostics and the source map
  line: number;
  note?: string;
}

export interface RowRef {
  row: number; // 1-based; 0 when `with` is used
  with?: string; // the first row showing this exact text (a text value, field value or button label)
  list?: string;
  // A row inside a row (a list in a list row): the row of the outer list it is in. Steps name the
  // innermost row first: `toggle done on row 2 on row 1` is item 2 of task 1.
  parent?: RowRef;
}

export type Step =
  | { do: "type"; text: string; target: string; at?: RowRef; line: number }
  | { do: "click"; target: string; at?: RowRef; line: number }
  | { do: "toggle"; target: string; at?: RowRef; line: number }
  | { do: "choose"; value: string; target: string; at?: RowRef; line: number; quoted?: boolean }
  | { do: "tick"; times: number; ms?: number; line: number } // ms: a `wait`: the clock moves on by that much
  | { do: "size"; size: string; line: number } // the host shows the app at another size (`size standard`)
  | { do: "snapshot"; name: string; line: number } // a visual checkpoint: builds must look the same here
  // `steer random PickupCode = "308122", "555001"`: the next draws of that type take these values, in
  // order; `steer random shuffle keeps order` / `reverses order`; `steer random pick 3` (the third item).
  | { do: "random"; what: string; values?: Literal[]; order?: "keep" | "reverse"; pick?: number; line: number }
  | { do: "steer"; api: string; fault: "lose request" | "lose answer" | "duplicate" | "fail" | "slow" | "restart after effect" | "expire keys"; times: number; line: number } // a fault on the way to an api (a screen's provider)
  | { do: "open"; path: string; line: number } // arrive at an address (a screen of an app with several)
  | { do: "back"; line: number } // the browser's back button
  | { do: "restart"; line: number } // the app starts again: stored state keeps its values, the rest starts from its default
  // api profile. `as`: the call is made as that caller, with their key (`call solveTicket as "Ann" with id = 4`).
  | { do: "call"; endpoint: string; args: { name: string; value: Literal }[]; headers?: { name: string; value: Literal }[]; as?: string; line: number }
  // A raw HTTP request (layers, and apps that use them): its answer is `request.status|header.x|body…`.
  // In a layer's examples: a param's value from here on (\`given key = ""\`).
  | { do: "given"; name: string; value: Literal; line: number }
  | { do: "request"; method: string; path: string; args: { in: "header" | "query" | "body"; name: string; value: Literal }[]; line: number }
  | { do: "see"; target: string; at?: RowRef; every?: string; check: Check; line: number }; // every: check each row of that list

export type Check =
  | { is: "eq"; value: string; nothing?: true } // canonical string of the expected value; `= nothing` (an answer's value is null)
  | { is: "rows"; count: number; cmp?: "atMost" | "atLeast"; countParam?: string }
  | { is: "disabled" | "enabled" | "hidden" | "shown" | "checked" | "unchecked" }
  // A number read from what is shown ("10 left" → 10), compared with a number or another element in the same scope.
  | { is: "num"; op: "atLeast" | "atMost" | "above" | "below"; value?: number; ref?: string };

export interface Example {
  name: string;
  steps: Step[];
  line: number;
}

export interface Design {
  look?: string;
  colors: Record<string, string>; // role → Tailwind palette name, e.g. brand → indigo
  font?: string;
  radius?: string;
  density?: string;
}

export interface Param {
  name: string;
  doc?: string;
  default?: string;
  line: number;
}

export interface Component {
  name: string;
  base?: string; // the built-in presentation it starts from
  look: string;
  line: number;
  params?: Param[]; // behaviour components: parameters bound by `use`
  body?: App; // behaviour components: their state, derive, screen, handlers, rules and always
  from?: string; // the bundle it was imported from
}

export interface Import {
  bundle: string; // e.g. std.list
  name?: string; // a single imported name, e.g. Pager
  alias?: string;
  line: number;
}

export interface Endpoint {
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // "/tickets/{id}"
  params: { in: "path" | "query" | "body"; name: string; type: Type; line: number }[];
  returns?: Type; // undefined: the answer has no body
  answers?: { status: number; type?: Type; line: number }[]; // the contract: every status it may answer, with its body type
  signatureOnly?: boolean; // `endpoint name` in an app that implements a contract: method, path and params come from it
  effect?: { kind: "external"; of?: string; line: number }; // `effect external`: reaches outside the system (money, mail, another company); `of @amount`: the param that says how much
  // `undone by cancel with id = @reserve.body.id`: the endpoint that compensates, its args bound to this call (its params, its answer)
  undoneBy?: { endpoint: string; args: { name: string; value: string }[]; line: number };
  body?: Stmt[];
  steps: string[];
  stepLines?: number[];
  line: number;
  note?: string;
}

/** \`function sha256(text: Text): Text\` in a platform: a pure, exact function (docs/design/platform.md). */
export interface PlatformFunction {
  name: string;
  params: { name: string; type: Type }[];
  returns: Type;
  line: number;
  note?: string;
}

export interface App {
  kind?: "app" | "bundle" | "contract" | "layer" | "platform";
  /** A platform (\`platform std.crypto\`): functions the installation implements in reviewed code, never the LLM. */
  functions?: PlatformFunction[];
  /** The platforms an app imports (their functions are available by name). */
  platforms?: { name: string; functions: PlatformFunction[]; records: RecordDecl[] }[];
  // A layer (kind "layer"): what an app configures, what it hands to endpoints, and its two steps lists.
  params?: LayerParam[];
  provides?: Field[];
  before?: { steps: string[]; line: number; stepLines?: number[]; body?: Stmt[] };
  after?: { steps: string[]; line: number; stepLines?: number[]; body?: Stmt[] };
  beforeCall?: { steps: string[]; line: number; stepLines?: number[]; body?: Stmt[] }; // a client layer: changes every outgoing call (adds a key, …)
  exampleConfig?: Binding[]; // `examples with`: the params the layer's own examples run with
  // A layer that provides `caller`: how a test acts as a caller (`call x as "Ann"`), in its typed form:
  // `acts as @caller with header @keyHeader = the @secret of the key in @keys whose @owner is @caller`.
  actsAs?: { header: string; list: string; secret: string; owner: string; line: number };
  // An api's access block (v70): who may call which endpoint and hear which event; default deny.
  access?: AccessBlock;
  // An api app: the layers it runs behind, in order (`use cors = std.http.cors`).
  layers?: LayerUse[];
  profile?: string; // "ui" (default) or "api": which vocabulary the app uses (lib/profile/*.intent)
  language?: string; // `language v70`: the language version the spec was written for
  endpoints?: Endpoint[];
  events?: EventDecl[];
  startsAt?: string; // `examples start at 2026-09-24 09:00`: the clock at the start of every example and session
  sizes?: string[]; // `sizes compact | standard`: the sizes a host may show the screen at (as choice values, `Compact`); the first is the default
  jobs?: { every: number; name: string; steps: string[]; stepLines?: number[]; body?: Stmt[]; line: number }[]; // api: `every 15m { … }`
  everyAnswer?: { status: number; type?: Type; line: number }[]; // `every endpoint answers 401 Problem`: added to every endpoint's answers // what an api (or contract) announces: `event ticketCreated: Ticket`
  name: string;
  imports?: Import[];
  extends?: { name: string; line: number }; // refinement of a published app (see refine.ts)
  implements?: { name: string; line: number }; // an api app that implements a published contract
  uses?: { contract: string; alias: string; testedWith?: string; through?: LayerUse; only?: string[]; line: number }[]; // clients of contracts
  // resolved by the loader. providerCallers: whom a test may act as against the provider (`call x.y as "Sam"`), its key owners.
  clients?: { alias: string; contract: App; testedWith?: string; providerDigest?: string; through?: LayerUse; only?: string[]; line?: number; providerCallers?: string[]; providerAccess?: Record<string, string[]> }[];
  refinements?: import("./refine.ts").Refinement[];
  // Every source file that made up this app; lines of file i (i > 0) are encoded as i * LINE_BASE + line.
  sources?: { file: string; text: string }[];
  design?: Design;
  components: Component[];
  purpose: string[];
  records: RecordDecl[];
  refined?: RefinedDecl[];
  choices: ChoiceDecl[];
  state: Field[];
  clockMs?: number;
  derive: { name: string; sentence: string; type?: Type; line: number; note?: string }[]; // type: `total: Decimal = …`, when declared
  screen: Element[]; // every element, of every screen (each tagged with its screen when there are several)
  screens?: ScreenDecl[]; // several screens (`screen <name> "<path>" { … }`); one unnamed screen when absent
  handlers: Handler[];
  rules: string[];
  ruleLines?: number[]; // the line of each rule
  ruleBy?: ("human" | "ai")[];
  facts?: Facts; // what the compiler worked out, for the quality rules to judge (compiler/quality) // who wrote each rule (`rules by ai { … }`); a person, when absent
  examples: Example[];
  always: Step[]; // invariants: `see` steps that must hold after every action
  invariants?: { text: string; line: number }[]; // `- sentence` in `always`: over the app's data, checked after every step
}

/**
 * `access { roles = grants  - an @Agent may call @solveTicket when that ticket's @assignee is the @caller: "…" }`.
 * Permits (`anyone`, `any caller`, roles) and forbids (`no one may … when …`); conditions are typed whole
 * (compiler/access.ts), so the harness enforces them and the LLM never writes an access check.
 */
export interface AccessBlock {
  roles?: { list: string; line: number }; // `roles = grants`: the state list of grants (who holds which role)
  rules: AccessRule[];
  line: number;
}

export interface AccessRule {
  effect: "permit" | "forbid";
  who: { k: "anyone" } | { k: "caller" } | { k: "roles"; roles: string[] } | { k: "all" }; // all: `no one` (a forbid)
  on: "call" | "hear";
  targets: string[] | "every"; // `@a, @b and @c`, or `every endpoint` / `every event`
  conds: AccessCond[];
  condText?: string; // the condition as written, after `when`
  message?: string; // after `:`: the refusal's `{"error": …}`
  text: string;
  line: number;
}

/** A condition, typed whole: one of the forms the harness generates the check for. */
export type AccessCond =
  // `that ticket's @assignee is (not) the @caller` (the path may follow references: `that ticket's @project's @owner`),
  // `the @caller is (not) in that project's @members`; `its body's @assignee is the @caller` about an event's payload.
  | { k: "caller"; from: "row" | "body"; record?: string; word?: string; path: string[]; in: boolean; not: boolean; text: string }
  // `that ticket's @status is (not) @Archived` (`field`); the older `that ticket is (not) @Archived` has none
  | { k: "value"; record?: string; word: string; field?: string; value: string; not: boolean; text: string }
  // `@amount is at most 100000`, `@amount is at most @approvalLimit`, `@kind is @Refund`
  | { k: "param"; param: string; op: "eq" | "ne" | "le" | "ge" | "lt" | "gt"; value: Literal | { k: "state"; name: string }; text: string };

export interface EventDecl {
  name: string;
  type: Type; // the payload: `its body` in handlers
  line: number;
  note?: string;
}

export interface LayerParam {
  name: string;
  type: Type;
  default?: Literal | Literal[];
  line: number;
  note?: string;
}

export interface Binding {
  name: string;
  value: Literal | Literal[]; // a list param: comma-separated literals, or a table
  state?: string; // a client layer's param bound to the app's state: \`key = apiKey\`
  line: number;
}

export interface LayerUse {
  alias: string;
  layer: string; // the layer's bundle name, e.g. std.http.cors
  bindings: Binding[];
  line: number;
  spec?: App; // resolved by the loader
  digest?: string; // the layer spec's canonical hash: its build is reused by every app
}

/** Lines from imported files are offset by their file index × LINE_BASE (see App.sources). */
export const LINE_BASE = 100000;

export interface Diagnostic {
  level: "error" | "warning";
  code: string;
  line: number;
  col: number;
  message: string;
  file?: string;
}

/** What the compiler worked out while checking, for the quality rules (std.quality) to judge. */
export interface Facts {
  proven?: string[]; // elements some example checks (`name`, or `list.name` for a row's element)
  usedComponents?: string[]; // components some element uses (`… as Name`)
  clockLine?: number; // the line of `clock every …`
  overridden?: string[]; // names a refinement changes (`override …`, `drop …`)
  untypedDerived?: { name: string; where: string }[]; // derived values used where their type matters, with no type known
  navigations?: import("./fit.ts").Navigation[]; // reads through references (`its @ticket's @subject`)
  navSpelling?: { line: number; from: string; to: string }[]; // lookups of a reference's own row, and their navigation
  draws?: import("./draws.ts").DrawFact[]; // the draw phrases (v69), where they are and the types around them
}
