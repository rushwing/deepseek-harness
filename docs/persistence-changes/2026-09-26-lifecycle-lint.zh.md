---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-lifecycle-lint

[English](2026-09-26-lifecycle-lint.md) | 中文

## 概述

生命周期 orchestrator（`@deepseek-ai/dsh-experimental-lifecycle-orchestrator`）声明新的 `lifecycle/lint` Session 事件：一次 `lifecycle_lint` 运行的只记录不回放的记录，携带其范围（`all` 或一个 REQ id）、违规数与按规则的计数。新增普通事件类型是同版本变更。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-lifecycle-lint
baseline: false
changes:
  - root: "event:lifecycle/lint"
    previous: null
    after: "aa82fb8e21b73d642ae6b9a68b755914d1fe70751708c2ef71b3502b941a3a12"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

该事件由 `lifecycle_lint` 工具在每次运行后追加；违规本身返回给调用方，从不记录。在本记录之前写入的 Session 不含 `lifecycle/lint` 事件。不加载 orchestrator 的读取方看到的是一个普通的第一方事件类型，其负载是纯 JSON；头部、信封与既有事件均不变，因此 `SESSION_FORMAT_VERSION` 不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/lifecycle-orchestrator：26 个测试通过，包括一次干净运行与一次限定范围运行所记录的 lifecycle/lint 负载。

<a id="dev-note"></a>
## 开发备注

无。
