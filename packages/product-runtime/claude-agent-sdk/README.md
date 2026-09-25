---
description: "The shared Claude Code runtime for maintainers of the one-shot Claude Code provider and the Claude Code conversation backend: the single Agent SDK pin, the permission-mode vocabulary, and the managed-process projection."
kind: "package-library"
---

# @deepseek-ai/dsh-claude-agent-sdk

English | [中文](README.zh.md)

## Summary

`dsh-claude-agent-sdk` is the one place the harness pins the official `@anthropic-ai/claude-agent-sdk` and its platform CLI payloads. It re-exports the SDK's `query` entry and wire types so every consumer speaks one SDK version, names the native permission modes that never wait for a human, and projects the harness subprocess handle onto the SDK's custom-spawn process interface so the real CLI runs under the subprocess seam. It is a pure library with no plugin, configuration, or registration; the [one-shot subagent provider](../../subagent/subagent-claude-code/README.md) and the Claude Code conversation backend own query lifetime, result mapping, and human involvement.

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

Use this package when a plugin runs Claude Code through the official Agent SDK. Import `query` and the SDK types from here, pass `spawnClaudeCodeProcess` an adapter built from the subprocess seam, and select a permission mode from the shared vocabulary.

### Start a query

`query({ prompt, options })` is the official SDK entry point re-exported unchanged. Leave `pathToClaudeCodeExecutable` unset so the SDK selects the CLI from this package's optional platform dependency; an omitted, unsupported, or damaged payload fails at the first query instead of falling back to a host `claude`. Set `spawnClaudeCodeProcess` to a function that turns the SDK's `SpawnOptions` into a managed process: `claudeSpawnSpec(options, graceMs)` produces the fully explicit subprocess request (argv, workspace, piped stdin and stdout, inherited stderr, termination grace, forwarded signal, and the SDK environment encoded as an overlay with tombstones for removed ambient names), and `new ManagedClaudeCodeProcess(handle)` projects the spawned handle's streams, exit facts, and termination back onto the SDK's `SpawnedProcess` interface. A spawn request without a workspace is refused.

### Permission modes

`CLAUDE_CODE_PERMISSION_MODES` lists the native modes an unattended query may select: `dontAsk`, `acceptEdits`, `auto`, `plan`, and `bypassPermissions`; `DEFAULT_CLAUDE_CODE_PERMISSION_MODE` is `dontAsk`. `SUPPORTED_UNATTENDED_DIALOG_KINDS` names the blocking dialog kinds such a query declares it can answer by cancelling. Consumers that route permissions to a human pass their own `canUseTool` and use the SDK's `default` mode instead.

### Process facts

`ManagedClaudeCodeProcess` exposes `killed`, `exitCode`, `signalCode`, and the complete `outcome` after exit, emits `exit` and `error` to SDK listeners, and routes `kill()` to the subprocess seam's termination ladder exactly once. It never terminates or observes anything on its own; the consumer's disposal and the subprocess service own process-tree quiescence.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the library is split; the observable behavior lives in [Use this package](#use-this-package).

### Design concept

- **One pin, two consumers.** The SDK dependency and its platform payloads live here so the one-shot provider and the conversation backend cannot drift to different Claude Code versions.
- **Projection, not transport.** The SDK keeps its own protocol and CLI; this package only maps the harness managed process onto the SDK's spawn interface.
- **Modes are vocabulary.** The permission-mode constants say what a deployment may select; each consumer decides how a selected mode becomes SDK options and callbacks.

### Source map

| File | Role |
|---|---|
| [`src/sdk.ts`](src/sdk.ts) | Re-exports the official `query` entry and the wire types consumers need |
| [`src/permission.ts`](src/permission.ts) | The native non-interactive permission modes, their default, and the unattended dialog kinds |
| [`src/process.ts`](src/process.ts) | `claudeSpawnSpec`, `sdkEnvironmentOverlay`, and `ManagedClaudeCodeProcess` |
| [`src/index.ts`](src/index.ts) | Consumer interface |
| — | No runtime invariant companion is published; the library owns no event stream or mutable data relation of its own, and each consumer proves its own process and Session facts. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the library contract is not enough. They move from this runtime to the consumers that start the product.

- [Claude Code subagent provider](../../subagent/subagent-claude-code/README.md) — the one-shot delegation that runs a fresh query per task.
- [External agent conversation backends](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) — the per-Session backend design this runtime serves.
- [Claude Code and Codex backends](../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) — the design record for the product providers.
- [Subprocess subsystem](../../../docs/subsystems/subprocess.md) — the seam that spawns and terminates the CLI process.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is an SDK runtime library; the consumers that mount a Claude Code provider or backend own what the model sees.

#### KV Cache effect

None; this package neither assembles nor sends a harness model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the library does not cover. They are current package constraints, not a task backlog.

- **No query lifecycle** — consuming the SDK stream, mapping results, resume, and disposal stay with each consumer.
- **Compatibility is pinned by evidence** — the Agent SDK version and its Claude Code CLI are pinned here; upgrading the pin requires re-running both consumers' keyless real-product and loader-composition tests.
- **Stderr is inherited** — the spawn spec inherits the parent's stderr; a consumer that must capture CLI stderr builds its own spec.
- **The SDK's login stays native** — the package neither creates an account nor reads Claude settings; authentication failures surface through the SDK.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The provider's test suites still declare the SDK as a test-only dependency with the same peer set so their mocks and real-product checks resolve the single store instance; a mismatch in that peer set would materialize a second copy of the platform payload.

</details>

**Runtime invariant:** No companion is published. Process-tree ownership belongs to the subprocess service, and Session facts belong to each consumer.
