---
tc_id: TC-PLAT-009-08
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-14, AC-PLAT-009-15]
title: "Closed set of non-transition events, zero delta for ordinary commits, and trailer notices"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Following the table, build one first-parent/commit tree pair each for bug_fix, bug_verify, regression, external_review and bug_redirect; the compliant delta contains only that event's registered objects; the ordinary commit has zero sensitive delta. Independent negative cases include an ordinary commit changing a REQ/TC/existing BUG/RV, a newly created BUG not in open, an event changing objects outside its declaration, and an event subject carrying a T-code or resembling a transition. The tree for a newly created open BUG adds only that file. The trailer scenario uses three values — the executing role's model from the active set, another registered model, and no trailer — with identical subject and delta. (A2, A4)

## Steps

1. Run the ordinary zero-delta commit, a new open BUG created in an arbitrary commit, and the five event positive cases.
2. Run one by one the ordinary sensitive delta, an existing BUG change, an event going out of bounds, a new BUG not in open, and the subject-bypass negative cases.
3. Attach a matching, a non-matching and a missing `Co-Authored-By` to the same legal transition, and record violations and notices.

## Expected results

- AC-PLAT-009-14: A zero-delta ordinary commit, a registered event's exact effects, and a new open BUG created in an arbitrary commit all pass; every other minimal negative case fails and points at the object actually changed, and a subject containing a T-code cannot masquerade as an event.
- AC-PLAT-009-15: A matching trailer gives no notice; a model mismatch and a missing trailer each give exactly one notice while violations stay empty and the overall exit judgement is not changed by the notice.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestEventsAndTrailers`
