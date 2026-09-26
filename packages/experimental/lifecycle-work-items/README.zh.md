---
description: "生命周期团队的工作项：把 REQ、TC、BUG、RV 与 PL Markdown 工件解析为图，加载工件契约，按规范对图做 lint，依据表的守卫、效果与 may_change 判定生命周期步骤，规划效果编辑，并带回滚地原子写入。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-lifecycle-work-items

[English](README.md) | 中文

## 概述

生命周期团队的工作项是工作区 `lifecycle/tasks/` 目录下的 Markdown 文件：需求（REQ）、测试用例（TC）、缺陷（BUG）、评审记录（RV）与设计方案（PL）。本库把它们解析为工件图，加载固定标题、预算、评审字段与实现词法的 `artifact-contract.yml`，用 factory-tools 门禁的全部规则组对图做 lint，依据表的守卫、效果与 `may_change` 判定一个生命周期步骤，规划步骤效果所需的 frontmatter 编辑，并带回滚地原子写入文件。它不注册任何东西。

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

每个入口都是对调用方已持有的值的纯函数；只有 `directorySource` 与 `writeAtomically` 触碰文件系统。[`tests/fixtures/workspace/`](tests/fixtures/workspace/) 下的夹具树是翻译后的 factory-tools 工作区，lint 通过。

### 加载图

`loadGraph(source, parseOptionsOf(contract))` 读取一个 `WorkItemSource`（`directorySource(absoluteTasksDir, 'lifecycle/tasks')` 或 `memorySource(tasksDir, files)`）中的每个 Markdown 文件，返回 `ArtifactGraph`：按 id 索引的 `reqs`、`tcs`、`bugs`、`rvs` 与 `pls`，按路径顺序的 `artifacts`，无法成为节点的文件的 `problems`（名字不在五种 id 形状内、目录错误、frontmatter 缺失或无效），被两次声明的 id 的 `duplicates`（路径顺序中的第一个文件胜出），以及规则读取的关系：`acs`（验收条目 id 到所属 REQ）、`ownTcs`、`carriedBugs`、`blockingBugs`、`rvOf`、`plOf`，加上 `resolve`、`resolveReq`、`ownTcsOf`、`carriedBugsOf` 与 `blockingBugsOf`。frontmatter 按 YAML 1.2 核心 schema 与唯一键读取；文件只接受 LF。REQ 的 frontmatter 携带契约的 schema 键与版本时即遵循当前正文契约（`v2`）；blocked 的 REQ 按其 `blocked_from_status`（`effectiveStatus`）判定。

### 加载工件契约

`loadArtifactContract(text, label = 'artifact-contract.yml')` 返回 `{ contract, problems }`：REQ 的七个标题、禁用标题、节与全文预算、验收条目预算、优先级、范围与待裁决标签；TC 的四个标题、预算与手工标记；BUG 的严重度；PL 的四个标题与预算；评审词汇（结论标签、结论词、固定字段、范围与实证字段、固定项数量、免 TC 与延后标记、预算）；以及实现词法（正则表达式类别与允许词）。`DEFAULT_ARTIFACT_CONTRACT` 是 orchestrator 脚手架生成的英文契约；其预算是中文原版的 2.5 倍。结构问题连同路径一并报告；结构合法后，内容问题（一个标题命名两个节、禁用标题同时是节、未知标题的预算、固定字段之外的字段、无法编译的模式）一并报告。

### Lint

`lint({ graph, contract, table, registry, idScheme, workspace })` 把每个规则组跑到底并返回 `Violation[]`（`file`、`rule`、`message`）；图的问题以规则 `graph` 排在最前。没有 `registry` 时跳过所属与签署者检查；没有 `idScheme` 时跳过范围落位检查。`workspace` 是链接规则解析目标所用的 `FileProbe`（`kind(path)` → `file`、`directory` 或 `missing`）。规则 id：

| 组 | 规则 |
|---|---|
| Frontmatter | `placement`、`req-fields`、`tc-fields`、`bug-fields`、`req-frontmatter`、`blocked-fields`、`pr-number`、`archive-consistency`、`artifact-uniqueness` |
| REQ 正文（当前 schema 的在办 REQ） | `req-body`、`req-budgets`、`ac-ids`（id 唯一性同样覆盖归档与旧 REQ）、`how-lexicon`、`pending-decisions` |
| PL 与链接 | `pl`；`links` 覆盖当前 schema 的 REQ、它们的 TC，以及全部 BUG、RV 与 PL |
| TC | `tc-frontmatter`、`ac-coverage`、`tc-body`、`tc-status`、`deferred-verification` |
| RV | `rv-structure`、`rv-signatures`、`rv-gate-pass`、`rv-budgets`、`rv-regression`、`rv-external-review` |
| 生命周期一致性 | `tc-policy`、`bug-binding`、`bug-frontmatter`、`bug-closure`、`bug-closed` |

### 判定一个步骤

`evidence({ pre, post, table, contract, registry, reqId, eventPr })` 把步骤前的树与步骤后的树配对。`checkTransition(evidence, transition)` 返回全部问题：另一个 REQ 被移动、某个守卫在 `pre` 上不成立、某个效果在变更上不成立，或 `may_change` 之外的生命周期敏感变更。`checkEvent(evidence, event)` 另外要求 REQ 的状态与 owner 不变。`checkClauses` 单独求值守卫或效果；`PREDICATES` 把英文表词汇的每个名字映射到其检查（守卫为 `on: 'pre'`，效果为 `'delta'`），命名未知谓词的子句本身就是一个问题。`sensitiveDelta(pre, post, table)` 按 `may_change` 种类列出变更；`changedReqs` 列出状态或 owner 移动过的 REQ；`restorePairFor` 推导 T16 的恢复对：blocked 时取记录的恢复对，自承载时取 `req_review` / planner，从 `pr_draft` 出发时取 `req_impl` / generator，否则取其打回迁移离开来源状态的那个恢复目标。

### 应用效果并写入

`planEffects({ graph, table, contract, registry, reqId, clauses, decisions, eventPr, ownerFor, read })` 把一个迁移或事件的效果变成对子任务留下的树的整文件写入：REQ 状态、owner（`ownerFor(role, state)`）、计数器、`pr_number`、阻塞字段与恢复对、范围内的 TC 与 BUG 状态，以及回归行撤回。允许多个取值的效果（`req.fields_set`、多值的 `tc.status_to` 或 `bug.status_to`）从 `decisions` 取选择；没有 decisions 的单值状态效果应用到范围内的每个工件，给出 `from` 时只应用到处于 `from` 的工件。评审记录效果由谓词核验，从不写入。问题（未决定的字段、范围或允许值之外的决定、未知的范围或效果、角色无 agent）导致不返回任何写入。`editFrontmatter(text, edits)` 保留字段顺序、引号与注释，并以流式风格写列表；`withdrawRegression(text, tcIds)` 删除引用这些 TC 的回归行。`writeAtomically(root, writes, fs?)` 通过临时名与重命名替换每个文件，失败时先把已替换的每个文件恢复为原始字节（删除它创建的文件）再重新抛出；回滚本身失败时抛出 `AggregateError`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

本节说明模块如何拆分；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **文件是唯一真值。** 每次 lint 与每个步骤都从树重建图；调用之间不缓存任何东西。
- **可见文本说了算。** 在读取标题、条目、链接、固定项与词法命中之前，同一个掩码先抹掉围栏代码、缩进代码与 HTML 注释，所以示例永远不算事实。
- **规则跑到底。** 每个规则组都是返回违规的纯函数；一次 lint 显示全部缺陷，夹具为每条规则固定一个满足与一个违反用例。
- **守卫读 `pre`，效果读变更。** 两棵树从不互相替代，applier 用之后判定它的同一组谓词从子任务的树规划。
- **语言在契约里，不在代码里。** 标题、标签、预算与词法模式来自 `artifact-contract.yml`；状态名、id 与结果词是固定的协议词汇。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/text.ts`](src/text.ts) | LF 切分、可见性掩码、H2 切片、码点长度 |
| [`src/frontmatter.ts`](src/frontmatter.ts) | frontmatter 块切分与取值转换 |
| [`src/ids.ts`](src/ids.ts)、[`src/acceptance.ts`](src/acceptance.ts)、[`src/review.ts`](src/review.ts)、[`src/markdown-links.ts`](src/markdown-links.ts) | id 形状与派生、验收条目、评审节与回归行、链接语法 |
| [`src/artifacts.ts`](src/artifacts.ts)、[`src/graph.ts`](src/graph.ts)、[`src/source.ts`](src/source.ts) | 节点、图及其关系、目录与内存源 |
| [`src/contract.ts`](src/contract.ts)、[`src/defaults.ts`](src/defaults.ts) | 契约 schema、加载器与英文默认值 |
| [`src/lint.ts`](src/lint.ts)、[`src/rules/`](src/rules/) | lint 入口与共享 `LintContext` 之上的规则组 |
| [`src/predicates.ts`](src/predicates.ts) | 证据、谓词登记表、恢复对、敏感差量、步骤检查 |
| [`src/apply.ts`](src/apply.ts)、[`src/writer.ts`](src/writer.ts) | 效果规划、frontmatter 编辑、原子写入 |
| [`src/format.ts`](src/format.ts)、[`src/index.ts`](src/index.ts) | 消息渲染；消费方接口 |
| — | 不发布运行时不变量伴随件；每个函数都从其参数返回值且不保留状态。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

函数契约不够时读这些页面。它们从本库出发，走向它据以判定的表与它服务的团队设计。

- [生命周期表](../lifecycle-table/README.zh.md) —— 每条规则与谓词读取的表、注册表与 id 方案。
- [生命周期团队](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.zh.md) —— 本库解析并判定其工件的团队设计。
- [实验性包](../README.zh.md) —— orchestrator 与团队 profile 落地后出现的位置。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是一个工作项库；渲染 lint 结果、步骤裁决与简报的 orchestrator 拥有每个模型可见事实。

#### KV Cache 影响

无；本包既不组装也不发送 harness 模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本库不覆盖的范围。它们是当前的包约束，不是任务积压。

- **仅 LF** —— CRLF 行尾的文件报告 `missing YAML frontmatter`，永远不会成为节点。
- **不检查锚点** —— 链接规则解析文件而非标题锚点；指向缺失标题的链接会通过。
- **不 lint 规范与术语表** —— 只读取 tasks 目录下的工件，允许的词法词来自契约而非术语表文件。
- **尽力而为的原子性** —— 文件逐个替换；两次写入之间崩溃会留下下一次 lint 报告的部分步骤，回滚失败以 `AggregateError` 浮现。
- **评审记录效果只核验不应用** —— 子任务签署结论；applier 除撤回回归行外从不编辑 RV。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性 —— 已发布的行为与限制在上面各节与代码中。规则与谓词是 factory-tools 门禁（`harness_rules.py`、`lifecycle_predicates.py`、`lifecycle_rules.py`）的移植；移植修正了研究发现的谓词缺陷（`req.pending_questions_empty` 读取该节，T16 使用记录的恢复对，`bug.status_to.from` 被强制执行，`pending_bugs_in` 只放宽自承载的 BUG，`rv:regression` 属于敏感差量），而不是复现它们。每条消息都由一个 spec 行固定；改消息即改它的行。`tests/step-scenarios.ts` 为每个迁移与事件保存一个满足的步骤，谓词与 applier 两个 spec 都回放它。

</details>

**运行时不变量：** 不发布伴随件。每个函数都返回由其参数计算出的值，调用之间不保留状态。
