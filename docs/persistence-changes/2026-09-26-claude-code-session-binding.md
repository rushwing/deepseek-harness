---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-claude-code-session-binding

English | [中文](2026-09-26-claude-code-session-binding.zh.md)

## Summary

The Claude Code conversation backend (`@deepseek-ai/dsh-experimental-llm-claude-code`) declares the new `claude-code/session` Session event: a log-only record of the Claude Code session a dsh Session's turns run on, carrying the Claude Code session id as `conversationId`, the workspace as `cwd`, and the optional creating `model`. Adding an ordinary event type is a same-version change.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-claude-code-session-binding
baseline: false
changes:
  - root: "event:claude-code/session"
    previous: null
    after: "7a0ee10bc28faab2a05f31e62ef214a443f88c068972e9ea516d5f242e3663cf"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The event is appended once per dsh Session when the Agent SDK reports the session id of the first bound turn and is folded by the `claudeCodeSession` projection into the current binding. Sessions written before this record contain no `claude-code/session` events and project to `null`, which the backend treats as unbound. Readers that do not load the backend see an ordinary first-party event type whose payload is plain JSON; no header, envelope, or existing event changes, so `SESSION_FORMAT_VERSION` stays unchanged.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/experimental/llm-claude-code packages/experimental/llm-product-backend` passed with per-file 100% coverage; `tests/adapter.spec.ts` covers the first-turn append, the resume of the bound session on later turns, the missing-session refusal, and the ephemeral requests that leave the binding untouched. `pnpm run gen-persistence-catalog` regenerated the catalog with the new root.

<a id="dev-note"></a>
## Dev Note

None.
