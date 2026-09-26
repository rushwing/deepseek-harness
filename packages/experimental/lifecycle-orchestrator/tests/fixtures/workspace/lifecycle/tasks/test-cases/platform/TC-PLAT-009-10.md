---
tc_id: TC-PLAT-009-10
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-17]
title: "Table-generated positive cases for every transition, per-guard/effect negative cases and the git chain matrix"
status: passing
level: e2e
owner: evaluator-002
automated: true
---

## Preconditions

`lifecycle_recipes.py` enumerates every transition, guard and effect from the actual v2 table, generates the pre tree and then applies the effects to obtain the post tree; selecting samples from a fixed test-side list of T-codes is forbidden. Each negative case tears out only the marked guard/effect from an already passing single positive case, and first asserts that the delta contains only that object. Extra parameters cover a wrong id, start/role/restore-pair mismatch, T19 starting from done and from blocked respectively, a non-enumerated transition changing the round, a non-transition sensitive delta, the three activation states and the two merge kinds; temporary git repositories build a legal chain and a chain that splits one effect across adjacent commits. (A4, A6, A7, A8)

## Steps

1. Generate from the table and run the compliant recipes for the 21 transitions and the five event kinds, comparing the closed set of collected ids with the table's registrations.
2. Tear out each guard and each effect once independently, run the pure-function matrix and check the diagnostic target.
3. Run the extra-category matrix and the two temporary git chains, confirming the split chain fails at the actual commit boundary.
4. Use the pytest report to count collected/passed/skipped/xfailed for this module.

## Expected results

- AC-PLAT-009-17: Every transition in the table has a passing positive case, and the single breakage of each guard/effect fails; the listed boundary categories and the two git chains are all collected with correct verdicts, and skipped/xfail are both 0.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestGeneratedTransitionMatrix`; `tests/gates/test_lifecycle_git.py::TestLegalAndSplitChains`
