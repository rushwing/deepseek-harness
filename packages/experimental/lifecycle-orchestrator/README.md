---
description: "Lifecycle team orchestrator for users and maintainers: the ctx.lifecycle service that reads a workspace's lifecycle tables and artifacts, the lifecycle_init, lifecycle_status, lifecycle_check_in, and lifecycle_lint tools, the /lifecycle command, the lifecycle:policy prompt section, the role briefs, and the English defaults the scaffold writes."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-lifecycle-orchestrator

English | [中文](README.zh.md)

## Summary

This plugin gives a Session the lifecycle team's read-only surface. `ctx.lifecycle` loads the tables and artifacts under the Session working directory's `lifecycle/` directory, lints them, runs the three hard-stop checks a role passes before working on a requirement (REQ), lists the transitions its current owner may take, and parses the role briefs. Models reach it through `lifecycle_init`, `lifecycle_status`, `lifecycle_check_in`, and `lifecycle_lint`, plus the `lifecycle:policy` section in lifecycle workspaces; users through `/lifecycle`. It writes nothing except the scaffold `lifecycle_init` creates and the `lifecycle/lint` event each lint run logs.

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

The plugin injects `tools` and `systemPrompt`; it registers `/lifecycle` only when a `commands` service is composed, and `lifecycle_init` reads `llm` and `agentDefaultModel` opportunistically at execution time.

### Scaffold a workspace

`lifecycle_init` writes the English defaults under `<cwd>/<lifecycleDir>/` and keeps every file that already exists: `lifecycle.yml` (the version 2 table), `agent-registry.yml`, `artifact-contract.yml`, and `tasks/id-scheme.yml` (scopes from the `scopes` argument, `{ core: CORE }` by default; a prefix is 1 to 6 uppercase letters). `scaffold: full` adds `GUIDE.md`, the five standards, and `standards/briefs.md`. The registry seats the roles on the routes the deployment has: when `claude-code` and `codex` routes both advertise models, a cross-vendor set (`mixed`, Planner and Generator on Claude Code, Evaluator on Codex, `tc_impl_review` seated on the same-vendor Evaluator) with same-vendor fallback sets; otherwise a same-vendor set on the agent default model. Model names come from the routes' catalogs or the default selection, never from a guess; a route without models or a deployment without any route fails with `NO_ROUTE`.

### Read a workspace

- `lifecycle_status { reqId? }` reports one REQ or every REQ: status, owner and owner role, review round, `tc_policy`, the blocked fields, the seat that acts next, and the transitions the current owner may take (T16's restore slots resolved from the recorded pair).
- `lifecycle_check_in { reqId, uid, state, transition? }` runs the three checks: C1 the REQ file exists, C2 the uid is its owner, C3 the REQ is in `state` and the uid's registration handles it. A transition the table marks `exempt_from_hard_stop` passes C2 and C3 for its actor role.
- `lifecycle_lint { reqId? }` lints the whole tree or one REQ's family (the REQ, its TCs, RV, PL, and the BUGs it carries or that block it) and appends a `lifecycle/lint` event with the counts.
- `/lifecycle status [REQ-ID]` and `/lifecycle lint [REQ-ID]` render the same reports for a user; any other input answers with the usage line.

Every call reads the files afresh. A Session without a working directory fails with `NO_WORKSPACE`; tables that do not load fail with `TABLES_INVALID` and list every problem; an unknown REQ or transition fails with `UNKNOWN_REQ` or `UNKNOWN_TRANSITION`.

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
- **Roles propose, the orchestrator applies.** The briefs tell a role child never to move frontmatter states; the hand-over asks for a transition proposal that the driver applies and lints.
- **Fail loud, write nothing.** Missing or invalid tables, unknown ids, and unseatable roles are errors with stable codes; `lifecycle_init` plans every file before writing and writes only files that do not exist.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `LifecycleService` (`ctx.lifecycle`), Config, tool and section registration, the `/lifecycle` command |
| [`src/workspace.ts`](src/workspace.ts) | Loading the four tables, the graph, the lint scope, the check-in, legal transitions, and the status report |
| [`src/tools.ts`](src/tools.ts), [`src/tools/init.ts`](src/tools/init.ts) | The three read-only tools; the scaffold and its registry planner |
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

In a Session whose working directory carries `<lifecycleDir>/lifecycle.yml`, the model sees the `lifecycle:policy` section at first-party prompt order 700; other Sessions see nothing.

##### Verbatim text for this field, with `lifecycle` as the directory

```markdown
This workspace runs the lifecycle team process from `lifecycle/`. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) live under `lifecycle/tasks/`; their standards live under `lifecycle/standards/`.
Use `lifecycle_status` to read a REQ's state, owner, and legal transitions, `lifecycle_check_in` before working on a REQ as a role, and `lifecycle_lint` before handing artifacts over.
Never edit `status`, `owner`, `review_round`, `pending_bugs`, or the `blocked_*` frontmatter fields by hand: lifecycle transitions move them.
```

#### Token effect

Three fixed sentences on every request of a lifecycle workspace; zero elsewhere.

#### KV Cache effect

The section is stable for a workspace; creating or removing the table changes the prompt from order 700 onward.

### Lifecycle tool schemas

#### What the model sees

The generated [`lifecycle_init`, `lifecycle_status`, `lifecycle_check_in`, and `lifecycle_lint` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-experimental-lifecycle-orchestrator). Results render as one status line per REQ (`REQ-PLAT-010: draft, owner human-001 (human), seat human-001; legal transitions T01, T19`), a check-in verdict naming every failed check, a lint verdict followed by one `- file [rule]: message` line per violation, and the scaffold's created and kept counts.

#### Token effect

Fixed schema cost where the tools are visible; a lint result grows with the violations, a status result with the REQs reported.

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

- **No driver yet** — nothing spawns role children or applies transitions; the briefs render and the predicates judge, but `lifecycle_run` and `lifecycle_transition` are not registered.
- **One lifecycle directory per Session** — the directory is a plugin-wide setting; two workspaces with different layouts need two deployments.
- **Scaffold routes are product-shaped** — `lifecycle_init` recognises `claude-code` and `codex` routes for a cross-vendor set and seats everything else on the default model with `effort: high`; efforts are validated against the route when a step first resolves it, not at scaffold time.
- **English defaults only** — the scaffold writes the English table, contract, standards, and briefs; a team translates or edits them in the workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The defaults under `src/defaults/` are the translated factory-tools documents; `briefs.ts` rewrites the hand-over so a role proposes a transition instead of committing one, and the Codex CLI invocation contract of the original is not carried because routes replace it. The fixture workspace under `tests/fixtures/workspace/` is the lifecycle-work-items fixture plus the default briefs; its registry notes avoid quoting banned phrases.

</details>

**Runtime invariant:** No companion is published. The service keeps no state; every report is computed from the files at call time.
