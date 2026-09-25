---
description: "面向在外部 agent 产品上运行 dsh Agent 的会话后端维护者的共享辅助函数：新输入推导、临时请求分类、块发射、活动行、审批与提问桥接，以及持久的会话绑定。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-llm-product-backend

[English](README.md) | 中文

## 概述

会话后端是一种 `LlmAdapter`，它把 Session 的轮次运行在 Codex 或 Claude Code 这类外部 agent 产品上：产品拥有对话历史、工具和沙箱，dsh 保留循环、Session 日志、审批和呈现。本库存放每个此类后端共享的部分：一个轮次发送的新用户输入、哪些请求远离已绑定的对话、产品增量的块流、单行活动描述、到审批与用户提问服务的关闭失败桥接、持久绑定投影，以及两个后端特有的失败。它不注册任何东西；由各后端包挂载。

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

在后端适配器的 `stream()` 和插件装配中导入这些辅助函数。每个辅助函数都是不依赖 Cordis 的普通函数或类，因此由适配器决定产品何时启动以及 Session 记录什么。

### 推导轮次输入

`newUserInput(messages)` 返回最后一条助手消息之后的用户消息，每条消息一段文本（文本块以换行连接），跳过 system、developer 与 tool 消息以及没有文本的消息；结果为空表示最后一条消息是助手的。`isEphemeralRequest(options)` 对带 `purpose`（会话标题、压缩）的请求、没有 Session 的请求以及并非 agent 循环构造的请求返回 `true`；后端把这些请求运行在临时产品对话上，绝不触碰绑定。

### 流式传输产品输出

`ProductTurnStream` 把产品增量转为 `StreamChunk`：`text()` 与 `reasoning()` 以递增索引打开、填充并关闭块（种类变化会关闭打开的块，使写为推理的活动行绝不并入答案），`usage()` 记录最新的 token 计数，`finish(reason)` 关闭打开的块并在终止 finish 之前发出最后的 usage，`fail(error)` 结束流使迭代器在已产出内容之后重新抛出。适配器 yield `chunks()`；提前开始迭代的消费方会等待输出。结算后的任何调用都会抛出。

### 描述产品活动

`activityLine(activity)` 把命令、文件变更或工具动作及其状态渲染为一行有界文本，例如 ``ran `git status` (exit 0)`` 或 `edited a.ts, b.ts`。后端把产品条目归约为 `ProductActivity` 并把该行作为推理流出。

### 桥接审批与提问

`askApproval(ctx.approval, request)` 返回审批结果，并在服务抛出时结算为 `unavailable`；`approvalAllows(outcome)` 仅对 `allowed-once` 返回 `true`。`askQuestions(ctx.userQuestions, request)` 返回人类的答案，在该 agent 没有应答者时（`NO_PROVIDER`、`DELEGATED_CALLER`、`CALLER_NOT_LIVE`）返回 `undefined`，并重新抛出取消与意外失败。

### 把 Session 绑定到产品对话

`ProductConversationBinding` 为 `{ conversationId, cwd, model? }`。后端声明自己承载该形状的 `SessionEventMap` 成员和自己的 `SessionProjectionStateMap` 键，然后在 `ctx.sessionProjections` 上注册 `bindingProjection(key, eventType)`：投影从 `null` 开始，在后端事件上用 `productConversationBindingSchema` 校验后替换状态，对其他事件返回同一引用。`conversationMissing(product, conversationId)` 与 `productNotSignedIn(product, loginCommand)` 构造产品已不存在的已绑定对话（`PRODUCT_CONVERSATION_MISSING`）和没有账号的产品（`MISSING_CREDENTIAL`）对应的 `LlmError`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明辅助函数如何拆分；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **产品拥有上下文，dsh 拥有记录。** 辅助函数从不向产品重发历史；它们提取新输入并记录产品流回的内容，使每个模型可见输入都能从 Session 日志重建。
- **关闭失败。** 两个交互桥接都把无法回答的请求变为不批准的结果，而不是产品会误解的异常。
- **一种状态形状，多种事件。** 绑定投影对事件类型泛化，使 Codex 与 Claude Code 后端声明不同事件却折叠相同状态。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/input.ts`](src/input.ts) | `newUserInput`、`isEphemeralRequest` |
| [`src/stream.ts`](src/stream.ts) | `ProductTurnStream` |
| [`src/activity.ts`](src/activity.ts) | `ProductActivity`、`activityLine` |
| [`src/interaction.ts`](src/interaction.ts) | `askApproval`、`approvalAllows`、`askQuestions` |
| [`src/binding.ts`](src/binding.ts) | `ProductConversationBinding`、`productConversationBindingSchema`、`bindingProjection` |
| [`src/errors.ts`](src/errors.ts) | `conversationMissing`、`productNotSignedIn` 及其错误码 |
| [`src/index.ts`](src/index.ts) | 消费方接口 |
| — | 不发布运行时不变量伴随包；库不拥有事件流或可变数据关系，每个后端自行证明其绑定与审计事实。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当辅助函数契约不够时阅读这些页面。它们从本库走向它所桥接的接缝和使用它的后端。

- [外部 agent 会话后端](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)——这些辅助函数所服务的后端设计。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md)——`ProductTurnStream` 所满足的 `StreamChunk` 协议与适配器契约。
- [审批子系统](../../../docs/subsystems/approval.zh.md)——`askApproval` 返回的结果。
- [用户提问子系统](../../../docs/subsystems/user-questions.zh.md)——`askQuestions` 透传的请求与答案词表。
- [Session 投影子系统](../../../docs/subsystems/session-projection.zh.md)——已注册绑定投影如何折叠与读取。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是辅助库；调用它的后端适配器拥有每个模型可见事实和 Session 事件。

#### KV Cache 影响

无；本包既不组装也不发送 harness 模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了辅助函数不覆盖的范围。它们是当前的包约束，不是任务积压。

- **仅文本输入**——`newUserInput` 只保留文本块；图片与文件块被丢弃，因为 v1 后端声明仅文本输入模态，且 LLM 运行时事先把图片投影为文本。
- **活动是推理文本**——产品命令与文件变更以推理行流出；类型化活动事件与 Web 卡片暂缓。
- **不含产品协议**——线程或会话生命周期、恢复、中断和进程归属留在各后端及其运行时包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制见上文各节与代码。`ProductTurnStream` 无界缓冲；产品轮次有限且 LLM 运行时及时消费，因此尚未暴露背压信号。

</details>

**Runtime invariant:** 不发布伴随包。绑定与审计事件属于各后端的 Session。
