// IR for an .intent file. Produced by parse.ts, consumed by the generators and the test driver.

export type Type =
  | { k: "Text" }
  | { k: "Int" }
  | { k: "Decimal" }
  | { k: "Bool" }
  | { k: "List"; of: Type }
  | { k: "Maybe"; of: Type }
  | { k: "Named"; name: string };

export type Literal =
  | { k: "text"; v: string }
  | { k: "number"; v: number; raw: string }
  | { k: "bool"; v: boolean }
  | { k: "emptyList" }
  | { k: "nothing" }
  | { k: "value"; v: string } // a choice value
  | { k: "table"; columns: string[]; rows: Literal[][] }; // seed data for List Record

export interface Field {
  name: string;
  type: Type;
  default?: Literal;
  line: number;
}

export interface RecordDecl {
  name: string;
  fields: Field[];
  line: number;
}

export interface ChoiceDecl {
  name: string;
  values: string[];
  labels: Record<string, string>; // value → display text (defaults to the value)
  line: number;
}

export type ElementKind = "heading" | "text" | "field" | "button" | "checkbox" | "select" | "list" | "section" | "progress";

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
  children: Element[];
  line: number;
}

export type Verb = "click" | "toggle" | "type" | "choose" | "tick";

export interface Handler {
  verb: Verb;
  target: string; // "" for tick
  steps: string[];
  line: number;
}

export interface RowRef {
  row: number; // 1-based; 0 when `with` is used
  with?: string; // the first row showing this exact text (a text value, field value or button label)
  list?: string;
}

export type Step =
  | { do: "type"; text: string; target: string; line: number }
  | { do: "click"; target: string; at?: RowRef; line: number }
  | { do: "toggle"; target: string; at?: RowRef; line: number }
  | { do: "choose"; value: string; target: string; line: number; quoted?: boolean }
  | { do: "tick"; times: number; line: number }
  | { do: "snapshot"; name: string; line: number } // a visual checkpoint: builds must look the same here
  | { do: "see"; target: string; at?: RowRef; check: Check; line: number };

export type Check =
  | { is: "eq"; value: string } // canonical string of the expected value
  | { is: "rows"; count: number; cmp?: "atMost" | "atLeast" }
  | { is: "disabled" | "enabled" | "hidden" | "shown" | "checked" | "unchecked" };

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

export interface Component {
  name: string;
  base?: string; // the built-in presentation it starts from
  look: string;
  line: number;
}

export interface App {
  name: string;
  design?: Design;
  components: Component[];
  purpose: string[];
  records: RecordDecl[];
  choices: ChoiceDecl[];
  state: Field[];
  clockMs?: number;
  derive: { name: string; sentence: string; line: number }[];
  screen: Element[];
  handlers: Handler[];
  rules: string[];
  examples: Example[];
  always: Step[]; // invariants: `see` steps that must hold after every action
}

export interface Diagnostic {
  level: "error" | "warning";
  code: string;
  line: number;
  col: number;
  message: string;
}
