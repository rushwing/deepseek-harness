---
bug_id: BUG-PLAT-004
tool: platform
title: "TC-PLAT-008-12 text still says BUG state open is missing; the test already switched the discriminating axis to REQ state draft missing"
status: closed
severity: low
bug_type: tc_bug
owner: evaluator-001
linked_req: REQ-PLAT-009
origin_req: ""
blocks_req: []
found_in: req_impl_review
test_case_ref: [TC-PLAT-008-12]
---

## Symptom

The Preconditions and step 5 of TC-PLAT-008-12 still describe "a synthetic table registering only four BUG states (missing `open`)" as the discriminating axis of the `found_in` rule,
and the Expected results also say "with `open` missing, the verdict for that BUG's `found_in: draft` differs from the verdict with a compliant table". But the legal set of `found_in` is
`states.req ∪ {regression}` and contains no member of `states.bug`, so a missing `open` (a BUG state) cannot possibly change the verdict on `found_in: draft`
— the axis itself was chosen wrongly. `req_impl` r2 already switched the test code to "missing `draft`" (a REQ state) as the genuinely discriminating axis,
but the TC text did not follow, so text and test disagree. Codex round 2 scoped re-review r2-6 and RV-PLAT-008 `## tc_review` round 2 finding 1
are the same inconsistency; the former re-confirmed it in re-review, the latter had found it at tc_impl and dispositioned it as "absorbed in tc_impl, wording corrected in the next tc_design",
judged non-blocking at the time.

## Reproduction steps

1. Read the Preconditions and step 5 of `harness/tasks/test-cases/platform/TC-PLAT-008-12.md`: "a synthetic table registering only four BUG states (missing `open`)",
   "pass the synthetic table 'missing `open`' and that BUG fixture";
2. Read `tests/gates/test_req_lint_entry.py::TestNoFallbackOnContentViolation::test_found_in_consumes_the_table_it_is_given`:
   the docstring says explicitly "the TC text gives 'the table missing `open`' as the axis, but the legal set of `found_in` is states.req ∪ {regression}; one
   **BUG** state fewer cannot change its verdict"; the test actually uses `without_draft` (missing REQ state `draft`) for the discriminating assertion and `without_open`
   (missing BUG state `open`) only to prove "must not change";
3. Call `check_bug_frontmatter` with the compliant table and with a table that only deletes `states.bug.open`; both results are `[]` (the scenario the TC text describes
   has no discriminating power by itself).

evaluator-001 re-checked the test code and the TC text in req_impl_review round 2 and confirmed the inconsistency persists.

## Expected vs actual

- Expected: the TC text's Preconditions, step 5 and Expected results consistently describe "the discriminating axis is the synthetic table missing `draft` (a REQ state)".
- Actual: all three places still say "missing `open` (a BUG state)", inconsistent with the landed, genuinely discriminating test code.

## Root cause (filled in after diagnosis)

When the TC-12 text was finalised in tc_design round 2 the axis was chosen wrongly (the legal set of `found_in` was mistaken for `states.bug` instead of
`states.req ∪ {regression}`); when tc_impl round 2 found this it was dispositioned as "absorbed in tc_impl" and only the test code was changed to the missing-
`draft` axis, but changing test code is not changing the TC text itself (by the standard, TC text may be rewritten only by the evaluator in a dedicated tc_design round),
so the two diverged.

## Fix plan

In the next tc_design (or a dedicated TC text correction round) evaluator-001 rewrites "missing `open`" to "missing `draft`" in the three places of TC-PLAT-008-12 — Preconditions, step 5, Expected results —
and keeps "missing `open` does not change the verdict" as the control scenario description, aligned with the existing test code's
two variants `without_open` / `without_draft`. The test code itself needs no further change.

human-001 ruling 2026-09-12 (PR #24): carried by REQ-PLAT-009 (text corrected in its tc_design); 009 T01 fills `linked_req`.

## Verification method (linked TC)

After the TC-PLAT-008-12 text correction, evaluator-001 checks that the three axis descriptions in the text correspond word for word to the assertions in
`tests/gates/test_req_lint_entry.py::TestNoFallbackOnContentViolation::test_found_in_consumes_the_table_it_is_given`;
severity `low`, does not block this round's REQ-PLAT-008 closure; the current TC-12 test code itself passes on a real run.

Verification record: 2026-09-13 evaluator-002, TC-PLAT-008-12 real run, 17 items passed; see [RV-PLAT-009 req_impl_review evidence](../../reviews/platform/RV-PLAT-009.md#req_impl_review).

Fix 2026-09-13 (carried by REQ-PLAT-009, tc_design + T08 + T11):

- Root cause: the TC-PLAT-008-12 text wrote the axis as "the BUG state table missing `open`", while the legal set of `found_in` is
  states.req ∪ {regression}; one BUG state fewer cannot change its verdict — the genuine axis is "the REQ state table missing `draft`".
  The test code was written on the correct axis from the start (the two variants `without_draft` / `without_open`); the side that did not match was the text.
- evaluator-002 corrected the Preconditions, step 5 and Expected results of TC-PLAT-008-12 in REQ-PLAT-009 tc_design,
  and appended AC-PLAT-009-25 to its `verifies`; generator-001 updated the docstring of
  `test_found_in_consumes_the_table_it_is_given` at T08 to follow the text, so the axis names correspond word for word on both sides.
- Assertions unchanged: missing `draft` is judged a violation naming `found_in`, missing `open` gives the same verdict as the compliant table. TC-PLAT-008-12's status untouched.

## Round 3 addendum (2026-09-12, evaluator-001)

Codex round 3 scoped re-review r3-3 (P2, high) pointed out that the round 3 implementation diff raised TC-PLAT-008-12's `status` from
`implemented` to `passing` while the text/test inconsistency (this BUG's root cause) was not yet corrected, giving the appearance of a false green:
"text still inconsistent yet marked `passing`".

evaluator-001 re-checked the result-matrix criterion: TC status reflects **whether the automated real run passes**, not whether the TC text wording is precise —
the two classes `tests/gates/test_lifecycle_table.py::TestV1Fixation` and
`tests/gates/test_req_lint_entry.py::TestNoFallbackOnContentViolation` all pass on a real run today (re-run personally in req_impl_review
round 3: 17 items green), and the imprecise axis description in the text does not affect the correctness of those test assertions (the test code uses the genuinely
discriminating `without_draft`, with `without_open` only as control). Disposition: TC-PLAT-008-12 `status` stays `passing`
(per the result matrix, a passing real run is `passing`; "text pending correction" is a separate matter); the text correction proceeds as described in this BUG's "Fix plan",
left to evaluator-001 in the next tc_design round, without affecting this BUG's severity / bug_type / owner.
