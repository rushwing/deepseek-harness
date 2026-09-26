# 会话后端

[English](conversation-backend.md) | 中文

会话后端把 dsh Session 的回合运行在外部 agent 产品上，而不是裸模型上：Codex 通过其 app-server，Claude Code 通过 Agent SDK。产品拥有对话历史、工具、沙箱与权限；dsh 保留 agent 循环、Session 日志、审批、提问与呈现。每个后端都是注册在 `ctx.llm` 上的普通 `LlmAdapter`，像其他任何 provider 路由一样被选择，并通过产品自己的登录完成认证，因此没有任何 API Key 经过 dsh。[设计笔记](../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)拥有决策记录；本页记录共享词汇与接线。

## 包

| 包 | 角色 |
|---|---|
| [`dsh-codex-app-server`](../../packages/product-runtime/codex-app-server/README.zh.md) | 固定版本的 `@openai/codex` wrapper 与 app-server 协议客户端（握手、线程、回合、中断、模型与账户查询） |
| [`dsh-claude-agent-sdk`](../../packages/product-runtime/claude-agent-sdk/README.zh.md) | 固定版本的 Claude Agent SDK、原生权限模式词汇，以及把 SDK 的 CLI 投影到子进程 seam 上的实现 |
| [`dsh-experimental-llm-product-backend`](../../packages/experimental/llm-product-backend/README.zh.md) | 每个后端共享的部分：新输入推导、请求分类、分块流、活动行、审批与提问桥接、Session 绑定，以及 adapter 骨架 |
| [`dsh-experimental-llm-codex`](../../packages/experimental/llm-codex/README.zh.md) | `codex` 路由：每个插件一个惰性启动的 app-server，每个 Session 一个持久线程 |
| [`dsh-experimental-llm-claude-code`](../../packages/experimental/llm-claude-code/README.zh.md) | `claude-code` 路由：每回合一次 SDK 查询，恢复每个 Session 一个的持久 Claude Code 会话 |

一次性的 [Codex](../../packages/subagent/subagent-codex/README.zh.md) 与 [Claude Code](../../packages/subagent/subagent-claude-code/README.zh.md) 子 agent provider 构建在相同的运行时包之上，但每个委派任务运行一个全新的产品对话，绝不绑定 Session。

## 请求分类

每次 `stream()` 调用都解析为一个目标。

| 请求 | 目标 | 工作区 |
|---|---|---|
| `sessionId` 指向存活 Agent 的循环构建请求 | `bound`：Session 的产品对话，首回合创建，之后恢复 | Session 的 `cwd`，必需 |
| 带有 `purpose`（Session 标题、压缩）、没有 `sessionId`，或不是由 agent 循环构建的请求 | `ephemeral`：绝不触碰绑定的一次性产品对话 | 有 Agent 时为其 `cwd`，否则为插件进程的工作目录 |

绑定回合只发送新的用户输入：最后一条助手消息之后的用户消息，每条消息的文本块以换行连接。dsh 系统提示、工具 schema、工具结果与更早的消息不会发送，且路由声明 `inputModalities: ['text']`，因此 LLM 运行时会把图像投影为文本。

## Session 绑定

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

每个后端把绑定记录为自己的仅写日志 Session 事件，并用自己的投影键折叠：Codex 把 `codex/thread` 写入 `codexThread`，Claude Code 把 `claude-code/session` 写入 `claudeCodeSession`。事件在产品确认对话之后、首回合开始之前追加，因此恢复或重启后的 dsh Session 继续同一产品对话。`cwd` 不再与绑定匹配的 Session 以 `WORKSPACE_MISMATCH` 失败；产品已不再拥有的已绑定对话以 `PRODUCT_CONVERSATION_MISSING` 失败，绝不会被静默替换。

## 权限桥接

路由携带 `permissionMode`。默认的 `bridge` 模式把产品的请求转发到 harness 的交互服务并在失败时关闭；原生模式保留各产品的无人值守行为。

| 产品请求 | 桥接 | 允许时 | 其他情况 |
|---|---|---|---|
| Codex `item/commandExecution/requestApproval` | 以 `codex:command` 询问 `ctx.approval` | `accept` | `decline`（Codex 继续）；取消提示则取消回合 |
| Codex `item/fileChange/requestApproval` | 以 `codex:file-change` 询问 `ctx.approval` | `accept` | `decline`；取消提示则取消回合 |
| Codex `item/permissions/requestApproval` | 以 `codex:permissions` 询问 `ctx.approval` | 本回合所请求的权限 | 不授予权限 |
| Codex `item/tool/requestUserInput` | 按问题 id 询问 `ctx.userQuestions` | 答案 | 无答案 |
| Claude Code `canUseTool(name, input)` | 以 `claude-code:<name>` 询问 `ctx.approval` | 原样放行输入的 `allow` | `deny` |
| Claude Code `AskUserQuestion` | 按问题文本询问 `ctx.userQuestions` | 输入中带 `answers` 的 `allow` | `deny` |
| MCP elicitation 与 Claude Code 对话框 | 无 | — | 拒绝或取消 |

每次桥接的审批都通过审批服务自己的 `approval/asked` 与 `approval/decided` 事件留下审计。临时对话与未知线程总是得到无人值守的回答。

## 转录与失败

助手文本以文本块流出，产品推理以推理块流出。已完成的产品动作成为由共享活动词汇（命令、文件变更、工具、网页搜索）渲染的单行推理条目，因此命令与编辑在转录中可见、在助手消息中持久，而无需类型化事件。Token 用量来自产品自身的计数，缓存输入单独报告。

失败以普通的 finish 原因结束流：被中止的请求以 `aborted` 结束；产品限制以 `max-tokens`（Codex 上下文窗口）结束，或以 code 跟随产品失败分类的 `error` 结束（`RATE_LIMIT`、`SERVER`、`TRANSPORT`、`ACCESS_POLICY`、`PRODUCT_ERROR`、`INVALID_RESULT`、`MAX_TURNS`、`BUDGET_EXCEEDED`、`AUTH`）；未登录的 Codex 以指出 `codex login` 的 `MISSING_CREDENTIAL` 结束。共享的重试策略像对其他 provider 一样重试 `RATE_LIMIT`、`SERVER`、`TIMEOUT` 与 `TRANSPORT`。
