---
description: "面向用户与维护者的生命周期模型回退：当请求以可跳转代码失败时，把生命周期角色子代移到其注册表条目的下一条路由、在同一 uid 下重试该步、并让 llm-retry 先决定的循环策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-lifecycle-model-fallback

[English](README.md) | 中文

## 概述

本插件让生命周期角色子代在模型路由失败时继续工作。它通过驱动器标签 `lifecycle:<uid>@<state>:<REQ>` 识别子代，从工作区的 `agent-registry.yml` 读取该 uid 的路由及有序的 `fallbacks`，当请求以可跳转的代码失败且其他每个恢复策略都将其留为终态时，把子代移到下一条路由并重试该步。uid 从不改变，因此评审与交接保持其归属。它限制每个子代的切换次数，仅当下一条路由声明该推理 effort 时才保留它，并且不触碰任何其他 agent。

## 目录

- [使用本插件](#use-this-plugin)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-plugin"></a>
## 使用本插件

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `lifecycleDir` | `lifecycle` | 相对于子代 Session 工作目录的目录，其 `lifecycle.yml` 与 `agent-registry.yml` 给出该 uid 的路由。 |
| `hopOnCodes` | `RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`、`EMPTY_RESPONSE` | 使子代移到下一条路由的失败代码；其他代码保持终态。 |
| `maxHops` | `2` | 一个子代最多切换路由的次数；超过上限之后的路由从不使用。 |

插件注入 `llm`。请与 `llm-retry` 一起组合：其错误监听器被前置并先行委派，因此无论两个插件以何种顺序激活，`llm-retry` 都先耗尽其同路由重试（其他策略也先决定），然后才跳转。

### 失败时发生什么

带标签子代的模型请求以 `hopOnCodes` 中的代码失败、所有下游策略都将其留为终态、子代还有剩余跳数、且其注册表条目列出了更多路由：插件记录该跳并回答 `retry`。重试的尝试以及该子代之后的每个请求都发往新路由；当新路由的模型声明该推理 effort 时保留它，否则丢弃，由 adapter 默认值生效。路由变化可在子代的 `request/header` 与 `request/context` 事件中看到；插件自身不记录事件。

对未带标签的 agent、注册表不认识的标签、表无法加载的工作区、人类 uid、`hopOnCodes` 之外的代码、已达上限的子代、或没有更多回退的 uid，什么都不发生：失败保持终态，轮次像没有本插件时一样以错误结束。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

本节说明插件如何拆分；可观察行为见[使用本插件](#use-this-plugin)。

### 设计理念

- **同一 uid，下一条路由。** 注册表的 `fallbacks` 是备选的唯一来源；插件不发明路由，并从子代自己的工作区读取表。
- **最后手段。** 错误监听器在行动前先等待 waterfall 的其余部分，因此 provider 重试策略保留其预算与顺序。
- **每个子代一份计划。** 路由计划按 agent 计算一次并保存在弱映射中，因此子代之后的步骤停留在它跳到的路由上。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `uidOfLabel`、`planFor`、`effortOn`，以及带 `agent/request` 重写与前置 `agent/request-error` 监听器的 `apply` |
| — | 不发布运行时不变量伴随件；插件只按 agent 保存一个弱映射，不报告任何可能被其他观察否定的关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当配置不够时读这些页面。它们从本插件延伸到它所让位的重试策略以及它服务的团队。

- [生命周期团队](../../../docs/subsystems/lifecycle-team.zh.md) — 注册表、给角色子代打标签的驱动器，以及记录路由的事件。
- [`dsh-llm-retry`](../../llm/llm-retry/README.zh.md) — 先行决定的同路由重试策略。
- [生命周期团队设计](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.zh.md) — 决策记录。

-----

<a id="model-experience"></a>
## 模型体验

Indirectly, through the route a retried request is sent to: the plugin changes which provider and model serve a lifecycle role child after a failure, and the adapters own every model-visible fact.

#### KV Cache 影响

一次跳转把子代的请求移到另一个 provider 或模型，因此在失败路由上建立的 provider 缓存不会延续；请求前缀本身不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定回退不做的事。它们是当前的包约束，不是任务积压。

- **always 模式的 provider 从不跳转** — 重试策略为 `always` 的 provider 会在同一路由上重试直到成功或轮次被取消，因此回退从不被询问。
- **跳转不记录为事件** — 路由切换可由子代的 `request/header` 与 `request/context` 事件重建；没有 `lifecycle/*` 事件记录它。
- **计划按子代只读一次** — 子代运行期间编辑的注册表由下一个子代看到，而非正在运行的那个。
- **无法解析的路由会让轮次失败** — 当下一条路由的模型无法被其 adapter 解析时，请求准备抛出且轮次结束；回退不会跳到再下一条路由。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性 — 交付行为与限制以上文各节和代码为准。测试用循环测试工具包驱动真实的 agent 循环，配两条模拟路由：声明 effort 的 `claude-code` 与不声明的 `codex`，基于复制到临时工作区的 lifecycle-table 固件。顺序测试分别在回退之前与之后挂载 `llm-retry`，两种情况都期望同样的三个请求。

</details>

**运行时不变量：** 不发布伴随件。插件只按 agent 保存一个弱映射，不报告任何可能被其他观察否定的关系。
