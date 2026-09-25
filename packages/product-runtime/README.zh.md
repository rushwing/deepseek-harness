---
description: "product-runtime 分组导览：固定版本的外部 agent 产品及其协议客户端，一次性 subagent 提供方与会话后端都建立在其上。"
kind: "package-group"
---

# product-runtime/ — 外部 agent 产品运行时

[English](README.md) | 中文

## 概述

harness 通过官方集成面接入两个外部 agent 产品 Codex 与 Claude Code：Codex app-server 协议和 Claude Agent SDK。每个产品被消费两次：一次性 subagent 提供方为每次委派运行一个全新的产品对话，会话后端为每个 Session 保持一个产品对话。本分组存放这些消费方对每个产品共享的部分：唯一固定版本的官方运行时、进程命令、协议客户端和权限模式词表。它不提供任何服务、工具或插件；由消费包决定产品何时启动以及人类如何参与。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`claude-agent-sdk`](claude-agent-sdk/README.zh.md) | 固定 `@anthropic-ai/claude-agent-sdk` 版本、重新导出其 `query` 入口与类型、命名原生权限模式，并把托管进程投影到 SDK 的派生接口 | 库——无 ctx 键 |
| [`codex-app-server`](codex-app-server/README.zh.md) | 固定 `@openai/codex` 版本、构造包内 app-server 命令，并提供共享协议辅助函数与持久多线程连接 | 库——无 ctx 键 |

消费方保留产品特定的生命周期：[Codex](../subagent/subagent-codex/README.zh.md) 与 [Claude Code](../subagent/subagent-claude-code/README.zh.md) subagent 提供方拥有各自的一次性运行，会话后端拥有按 Session 的对话。

-----

<a id="related-documentation"></a>
## 相关文档

- [Subagent 子系统](../../docs/subsystems/subagent.zh.md)——一次性产品提供方注册的接缝。
- [外部 agent 会话后端](../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.zh.md)——为何运行时在提供方与后端之间共享。
- [Claude Code 与 Codex 后端](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.zh.md)——一次性提供方的产品协议与进程生命周期。

-----

<a id="dev-note"></a>
## 开发备注

无。
