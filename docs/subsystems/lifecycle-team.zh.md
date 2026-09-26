# 生命周期团队

[English](lifecycle-team.md) | 中文

生命周期团队让一条需求在固定的状态机中前进，参与者是三个角色 agent（Planner、Generator、Evaluator）和一位人类编排者。需求（REQ）、测试用例（TC）、缺陷（BUG）、评审记录（RV）与设计方案（PL）是工作区 `lifecycle/tasks/` 目录下的 Markdown 文件，其状态与 owner 写在 frontmatter 中，状态之间的每一次移动都是一张 YAML 表登记的迁移之一，带守卫、效果与允许改动的字段。[设计记录](../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.zh.md)拥有决策；本页记录共享词汇与接线。

## 包

| 包 | 角色 |
|---|---|
| [`dsh-experimental-lifecycle-table`](../../packages/experimental/lifecycle-table/README.zh.md) | 加载并校验 `lifecycle.yml`、`agent-registry.yml` 与 `tasks/id-scheme.yml`，并推导角色状态、所需评审门、可达状态与生命周期敏感种类 |
| [`dsh-experimental-lifecycle-work-items`](../../packages/experimental/lifecycle-work-items/README.zh.md) | 把工件解析为图，加载 `artifact-contract.yml`，对图做 lint，依据表的守卫与效果判定步骤，规划效果编辑并原子写入 |
| [`dsh-experimental-lifecycle-orchestrator`](../../packages/experimental/lifecycle-orchestrator/README.zh.md) | `ctx.lifecycle` 服务、`lifecycle_*` 工具、`/lifecycle` 命令、`lifecycle:policy` 提示词节、角色简报，以及 `lifecycle_init` 脚手架生成的英文默认文件 |

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

`ctx.lifecycle` 每次调用都重新读取 Session 的工作目录：`load(cwd)` 返回四张表或全部问题，`graph(cwd)` 返回工件图，`lint(cwd, reqId?)` 返回整棵树或一条 REQ 家族的违规，`checkIn(cwd, request)` 返回三项硬停检查，`legalTransitions(cwd, reqId)` 返回当前 owner 可走的迁移，`status(cwd, reqId?)` 返回工具渲染的报告，`briefs(cwd)` 返回解析后的角色简报以及对简报与注册表 notes 的禁用短语扫描。

模型看到 `lifecycle_init`、`lifecycle_status`、`lifecycle_check_in` 与 `lifecycle_lint`，并在工作目录带有 `lifecycle.yml` 的 Session 中看到提示词顺序 700 处的 `lifecycle:policy` 节。组合了命令注册表时，用户得到 `/lifecycle status [REQ-ID] | lint [REQ-ID]`。每次 `lifecycle_lint` 运行都向调用 Session 追加一条 `lifecycle/lint` 事件。

返回的记录是 orchestrator 的 `LifecycleLoad`、`LintReport`、`CheckInRequest` 与 `CheckInResult`、`LegalTransition`、`LifecycleStatus`、`Briefs` 类型，以及 work-items 的 `ArtifactGraph`；每个都是该次调用从文件计算出的普通对象，不持有对文件的句柄。

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
 * The lifecycle position of one REQ or of every REQ.
 * @param cwd - the absolute workspace directory.
 * @param reqId - when given, report that REQ only.
 * @returns the report.
 * @throws `TABLES_INVALID` or `UNKNOWN_REQ`.
 */
status(cwd: string, reqId?: string): LifecycleStatus
```

Source: [`packages/experimental/lifecycle-orchestrator/src/index.ts`](../../packages/experimental/lifecycle-orchestrator/src/index.ts)
<!-- END GENERATED cordis-surface -->
