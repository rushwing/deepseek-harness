---
description: "面向用户与维护者的生命周期团队 orchestrator：读取工作区生命周期表与工件并用新鲜角色子代驱动 REQ 的 ctx.lifecycle 服务、lifecycle_init / lifecycle_status / lifecycle_check_in / lifecycle_lint / lifecycle_transition / lifecycle_run 工具、/lifecycle 命令、lifecycle:policy 提示词段、写入守卫、角色简报，以及脚手架写入的英文默认文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-lifecycle-orchestrator

[English](README.md) | 中文

## 概述

本插件为 Session 提供生命周期团队。`ctx.lifecycle` 加载 Session 工作目录下 `lifecycle/` 中的表与工件，对其做 lint，列出 REQ 的 owner 可走的迁移，通过表的效果应用一次迁移或生命周期事件，并用新鲜的角色子代驱动 REQ：子代的编辑被围在自己的工件之内，其迁移提案由它判定、应用并 lint。模型通过六个 `lifecycle_*` 工具和 `lifecycle:policy` 段接触它；用户通过 `/lifecycle`。每个步骤、迁移与人类决定都是只记录的 Session 事件；文件始终是唯一真相。

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
| `lifecycleDir` | `lifecycle` | 相对于 Session 工作目录的目录，存放 `lifecycle.yml`、`agent-registry.yml`、`artifact-contract.yml`、`tasks/` 与 `standards/`。空白值在加载时失败。 |
| `maxStepsPerRun` | `8` | 一次 `lifecycle_run` 最多走的步数；调用的 `maxSteps` 只能降低它。 |
| `delegationToolNames` | `subagent`、`workflow`、`ralph`、`spawn_teammate`、`send_message`、`interrupt_agent` | 对角色子代拒绝的工具，使子代永不再委派；orchestrator 自己的 `lifecycle_run`、`lifecycle_transition`、`lifecycle_init` 总是一并拒绝。部署未组合的名字不拒绝任何东西。空白名字在加载时失败。 |
| `humanDecisions` | `ask` | `ask` 在组合了 `userQuestions` 服务且有人应答时把人类拥有的 REQ 的合法迁移交给它，否则以 `needs-human` 停止；`stop` 从不询问。 |
| `stepTimeoutMs` | `1800000` | 角色子代超过此时长即被中止；该步失败，不应用任何东西。 |
| `proposalChannel` | `auto` | `auto` 向支持的 provider 请求结构化输出，否则读取子代最终文本中最后一个 ```json 代码块；`text` 总是读取文本。 |
| `subagentProvider` | `spawn` | 运行角色子代的 subagent provider；未注册的名字在首次运行时以 `NO_PROVIDER` 失败。 |

插件注入 `tools`、`systemPrompt` 与 `subagents`；仅当组合了 `commands` 服务时才注册 `/lifecycle`，`lifecycle_init` 在执行时按需读取 `llm` 与 `agentDefaultModel`，`lifecycle_run` 同样按需读取 `userQuestions`。

### 搭建工作区

`lifecycle_init` 把英文默认文件写到 `<cwd>/<lifecycleDir>/` 下，并保留每个已存在的文件：`lifecycle.yml`（版本 2 的表）、`agent-registry.yml`、`artifact-contract.yml`，以及 `tasks/id-scheme.yml`（scope 来自 `scopes` 参数，默认 `{ core: CORE }`；前缀为 1 到 6 个大写字母）。`scaffold: full` 额外写入 `GUIDE.md`、五份标准与 `standards/briefs.md`。注册表按部署拥有的路由为角色落座：当 `claude-code` 与 `codex` 两条路由都发布了模型时，生成跨厂商集合（`mixed`，Planner 与 Generator 在 Claude Code、Evaluator 在 Codex，`tc_impl_review` 落到同厂商 Evaluator）并附同厂商回退集合；否则生成落在 agent 默认模型上的同厂商集合。模型名来自路由目录或默认选择，从不猜测；没有模型的路由或没有任何路由的部署以 `NO_ROUTE` 失败。

### 读取、推进与驱动工作区

- `lifecycle_status { reqId? }` 报告一个或全部 REQ：状态、owner 与 owner 角色、评审轮次、`tc_policy`、blocked 字段、下一步行动的座位，以及当前 owner 可走的迁移（T16 的恢复槽位由记录的配对解析）。
- `lifecycle_check_in { reqId, uid, state, transition? }` 运行三项检查：C1 REQ 文件存在，C2 uid 是其 owner，C3 REQ 处于 `state` 且该 uid 的注册处理该状态。表中标记 `exempt_from_hard_stop` 的迁移让其行动角色通过 C2 与 C3。
- `lifecycle_lint { reqId? }` 对整棵树或一个 REQ 的家族（该 REQ、其 TC、RV、PL，以及它携带或阻塞它的 BUG）做 lint，并追加带计数的 `lifecycle/lint` 事件。
- `lifecycle_transition { reqId, transition? | event?, summary, decisions?, pr? }` 手工应用一次迁移（如 `T01`）或生命周期事件（如 `bug_fix`）：在当前树上判定守卫，效果原子地重写 REQ frontmatter 以及范围内 TC 与 BUG 的状态，到达 `done` 的 REQ 移入 `tasks/archive/done/`，结果作为完整步骤判定并在 REQ 家族内 lint。红色结果恢复每个字节并返回违规；已应用的结果返回文件、之后的 owner 与建议的提交主题 `lifecycle: <id> — <summary>`。由人类提交。
- `lifecycle_run { reqId, maxSteps? }` 驱动一个 REQ：每一步重新读取树，遇 `done` 或 `blocked` 停止，家族为红时以 `lint-red` 停止，否则代表 owner 行动。人类 owner 被询问适用哪条合法迁移（无人应答或人类回答 Stop 时为 `needs-human`）；角色 owner 得到一个由注册表落座的新鲜一次性子代（来自其路由与按状态 effort 的 `agentOptions`、拒绝委派工具、限制深度、以其简报为首条消息），其交接是一份迁移提案。子代的编辑与其写入范围做 diff，提案像 `lifecycle_transition` 一样判定并应用，被拒或失败的步骤恢复树并停止运行。结果列出每一步的 uid、状态、迁移与结果、停止原因（`done`、`blocked`、`needs-human`、`rejected`、`lint-red`、`max-steps`、`failed`）、待决的人类决定，以及违规。
- `/lifecycle status [REQ-ID]` 与 `/lifecycle lint [REQ-ID]` 为用户渲染同样的报告；其他输入回以用法行。

每次调用都重新读取文件。没有工作目录的 Session 以 `NO_WORKSPACE` 失败；无法加载的表以 `TABLES_INVALID` 失败并列出每个问题；未知 REQ 或迁移以 `UNKNOWN_REQ` 或 `UNKNOWN_TRANSITION` 失败；迁移与事件二者皆无或皆有、摘要空白、`maxSteps` 非正整数的请求以 `INVALID_REQUEST` 失败；被委派的子代调用 `lifecycle_transition` 或 `lifecycle_run` 以 `DELEGATED_CALLER` 失败。

### 写入范围

角色子代只能创建或编辑它所处理 REQ 的工件，且只限其角色在该状态下书写的种类：Planner 在 `req_review` 写 REQ 及其 PL；Evaluator 在 `req_review`、`tc_impl_review`、`req_impl_review` 写 RV 与新 BUG，在 `tc_design` 写该 REQ 的 TC 以及 REQ（其 `test_case_ref`）；Generator 在 `tc_review` 写 RV，在 `tc_impl` 写 TC，在 `req_impl` 写 BUG 与 TC。归档工件与表从不被写；`tasks/` 之外的文件（产品代码、测试）不受围栏。两种机制强制该范围：一个工具守卫在步骤运行期间拒绝目标位于树内却超出范围的 `write`、`edit`、`str_replace_editor` 调用，以驱动 Session 为键，因而子代在存在之前就已被围住；步骤后的 diff 在范围外有任何变化或新 BUG 未指名该 REQ时拒绝该步并恢复每个文件。对 shell 写入以及原生工具绕过 harness 的产品后端子代，diff 是唯一的强制手段。

### 简报

`ctx.lifecycle.briefs(cwd)` 解析 `<lifecycleDir>/standards/briefs.md`：表推导出的每个非人类角色 × 状态各有一节 `## <role> @ <state>`，每节含八个字段 `When to use`、`Three checks before starting`、`What to read`、`What to write and where`、`Writing style`、`Checklist`、`Prohibited`、`Deliverable`，另有共享节 `Review checklist`、`Blocking and release (T15 / T16)`、`Deferred verification (regression runs for integration TCs lacking samples)` 与 `General prohibitions`。缺少字段或小节、某角色不在其中工作的状态却有小节、简报或注册表 agent 的 `notes` 中出现禁用短语，都是问题。`renderBrief(briefs, request)` 组装角色子代的首条消息：点名 uid、REQ 与状态的标题、引言、八个字段、交接（角色不得触碰的 frontmatter 字段、合法迁移、以及结尾的 JSON 提案代码块）、简报引用的共享节、通用禁令，以及注册表备注。

禁用短语即提示词门禁所禁止的：`only report high-severity`、`be conservative`、`don't nitpick`、`double-check your answer`、`one more verification pass`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

本节说明插件如何拆分；可观察行为见[使用本插件](#use-this-plugin)。

### 设计理念

- **文件是唯一真相。** 每个方法都重新读取工作目录；跨调用不缓存任何东西，恢复的 Session 看到的就是磁盘上的内容。
- **库来判断，插件来暴露。** 加载、lint 与谓词位于 `lifecycle-table` 与 `lifecycle-work-items`；本包添加面向 Session 的表面、简报与脚手架。
- **角色提案，orchestrator 应用。** 简报告诉角色子代永不移动 frontmatter 状态；交接是一份迁移提案（结构化输出或最后一个 JSON 代码块），由驱动器对照表判定、应用并 lint；红色结果恢复该步触碰的每个字节。
- **双重围栏。** 工具守卫在步骤运行期间拒绝范围外写入；步骤后的 diff 捕获绕过工具的部分，是最终的强制手段。
- **响亮失败，不写东西。** 缺失或无效的表、未知 id、无法落座的角色都是带稳定代码的错误；`lifecycle_init` 写入前先规划每个文件，且只写不存在的文件。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `LifecycleService`（`ctx.lifecycle`）、Config、工具与段注册、`/lifecycle` 命令 |
| [`src/workspace.ts`](src/workspace.ts) | 加载四张表、图、lint 范围、签到、合法迁移与状态报告 |
| [`src/tools.ts`](src/tools.ts)、[`src/tools/init.ts`](src/tools/init.ts) | 三个只读工具；脚手架及其注册表规划器 |
| [`src/tools/transition.ts`](src/tools/transition.ts)、[`src/tools/run.ts`](src/tools/run.ts) | 手工应用的步骤与驱动器工具，均仅限根 agent |
| [`src/driver.ts`](src/driver.ts) | 运行循环：人类决定、新鲜角色子代、提案、范围 diff、应用、回滚 |
| [`src/scope.ts`](src/scope.ts)、[`src/write-guard.ts`](src/write-guard.ts)、[`src/tree.ts`](src/tree.ts) | 写入范围及其判定；工具守卫；树快照、diff 与恢复 |
| [`src/proposal.ts`](src/proposal.ts)、[`src/human.ts`](src/human.ts) | 提案 schema 与解析器；向人类提出的问题 |
| [`src/briefs/parse.ts`](src/briefs/parse.ts)、[`src/briefs/render.ts`](src/briefs/render.ts) | 简报格式与禁用短语扫描；渲染后的首条消息 |
| [`src/render.ts`](src/render.ts)、[`src/section.ts`](src/section.ts) | 工具与命令文本；策略段 |
| [`src/defaults/`](src/defaults/) | 脚手架写入的英文表、契约、标准、手册与简报 |
| [`src/events.ts`](src/events.ts)、[`src/errors.ts`](src/errors.ts) | `lifecycle/lint` 事件；`LifecycleError` 及其代码 |
| — | 不发布运行时不变量伴随件；服务不持有状态，它报告的每个关系都在一次调用中基于文件判定。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当工具契约不够时读这些页面。它们从本插件延伸到它暴露的库以及它服务的团队设计。

- [生命周期团队](../../../docs/subsystems/lifecycle-team.zh.md) — 工作区文件、服务、三项检查与失败代码。
- [生命周期表](../lifecycle-table/README.zh.md)与[生命周期工作项](../lifecycle-work-items/README.zh.md) — 每份报告背后的加载器、规则与谓词。
- [生命周期团队设计](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.zh.md) — 决策记录。

-----

<a id="model-experience"></a>
## 模型体验

### 生命周期策略系统提示词

#### 模型看到什么

在工作目录带有 `<lifecycleDir>/lifecycle.yml` 的 Session 中，模型在第一方提示词顺序 700 看到 `lifecycle:policy` 段；其他 Session 什么都看不到。角色子代看到同一段，外加作为首条用户消息的简报。

##### 该字段的逐字文本，目录为 `lifecycle`

```markdown
This workspace runs the lifecycle team process from `lifecycle/`. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) live under `lifecycle/tasks/`; their standards live under `lifecycle/standards/`.
Use `lifecycle_status` to read a REQ's state, owner, and legal transitions, `lifecycle_check_in` before working on a REQ as a role, and `lifecycle_lint` before handing artifacts over.
Never edit `status`, `owner`, `review_round`, `pending_bugs`, or the `blocked_*` frontmatter fields by hand: lifecycle transitions move them.
Use `lifecycle_run` only when asked to drive a REQ; it spawns one role child per step and applies the proposed transitions. `lifecycle_transition` applies one transition or lifecycle event the human decided.
```

#### Token 影响

生命周期工作区的每个请求固定四句；其他地方为零。

#### KV Cache 影响

该段对一个工作区是稳定的；创建或移除表会从顺序 700 起改变提示词。

### 生命周期工具 schema

#### 模型看到什么

生成的[六个 `lifecycle_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-lifecycle-orchestrator)；角色子代只看到 `lifecycle_status`、`lifecycle_check_in`、`lifecycle_lint`。结果渲染为每个 REQ 一行状态（`REQ-PLAT-010: draft, owner human-001 (human), seat human-001; legal transitions T01, T19`）、点名每项失败检查的签到裁定、lint 裁定后跟每条违规一行 `- file [rule]: message`、脚手架的创建与保留计数、`Applied T01 on REQ-PLAT-010: draft → req_review, owner planner-001. Commit subject: lifecycle: T01 — Start the review` 或 `Rejected T14 on REQ-PLAT-010: 1 violation` 加每条违规一行，以及运行标题 `Lifecycle run on REQ-PLAT-010 stopped: done after 10 steps` 后跟每步一行 `- uid @ state: transition outcome`。

#### Token 影响

工具可见处的固定 schema 成本；lint 或拒绝结果随违规数增长，状态结果随报告的 REQ 数增长，运行结果随步数增长。每个角色子代都是新鲜 Session，为其简报付费一次。

#### KV Cache 影响

schema 稳定；结果按常规延长对话。

### 人类命令

#### 模型看到什么

`/lifecycle` 及其结果留在模型历史之外。

#### Token 影响

无 token：命令及其报告从不进入请求。

#### KV Cache 影响

无影响：命令不改变提示词与对话。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定只读表面不做的事。它们是当前的包约束，不是任务积压。

- **写入范围存于代码** — 每个角色在每个状态书写的种类反映简报，但它是 `src/scope.ts` 中的固定表，不是工作区数据；改动简报"What to write and where"的团队需要修改本包。
- **产品后端子代只受 diff 围栏** — `codex` 与 `claude-code` 路由运行绕过 harness 工具守卫的原生工具，其范围外编辑在步骤后被捕获并回滚，而非在进行中被拒绝；任何子代的 shell 写入亦然。
- **每个驱动 Session 一次只走一步** — 守卫为当前步骤围住驱动 Session 的全部子代；同一 Session 中两次并发的 `lifecycle_run` 共用一个围栏。
- **只归档 REQ 文件** — 到达 `done` 的 REQ 移入 `tasks/archive/done/`；其 TC、RV 与 PL 留在原目录，与 lint 的预期一致。
- **人类决定只选迁移** — 人类选择一条合法迁移 id 或 Stop；需要决定的迁移（如 `T15` 的阻塞字段）由当前 owner 的子代提案，或通过 `lifecycle_transition` 手工应用。
- **尚无录制 Session 快照** — 驱动器有单元覆盖与 Loader 组合测试；手写的 `snapshots/session/lifecycle-team-run/` 用例随拥有其组合的 profile bundle 一起落地。
- **每个 Session 一个生命周期目录** — 目录是插件级设置；两个布局不同的工作区需要两套部署。
- **脚手架路由按产品形态识别** — `lifecycle_init` 识别 `claude-code` 与 `codex` 路由以生成跨厂商集合，其余一律以 `effort: high` 落到默认模型；effort 在步骤首次解析路由时校验，而非脚手架时。
- **仅英文默认文件** — 脚手架写入英文的表、契约、标准与简报；团队在工作区内翻译或编辑它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性 — 交付行为与限制以上文各节和代码为准。`src/defaults/` 下的默认文件是 factory-tools 文档的译文；`briefs.ts` 改写了交接，让角色提出迁移而非自行提交，原件的 Codex CLI 调用契约不再沿用，因为路由取代了它。`tests/fixtures/workspace/` 下的固件工作区是 lifecycle-work-items 的固件加默认简报；其注册表备注避免引用禁用短语。驱动器测试通过一个脚本化的 subagent provider（`tests/driver-helper.ts`）扮演角色子代，它编辑工作区并交回提案，并通过脚本化的 `userQuestions` 服务代答人类；主路径用十步把 REQ-PLAT-010 从 draft 带到 done。驱动器以 REQ owner 的身份行动，因此家族 lint 之后三项硬停检查按构造成立；`lifecycle_check_in` 仍是角色为自己调用的工具。

</details>

**运行时不变量：** 不发布伴随件。服务不持有状态；每份报告都在调用时基于文件计算。
