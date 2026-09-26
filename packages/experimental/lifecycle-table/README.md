---
description: "Lifecycle team tables: loads the lifecycle state table, the agent registry, and the work-item id scheme from YAML with one problem per root cause, and derives role states, required review gates, reachable states, and lifecycle-sensitive kinds so no consumer copies the table."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-lifecycle-table

English | [中文](README.zh.md)

## Summary

The lifecycle team moves requirements, test cases, and bugs through states that three YAML files under a workspace's `lifecycle/` directory declare: `lifecycle.yml` (states, roles, review gates, exits, the 21 transitions with their guards, effects, and `may_change` kinds, events, and predicates), `agent-registry.yml` (role seats bound to agents with routes, vendors, efforts, fallbacks, and handled states), and `tasks/id-scheme.yml` (scope prefixes). This library loads the three files, reports problems one per root cause, and derives the facts other lifecycle packages read instead of copying: role states, required review gates, reachable states, and the lifecycle-sensitive kinds. It registers nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Read a file's text, call its loader with the file label that should prefix every problem, and stop on problems: a loader returns either the loaded value with an empty problem list or no value with the complete list. The English fixtures under [`tests/fixtures/`](tests/fixtures/) are the reference documents.

### Load the lifecycle table

`loadLifecycleTable(text, label = 'lifecycle.yml')` returns `{ table, problems }`. A structural failure reports the first root cause only: invalid YAML, a non-mapping document, unknown top-level keys, a version other than 2, missing sections, or a section whose entries have the wrong types (for example `transition T01: from is not a state name, a role name, or a structured special value`). The enumerations version 1 fixed (`states.req`, `states.req_off_chain`, `states.tc`, `states.bug`, `roles`) must match verbatim; duplicates, extra items, missing items, and a different order each name the items and the fixed list. The registrations version 2 added are then checked: every transition carries `subjects`, `guards`, `effects`, and `may_change`; each subject shape starts with `^` and names exactly its own transition id, event subject shapes name no transition, and no two registrations share a shape; guards and effects reference registered predicates; `may_change` names registered lifecycle-sensitive kinds; events declare `req_unchanged: true` and touch neither the REQ status nor its owner. A well-formed table finally reports every content inconsistency together: transition ids match `T<NN>[a-z]` and are unique; only `T19` declares `exempt_from_hard_stop`; `any_of` and special slot values appear only at `T15.from`, `T19.from`, `T15.actor`, `T16.to`, and `T16.owner_after`, and named slots are registered states and roles; exits start at `req_review`, end forward on the main chain, and every forward transition leaving `req_review` is registered under a `tc_policy`; each review gate's signer has legal work at that state and `pass_to_enter` names registered columns, main-chain states, and gates; `tc_status_by_state` covers exactly the main chain with registered TC statuses; and the four restore targets use distinct transitions and states, each matching the hand-over of the transition it names.

### Read derived facts

- `roleStates(table)` maps every role to the states it may work in: a named actor gains the named `from` state and a named `owner_after` role gains the named `to` state, while structured slots (`any_of`, `current_owner`, `restore_state`, `restore_owner`) attribute nothing. The registry's `handles` must equal this projection.
- `requiredGates(table, column, status)` accumulates the `pass_to_enter` sections of every main-chain state up to `status` in the given column (`with_tc`, `optional_no_tc`, `exempt`); off-chain states and unknown columns yield nothing.
- `reachableStates(table, policy)` walks forward transitions from the first main-chain state, leaving `req_review` only through the policy's registered exits.
- `sensitiveKinds(table)` lists the kinds `may_change` may name: the eight REQ fields as `req.<field>`, `tc_status:<status>`, `bug_status:<status>`, and `rv:<section>` for every gate plus `regression` and `external_review`.
- `statusIndex`, `legalReqStatuses`, `transitionById`, and `signerOf` read the table's main-chain positions, its complete REQ status set, one transition, and a gate's signer.

### Load the agent registry

`loadAgentRegistry(text, table, label = 'agent-registry.yml')` returns `{ registry, problems }` and checks the registry against the loaded table in three stages, stopping after the first stage with problems. The document must be version 1 with `roles` and `agents`, `roles` must equal the table's roles, and the optional `provider_sets`, `seats`, and `active_set` must have their declared types. Every agent is then checked and all agent problems are reported together: the uid matches `<role>-NNN` with the role as prefix; `handles` are registered states and equal the states the table derives for the role (`handles differ from the states lifecycle.yml derives for planner: extra [tc_design], missing []`); a non-human agent declares `vendor`, a `route { provider, model }`, and an `effort` that is either one of `low`, `medium`, `high`, `xhigh`, `max` or a per-state map keyed by registered states with a `default`; `fallbacks` are `{ provider, model, vendor }` routes; no uid is registered twice. Finally the provider sets (`kind` is `same_vendor` or `cross_vendor`; `planner`, `generator`, and `evaluator` name registered agents of that role; a same-vendor set keeps one vendor and a cross-vendor set puts the generator and evaluator on different vendors), the `active_set` (required when sets exist, must name one), and the `seats` (a registered state, a registered uid whose `handles` include the state) are checked together.

`seatFor(registry, role, state)` returns the uid that takes the role at the state: the seat override when its agent has that role, else the active set's member for the role, else the only registered agent of the role handling the state, else `undefined`. `effortFor(agent, state)` returns the per-state effort, else the default, else `undefined` for agents without efforts.

### Load the id scheme

`loadIdScheme(text, label = 'id-scheme.yml')` returns `{ scheme, problems }`: `scopes` maps scope directories to prefixes of one to six uppercase letters, and no prefix belongs to two directories.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the loaders are split; the observable behavior lives in [Use this package](#use-this-package).

### Design concept

- **One problem per root cause.** Structural parsing stops at the first defect because later checks would only restate it; content checks over a well-formed table run to completion so one edit-and-reload cycle shows every inconsistency.
- **Derive, never copy.** Role states, required gates, reachable states, and the sensitive kinds are computed from the table; the registry's `handles` is the only materialized copy and the loader rejects any drift.
- **Fixed enumerations, registered vocabulary.** The state and role lists are format invariants pinned in code, while predicates, gates, and kinds are declared by the table and checked by reference.
- **Vendors are declared.** A dsh route such as `codex` or `claude-code` is a product, not a model family, so the same-vendor and cross-vendor rules read the registry's `vendor` fields and never infer them.

### Source map

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | Table, registry, and id-scheme types; branded `TransitionId` and `AgentUid` |
| [`src/yaml.ts`](src/yaml.ts) | One-document YAML reading with unique keys, value guards, and the `Parsed` result |
| [`src/table.ts`](src/table.ts) | `loadLifecycleTable`, the fixed enumerations, registration and self-consistency checks, derivations |
| [`src/registry.ts`](src/registry.ts) | `loadAgentRegistry`, `seatFor`, `effortFor` |
| [`src/id-scheme.ts`](src/id-scheme.ts) | `loadIdScheme` |
| [`src/index.ts`](src/index.ts) | Consumer interface |
| — | No runtime invariant companion is published; the library holds no mutable state or event stream, and every relation it checks is decided in one load. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the loader contract is not enough. They move from this library to the team design it serves and the routes its registry names.

- [Lifecycle team](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.md) — the team design whose tables this library loads.
- [Conversation backends](../../../docs/subsystems/conversation-backend.md) — the `codex` and `claude-code` routes a registry binds role seats to.
- [Experimental packages](../README.md) — where the other lifecycle packages appear as they land.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a table library; the orchestrator that renders briefs and tool results owns every model-visible fact.

#### KV Cache effect

None; this package neither assembles nor sends a harness model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the loaders do not cover. They are current package constraints, not a task backlog.

- **Version 2 only** — a table declaring another version is rejected; no migration from earlier table formats is offered.
- **Efforts are not checked against routes** — a registry effort the named route does not advertise is caught when the orchestrator resolves the route, not at load.
- **Subject shapes are checked textually** — the loader checks the `^` anchor and the named transition id of each shape, not that the expression compiles or matches real commit subjects.
- **Human agents carry no route** — `seatFor` returns the human uid, and the caller asks the human instead of spawning a child.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The fixtures are the English translation of the factory-tools `harness/lifecycle.yml` (version 2) and `harness/agent-registry.yml`, with `rv:regression` and `rv:external_review` replacing the Chinese section names. Problem texts are pinned by the specs' mutation tables; changing a message means changing its row.

</details>

**Runtime invariant:** No companion is published. The loaders return values and problems and keep no state between calls.
