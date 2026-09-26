# 生命周期团队

[English](lifecycle-team.md) | 中文

生命周期团队让一条需求在固定的状态机中前进，参与者是三个角色 agent（Planner、Generator、Evaluator）和一位人类编排者。需求（REQ）、测试用例（TC）、缺陷（BUG）、评审记录（RV）与设计方案（PL）是工作区 `lifecycle/tasks/` 目录下的 Markdown 文件，其状态与 owner 写在 frontmatter 中，状态之间的每一次移动都是一张 YAML 表登记的迁移之一，带守卫、效果与允许改动的字段。[设计记录](../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.zh.md)拥有决策；本页记录共享词汇与接线。

## 包

| 包 | 角色 |
|---|---|
| [`dsh-experimental-lifecycle-table`](../../packages/experimental/lifecycle-table/README.zh.md) | 加载并校验 `lifecycle.yml`、`agent-registry.yml` 与 `tasks/id-scheme.yml`，并推导角色状态、所需评审门、可达状态与生命周期敏感种类 |
| [`dsh-experimental-lifecycle-work-items`](../../packages/experimental/lifecycle-work-items/README.zh.md) | 把工件解析为图，加载 `artifact-contract.yml`，对图做 lint，依据表的守卫与效果判定步骤，规划效果编辑并原子写入 |
| [`dsh-experimental-lifecycle-orchestrator`](../../packages/experimental/lifecycle-orchestrator/README.zh.md) | `ctx.lifecycle` 服务、`lifecycle_*` 工具、`/lifecycle` 命令、`lifecycle:policy` 提示词节、角色简报，以及 `lifecycle_init` 脚手架生成的英文默认文件 |
| [`dsh-experimental-lifecycle-model-fallback`](../../packages/experimental/lifecycle-model-fallback/README.zh.md) | 当请求以可跳转代码失败、且 `llm-retry` 与其他每个恢复策略都将其留为终态后，把生命周期角色子代移到其注册表条目的下一条路由，并在同一 uid 下重试该步 |
| [`dsh-experimental-lifecycle-team-profile`](../../packages/experimental/lifecycle-team-profile/README.zh.md) | 把 orchestrator 与回退组合在 dsh-base 之上并让 Ralph 保持关闭的可选 bundle；由插件管理器按 profile 开启 |

## 工作区中的文件

| 文件 | 所有者 | 内容 |
|---|---|---|
| `lifecycle/lifecycle.yml` | 表 | REQ 主链与链外状态、TC 与 BUG 状态、角色、评审门、`tc_policy` 出口、`pass_to_enter`、每个 REQ 状态允许的 TC 状态、T16 恢复目标、21 个迁移、5 个事件与谓词词汇 |
| `lifecycle/agent-registry.yml` | 表 | 角色席位：uid、角色、供应商、路由、强度、候补与每个 agent 处理的状态；供应商集与活动集；按状态的席位覆盖 |
| `lifecycle/tasks/id-scheme.yml` | 表 | 作用域目录到 id 前缀 |
| `lifecycle/artifact-contract.yml` | 工作项 | lint 读取的 REQ、TC、PL 与评审标题、标签、预算、枚举与实现词法 |
| `lifecycle/standards/*.md`、`lifecycle/GUIDE.md` | orchestrator 脚手架 | 供人阅读的规范与手册；`standards/briefs.md` 同时被机器读取为角色简报 |
| `lifecycle/tasks/**` | 工作项 | 工件：`features/<scope>/REQ-*`、`test-cases/<scope>/TC-*`、`bugs/<scope>/BUG-*`、`reviews/<scope>/RV-*`、`plans/<scope>/PL-*`，以及存放已完成 REQ 的 `archive/done`、`archive/superseded` |

## 服务与其消费方

`ctx.lifecycle` 每次调用都重新读取 Session 的工作目录：`load(cwd)` 返回四张表或全部问题，`graph(cwd)` 返回工件图，`lint(cwd, reqId?)` 返回整棵树或一条 REQ 家族的违规，`checkIn(cwd, request)` 返回三项硬停检查，`legalTransitions(cwd, reqId)` 返回当前 owner 可走的迁移，`status(cwd, reqId?)` 返回工具渲染的报告，`briefs(cwd)` 返回解析后的角色简报以及对简报与注册表 notes 的禁用短语扫描，`transition(cwd, request)` 通过表的效果应用一次迁移或生命周期事件并作为完整步骤判定，`run(agent, request, signal)` 是用新鲜角色子代带动一个 REQ 的驱动器。

模型看到 `lifecycle_init`、`lifecycle_status`、`lifecycle_check_in`、`lifecycle_lint`、`lifecycle_transition` 与 `lifecycle_run`，并在工作目录带有 `lifecycle.yml` 的 Session 中看到提示词顺序 700 处的 `lifecycle:policy` 节；角色子代看到三个只读工具和自己的简报。组合了命令注册表时，用户得到 `/lifecycle status [REQ-ID] | lint [REQ-ID] | transition REQ-ID TNN summary…`；由人类决定的迁移只在那里应用。每次 `lifecycle_lint` 运行都向调用 Session 追加一条 `lifecycle/lint` 事件；每次应用的步骤追加 `lifecycle/transition`；一次运行在每个角色子代前后追加 `lifecycle/step`，在每次向人类提问前后追加 `lifecycle/human-decision`。四者都只记录不回放：恢复的驱动器重新读取文件。

运行的每一步重新读取树，遇 `done` 或 `blocked` 停止，REQ 家族为红时以 `lint-red` 停止，否则代表 owner 行动。人类 owner 通过 `userQuestions` 得到合法迁移的选项（无人应答或回答 Stop 时为 `needs-human`）。角色 owner 从配置的 subagent provider 得到一个由注册表落座的新鲜一次性子代：路由与按状态的 effort 作为 `agentOptions`，委派工具与 orchestrator 的写入工具被拒绝，深度受限，渲染后的简报是其首条消息。子代交回一份提案（结构化输出或最后一个 JSON 代码块），点名一条迁移或事件、摘要、决定与 PR 号，或交回一个让运行以 `needs-human` 暂停的 `needsHuman` 问题。驱动器把树与子代的写入范围（其角色在该状态书写、且绑定到该 REQ 的工件种类）做 diff，在步骤前的树上判定提案的守卫，规划并原子写入效果，把到达 `done` 的 REQ 移入 `tasks/archive/done/`，把该步作为整体判定，对家族做 lint，并记录迁移；被拒或失败的步骤恢复生命周期目录下的每个字节（包括子代永不可写的表、标准与简报）并停止运行；一次运行在结束前占有工作区。一个以驱动 Session 为键的工具守卫在步骤运行期间拒绝范围外的 `write`、`edit`、`str_replace_editor` 调用；对 shell 与产品原生写入，diff 是最终的强制手段。

返回的记录是 orchestrator 的 `LifecycleLoad`、`LintReport`、`CheckInRequest` 与 `CheckInResult`、`LegalTransition`、`LifecycleStatus`、`TransitionRequest` 与 `TransitionResult`、`RunRequest`、`RunResult` 与 `PendingHuman`、`Briefs` 类型，以及 work-items 的 `ArtifactGraph`；每个都是该次调用从文件计算出的普通对象，不持有对文件的句柄。

## 三项检查

任何角色处理一条 REQ 之前：C1，REQ 文件存在；C2，调用者的 uid 是 REQ 的 `owner`；C3，REQ 的 `status` 是调用者打算工作的状态，且是调用者的注册所处理的状态之一。表标记为 `exempt_from_hard_stop` 的迁移（人类的 T19 拉回）对其 actor 角色免除 C2 与 C3；T15 由当前 owner 执行；REQ 处于 blocked 期间的回归运行与 BUG 修复、验证交接不做检查。

## 失败码

| 码 | 含义 |
|---|---|
| `NO_WORKSPACE` | 调用 Session 没有工作目录 |
| `TABLES_INVALID` | 某张表文件缺失或未能加载；问题会被列出 |
| `UNKNOWN_REQ`、`UNKNOWN_TRANSITION`、`NO_BRIEF` | 命名的 REQ、迁移 id 或角色 × 状态不存在 |
| `NO_ROUTE` | `lifecycle_init` 找不到给角色落座的模型路由，或某产品路由不公布任何模型 |
| `INVALID_SCOPE` | 作用域前缀不是 1 到 6 个大写字母 |
| `INVALID_REQUEST` | 步骤对迁移与事件二者皆无或皆有、摘要空白，或 `maxSteps` 不是正整数 |
| `DELEGATED_CALLER` | 角色子代调用了 `lifecycle_transition` 或 `lifecycle_run`；子代应交回提案 |
| `NO_PROVIDER` | 配置的 `subagentProvider` 未注册 |
| `RUN_IN_PROGRESS` | 另一次运行或手工迁移占有该工作区 |
| `HUMAN_ACTOR` | 模型请求 `lifecycle_transition` 应用由人类决定的迁移；人类运行 `/lifecycle transition` |

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxlifecycle--lifecycleservice"></a>

### `ctx.lifecycle` — `LifecycleService`

The lifecycle service and its registrations. Every method reads the files under `<cwd>/<lifecycleDir>/` afresh; nothing is cached between calls.

```ts cordis-catalog
/**
 * Whether the working directory carries a lifecycle table.
 * @param cwd - the absolute workspace directory.
 * @returns `true` when `<cwd>/<dir>/lifecycle.yml` exists.
 */
hasTables(cwd: string): boolean

/**
 * Load the role briefs of a workspace from `<dir>/standards/briefs.md`,
 * checked against the table's role states and, with the registry's agent
 * notes, scanned for the phrases the prompting gates forbid.
 * @param cwd - the absolute workspace directory.
 * @returns the briefs, or every problem (the tables' problems first).
 */
briefs(cwd: string): { readonly briefs: Briefs | undefined; readonly problems: readonly string[] }

/**
 * Load the four tables of a workspace.
 * @param cwd - the absolute workspace directory.
 * @returns the tables, or every problem that prevented them.
 */
load(cwd: string): LifecycleLoad

/**
 * The artifact graph of a workspace.
 * @param cwd - the absolute workspace directory.
 * @returns the graph of `<dir>/tasks/`.
 * @throws `TABLES_INVALID` when the tables did not load.
 */
graph(cwd: string): ArtifactGraph

/**
 * Lint the workspace's artifacts.
 * @param cwd - the absolute workspace directory.
 * @param reqId - when given, keep only the violations of that REQ's files.
 * @returns the violations and their count per rule.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
lint(cwd: string, reqId?: string): LintReport

/**
 * Run the hard-stop checks for one caller on one REQ.
 * @param cwd - the absolute workspace directory.
 * @param request - who checks in, on which REQ, in which state, for which transition.
 * @returns the three checks and the verdict.
 * @throws `TABLES_INVALID` or `UNKNOWN_TRANSITION`.
 */
checkIn(cwd: string, request: CheckInRequest): CheckInResult

/**
 * The transitions the current owner of a REQ may take.
 * @param cwd - the absolute workspace directory.
 * @param reqId - the REQ.
 * @returns the transitions in table order.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
legalTransitions(cwd: string, reqId: string): LegalTransition[]

/**
 * Apply one transition or lifecycle event to a REQ by hand: guards judged
 * on the current tree, effects written atomically, the step and the REQ
 * family linted, and every file restored when the result is red.
 * @param cwd - the absolute workspace directory.
 * @param request - the REQ, the step, the summary, and the decisions.
 * @returns what was applied, or the violations with nothing written.
 */
transition(cwd: string, request: TransitionRequest): Promise<TransitionResult>

/**
 * Drive one REQ through fresh role children from the agent's Session
 * working directory, logging every step, transition, and human decision
 * to the agent's Session.
 * @param agent - the root agent that drives; its Session must have a working directory.
 * @param request - the REQ and the optional step ceiling.
 * @param signal - abort cancels the running child and ends the run.
 * @returns the run report.
 * @throws LifecycleError `NO_WORKSPACE` without a working directory, `RUN_IN_PROGRESS` while another run or transition owns
 * the workspace; the driver's own codes otherwise.
 */
async run(agent: Agent, request: RunRequest, signal: AbortSignal): Promise<RunResult>

/**
 * The lifecycle position of one REQ or of every REQ.
 * @param cwd - the absolute workspace directory.
 * @param reqId - when given, report that REQ only.
 * @returns the report.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
status(cwd: string, reqId?: string): LifecycleStatus
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/lifecycle-orchestrator/src/index.ts`](../../packages/experimental/lifecycle-orchestrator/src/index.ts)
<!-- END GENERATED cordis-surface -->
