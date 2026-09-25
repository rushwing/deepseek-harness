---
description: "面向一次性 Codex 提供方与 Codex 会话后端维护者的共享 Codex 运行时：唯一的产品固定版本、app-server 命令、协议辅助函数和持久多线程连接。"
kind: "package-library"
---

# @deepseek-ai/dsh-codex-app-server

[English](README.md) | 中文

## 概述

`dsh-codex-app-server` 是 harness 中唯一固定官方 `@openai/codex` 运行时版本并使用其 app-server 协议的地方。它构造包内的 `codex app-server --stdio` 命令，使任何消费方都不解析主机上的 `codex`；把原生权限模式映射到官方线程字段；校验帧；分类失败的轮次；并提供 `CodexAppServerConnection`：一个长寿命连接，可启动或恢复线程、把每个线程的一个轮次流式传给观察者、中断、列出模型、读取账号，并把审批与用户输入请求委托给注入的处理器。它是纯库；[一次性提供方](../../subagent/subagent-codex/README.zh.md)和会话后端拥有进程生命周期与人类参与。

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

当插件需要通过官方 app-server 协议运行 Codex 时使用本包。通过 subprocess 接缝派生它构造的命令，在子进程的 stdout 与 stdin 上构造连接，再通过连接驱动线程与轮次。

### 启动产品

`codexAppServerArgv()` 返回 `[node, <包内包装器>, 'app-server', '--stdio']`。包装器来自本包自己的 `@openai/codex` 依赖，其可选平台包携带原生二进制；缺失或不受支持的载荷在首个请求时失败，而不会回退到主机上的 `codex`。通过 `ctx.subprocess.spawn` 以凭据清洗方式派生它，然后调用一次 `connection.start()` 与 `connection.initialize(signal)`。

### 线程与轮次

`startThread({ cwd, permission, model?, ephemeral? })` 发送带有给定 `approvalPolicy`、`approvalsReviewer` 与 `sandbox` 字段的 `thread/start`：原生无人值守模式由 `threadPermissionParams(mode)` 提供这些字段，自行回答审批请求的客户端则使用 `INTERACTIVE_THREAD_PERMISSION_PARAMS`（`on-request` 审批、`workspace-write` 沙箱）；`resumeThread(threadId, { cwd, permission, model? })` 发送 `thread/resume`。两者都返回 Codex 报告的线程 id，并在响应畸形或产品出错时拒绝。

`runTurn(threadId, { input, model?, effort? }, signal, observer)` 发送带文本块及可选每轮次模型与推理投入的 `turn/start`，然后把该线程和轮次的通知路由给观察者：`turn/start` 的响应连同轮次 id 到 `onTurnStarted`，`item/agentMessage/delta` 到 `onTextDelta`，`item/reasoning/textDelta` 与 `item/reasoning/summaryTextDelta` 到 `onReasoningDelta`，`item/started` 与 `item/completed` 到条目回调，`thread/tokenUsage/updated` 到 `onUsage`。在 `turn/start` 应答前到达的通知在轮次 id 已知后重放；其他线程或过期轮次的通知被忽略。调用以权威的 `turn/completed` 结算：`completed` 携带最终助手文本（最后一条 `final_answer` 消息，否则最后一条无阶段消息），`interrupted` 不携带更多内容，`failed` 携带粗粒度的 `CodexTurnFailureInfo` 和产品消息。一个线程一次只运行一个轮次；第二次调用会拒绝。中止信号会拒绝调用并释放线程，但不会停止产品；为此请调用 `interrupt(threadId, turnId)`。

### 服务端请求

Codex 会以 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/permissions/requestApproval`、`item/tool/requestUserInput` 或 `mcpServer/elicitation/request` 暂停轮次。连接把每个请求以 `{ method, params, threadId, turnId }` 交给构造时传入的处理器，并原样回传解析出的值；被拒绝的处理器变为 JSON-RPC 错误响应，连接继续服务每个线程。`unattendedDecision(params)` 为没有人类的客户端给出不批准的答案：有 `cancel` 则 `cancel`，否则 `decline`。

### 目录与账号

`listModels(signal)` 跟随 `model/list` 分页并返回未隐藏的模型及其显示名、描述、默认与支持的推理投入和输入模态。`readAccount(signal)` 发送不强制刷新令牌的 `account/read` 并报告是否有账号登录。

### 失败与关闭

`turnFailureInfo(turn)` 把官方 `codexErrorInfo` 映射为 `limit`、`access-policy`、`service`、`transport`、`product-error` 或 `unknown`，为连接与流失败保留 HTTP 状态，并标记上下文窗口与沙箱失败。流错误或协议流结束会以同一错误使每个活动轮次失败并把连接标记为 `closed`；`close()` 主动做同样的事且幂等。之后每个受守卫的调用都以那个首个致命错误拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明库如何拆分；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **一处固定版本，两个消费方。** 包装器依赖、命令和权限映射放在这里，使一次性提供方和会话后端不会漂移到不同的产品版本。
- **共享协议事实，分离生命周期。** 帧校验、握手、`thread/start`、无人值守决定、失败分类、中止竞争和传输接线是两个客户端都调用的函数；每个客户端保留自己的轮次模型，因为单个临时轮次与按线程的持久轮次在缓冲什么和何时结算上不同。
- **请求由消费方决定。** 连接从不自行回答审批；处理器是人类、策略或无人值守默认值进入的唯一位置。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/argv.ts`](src/argv.ts) | 解析包内包装器并构造固定的 app-server 命令 |
| [`src/permission.ts`](src/permission.ts) | 原生权限模式及其官方线程字段 |
| [`src/protocol.ts`](src/protocol.ts) | 帧校验器、传输接线、握手、`thread/start`、无人值守决定、轮次失败分类、中止竞争 |
| [`src/connection.ts`](src/connection.ts) | `CodexAppServerConnection`：按线程的轮次路由、服务端请求委托、目录、账号、关闭 |
| [`src/index.ts`](src/index.ts) | 消费方接口 |
| — | 不发布运行时不变量伴随包；库自身不拥有事件流或可变数据关系，每个消费方自行证明其进程与 Session 事实。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当库契约不够时阅读这些页面。它们从本运行时走向启动产品的消费方。

- [Codex subagent 提供方](../../subagent/subagent-codex/README.zh.md)——为每个任务运行一个全新临时线程的一次性委派。
- [外部 agent 会话后端](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)——本连接所服务的按 Session 后端设计。
- [Claude Code 与 Codex 后端](../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.zh.md)——产品提供方的设计记录。
- [Subprocess 子系统](../../../docs/subsystems/subprocess.zh.md)——派生并终止 app-server 进程的接缝。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是协议库；挂载 Codex 提供方或后端的消费方拥有模型所见的内容。

#### KV Cache 影响

无；本包既不组装也不发送 harness 模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了库不覆盖的范围。它们是当前的包约束，不是任务积压。

- **仅文本输入**——`runTurn` 发送文本块；协议接受的图片与文件输入未在此构造。
- **每线程一个轮次**——不提供对运行中轮次的引导（`turn/steer`）和排队后续；同一线程上的第二次 `runTurn` 会拒绝。
- **不拥有进程**——库从不派生、终止或观察 app-server 进程；消费方通过 subprocess 接缝做这些并用 `close()` 释放连接。
- **协议事实以证据固定**——请求字段与通知名遵循固定版本 `@openai/codex` 0.153.4 包装器生成的 JSON schema；升级固定版本需要重新生成该证据并重跑两个消费方的无密钥真实产品测试。
- **粗粒度失败类别**——`turnFailureInfo` 把产品错误分类保持为固定的类别集合，绝不复制产品文字。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制见上文各节与代码。一次性提供方的 `CodexAppServerWire` 与本包的 `CodexAppServerConnection` 共享协议辅助函数但保留各自的轮次状态；把一次性 wire 合并到连接上会让提供方依赖它从不使用的按线程记账。

</details>

**Runtime invariant:** 不发布伴随包。进程树归属属于 subprocess 服务，Session 事实属于每个消费方。
