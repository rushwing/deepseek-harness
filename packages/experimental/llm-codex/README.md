---
description: "Codex conversation backend for dsh: provider routes that run each Session's turns on one persistent Codex app-server thread with the user's Codex login, bridged approvals, and a durable thread binding."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-llm-codex

English | [中文](README.zh.md)

## Summary

Run dsh Sessions on Codex without an API key. The plugin registers provider routes (default `codex`) whose adapter sends each turn's new user input to one persistent Codex app-server thread per Session and streams Codex's answer, reasoning, and activity back into the ordinary dsh transcript. Codex owns the conversation history, tools, and sandbox; dsh keeps the loop, the Session log, approvals, and presentation. The signed-in Codex account (`codex login`) is the only credential. The layer is experimental and installed explicitly.

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

Sign in to Codex once with the official CLI (`codex login`), then install the package into a profile from this source checkout:

```sh
pnpm dsh plugin --profile headless add ./packages/experimental/llm-codex
```

The CLI appends this package's [`cordis.patch.yml`](cordis.patch.yml) as a profile layer: the adapter row registers the routes in every profile, and a `Codex` agent preset (one complete persona, no dsh tools or runtime context) joins the Web preset picker wherever the preset registry is mounted. Select the route as the Session's provider (`provider: codex`) with any model id Codex offers; the Web model picker lists the catalog once Codex is reachable. Remove the layer through the same CLI with `remove @deepseek-ai/dsh-experimental-llm-codex`.

### What you get

Every route shares one Codex app-server process, started on the first request and terminated when the plugin unloads. A Session's first turn on a route starts a Codex thread in the Session workspace and records it as the `codex/thread` event; later turns, including turns after a dsh or Codex restart, continue that thread, so Codex keeps the conversation context and dsh sends only the new user messages. Requests that are not part of the conversation (session titles, compaction, one-shot calls without a Session) run on ephemeral Codex threads and never touch the binding.

While a turn runs, assistant text streams as the answer, Codex reasoning summaries stream as reasoning, and completed Codex actions appear as one-line reasoning entries such as ``ran `pnpm test` (exit 0)``, `edited src/a.ts`, or `searched the web for "vitest"`. Cancelling the dsh turn interrupts the Codex turn. The model catalog comes from Codex (`model/list`), including each model's reasoning efforts.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `routes` | `{ codex: {} }` | Provider routes keyed by the name a request selects; every route shares the app-server. |
| `routes.<name>.permissionMode` | `bridge` | `bridge` runs threads with Codex's `on-request` approvals and `workspace-write` sandbox and forwards each approval to `ctx.approval` and each question to `ctx.userQuestions`, failing closed; `never`, `approve-for-me`, and `dangerously-bypass-approvals-and-sandbox` keep Codex's native unattended behavior. |
| `env` | `{}` | Environment entries layered over the subprocess seam's scrubbed parent environment, for example `CODEX_HOME`. |
| `disposeGraceMs` | `3000` | Grace for Codex to settle an interrupted turn and between termination tiers on disposal. |
| `turnIdleTimeoutMs` | unset | Interrupt a turn that produces no notification for this long and fail it with `TIMEOUT`; unset leaves turns unbounded. |

An empty route set, an empty route name, or a non-positive duration fails at load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) inserts the adapter row and the `preset-codex` row; the preset waits harmlessly in profiles without `agentPresets`. [`src/index.ts`](src/index.ts) resolves the configuration, builds one [`CodexAppServerHost`](src/host.ts), one [`ThreadRegistry`](src/bridge.ts), and one [`CodexBackendAdapter`](src/adapter.ts), then registers the `codexThread` projection and every route inside one effect whose disposer releases both and terminates the app-server. The host spawns the pinned official wrapper from [`@deepseek-ai/dsh-codex-app-server`](../../product-runtime/codex-app-server/README.md) through `ctx.subprocess`, performs the `initialize` handshake, shares one connection among concurrent callers, closes the connection as soon as the process exits, and respawns on the next request; threads created or resumed in the current process are remembered so a later turn knows whether `thread/resume` is required.

The adapter's `stream()` classifies the request with the shared [`llm-product-backend`](../llm-product-backend/README.md) helpers: a loop request with a live Agent uses the Session's bound thread (starting one and appending `codex/thread` when none exists, resuming it after a restart, and refusing with `PRODUCT_CONVERSATION_MISSING` when Codex no longer has it or `WORKSPACE_MISMATCH` when the Session workspace changed), while any other request uses an ephemeral thread. `turn/start` carries only the trailing user messages plus the request model and reasoning effort. Text, reasoning, completed items, and token usage flow through a `ProductTurnStream`; `turn/completed` maps to `stop`, `max-tokens` (context window exhausted), `aborted` (Codex interrupted the turn), or an `error` finish whose code follows the Codex failure category (`RATE_LIMIT`, `SERVER`, `TRANSPORT`, `ACCESS_POLICY`, `PRODUCT_ERROR`, `INVALID_RESULT`, `UNKNOWN`). Cancellation and the idle timeout send `turn/interrupt` as soon as the turn id is known and wait `disposeGraceMs` for Codex's own completion before abandoning the protocol wait.

During a bound turn the thread is registered as live with its Agent, route mode, and abort signal. The server-request handler answers `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and `item/permissions/requestApproval` for `bridge` threads by asking `ctx.approval` with the tool names `codex:command`, `codex:file-change`, and `codex:permissions` (an allowed decision accepts or grants the requested permissions for the turn; a rejected or unanswerable request declines the action so Codex continues, and a cancelled prompt cancels the turn), answers `item/tool/requestUserInput` through `ctx.userQuestions` keyed by question id, and declines MCP elicitations. Native-mode threads, ephemeral threads, and threads it does not know receive the unattended answer.

No runtime invariant companion is published: the plugin's single effect owns the routes, the projection, and the process, and the live-thread registry is written and cleared by the same turn, so no independent observation can diverge.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [External agent conversation backends](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) — the design this package implements.
- [Codex app-server runtime](../../product-runtime/codex-app-server/README.md) — the pinned wrapper and protocol client.
- [Conversation backend helpers](../llm-product-backend/README.md) — the shared input, stream, activity, interaction, and binding helpers.
- [Codex one-shot subagent provider](../../subagent/subagent-codex/README.md) — the delegated-run sibling that shares the runtime.
- [Experimental packages](../README.md) — publication policy and dependency isolation.

-----

<a id="model-experience"></a>
## Model Experience

### Bound turn input

#### What the model sees

Codex receives one `turn/start` per dsh turn whose `input` holds the request's trailing user messages (each message's text blocks joined with newlines) after the last assistant message, plus the request `model` and `effort`. The dsh system prompt, tool schemas, tool results, and earlier messages are not sent; Codex reads its own thread history, instructions, and tools. Images are projected to text by the LLM runtime because the routes declare `inputModalities: ['text']`.

#### Token effect

Per turn, Codex consumes the new user text on top of its own thread context; dsh-side token usage reports Codex's `thread/tokenUsage/updated` counts for the turn with cached input separated into `cacheReadTokens`.

#### KV Cache effect

Independent of dsh context: the thread history lives in Codex, and each turn appends to it, so Codex's own prefix reuse applies. dsh sends no repeated prefix that this package could invalidate.

### Activity lines

#### What the model sees

Nothing during the turn. Completed Codex commands, file changes, tool calls, and web searches are streamed to the transcript as reasoning deltas, one line each, for example ``ran `pnpm test` (exit 0)`` or `declined command `rm -rf dist``; they are persisted in the assistant message's reasoning blocks and are not part of the next turn's input.

#### Token effect

Zero direct effect on Codex requests; the lines add reasoning text to the dsh Session only.

#### KV Cache effect

Independent: the lines are dsh-side output and never enter a later request to Codex.

### Ephemeral auxiliary requests

#### What the model sees

Session-title and compaction requests, and requests without a Session, run on a fresh ephemeral Codex thread that receives the request's trailing user messages as a single turn. These threads are not bound and are discarded with the app-server process.

#### Token effect

One additional Codex turn per auxiliary request, without the Session thread's context.

#### KV Cache effect

Independent request on a new thread; it neither reads nor invalidates the Session thread's context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **dsh tools are not available to Codex.** Codex runs its own tools inside its sandbox; the dsh tool registry, system prompt sections, and tool results do not reach Codex, so profiles built around dsh tools should keep a model route for those Sessions.
- **Activity is narration, not events.** Commands and file changes appear as reasoning lines; typed Session events and Web cards for Codex actions are deferred.
- **A Session binds to one workspace.** A Session whose `cwd` differs from its thread's workspace fails with `WORKSPACE_MISMATCH` instead of moving the thread.
- **Auxiliary requests spend Codex turns.** Session titles and compaction run as ephemeral Codex turns; deployments can disable those plugins for Codex-routed profiles.
- **No recorded-session snapshot yet.** Codex assigns each thread id per run, so the keyless snapshot lane cannot replay a bound Session; the loop-driven real-product spec pins the transcript against the real app-server instead.
- **Signed-out Codex fails at request time.** The catalog and every turn report `MISSING_CREDENTIAL` naming `codex login`; the plugin never opens a browser or stores tokens.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/fake-app-server.ts` scripts the app-server behind the subprocess seam; adapter and plugin specs answer `thread/start`, `turn/start`, and notifications in protocol order, and use `reader()` to wait for a streamed chunk before aborting so interrupt paths are deterministic.

</details>
