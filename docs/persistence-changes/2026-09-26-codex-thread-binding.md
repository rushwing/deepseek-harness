---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-codex-thread-binding

English | [中文](2026-09-26-codex-thread-binding.zh.md)

## Summary

The Codex conversation backend (`@deepseek-ai/dsh-experimental-llm-codex`) declares the new `codex/thread` Session event: a log-only record of the Codex app-server thread a Session's turns run on, carrying the thread id as `conversationId`, the workspace as `cwd`, and the optional creating `model`. Adding an ordinary event type is a same-version change.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The event is appended once per Session when Codex acknowledges the thread and is folded by the `codexThread` projection into the current binding. Sessions written before this record contain no `codex/thread` events and project to `null`, which the backend treats as unbound. Readers that do not load the backend see an ordinary first-party event type whose payload is plain JSON; no header, envelope, or existing event changes, so `SESSION_FORMAT_VERSION` stays unchanged.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/experimental/llm-codex packages/experimental/llm-product-backend packages/product-runtime/codex-app-server` passed (123 tests) with per-file 100% coverage on the three packages; `tests/adapter.spec.ts` covers the first-turn append, the resume after an app-server restart, the missing-thread refusal, and the ephemeral requests that leave the binding untouched. `pnpm run gen-persistence-catalog` regenerated the catalog with the new root.

<a id="dev-note"></a>
## Dev Note

None.
