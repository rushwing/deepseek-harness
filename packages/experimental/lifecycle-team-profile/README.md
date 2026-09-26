---
description: "Enable the lifecycle team — the Planner, Generator, and Evaluator role process over a workspace's lifecycle artifacts, its orchestrator tools, and the model fallback for role children — with one experimental bundle."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-lifecycle-team-profile

English | [中文](README.zh.md)

## Summary

`dsh-experimental-lifecycle-team-profile` switches on the [lifecycle team](../../../docs/subsystems/lifecycle-team.md) with one bundle: the [orchestrator](../lifecycle-orchestrator/README.md) that scaffolds a workspace's `lifecycle/` directory, lints its artifacts, applies transitions, and drives a requirement (REQ) through fresh role children, and the [model fallback](../lifecycle-model-fallback/README.md) that moves a role child to its registry's next route when its model route fails. Ralph stays off so a role child is never handed to a fresh-agent loop. The bundle ships with `dsh` and is offered switched off by the plugin manager.

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

### Install into a profile

Switch the bundle on in the plugin manager's Official group, or add it to an initialized profile by hand, then scaffold and drive a REQ:

```sh
dsh --profile headless "Run lifecycle_init with a full scaffold, then lifecycle_status"
dsh --profile headless "Drive REQ-CORE-001 with lifecycle_run"
```

The orchestrator is composed with `lifecycleDir: lifecycle`, `maxStepsPerRun: 8`, `humanDecisions: ask`, `proposalChannel: auto`, and `subagentProvider: spawn`; the fallback with `lifecycleDir: lifecycle` and `maxHops: 2`. Override a value in the profile's own patch layer, which applies after every bundle layer.

### What you get

- The six `lifecycle_*` tools, the `/lifecycle` command, and the `lifecycle:policy` prompt section in Sessions whose working directory carries `lifecycle/lifecycle.yml`.
- Role children spawned through the in-process `spawn` provider on the routes the workspace registry seats, with delegation tools denied.
- Route fallback for those children after `llm-retry` exhausts its same-route retries.
- `tool-ralph` disabled, as in the base profile.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is one Loader patch layer ([`cordis.patch.yml`](cordis.patch.yml)) declared through `dsh.bundle.patch`, plus the `icon.svg` and `locale/{en,zh}.json` display metadata the plugin manager renders. It exports no runtime API. The two inserted plugins own every behavior; the bundle only fixes their composition and defaults.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the bundle's defaults are not enough. They move from the composition to the plugins it composes and the team design they implement.

- [Lifecycle team](../../../docs/subsystems/lifecycle-team.md) — the workspace files, the service, the driver, and the failure codes.
- [`dsh-experimental-lifecycle-orchestrator`](../lifecycle-orchestrator/README.md) — the tools, the write scopes, and the configuration.
- [`dsh-experimental-lifecycle-model-fallback`](../lifecycle-model-fallback/README.md) — the route fallback and its ordering with `llm-retry`.

-----

<a id="model-experience"></a>
## Model Experience

### Lifecycle policy and tools

#### What the model sees

The policy section and the tool schemas belong to [`@deepseek-ai/dsh-experimental-lifecycle-orchestrator`](../lifecycle-orchestrator/README.md); the bundle changes composition only. Role children additionally see their brief as the first user message.

#### Token effect

The bundle adds the policy sentences and the six tool schemas described by the orchestrator; it adds no prompt text of its own. A hop by the fallback repeats one request on another route.

#### KV Cache effect

The bundle's composition is prefix-stable while its patch and the configured tool schemas remain unchanged; a fallback hop moves a child to another provider cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the bundle does not compose. They are current package constraints, not a task backlog.

- **No Web UI** — the lifecycle state is read through tools and `/lifecycle`; the bundle adds no client cards or panels.
- **Fixed lifecycle directory** — both plugins read `lifecycle/`; a workspace with another layout overrides `lifecycleDir` in both entries.
- **Registry routes are workspace data** — the bundle composes no model route; `lifecycle_init` seats the roles on the routes the deployment has, and the registry is edited in the workspace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. `tests/profile.spec.ts` parses the patch with the Include entry schema and pins the inserted entries, their defaults, and the Ralph disable; the plugins' own suites and the orchestrator's Loader composition e2e cover behavior.

</details>
