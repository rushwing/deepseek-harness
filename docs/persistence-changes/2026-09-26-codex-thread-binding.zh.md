---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-codex-thread-binding

[English](2026-09-26-codex-thread-binding.md) | 中文

## 概述

Codex 会话后端（`@deepseek-ai/dsh-experimental-llm-codex`）声明了新的 `codex/thread` Session 事件：仅写日志的记录，保存 Session 回合所运行的 Codex app-server 线程，字段为线程 id（`conversationId`）、工作区（`cwd`）和可选的创建时 `model`。新增普通事件类型属于同版本变更。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-codex-thread-binding
baseline: false
changes:
  - root: "event:codex/thread"
    previous: null
    after: "83c489454066e65624fdf9680d5118a0d0b1083c542910dabda533fa479e9925"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

该事件在 Codex 确认线程后每个 Session 追加一次，由 `codexThread` 投影折叠为当前绑定。此记录之前写入的 Session 不包含 `codex/thread` 事件，投影结果为 `null`，后端将其视为未绑定。未加载该后端的读取方看到的是负载为纯 JSON 的普通第一方事件类型；头部、信封与现有事件均未改变，因此 `SESSION_FORMAT_VERSION` 保持不变。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/experimental/llm-codex packages/experimental/llm-product-backend packages/product-runtime/codex-app-server` 通过（123 个测试），三个包的逐文件覆盖率为 100%；`tests/adapter.spec.ts` 覆盖首回合追加、app-server 重启后的恢复、线程缺失时的拒绝，以及不触碰绑定的临时请求。`pnpm run gen-persistence-catalog` 已用新根重新生成目录。

<a id="dev-note"></a>
## 开发备注

无。
