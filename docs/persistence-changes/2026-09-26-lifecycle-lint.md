---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-lifecycle-lint

English | [中文](2026-09-26-lifecycle-lint.zh.md)

## Summary

The lifecycle orchestrator (`@deepseek-ai/dsh-experimental-lifecycle-orchestrator`) declares the new `lifecycle/lint` Session event: a log-only record of one `lifecycle_lint` run carrying its scope (`all` or a REQ id), the violation count, and the count per rule. Adding an ordinary event type is a same-version change.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The event is appended by the `lifecycle_lint` tool after each run; the violations themselves return to the caller and are never logged. Sessions written before this record contain no `lifecycle/lint` events. Readers that do not load the orchestrator see an ordinary first-party event type whose payload is plain JSON; no header, envelope, or existing event changes, so `SESSION_FORMAT_VERSION` stays unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/lifecycle-orchestrator: 26 tests passed, including the logged lifecycle/lint payloads of a clean and a scoped run.

<a id="dev-note"></a>
## Dev Note

None.
