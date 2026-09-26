---
tc_id: TC-PLAT-009-19
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-29]
title: "Chain verification of this REQ and post-activation effect tear-out replay"
status: passing
level: e2e
owner: evaluator-002
automated: false
---

## Preconditions

Use the real branch that completes this requirement but is not yet merged, its PR event file and the merge base; record `harness_gate_api.REQUIRED_PARAMS`/`RULE_GROUPS` and the existing per-item function names as an independent snapshot. Take the RV-PLAT-008 history, where req_impl_review re-entered after round 2 and signed round 3, as the positive anchor. Additionally, replicate in a temporary git repository a legal transition chain starting from the v2 activation commit; for every transition commit after activation, copy that chain and tear out exactly one table-registered effect, leaving the parent tree, subject and other deltas untouched, and prove the original chain passes before tearing. (A5, A7)

## Steps

1. Check the round 2 → 3 of RV-PLAT-008 req_impl_review before and after re-entry; on the real tree run the four gates, all of `tests/gates` and the transition-range verification of this PR, recording passed/skipped/xfailed.
2. Compare the gate API function names, required parameter names and rule-group assembly against the snapshot.
3. Run the fifth step on the legal chain in the temporary repository and confirm it passes; rewrite each post-activation transition commit in turn, tearing out exactly one effect each time, and rerun the same range.
4. Save the commit short hash, declared T-code and effect field from each failure line.

## Expected results

- AC-PLAT-009-29: The req_impl_review re-entry of RV-PLAT-008 signs round 3 as the old round 2 + 1 of the same section; the four gates, gate tests and transition-range verification of this REQ's own chain are all green with skipped/xfail at 0, and existing function names and required parameter names are unchanged; the temporary legal chain passes, and every post-activation transition commit's tear-out replay makes the fifth step fail and name precisely the target commit and the missing effect.

## Implementation location

Manual: results are recorded in the RV `## req_impl_review` Evidence field
