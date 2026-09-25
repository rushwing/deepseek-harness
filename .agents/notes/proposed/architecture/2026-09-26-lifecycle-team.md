# Agent Note: Lifecycle team

Status: proposed

English | [中文](2026-09-26-lifecycle-team.zh.md)

## Problem

The `NVIDIA-dev/factory-tools` repository develops itself with a document-driven method: requirements, test cases, bugs, review records, and design plans are Markdown files with YAML frontmatter, and work moves by file state (`status` and `owner`) rather than by conversation memory. Three model roles do the work under a human orchestrator: a Planner shapes the requirement, a Generator implements test and product code, and an Evaluator writes the acceptance tests and reviews every stage. A registry binds each role to a model, a reasoning effort, and fallbacks; a lifecycle table declares the states, the 21 transitions with their guards and effects, and the human-only transitions; role briefs say what each role reads, writes, and delivers in each state; Python gates lint the artifacts.

Today that team runs as a Claude Code session that spawns one subagent per role and calls Codex through its CLI, with the whole method written in Chinese and tied to one repository. dsh has the pieces the method needs — a subagent runtime with per-child routes and personas, human approval and question services, durable Session events, filesystem tools — but no lifecycle concept, no per-role registry, and no model fallback. The user wants the team available to any dsh workspace as a product feature, in English, with role agents running on the Codex and Claude Code routes that the [conversation-backend Agent Note](2026-09-26-external-agent-conversation-backends.md) adds.

## Proposal

Ship the method as five experimental packages named **lifecycle** (the source name "harness" collides with the product name), composed by one optional bundle.

Files under `<workspace>/lifecycle/` remain the only truth: `lifecycle.yml` (the state table), `agent-registry.yml` (roles, agents, provider sets, seats), `tasks/id-scheme.yml`, `artifact-contract.yml` (English headings, budgets, acceptance-criterion format, forbidden implementation lexicon, review fields), `standards/*.md`, and `tasks/{features,test-cases,bugs,reviews,plans}/<scope>/`. A `lifecycle_init` tool scaffolds them in English and writes a registry whose routes come from the providers the profile actually registers.

A deterministic driver runs one lifecycle step at a time. It loads and validates the four YAML files, parses the work items into a graph, lints it, reads the requirement's `status` and `owner`, derives the owner role and the legal transitions from the table, and either asks the human (through `ctx.userQuestions`) when the owner role is `human` or spawns one fresh one-shot child for the seated role through `ctx.subagents.start` with the registry's route, model, and reasoning effort, the rendered English brief as its prompt, delegation tools denied, and depth capped. The child edits only its own artifacts and returns a transition proposal; the driver diffs the workspace against the role's write scope, evaluates the transition's guards against the pre-step graph, applies its effects atomically, re-lints, and appends `lifecycle/transition`. Any violation rolls the step back. Without an answerer the driver stops with `needs-human` and writes nothing; it never approves on the human's behalf. Each applied transition carries a suggested commit subject; the human commits.

Six tools expose the method: `lifecycle_init`, `lifecycle_status`, `lifecycle_check_in` (the hard-stop checks: the requirement exists, the caller owns it, its status is legal for the role), `lifecycle_lint`, `lifecycle_transition` (the manual and human path), and `lifecycle_run` (drive up to N steps). Children see only the first four plus ordinary workspace tools. A `lifecycle-model-fallback` plugin walks a registry agent's fallbacks on `agent/request-error` and rewrites the route on `agent/request` for the labeled child, after `llm-retry` exhausts same-route retries.

### Package topology

| Package (`@deepseek-ai/dsh-experimental-…`) | Role | Depends on |
|---|---|---|
| `lifecycle-table` | Library: table types, loader with one problem per root cause, derivations (role legal states, required review gates, reachable states), registry loader and validation | `dsh-brand`, `yaml` |
| `lifecycle-work-items` | Library: frontmatter and body parser, artifact graph, contract loader, lint rule groups, guard and effect predicates, atomic effect writer with rollback | `lifecycle-table` |
| `lifecycle-orchestrator` | Service `ctx.lifecycle`, the six tools, `/lifecycle` command, briefs, write guard, session events, English defaults | `dsh-tools`, `dsh-subagent`, `dsh-fs`, `dsh-session`, both libraries |
| `lifecycle-model-fallback` | Loop policy plugin for registry fallbacks | `dsh-agent`, `dsh-llm`, `lifecycle-table` |
| `lifecycle-team-profile` | Optional bundle composing the four plugins and disabling the overlapping `ralph` tool | all of the above |

### Durable events

`lifecycle/step`, `lifecycle/transition`, `lifecycle/lint`, and `lifecycle/human-decision` join `SessionEventMap` as log-only events appended to the driver's Session. Files are the truth and replay is idempotent: a resumed driver re-reads the files and never re-applies from events.

### Separation invariants

The registry loader rejects one uid serving as both Generator and Evaluator, a cross-vendor set whose Generator and Evaluator share a vendor, `handles` that differ from the states the table derives for the role, and a seat whose uid has the wrong role. One uid runs one child per step with no downward delegation. A child may edit only the artifacts its role owns in its state; first-party write tools are guarded, and the post-step diff with rollback covers native product tools and shell writes.

### Artifact lints

The rule groups ported from the source gates are frontmatter, ownership, blocked fields, requirement body (seven ordered headings, budgets, acceptance-criterion format, pending-decision format, implementation lexicon), test cases, review records, lifecycle consistency, links, and table–registry consistency. Glossary and specification-mirror checks are deferred. The git commit-chain transition-evidence checker is not ported.

## Alternatives considered

**Adopt the method as this repository's development process instead of a product feature.** The repository already has its own process (Agent Notes, skills, gates); the user wants the team available to any workspace through dsh.

**Extend experimental Agent Teams.** Its roster has only lead and teammate roles without per-member routes or personas, it is lead-model-driven, and its task board is free-form, while the method is a closed state machine. Its journal-and-projection pattern and declared result schemas are copied.

**A model-driven lead agent with lifecycle tools.** Cheaper to build, but every guard and effect would depend on the lead's discipline; the deterministic driver enforces the table and keeps the model roles inside their briefs, as the `ralph` tool does for its fixed loop.

**Orchestrator-owned git commits.** Faithful to the source, but dsh would then own repository history and handle dirty trees and read-only `.git` sandboxes in v1; recording the transition and suggesting the subject keeps history with the human.

**Keep the source name "harness".** Tools named `harness_run` inside DeepSeek Harness read as operating the product itself.

**Port the transition-evidence checker.** It verifies PR commit chains in CI against the table; the user scoped it out, and the driver already validates every transition it applies.

## Acceptance criteria

- `lifecycle_init` in an empty workspace produces English files that `lifecycle_lint` accepts, with registry routes drawn from registered providers.
- A scripted role provider and a scripted human answerer drive one requirement from `draft` to `done` through the table's main chain, and a recorded headless snapshot captures the run.
- A child that edits another role's artifact, a proposal that fails a guard, and a lint-red result each roll the step back with nothing applied.
- Headless without an answerer stops with `needs-human` and writes nothing when the owner role is `human`.
- The registry loader rejects every separation-invariant violation with one named problem each.
- The fallback plugin switches a labeled child to its next route after the configured failure codes and leaves other agents untouched.

## Risks

**Children on product-backend routes.** Codex and Claude Code routes ignore dsh tool schemas, so their proposals arrive as trailing fenced JSON and write-scope enforcement is the post-step diff alone.

**Adapter-owned reasoning efforts.** Registry effort ids are validated against the route's advertised efforts at first resolve; a DeepSeek route without efforts must omit `effort`.

**Best-effort multi-file atomicity.** Effects write files one at a time with temp-and-rename and an in-memory rollback set; a crash mid-apply leaves a partial transition that the next lint reports.

**Human decisions need a runtime root.** `ctx.userQuestions.ask` fails closed from a child, so `lifecycle_run` is a root-agent tool by design.
