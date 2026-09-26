# Lifecycle team

English | [中文](lifecycle-team.zh.md)

The lifecycle team runs a requirement through a fixed state machine with three role agents, a Planner, a Generator, and an Evaluator, and a human orchestrator. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) are Markdown files under a workspace's `lifecycle/tasks/` directory, their states and owners live in frontmatter, and every move between states is one of the transitions a YAML table registers with guards, effects, and the fields it may change. The [design note](../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.md) owns the decision record; this page records the shared vocabulary and the wiring.

## Packages

| Package | Role |
|---|---|
| [`dsh-experimental-lifecycle-table`](../../packages/experimental/lifecycle-table/README.md) | Loads and validates `lifecycle.yml`, `agent-registry.yml`, and `tasks/id-scheme.yml`, and derives role states, required review gates, reachable states, and the lifecycle-sensitive kinds |
| [`dsh-experimental-lifecycle-work-items`](../../packages/experimental/lifecycle-work-items/README.md) | Parses the artifacts into a graph, loads `artifact-contract.yml`, lints the graph, judges a step against the table's guards and effects, plans effect edits, and writes them atomically |
| [`dsh-experimental-lifecycle-orchestrator`](../../packages/experimental/lifecycle-orchestrator/README.md) | The `ctx.lifecycle` service, the `lifecycle_*` tools, the `/lifecycle` command, the `lifecycle:policy` prompt section, the role briefs, and the English defaults `lifecycle_init` scaffolds |

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

`ctx.lifecycle` reads a Session's working directory afresh on every call: `load(cwd)` returns the four tables or every problem, `graph(cwd)` the artifact graph, `lint(cwd, reqId?)` the violations of the tree or of one REQ's family, `checkIn(cwd, request)` the three hard-stop checks, `legalTransitions(cwd, reqId)` what the current owner may take, `status(cwd, reqId?)` the report the tools render, and `briefs(cwd)` the parsed role briefs with the banned-phrase scan over briefs and registry notes.

The model sees `lifecycle_init`, `lifecycle_status`, `lifecycle_check_in`, and `lifecycle_lint`, and, in a Session whose working directory carries `lifecycle.yml`, the `lifecycle:policy` section at prompt order 700. Users get `/lifecycle status [REQ-ID] | lint [REQ-ID]` when a command registry is composed. Every `lifecycle_lint` run appends a `lifecycle/lint` event to the calling Session.

The returned records are the orchestrator's `LifecycleLoad`, `LintReport`, `CheckInRequest` and `CheckInResult`, `LegalTransition`, `LifecycleStatus`, and `Briefs` types, and the work-items `ArtifactGraph`; each is a plain object computed from the files in that call and holds no handle to them.

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
 * The lifecycle position of one REQ or of every REQ.
 * @param cwd - the absolute workspace directory.
 * @param reqId - when given, report that REQ only.
 * @returns the report.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
status(cwd: string, reqId?: string): LifecycleStatus
```

Source: [`packages/experimental/lifecycle-orchestrator/src/index.ts`](../../packages/experimental/lifecycle-orchestrator/src/index.ts)
<!-- END GENERATED cordis-surface -->
