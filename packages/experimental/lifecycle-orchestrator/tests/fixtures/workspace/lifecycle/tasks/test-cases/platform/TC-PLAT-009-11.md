---
tc_id: TC-PLAT-009-11
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-18]
title: "Chain-end-table replay of the 116-commit first-parent chain of PR #22"
status: passing
level: e2e
owner: evaluator-002
automated: false
---

## Preconditions

The local repository keeps both parents of the PR #22 merge commit `bc91c6e` and the full history; `git rev-list --first-parent --reverse bc91c6e^1..bc91c6e^2` was measured at 116 commits. Already checked with `git show --stat`: `2bb6571` alone sets eight TCs to implemented; `1ebf3c4` flips the status of BUG-PLAT-001/002 and changes the gate implementation at the same time; `ff7ecdb` and `2d9c95e` skip the tc_review round; `e254de1`, `1878b23` and `ff5ea01` sign their gate section for the first time in the tc_review, tc_impl_review and req_impl_review states respectively, with round 1 = no such section in the first-parent tree + 1. Run with the post-implementation chain-end v2 table; do not skip history by using the v1 table of the old commit trees.

## Steps

1. Re-run the rev-list above and save the count, the first and last SHA and the order.
2. Execute `req_lint.py --range bc91c6e^1..bc91c6e^2 --table head`, saving the complete line-by-line output and the exit code.
3. Locate each of the seven known SHAs above in the output, recording its violated object, field/section and declared transition (if any), and check that the three legal first-round SHAs do not appear in any violation line.
4. Record the complete list of named commits; confirm the process finished and that every line can be traced back to one commit.

## Expected results

- AC-PLAT-009-18: The replay handles all 116 commits stably without crashing; the split commit and the implementation commit flipping BUG status name only `2bb6571` and `1ebf3c4` respectively, and the tc_review round skip names `ff7ecdb` and `2d9c95e`; the legal first-round T07/T09/T13 commits `e254de1`, `1878b23` and `ff5ea01` are explicitly not named, and the complete list of the remaining actual violations is recorded.

## Implementation location

Manual: results are recorded in the RV `## req_impl_review` Evidence field
