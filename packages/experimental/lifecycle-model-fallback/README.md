---
description: "Lifecycle model fallback for users and maintainers: the loop policy that moves a lifecycle role child to the next route of its registry entry when a request fails with a hop-worthy code, retries the step under the same uid, and defers to llm-retry first."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-lifecycle-model-fallback

English | [中文](README.zh.md)

## Summary

This plugin keeps a lifecycle role child working when its model route fails. It recognises children by the driver label `lifecycle:<uid>@<state>:<REQ>`, reads the uid's route and ordered `fallbacks` from the workspace's `agent-registry.yml`, and, when a request fails with a hop-worthy code that every other recovery policy left terminal, moves the child to its next route and retries the step. The uid never changes, so reviews and hand-overs keep their attribution. It caps the switches per child, keeps the reasoning effort only when the next route advertises it, and touches no other agent.

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
| `lifecycleDir` | `lifecycle` | The directory, relative to the child's Session working directory, whose `lifecycle.yml` and `agent-registry.yml` name the uid's routes. |
| `hopOnCodes` | `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`, `EMPTY_RESPONSE` | Failure codes that move the child to its next route; any other code stays terminal. |
| `maxHops` | `2` | The most route switches one child makes; the routes after the cap are never used. |

The plugin injects `llm`. Compose it beside `llm-retry`: its error listener is prepended and delegates first, so `llm-retry` exhausts its same-route retries (and any other policy decides) before a hop, whatever order the two plugins activate in.

### What happens on a failure

A model request of a labeled child fails with a code in `hopOnCodes`, every downstream policy leaves it terminal, the child has hops left, and its registry entry lists a further route: the plugin records the hop and answers `retry`. The retried attempt and every later request of that child go to the new route; the request's reasoning effort is kept when the new route's model advertises it and dropped otherwise, so the adapter default applies. The route change is visible in the child's `request/header` and `request/context` events; the plugin logs no event of its own.

Nothing happens for an unlabeled agent, a label the registry does not know, a workspace whose tables do not load, a human uid, a code outside `hopOnCodes`, a child at the cap, or a uid without further fallbacks: the failure stays terminal and the turn ends in error as it would without the plugin.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the plugin is split; the observable behavior lives in [Use this plugin](#use-this-plugin).

### Design concept

- **Same uid, next route.** The registry's `fallbacks` are the only source of alternatives; the plugin invents no route and reads the tables from the child's own workspace.
- **Last resort.** The error listener awaits the rest of the waterfall before acting, so provider retry policies keep their budgets and their order.
- **One plan per child.** The route plan is computed once per agent and kept on a weak map, so a child's later steps stay on the route it hopped to.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `uidOfLabel`, `planFor`, `effortOn`, and `apply` with the `agent/request` rewrite and the prepended `agent/request-error` listener |
| — | No runtime invariant companion is published; the plugin keeps one weak map per agent and reports no relation another observation could contradict. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the configuration is not enough. They move from this plugin to the retry policy it defers to and the team it serves.

- [Lifecycle team](../../../docs/subsystems/lifecycle-team.md) — the registry, the driver that labels role children, and the events that record routes.
- [`dsh-llm-retry`](../../llm/llm-retry/README.md) — the same-route retry policy that decides first.
- [Lifecycle team design](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.md) — the decision record.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the route a retried request is sent to: the plugin changes which provider and model serve a lifecycle role child after a failure, and the adapters own every model-visible fact.

#### KV Cache effect

A hop moves the child's requests to another provider or model, so the provider cache built on the failed route does not carry over; the request prefix itself is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the fallback does not do. They are current package constraints, not a task backlog.

- **Always-mode providers never hop** — a provider whose retry policy is `always` retries the same route until it succeeds or the turn is cancelled, so the fallback is never asked.
- **Hops are not logged as events** — the route switch is reconstructable from the child's `request/header` and `request/context` events; no `lifecycle/*` event records it.
- **The plan is read once per child** — a registry edited while a child runs is seen by the next child, not the running one.
- **A route that fails to resolve fails the turn** — when the next route's model cannot be resolved by its adapter, the request preparation throws and the turn ends; the fallback does not skip to the route after it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The tests drive the real agent loop with the loop testkit and two mock routes: `claude-code` advertising efforts and `codex` advertising none, over the lifecycle-table fixtures copied into a temporary workspace. The ordering test mounts `llm-retry` before and after the fallback and expects the same three requests either way.

</details>

**Runtime invariant:** No companion is published. The plugin keeps one weak map per agent and reports no relation another observation could contradict.
