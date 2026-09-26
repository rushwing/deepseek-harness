---
description: "面向用户与维护者的生命周期团队 orchestrator：读取工作区生命周期表与工件的 ctx.lifecycle 服务、lifecycle_init / lifecycle_status / lifecycle_check_in / lifecycle_lint 工具、/lifecycle 命令、lifecycle:policy 提示词段、角色简报，以及脚手架写入的英文默认文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-lifecycle-orchestrator

[English](README.md) | 中文

## 概述

本插件为 Session 提供生命周期团队的只读表面。`ctx.lifecycle` 加载 Session 工作目录下 `lifecycle/` 中的表与工件，对其做 lint，运行角色在处理需求（REQ）前必须通过的三项硬停检查，列出当前 owner 可走的迁移，并解析角色简报。模型通过 `lifecycle_init`、`lifecycle_status`、`lifecycle_check_in`、`lifecycle_lint` 以及生命周期工作区中的 `lifecycle:policy` 段接触它；用户通过 `/lifecycle`。除 `lifecycle_init` 创建的脚手架和每次 lint 记录的 `lifecycle/lint` 事件之外，它不写任何东西。

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

插件注入 `tools` 与 `systemPrompt`；仅当组合了 `commands` 服务时才注册 `/lifecycle`，`lifecycle_init` 在执行时按需读取 `llm` 与 `agentDefaultModel`。

### 搭建工作区

`lifecycle_init` 把英文默认文件写到 `<cwd>/<lifecycleDir>/` 下，并保留每个已存在的文件：`lifecycle.yml`（版本 2 的表）、`agent-registry.yml`、`artifact-contract.yml`，以及 `tasks/id-scheme.yml`（scope 来自 `scopes` 参数，默认 `{ core: CORE }`；前缀为 1 到 6 个大写字母）。`scaffold: full` 额外写入 `GUIDE.md`、五份标准与 `standards/briefs.md`。注册表按部署拥有的路由为角色落座：当 `claude-code` 与 `codex` 两条路由都发布了模型时，生成跨厂商集合（`mixed`，Planner 与 Generator 在 Claude Code、Evaluator 在 Codex，`tc_impl_review` 落到同厂商 Evaluator）并附同厂商回退集合；否则生成落在 agent 默认模型上的同厂商集合。模型名来自路由目录或默认选择，从不猜测；没有模型的路由或没有任何路由的部署以 `NO_ROUTE` 失败。

### 读取工作区

- `lifecycle_status { reqId? }` 报告一个或全部 REQ：状态、owner 与 owner 角色、评审轮次、`tc_policy`、blocked 字段、下一步行动的座位，以及当前 owner 可走的迁移（T16 的恢复槽位由记录的配对解析）。
- `lifecycle_check_in { reqId, uid, state, transition? }` 运行三项检查：C1 REQ 文件存在，C2 uid 是其 owner，C3 REQ 处于 `state` 且该 uid 的注册处理该状态。表中标记 `exempt_from_hard_stop` 的迁移让其行动角色通过 C2 与 C3。
- `lifecycle_lint { reqId? }` 对整棵树或一个 REQ 的家族（该 REQ、其 TC、RV、PL，以及它携带或阻塞它的 BUG）做 lint，并追加带计数的 `lifecycle/lint` 事件。
- `/lifecycle status [REQ-ID]` 与 `/lifecycle lint [REQ-ID]` 为用户渲染同样的报告；其他输入回以用法行。

每次调用都重新读取文件。没有工作目录的 Session 以 `NO_WORKSPACE` 失败；无法加载的表以 `TABLES_INVALID` 失败并列出每个问题；未知 REQ 或迁移以 `UNKNOWN_REQ` 或 `UNKNOWN_TRANSITION` 失败。

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
- **角色提案，orchestrator 应用。** 简报告诉角色子代永不移动 frontmatter 状态；交接要求它给出迁移提案，由驱动器应用并 lint。
- **响亮失败，不写东西。** 缺失或无效的表、未知 id、无法落座的角色都是带稳定代码的错误；`lifecycle_init` 写入前先规划每个文件，且只写不存在的文件。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `LifecycleService`（`ctx.lifecycle`）、Config、工具与段注册、`/lifecycle` 命令 |
| [`src/workspace.ts`](src/workspace.ts) | 加载四张表、图、lint 范围、签到、合法迁移与状态报告 |
| [`src/tools.ts`](src/tools.ts)、[`src/tools/init.ts`](src/tools/init.ts) | 三个只读工具；脚手架及其注册表规划器 |
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

在工作目录带有 `<lifecycleDir>/lifecycle.yml` 的 Session 中，模型在第一方提示词顺序 700 看到 `lifecycle:policy` 段；其他 Session 什么都看不到。

##### 该字段的逐字文本，目录为 `lifecycle`

```markdown
This workspace runs the lifecycle team process from `lifecycle/`. Requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL) live under `lifecycle/tasks/`; their standards live under `lifecycle/standards/`.
Use `lifecycle_status` to read a REQ's state, owner, and legal transitions, `lifecycle_check_in` before working on a REQ as a role, and `lifecycle_lint` before handing artifacts over.
Never edit `status`, `owner`, `review_round`, `pending_bugs`, or the `blocked_*` frontmatter fields by hand: lifecycle transitions move them.
```

#### Token 影响

生命周期工作区的每个请求固定三句；其他地方为零。

#### KV Cache 影响

该段对一个工作区是稳定的；创建或移除表会从顺序 700 起改变提示词。

### 生命周期工具 schema

#### 模型看到什么

生成的 [`lifecycle_init`、`lifecycle_status`、`lifecycle_check_in`、`lifecycle_lint` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-experimental-lifecycle-orchestrator)。结果渲染为每个 REQ 一行状态（`REQ-PLAT-010: draft, owner human-001 (human), seat human-001; legal transitions T01, T19`）、点名每项失败检查的签到裁定、lint 裁定后跟每条违规一行 `- file [rule]: message`，以及脚手架的创建与保留计数。

#### Token 影响

工具可见处的固定 schema 成本；lint 结果随违规数增长，状态结果随报告的 REQ 数增长。

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

- **尚无驱动器** — 没有任何东西生成角色子代或应用迁移；简报可渲染、谓词可判断，但 `lifecycle_run` 与 `lifecycle_transition` 未注册。
- **每个 Session 一个生命周期目录** — 目录是插件级设置；两个布局不同的工作区需要两套部署。
- **脚手架路由按产品形态识别** — `lifecycle_init` 识别 `claude-code` 与 `codex` 路由以生成跨厂商集合，其余一律以 `effort: high` 落到默认模型；effort 在步骤首次解析路由时校验，而非脚手架时。
- **仅英文默认文件** — 脚手架写入英文的表、契约、标准与简报；团队在工作区内翻译或编辑它们。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性 — 交付行为与限制以上文各节和代码为准。`src/defaults/` 下的默认文件是 factory-tools 文档的译文；`briefs.ts` 改写了交接，让角色提出迁移而非自行提交，原件的 Codex CLI 调用契约不再沿用，因为路由取代了它。`tests/fixtures/workspace/` 下的固件工作区是 lifecycle-work-items 的固件加默认简报；其注册表备注避免引用禁用短语。

</details>

**运行时不变量：** 不发布伴随件。服务不持有状态；每份报告都在调用时基于文件计算。
