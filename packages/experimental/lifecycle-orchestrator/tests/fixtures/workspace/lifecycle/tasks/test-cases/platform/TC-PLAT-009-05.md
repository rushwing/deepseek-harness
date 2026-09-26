---
tc_id: TC-PLAT-009-05
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-07, AC-PLAT-009-08, AC-PLAT-009-09]
title: "A transition commit's unique REQ delta, role endpoints and round"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Use recipes to build a compliant first-parent tree and commit tree for each of the 21 transitions; each negative case tears out exactly one item, and there is no sensitive delta outside the REQ under test. Cover T01 with no REQ in the first parent, ordinary / multi-origin transitions, T15 with the current owner, T16 with both restore fields and the T19 actor exemption. Unique-delta negative cases are zero REQs, two REQs, and a declared number pointing at another REQ; round negative cases cover the increment not applied, applied twice, a non-enumerated transition or an ordinary/event commit changing the value. The default `review_round` must be overridden explicitly. (A6)

## Steps

1. Run `check_transition` on every compliant recipe and confirm the unique REQ matches the declaration.
2. Run one by one the zero / double / wrong REQ deltas, and the origin, executing-role, handover-role and T16 restore-value negative cases.
3. Run the round positive cases for the five scenarios that must increment and for all other commits; tear each item out or modify it out of bounds and rerun.

## Expected results

- AC-PLAT-009-07: T01 with the predecessor node missing passes as draft/human; zero, double or wrong REQ deltas all fail and name both the short SHA and the declared T-code.
- AC-PLAT-009-08: Origin, executing role and post-commit role each match the table and the special rules; any single-item negative case names only the corresponding field, and T19 is not falsely reported by the actor check.
- AC-PLAT-009-09: Only T03/T03b/T03c/T04 and T15 from req_review increment by exactly one; any round delta on other commits, and any non-one delta in the scenarios that must increment, are violations.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestReqTransitionFields`
