---
description: "Shared helpers for maintainers of conversation backends that run a dsh Agent on an external agent product: new-input derivation, ephemeral-request classification, chunk emission, activity lines, approval and question bridging, and the durable conversation binding."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-llm-product-backend

English | [中文](README.zh.md)

## Summary

A conversation backend is an `LlmAdapter` that runs a Session's turns on an external agent product such as Codex or Claude Code: the product owns the conversation history, tools, and sandbox, and dsh keeps the loop, Session log, approvals, and presentation. This library holds what every such backend shares: the new user input a turn sends, which requests stay off the bound conversation, a chunk stream for product deltas, one-line activity descriptions, fail-closed bridges to the approval and user-question services, the durable binding projection, and two backend-specific failures. It registers nothing; each backend package mounts it.

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

Import the helpers from a backend adapter's `stream()` and plugin setup. Each helper is a plain function or class with no Cordis dependency, so the adapter decides when a product starts and what the Session records.

### Derive the turn's input

`newUserInput(messages)` returns the user messages after the last assistant message, one text per message (text blocks joined with newlines), skipping system, developer, and tool messages and messages without text; an empty result means the last message was the assistant's. `isEphemeralRequest(options)` is `true` for requests with a `purpose` (session title, compaction), requests without a Session, and requests the agent loop did not build; a backend runs those on an ephemeral product conversation and never touches the binding.

### Stream the product's output

`ProductTurnStream` converts product deltas into `StreamChunk`s: `text()` and `reasoning()` open, fill, and close blocks with increasing indices (a change of kind closes the open block, so activity lines written as reasoning never merge into the answer), `usage()` records the latest token counts, `finish(reason)` closes the open block and emits the last usage before the terminal finish, and `fail(error)` ends the stream so the iterator rethrows after what was already produced. The adapter yields `chunks()`; a consumer that starts iterating early waits for output. Any call after settlement throws.

### Describe product activity

`activityLine(activity)` renders a command, file change, tool action, or web search with its status on one bounded line, for example ``ran `git status` (exit 0)``, `edited a.ts, b.ts`, or `searched the web for "vitest"`. A backend reduces its product's item to a `ProductActivity` and streams the line as reasoning.

### Bridge approvals and questions

`askApproval(ctx.approval, request)` returns the approval outcome and settles `unavailable` when the service throws; `approvalAllows(outcome)` is `true` only for `allowed-once`. `askQuestions(ctx.userQuestions, request)` returns the human's answer, `undefined` when no answerer exists for the agent (`NO_PROVIDER`, `DELEGATED_CALLER`, `CALLER_NOT_LIVE`), and rethrows cancellation and unexpected failures.

### Bind the Session to a product conversation

`ProductConversationBinding` is `{ conversationId, cwd, model? }`. A backend declares its own `SessionEventMap` member carrying that shape and its own `SessionProjectionStateMap` key, then registers `bindingProjection(key, eventType)` on `ctx.sessionProjections`: the projection starts at `null`, replaces the state on the backend's event after validating it with `productConversationBindingSchema`, and returns the same reference for every other event. `conversationMissing(product, conversationId, detail?)` (the optional `detail` appends the product's own refusal message) and `productNotSignedIn(product, loginCommand)` build the `LlmError`s for a bound conversation the product no longer has (`PRODUCT_CONVERSATION_MISSING`) and for a product without an account (`MISSING_CREDENTIAL`).

### Resolve configuration and run a turn

`resolveBackendSpec(source, config)` turns a backend's schema-defaulted `routes`, `env`, `disposeGraceMs`, and `turnIdleTimeoutMs` into a `BackendSpec` (through `resolveRoutes`, which rejects an empty route set or name, and `assertDuration`, which rejects a non-positive or over-long duration). Inside `stream()`, `streamProductTurn(signal, run)` owns the `ProductTurnStream` and finishes a rejected turn through `finishForFailure` (`aborted` when the signal aborted, else the `LlmError` facts or `UNKNOWN`); `routeOf`, `requireNewUserInput`, `resolveProductTarget` (a `bound` target with its live Agent and workspace, or an `ephemeral` one for auxiliary and session-less requests), and `readBinding` (`PROJECTION_MISSING`, `WORKSPACE_MISMATCH`) raise the shared `LlmError`s a backend reports before it touches the product; `providerDisplayInfo` names routes after the product.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the helpers are split; the observable behavior lives in [Use this package](#use-this-package).

### Design concept

- **Product owns context, dsh owns the record.** The helpers never resend history to a product; they extract the new input and log what the product streamed back, which keeps every model-visible input reconstructable from the Session log.
- **Fail closed.** Both interaction bridges turn an unanswerable request into a non-approving result rather than an exception the product would interpret.
- **One state shape, many events.** The binding projection is generic over the event type so the Codex and Claude Code backends declare distinct events while folding identical state.

### Source map

| File | Role |
|---|---|
| [`src/input.ts`](src/input.ts) | `newUserInput`, `isEphemeralRequest` |
| [`src/stream.ts`](src/stream.ts) | `ProductTurnStream` |
| [`src/activity.ts`](src/activity.ts) | `ProductActivity`, `activityLine` |
| [`src/interaction.ts`](src/interaction.ts) | `askApproval`, `approvalAllows`, `askQuestions` |
| [`src/binding.ts`](src/binding.ts) | `ProductConversationBinding`, `productConversationBindingSchema`, `bindingProjection` |
| [`src/errors.ts`](src/errors.ts) | `conversationMissing`, `productNotSignedIn`, and their codes |
| [`src/routes.ts`](src/routes.ts) | `resolveRoutes`, `assertDuration`, `resolveBackendSpec`, `BackendConfig`, `BackendSpec` |
| [`src/backend.ts`](src/backend.ts) | `routeOf`, `requireNewUserInput`, `resolveProductTarget`, `readBinding`, `providerDisplayInfo`, `finishForFailure`, `streamProductTurn` |
| [`src/index.ts`](src/index.ts) | Consumer interface |
| — | No runtime invariant companion is published; the library owns no event stream or mutable data relation, and each backend proves its own binding and audit facts. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the helper contract is not enough. They move from this library to the seams it bridges and the backends that use it.

- [External agent conversation backends](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) — the backend design these helpers serve.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract `ProductTurnStream` satisfies.
- [Approval subsystem](../../../docs/subsystems/approval.md) — the outcomes `askApproval` returns.
- [User questions subsystem](../../../docs/subsystems/user-questions.md) — the request and answer vocabulary `askQuestions` passes through.
- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — how a registered binding projection is folded and read.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a helper library; the backend adapters that call it own every model-visible fact and Session event.

#### KV Cache effect

None; this package neither assembles nor sends a harness model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the helpers do not cover. They are current package constraints, not a task backlog.

- **Text input only** — `newUserInput` keeps text blocks; image and file blocks are dropped because v1 backends declare text-only input modalities and the LLM runtime projects images to text beforehand.
- **Activity is reasoning text** — product commands and file changes stream as reasoning lines; typed activity events and a Web card are deferred.
- **No product protocol** — thread or session lifecycle, resume, interruption, and process ownership stay with each backend and its runtime package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. `ProductTurnStream` buffers without bound; a product turn is finite and the LLM runtime consumes promptly, so no backpressure signal is exposed yet.

</details>

**Runtime invariant:** No companion is published. Binding and audit events belong to each backend's Session.
