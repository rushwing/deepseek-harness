---
description: "dsh 的 Claude Code 会话后端：provider 路由通过官方 Agent SDK 把每个 Session 的回合运行在一个持久的 Claude Code 会话上，使用用户的 Claude Code 登录、桥接权限与持久的会话绑定。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-llm-claude-code

[English](README.md) | 中文

## 概述

无需 API Key 即可在 Claude Code 上运行 dsh Session。插件注册 provider 路由（默认 `claude-code`），其 adapter 把每个回合作为一次 Agent SDK 查询运行：恢复 Session 的 Claude Code 会话，只发送新的用户输入，并把 Claude Code 的回答、思考与工具活动流式写回普通的 dsh 转录。Claude Code 拥有对话历史、工具与权限；dsh 保留循环、Session 日志、审批与呈现。唯一的凭证是已登录的 Claude Code CLI。该层为实验性质，需要显式安装。

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

先用官方 CLI（`claude`）登录一次 Claude Code，然后从本源码检出把包安装到 profile：

```sh
pnpm dsh plugin --profile headless add ./packages/experimental/llm-claude-code
```

CLI 会把本包的 [`cordis.patch.yml`](cordis.patch.yml) 追加为 profile 层：adapter 行在每个 profile 中注册路由，而一个 `Claude Code` agent 预设（一个完整 persona，没有 dsh 工具或运行时上下文）会在挂载了预设注册表的地方加入 Web 预设选择器。把该路由选为 Session 的 provider（`provider: claude-code`），模型 id 或别名可以是 CLI 接受的任意值（`sonnet`、`opus` 或完整模型 id）；Web 模型选择器会列出 CLI 公布的目录。通过同一 CLI 的 `remove @deepseek-ai/dsh-experimental-llm-claude-code` 移除该层。

### 你会得到什么

Session 在某路由上的首个回合会在 Session 工作区中启动一个 Claude Code 会话，并把其 id 记录为 `claude-code/session` 事件；之后的每个回合，包括 dsh 重启后的回合，都恢复该会话，因此 Claude Code 保留对话上下文，dsh 只发送新的用户消息。每个回合把固定版本 SDK 的 CLI 作为一个进程运行在子进程 seam 之下，并在回合结束时释放它。不属于对话的请求（Session 标题、压缩、没有 Session 的一次性调用）作为不持久化的查询运行，绝不触碰绑定。

回合进行中，助手文本作为回答流式输出，Claude 的思考作为推理流式输出，每个已完成的工具调用以单行推理出现，例如 ``ran `pnpm test` ``、`edited src/a.ts` 或 `searched the web for "vitest"`。取消 dsh 回合会取消查询。模型目录与每个模型的力度等级来自 CLI 本身。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `routes` | `{ claude-code: {} }` | 以请求选择的名称为键的 provider 路由。 |
| `routes.<name>.permissionMode` | `bridge` | `bridge` 以 SDK 的 `default` 模式运行查询，并把每次工具权限转发到 `ctx.approval`、每个 `AskUserQuestion` 转发到 `ctx.userQuestions`，失败即关闭；`dontAsk`、`acceptEdits`、`auto`、`plan` 与 `bypassPermissions` 保留 Claude Code 原生的无人值守行为并禁用向人提问。 |
| `env` | `{}` | 叠加在子进程 seam 已清洗的父环境之上的环境项，例如 `CLAUDE_CONFIG_DIR`。 |
| `disposeGraceMs` | `3000` | 释放回合的 CLI 进程时各终止层级之间的宽限。 |
| `turnIdleTimeoutMs` | 未设置 | 回合在此时长内没有任何 SDK 消息时取消它并以 `TIMEOUT` 失败；未设置则回合不受限。 |

空路由集合、空路由名或非正的时长在加载时即失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 插入 adapter 行与 `preset-claude-code` 行；在没有 `agentPresets` 的 profile 中预设行无害地等待。[`src/index.ts`](src/index.ts) 解析配置，构建一个 [`ClaudeCodeBackendAdapter`](src/adapter.ts)，它位于 [`@deepseek-ai/dsh-claude-agent-sdk`](../../product-runtime/claude-agent-sdk/README.zh.md) 的官方 `query` 与 `ctx.subprocess` 之上，然后在一个 effect 内注册 `claudeCodeSession` 投影与全部路由，其 disposer 释放两者。每次查询都设置 `spawnClaudeCodeProcess`，使 CLI 经由 `claudeSpawnSpec` 与 `ManagedClaudeCodeProcess` 运行，用已清洗的父环境加 `env` 组成子进程环境，并把 CLI 的 stderr 转发到 Host stderr，同时保留最后几行用于失败消息。

adapter 的 `stream()` 用共享的 [`llm-product-backend`](../llm-product-backend/README.zh.md) 辅助函数对请求分类：带有存活 Agent 的循环请求使用 Session 绑定的会话（`resume` 设为记录的 id，Session 工作区改变时以 `WORKSPACE_MISMATCH` 拒绝），其他任何请求运行不持久化的查询。提示是一条用户消息，内容为以空行连接的末尾用户消息，并保持打开直到结果到达，以便 SDK 的控制通道可用。`system/init` 为未绑定的 Session 追加 `claude-code/session`；`stream_event` 的文本与思考增量作为文本与推理流出；`assistant` 的 tool-use 块与匹配的 `user` 工具结果成为活动行（Bash 视为命令，编辑类工具视为文件变更，WebSearch 视为网页搜索，其余视为工具）；`result` 消息提供用量。`success` 结果以 `stop` 结束（仅当没有部分消息流出时才把结果文本流出），`is_error` 结果按其 API 状态映射为 `AUTH`、`RATE_LIMIT`、`SERVER` 或 `PRODUCT_ERROR`，错误子类型映射为 `MAX_TURNS`、`BUDGET_EXCEEDED`、`INVALID_RESULT` 与 `PRODUCT_ERROR`。取消与空闲超时中止查询的 `AbortController`；恢复时在 `system/init` 之前失败的查询为 `PRODUCT_CONVERSATION_MISSING`，并以 CLI 的 stderr 作为细节，其他任何失败为带同一尾部的 `TRANSPORT`。

模型目录在插件生命周期内从一次短暂查询的 `supportedModels()` 读取一次，读取失败时丢弃，以便下次读取重试。

[`src/bridge.ts`](src/bridge.ts) 构建 SDK 回调。在 `bridge` 路由上，绑定回合的 `canUseTool` 以工具名 `claude-code:<Tool>` 和调用的 `description`、`command`、`file_path` 或 `query` 作为理由询问 `ctx.approval`（允许则原样放行输入；其他情况拒绝），`AskUserQuestion` 通过 `ctx.userQuestions` 按问题文本回答（没有回答者则拒绝该调用）。elicitation 被拒绝，对话框被取消。原生路由与不持久化的查询安装无人值守回调：拒绝每个权限请求并禁用 `AskUserQuestion`（`plan` 模式下还有 `ExitPlanMode`）；`bypassPermissions` 另外设置 SDK 的跳过标志。

不发布运行时不变量伴随物：插件的单个 effect 拥有路由与投影，每个回合拥有自己的查询与进程，不存在可能分歧的独立观察。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [外部 agent 会话后端](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)——本包实现的设计。
- [Claude Agent SDK 运行时](../../product-runtime/claude-agent-sdk/README.zh.md)——固定版本的 SDK 与托管进程投影。
- [会话后端辅助函数](../llm-product-backend/README.zh.md)——共享的输入、流、活动、交互、路由与绑定辅助函数。
- [Codex 会话后端](../llm-codex/README.zh.md)——采用相同 Session 绑定设计的兄弟后端。
- [Claude Code 一次性子 agent provider](../../subagent/subagent-claude-code/README.zh.md)——共享该运行时的委派运行兄弟包。
- [实验性包](../README.zh.md)——发布策略与依赖隔离。

-----

<a id="model-experience"></a>
## 模型体验

### 绑定回合的输入

#### 模型看到什么

每个 dsh 回合 Claude Code 收到一条用户消息，内容为请求中最后一条助手消息之后的末尾用户消息（每条消息的文本块以换行连接，消息之间以空行连接），外加请求的 `model` 以及设置时的 `effort`。dsh 系统提示、工具 schema、工具结果与更早的消息不会发送；Claude Code 读取自己的会话历史、指令与工具。由于路由声明 `inputModalities: ['text']`，LLM 运行时会把图像投影为文本。

#### Token 影响

每回合，Claude Code 在自身会话上下文之上消耗新的用户文本；dsh 侧的 token 用量报告结果消息的 `usage`，缓存读写分别计入 `cacheReadTokens` 与 `cacheWriteTokens`。

#### KV Cache 影响

与 dsh 上下文无关：会话历史保存在 Claude Code 中，每回合向其追加，因此适用 Claude Code 自身的提示缓存。dsh 不发送任何本包可能使之失效的重复前缀。

### 活动行

#### 模型看到什么

回合进行中什么都看不到。已完成的 Claude Code 工具调用作为推理增量逐行流入转录，例如 ``ran `pnpm test` `` 或 `failed to edit src/a.ts`；它们持久化在助手消息的推理块中，不进入下一回合的输入。

#### Token 影响

对 Claude Code 请求没有直接影响；这些行只向 dsh Session 增加推理文本。

#### KV Cache 影响

无关：这些行是 dsh 侧的输出，绝不进入之后的查询。

### 不持久化的辅助请求

#### 模型看到什么

Session 标题与压缩请求，以及没有 Session 的请求，作为一次全新的不持久化查询运行，以单条用户消息接收请求的末尾用户消息。这些会话不被绑定，也不写入 Claude Code 的会话存储。

#### Token 影响

每个辅助请求额外产生一次 Claude Code 查询，不带 Session 的上下文。

#### KV Cache 影响

新会话中的独立请求；既不读取也不使 Session 的上下文失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Claude Code 无法使用 dsh 工具。** Claude Code 在自己的权限下运行自己的工具；dsh 工具注册表、系统提示分区与工具结果不会到达它，因此围绕 dsh 工具构建的 profile 应为那些 Session 保留一条模型路由。
- **取消会终止回合。** 中止 dsh 回合会中止 SDK 查询及其 CLI 进程，而不是请 Claude Code 优雅停止；持久化的会话仍会在下一回合恢复。
- **未登录的 Claude Code 报告为传输失败。** SDK 不暴露结构化的登录状态，因此目录与每个回合都报告 `TRANSPORT` 并附带 CLI 自己的“Not logged in”文本；插件绝不打开浏览器或存储令牌。
- **会话缺失是推断的。** 恢复时在首个 `system/init` 之前失败的查询报告为 `PRODUCT_CONVERSATION_MISSING` 并以 CLI stderr 作为细节，因此恢复期间的启动失败也带同一 code。
- **尚无录制会话快照。** Claude Code 每次运行都会分配会话 id，因此无密钥的快照通道无法重放已绑定的 Session；改由循环驱动的真实产品 spec 针对真实 CLI 固定转录。
- **活动是叙述，不是事件。** 工具调用以推理行出现；Claude Code 动作的类型化 Session 事件与 Web 卡片延期。
- **一个 Session 绑定一个工作区。** `cwd` 与其会话工作区不同的 Session 以 `WORKSPACE_MISMATCH` 失败，而不是移动会话。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`tests/fake-claude.ts` 脚本化 SDK 的 `query` 以及子进程 seam 之后的 CLI 进程；adapter spec 直接注入该工厂，插件 spec 则 mock 运行时模块的 `query`。二者都由测试来结算目录与消息流，不残留任何时序假设。

</details>
