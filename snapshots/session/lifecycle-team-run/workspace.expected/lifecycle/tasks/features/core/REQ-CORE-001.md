---
req_id: REQ-CORE-001
tool: core
title: "Lifecycle lint reports one violation per file and rule"
intent: "Give every role a machine verdict on the artifacts it hands over"
status: req_review
owner: evaluator-001
priority: P2
phase: M6
scope: harness
tc_policy: required
exempt_reason: ""
depends_on: []
test_case_ref: []
acceptance: "A lint run over the tasks tree names every artifact defect with its file and rule"
review_round: 0
pending_bugs: []
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
pr_number: null
lifecycle_schema: 2
---

## Goal

The team needs a verdict on its artifacts before a role hands work over, so that a defect is caught by the gate and not by the next role.

## Behavior

### Assumptions and defaults

- The tasks tree is the only input; nothing is read from version control.

The lint runs every rule to completion and reports each finding with the file it concerns and the rule that produced it.

## Non-goals

- Transition evidence over commit chains is not part of this requirement.

## Acceptance criteria

- **AC-CORE-001-01** Given a tasks tree with one malformed artifact, when the lint runs, then the report names that file, the rule, and the defect in one line.
- **AC-CORE-001-02** Given a clean tasks tree, when the lint runs, then the report is empty.

## Pending decisions

None

## Design references

None

## Bug History

None.
