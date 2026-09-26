---
req_id: REQ-PLAT-008
tool: platform
title: "Lifecycle as one table: static states, transitions, self-consistency, and mirrors"
status: done
owner: human-001
priority: P1
phase: M4
scope: harness
tc_policy: required
exempt_reason: ""
depends_on: []
test_case_ref: [TC-PLAT-008-12]
acceptance: "The lifecycle table decides whether a snapshot of the tasks tree is legal"
review_round: 3
pending_bugs: []
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
pr_number: 24
---

## Goal

Legacy requirement kept as the link and acceptance-criterion target of the fixture set.

## Acceptance criteria

- **AC-PLAT-008-16** Given a table whose content contradicts itself, when the gate loads it, then no table instance is produced and every contradiction is named.
