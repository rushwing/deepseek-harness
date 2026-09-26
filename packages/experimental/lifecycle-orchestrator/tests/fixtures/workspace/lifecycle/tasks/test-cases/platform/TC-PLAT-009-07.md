---
tc_id: TC-PLAT-009-07
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-12, AC-PLAT-009-13]
title: "TC/BUG status effects and the pr_number check points"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Every scenario starts from a compliant REQ, own TCs, a carried origin TC, a carried BUG and an event PR number; the first-parent/commit trees contain only the delta under test. T06, T12, T13, T19 and T16→req_review each explicitly place the objects that should be affected and those that should be excluded; each negative case lets one object land in a state outside the effects. pr_number covers the first T11, a re-entered T11, an exempt T02 and other commits; the event number and the original number both use different non-empty values to prevent trivial equality. (A3, A6)

## Steps

1. Run the effect check on the TC/BUG status positive cases of the five transition kinds, then change each object one at a time to an out-of-bounds state.
2. Specifically check that T06 excludes the carried origin TC, that T13 closes the carried BUG, and that T19/T16 return own TCs to draft and closed BUGs to resolved.
3. For the first/re-entered T11, the exempt T02 and an ordinary transition, change or keep pr_number, and rerun while switching the event PR number.

## Expected results

- AC-PLAT-009-12: Status combinations within the declared effects pass; every out-of-bounds delta names the corresponding TC/BUG, the carried origin TC is not wrongly swept in by T06, and the rollback effects miss neither own TCs nor closed BUGs.
- AC-PLAT-009-13: The first T11 and the exempt T02 accept only the event number, and a re-entered T11 keeping the original number passes; other commits are never checked for pr_number equality regardless of the event number.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestArtifactStatusAndPrNumberEffects`
