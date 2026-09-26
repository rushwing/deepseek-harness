---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-lifecycle-driver

English | [中文](2026-09-26-lifecycle-driver.zh.md)

## Summary

The lifecycle orchestrator (`@deepseek-ai/dsh-experimental-lifecycle-orchestrator`) declares three more log-only Session events for the driver: `lifecycle/transition` records every transition or lifecycle event applied to a REQ (by `lifecycle_transition` or by `lifecycle_run`), `lifecycle/step` records each role-child step of a run when it starts and when it completes, is rejected, or fails, and `lifecycle/human-decision` records each question the run put to the human and its outcome. Adding ordinary event types is a same-version change.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

The events are appended to the driving agent's Session; the artifacts themselves live in the workspace and a resumed driver re-reads them instead of replaying events. Sessions written before this record contain none of the three types. Readers that do not load the orchestrator see ordinary first-party event types whose payloads are plain JSON; no header, envelope, or existing event changes, so `SESSION_FORMAT_VERSION` stays unchanged.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/lifecycle-orchestrator: 66 tests passed, including the logged lifecycle/transition, lifecycle/step, and lifecycle/human-decision payloads of a ten-step run from draft to done and of rejected, failed, and human-pending runs.

<a id="dev-note"></a>
## Dev Note

None.
