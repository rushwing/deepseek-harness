---
tc_id: TC-PLAT-009-03
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-04]
title: "git and range-layer failures converge to a single line and do not short-circuit the static rules"
status: passing
level: e2e
owner: evaluator-002
automated: true
---

## Preconditions

Three independent temporary repositories all start from a compliant artifact tree and additionally hold one TC frontmatter negative case that the static rules will name: (1) no git on PATH; (2) a non-existent base/head is passed; (3) two histories with no common ancestor are created. Nothing else changes beyond each repository's single git/range breakage and the shared static negative case; first prove that the static negative case alone turns red, so that "the remaining rules still run" is not a vacuum. (A1, A8)

## Steps

1. Run the three ranges from the transition-evidence entry point and capture return code, stdout/stderr and exceptions.
2. Each time count the git/range-class violations and inspect their range text; at the same time look for the pre-planted static violation.
3. Use a legal range as the control, confirming no range-class violation appears while the static violation is still present.

## Expected results

- AC-PLAT-009-04: Each of the three failures yields exactly one transition-evidence violation containing the base/head range, with no traceback; the static negative case is still named every time, and the legal range produces no failure of that class.

## Implementation location

`tests/gates/test_lifecycle_git.py::TestRangeFailures`
