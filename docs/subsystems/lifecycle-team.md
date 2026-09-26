# Lifecycle team

English | [中文](lifecycle-team.zh.md)

The lifecycle team runs a requirement through a fixed state machine with three role agents, a Planner, a Generator, and an Evaluator, and a human orchestrator. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) are Markdown files under a workspace's `lifecycle/tasks/` directory, their states and owners live in frontmatter, and every move between states is one of the transitions a YAML table registers with guards, effects, and the fields it may change. The [design note](../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.md) owns the decision record; this page records the shared vocabulary and the wiring.

## Packages

| Package | Role |
|---|---|
| [`dsh-experimental-lifecycle-table`](../../packages/experimental/lifecycle-table/README.md) | Loads and validates `lifecycle.yml`, `agent-registry.yml`, and `tasks/id-scheme.yml`, and derives role states, required review gates, reachable states, and the lifecycle-sensitive kinds |
| [`dsh-experimental-lifecycle-work-items`](../../packages/experimental/lifecycle-work-items/README.md) | Parses the artifacts into a graph, loads `artifact-contract.yml`, lints the graph, judges a step against the table's guards and effects, plans effect edits, and writes them atomically |
| [`dsh-experimental-lifecycle-orchestrator`](../../packages/experimental/lifecycle-orchestrator/README.md) | The `ctx.lifecycle` service, the `lifecycle_*` tools, the `/lifecycle` command, the `lifecycle:policy` prompt section, the role briefs, and the English defaults `lifecycle_init` scaffolds |
| [`dsh-experimental-lifecycle-model-fallback`](../../packages/experimental/lifecycle-model-fallback/README.md) | Moves a lifecycle role child to the next route of its registry entry when a request fails with a hop-worthy code, after `llm-retry` and every other recovery policy left the failure terminal, and retries the step under the same uid |
| [`dsh-experimental-lifecycle-team-profile`](../../packages/experimental/lifecycle-team-profile/README.md) | The optional bundle that composes the orchestrator and the fallback over dsh-base and keeps Ralph off; switched on per profile by the plugin manager |

## Files in a workspace

| File | Owner | Content |
|---|---|---|
| `lifecycle/lifecycle.yml` | table | the REQ main chain and off-chain states, TC and BUG statuses, roles, review gates, `tc_policy` exits, `pass_to_enter`, the TC statuses each REQ state allows, the T16 restore targets, the 21 transitions, the 5 events, and the predicate vocabulary |
| `lifecycle/agent-registry.yml` | table | role seats: uid, role, vendor, route, effort, fallbacks, and the states each agent handles; provider sets and the active set; per-state seat overrides |
| `lifecycle/tasks/id-scheme.yml` | table | scope directory to id prefix |
| `lifecycle/artifact-contract.yml` | work items | the REQ, TC, PL, and review headings, labels, budgets, enumerations, and the implementation lexicon the lint reads |
| `lifecycle/standards/*.md`, `lifecycle/GUIDE.md` | orchestrator scaffold | the human-readable standards and handbook; `standards/briefs.md` is also machine-read as the role briefs |
| `lifecycle/tasks/**` | work items | the artifacts: `features/<scope>/REQ-*`, `test-cases/<scope>/TC-*`, `bugs/<scope>/BUG-*`, `reviews/<scope>/RV-*`, `plans/<scope>/PL-*`, and `archive/done`, `archive/superseded` for finished REQs |

## The service and its consumers

`ctx.lifecycle` reads a Session's working directory afresh on every call: `load(cwd)` returns the four tables or every problem, `graph(cwd)` the artifact graph, `lint(cwd, reqId?)` the violations of the tree or of one REQ's family, `checkIn(cwd, request)` the three hard-stop checks, `legalTransitions(cwd, reqId)` what the current owner may take, `status(cwd, reqId?)` the report the tools render, `briefs(cwd)` the parsed role briefs with the banned-phrase scan over briefs and registry notes, `transition(cwd, request)` one transition or lifecycle event applied through the table's effects and judged as a complete step, and `run(agent, request, signal)` the driver that carries one REQ through fresh role children.

The model sees `lifecycle_init`, `lifecycle_status`, `lifecycle_check_in`, `lifecycle_lint`, `lifecycle_transition`, and `lifecycle_run`, and, in a Session whose working directory carries `lifecycle.yml`, the `lifecycle:policy` section at prompt order 700; role children see the three read-only tools and their brief. Users get `/lifecycle status [REQ-ID] | lint [REQ-ID] | transition REQ-ID TNN summary…` when a command registry is composed; human-decided transitions are applied only there. Every `lifecycle_lint` run appends a `lifecycle/lint` event to the calling Session; every applied step appends `lifecycle/transition`; a run appends `lifecycle/step` around each role child and `lifecycle/human-decision` around each question to the human. All four are log-only: a resumed driver re-reads the files.

One run step re-reads the tree, stops on `done` or `blocked`, stops `lint-red` when the REQ family is red, and otherwise acts for the owner. A human owner is offered the legal transitions through `userQuestions` (`needs-human` when nobody answers or the answer is Stop). A role owner gets a fresh one-shot child from the configured subagent provider, seated by the registry: the route and per-state effort as `agentOptions`, delegation tools and the orchestrator's writing tools denied, depth capped, and the rendered brief as its first message. The child hands back a proposal (structured output or the last fenced JSON block) naming a transition or event, a summary, decisions, and a pull-request number, or a `needsHuman` question that pauses the run with `needs-human`. The driver diffs the tree against the child's write scope (the artifact kinds its role writes at that state, bound to the REQ), judges the proposal's guards on the pre-step tree, plans and writes the effects atomically, moves a REQ that reached `done` to `tasks/archive/done/`, judges the step as a whole, lints the family, and logs the transition; a rejected or failed step restores every byte under the lifecycle directory (the tables, standards, and briefs included, which a child may never write) and stops the run; a run owns the workspace until it ends. A tool guard keyed by the driver Session refuses out-of-scope `write`, `edit`, and `str_replace_editor` calls while the step runs; the diff is the enforcement of record for shell and product-native writes.

The returned records are the orchestrator's `LifecycleLoad`, `LintReport`, `CheckInRequest` and `CheckInResult`, `LegalTransition`, `LifecycleStatus`, `TransitionRequest` and `TransitionResult`, `RunRequest`, `RunResult`, and `PendingHuman`, and `Briefs` types, and the work-items `ArtifactGraph`; each is a plain object computed from the files in that call and holds no handle to them.

## The three checks

Before any role works on a REQ: C1, the REQ file exists; C2, the caller's uid is the REQ's `owner`; C3, the REQ's `status` is the state the caller intends to work in and one the caller's registration handles. A transition the table marks `exempt_from_hard_stop` (the human's T19 recall) passes C2 and C3 for its actor role; T15 is taken by the current owner; regression runs and BUG fix and verify hand-overs while a REQ is blocked do not check in.

## Failure codes

| Code | Meaning |
|---|---|
| `NO_WORKSPACE` | the calling Session has no working directory |
| `TABLES_INVALID` | a table file is missing or did not load; the problems are listed |
| `UNKNOWN_REQ`, `UNKNOWN_TRANSITION`, `NO_BRIEF` | the named REQ, transition id, or role × state does not exist |
| `NO_ROUTE` | `lifecycle_init` found no model route to seat the roles, or a product route advertises no models |
| `INVALID_SCOPE` | a scope prefix is not 1 to 6 uppercase letters |
| `INVALID_REQUEST` | a step names neither or both of transition and event, its summary is blank, or `maxSteps` is not a positive integer |
| `DELEGATED_CALLER` | a role child called `lifecycle_transition` or `lifecycle_run`; children hand back proposals instead |
| `NO_PROVIDER` | the configured `subagentProvider` is not registered |
| `RUN_IN_PROGRESS` | another run or hand-applied transition owns the workspace |
| `HUMAN_ACTOR` | the model asked `lifecycle_transition` to apply a transition the human decides; the human runs `/lifecycle transition` |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxlifecycle--lifecycleservice"></a>

### `ctx.lifecycle` — `LifecycleService`

The lifecycle service and its registrations. Every method reads the files under `<cwd>/<lifecycleDir>/` afresh; nothing is cached between calls.

```ts cordis-catalog
/**
 * Whether the working directory carries a lifecycle table.
 * @param cwd - the absolute workspace directory.
 * @returns `true` when `<cwd>/<dir>/lifecycle.yml` exists.
 */
hasTables(cwd: string): boolean

/**
 * Load the role briefs of a workspace from `<dir>/standards/briefs.md`,
 * checked against the table's role states and, with the registry's agent
 * notes, scanned for the phrases the prompting gates forbid.
 * @param cwd - the absolute workspace directory.
 * @returns the briefs, or every problem (the tables' problems first).
 */
briefs(cwd: string): { readonly briefs: Briefs | undefined; readonly problems: readonly string[] }

/**
 * Load the four tables of a workspace.
 * @param cwd - the absolute workspace directory.
 * @returns the tables, or every problem that prevented them.
 */
load(cwd: string): LifecycleLoad

/**
 * The artifact graph of a workspace.
 * @param cwd - the absolute workspace directory.
 * @returns the graph of `<dir>/tasks/`.
 * @throws `TABLES_INVALID` when the tables did not load.
 */
graph(cwd: string): ArtifactGraph

/**
 * Lint the workspace's artifacts.
 * @param cwd - the absolute workspace directory.
 * @param reqId - when given, keep only the violations of that REQ's files.
 * @returns the violations and their count per rule.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
lint(cwd: string, reqId?: string): LintReport

/**
 * Run the hard-stop checks for one caller on one REQ.
 * @param cwd - the absolute workspace directory.
 * @param request - who checks in, on which REQ, in which state, for which transition.
 * @returns the three checks and the verdict.
 * @throws `TABLES_INVALID` or `UNKNOWN_TRANSITION`.
 */
checkIn(cwd: string, request: CheckInRequest): CheckInResult

/**
 * The transitions the current owner of a REQ may take.
 * @param cwd - the absolute workspace directory.
 * @param reqId - the REQ.
 * @returns the transitions in table order.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
legalTransitions(cwd: string, reqId: string): LegalTransition[]

/**
 * Apply one transition or lifecycle event to a REQ by hand: guards judged
 * on the current tree, effects written atomically, the step and the REQ
 * family linted, and every file restored when the result is red.
 * @param cwd - the absolute workspace directory.
 * @param request - the REQ, the step, the summary, and the decisions.
 * @returns what was applied, or the violations with nothing written.
 */
transition(cwd: string, request: TransitionRequest): Promise<TransitionResult>

/**
 * Drive one REQ through fresh role children from the agent's Session
 * working directory, logging every step, transition, and human decision
 * to the agent's Session.
 * @param agent - the root agent that drives; its Session must have a working directory.
 * @param request - the REQ and the optional step ceiling.
 * @param signal - abort cancels the running child and ends the run.
 * @returns the run report.
 * @throws LifecycleError `NO_WORKSPACE` without a working directory, `RUN_IN_PROGRESS` while another run or transition owns
 * the workspace; the driver's own codes otherwise.
 */
async run(agent: Agent, request: RunRequest, signal: AbortSignal): Promise<RunResult>

/**
 * The lifecycle position of one REQ or of every REQ.
 * @param cwd - the absolute workspace directory.
 * @param reqId - when given, report that REQ only.
 * @returns the report.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
status(cwd: string, reqId?: string): LifecycleStatus
```

Types: [Agent](core.md)

Source: [`packages/experimental/lifecycle-orchestrator/src/index.ts`](../../packages/experimental/lifecycle-orchestrator/src/index.ts)
<!-- END GENERATED cordis-surface -->
