---
rv_id: RV-PLAT-009
tool: platform
linked_req: REQ-PLAT-009
---

## req_review

Conclusion: PASS (round 8, 2026-09-13, evaluator-002)

Fixed items:
- [x] CHK01 No implementation detail: body, intent and acceptance have 0 HOW-lexicon hits
- [x] CHK02 Every AC is one sentence, present tense, observable output
- [x] CHK03 Behavior and Acceptance criteria do not state the same rule twice
- [x] CHK04 All business terms are GLOSSARY canonical words
- [x] CHK05 Non-goals non-empty and fully take over the boundary REQ-PLAT-008 assigned to 009
- [x] CHK06 Pending decisions == None
- [x] CHK07 No contract restated; design docs touched by this REQ contain no "rule: see REQ"
- [x] CHK08 CLAUDE.md §2 five disciplines checked one by one, no conflict

Review scope: `51f5c1f..HEAD` with `REQ-PLAT-009.md`, `PL-PLAT-009.md`, `harness/tasks/README.md`; full re-read of the REQ, the PL test-support manual-TC lines, the frozen RV `tc_review`, the named specs and the 007/008 history chains. Model gpt-5.6-sol (Codex CLI), session `01a09661-77a1-7341-a92f-0d56b417afcc`; round 7 had one item: ADDRESSED.

Evidence:
1. Delta of 1 commit, 3 files, +10/-10; the REQ body delta is AC-18 only, the PL adds 1 manual-TC named-commit list in step.
2. REQ body 8,031/14,000; six sections 447/800, 1,310/6,000, 316/800, 4,823/6,000, 11/1,200, 960/1,000; 33 ACs, longest 221/240; PL 5,974/6,000.
3. `git show`: `ff7ecdb` tc_review 9→11, `2d9c95e` 11→13, both violate AC-10's first-parent section round +1; `3d78ad9` belongs to PR #24 and per Non-goals is neither replayed nor retroactively checked.
4. AC-18 names 4/4: `2bb6571` changes 8 TC statuses, `1ebf3c4` changes 2 existing BUG statuses, both matching AC-14; the other 2 round skips match AC-10 and do not falsely trigger AC-07.
5. CHK01–08 and R1–R8 all pass; A1–A8 on the AC-18 delta: 0 blocker / 0 major / 0 minor / 0 nit; four gates 4/4 exit 0.

Findings: None

Pending human-001: None

## tc_review

Conclusion: PASS (round 2, 2026-09-13, generator-001)

Review scope: `6f75e0d..6d25894` (T19 pull-back, T02 r7 / r8, T03 r8, T05 r2); changes fall on the REQ's AC-10 / AC-18 and TC-01 / 06 / 09 / 10 / 11 / 13 / 14 / 19; the other 13 TCs, TC-PLAT-008-12 and the four carried BUGs untouched. Round 1 had six items: 6 ADDRESSED / 0 PARTIALLY / 0 NOT ADDRESSED.

Evidence:
1. Item-by-item close-out: #1 AC-18 now names the round skips and states explicitly that the three first-round commits are not named (TC-11 preconditions / step 3 / expected); #2 AC-10 changed to per-gate +1, first sign-off 1, req_review additionally equal to `review_round` (TC-06 whole section, TC-19 gains an anchor); #3 TC-10 drops the 007 / 008 regression, keeps only TC-16; #4 TC-01 gains the version assertion; #5 TC-13 / 14 changed to e2e; #6 TC-09 drops the synthetic event unused by the steps.
2. PR #22 first-parent chain, 116 commits measured: the tc_review round runs 1…17, only `ff7ecdb` (9→11) and `2d9c95e` (11→13) skip, the other three gate sections have zero skips; exactly two commits change TC / BUG status under a non-transition subject — `2bb6571`, `1ebf3c4`.
3. The deltas of `e254de1` / `1878b23` / `ff5ea01` each contain only this transition's REQ status / owner and the first sign-off of its gate section (ff5ea01 additionally the 9 TCs, 2 BUGs and the RV-PLAT-006 regression line within T13's effects), so AC-18's "not named" holds.
4. The new AC-10 is self-consistent for this REQ: req_review 7 → 8 and equal to `review_round` 8, this section's first-parent round 1 → this round 2, the remaining two gates will sign 1 on first sign-off; the TC-19 anchor verified (RV-PLAT-008 req_impl_review from 2 at `3d78ad9` to 3 at `f6aa12c`).
5. Coverage 33/33 (AC-25 carried by TC-PLAT-008-12), no AC covered by two TCs; the 21 `verifies` and Expected-results ids are equal file by file, bodies 618–1,056, preconditions 138–390, the 5 manual TCs' Implementation location is the fixed sentence; four gates 4/4 exit 0, `tests/gates` 685 passed, skipped / xfail 0.

Findings:

| # | Location | Finding | severity | confidence | Disposition |
|---|---|---|---|---|---|
| 1 | TC-19 expected AC-29 | The first sentence "RV-PLAT-008 req_impl_review re-entry signs 3 as 2 + 1" is AC-10's round rule and outside AC-29's assertion scope (AC-29 covers only this REQ tree's three check groups, unchanged function names and the torn-effect replay) | nit | high | Move to TC-06 in the next tc_design, or keep as an anchor not counted as an assertion |

Pending human-001: None

## tc_impl_review

Conclusion: PASS (round 2, 2026-09-13, evaluator-001)

Review scope: `6befb76..668af38` (T08 round 2); round 1 had four items: 4 ADDRESSED / 0 PARTIALLY / 0 NOT ADDRESSED. Changes fall on
`test_lifecycle_generated.py` (`TestArtifactStatusAndPrNumberEffects`, `TestBlockingTransitions`),
`test_lifecycle_table.py::TestV2SchemaAndConsistency`, `test_req_lint_rv.py::TestExternalReviewSection`; the other test code,
the 21 TC texts and TC-PLAT-008-12 untouched.

Evidence:
1. Item-by-item close-out: #1 (exempt T02) split into `test_the_two_registered_places_check_pr_number` (paired positive / negative
   cases for T11-required / T02-exempt) + `test_everywhere_else_pr_number_is_not_checked` (T02-required / T06-required negative cases,
   discriminating axis `tc_policy`); #2 (self-carried) `blocked_pair` gains a `self_carried` parameter, `linked_req` exactly the REQ
   itself, the five-source positive cases now go through `linked_req=""` (not self-carried) + new self-carried five-source positive
   cases + four-source (all but req_review) negative cases; #3 (TC-01 field) adds `assert field in joined`; #4 (TC-15 weak assertion)
   unifies the assertions over the five variants and adds a comment explaining why the fence / indent variants diagnose at section
   rather than row level.
2. `uv run pytest tests/gates`: 684 passed / 184 xfailed / 0 skipped / 0 failed, matching the T08 round 2 declaration; all 184
   xfails are `strict=True`.
3. `./scripts/lint.sh` (ruff + mypy) and the four gates all exit 0.
4. Discriminating power of the new cases verified: `test_everywhere_else_pr_number_is_not_checked` uses "same T code, different
   tc_policy" as the axis, proving only exempt checks T02's pr_number; `test_a_self_carried_block_may_not_take_the_source_restore_pair`
   builds the negative case with `linked_req=REQ` but the non-self-carried restore pair, excluding the req_review source (the two
   derivations coincide there and do not discriminate).
5. `git diff 6befb76..668af38 -- tests/` has no other changes; REQ frontmatter / README carry only the routine status / owner changes,
   review_round untouched (still 8).

Findings: None

Pending human-001: None

## req_impl_review

Conclusion: PASS (round 3, 2026-09-13, evaluator-002)

Review scope: `b610c22..HEAD`, the PR #26 body and the two rulings human-001 has accepted; only the round 2 item and new breakage in the fix diff were re-reviewed, against the 33 ACs, the PL, TC-01/02/08/09/20/21, the other TCs, TC-PLAT-008-12 and the four carried BUGs. Model gpt-5.6-sol (Codex CLI), session `01a098c4-9bc5-7af2-b484-4b92a8d61758`; round 2 had one item: 1 ADDRESSED / 0 PARTIALLY / 0 NOT ADDRESSED.

Evidence:
1. Both reproductions from the previous round re-run in a temporary Git repository: a compliant T03 delta with a trailing `T04`, and a bug_fix delta with a trailing `T06`, each report 1 violation naming the trailing code; the original item is ADDRESSED.
2. Fix scope 5 files, +89/-3; T03b/T03c each match uniquely, `TC-PLAT-009-01` and `T-shirt` are not falsely matched, the positive cases of the five legal events pass; A1–A8 show no new breakage, 45 fix-related items pass.
3. `tests/gates` 881 passed / 0 failed / 0 xfail / 0 skip; lint 431/78 all green; four gates 4/4 exit 0; `main..HEAD` exit 0.
4. Manual TCs, item by item below.
TC-PLAT-009-09: passed; 2 kinds of bad JSON / missing field exit 1, 1 kind of non-PR exit 0, the workflow has 5 steps and the first 4 are unchanged.
TC-PLAT-009-11: passed; replay of 116 commits / 14 violations, the 4 specified SHAs named, 3 SHAs not named.
TC-PLAT-009-13: passed; criteria delta 0 files, the round 1 4-step check result carried over.
TC-PLAT-009-14: passed; criteria delta 0 files, the round 1 4-step check result carried over.
TC-PLAT-009-19: passed; 21 positive cases, 48 guard / 75 effect tear-outs all red, legal / split chains 2 items as expected.
5. The TCs of carried BUG-003/004/005/006 — TC-16/008-12/17/18 — 4/17/5/2 respectively, 28 passed in total; the four BUGs closed, the 21 TCs of this REQ and the origin TCs all passing, the RV-PLAT-008 regression line recorded.

Findings: None

Pending human-001: None
