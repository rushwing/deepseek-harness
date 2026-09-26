---
description: "Lifecycle team orchestrator for users and maintainers: the ctx.lifecycle service that reads a workspace's lifecycle tables and artifacts and drives a REQ through fresh role children, the lifecycle_init, lifecycle_status, lifecycle_check_in, lifecycle_lint, lifecycle_transition, and lifecycle_run tools, the /lifecycle command, the lifecycle:policy prompt section, the write guard, the role briefs, and the English defaults the scaffold writes."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-lifecycle-orchestrator

English | [中文](README.zh.md)

## Summary

This plugin gives a Session the lifecycle team. `ctx.lifecycle` loads the tables and artifacts under the Session working directory's `lifecycle/` directory, lints them, lists the transitions a REQ's owner may take, applies a transition or lifecycle event through the table's effects, and drives a REQ through fresh role children whose edits are fenced to their own artifacts and whose transition proposals it judges, applies, and lints. Models reach it through six `lifecycle_*` tools and the `lifecycle:policy` section; users through `/lifecycle`. Every step, transition, and human decision is a log-only Session event; the files stay the only truth.

## Table of Contents

- [Use this plugin](#use-this-plugin)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-plugin"></a>
## Use this plugin

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `lifecycleDir` | `lifecycle` | The directory, relative to the Session's working directory, that holds `lifecycle.yml`, `agent-registry.yml`, `artifact-contract.yml`, `tasks/`, and `standards/`. A blank value fails at load. |
| `maxStepsPerRun` | `8` | The most steps one `lifecycle_run` takes; a call's `maxSteps` may only lower it. |
| `delegationToolNames` | `subagent`, `subagent_fork`, `workflow`, `ralph`, `spawn_teammate`, `send_message`, `interrupt_agent` | Tools denied to role children so a child never delegates; the orchestrator's own `lifecycle_run`, `lifecycle_transition`, and `lifecycle_init` are always denied too. Names a deployment does not compose are left out of the restriction, which refuses unknown tools. A blank name fails at load. |
| `humanDecisions` | `ask` | `ask` puts a human-owned REQ's legal transitions to the `userQuestions` service when it is composed and answers, else stops with `needs-human`; `stop` never asks. |
| `stepTimeoutMs` | `1800000` | A role child is aborted after this long; the step fails and nothing is applied. |
| `proposalChannel` | `auto` | `auto` requests structured output from providers that support it and otherwise reads the last fenced ```json block of the child's final text; `text` always reads the text. |
| `subagentProvider` | `spawn` | The subagent provider that runs role children; an unregistered name fails at the first run with `NO_PROVIDER`. |

The plugin injects `tools`, `systemPrompt`, and `subagents`; it registers `/lifecycle` only when a `commands` service is composed, `lifecycle_init` reads `llm` and `agentDefaultModel` opportunistically at execution time, and `lifecycle_run` reads `userQuestions` the same way.

### Scaffold a workspace

`lifecycle_init` writes the English defaults under `<cwd>/<lifecycleDir>/` and keeps every file that already exists: `lifecycle.yml` (the version 2 table), `agent-registry.yml`, `artifact-contract.yml`, and `tasks/id-scheme.yml` (scopes from the `scopes` argument, `{ core: CORE }` by default; a prefix is 1 to 6 uppercase letters). `scaffold: full` adds `GUIDE.md`, the five standards, and `standards/briefs.md`. The registry seats the roles on the routes the deployment has: when `claude-code` and `codex` routes both advertise models, a cross-vendor set (`mixed`, Planner and Generator on Claude Code, Evaluator on Codex, `tc_impl_review` seated on the same-vendor Evaluator) with same-vendor fallback sets; otherwise a same-vendor set on the agent default model. Model names come from the routes' catalogs or the default selection, never from a guess; a route without models or a deployment without any route fails with `NO_ROUTE`.

### Read, move, and drive a workspace

- `lifecycle_status { reqId? }` reports one REQ or every REQ: status, owner and owner role, review round, `tc_policy`, the blocked fields, the seat that acts next, and the transitions the current owner may take (T16's restore slots resolved from the recorded pair).
- `lifecycle_check_in { reqId, uid, state, transition? }` runs the three checks: C1 the REQ file exists, C2 the uid is its owner, C3 the REQ is in `state` and the uid's registration handles it. A transition the table marks `exempt_from_hard_stop` passes C2 and C3 for its actor role.
- `lifecycle_lint { reqId? }` lints the whole tree or one REQ's family (the REQ, its TCs, RV, PL, and the BUGs it carries or that block it) and appends a `lifecycle/lint` event with the counts.
- `lifecycle_transition { reqId, transition? | event?, summary, decisions?, pr? }` applies one transition (such as `T01`) or lifecycle event (such as `bug_fix`) by hand: the guards are judged on the current tree, the effects rewrite the REQ frontmatter and the TC and BUG statuses in scope atomically, a REQ that reaches `done` moves to `tasks/archive/done/`, and the result is judged as a complete step and linted within the REQ's family. A red result restores every byte and returns the violations; an applied one returns the files, the owner after, and the suggested commit subject `lifecycle: <id> — <summary>`. The human commits. A transition the human decides (actor `human`, such as `T01` or `T14`) is refused to the model with `HUMAN_ACTOR`; the human applies it with `/lifecycle transition REQ-ID TNN summary…`, which logs the same event.
- `lifecycle_run { reqId, maxSteps? }` drives a REQ: each step re-reads the tree, stops on `done` or `blocked`, stops `lint-red` when the family is red, and otherwise acts for the owner. A human owner is asked which legal transition applies (`needs-human` when nobody can answer or the human answers Stop); a role owner gets a fresh one-shot child seated by the registry (`agentOptions` from its route and per-state effort, delegation tools denied, depth capped, its brief as the first message) whose hand-over is a transition proposal. The child's edits are diffed against its write scope, the proposal is judged and applied like `lifecycle_transition`, and a rejected or failed step restores every file under the lifecycle directory and stops the run; a throw while judging the child fails the step the same way. A child may instead hand over `{ "needsHuman": true, "question": "…" }`: the run pauses with `needs-human`, the question in `pendingHuman`, and the child's in-scope edits kept. The result lists every step with its uid, state, transition, and outcome, the stop reason (`done`, `blocked`, `needs-human`, `rejected`, `lint-red`, `max-steps`, `failed`), the pending human decision, and the violations.
- `/lifecycle status [REQ-ID]`, `/lifecycle lint [REQ-ID]`, and `/lifecycle transition REQ-ID TNN summary…` render the same reports and apply a transition for a user; any other input answers with the usage line.

Every call reads the files afresh. A Session without a working directory fails with `NO_WORKSPACE`; tables that do not load fail with `TABLES_INVALID` and list every problem; an unknown REQ or transition fails with `UNKNOWN_REQ` or `UNKNOWN_TRANSITION`; a request naming neither or both of transition and event, a blank summary, or a non-positive `maxSteps` fails with `INVALID_REQUEST`; `lifecycle_transition` and `lifecycle_run` called by a delegated child fail with `DELEGATED_CALLER`; a second run or hand-applied transition while one owns the workspace fails with `RUN_IN_PROGRESS`; a human-decided transition requested by the model fails with `HUMAN_ACTOR`.

### Write scopes

A role child may create or edit only artifacts of the REQ it works on, and only the kinds its role writes at that state: the Planner at `req_review` writes the REQ and its PL; the Evaluator writes the RV and new BUGs at `req_review`, `tc_impl_review`, and `req_impl_review`, and the REQ's TCs plus the REQ (its `test_case_ref`) at `tc_design`; the Generator writes the RV at `tc_review`, the TCs at `tc_impl`, and BUGs and TCs at `req_impl`. Archived artifacts, the tables, the standards, and the briefs are never written: every path under the lifecycle directory outside `tasks/` is denied and diffed; files outside the lifecycle directory (product code, tests) are not fenced. Two mechanisms enforce the scope: a tool guard refuses `write`, `edit`, and `str_replace_editor` calls whose target lies in the tree outside the scope while the step runs, keyed by the driver Session so children are fenced before they exist; and the post-step diff rejects the step and restores every file when anything outside the scope changed or a new BUG does not name the REQ. The diff is the only enforcement for shell writes and for product-backend children whose native tools bypass the harness.

### Briefs

`ctx.lifecycle.briefs(cwd)` parses `<lifecycleDir>/standards/briefs.md`: one `## <role> @ <state>` section per non-human role × state the table derives, each with the eight fields `When to use`, `Three checks before starting`, `What to read`, `What to write and where`, `Writing style`, `Checklist`, `Prohibited`, and `Deliverable`, plus the shared sections `Review checklist`, `Blocking and release (T15 / T16)`, `Deferred verification (regression runs for integration TCs lacking samples)`, and `General prohibitions`. A missing field or section, a section for a state the role does not work in, or a banned phrase in a brief or in a registry agent's `notes` is a problem. `renderBrief(briefs, request)` assembles a role child's first message: the header naming the uid, REQ, and state, the intro, the eight fields, the hand-over (the frontmatter fields the role must not touch, the legal transitions, and the fenced JSON proposal it ends with), the shared sections the brief cites, the general prohibitions, and the registry notes.

The banned phrases are the ones the prompting gates forbid: `only report high-severity`, `be conservative`, `don't nitpick`, `double-check your answer`, and `one more verification pass`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the plugin is split; the observable behavior lives in [Use this plugin](#use-this-plugin).

### Design concept

- **Files are the only truth.** Every method re-reads the working directory; nothing is cached across calls, so a resumed Session sees what is on disk.
- **The libraries judge, the plugin exposes.** Loading, linting, and predicates live in `lifecycle-table` and `lifecycle-work-items`; this package adds the Session-facing surface, the briefs, and the scaffold.
- **Roles propose, the orchestrator applies.** The briefs tell a role child never to move frontmatter states; the hand-over is a transition proposal (structured output or the last fenced JSON block) that the driver judges against the table, applies, and lints; a red result restores every byte the step touched.
- **Fence twice.** The tool guard refuses out-of-scope writes while the step runs; the post-step diff catches what bypassed the tools and is the enforcement of record.
- **Fail loud, write nothing.** Missing or invalid tables, unknown ids, and unseatable roles are errors with stable codes; `lifecycle_init` plans every file before writing and writes only files that do not exist.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `LifecycleService` (`ctx.lifecycle`), Config, tool and section registration, the `/lifecycle` command |
| [`src/workspace.ts`](src/workspace.ts) | Loading the four tables, the graph, the lint scope, the check-in, legal transitions, and the status report |
| [`src/tools.ts`](src/tools.ts), [`src/tools/init.ts`](src/tools/init.ts) | The three read-only tools; the scaffold and its registry planner |
| [`src/tools/transition.ts`](src/tools/transition.ts), [`src/tools/run.ts`](src/tools/run.ts) | The hand-applied step and the driver's tool, both root-only |
| [`src/driver.ts`](src/driver.ts) | The run loop: human decisions, fresh role children, proposals, scope diff, apply, rollback |
| [`src/scope.ts`](src/scope.ts), [`src/write-guard.ts`](src/write-guard.ts), [`src/tree.ts`](src/tree.ts) | Write scopes and their judgement; the tool guard; tree snapshots, diff, and restoration |
| [`src/proposal.ts`](src/proposal.ts), [`src/human.ts`](src/human.ts) | The proposal schema and parser; the question to the human |
| [`src/briefs/parse.ts`](src/briefs/parse.ts), [`src/briefs/render.ts`](src/briefs/render.ts) | The briefs format and banned-phrase scan; the rendered first message |
| [`src/render.ts`](src/render.ts), [`src/section.ts`](src/section.ts) | Tool and command text; the policy section |
| [`src/defaults/`](src/defaults/) | The English table, contract, standards, handbook, and briefs the scaffold writes |
| [`src/events.ts`](src/events.ts), [`src/errors.ts`](src/errors.ts) | The `lifecycle/lint` event; `LifecycleError` and its codes |
| — | No runtime invariant companion is published; the service keeps no state, and every relation it reports is decided in one call over the files. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the tool contracts are not enough. They move from this plugin to the libraries it exposes and the team design it serves.

- [Lifecycle team](../../../docs/subsystems/lifecycle-team.md) — the workspace files, the service, the three checks, and the failure codes.
- [Lifecycle table](../lifecycle-table/README.md) and [lifecycle work items](../lifecycle-work-items/README.md) — the loaders, rules, and predicates behind every report.
- [Lifecycle team design](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.md) — the decision record.

-----

<a id="model-experience"></a>
## Model Experience

### Lifecycle policy system prompt

#### What the model sees

In a Session whose working directory carries `<lifecycleDir>/lifecycle.yml`, the model sees the `lifecycle:policy` section at first-party prompt order 700; other Sessions see nothing. Role children see the same section plus their brief as the first user message.

##### Verbatim text for this field, with `lifecycle` as the directory

```markdown
This workspace runs the lifecycle team process from `lifecycle/`. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) live under `lifecycle/tasks/`; their standards live under `lifecycle/standards/`. Use `lifecycle_status` to read a REQ's state, owner, and legal transitions, `lifecycle_check_in` before working on a REQ as a role, and `lifecycle_lint` before handing artifacts over. Never edit `status`, `owner`, `review_round`, `pending_bugs`, or the `blocked_*` frontmatter fields by hand: lifecycle transitions move them. Use `lifecycle_run` only when asked to drive a REQ; it spawns one role child per step and applies the proposed transitions. `lifecycle_transition` applies one transition or lifecycle event the human decided.
```

#### Token effect

One paragraph of five fixed sentences on every request of a lifecycle workspace; zero elsewhere.

#### KV Cache effect

The section is stable for a workspace; creating or removing the table changes the prompt from order 700 onward.

### Lifecycle tool schemas

#### What the model sees

The generated [six `lifecycle_*` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-lifecycle-orchestrator); role children see `lifecycle_status`, `lifecycle_check_in`, and `lifecycle_lint` only. Results render as one status line per REQ (`REQ-PLAT-010: draft, owner human-001 (human), seat human-001; legal transitions T01, T19`), a check-in verdict naming every failed check, a lint verdict followed by one `- file [rule]: message` line per violation, the scaffold's created and kept counts, `Applied T01 on REQ-PLAT-010: draft → req_review, owner planner-001. Commit subject: lifecycle: T01 — Start the review` or `Rejected T14 on REQ-PLAT-010: 1 violation` with one line per violation, and a run header `Lifecycle run on REQ-PLAT-010 stopped: done after 10 steps` followed by one `- uid @ state: transition outcome` line per step.

#### Token effect

Fixed schema cost where the tools are visible; a lint or rejection result grows with the violations, a status result with the REQs reported, a run result with the steps taken. Each role child is a fresh Session that pays for its brief once.

#### KV Cache effect

The schemas are stable; results extend the conversation normally.

### Human command

#### What the model sees

`/lifecycle` and its results stay outside model history.

#### Token effect

No tokens: the command and its report never enter a request.

#### KV Cache effect

No effect: the prompt and the conversation are unchanged by the command.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the read-only surface does not do. They are current package constraints, not a task backlog.

- **Write scopes live in code** — the kinds each role writes at each state mirror the briefs but are a fixed table in `src/scope.ts`, not workspace data; a team that changes the briefs' "What to write and where" edits this package.
- **Product-backend children are fenced by the diff only** — `codex` and `claude-code` routes run native tools that bypass the harness tool guard, so their out-of-scope edits are caught and rolled back after the step, not refused during it; shell writes by any child are the same.
- **One step at a time per driver Session** — the guard fences all children of the driving Session for the current step; two concurrent `lifecycle_run` calls in one Session share one fence.
- **Only the REQ file is archived** — a REQ that reaches `done` moves to `tasks/archive/done/`; its TCs, RV, and PL stay in their live directories, as the lint expects.
- **Human decisions choose a transition only** — the human picks one legal transition id or Stop; transitions that need decisions (such as `T15`'s blocking fields) are proposed by the current owner's child or applied by hand through `lifecycle_transition`.
- **A run owns the workspace** — while a step runs, every change under the lifecycle directory is attributed to the child and rolled back with a rejected step, so a human editing artifacts during a run loses that edit; concurrent runs and hand-applied transitions in the same process are refused with `RUN_IN_PROGRESS`, other processes are not.
- **Vendor separation is not preserved under fallback** — a cross-vendor registry lists another vendor's route as the last fallback, and the model fallback hops to it without checking that the Generator and the Evaluator still sit on different vendors.
- **One lifecycle directory per Session** — the directory is a plugin-wide setting; two workspaces with different layouts need two deployments.
- **Scaffold routes are product-shaped** — `lifecycle_init` recognises `claude-code` and `codex` routes for a cross-vendor set with the efforts those products advertise, and seats everything else on the default model without an effort, so the adapter default applies; an effort is validated against its route when a step first resolves it, not at scaffold time.
- **English defaults only** — the scaffold writes the English table, contract, standards, and briefs; a team translates or edits them in the workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The defaults under `src/defaults/` are the translated factory-tools documents; `briefs.ts` rewrites the hand-over so a role proposes a transition instead of committing one, and the Codex CLI invocation contract of the original is not carried because routes replace it. The fixture workspace under `tests/fixtures/workspace/` is the lifecycle-work-items fixture plus the default briefs; its registry notes avoid quoting banned phrases. The driver tests play role children through a scripted subagent provider (`tests/driver-helper.ts`) that edits the workspace and hands back proposals, and answer the human through a scripted `userQuestions` service; the happy path carries REQ-PLAT-010 from draft to done in ten steps. The driver acts as the REQ owner, so the hard-stop checks hold by construction after the family lint; `lifecycle_check_in` remains the tool a role calls for itself.

</details>

**Runtime invariant:** No companion is published. The service keeps no state; every report is computed from the files at call time.
