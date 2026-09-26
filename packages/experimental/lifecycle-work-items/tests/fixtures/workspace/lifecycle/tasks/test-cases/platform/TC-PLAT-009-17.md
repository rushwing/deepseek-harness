---
tc_id: TC-PLAT-009-17
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-26]
title: "tc_policy static violations are still reported under an invalid lifecycle table"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Use `build_tree` to create four trees that differ only in the item under test: an exempt REQ carrying a BUG, an exempt REQ with an own TC, an exempt REQ with a non-empty `test_case_ref`, and an optional branch whose own/declared sets disagree; first prove with a compliant table that each tree hits only the target static violation. Then pass `lifecycle=None` to the same check without changing the artefacts. Install counting stubs on the branches that depend on the state set and the main-chain position, so that "returns empty" cannot mask an early return of the whole function. (A1, A6)

## Steps

1. Run each negative-case tree with the compliant table and save the set of violations related to the static item under test.
2. Rerun the identical artefacts with `lifecycle=None` and compare that set.
3. Check that the table-dependent stubs are not called under None and are called under the compliant table; confirm all three static branches execute.

## Expected results

- AC-PLAT-009-26: When the table is invalid only the state-set and main-chain-position judgements are skipped; the output for exempt carrying, own TC, non-empty test_case_ref (and the optional static items of the same structure) is identical to the output with a valid table, and does not become empty through an early return of the whole function.

## Implementation location

`tests/gates/test_req_lint_lifecycle.py::TestTcPolicyWithoutLifecycle`
