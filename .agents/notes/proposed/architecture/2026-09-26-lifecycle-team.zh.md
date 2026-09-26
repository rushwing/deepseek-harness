# Agent Note: Lifecycle team

Status: proposed

[English](2026-09-26-lifecycle-team.md) | 中文

## Problem

`NVIDIA-dev/factory-tools` 仓库用一套文档驱动的方法开发自身：需求、测试用例、缺陷、评审记录和设计稿都是带 YAML frontmatter 的 Markdown 文件，工作靠文件状态（`status` 与 `owner`）流转而不靠会话记忆。三个模型角色在人类编排者之下工作：Planner 成形需求，Generator 实现测试与产品代码，Evaluator 编写验收测试并评审每个阶段。注册表把每个角色绑定到模型、推理投入和候补；生命周期表声明状态、带守卫与效果的 21 条转移以及仅限人类的转移；角色任务书说明每个角色在每个状态读什么、写什么、交付什么；Python 门禁校验工件。

如今该团队以一个 Claude Code 会话运行，为每个角色派生一个 subagent，并通过 CLI 调用 Codex，整套方法用中文书写且绑定于一个仓库。dsh 具备该方法所需的部件——带每子代路由与人格的 subagent 运行时、人类审批与提问服务、持久会话事件、文件系统工具——但没有生命周期概念、每角色注册表和模型候补。使用者希望这个团队以产品特性的形式、用英文提供给任何 dsh 工作区，角色 agent 运行在 [conversation-backend Agent Note](2026-09-26-external-agent-conversation-backends.zh.md) 新增的 Codex 与 Claude Code 路由上。

## Proposal

把该方法交付为五个名为 **lifecycle** 的实验性包（源名称 "harness" 与产品名冲突），由一个可选 bundle 组合。

`<workspace>/lifecycle/` 下的文件仍是唯一真值：`lifecycle.yml`（状态表）、`agent-registry.yml`（角色、agent、provider set、席位）、`tasks/id-scheme.yml`、`artifact-contract.yml`（英文标题、预算、验收条目格式、禁用实现词法、评审字段）、`standards/*.md` 以及 `tasks/{features,test-cases,bugs,reviews,plans}/<scope>/`。`lifecycle_init` 工具用英文搭建这些文件，并写出路由取自 profile 实际注册的提供者的注册表。

一个确定性驱动器每次运行一个生命周期步骤。它加载并校验四个 YAML 文件，把工作项解析为图并校验，读取需求的 `status` 和 `owner`，从表推导所有者角色与合法转移，然后在所有者角色为 `human` 时通过 `ctx.userQuestions` 询问人类，否则通过 `ctx.subagents.start` 为就座角色派生一个新的一次性子代，带注册表的路由、模型和推理投入、渲染好的英文任务书作为提示词、拒绝委派工具并限制深度。子代只编辑自己的工件并返回一个转移提议；驱动器把工作区差量与角色写作用域比对，按步骤前的图求值转移守卫，原子地施加效果，重新校验，并追加 `lifecycle/transition`。任何违规都回滚该步骤。没有应答者时驱动器以 `needs-human` 停止且不写任何东西；它绝不代人类批准。每个已施加的转移附带建议的提交主题；由人类提交。

六个工具暴露该方法：`lifecycle_init`、`lifecycle_status`、`lifecycle_check_in`（开工检查：需求存在、调用者持有它、其状态对该角色合法）、`lifecycle_lint`、`lifecycle_transition`（手工与人类路径）和 `lifecycle_run`（最多驱动 N 步）。子代只看到前四个加普通工作区工具。`lifecycle-model-fallback` 插件在 `agent/request-error` 上遍历注册表 agent 的候补，并在 `agent/request` 上为带标签的子代改写路由，在 `llm-retry` 耗尽同路由重试之后生效。

### Package topology

| 包（`@deepseek-ai/dsh-experimental-…`） | 角色 | 依赖 |
|---|---|---|
| `lifecycle-table` | 库：表类型、每个根因一条问题的加载器、推导（角色合法状态、所需评审门、可达状态）、注册表加载与校验 | `dsh-brand`、`dsh-util-values`、`yaml` |
| `lifecycle-work-items` | 库：frontmatter 与正文解析器、工件图、契约加载器、校验规则组、守卫与效果谓词、带回滚的原子效果写入器 | `lifecycle-table` |
| `lifecycle-orchestrator` | 服务 `ctx.lifecycle`、六个工具、`/lifecycle` 命令、任务书、写守卫、会话事件、英文默认模板 | `dsh-tools`、`dsh-subagent`、`dsh-fs`、`dsh-session`、两个库 |
| `lifecycle-model-fallback` | 注册表候补的循环策略插件 | `dsh-agent`、`dsh-llm`、`lifecycle-table` |
| `lifecycle-team-profile` | 组合四个插件并禁用重叠的 `ralph` 工具的可选 bundle | 以上全部 |

### Durable events

`lifecycle/step`、`lifecycle/transition`、`lifecycle/lint` 和 `lifecycle/human-decision` 作为仅记日志的事件加入 `SessionEventMap`，追加到驱动器的会话。文件是真值，回放幂等：恢复的驱动器重新读文件，绝不从事件重放施加。

### Separation invariants

注册表加载器拒绝同一 uid 兼任 Generator 与 Evaluator、Generator 与 Evaluator 同厂商的跨厂商 set、与表为该角色推导出的状态不一致的 `handles`，以及 uid 角色不符的席位。一个 uid 每步运行一个子代，不向下委派。子代只能编辑其角色在该状态拥有的工件；第一方写工具受守卫，步骤后的差量与回滚覆盖产品原生工具和 shell 写入。

### Artifact lints

从源门禁移植的规则组为 frontmatter、归属、阻塞字段、需求正文（七个有序标题、预算、验收条目格式、待裁决格式、实现词法）、测试用例、评审记录、生命周期一致性、链接以及表与注册表一致性。术语表与规范镜像检查暂缓。git 提交链转移证据检查器不移植。

## Alternatives considered

**把该方法作为本仓库的开发流程而非产品特性采用。** 本仓库已有自己的流程（Agent Notes、技能、门禁）；使用者希望团队通过 dsh 提供给任何工作区。

**扩展实验性 Agent Teams。** 其名册只有 lead 与 teammate 角色而无每成员路由或人格，由 lead 模型驱动，任务板是自由形式，而该方法是封闭状态机。其日志加投影模式与声明式结果 schema 被沿用。

**带生命周期工具的模型驱动 lead agent。** 构建更廉价，但每条守卫和效果都取决于 lead 的自律；确定性驱动器强制执行表并把模型角色限制在任务书内，正如 `ralph` 工具对其固定循环所做。

**编排器持有 git 提交。** 忠于源方法，但 dsh 将在 v1 就拥有仓库历史并处理脏树和只读 `.git` 沙箱；记录转移并建议主题让历史留在人类手中。

**保留源名称 "harness"。** 在 DeepSeek Harness 中名为 `harness_run` 的工具读起来像是在操作产品本身。

**移植转移证据检查器。** 它在 CI 中对照表核对 PR 提交链；使用者已将其划出范围，且驱动器已校验它施加的每条转移。

## Acceptance criteria

- 在空工作区运行 `lifecycle_init` 产出 `lifecycle_lint` 接受的英文文件，注册表路由取自已注册的提供者。
- 脚本化角色提供者与脚本化人类应答者把一个需求沿表的主链从 `draft` 驱动到 `done`，录制的无界面快照捕获该运行。
- 编辑他人角色工件的子代、未通过守卫的提议和校验红的结果都使步骤回滚且不施加任何东西。
- 所有者角色为 `human` 时，无应答者的无界面运行以 `needs-human` 停止且不写任何东西。
- 注册表加载器对每种分离不变量违规各以一条命名问题拒绝。
- 候补插件在配置的失败码后把带标签的子代切到下一条路由，并不触碰其他 agent。

## Risks

**产品后端路由上的子代。** Codex 与 Claude Code 路由忽略 dsh 工具 schema，因此它们的提议以尾部围栏 JSON 到达，写作用域的强制执行仅靠步骤后差量。

**适配器持有的推理投入。** 注册表的投入 id 在首次解析时对照路由公布的投入校验；没有投入的 DeepSeek 路由必须省略 `effort`。

**尽力而为的多文件原子性。** 效果逐文件以临时文件加重命名写入并保留内存回滚集；施加中途崩溃会留下部分转移，由下一次校验报告。

**人类裁决需要运行时根。** `ctx.userQuestions.ask` 从子代调用时关闭失败，因此 `lifecycle_run` 按设计是根 agent 工具。
