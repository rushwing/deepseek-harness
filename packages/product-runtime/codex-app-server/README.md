---
description: "The shared Codex runtime for maintainers of the one-shot Codex provider and the Codex conversation backend: the single product pin, the app-server command, the protocol helpers, and the persistent multi-thread connection."
kind: "package-library"
---

# @deepseek-ai/dsh-codex-app-server

English | [中文](README.zh.md)

## Summary

`dsh-codex-app-server` is the one place the harness pins the official `@openai/codex` runtime and speaks its app-server protocol. It builds the package-local `codex app-server --stdio` command so no consumer resolves a host `codex`, maps native permission modes to official thread fields, validates frames, classifies failed turns, and offers `CodexAppServerConnection`: one long-lived connection that starts or resumes threads, streams one turn per thread to an observer, interrupts, lists models, and reads the account, delegating approval and user-input requests to an injected handler. It is a pure library; the [one-shot provider](../../subagent/subagent-codex/README.md) and the conversation backend own process lifetime and human involvement.

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

Use this package when a plugin needs to run Codex through its official app-server protocol. Spawn the command it builds through the subprocess seam, construct a connection over the child's stdout and stdin, and drive threads and turns through the connection.

### Start the product

`codexAppServerArgv()` returns `[node, <package-local wrapper>, 'app-server', '--stdio']`. The wrapper comes from this package's own `@openai/codex` dependency, whose optional platform packages carry the native binary; a missing or unsupported payload fails at the first request instead of falling back to a host `codex`. Spawn it with credential scrubbing through `ctx.subprocess.spawn`, then call `connection.start()` and `connection.initialize(signal)` once.

### Threads and turns

`startThread({ cwd, permissionMode, model?, ephemeral? })` sends `thread/start` with the mode's `approvalPolicy`, `approvalsReviewer`, and `sandbox` fields from `threadPermissionParams`; `resumeThread(threadId, { cwd, permissionMode, model? })` sends `thread/resume`. Both return the thread id Codex reports and reject on a malformed response or a product error.

`runTurn(threadId, { input, model?, effort? }, signal, observer)` sends `turn/start` with the text blocks and optional per-turn model and reasoning effort, then routes notifications for that thread and turn to the observer: `item/agentMessage/delta` to `onTextDelta`, `item/reasoning/textDelta` and `item/reasoning/summaryTextDelta` to `onReasoningDelta`, `item/started` and `item/completed` to the item callbacks, and `thread/tokenUsage/updated` to `onUsage`. Notifications that arrive before `turn/start` answers are replayed once the turn id is known; notifications for other threads or stale turns are ignored. The call settles with the authoritative `turn/completed`: `completed` carries the final assistant text (the last `final_answer` message, else the last unphased message), `interrupted` carries nothing more, and `failed` carries the coarse `CodexTurnFailureInfo` plus the product message. One thread runs one turn at a time; a second call rejects. Aborting the signal rejects the call and frees the thread but does not stop the product; call `interrupt(threadId, turnId)` for that.

### Server requests

Codex pauses a turn with `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, or `mcpServer/elicitation/request`. The connection hands each to the handler passed at construction as `{ method, params, threadId, turnId }` and sends the resolved value back verbatim; a rejected handler becomes a JSON-RPC error response and the connection keeps serving every thread. `unattendedDecision(params)` gives the non-approving answer for a client without a human: `cancel` when offered, else `decline`.

### Catalog and account

`listModels(signal)` follows `model/list` pagination and returns non-hidden models with their display name, description, default and supported reasoning efforts, and input modalities. `readAccount(signal)` sends `account/read` without forcing a token refresh and reports whether an account is signed in.

### Failure and closure

`turnFailureInfo(turn)` maps the official `codexErrorInfo` to `limit`, `access-policy`, `service`, `transport`, `product-error`, or `unknown`, keeping the HTTP status for connection and stream failures and flagging context-window and sandbox failures. A stream error or the end of the protocol stream fails every active turn with the same error and marks the connection `closed`; `close()` does the same deliberately and is idempotent. Every guarded call rejects with that first fatal error afterwards.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the library is split; the observable behavior lives in [Use this package](#use-this-package).

### Design concept

- **One pin, two consumers.** The wrapper dependency, the command, and the permission mapping live here so the one-shot provider and the conversation backend cannot drift to different product versions.
- **Shared protocol facts, separate lifecycles.** Frame validation, the handshake, `thread/start`, the unattended decision, failure classification, the abort race, and transport wiring are functions both clients call; each client keeps its own turn model, because a single ephemeral turn and a per-thread persistent turn map differ in what they buffer and when they settle.
- **Requests are the consumer's decision.** The connection never answers an approval itself; the handler is the only place a human, a policy, or an unattended default enters.

### Source map

| File | Role |
|---|---|
| [`src/argv.ts`](src/argv.ts) | Resolves the package-local wrapper and builds the fixed app-server command |
| [`src/permission.ts`](src/permission.ts) | The native permission modes and their official thread fields |
| [`src/protocol.ts`](src/protocol.ts) | Frame validators, transport wiring, handshake, `thread/start`, unattended decision, turn-failure classification, abort race |
| [`src/connection.ts`](src/connection.ts) | `CodexAppServerConnection`: per-thread turn routing, server-request delegation, catalog, account, closure |
| [`src/index.ts`](src/index.ts) | Consumer interface |
| — | No runtime invariant companion is published; the library owns no event stream or mutable data relation of its own, and each consumer proves its own process and Session facts. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the library contract is not enough. They move from this runtime to the consumers that start the product.

- [Codex subagent provider](../../subagent/subagent-codex/README.md) — the one-shot delegation that runs a fresh ephemeral thread per task.
- [External agent conversation backends](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) — the per-Session backend design this connection serves.
- [Claude Code and Codex backends](../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) — the design record for the product providers.
- [Subprocess subsystem](../../../docs/subsystems/subprocess.md) — the seam that spawns and terminates the app-server process.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a protocol library; the consumers that mount a Codex provider or backend own what the model sees.

#### KV Cache effect

None; this package neither assembles nor sends a harness model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the library does not cover. They are current package constraints, not a task backlog.

- **Text input only** — `runTurn` sends text blocks; image and file inputs the protocol accepts are not built here.
- **One turn per thread** — steering a running turn (`turn/steer`) and queued follow-ups are not offered; a second `runTurn` on the same thread rejects.
- **No process ownership** — the library never spawns, terminates, or observes the app-server process; consumers do that through the subprocess seam and dispose the connection with `close()`.
- **Protocol facts are pinned by evidence** — the request fields and notification names follow the JSON schema generated by the pinned `@openai/codex` 0.153.4 wrapper; upgrading the pin requires regenerating that evidence and re-running both consumers' keyless real-product tests.
- **Coarse failure classes** — `turnFailureInfo` keeps the product's error taxonomy at a fixed set of categories and never copies product prose.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The one-shot provider's `CodexAppServerWire` and this package's `CodexAppServerConnection` share the protocol helpers but keep separate turn state; folding the one-shot wire onto the connection would make the provider depend on per-thread bookkeeping it never uses.

</details>

**Runtime invariant:** No companion is published. Process-tree ownership belongs to the subprocess service, and Session facts belong to each consumer.
