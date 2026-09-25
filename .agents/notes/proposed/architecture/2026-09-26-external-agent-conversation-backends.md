# Agent Note: External agent conversation backends

Status: proposed

English | [中文](2026-09-26-external-agent-conversation-backends.zh.md)

## Problem

Every dsh conversation runs on a model route that needs an API key: the DeepSeek adapters and the pi-ai routes all authenticate with a credential the deployment supplies. A person who already pays for Codex or Claude Code cannot point a dsh Session at that subscription. The existing product providers, [`dsh-subagent-codex`](../../../../packages/subagent/subagent-codex/README.md) and [`dsh-subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md), reach those products through their official integrations and native logins, but only as one-shot delegations: each call is a fresh process and a non-resumable product conversation whose final answer is the whole payload. A Session cannot continue a product conversation across turns, see its streamed output, or answer its approval requests.

The lifecycle team planned in the [lifecycle team Agent Note](2026-09-26-lifecycle-team.md) needs role agents that run on Codex and Claude Code logins, are spawned programmatically with `agentOptions`, continue one product conversation for the length of a work-item step, and work headless. A third-party plugin family (`relay-dsh-plugin-codex`, `relay-dsh-plugin-claude`) demonstrates the architecture on the Web profile, but its peer ranges exclude dsh 0.1.7, it requires the Web server, and it mutates private dsh internals, so it cannot be the product's answer.

## Proposal

Add two conversation backends as experimental bundles, each a pure `LlmAdapter` registered on `ctx.llm` under its own route (`codex`, `claude-code`). A dsh Agent whose route names a backend keeps the ordinary loop, Session log, approvals, and presentation; the product owns the model context, system prompt, native tools, skills, and sandbox.

Each `stream()` call runs exactly one product turn on the product conversation bound to `options.sessionId`. The adapter derives the new user input from `options.messages` as the trailing run of `user` messages after the last `assistant` message and sends only that text; `options.system` and `options.tools` are ignored because the product supplies its own. Product text and reasoning stream back as `text-delta` and `reasoning-delta` chunks; commands the product ran and files it changed stream as one-line `reasoning-delta` text in a dedicated reasoning block, so the durable `assistant/message` carries the activity without a new presentation surface. Requests with `purpose` set (session title, compaction) or without a Session run on an ephemeral product conversation and never touch the binding.

The binding is durable: `codex/thread` and `claude-code/session` join `SessionEventMap` as log-only events appended inside the step once the product acknowledges the conversation, and per-Session projections fold the latest binding for the next turn and for resume after a Host restart. A product conversation that no longer exists fails the turn with `PRODUCT_CONVERSATION_MISSING`; the adapter never creates a silent replacement. A signed-out product fails with `MISSING_CREDENTIAL` naming the native login command.

Approvals bridge to dsh in the default `permissionMode: bridge`: Codex `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, and `item/permissions/requestApproval` and the Claude `canUseTool` callback become `ctx.approval.request` calls whose `allowed-once` outcome accepts and whose other outcomes decline; Codex `item/tool/requestUserInput` and Claude `AskUserQuestion` become `ctx.userQuestions.ask` calls. Where no answerer exists, requests fail closed exactly as the one-shot providers do today. The native unattended modes remain selectable per plugin instance, and several named instances can share one profile so an interactive `codex` route and an unattended `codex-unattended` route coexist.

Login stays native. The bundles install the pinned official runtimes and start no product until the first request; a person signs in with `codex login` or `claude` beforehand.

### Package topology

| Package | Role | Depends on |
|---|---|---|
| `packages/product-runtime/codex-app-server` (`@deepseek-ai/dsh-codex-app-server`, release) | Single pin of `@openai/codex`; the app-server protocol client shared by the one-shot provider and the backend: handshake, thread start and resume, turn execution with an observer, interruption, model and account queries, and an injectable server-request handler | `dsh-sdk-protocol`, `dsh-subprocess` |
| `packages/product-runtime/claude-agent-sdk` (`@deepseek-ai/dsh-claude-agent-sdk`, release) | Single pin of `@anthropic-ai/claude-agent-sdk`; the spawn adapter, permission-mode vocabulary, disposal, and the official `query` entry shared by the provider and the backend | `dsh-subprocess` |
| `packages/subagent/subagent-codex`, `packages/subagent/subagent-claude-code` (existing) | One-shot providers with unchanged behavior, consuming the runtime packages | runtime packages |
| `packages/experimental/llm-product-backend` | Shared bridge library: new-input derivation, ephemeral-request classification, approval and question bridges, activity lines, chunk emission | `dsh-llm`, `dsh-agent`, `dsh-user-approval`, `dsh-user-questions` |
| `packages/experimental/llm-codex` (bundle) | The `codex` adapter plugin, `codex/thread` event and projection, a Web preset row | codex-app-server, llm-product-backend |
| `packages/experimental/llm-claude-code` (bundle) | The `claude-code` adapter plugin, `claude-code/session` event and projection, a Web preset row | claude-agent-sdk, llm-product-backend |

The runtime packages are release packages because experimental packages may depend on release packages and never the reverse. The bundles install with `dsh plugin --profile <name> add`, not through `OPTIONAL_BUNDLES`, because each product payload is far larger than the size the optional-bundle list admits.

### Process lifecycle

Codex: one app-server per plugin instance, spawned lazily through `ctx.subprocess.spawn` on the first request and disposed with the plugin; one thread per Session created with the Session's `cwd`, resumed with `thread/resume` after a restart; `turn/interrupt` on abort; a server that exits mid-turn fails that turn and the next turn respawns and resumes. Claude Code: one `query()` per turn with `resume` set to the bound session id and `persistSession: true`, cancellation through the per-turn `AbortController`, and the same managed-process ownership as the one-shot provider.

### Configuration

Both plugins validate `provider` (route name, unique per instance), `permissionMode` (native modes plus `bridge`, default `bridge`), `env`, and `disposeGraceMs`. The Codex plugin adds `turnIdleTimeoutMs`; its model catalog comes from `model/list`. The Claude Code plugin adds a `models` catalog and an `efforts` table mapped to the SDK by an explicit resolve step. Neither plugin has a `model` field: the model is per-Agent `AgentOptions.model`, chosen in the Web catalog, by `agent-default-model`, or by a spawning parent.

## Alternatives considered

**Adopt the Relay plugins.** They prove the architecture, but their peer ranges exclude dsh 0.1.7, they inject the Web server, they register a preset by writing into the profile home, and they extend the persistence vocabulary by mutating `KNOWN_SESSION_EVENT_TYPES`. They would stay external, unaudited, and unusable headless.

**Model-only routes through pi-ai OAuth.** The `openai-codex` route would keep dsh's own loop and tools on a Codex login, but it drops the product's native tools and skills, and Anthropic's terms do not permit the equivalent Claude route outside Claude Code.

**Intercept `llm/stream` instead of registering an adapter.** The waterfall lets a plugin serve requests for chosen Sessions without owning a route, but the model selection surfaces, catalogs, and `agent-default-model` all speak in routes; an adapter is the documented seam for a model provider and needs no loop change.

**A new agent-loop seam that skips prompt assembly for backend Sessions.** It would avoid assembling a system prompt and tool schemas the product ignores, but it changes the loop for one consumer; the minimal Web preset removes the tools and the adapter ignores the rest at negligible cost.

**Duplicate the wire and spawn code into the experimental packages.** No release package would change, but two pins of each product runtime and two copies of the protocol code would drift; the shared runtime packages keep one pin and one implementation.

**A long-lived streaming Claude query per Session.** Streaming input supports mid-turn interruption, but one query per turn with `resume` maps onto the adapter contract of one call per attempt, reuses the one-shot provider's process ownership, and makes restart resume the same mechanism.

## Acceptance criteria

- A headless run with `agent-default-model` set to `codex` or `claude-code` and a signed-in product completes two turns on one product conversation, and the second product request carries the first turn's history.
- Restarting the Host and resuming the Session continues the same product conversation through `thread/resume` or `resume`; a missing product conversation fails the turn with `PRODUCT_CONVERSATION_MISSING`.
- In `bridge` mode a product approval request produces `approval/asked` and `approval/decided` in the Session log, and a `rejected` outcome declines the product action.
- Aborting a turn interrupts the product turn and settles the request as `aborted`.
- The one-shot providers keep their behavior and tests after consuming the runtime packages, and each product runtime is pinned in exactly one package.
- Loader composition of each bundle over the headless profile registers the route and starts no product process; over the Web profile it also lists the preset.
- Unit, keyless real-product, loader-composition, and credentialed tiers exist for both backends; recorded-session snapshots cover the transcript; the SDK projections record the new events.

## Risks

**Wire and SDK field names.** Thread resume parameters, the reasoning-effort field, the accept-decision literal, and the `AskUserQuestion` answer mechanism are verified against the pinned runtimes before the request builders are written; a mismatch surfaces in the keyless real-product tier.

**Auxiliary model calls spend product turns.** Session titles and compaction run on ephemeral product conversations; a deployment that finds this wasteful disables `session-title-llm` for backend Sessions.

**Product approvals without an answerer.** Headless compositions fail every bridged approval closed. Unattended work selects a native mode on a separate named instance.

**Activity as reasoning text.** Presenting commands and file changes as reasoning lines keeps v1 free of new presentation surfaces, but a Web card and typed activity events are the better long-term form and remain deferred.

**Web catalog before login.** The Codex catalog needs a running server and a login; the Web model list shows a provider failure until `codex login` has run.
