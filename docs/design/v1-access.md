# Design: access control (v1)

Status: proposed, not built. It turns "who may do what" from sentences in endpoint steps and a gate
in the browser into declared, default-deny rules that the harness enforces on the server.

## What exists today (precisely)

- **Authentication, not authorization.** `std.http.apiKey` (`lib/std/http/apiKey.intent`) refuses a
  missing or unknown key with 401 and provides `caller: Text`, the key's owner. What that caller may
  do is written by hand in each endpoint: `apps/api/desk-api.intent` says `if that ticket's @assignee
  is not the @caller { answer 403 "Only the assignee can solve this ticket" }` in `solveTicket`.
  Nothing requires such a check. An endpoint that forgets one is open to every key holder, and no
  checker, example or twin build notices, because the missing check is consistent. `apps/api/
  payments-api.intent` has no layer at all: anyone may charge and refund.
- **Approval is a gate in the screen.** `through std.actions` (`lib/std/actions.intent`, carried
  out by `agreement()` in `runtime/ts/calls.ts`) holds a screen's `effect external` calls until a
  `Permission` in the **screen's own state** covers them. `fourEyes` compares `requester` with
  `approver`, two texts the screen itself sets (`apps/20-approval.intent` writes `@approver =
  "Sam"` from a button anyone can click). The reference says so honestly (§4h): "The gate runs in
  the screen, so it protects against the app's own mistakes and an agent acting too fast, not
  against someone who controls the browser." `docs/design/effects.md` marks the server side as "a
  later step".
- **Specs promise access they cannot express.** `apps/held-out-3/approvals.intent` says "a manager
  approves or rejects". The app has no notion of who is acting, so anyone approves anything,
  including their own expense. The author did the best the language allows.

**Recommendation: in v1, the core of it.** Broken access control is first in the OWASP Top 10 in
2021 and again in 2025 ("100% of tested applications had some form of broken access control"), and
the fix the experts agree on (deny by default, declared rules enforced in one trusted place, tested
positively and negatively) is exactly the kind of thing the harness should own: it needs no
judgement, it is easy to get subtly wrong, and it is the same for every API. Leaving it to endpoint
sentences means an LLM decides, per endpoint, whether security exists. The parts listed under "Not
in v1" are real needs, but they can wait without making v1 unsafe.

## Sources, and where this design follows or departs from them

| Source | What it says | Here |
|---|---|---|
| NIST RBAC: Sandhu, Ferraiolo, Kuhn, "The NIST model for role-based access control" (ACM RBAC 2000); ANSI INCITS 359-2004 | Users, roles and permissions; user assignment (UA) and permission assignment (PA) as relations; levels: flat, hierarchical, constrained (static and dynamic separation of duty, SSD/DSD) | **Follows flat RBAC.** Roles are a `choice`; UA is **data** (a list of grants in stored state, so an admin endpoint can change it); PA is **the spec** (the `access` block, reviewed and versioned). SSD is an `always` sentence over the grants. **Departs:** no role hierarchy in v1 (a person holds several roles instead). |
| OWASP Top 10:2025 A01 Broken Access Control, "How to prevent": "Access control is only effective when implemented in trusted server-side code"; "deny by default"; "implement access control mechanisms once and re-use them"; "enforce record ownership"; "log access control failures"; "include functional access control testing in unit and integration tests"; "use established toolkits providing declarative access controls" | Default deny, one mechanism, ownership, logging, tests | **Follows each point:** server only, deny by default once a spec has an `access` block, one harness mechanism for every endpoint, row conditions for ownership, an audit of every refusal, and examples plus rule mutation as the tests. |
| OWASP ASVS 5.0, V8 Authorization: 8.2.1 function-level access "restricted to consumers with explicit permissions"; 8.2.2 data-specific access against IDOR/BOLA; 8.2.3 field-level against BOPLA; 8.3.1 "enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate, such as client-side JavaScript"; 8.3.2 "changes to values on which authorization decisions are made are applied immediately"; 8.3.3 decisions on the originating subject, not an intermediary | Function, row and field level; trusted layer; immediate effect; the originating subject | **Follows** 8.2.1, 8.2.2, 8.3.1 and 8.3.2 (grants are read from state on every request). 8.3.3: a screen's calls carry its user's own key (`std.http.sendKey`), so the originating subject is the caller. **Departs:** field-level (8.2.3) is not in v1. |
| OWASP API Security Top 10 2023: API1 BOLA, API3 BOPLA, API5 BFLA | Object, property and function level are separate failures | BFLA: role rules. BOLA: row conditions. BOPLA: not in v1 (said plainly). |
| OWASP Authorization Cheat Sheet | Enforce on every request, deny by default, prefer attribute- and relationship-based checks over bare roles, test both allowed and denied | **Follows.** Roles alone are not enough, so rules can add a typed condition on the row (relationship) or on the request (attribute). |
| Zanzibar: Pang et al., "Zanzibar: Google's consistent, global authorization system" (USENIX ATC 2019); OpenFGA and SpiceDB schemas (`relation owner: user; permission edit = owner + editor`) | Relationship-based access: tuples `object#relation@user`, relations computed through other objects | **Follows one hop:** "that ticket's @assignee is the @caller", "the @caller is in that project's @members". Several hops (ticket → project → members) come with following references (`docs/design/v1-ref-navigation.md`): `the @caller is in that ticket's @project's @members`. **Departs:** no userset rewrites or separate tuple store: the relations are the app's own records. |
| Cedar (AWS): docs "How Cedar authorization works"; Cutler et al., "Cedar: a new language for expressive, fast, safe, and analyzable authorization" (OOPSLA 2024) | `permit` / `forbid`; "by default, the decision is Deny"; "any satisfied forbid policy overrides" a permit; policies validated against a schema; the answer names "the determining policies" | **Follows closely:** permit and forbid (`may` / `no one may`), default deny, forbid wins, rules type-checked against the spec, and every decision names its determining rules. Those rule names go into the audit and the trace. Cedar keeps its language small so that it stays analyzable; so do access conditions here (typed whole, no free English). |
| NIST SP 800-53 AC-5 (separation of duties), AC-6 (least privilege), AU-3 (content of audit records: what, when, where, source, outcome, identity); Clark & Wilson, "A comparison of commercial and military computer security policies" (IEEE S&P 1987) | Separation of duty; well-formed transactions; an append-only log that the transactions cannot change | **Follows.** Four eyes is a `forbid` on the row ("no one may approve what they submitted", that is, dynamic, object-level SoD); static SoD is an `always` sentence; the audit is written by the harness and no endpoint can read or change it. |
| Maker-checker (four-eyes) practice in banking and payments; GitHub's rule that a pull request's author cannot approve it | The approval is a state change by a second person, checked by the system of record | **Follows:** server-side approval is data (a request row, a status, the requester, the approver) plus a forbid rule. **Departs** from a generic "hold any request for approval on the server": not in v1 (below). |
| GitHub REST docs: "GitHub uses a 404 Not Found response instead of a 403 Forbidden response to avoid confirming the existence of private repositories" | Hiding existence | **Departs in v1:** refusals are 403 with the rule's message; hiding existence is open question 3. |

## The language

### 1. Who is calling

The **caller** is whoever the authenticating layer says it is: `@caller`, as today. An `access`
block requires exactly one layer that `provides caller` (`std.http.apiKey` now; a bearer-token
layer later), and it never cares which one. Anonymous is `""`, as on a public path today.

What a caller **is** comes from the app's data, not from the key. That is RBAC's user assignment,
kept where an admin endpoint can change it and where an `always` sentence can check it:

```
choice Role: Agent | Lead | Admin

record Grant {
  who: Text             # a caller, as the key layer names them
  role: Role
}

state {
  stored grants: List Grant = table {
    who   | role
    "Ann" | Agent
    "Sam" | Agent
    "Lin" | Lead
    "Lin" | Agent
  }
}
```

A caller holds the `role` of every grant whose `who` is the caller. The list's record must have a
`who: Text` and exactly one field whose type is a choice. That choice is the app's roles.

### 2. The `access` block

```
access {
  roles = grants
  - anyone may call @health
  - any caller may call @me
  - an @Agent may call @myTickets, @takeTicket and @addComment
  - an @Agent may call @solveTicket when that ticket's @assignee is the @caller: "Only the assignee can solve this ticket"
  - a @Lead may call every endpoint
  - no one may call @reopenTicket when that ticket is @Archived: "Archived tickets stay closed"
  - an @Agent may hear @ticketAssigned when its body's @assignee is the @caller
  - a @Lead may hear every event
}
```

- `roles = <list>` binds the grants (a binding, so no `@`).
- **Permits:** `anyone may call …` (no key needed), `any caller may call …` (any known key, with or
  without roles), `a/an @Role [or a/an @Role] may call <endpoints>`, where the endpoints are `@a`,
  `@a and @b`, or `every endpoint`.
- **Forbids:** `no one may call <endpoints> when <condition>`. A forbid that holds refuses, whatever
  permits. A forbid always has a condition (an unconditional one is a dropped endpoint).
- **Events:** `may hear @event` / `every event`, with the same roles and conditions. On `GET /events`
  each event goes only to the streams whose caller may hear it (`its body's …` is the payload). With
  an `access` block, the stream itself needs no rule: it is filtered per event.
- **The message** after `:` is the refusal's `{"error": …}`; without one it is `"Not allowed"`.
- **Default deny.** In an app with an `access` block, a request that no rule permits is refused,
  including an endpoint added later. A spec without an `access` block works as today, and gets
  `NO_ACCESS` when it has an authenticating layer (below).
- **One spelling for "public".** `anyone may call @health` replaces the key layer's `public` param:
  the harness binds `public` from the `anyone` rules. Writing both is an `ACCESS` error.

### 3. Conditions are typed whole

A condition is one of these forms, joined with `and`. For "or", write a second rule:

| Form | Example |
|---|---|
| a field of the row is (not) the caller | `that ticket's @assignee is the @caller`, `that expense's @submitter is not the @caller` |
| the caller is (not) in a list field of the row | `the @caller is in that project's @members` |
| the row has a choice value | `that ticket is @Archived`, `that payout is not @Requested` |
| a param compared with a literal or a state field | `@amount is at most 100000`, `@amount is at most @approvalLimit` |
| a field of the event's payload is the caller | `its body's @assignee is the @caller` |

Anything else is an `ACCESS` error: "an access condition is typed whole, so the harness can enforce
it". This is what keeps access out of the LLM's hands. Every form maps to code without judgement,
and the harness generates it, exactly as it generates the check for a refined type.

**The row.** "that ticket" in a rule is the row the endpoint names with a **`ref` param**:
`path id: ref Ticket`. The value on the wire is the Ticket's key, as before, so contracts and
clients do not change, but the checker now knows which record the param points at. (Allowing
`ref` on params is the one language change outside the `access` block.) A rule that says "that
ticket" for an endpoint without a `ref Ticket` param is a `NO_ROW` error. When the key points at no
row, the row's conditions do not refuse: there is nothing to protect, and the endpoint answers for
the missing row itself, as it must already (`UNGUARDED`). The role part still applies.

**A condition that cannot be decided fails closed.** When a condition follows a reference whose
row is gone (`that ticket's @project's @members`, and the project was removed), a permit does not
hold and a **forbid does**: the request is refused. Here the design departs from Cedar, which skips
a policy that errors (a skipped forbid allows); the ASVS v4 rule to "fail securely" (4.1.5) is
the better default when nobody can review each decision.

### 4. Approvals and four eyes, on the server

An approval that must hold against the user is a **state change on the service** by a second person,
refused by a rule when it is the same person: maker-checker as data. No new mechanism is needed.
The `access` block and `always` carry it:

```
access {
  roles = grants
  - an @Employee may call @submitExpense and @myExpenses
  - a @Manager may call @pendingExpenses, @approveExpense and @rejectExpense
  - no one may call @approveExpense and @rejectExpense when that expense's @submitter is the @caller: "Someone else must decide on your own expense"
}

always {
  - no @Expense in @expenses is @Approved with its @approver the same as its @submitter
}
```

`std.actions` stays what it is: a brake in the screen, held by the host. It is the right tool
against an **agent** acting too fast, because there the host is trusted and the agent is not; and
the wrong tool against a **person**, who controls the browser. The reference and the skill say so in
those words. A spec that needs both writes both: the service refuses self-approval, and the screen
holds an agent's calls until a person agrees.

### 5. What the screen does

A screen enforces nothing. It shows what the service decided, and it may leave out what its user
cannot do:

- `access` in a `ui` or `job` profile is an `ACCESS` error: "a screen cannot enforce access; put the
  rule on the service it calls".
- A refusal is an answer like any other: the contract says `every endpoint answers 401 Problem,
  403 Problem`, and the screen writes `if its status is 403 { - set @problem to the error }`.
  An implementation with an `access` block whose contract does not declare 403 on a restricted
  endpoint is a `CONTRACT` error.
- To hide a button from someone who may not use it, the screen reads what it needs from the service
  (a `me` endpoint answering the caller's roles) and uses `visible when`. That is convenience, never
  protection: the service still refuses.
- A screen-only app whose purpose or rules promise who may do what ("a manager approves", "only
  the owner") gets `UNENFORCED`: without a service, the promise cannot be kept.

### 6. Examples: acting as someone

`call x as "Ann" with id = 4` sends the call as Ann, through the layers. The authenticating layer
says once how a test acts as a caller:

```
layer std.http.apiKey {
  …
  acts as @caller with header @keyHeader = the @secret of the key in @keys whose @owner is @caller
}
```

- `as "Ann"` requires a key for Ann in the layer's bound keys (else `ACCESS`: "no key belongs to
  Zed"). A call without `as` and without a key header is anonymous, as today. `with header
  x-api-key = "…"` still works, for testing wrong keys.
- Roles are data: an example proves a role change by calling the endpoint that grants it, then
  calling again (ASVS 8.3.2: the change applies at once).
- In a screen's example, `call desk.solveTicket as "Sam" with id = 4` is another client acting as Sam;
  the screen's own user signs in as it does today (typing a key into the field bound to
  `std.http.sendKey`).
- `see audit[3].caller = "Ann"`, `see audit[3].decision = "refused"`, `see audit has 4 rows`
  check the audit, as `see x.body[1].id` checks a body. Lists count from 1.

## Three specs

**The desk api, with its checks declared** (`apps/api/desk-api.intent` rewritten):

```
app DeskApi { "The support desk's API for agents." }
import support.tickets
implements support.deskApi

use secure = std.http.secure
use cors = std.http.cors {
  origins = "https://desk.example"
  headers = "content-type", "x-api-key"
}
use auth = std.http.apiKey {
  keys = table {
    secret         | owner
    "k-ann-7f3a"   | "Ann"
    "k-sam-91bc"   | "Sam"
    "k-lin-44d0"   | "Lin"
    "k-eve-0b1e"   | "Eve"          # a key, but no role
  }
}

choice Role: Agent | Lead

record Grant {
  who: Text
  role: Role
}

state {
  stored grants: List Grant = table {
    who   | role
    "Ann" | Agent
    "Sam" | Agent
    "Lin" | Lead
  }
  tickets: List Ticket = table { … }
}

access {
  roles = grants
  - anyone may call @health
  - an @Agent may call @myTickets, @takeTicket and @addComment
  - an @Agent may call @solveTicket when that ticket's @assignee is the @caller: "Only the assignee can solve this ticket"
  - a @Lead may call every endpoint
  - an @Agent may hear @ticketAssigned and @ticketSolved when its body's @assignee is the @caller
  - a @Lead may hear every event
}

endpoint solveTicket {                  # the contract now says `path id: ref Ticket`
  if no ticket has that @id {
    answer 404 "No such ticket"
  }
  if that ticket is @Solved {
    answer 409 "Already solved"
  }
  - set its @status to @Solved
  - publish @ticketSolved with the ticket
  answer 200 with the ticket
}

example "only the assignee solves; a lead solves any" {
  call takeTicket as "Sam" with id = 4
  call solveTicket as "Ann" with id = 4
  see solveTicket.status = 403
  see solveTicket.body.error = "Only the assignee can solve this ticket"
  call solveTicket as "Lin" with id = 4
  see solveTicket.status = 200
}

example "a key without a role reaches nothing but health" {
  call myTickets as "Eve"
  see myTickets.status = 403
  see myTickets.body.error = "Not allowed"
  see audit[1].caller = "Eve"
  see audit[1].decision = "refused"
  call health
  see health.status = 200
}
```

The hand-written 403 step is gone from `solveTicket`. If it stays, the checker hints `HAND_ACCESS`.

**Expenses with four eyes on the server** (the held-out approvals app's promise, kept; a new
`apps/api/expenses-api.intent` with the contract `lib/expenses/expensesApi.intent`):

```
app ExpensesApi {
  "Employees submit expenses; a manager who did not submit an expense approves or rejects it."
}
profile api
import expenses.expenses                # Expense, Status, Category
implements expenses.expensesApi

use secure = std.http.secure
use auth = std.http.apiKey {
  keys = table {
    secret       | owner
    "k-ann-11"   | "Ann"
    "k-mo-22"    | "Mo"
    "k-kim-33"   | "Kim"
  }
}

choice Role: Employee | Manager

record Grant {
  who: Text
  role: Role
}

state {
  stored grants: List Grant = table {
    who   | role
    "Ann" | Employee
    "Mo"  | Employee
    "Mo"  | Manager
    "Kim" | Manager
  }
  stored expenses: List Expense = []    # Expense has submitter: Text and approver: Text or nothing
}

access {
  roles = grants
  - an @Employee may call @submitExpense and @myExpenses
  - a @Manager may call @pendingExpenses, @approveExpense and @rejectExpense
  - no one may call @approveExpense and @rejectExpense when that expense's @submitter is the @caller: "Someone else must decide on your own expense"
  - no one may call @approveExpense and @rejectExpense when that expense is not @Pending: "This expense has been decided"
}

endpoint submitExpense {
  - add an @Expense to the end of @expenses with @id = the highest @id in @expenses + 1 (1 when there are none), the given @description, @amount and @category, @status @Pending, @submitter = the @caller
  answer 201 with the new expense
}

endpoint approveExpense {               # path id: ref Expense
  if no expense has that @id {
    answer 404 "No such expense"
  }
  - set its @status to @Approved and its @approver to the @caller
  answer 200 with the expense
}

always {
  - no @Expense in @expenses is @Approved with its @approver the same as its @submitter
  - every @Expense in @expenses whose @status is @Approved has an @approver
}

example "a manager cannot approve their own expense, another manager can" {
  call submitExpense as "Mo" with description = "Hotel", amount = 120.50, category = Travel
  call approveExpense as "Mo" with id = 1
  see approveExpense.status = 403
  see approveExpense.body.error = "Someone else must decide on your own expense"
  call approveExpense as "Kim" with id = 1
  see approveExpense.status = 200
  see approveExpense.body.approver = "Kim"
}

example "an employee cannot approve at all" {
  call submitExpense as "Mo" with description = "Taxi", amount = 20, category = Travel
  call approveExpense as "Ann" with id = 1
  see approveExpense.status = 403
  see approveExpense.body.error = "Not allowed"
}

example "a decided expense stays decided" {
  call submitExpense as "Ann" with description = "Lunch", amount = 15, category = Meals
  call rejectExpense as "Kim" with id = 1
  call approveExpense as "Mo" with id = 1
  see approveExpense.status = 403
  see approveExpense.body.error = "This expense has been decided"
}
```

The forbid on decided expenses refuses the request. That a decided expense never changes, whoever
asks, is a change rule (`docs/design/v1-changes.md`); the two say different things and both belong
in the spec.

The screen for it (`apps/32-expenses-ui.intent`) uses `through std.http.sendKey`, shows the
Approve button `visible when` the `me` answer holds `Manager`, and handles 403 by showing the
error. Its examples prove that Mo, signed in, sees "Someone else must decide on your own expense"
on his own row. The screen does not decide that; the provider does, in the same test.

**Payouts: an amount limit, then a checker** (attribute and relationship together; a new
`apps/api/payouts-api.intent`):

```
access {
  roles = grants
  - a @Clerk may call @requestPayout when @amount is at most 1000000
  - a @Clerk or an @Approver may call @listPayouts
  - an @Approver may call @approvePayout
  - no one may call @approvePayout when that payout's @requester is the @caller: "A second person must approve"
  - no one may call @approvePayout when that payout is not @Requested: "This payout is not waiting for approval"
}

endpoint requestPayout {
  - add a @Payout to the end of @payouts with …, @requester = the @caller and @status @Requested
  if @amount is at most @approvalLimit {
    - set the new payout's @status to @Paid       # small payouts need no second person
    - call …                                        # the external payment
  }
  answer 201 with the new payout
}

always {
  - no two @grants have the same @who with one @Clerk and the other @Approver    # static separation of duty
  - no @Payout in @payouts above @approvalLimit is @Paid without an @approver
}
```

## Checker

| Code | Level | When |
|---|---|---|
| `ACCESS` | error | an `access` block in a `ui` or `job` profile; no layer provides `caller`; `roles =` names a list whose record lacks `who: Text` or a choice field; a condition that is not one of the typed forms; a forbid without a condition; `anyone may` together with the key layer's `public`; `as "Zed"` for a caller no key belongs to |
| `UNKNOWN_NAME` | error | (existing) a rule names an endpoint, event, role or field that does not exist |
| `TYPE` | error | (existing) a role that is not a value of the roles choice; `@amount is at most "x"` |
| `NO_ROW` | error | (existing) "that ticket" in a rule for an endpoint with no `ref Ticket` param |
| `CONTRACT` | error | (existing) a restricted endpoint whose contract does not declare 403 (and 401 when it is not public) |
| `UNGRANTED` | warning | with an `access` block, an endpoint or event that no rule permits: nobody can call or hear it |
| `NO_ACCESS` | warning, std.quality | an api with an authenticating layer and no `access` block: every key holder may call every endpoint |
| `HAND_ACCESS` | warning, std.quality | in an app with an `access` block, an endpoint step answers 403 on a condition about the caller: move it to the block, where it is enforced and audited |
| `ACCESS_UNPROVEN` | warning, std.quality | a rule that no example proves both ways: one call it permits (as a caller it covers, answered neither 401 nor 403) and one call it refuses |
| `UNENFORCED` | warning, std.quality | a `ui` or `job` app that calls no service, whose purpose or rules say who may do what ("only …", "a manager approves", "cannot approve their own") |

## Harness and runtime

- **Where it runs.** On the server, per request: routing (404, 405) → the layers in order (the
  authenticating one provides `caller`) → input checks (400) → **access** → the endpoint. The
  decision is Cedar's: collect the rules for this endpoint that hold; a forbid wins; else a permit
  allows; else deny. Anonymous and not permitted: 401 (`Missing API key`, from the layer, as
  today, because `public` is bound from the `anyone` rules). Known and not permitted: 403 `{"error":
  …}` with the determining rule's message.
- **Generated, not written.** The harness compiles the block into `access.mjs` (one per build, the
  same for twin builds, outside the LLM's module), as it compiles refined-type checks. The endpoint
  code never runs for a refused request. The prompt says: access is enforced before your handler;
  don't check roles yourself.
- **Read on every request.** Grants are read from state per request, so a revoked role takes effect
  on the next request (ASVS 8.3.2).
- **With "once".** A request with an idempotency key is checked before it is replayed, so a caller
  whose role was revoked does not get a stored answer back.
- **A refusal changes nothing.** In every test the harness asserts that a refused request left the
  state, the published events and the outgoing calls unchanged. This is a built-in `always`, as the
  restart check is for stored fields.
- **Audit.** The harness appends one entry for every refusal and for every permitted request with a
  non-safe method: `at` (the clock), `caller`, `endpoint`, `decision` (`allowed` / `refused`),
  `rules` (the determining rules as file:line), `status`, and the idempotency key when there is one.
  Never the key's secret. Permitted GETs are not logged, by default (open question 4). It goes to
  `INTENT_AUDIT` (default `audit.jsonl`), append-only, written with the stored-state update of the
  same request (the same atomicity as idempotency keys), and **not** readable or writable by
  endpoints (Clark–Wilson: the log is outside the transactions it records). Examples read it with
  `see audit…`, and the fuzzer compares it across twin builds.
- **Refinement.** A spec that `extends` another adds rules to the base's block (permits widen,
  forbids narrow); `override access` replaces the whole block and triggers `OVERRIDES_PROOF` for the
  base's examples that use `as`.

**Random sessions** call as each caller the examples use, anonymously, and as a caller with a key
but no grant. They lean toward crossing ownership (Ann acting on Sam's ticket, a manager on their
own expense), because that is where BOLA lives. They check the built-in "a refusal changes
nothing" and the spec's `always` sentences (the separation-of-duty rules), and report any failure as
example steps with `as`.

**Rule mutation** measures whether the examples prove the rules, at no LLM cost, because access is
harness code: for each rule, run the examples with that rule removed (and each forbid removed), and
report every mutant that no example catches. This is the dynamic half of `ACCESS_UNPROVEN`, and the
planted-bug check that AGENTS.md asks of every measurement.

## Traceability

- `sourcemap.json` gets `access`: each rule with its file:line and the endpoints and events it
  covers, and per endpoint the rules that govern it. A screen's per-handler `effects` (§4f) gain
  `access`: the provider's rules for each endpoint the handler calls, taken from the `tested with`
  build's source map.
- With `INTENT_TRACE=1`, a 401 or 403 carries `x-intent-source` naming the determining rule, or
  "no rule permits this: access block at file:line" for a default denial.
- So from the running app: a user points at the Approve button (`data-el="approve"`) → the handler
  → `expenses.approveExpense` → the rules at `expenses-api.intent:31–33`. A refused request in
  production leads to the same lines through its audit entry. The fix is a spec change: a rule,
  or a new example with `as` that reproduces the refusal.

## Changes to the reference

§4e gains "Access" (the block, the forms, default deny, the order of checks, the audit, `ref`
params); §4h says that `public` comes from `anyone may` rules in an app with an `access` block, and
that `std.actions` is a brake, not access control; §6 gains `as "…"` and `see audit…`; §7 gains the
codes. The skill's §5g gets "who may do what goes in `access`, never in endpoint steps; prove every
rule with one allowed and one refused call", and the held-out lesson (the approvals app could not
say "a manager").

## Test plan

Checker (`tests/checker/load/access.intent`, loaded because it needs the key layer):

```
access {
  roles = grants
  - anyone may call @health
  - an @Agnt may call @myTickets                               # expect: UNKNOWN_NAME
  - an @Agent may call @solveTicket when that ticket's @assignee is the @caller
  - an @Agent may call @health when the caller looks trustworthy    # expect: ACCESS
  - an @Agent may call @listTickets when that ticket's @assignee is the @caller   # expect: NO_ROW
  - no one may call @deleteTicket                              # expect: ACCESS
}
endpoint archive …                                             # expect: UNGRANTED
```

Plus: `tests/checker/access-ui.intent` (`access` in a screen: `ACCESS`); a spec with `public =` and
`anyone may` (`ACCESS`); `as "Zed"` (`ACCESS`); a contract without 403 (`CONTRACT`);
`tests/quality.test.ts` for `NO_ACCESS`, `HAND_ACCESS`, `ACCESS_UNPROVEN`, and `UNENFORCED` on
`apps/held-out-3/approvals.intent` (expected: that app gets the hint, and it is not edited).

Runtime (`tests/access.test.ts`): the decision table (permit only, forbid over permit, no rule,
anonymous → 401, a missing row, events filtered per stream); grants read per request (revoke, then
refused); the replay order with `once`; the audit entry's fields and that it has no secret; "a
refusal changes nothing" catching a planted handler that writes before the check.

Apps and measurement:

- `apps/api/desk-api.intent` migrated (its examples keep passing, plus `as` examples for Eve and
  Lin);
- `apps/api/expenses-api.intent` + `lib/expenses/expensesApi.intent` + `apps/32-expenses-ui.intent`;
- `apps/api/payouts-api.intent` (amount condition, static separation of duty in `always`);
- `apps/20-approval.intent` unchanged (the brake), with a note in its purpose that it is one;
- planted bugs: a build whose endpoint ignores ownership is harmless now (access runs first), so the
  planted bugs go to the rules instead: rule mutation must report zero surviving mutants on the three
  apis. A mutant that survives is a missing example, and gets one;
- `intent converge` before and after on the desk api and its screen; the harness snapshot changes
  for specs with `access` (the new `access.mjs`, the prompt's line) and nowhere else.

## Not in v1

- **Field-level access** (ASVS 8.2.3, BOPLA): which fields of an answer a caller may see or
  change. It needs per-field rules on records and answer filtering. Until then, give different
  callers different endpoints with different answer types.
- **Filtering lists by access** (row-level security on answers, Zanzibar's "list objects"): a
  list endpoint filters in its own sentence (`the @tickets whose @assignee is the @caller`), which
  examples prove.
- **Role hierarchies**: a lead holds both grants instead. (Several hops through references are in,
  if `docs/design/v1-ref-navigation.md` is: a condition may follow references as any sentence can.)
- **A generic "hold on the server until approved"** (the server-side twin of `std.actions`): it
  raises questions that deserve their own design: under whose identity the held request runs, what
  happens when the state changed between request and approval, and how long a hold lasts. Maker-checker as
  data (above) covers the need now, and says the answers in the spec.
- **Multi-tenancy** (ASVS 8.4.1) and **bearer tokens / OIDC**: a tenant is a condition on rows
  today; a token layer is a new layer that `provides caller`, and nothing here changes for it.
- **Context attributes** (time of day, IP, device; ASVS 8.2.4): `@now` in a condition is a small
  follow-up once the typed forms are in use.

## Open questions, with a recommendation

1. **Should default deny start when a spec has an authenticating layer, rather than when it has an
   `access` block?** Recommend: at the block in v1, with `NO_ACCESS` as a warning, and make
   `NO_ACCESS` an error for specs that declare the language version that ships this. Existing specs
   keep working; new ones cannot silently skip it.
2. **Roles as a `choice` plus a grants list, or a dedicated `roles` line?** Recommend the choice
   and the list: both already exist, grants are data an admin endpoint can change, and `always` can
   state separation of duty over them. A dedicated form would be a second spelling of a choice.
3. **403 or 404 for a row the caller may not touch?** Recommend 403 with the rule's message in v1:
   the examples and the screens need the reason, and hiding existence only matters when ids can be
   guessed. The random-values design gives unguessable keys (`Text of 22 letters and digits`), and a
   later `hidden` marker on a rule can answer 404 for the APIs that need GitHub's behaviour.
4. **Audit permitted reads?** Recommend no by default (volume), and a per-endpoint `audited` line
   later for sensitive reads. Refusals and writes cover OWASP's "log access control failures" and
   AU-3.
5. **Should a screen get the rules to hide buttons (a generated `GET /access` answering what the
   caller may call)?** Recommend next, not v1. It is the right shape (the same rules, evaluated by
   the service, so the screen never duplicates them), but it needs a contract form of its own.
   v1 screens use a `me` endpoint and `visible when`.
