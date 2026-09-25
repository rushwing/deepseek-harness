# Conversation backends

English | [中文](conversation-backend.zh.md)

A conversation backend runs a dsh Session's turns on an external agent product instead of a bare model: Codex through its app-server, Claude Code through the Agent SDK. The product owns the conversation history, tools, sandbox, and permissions; dsh keeps the agent loop, the Session log, approvals, questions, and presentation. Each backend is an ordinary `LlmAdapter` registered on `ctx.llm`, selected like any other provider route, and signed in through the product's own login, so no API key passes through dsh. The [design note](../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) owns the decision record; this page records the shared vocabulary and wiring.

## Packages

| Package | Role |
|---|---|
| [`dsh-codex-app-server`](../../packages/product-runtime/codex-app-server/README.md) | Pinned `@openai/codex` wrapper and the app-server protocol client (handshake, threads, turns, interruption, model and account queries) |
| [`dsh-claude-agent-sdk`](../../packages/product-runtime/claude-agent-sdk/README.md) | Pinned Claude Agent SDK, the native permission-mode vocabulary, and the projection of the SDK's CLI onto the subprocess seam |
| [`dsh-experimental-llm-product-backend`](../../packages/experimental/llm-product-backend/README.md) | What every backend shares: new-input derivation, request classification, the chunk stream, activity lines, approval and question bridging, the Session binding, and the adapter skeleton |
| [`dsh-experimental-llm-codex`](../../packages/experimental/llm-codex/README.md) | The `codex` routes: one lazily started app-server per plugin, one persistent thread per Session |
| [`dsh-experimental-llm-claude-code`](../../packages/experimental/llm-claude-code/README.md) | The `claude-code` routes: one SDK query per turn resuming one persistent Claude Code session per Session |

The one-shot [Codex](../../packages/subagent/subagent-codex/README.md) and [Claude Code](../../packages/subagent/subagent-claude-code/README.md) subagent providers build on the same runtime packages but run a fresh product conversation per delegated task and never bind a Session.

## Request classification

Every `stream()` call resolves to one target.

| Request | Target | Workspace |
|---|---|---|
| Loop-built request whose `sessionId` names a live Agent | `bound`: the Session's product conversation, created on the first turn and resumed afterwards | the Session `cwd`, required |
| Request with a `purpose` (session title, compaction), without a `sessionId`, or not built by the agent loop | `ephemeral`: a throwaway product conversation that never touches the binding | the Agent `cwd` when there is one, else the plugin's process working directory |

A bound turn sends only the new user input: the user messages after the last assistant message, each message's text blocks joined by newlines. The dsh system prompt, tool schemas, tool results, and earlier messages are not sent, and the routes declare `inputModalities: ['text']` so the LLM runtime projects images to text.

## Session binding

```ts type-equiv
/** Which product conversation a Session continues, recorded when the product acknowledged it. */
interface ProductConversationBinding {
  /** The product's conversation identity (a Codex thread id, a Claude session id). */
  readonly conversationId: string
  /** The workspace the conversation was created in. */
  readonly cwd: string
  /** The model fixed for the conversation, when the request named one. */
  readonly model?: string | undefined
}
```

Each backend records the binding as its own log-only Session event and folds it with its own projection key: Codex writes `codex/thread` into `codexThread`, Claude Code writes `claude-code/session` into `claudeCodeSession`. The event is appended once the product has acknowledged the conversation and before its first turn starts, so a resumed or restarted dsh Session continues the same product conversation. A Session whose `cwd` no longer matches the binding fails with `WORKSPACE_MISMATCH`; a bound conversation the product no longer has fails with `PRODUCT_CONVERSATION_MISSING` and is never silently replaced.

## Permission bridge

Routes carry a `permissionMode`. The default `bridge` mode forwards the product's requests to the harness interaction services and fails closed; the native modes keep each product's unattended behavior.

| Product request | Bridge | Allowed | Otherwise |
|---|---|---|---|
| Codex `item/commandExecution/requestApproval` | `ctx.approval` as `codex:command` | `accept` | `cancel` when offered, else `decline` |
| Codex `item/fileChange/requestApproval` | `ctx.approval` as `codex:file-change` | `accept` | `cancel` or `decline` |
| Codex `item/permissions/requestApproval` | `ctx.approval` as `codex:permissions` | the requested permissions for the turn | no permissions |
| Codex `item/tool/requestUserInput` | `ctx.userQuestions` by question id | the answers | no answers |
| Claude Code `canUseTool(name, input)` | `ctx.approval` as `claude-code:<name>` | `allow` with the unchanged input | `deny` |
| Claude Code `AskUserQuestion` | `ctx.userQuestions` by question text | `allow` with `answers` in the input | `deny` |
| MCP elicitations and Claude Code dialogs | none | — | declined or cancelled |

Every bridged approval is audited through the approval service's own `approval/asked` and `approval/decided` events. Ephemeral conversations and unknown threads always receive the unattended answer.

## Transcript and failures

Assistant text streams as text blocks and product reasoning as reasoning blocks. Completed product actions become one-line reasoning entries rendered by the shared activity vocabulary (command, file change, tool, web search), so commands and edits stay visible in the transcript and durable in the assistant message without typed events. Token usage comes from the product's own counters with cached input reported separately.

Failures end the stream as ordinary finish reasons: an aborted request finishes `aborted`; a product limit finishes `max-tokens` (Codex context window) or an `error` whose code follows the product's failure taxonomy (`RATE_LIMIT`, `SERVER`, `TRANSPORT`, `ACCESS_POLICY`, `PRODUCT_ERROR`, `INVALID_RESULT`, `MAX_TURNS`, `BUDGET_EXCEEDED`, `AUTH`); a signed-out Codex finishes `MISSING_CREDENTIAL` naming `codex login`. The shared retry policy retries `RATE_LIMIT`, `SERVER`, `TIMEOUT`, and `TRANSPORT` like any other provider.
