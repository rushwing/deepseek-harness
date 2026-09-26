---
tc_id: TC-PLAT-008-12
tool: platform
linked_req: REQ-PLAT-008
verifies: [AC-PLAT-008-16, AC-PLAT-009-25]
title: "v1 state/role set fixation; content self-consistency violations fall back to no table instance (incl. BUG found_in); registry comparison failure only reports, never blocks"
status: passing
level: integration
owner: evaluator-001
automated: true
---

## Preconditions

Three v1 fixation variants (handed to `load_lifecycle`, everything else copied from the real table): ①`states.bug` gains an unregistered value `triaged` (five becomes six);
②the `states.req` main chain swaps `tc_design` and `tc_review` (order changes, members do not); ③`roles` contains a duplicate (`[planner, generator,
evaluator, human, planner]`, four becomes five with a repeat). One "content self-consistency violation" table (reusing the idea of TC-02 scenario ⑫: some value of
`tc_status_by_state` contains the unregistered TC status `cancelled`), feeding two groups of entry-point tests: ④run `run_all` of `req_lint.py` over a whole tree with it, count the total
violations, and compare against the 11 cascaded lines that the same broken table triggers today (before the fix for this AC); ⑤in the same process first `import` the real compliant repository table once
to trigger the module-level lazy initialisation of `LIFECYCLE` in `harness_rules`, then call the dependent rules with the broken table from ④, confirming they do not quietly switch to that module-global compliant table.
One BUG fixture: `found_in: draft`, paired with a synthetic table lacking the REQ state `draft` as the discriminating axis of the `found_in` rule; plus a synthetic table registering only
four BUG states (lacking `open`) as the control scenario that must not change the verdict.
One registry variant: some agent's `handles` has one item more than the derived result (AC-05 style), while every mirror table (`requirement-standard` etc.) is compliant.

## Steps

1. Run `load_lifecycle` on ①②③ and confirm each returns `(None, exactly one violation)`.
2. Run `load_lifecycle` on the compliant baseline and additionally assert that `states.bug` has exactly five items, the `states.req` order matches the real repository, and `roles` has exactly four items
   with no duplicate (positive case: the compliant table is not hit by mistake).
3. Run `run_all` of `req_lint.py` over the whole tree with the broken table from ④ and count the total violations and their individual texts.
4. For ⑤: first trigger the module-level lazy initialisation of `LIFECYCLE` once (with the real compliant table), then call the dependent rules (such as
   `check_tc_status_path`) with the broken table from ④ and confirm the return value is not "the normal result computed from the compliant table".
5. Pass the synthetic table "lacking `draft`" and the BUG fixture to the `found_in` rule and read the verdict; also run the real compliant table as the baseline and pass in
   the synthetic table "lacking `open`" as the control, confirming the latter does not change the verdict on the same BUG fixture.
6. Run the four gates over the whole tree with the registry variant and confirm that the mirror-related rules (group J) still execute one by one and are not stopped as a whole by the registry deviation.

## Expected results

- AC-PLAT-008-16: In step 1 each of the three variants yields exactly one violation naming one-extra / reordered / duplicate; in step 2 the compliant baseline triggers no violation of that kind. Step 3
  yields only the single `tc_status_by_state` self-consistency violation, and dependent rules such as the TC status path no longer produce any line (today the same broken table triggers 11
  cascaded lines; this step is the discriminating negative case: necessarily 11 lines before the change takes effect, necessarily 1 line after). In step 4 the dependent rules yield no verdict (an empty list
  or an equivalent "not executed" marker), not the result computed from the module-global compliant table — proving there is no fallback to the specific table instance
  "repository table loaded at module import". In step 5 the `found_in` verdict changes with the table passed in (lacking `draft`, the verdict on this BUG's `found_in: draft` differs from the verdict
  with the compliant table), while lacking `open` gives the same verdict as the compliant table, proving that the `found_in` consumer uses the REQ state table passed at the entry point and does not misuse the BUG state table. In step 6 the registry deviation is reported as one separate line, the group J mirror checks each
  run to completion and report independently, and are not left undecided as a whole because the registry comparison failed.
- AC-PLAT-009-25: The preconditions, step 5 and this assertion all use lacking `draft` as the violation discriminating axis and lacking `open` as the control that must not change the verdict; the axis names on both sides match the `without_draft` / `without_open` variants at the implementation location.

## Implementation location

`tests/gates/test_lifecycle_table.py::TestV1Fixation`; `tests/gates/test_req_lint_entry.py::TestNoFallbackOnContentViolation`
