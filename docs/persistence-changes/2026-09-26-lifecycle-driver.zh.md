---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-lifecycle-driver

[English](2026-09-26-lifecycle-driver.md) | 中文

## 概述

生命周期 orchestrator（`@deepseek-ai/dsh-experimental-lifecycle-orchestrator`）为驱动器再声明三个只记录的 Session 事件：`lifecycle/transition` 记录对 REQ 应用的每次迁移或生命周期事件（由 `lifecycle_transition` 或 `lifecycle_run` 应用），`lifecycle/step` 在一次运行的每个角色子代步骤开始以及完成、被拒或失败时各记录一次，`lifecycle/human-decision` 记录运行向人类提出的每个问题及其结果。新增普通事件类型是同版本变更。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-lifecycle-driver
baseline: false
changes:
  - root: "event:lifecycle/human-decision"
    previous: null
    after: "48fb95a97608ec4ee57d36ec254d971848ca24a6c3e78531dc2a9ac8f6a69ccc"
    decision: same-version
  - root: "event:lifecycle/step"
    previous: null
    after: "79a6b8ef5e72dba9e286465f4d3a2c898be65fa906fe141f1a786bb499ba38c8"
    decision: same-version
  - root: "event:lifecycle/transition"
    previous: null
    after: "38dd837416051d2e59692a3cd2555bce702e66a3279eb6f9957b61cd1e0bdf82"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这些事件追加到驱动 agent 的 Session；工件本身位于工作区，恢复的驱动器重新读取文件而不回放事件。在本记录之前写入的 Session 不含这三种类型。不加载 orchestrator 的读取方看到的是普通的第一方事件类型，其负载是纯 JSON；头部、信封与既有事件均不变，因此 `SESSION_FORMAT_VERSION` 不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/lifecycle-orchestrator：66 个测试通过，包括一次从 draft 到 done 的十步运行以及被拒、失败、等待人类的运行所记录的 lifecycle/transition、lifecycle/step、lifecycle/human-decision 负载。

<a id="dev-note"></a>
## 开发备注

无。
