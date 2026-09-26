---
tc_id: TC-PLAT-009-06
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-10, AC-PLAT-009-11]
title: "RV gate-section conclusions, freeze boundary and regression-line effects"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Use `write_req`/`write_rv` to build a compliant first-parent/commit tree for each of the four review gates: the target gate section's round equals the first-parent tree's round for that section + 1, or 1 when the first-parent tree lacks the section; the req_review section additionally equals the post-commit `review_round`. Round negative cases separately produce only a round skip, an unchanged round, and a req_review round not equal to `review_round`. Regression-section scenarios include the carried origin REQ's RV and references to this REQ's TCs: T13 only adds permitted lines, T19/T16→req_review withdraw only the target lines and keep unrelated lines; the pre-filled, frozen-section and other-party-RV negative cases first prove that the before/after trees differ only in that section. (A2, A5)

## Steps

1. Run the check on the legal PASS/REJECT transitions of each gate, then replace them one at a time with the wrong gate, a pre-filled PASS, the wrong verdict, a round skip, an unchanged round, or a req_review round not equal to the post-commit `review_round`.
2. Run the check on the regression-section positive cases for T13, T19 and T16; rerun after keeping a line that should be withdrawn or after changing an unrelated line.
3. Let an ordinary transition change only another party's RV or a non-corresponding gate section of its own RV, and record the diagnostics.

## Expected results

- AC-PLAT-009-10: A legal gate section's round is exactly the first-parent tree's round for that section + 1 (1 when the first-parent tree lacks the section), and the req_review section's round additionally equals the post-commit `review_round`; wrong state, pre-fill, verdict/transition mismatch, round skip, unchanged round, or the two req_review values differing all name the RV and the gate section, and are not disturbed by identical word strings elsewhere in the body.
- AC-PLAT-009-11: Only T13 may add regression lines to the carried origin REQ, and T19/T16 withdraw exactly the lines referencing this REQ's TCs; a missed withdrawal, a wrongly withdrawn unrelated line, or any other commit changing another party's RV are all violations.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestReviewEffects`
