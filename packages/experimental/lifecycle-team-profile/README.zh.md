---
description: "用一个实验性 bundle 开启生命周期团队——基于工作区生命周期工件的 Planner、Generator、Evaluator 角色流程、其 orchestrator 工具，以及角色子代的模型回退。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-lifecycle-team-profile

[English](README.md) | 中文

## 概述

`dsh-experimental-lifecycle-team-profile` 用一个 bundle 开启[生命周期团队](../../../docs/subsystems/lifecycle-team.zh.md)：[orchestrator](../lifecycle-orchestrator/README.zh.md) 为工作区搭建 `lifecycle/` 目录、对其工件做 lint、应用迁移，并用新鲜的角色子代驱动需求（REQ）；[模型回退](../lifecycle-model-fallback/README.zh.md)在角色子代的模型路由失败时把它移到注册表的下一条路由。Ralph 保持关闭，因此角色子代永不被交给新鲜 agent 循环。该 bundle 随 `dsh` 发布，并由插件管理器以关闭状态提供。

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

### 安装到 profile

在插件管理器的官方组中开启该 bundle，或手工加入已初始化的 profile，然后搭建并驱动一个 REQ：

```sh
dsh --profile headless "Run lifecycle_init with a full scaffold, then lifecycle_status"
dsh --profile headless "Drive REQ-CORE-001 with lifecycle_run"
```

orchestrator 以 `lifecycleDir: lifecycle`、`maxStepsPerRun: 8`、`humanDecisions: ask`、`proposalChannel: auto`、`subagentProvider: spawn` 组合；回退以 `lifecycleDir: lifecycle` 与 `maxHops: 2` 组合。要覆盖某个值，在 profile 自己的补丁层中修改，它在每个 bundle 层之后应用。

### 你得到什么

- 工作目录带有 `lifecycle/lifecycle.yml` 的 Session 中的六个 `lifecycle_*` 工具、`/lifecycle` 命令与 `lifecycle:policy` 提示词段。
- 通过进程内 `spawn` provider 在工作区注册表落座的路由上生成的角色子代，委派工具被拒绝。
- 在 `llm-retry` 耗尽同路由重试之后，为这些子代提供路由回退。
- `tool-ralph` 保持关闭，与基础 profile 一致。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

本包是通过 `dsh.bundle.patch` 声明的一个 Loader 补丁层（[`cordis.patch.yml`](cordis.patch.yml)），加上插件管理器渲染的 `icon.svg` 与 `locale/{en,zh}.json` 展示元数据。它不导出运行时 API。两个插入的插件拥有全部行为；bundle 只固定它们的组合与默认值。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当 bundle 的默认值不够时读这些页面。它们从组合延伸到被组合的插件以及它们实现的团队设计。

- [生命周期团队](../../../docs/subsystems/lifecycle-team.zh.md) — 工作区文件、服务、驱动器与失败代码。
- [`dsh-experimental-lifecycle-orchestrator`](../lifecycle-orchestrator/README.zh.md) — 工具、写入范围与配置。
- [`dsh-experimental-lifecycle-model-fallback`](../lifecycle-model-fallback/README.zh.md) — 路由回退及其与 `llm-retry` 的顺序。

-----

<a id="model-experience"></a>
## 模型体验

### 生命周期策略与工具

#### 模型看到什么

策略段与工具 schema 属于 [`@deepseek-ai/dsh-experimental-lifecycle-orchestrator`](../lifecycle-orchestrator/README.zh.md)；bundle 只改变组合。角色子代额外把自己的简报作为首条用户消息看到。

#### Token 影响

bundle 增加 orchestrator 所述的策略句子与六个工具 schema；它自己不增加任何提示词文本。回退的一次跳转会在另一条路由上重复一次请求。

#### KV Cache 影响

只要补丁与配置的工具 schema 不变，bundle 的组合就是前缀稳定的；一次回退跳转把子代移到另一个 provider 缓存。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定 bundle 不组合的内容。它们是当前的包约束，不是任务积压。

- **没有 Web UI** — 生命周期状态通过工具与 `/lifecycle` 读取；bundle 不增加任何客户端卡片或面板。
- **固定的生命周期目录** — 两个插件都读取 `lifecycle/`；布局不同的工作区需在两个条目中覆盖 `lifecycleDir`。
- **注册表路由是工作区数据** — bundle 不组合任何模型路由；`lifecycle_init` 按部署现有路由为角色落座，注册表在工作区内编辑。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性 — 交付行为与限制以上文各节和代码为准。`tests/profile.spec.ts` 用 Include 的条目 schema 解析补丁，并钉住插入的条目、其默认值与 Ralph 的禁用；插件各自的测试套件与 orchestrator 的 Loader 组合 e2e 覆盖行为。

</details>
