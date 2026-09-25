---
description: "dsh 的 Codex 会话后端：provider 路由把每个 Session 的回合运行在一个持久的 Codex app-server 线程上，使用用户的 Codex 登录、桥接审批与持久的线程绑定。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-llm-codex

[English](README.md) | 中文

## 概述

无需 API Key 即可在 Codex 上运行 dsh Session。插件注册 provider 路由（默认 `codex`），其 adapter 把每个回合的新用户输入发送到每个 Session 一个的持久 Codex app-server 线程，并把 Codex 的回答、推理与活动流式写回普通的 dsh 转录。Codex 拥有对话历史、工具与沙箱；dsh 保留循环、Session 日志、审批与呈现。唯一的凭证是已登录的 Codex 账户（`codex login`）。该层为实验性质，需要显式安装。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

先用官方 CLI 登录一次 Codex（`codex login`），然后从本源码检出把包安装到 profile：

```sh
pnpm dsh plugin --profile headless add ./packages/experimental/llm-codex
```

CLI 会把本包的 [`cordis.patch.yml`](cordis.patch.yml) 追加为 profile 层。把该路由选为 Session 的 provider（`provider: codex`），模型 id 可以是 Codex 提供的任意一个；一旦 Codex 可达，Web 模型选择器会列出目录。通过同一 CLI 的 `remove @deepseek-ai/dsh-experimental-llm-codex` 移除该层。

### 你会得到什么

所有路由共享一个 Codex app-server 进程，在首个请求时启动，插件卸载时终止。Session 在某路由上的首个回合会在 Session 工作区中启动一个 Codex 线程，并记录为 `codex/thread` 事件；之后的回合，包括 dsh 或 Codex 重启后的回合，都继续该线程，因此 Codex 保留对话上下文，dsh 只发送新的用户消息。不属于对话的请求（Session 标题、压缩、没有 Session 的一次性调用）运行在临时 Codex 线程上，绝不触碰绑定。

回合进行中，助手文本作为回答流式输出，Codex 推理摘要作为推理流式输出，已完成的 Codex 动作以单行推理条目出现，例如 ``ran `pnpm test` (exit 0)``、`edited src/a.ts` 或 `searched the web for "vitest"`。取消 dsh 回合会中断 Codex 回合。模型目录来自 Codex（`model/list`），包含每个模型的推理力度。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `routes` | `{ codex: {} }` | 以请求选择的名称为键的 provider 路由；所有路由共享 app-server。 |
| `routes.<name>.permissionMode` | `bridge` | `bridge` 以 Codex 的 `on-request` 审批和 `workspace-write` 沙箱运行线程，并把每次审批转发到 `ctx.approval`、每个提问转发到 `ctx.userQuestions`，失败即关闭；`never`、`approve-for-me` 与 `dangerously-bypass-approvals-and-sandbox` 保留 Codex 原生的无人值守行为。 |
| `env` | `{}` | 叠加在子进程 seam 已清洗的父环境之上的环境项，例如 `CODEX_HOME`。 |
| `disposeGraceMs` | `3000` | 等待 Codex 结束被中断回合的宽限，以及卸载时各终止层级之间的宽限。 |
| `turnIdleTimeoutMs` | 未设置 | 回合在此时长内没有任何通知时中断它并以 `TIMEOUT` 失败；未设置则回合不受限。 |

空路由集合、空路由名或非正的时长在加载时即失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`src/index.ts`](src/index.ts) 解析配置，构建一个 [`CodexAppServerHost`](src/host.ts)、一个 [`ThreadRegistry`](src/bridge.ts) 与一个 [`CodexBackendAdapter`](src/adapter.ts)，然后在一个 effect 内注册 `codexThread` 投影与全部路由，其 disposer 释放两者并终止 app-server。host 通过 `ctx.subprocess` 启动 [`@deepseek-ai/dsh-codex-app-server`](../../product-runtime/codex-app-server/README.zh.md) 固定版本的官方 wrapper，执行 `initialize` 握手，在并发调用者之间共享一个连接，进程一退出就关闭连接，并在下一个请求时重新启动；当前进程中创建或恢复过的线程会被记住，以便后续回合判断是否需要 `thread/resume`。

adapter 的 `stream()` 用共享的 [`llm-product-backend`](../llm-product-backend/README.zh.md) 辅助函数对请求分类：带有存活 Agent 的循环请求使用 Session 绑定的线程（不存在时启动一个并追加 `codex/thread`，重启后恢复它，Codex 不再拥有它时以 `PRODUCT_CONVERSATION_MISSING` 拒绝，Session 工作区改变时以 `WORKSPACE_MISMATCH` 拒绝），其他任何请求使用临时线程。`turn/start` 只携带末尾的用户消息以及请求的模型与推理力度。文本、推理、已完成条目与 token 用量经由 `ProductTurnStream` 流出；`turn/completed` 映射为 `stop`、`max-tokens`（上下文窗口耗尽）、`aborted`（Codex 中断了回合），或一个 `error` finish，其 code 跟随 Codex 的失败类别（`RATE_LIMIT`、`SERVER`、`TRANSPORT`、`ACCESS_POLICY`、`PRODUCT_ERROR`、`INVALID_RESULT`、`UNKNOWN`）。取消与空闲超时在得知回合 id 后立即发送 `turn/interrupt`，并等待 `disposeGraceMs` 让 Codex 自行完成，之后才放弃协议等待。

绑定回合进行期间，线程连同其 Agent、路由模式与中止信号被登记为存活。服务端请求处理器对 `bridge` 线程的 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 与 `item/permissions/requestApproval` 以工具名 `codex:command`、`codex:file-change`、`codex:permissions` 询问 `ctx.approval`（允许则接受或授予本回合所请求的权限；其他情况取消或拒绝），通过 `ctx.userQuestions` 按问题 id 回答 `item/tool/requestUserInput`，并拒绝 MCP elicitation。原生模式线程、临时线程与它不认识的线程得到无人值守的回答。

不发布运行时不变量伴随物：插件的单个 effect 拥有路由、投影与进程，存活线程登记表由同一回合写入与清除，不存在可能分歧的独立观察。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [外部 agent 会话后端](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)——本包实现的设计。
- [Codex app-server 运行时](../../product-runtime/codex-app-server/README.zh.md)——固定版本的 wrapper 与协议客户端。
- [会话后端辅助函数](../llm-product-backend/README.zh.md)——共享的输入、流、活动、交互与绑定辅助函数。
- [Codex 一次性子 agent provider](../../subagent/subagent-codex/README.zh.md)——共享该运行时的委派运行兄弟包。
- [实验性包](../README.zh.md)——发布策略与依赖隔离。

-----

<a id="model-experience"></a>
## 模型体验

### 绑定回合的输入

#### 模型看到什么

每个 dsh 回合 Codex 收到一次 `turn/start`，其 `input` 是请求中最后一条助手消息之后的末尾用户消息（每条消息的文本块以换行连接），外加请求的 `model` 与 `effort`。dsh 系统提示、工具 schema、工具结果与更早的消息不会发送；Codex 读取自己的线程历史、指令与工具。由于路由声明 `inputModalities: ['text']`，LLM 运行时会把图像投影为文本。

#### Token 影响

每回合，Codex 在自身线程上下文之上消耗新的用户文本；dsh 侧的 token 用量报告 Codex 该回合的 `thread/tokenUsage/updated` 计数，缓存输入单独计入 `cacheReadTokens`。

#### KV Cache 影响

与 dsh 上下文无关：线程历史保存在 Codex 中，每回合向其追加，因此适用 Codex 自身的前缀复用。dsh 不发送任何本包可能使之失效的重复前缀。

### 活动行

#### 模型看到什么

回合进行中什么都看不到。已完成的 Codex 命令、文件变更、工具调用与网页搜索作为推理增量逐行流入转录，例如 ``ran `pnpm test` (exit 0)`` 或 ``declined command `rm -rf dist` ``；它们持久化在助手消息的推理块中，不进入下一回合的输入。

#### Token 影响

对 Codex 请求没有直接影响；这些行只向 dsh Session 增加推理文本。

#### KV Cache 影响

无关：这些行是 dsh 侧的输出，绝不进入之后发往 Codex 的请求。

### 临时的辅助请求

#### 模型看到什么

Session 标题与压缩请求，以及没有 Session 的请求，运行在一个全新的临时 Codex 线程上，该线程以单个回合接收请求的末尾用户消息。这些线程不被绑定，并随 app-server 进程一起丢弃。

#### Token 影响

每个辅助请求额外产生一个 Codex 回合，不带 Session 线程的上下文。

#### KV Cache 影响

新线程上的独立请求；既不读取也不使 Session 线程的上下文失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Codex 无法使用 dsh 工具。** Codex 在自己的沙箱中运行自己的工具；dsh 工具注册表、系统提示分区与工具结果不会到达 Codex，因此围绕 dsh 工具构建的 profile 应为那些 Session 保留一条模型路由。
- **活动是叙述，不是事件。** 命令与文件变更以推理行出现；Codex 动作的类型化 Session 事件与 Web 卡片延期。
- **一个 Session 绑定一个工作区。** `cwd` 与其线程工作区不同的 Session 以 `WORKSPACE_MISMATCH` 失败，而不是移动线程。
- **辅助请求消耗 Codex 回合。** Session 标题与压缩作为临时 Codex 回合运行；部署可为走 Codex 路由的 profile 禁用这些插件。
- **未登录的 Codex 在请求时失败。** 目录与每个回合都报告 `MISSING_CREDENTIAL` 并指出 `codex login`；插件绝不打开浏览器或存储令牌。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`tests/fake-app-server.ts` 在子进程 seam 之后脚本化 app-server；adapter 与插件 spec 按协议顺序回答 `thread/start`、`turn/start` 与通知，并用 `reader()` 在中止前等待某个已流出的分块，使中断路径具有确定性。

</details>
