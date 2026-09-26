---
description: "生命周期团队的表：从 YAML 加载生命周期状态表、agent 注册表和工作项 id 方案，每个根因一条问题，并推导角色状态、所需评审门、可达状态与生命周期敏感种类，使任何消费方都不必复制表。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-lifecycle-table

[English](README.md) | 中文

## 概述

生命周期团队把需求、测试用例和缺陷在工作区 `lifecycle/` 目录下三个 YAML 文件声明的状态之间推进：`lifecycle.yml`（状态、角色、评审门、出口、带守卫、效果与 `may_change` 种类的 21 个迁移、事件与谓词）、`agent-registry.yml`（绑定到带路由、供应商、强度、候补与所处理状态的 agent 的角色席位）以及 `tasks/id-scheme.yml`（作用域前缀）。本库加载这三个文件，按每个根因一条问题报告，并推导其他生命周期包应读取而非复制的事实：角色状态、所需评审门、可达状态与生命周期敏感种类。它不注册任何东西。

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

读取文件文本，用应作为每条问题前缀的文件标签调用其加载器，并在有问题时停止：加载器要么返回已加载的值与空问题列表，要么不返回值而返回完整列表。[`tests/fixtures/`](tests/fixtures/) 下的英文夹具是参考文档。

### 加载生命周期表

`loadLifecycleTable(text, label = 'lifecycle.yml')` 返回 `{ table, problems }`。结构失败只报告第一个根因：无效 YAML、非映射文档、未知顶层键、不为 2 的版本、缺失的节，或条目类型错误的节（例如 `transition T01: from is not a state name, a role name, or a structured special value`）。版本 1 固定的枚举（`states.req`、`states.req_off_chain`、`states.tc`、`states.bug`、`roles`）必须逐字一致；重复项、多余项、缺失项和不同顺序各自点名相关项与固定列表。随后检查版本 2 新增的登记：每个迁移携带 `subjects`、`guards`、`effects` 与 `may_change`；每个主题形状以 `^` 开头且恰好命名自己的迁移 id，事件主题形状不命名任何迁移，且任意两个登记不共享形状；守卫与效果引用已登记的谓词；`may_change` 命名已登记的生命周期敏感种类；事件声明 `req_unchanged: true` 且既不触碰 REQ 状态也不触碰其 owner。格式良好的表最后一并报告所有内容不一致：迁移 id 匹配 `T<NN>[a-z]` 且唯一；只有 `T19` 声明 `exempt_from_hard_stop`；`any_of` 与特殊槽值只出现在 `T15.from`、`T19.from`、`T15.actor`、`T16.to` 与 `T16.owner_after`，命名槽是已登记的状态与角色；出口从 `req_review` 出发、向前止于主链，且每个离开 `req_review` 的前向迁移都登记在某个 `tc_policy` 下；每个评审门的签署者在该状态有合法工作，且 `pass_to_enter` 命名已登记的列、主链状态与评审门；`tc_status_by_state` 恰好覆盖主链并使用已登记的 TC 状态；四个恢复目标使用互不相同的迁移与状态，各自与所命名迁移的交接一致。

### 读取推导事实

- `roleStates(table)` 把每个角色映射到它可工作的状态：命名的 actor 获得命名的 `from` 状态，命名的 `owner_after` 角色获得命名的 `to` 状态，而结构化槽（`any_of`、`current_owner`、`restore_state`、`restore_owner`）不归属任何状态。注册表的 `handles` 必须等于该投影。
- `requiredGates(table, column, status)` 累加给定列（`with_tc`、`optional_no_tc`、`exempt`）中到 `status` 为止每个主链状态的 `pass_to_enter` 节；链外状态与未知列不产生任何结果。
- `reachableStates(table, policy)` 从第一个主链状态沿前向迁移行走，仅通过该策略已登记的出口离开 `req_review`。
- `sensitiveKinds(table)` 列出 `may_change` 可命名的种类：八个 REQ 字段（`req.<field>`）、`tc_status:<status>`、`bug_status:<status>`，以及每个评审门加上 `regression` 与 `external_review` 的 `rv:<section>`。
- `statusIndex`、`legalReqStatuses`、`transitionById`、`signerOf` 与 `restoreRoles` 读取表的主链位置、完整的 REQ 状态集合、单个迁移、评审门的签署者，以及在每个恢复状态接手的角色。

### 加载 agent 注册表

`loadAgentRegistry(text, table, label = 'agent-registry.yml')` 返回 `{ registry, problems }`，并分三个阶段对照已加载的表检查注册表，在第一个出现问题的阶段之后停止。文档必须是版本 1，带 `roles` 与 `agents`，`roles` 必须等于表的角色，可选的 `provider_sets`、`seats` 与 `active_set` 必须具有其声明的类型。随后检查每个 agent 并一并报告所有 agent 问题：uid 匹配 `<role>-NNN` 且前缀为角色；`handles` 是已登记的状态且等于表为该角色推导的状态（`handles differ from the states lifecycle.yml derives for planner: extra [tc_design], missing []`）；非人类 agent 声明 `vendor`、`route { provider, model }`，以及 `effort`——它要么是 `low`、`medium`、`high`、`xhigh`、`max` 之一，要么是以已登记状态为键并带 `default` 的按状态映射；`fallbacks` 是 `{ provider, model, vendor }` 路由；没有 uid 被登记两次。最后一并检查供应商集合（`kind` 为 `same_vendor` 或 `cross_vendor`；`planner`、`generator` 与 `evaluator` 命名该角色的已注册 agent；同供应商集合保持单一供应商，跨供应商集合把 generator 与 evaluator 放在不同供应商）、`active_set`（存在集合时必填，且必须命名其中之一）以及 `seats`（已登记状态、已注册 uid 且其 `handles` 包含该状态）。

`seatFor(registry, role, state)` 返回在该状态承担该角色的 uid：席位覆盖（当其 agent 具有该角色时），否则活动集合中该角色的成员，否则处理该状态的该角色唯一已注册 agent，否则 `undefined`。`effortFor(agent, state)` 返回按状态的强度，否则默认值，对没有强度的 agent 返回 `undefined`。

### 加载 id 方案

`loadIdScheme(text, label = 'id-scheme.yml')` 返回 `{ scheme, problems }`：`scopes` 把作用域目录映射到一到六个大写字母的前缀，且没有前缀属于两个目录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明加载器如何拆分；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **每个根因一条问题。** 结构解析在第一个缺陷处停止，因为后续检查只会重复它；对格式良好的表的内容检查运行到底，使一次编辑并重新加载就能看到全部不一致。
- **推导，绝不复制。** 角色状态、所需评审门、可达状态与敏感种类都从表计算得出；注册表的 `handles` 是唯一物化的副本，加载器拒绝任何漂移。
- **固定枚举，登记词表。** 状态与角色列表是钉在代码中的格式不变量，而谓词、评审门与种类由表声明并按引用检查。
- **供应商是声明的。** `codex` 或 `claude-code` 这样的 dsh 路由是产品而非模型家族，因此同供应商与跨供应商规则读取注册表的 `vendor` 字段，绝不推断。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/types.ts`](src/types.ts) | 表、注册表与 id 方案类型；品牌化的 `TransitionId` 与 `AgentUid` |
| [`src/yaml.ts`](src/yaml.ts) | 带唯一键的单文档 YAML 读取、值守卫与 `Parsed` 结果 |
| [`src/table.ts`](src/table.ts) | `loadLifecycleTable`、固定枚举、登记与自洽检查、推导 |
| [`src/registry.ts`](src/registry.ts) | `loadAgentRegistry`、`seatFor`、`effortFor` |
| [`src/id-scheme.ts`](src/id-scheme.ts) | `loadIdScheme` |
| [`src/index.ts`](src/index.ts) | 消费方接口 |
| — | 不发布运行时不变量伴随包；库不持有可变状态或事件流，它检查的每个关系都在一次加载中判定。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当加载器契约不够时阅读这些页面。它们从本库走向它所服务的团队设计和其注册表所命名的路由。

- [生命周期团队](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.zh.md)——本库加载其表的团队设计。
- [会话后端](../../../docs/subsystems/conversation-backend.zh.md)——注册表把角色席位绑定到的 `codex` 与 `claude-code` 路由。
- [实验包](../README.zh.md)——其他生命周期包落地后出现的位置。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是表库；渲染任务简报与工具结果的编排器拥有每个模型可见事实。

#### KV Cache 影响

无；本包既不组装也不发送 harness 模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了加载器不覆盖的范围。它们是当前的包约束，不是任务积压。

- **仅版本 2**——声明其他版本的表被拒绝；不提供从更早表格式的迁移。
- **强度不对照路由检查**——所命名路由未公布的注册表强度在编排器解析路由时才被捕获，而非加载时。
- **主题形状按文本检查**——加载器检查每个形状的 `^` 锚点与所命名的迁移 id，不检查表达式能否编译或是否匹配真实提交主题。
- **人类 agent 不带路由**——`seatFor` 返回人类 uid，调用方转而询问人类，而不是生成子代理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制见上文各节与代码。夹具是 factory-tools `harness/lifecycle.yml`（版本 2）与 `harness/agent-registry.yml` 的英文翻译，以 `rv:regression` 与 `rv:external_review` 替换中文节名。问题文本由规格的变异表钉住；改一条消息就意味着改它对应的行。

</details>

**Runtime invariant:** 不发布伴随包。加载器返回值与问题，调用之间不保留状态。
