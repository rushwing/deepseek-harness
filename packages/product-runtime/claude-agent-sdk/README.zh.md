---
description: "面向一次性 Claude Code 提供方与 Claude Code 会话后端维护者的共享 Claude Code 运行时：唯一的 Agent SDK 固定版本、权限模式词表和托管进程投影。"
kind: "package-library"
---

# @deepseek-ai/dsh-claude-agent-sdk

[English](README.md) | 中文

## 概述

`dsh-claude-agent-sdk` 是 harness 中唯一固定官方 `@anthropic-ai/claude-agent-sdk` 及其平台 CLI 载荷版本的地方。它重新导出 SDK 的 `query` 入口和线协议类型，使每个消费方使用同一个 SDK 版本；命名从不等待人类的原生权限模式；并把 harness 的 subprocess 句柄投影到 SDK 的自定义派生进程接口上，使真实 CLI 运行在 subprocess 接缝之下。它是纯库，没有插件、配置或注册；[一次性 subagent 提供方](../../subagent/subagent-claude-code/README.zh.md)和 Claude Code 会话后端拥有 query 生命周期、结果映射与人类参与。

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

当插件通过官方 Agent SDK 运行 Claude Code 时使用本包。从这里导入 `query` 和 SDK 类型，给 `spawnClaudeCodeProcess` 传入由 subprocess 接缝构造的适配器，并从共享词表中选择权限模式。

### 启动查询

`query({ prompt, options })` 是原样重新导出的官方 SDK 入口。不要设置 `pathToClaudeCodeExecutable`，让 SDK 从本包的可选平台依赖中选择 CLI；省略、不受支持或损坏的载荷在首个查询时失败，而不会回退到主机上的 `claude`。把 `spawnClaudeCodeProcess` 设为一个把 SDK 的 `SpawnOptions` 变为托管进程的函数：`claudeSpawnSpec(options, graceMs)` 产出完全显式的 subprocess 请求（argv、工作区、管道化的 stdin 与 stdout、继承的 stderr、终止宽限、转发的信号，以及编码为叠加层并为被移除环境名带墓碑的 SDK 环境），`new ManagedClaudeCodeProcess(handle)` 把派生句柄的流、退出事实与终止投影回 SDK 的 `SpawnedProcess` 接口。没有工作区的派生请求会被拒绝。

### 权限模式

`CLAUDE_CODE_PERMISSION_MODES` 列出无人值守查询可选择的原生模式：`dontAsk`、`acceptEdits`、`auto`、`plan` 与 `bypassPermissions`；`DEFAULT_CLAUDE_CODE_PERMISSION_MODE` 为 `dontAsk`。`SUPPORTED_UNATTENDED_DIALOG_KINDS` 命名此类查询声明可通过取消来回答的阻塞对话框种类。把权限路由给人类的消费方传入自己的 `canUseTool` 并改用 SDK 的 `default` 模式。

### 进程事实

`ManagedClaudeCodeProcess` 暴露 `killed`、`exitCode`、`signalCode` 和退出后的完整 `outcome`，向 SDK 监听器发出 `exit` 与 `error`，并把 `kill()` 恰好一次地路由到 subprocess 接缝的终止梯级。它自身从不终止或观察任何东西；消费方的释放与 subprocess 服务拥有进程树静默。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节说明库如何拆分；可观察行为见[使用本包](#use-this-package)。

### 设计理念

- **一处固定版本，两个消费方。** SDK 依赖及其平台载荷放在这里，使一次性提供方和会话后端不会漂移到不同的 Claude Code 版本。
- **投影而非传输。** SDK 保留自己的协议和 CLI；本包只把 harness 托管进程映射到 SDK 的派生接口。
- **模式是词表。** 权限模式常量说明部署可以选择什么；每个消费方决定所选模式如何变为 SDK 选项与回调。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/sdk.ts`](src/sdk.ts) | 重新导出官方 `query` 入口和消费方所需的线协议类型 |
| [`src/permission.ts`](src/permission.ts) | 原生非交互权限模式、其默认值和无人值守对话框种类 |
| [`src/process.ts`](src/process.ts) | `claudeSpawnSpec`、`sdkEnvironmentOverlay` 与 `ManagedClaudeCodeProcess` |
| [`src/index.ts`](src/index.ts) | 消费方接口 |
| — | 不发布运行时不变量伴随包；库自身不拥有事件流或可变数据关系，每个消费方自行证明其进程与 Session 事实。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当库契约不够时阅读这些页面。它们从本运行时走向启动产品的消费方。

- [Claude Code subagent 提供方](../../subagent/subagent-claude-code/README.zh.md)——为每个任务运行一次全新查询的一次性委派。
- [外部 agent 会话后端](../../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)——本运行时所服务的按 Session 后端设计。
- [Claude Code 与 Codex 后端](../../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.zh.md)——产品提供方的设计记录。
- [Subprocess 子系统](../../../docs/subsystems/subprocess.zh.md)——派生并终止 CLI 进程的接缝。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这是 SDK 运行时库；挂载 Claude Code 提供方或后端的消费方拥有模型所见的内容。

#### KV Cache 影响

无；本包既不组装也不发送 harness 模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了库不覆盖的范围。它们是当前的包约束，不是任务积压。

- **不含查询生命周期**——消费 SDK 流、映射结果、恢复与释放都留在各消费方。
- **兼容性以证据固定**——Agent SDK 版本及其 Claude Code CLI 在此固定；升级固定版本需要重跑两个消费方的无密钥真实产品与 loader 组合测试。
- **stderr 被继承**——派生规格继承父进程的 stderr；必须捕获 CLI stderr 的消费方自行构造规格。
- **SDK 登录保持原生**——本包既不创建账号也不读取 Claude 设置；认证失败通过 SDK 暴露。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制见上文各节与代码。提供方的测试套件仍以相同的 peer 集合把 SDK 声明为仅测试依赖，使其 mock 与真实产品检查解析到唯一的 store 实例；该 peer 集合不一致会物化出第二份平台载荷。

</details>

**Runtime invariant:** 不发布伴随包。进程树归属属于 subprocess 服务，Session 事实属于每个消费方。
