---
tc_id: TC-PLAT-009-21
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-32, AC-PLAT-009-33]
title: "T15 restore pairs from five sources and the T16/bug_redirect blocking protocol"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Use recipes to build a T15 positive case for each of the five sources req_review, tc_review, tc_impl_review, req_impl_review and pr_draft, with the source tree containing only that REQ; the self-carried branch is listed separately, and the expected restore pair is derived from the table's reject endpoint/role. Each negative case tears out exactly one of blocked, non-empty pending, reason or the restore pair. The T16 first-parent tree lists two BUGs: an ordinarily carried one must be closed, a self-carried one restoring to req_review may be resolved; the commit tree only clears/restores the prescribed fields. The bug_redirect positive case has a blocked+human first parent; each negative case changes only status or only owner. (A3, A8)

## Steps

1. Run the five-source and self-carried T15 positive cases, then run the independent negative cases field by field.
2. Run the T16 positive cases with closed and with self-carried resolved; separately leave pending/the three blocking fields in place, restore the wrong status/owner, or lower a BUG status.
3. Run bug_redirect with a legal first parent and with non-blocked and non-human negative cases; then let an ordinary or other event commit change one of the four fields.

## Expected results

- AC-PLAT-009-32: For all five sources blocked/pending/reason/restore pair equal the derived values, with pr_draft and self-carried taking their own special targets; every single-field negative case fails and names the field.
- AC-PLAT-009-33: T16 clears the four fields and restores to the target only when the BUG precondition is met; leftovers, a wrong restore or an insufficient BUG status all fail. bug_redirect may change the restore target only on a blocked+human first-parent tree, and any other commit touching the four fields is a violation.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestBlockingTransitions`
