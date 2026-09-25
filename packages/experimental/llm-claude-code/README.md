---
description: "Claude Code conversation backend for dsh: provider routes that run each Session's turns on one persistent Claude Code session through the official Agent SDK with the user's Claude Code login, bridged permissions, and a durable session binding."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-llm-claude-code

English | [中文](README.zh.md)

## Summary

Run dsh Sessions on Claude Code without an API key. The plugin registers provider routes (default `claude-code`) whose adapter runs each turn as one Agent SDK query that resumes the Session's Claude Code session, sends only the new user input, and streams Claude Code's answer, thinking, and tool activity back into the ordinary dsh transcript. Claude Code owns the conversation history, tools, and permissions; dsh keeps the loop, the Session log, approvals, and presentation. The signed-in Claude Code CLI is the only credential. The layer is experimental and installed explicitly.

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

Sign in to Claude Code once with the official CLI (`claude`), then install the package into a profile from this source checkout:

```sh
pnpm dsh plugin --profile headless add ./packages/experimental/llm-claude-code
```

The CLI appends this package's [`cordis.patch.yml`](cordis.patch.yml) as a profile layer. Select the route as the Session's provider (`provider: claude-code`) with a model id or alias the CLI accepts (`sonnet`, `opus`, or a full model id); the Web model picker lists the catalog the CLI advertises. Remove the layer through the same CLI with `remove @deepseek-ai/dsh-experimental-llm-claude-code`.

### What you get

A Session's first turn on a route starts a Claude Code session in the Session workspace and records its id as the `claude-code/session` event; every later turn, including turns after a dsh restart, resumes that session, so Claude Code keeps the conversation context and dsh sends only the new user messages. Each turn runs the pinned SDK's CLI as one process under the subprocess seam and releases it when the turn ends. Requests that are not part of the conversation (session titles, compaction, one-shot calls without a Session) run as unpersisted queries and never touch the binding.

While a turn runs, assistant text streams as the answer, Claude's thinking streams as reasoning, and each completed tool call appears as one reasoning line such as ``ran `pnpm test` ``, `edited src/a.ts`, or `searched the web for "vitest"`. Cancelling the dsh turn cancels the query. The model catalog and each model's effort levels come from the CLI itself.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `routes` | `{ claude-code: {} }` | Provider routes keyed by the name a request selects. |
| `routes.<name>.permissionMode` | `bridge` | `bridge` runs queries in the SDK's `default` mode and forwards each tool permission to `ctx.approval` and each `AskUserQuestion` to `ctx.userQuestions`, failing closed; `dontAsk`, `acceptEdits`, `auto`, `plan`, and `bypassPermissions` keep Claude Code's native unattended behavior with human questions disabled. |
| `env` | `{}` | Environment entries layered over the subprocess seam's scrubbed parent environment, for example `CLAUDE_CONFIG_DIR`. |
| `disposeGraceMs` | `3000` | Grace between termination tiers when a turn's CLI process is released. |
| `turnIdleTimeoutMs` | unset | Cancel a turn that produces no SDK message for this long and fail it with `TIMEOUT`; unset leaves turns unbounded. |

An empty route set, an empty route name, or a non-positive duration fails at load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) resolves the configuration and builds one [`ClaudeCodeBackendAdapter`](src/adapter.ts) over the official `query` from [`@deepseek-ai/dsh-claude-agent-sdk`](../../product-runtime/claude-agent-sdk/README.md) and `ctx.subprocess`, then registers the `claudeCodeSession` projection and every route inside one effect whose disposer releases both. Every query sets `spawnClaudeCodeProcess` so the CLI runs through `claudeSpawnSpec` and `ManagedClaudeCodeProcess`, composes the child environment from the scrubbed parent environment plus `env`, and forwards the CLI's stderr to the Host stderr while keeping its last lines for failure messages.

The adapter's `stream()` classifies the request with the shared [`llm-product-backend`](../llm-product-backend/README.md) helpers: a loop request with a live Agent uses the Session's bound session (`resume` set to the recorded id, refusing with `WORKSPACE_MISMATCH` when the Session workspace changed), while any other request runs an unpersisted query. The prompt is one user message holding the trailing user messages joined by blank lines, kept open until the result so the SDK's control channel stays available. `system/init` binds an unbound Session by appending `claude-code/session`; `stream_event` text and thinking deltas stream as text and reasoning; `assistant` tool-use blocks and the matching `user` tool results become activity lines (Bash as a command, the edit tools as file changes, WebSearch as a web search, anything else as a tool); the `result` message supplies the usage. A `success` result finishes `stop` (streaming the result text only when no partial message did), an `is_error` result maps its API status to `AUTH`, `RATE_LIMIT`, `SERVER`, or `PRODUCT_ERROR`, and the error subtypes map to `MAX_TURNS`, `BUDGET_EXCEEDED`, `INVALID_RESULT`, and `PRODUCT_ERROR`. Cancellation and the idle timeout abort the query's `AbortController`; a query that fails before `system/init` while resuming is `PRODUCT_CONVERSATION_MISSING` with the CLI's stderr as detail, and any other failure is `TRANSPORT` with the same tail.

The model catalog is read once per plugin lifetime from a short-lived query's `supportedModels()` and dropped when a read fails, so the next read retries.

[`src/bridge.ts`](src/bridge.ts) builds the SDK callbacks. On a `bridge` route a bound turn's `canUseTool` asks `ctx.approval` with the tool name `claude-code:<Tool>` and the call's `description`, `command`, `file_path`, or `query` as the reason (an allowed decision passes the input through unchanged; anything else denies), and `AskUserQuestion` is answered through `ctx.userQuestions` keyed by question text (no answerer denies the call). Elicitations are declined and dialogs cancelled. Native routes and unpersisted queries install unattended callbacks that deny every permission request and disable `AskUserQuestion` (and `ExitPlanMode` in `plan` mode); `bypassPermissions` additionally sets the SDK's skip flag.

No runtime invariant companion is published: the plugin's single effect owns the routes and projection, and each turn owns its own query and process, so no independent observation can diverge.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [External agent conversation backends](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) — the design this package implements.
- [Claude Agent SDK runtime](../../product-runtime/claude-agent-sdk/README.md) — the pinned SDK and the managed-process projection.
- [Conversation backend helpers](../llm-product-backend/README.md) — the shared input, stream, activity, interaction, routing, and binding helpers.
- [Codex conversation backend](../llm-codex/README.md) — the sibling backend with the same Session binding design.
- [Claude Code one-shot subagent provider](../../subagent/subagent-claude-code/README.md) — the delegated-run sibling that shares the runtime.
- [Experimental packages](../README.md) — publication policy and dependency isolation.

-----

<a id="model-experience"></a>
## Model Experience

### Bound turn input

#### What the model sees

Claude Code receives one user message per dsh turn holding the request's trailing user messages (after the last assistant message, each message's text blocks joined with newlines, messages joined with blank lines), plus the request `model` and, when set, `effort`. The dsh system prompt, tool schemas, tool results, and earlier messages are not sent; Claude Code reads its own session history, instructions, and tools. Images are projected to text by the LLM runtime because the routes declare `inputModalities: ['text']`.

#### Token effect

Per turn, Claude Code consumes the new user text on top of its own session context; dsh-side token usage reports the result message's `usage` with cache reads and writes separated into `cacheReadTokens` and `cacheWriteTokens`.

#### KV Cache effect

Independent of dsh context: the session history lives in Claude Code, and each turn appends to it, so Claude Code's own prompt caching applies. dsh sends no repeated prefix that this package could invalidate.

### Activity lines

#### What the model sees

Nothing during the turn. Completed Claude Code tool calls are streamed to the transcript as reasoning deltas, one line each, for example ``ran `pnpm test` `` or `failed to edit src/a.ts`; they are persisted in the assistant message's reasoning blocks and are not part of the next turn's input.

#### Token effect

Zero direct effect on Claude Code requests; the lines add reasoning text to the dsh Session only.

#### KV Cache effect

Independent: the lines are dsh-side output and never enter a later query.

### Unpersisted auxiliary requests

#### What the model sees

Session-title and compaction requests, and requests without a Session, run as a fresh unpersisted query that receives the request's trailing user messages as its single user message. These sessions are not bound and are not written to Claude Code's session store.

#### Token effect

One additional Claude Code query per auxiliary request, without the Session's context.

#### KV Cache effect

Independent request in a new session; it neither reads nor invalidates the Session's context.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **dsh tools are not available to Claude Code.** Claude Code runs its own tools under its own permissions; the dsh tool registry, system prompt sections, and tool results do not reach it, so profiles built around dsh tools should keep a model route for those Sessions.
- **Cancellation kills the turn.** Aborting a dsh turn aborts the SDK query and its CLI process instead of asking Claude Code to stop gracefully; the persisted session still resumes on the next turn.
- **Signed-out Claude Code is reported as a transport failure.** The SDK exposes no structured sign-in state, so the catalog and every turn report `TRANSPORT` with the CLI's own "Not logged in" text; the plugin never opens a browser or stores tokens.
- **A missing session is inferred.** A query that fails before its first `system/init` while resuming is reported as `PRODUCT_CONVERSATION_MISSING` with the CLI stderr as detail, so a startup failure during a resume carries the same code.
- **Activity is narration, not events.** Tool calls appear as reasoning lines; typed Session events and Web cards for Claude Code actions are deferred.
- **A Session binds to one workspace.** A Session whose `cwd` differs from its session's workspace fails with `WORKSPACE_MISMATCH` instead of moving the session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/fake-claude.ts` scripts the SDK `query` and the CLI process behind the subprocess seam; the adapter spec injects the factory directly while the plugin spec mocks the runtime module's `query`. Both settle the catalog and message streams from the test so no timing assumption remains.

</details>
