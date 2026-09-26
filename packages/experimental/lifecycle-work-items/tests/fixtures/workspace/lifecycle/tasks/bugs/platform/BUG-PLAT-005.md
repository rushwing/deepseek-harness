---
bug_id: BUG-PLAT-005
tool: platform
title: "check_tc_policy_exit returns [] for the whole function when the table is invalid, swallowing the table-independent exempt-carrier / own-TC / test_case_ref violations along with it"
status: closed
severity: low
bug_type: impl_bug
owner: generator-001
linked_req: REQ-PLAT-009
origin_req: ""
blocks_req: []
found_in: req_impl_review
test_case_ref: [TC-PLAT-009-17]
---

## Symptom

`scripts/gates/harness_rules.py::check_tc_policy_exit` gained a whole-function early return to eliminate Codex round 2 #11 / r2-7 (falling back to
the module-global table with `lifecycle=None` produced a false `pr_number` violation):

```python
if lifecycle is None:
    return []  # table unavailable: the whole rule does not judge, nor borrows the module-global table for main-chain position (AC-16)
```

This early return is wider than needed: the three checks in the function body — an exempt REQ carrying a BUG, a TC whose linked_req still points at it, and non-empty `test_case_ref`
(lines 1855–1863) — do not depend on the `lifecycle` parameter at all (no state-set lookup, no main-chain position), yet this one line swallows them too.
Codex round 3 scoped re-review n3-1 (P2, high) pointed out: with the same "exempt REQ + carried BUG" fixture, `lifecycle=healthy`
reports "an exempt REQ may not carry a BUG", but `lifecycle=None` gives `[]`.

evaluator-001 reproduced it personally in req_impl_review round 3 (`scratchpad/repro_n3_1.py`): build a `tc_policy: exempt` REQ,
with a BUG whose `linked_req` points at it, and call `check_tc_policy_exit` with `lifecycle=LIFECYCLE` (the compliant table) and with `lifecycle=None`:

| | Result |
|---|---|
| `lifecycle=healthy` | `["…: an exempt REQ may only stop in […], actual 'req_impl_review'", "…: an exempt REQ may not carry a BUG, the linked_req of BUG-PLAT-901 points at it"]` |
| `lifecycle=None` | `[]` |

## Expected vs actual

- Expected: when `lifecycle` is invalid, only the judgements that depend on the table (state set, main-chain position comparison) are not judged; the table-independent static checks (exempt carrying a BUG,
  own TC, non-empty `test_case_ref`) keep running, on the same criterion as AC-PLAT-008-02 "table-dependent rules do not judge, the rest still report" —
  these three inside `check_tc_policy_exit` were never "table-dependent rules".
- Actual: the whole function returns early at once, and the three table-independent checks are skipped too.

## Root cause (filled in after diagnosis)

Fixing r2-7 chose a "function-level" early return instead of a "judgement-level" one: the two places `table_of(lifecycle).reachable_states(...)` /
`at_or_after(node, …, lifecycle)` are the ones that genuinely depend on the table, but the early return was placed at the top of the function, wider than actually needed.

The real repository tree does not fall into this degenerate scenario today: when `lifecycle.yml` is broken, the load phase (AC-PLAT-008-02) already reports an error and turns CI red first;
`check_tc_policy_exit` is passed `lifecycle=None` only after that, when the gate as a whole has already failed, so a real violation cannot slip through alone
because these three static checks went unreported.

## Fix plan

`check_tc_policy_exit` narrows the early return to skip only the two table-dependent judgements (the state-set comparison in `reachable_states`,
the main-chain position comparison in `at_or_after`); the three checks exempt carrying a BUG, own TC, and non-empty `test_case_ref` run unconditionally, unaffected by
`lifecycle is None`. The `own` / `declared` checks in the `optional` branch of the same structure (lines 1877–1890) are likewise table-independent
and are narrowed in the same change.

human-001 ruling 2026-09-12 (PR #24): carried by REQ-PLAT-009; 009 T01 fills `linked_req`.

## Verification method (linked TC)

The carrier REQ named by `linked_req` adds one TC in its tc_design (or appends to the `verifies` of TC-PLAT-008-02): build a
`lifecycle=None` + exempt REQ carrying a BUG fixture and assert that the carried-BUG violation is still reported; the own TC and `test_case_ref`
checks are narrowed the same way as controls. severity `low`, does not block this round's REQ-PLAT-008 closure; the current `check_tc_policy_exit` test code itself passes on a real run.

Fix 2026-09-13 (REQ-PLAT-009 T11):

- Root cause: `if lifecycle is None: return []` at the top of `check_tc_policy_exit`. The early return meant only "do not borrow the module-global table
  for main-chain position", but it switched off the whole rule, so the three checks that never consult the table (exempt may not carry a BUG, exempt may not have own TCs,
  exempt's `test_case_ref` must be empty) were not judged either.
- Fix: the early return is deleted and narrowed to `if lifecycle is not None` at each of the two table-dependent judgements — the reachable state set and the main-chain position
  (`pr_number` timing). To make "which two places are skipped" independently observable, a module-level `reachable_states(lifecycle, policy)` is added,
  paired with the existing `at_or_after`; TC-PLAT-009-17 installs counting stubs on these two helpers and asserts zero calls when the table is invalid.
- Output equivalence: the same tree passed the compliant table and passed `lifecycle=None` yields the three static violations identically (AC-PLAT-009-26).

Verification record: 2026-09-13 evaluator-002, TC-PLAT-009-17 real run, 5 items passed; see [RV-PLAT-009 req_impl_review evidence](../../reviews/platform/RV-PLAT-009.md#req_impl_review).
