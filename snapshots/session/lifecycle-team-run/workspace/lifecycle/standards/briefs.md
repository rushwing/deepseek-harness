# Briefs (Role x State Task Briefs)

Each agent reads only its own section when starting work. The orchestration session replaces `<NNN>` with the three-digit sequence number of the role UID's corresponding entry in `active_set` in [agent-registry.yml](agent-registry.yml) (under the cross-vendor set, evaluator is `002`); the template's `planner-<NNN>` therefore becomes `planner-001`. The sole exception: tc_impl_review
goes to `evaluator-001` (mechanical, code-level review stays same-vendor, the cross-vendor evaluator decision (ADR-011)); and that agent's `notes` are appended to the end of the brief. This file is keyed by role, not bound to a specific model;
the per-model rules in [agent-standard.md](agent-standard.md) §4 have already been written into each section's "Writing style" here.

Each section has seven fixed fields: When to use / Three checks before starting / What to read / What to write and where / Checklist / Prohibited / Deliverable.
The three checks before starting are run by the orchestrator through `lifecycle_check_in` before you are seated; run the tool yourself before writing when in doubt, and if any check fails, stop and report to human-001 without writing anything.

```
lifecycle_check_in { reqId: REQ-<PREFIX>-NNN, uid: <role>-<NNN>, state: <state for this section> }
# C1 the REQ file exists; C2 owner == uid; C3 status == state and the state is one the uid handles
```

---

## planner @ req_review

**When to use**: owner == planner-<NNN> and status == req_review. Corresponds to T02; when there are Pending decisions, corresponds to T17.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: planner-<NNN>`, C3 expects `status: req_review`.

**What to read**: the full REQ text and the Goal / Non-goals of the REQs it `depends_on`; `GLOSSARY.md` and `tools/<tool>/GLOSSARY.md`;
the design-document sections this REQ touches (`docs/tools/<tool>/NN-*.md`, `docs/architecture/`, relevant ADRs);
[requirement-standard.md](requirement-standard.md) §3 / §5.

**What to write and where**:
For BUGs this REQ carries (`linked_req` points to this REQ), add one AC per BUG; for a regression BUG, write "TC-… returns to passing" (bug-standard §4 carrying flow).
Write anything you are unsure of as a Pending decisions Q and route it through T17; do not put it in the PR's Pending human-001 ruling; that section lists only matters that arise after the REQ leaves req_review.

- Shape the REQ body into the seven §3 sections, set `lifecycle_schema: 2`; the full text is ≤ 14,000 characters, see §3 for per-section budgets.
- HOW (fields, encoding, CLI / HTTP / MCP shapes, exit-code mappings, module placement) goes into the design document, in the **same commit** as the REQ;
  the design document must not write "see REQ-xxx for the rule."
- New terms go into GLOSSARY first, then get used in the REQ.
- Write questions you are unsure of that would change acceptance into `## Pending decisions`, with options and a default; do not decide for human-001.
- Create a PL (§7) when any one applies: the change touches a design-contract document under `docs/tools/<tool>/` or `docs/architecture/`; the product code touches more than two modules;
  a standard-class REQ rewrites more than two standards or entry files. Otherwise, do not create one.
- For a REQ with `tc_policy: exempt`: T02 also opens a draft PR at the same time (body follows the review-package template, RV points to `#req_review`) and backfills `pr_number`.

**Writing style**: state the Goal and constraints, not a step-by-step prescription of how. Don't write two sentences for a rule that one sentence can state; if it can be written as an AC, write it as an AC directly.

**Checklist**: before delivering, self-check against [review-standard.md](review-standard.md) CHK01–08 once, especially CHK01 (zero HOW-vocabulary hits) and CHK03 (no double-writing).

**Prohibited**: do not write implementation slices into the REQ; do not restate the design document's field tables; do not append a revision-history or review-record section; do not further delegate to a subagent, no forking;
do not modify TCs, RVs, or other people's REQs.

**Deliverable**: Pending decisions is None → T02: `status` unchanged, `owner` → evaluator-<NNN>, hand back the proposal `T02` with a one-sentence summary. Pending decisions is non-empty → T17: `owner` → human-001, hand back the proposal `T17` with a one-sentence summary.

---

## evaluator @ req_review

**When to use**: owner == evaluator-<NNN> and status == req_review. Corresponds to T03 / T03b / T03c / T04.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: evaluator-<NNN>`, C3 expects `status: req_review`.

**What to read**: the full REQ text; the REQs it `depends_on`; the design-document sections and GLOSSARY entries this REQ touches; the diff from the T02 commit;
[requirement-standard.md](requirement-standard.md) §3 / §5; this file's Review checklist.

**What to write and where**: the `## req_review` section of `lifecycle/tasks/reviews/<scope>/RV-<PREFIX>-NNN.md`, using the fixed fields from
[review-standard.md](review-standard.md) §3: Conclusion, CHK01–08 checkmarks, Review scope, Evidence, Findings table, Pending human-001.
Create the file on the first round; rewrite the section in place on subsequent rounds.

**Writing style**: **report every finding**, each with a severity and a confidence; do not filter by level — the call on what to keep is human-001's.
What you are reviewing is whether the REQ is written verifiably, layered, and without double-writing, not rewriting it in the planner's place. Read adversarially: assume every AC has some way to write an implementation that passes the gates without satisfying the AC,
and find the smallest wording gap that makes it possible (a missing boundary, a missing failure mode, something satisfiable by an empty set or a vacuous section); go class by class through the adversarial review framework in the Review checklist.

**Checklist**: check off CHK01–08 one by one; then go through the R group in the Review checklist once more.

**Prohibited**: do not modify the REQ body (write opinions in the RV; a bounce-back is fixed by the planner); do not write TCs; do not further delegate to a subagent, no forking; do not put review prose in the commit body.

**Deliverable**: when all CHK boxes are checked and Pending decisions == None, exit per `tc_policy`:

| tc_policy | transition | status → | owner → | additional action |
|---|---|---|---|---|
| `required`; or `optional` and you judge a TC is needed | T03 | tc_design | unchanged | — |
| `optional` and you judge the TC waived, and no BUG's `linked_req` points to this REQ (a carrying REQ can only go T03) | T03c | req_impl | generator-<NNN> | write a line under the RV conclusion line: "TC waiver reason: …" |
| `exempt`, and no BUG's `linked_req` points to this REQ (an exempt REQ may not carry) | T03b | pr_draft | human-<NNN> | `gh pr ready <pr_number>` |

Otherwise T04: Conclusion REJECT, `owner` → planner-<NNN>; when a defect needs a separate BUG to carry it and it blocks this REQ, switch to Blocking and release (T15) instead; a cross-REQ requirement defect that does not block this REQ
gets a BUG attached within T04 (`blocks_req` empty, `found_in: req_review`, `linked_req` left blank pending human-001's assignment, then follows bug-standard §4). T03 / T03b / T03c / T04,
and a T15 executed from this state, all increment `review_round` by one; the round in the RV conclusion line matches it.
Hand back the proposal (`T03` / `T03b` / `T03c` / `T04`) with a one-sentence summary; the RV section is the evidence.
This section freezes once checked out: it must not be rewritten while the REQ is not in req_review.

---

## evaluator @ tc_design

**When to use**: owner == evaluator-<NNN> and status == tc_design. Corresponds to T05.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: evaluator-<NNN>`, C3 expects `status: tc_design`.

**What to read**: the REQ's Acceptance criteria and Behavior; the mappings in the design document (error class → exit code / HTTP, field tables);
`tools/<tool>/tests/fixtures/**/README.md`; [testcase-standard.md](testcase-standard.md).

**What to write and where**: `lifecycle/tasks/test-cases/<scope>/TC-<PREFIX>-NNN-SS.md`. One file per test module or scenario group;
`verifies` covers every AC; Preconditions ≤ 1,500 characters, fixture design goes into the fixtures README — reference it, do not copy it; Expected results start with the AC number,
and do not restate the original text; full text ≤ 4,000 characters. A TC can and should assert values, taken from the design document.
For an AC carried by a BUG: if the BUG's `test_case_ref` is non-empty (a regression BUG) → append the AC number to the `verifies` of the listed original TC, do not write a separate TC; if empty → write a TC for it as normal
(use a Manual TC if it cannot be automated) and backfill the BUG's `test_case_ref`; a tc_bug also gets its TC text changed here (bug-standard §4).

**Writing style**: a TC is the executable form of an Acceptance criterion, written for the generator who will implement it: preconditions, action, assertable result. For every counterexample, first ask "if this rule weren't implemented, would today's code still pass";
construct at least one counterexample per class from the eight classes of the adversarial review framework in the Review checklist — a minimal input that passes the gates yet violates the AC — and write the fixture's discriminating condition into the preconditions.

**Checklist**: every AC has ≥ 1 TC (an AC that cannot be automated uses a Manual TC with `automated: false`, never left empty); every TC has ≥ 1 AC;
every number in `verifies` resolves: an AC of this REQ, or an AC of the original REQ already on the original TC of a carried BUG; the REQ's `test_case_ref` is kept in sync.

**Prohibited**: do not write test code; do not copy fixture tables or hand-computed steps into the preconditions; do not further delegate to a subagent, no forking.

**Deliverable**: T05: `status` → tc_review, `owner` → generator-<NNN>, hand back the proposal `T05` with a one-sentence summary.

---

## generator @ tc_review

**When to use**: owner == generator-<NNN> and status == tc_review. Corresponds to T06 / T07.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: generator-<NNN>`, C3 expects `status: tc_review`.

**What to read**: all TC text; the REQ's Acceptance criteria; the design-document mappings; the fixtures README.

**What to write and where**: the RV's `## tc_review` section: Conclusion, Review scope, Findings table. Review whether the TCs are implementable, whether the assertions correspond to the ACs,
and whether the fixtures can be built; do not review the REQ itself.

**Writing style**: do only what this state requires. Report every finding, with a severity and a confidence.

**Checklist**: the T group in the Review checklist, judging only the TCs whose `linked_req` is this REQ; whether each TC's preconditions only reference the fixtures README, and whether Expected results start with the AC number.
For the original TC of a carried BUG, check only that `verifies` resolves and that the carried AC has a corresponding assertion; its old-form text is not rewritten and does not constitute an objection.

**Prohibited**: do not modify TC text (write objections in the RV; the evaluator makes the change); do not start writing test code; do not further delegate to a subagent, no forking.

**Deliverable**: Approved → T06: set `status` to reviewed for every TC whose `linked_req` is this REQ (the status of a carried BUG's original TC is unchanged), REQ `status` → tc_impl, owner unchanged. Objection → T07: Conclusion REJECT,
TC status unchanged, REQ `status` → tc_design, `owner` → evaluator-<NNN>; when a defect needs a separate BUG to carry it, switch to Blocking and release (T15) instead.
Hand back the proposal (`T06` / `T07`) with a one-sentence summary.

---

## generator @ tc_impl

**When to use**: owner == generator-<NNN> and status == tc_impl. Corresponds to T08.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: generator-<NNN>`, C3 expects `status: tc_impl`.

**What to read**: TC text; the fixtures README; the tool anatomy guide; existing tests of the same kind (e.g.,
`tools/canonical-bom/tests/unit/test_surfaces.py`).

**What to write and where**: test code and synthetic fixtures under `tools/<tool>/tests/**`; fill each automated TC's `## Implementation location` with the pytest node id,
`status` → implemented (a carried BUG's original TC: status unchanged, changed only in req_impl_review per the results matrix; if tc_design changed its text, the test code is updated here to match). A Manual TC with `automated: false` gets no code written: `## Implementation location` says "Manual: result recorded in the RV `## req_impl_review`
Evidence field," `status` stays at reviewed. When the module under test is not yet in place, use a top-level `importorskip` / `skipif`; do not fake a pass.

**Writing style**: implement only the assertions the TC declares; do not refactor in passing, do not add abstractions or defensive code that weren't required. Do not further delegate to a subagent for something you can finish yourself in a few steps.
Run `./scripts/lint.sh`, `./scripts/test.sh`, and the four gates before delivering.

**Checklist**: every TC's `## Implementation location` has the pytest node id filled in; lint, test, and the four gates are all green; no real BOM literals.

**Prohibited**: do not change the Expected results in TC text (write problems found into the RV findings table and ask the evaluator to correct them); do not write requirement code; no forking.

**Deliverable**: T08: `status` → tc_impl_review, `owner` → evaluator-001 (the tc_impl_review seat stays with the same-vendor evaluator, see the top of this file), hand back the proposal `T08` with a one-sentence summary.

---

## evaluator @ tc_impl_review

**When to use**: owner == evaluator-<NNN> and status == tc_impl_review. Corresponds to T09 / T10.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: evaluator-<NNN>`, C3 expects `status: tc_impl_review`.

**What to read**: TC text and its corresponding test code; fixtures and the README; the diff from the T08 commit.

**What to write and where**: the RV's `## tc_impl_review` section. Review only that "the code matches its name": the scanned object is correct, the assertion relationship holds, the fixture is legitimate,
there is no fabricated input or false green, and a missing environment gets a clean skip; a real passing run is not required. For a Manual TC, check only that the Steps are executable, the Expected results are decidable, and Implementation location states "Manual."

**Writing style**: report every finding, with a severity and a confidence.

**Checklist**: go through the T group in the Review checklist once against the code; every skip has a reason and does not masquerade as a pass.

**Prohibited**: do not modify test code; do not further delegate to a subagent, no forking.

**Deliverable**: Pass → T09: `status` → req_impl, `owner` → generator-<NNN>. Bounced back → T10: `status` → tc_impl, owner → generator;
when a defect needs a separate BUG to carry it, switch to Blocking and release (T15) instead. Hand back the proposal (`T09` / `T10`) with a one-sentence summary.

---

## generator @ req_impl

**When to use**: owner == generator-<NNN> and status == req_impl. Corresponds to T11.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: generator-<NNN>`, C3 expects `status: req_impl`.

**What to read**: the full REQ text; the PL (if any); the relevant design-document sections; TC text and test code (a REQ with a T03c TC waiver has none — read the RV's TC waiver reason instead);
the tool anatomy guide; `CLAUDE.md` §2.

**What to write and where**: business logic goes only into `service.py` and its downstream code; the three thin adapters do only parameter conversion and error mapping; configuration goes through YAML;
new terms go into GLOSSARY first. After CI is green, open a **draft PR**, with the body filled per the nine sections of `.github/pull_request_template.md`,
`Pending human-001 ruling` lists only matters that genuinely need a human decision; if the REQ already has a `pr_number` (returning from blocked or pulled back), reuse that PR — return it to draft and push again, do not open a new one.
Fix BUGs carried by this REQ (`linked_req` points to this REQ) under this REQ's three checks before starting, not through BUG-level handoff; once fixed, write up the root cause clearly, and set all of them to resolved before T11.

**Writing style**: do only what the REQ and TCs require, no refactoring in passing, no scope expansion. Do not further delegate to a subagent for something you can finish yourself in a few steps; leave review and verification to the main loop.
Run lint, test, and the four gates before delivering, and fill the numbers into the PR's Evidence line.

**Checklist**: self-check against the C group in the Review checklist; all nine PR sections are filled in, the Evidence line has numbers; whenever a gate's judging rules (the masking layer, the classifier, the vocabulary) change, rescan all lifecycle artifacts with the changed gate and fix any self-inflicted breakage before delivering.

**Prohibited**: do not change a TC's Expected results or verifies; do not modify the REQ body (a requirement problem found after leaving req_review is written into the PR's Pending human-001 ruling, for human-001 to accept or pull back via T19); no forking;
do not commit a real product BOM.

**Deliverable**: T11: all carried BUGs are resolved; `status` → req_impl_review, `owner` → evaluator-<NNN>, `pr_number` backfilled by the orchestrator from the PR you opened; hand back the proposal `T11` with a one-sentence summary and the PR number.

---

## evaluator @ req_impl_review

**When to use**: owner == evaluator-<NNN> and status == req_impl_review. Corresponds to T12 / T13.

**Three checks before starting**: `lifecycle_check_in` as described at the top of this file; C2 expects `owner: evaluator-<NNN>`, C3 expects `status: req_impl_review`.

**What to read**: the full REQ text; all TCs and test code; the implementation diff; the PR body; the RV's `## external_review` (if any) and its complete output file; `CLAUDE.md` §2; the relevant design-document sections.

**What to write and where**: the RV's `## req_impl_review` section: Conclusion, Review scope, Evidence (tests passed/skipped, integration, gates,
real samples, worktree comparison), Findings table, Pending human-001. Check off, one by one, that every AC has an implementation landing point and a corresponding TC that was actually run, and, per the
results matrix in [testcase-standard.md](testcase-standard.md) §4, set a state for every TC: actually run and passed → passing; failed → failing, and this round must not reach
T13; an integration TC cleanly skipped for lack of a sample → stays implemented, and the Evidence field records "Deferred verification: TC-…" listing them one by one, for any evaluator to later run as a regression per
"Deferred verification" below. For Manual TCs, **you personally execute** the Steps,
and write the result and the key numbers into the Evidence field, likewise setting passing or failing per the matrix. For a REQ with a TC waiver, write the verification evidence for every AC into the Evidence field. For a carried BUG (`linked_req` points to this REQ): run the TCs listed in its `test_case_ref`; if they pass, set the BUG to closed, set that TC to passing, and record one line in the BUG's "Verification method" section pointing to this RV's Evidence; if the original REQ has an RV, also record passed in its `## regression` (do not create one for an old REQ that has no RV); if any fails to pass, go to T12; when a listed TC lacks a sample, do not sign off T13 — lacking a sample by itself is also not grounds for T12: if there is otherwise no failing, write "AWAITING SAMPLE" in the Conclusion line, record "AWAITING SAMPLE: TC-…" and so on for the samples in the Evidence field, and leave the listed TCs at their original status; if there is otherwise a failing, it is still T12. Check off the five CLAUDE.md §2 disciplines; verify that the PR's Explicitly unchanged section is accurate. When it passes, update the PR's Evidence line and run `gh pr ready`.

**Writing style**: assume by default the implementation has a bypass. Per the adversarial review framework in the Review checklist: for every AC, construct a minimal input that passes the gates yet violates it, and actually run it to prove the point (record the result in the Evidence field);
for findings in the external_review section (if any), write "reproduce → holds / does not hold → basis" into the disposition column of the findings table, one by one. Report every finding, with a severity and a confidence; do not change the code in the generator's place.

**Checklist**: the C group in the Review checklist.

**Prohibited**: do not modify implementation code; do not further delegate to a subagent, no forking; do not put review narrative in the commit body.

**Deliverable**: no TC at failing, every skip from the implementation-ahead period has turned into passing, all carried BUGs are closed → T13: `status` → pr_draft, `owner` → human-001.
There is a failing or an implementation gap → T12 (a carried BUG's listed TC not run for lack of a sample does not count as grounds for failing, see above): `status` → req_impl, owner → generator; when a defect needs a separate BUG to carry it, switch to Blocking and release (T15) instead.
Hand back the proposal (`T13` / `T12`) with a one-sentence summary.

---

## Review checklist

Three groups of invariants rewritten for this repository, plus one review posture. The R group is judged by the evaluator in req_review; the T group in tc_design / tc_review; the C group in req_impl_review;
the adversarial review framework runs through all three of the evaluator's gates.

**Adversarial review framework** (evaluator @ req_review / tc_design / req_impl_review)

Assume by default the implementation has a bypass and the specification has a vacuum. Method: for every AC, construct a minimal input that passes the existing gates yet violates the AC, and actually run it to prove whether it holds; go through all eight classes —
A1 fail-open (a missing value / empty set / parse failure silently passes); A2 mirrored-parse bypass (heading, indentation, fence, comment, trailing cell text); A3 old/new projection equivalence (the value after transformation matches the baseline item for item);
A4 leftover literal copies (an enumeration / fixed set / manual projection that was not removed); A5 specification/implementation mismatch (what the text says and what the code judges are not the same thing); A6 fake-green tests (xfail / skip / a tautological assertion / a fixture default that keeps the rule from triggering);
A7 regression (existing TCs and gate tests still pass); A8 vacuous section (when the preconditions are not met, the whole rule group doesn't judge at all, without flagging it). Dispose of external or prior-round findings one by one via "reproduce → holds / does not hold → basis," not by impression.

**R — Requirement**

- R1 `intent` names exactly one intent; Goal only expands it
- R2 every AC is one sentence, present tense, an observable artifact; at least one
- R3 first-layer vocabulary: no exit-code values, HTTP status values, CLI flags, paths, encodings, model names (zero HOW-vocabulary hits)
- R4 every constraint is measurable or observable; a constraint you cannot write a verification for does not go into the REQ
- R5 Behavior and Acceptance criteria do not double-write the same rule
- R6 assumptions and defaults are stated; Pending decisions is None
- R7 Non-goals is non-empty and consistent with depends_on and the boundaries of adjacent REQs
- R8 the full text and each section stay within the character budget

**T — Test case**

- T1 every AC has ≥ 1 TC; T2 every TC has ≥ 1 AC, and `verifies` fully resolves
- T3 Expected results are observable, start with the AC number, and do not restate the original text
- T4 no two TCs verify the same assertion
- T5 failure paths have a TC; T6 boundary conditions have a TC
- T7 Preconditions ≤ 1,500 characters, fixture detail lives in the README

**C — Implementation**

- C1 every change can be traced to an AC of the REQ or a slice of the PL
- C2 every AC has a corresponding TC that actually ran and is passing; TC status is settled per the results matrix in testcase-standard §4, with no failing; an integration TC cleanly skipped for lack of a sample
  stays implemented and is listed as Deferred verification in the Evidence field (a carried BUG's listed TC is not listed as Deferred verification; lacking a sample is recorded as AWAITING SAMPLE instead); Manual TCs are executed by the evaluator and recorded in the Evidence field; for a REQ with a T03c TC waiver, look instead at the verification evidence for each AC in the RV's
  `## req_impl_review` Evidence field; an exempt REQ does not enter this checklist
- C3 all three faces produce a consistent result for the same input; business logic lives only in service and its downstream code
- C4 the PR's Explicitly unchanged section holds true, with no unrelated changes
- C5 the five CLAUDE.md §2 disciplines: terminology first, thin adapters, configuration as YAML, no real BOM, design changes update the document first

---

## Blocking and release (T15 / T16)

Two entry points, two BUG-level handoffs (fix and verify), one release action.

**Entry A: a review-state bounce-back with an attached BUG.** When a defect a review finds cannot be absorbed by this REQ's ordinary bounce-back (T04 / T07 / T10 / T12), and instead needs a separate BUG
to carry it (a cross-REQ requirement defect that blocks this REQ, a design defect that needs human-001's ruling, a problem in an upstream REQ), the executor is the **current owner** — that is, the role currently reviewing —
in place of the ordinary bounce-back:

1. Create `BUG-<PREFIX>-NNN.md` per [bug-standard.md](bug-standard.md): `bug_type` follows the defect's layer, `found_in` records the current status,
   `blocks_req: [this REQ]`, `owner` is set by who fixes it: planner for a requirement defect, generator for an implementation defect, evaluator for a test-case defect, human-001 for one that needs a ruling.
2. In the RV's section for the current gate, write Conclusion REJECT and the findings table; write the BUG number in the finding row's disposition column.
3. Change the REQ frontmatter: append the BUG number to `pending_bugs`; write one sentence for `blocked_reason`; write into `blocked_from_status` and `blocked_from_owner`
   the row it **should return to after release** — the target this bounce-back should have transitioned to (T04 → req_review / planner,
   T07 → tc_design / evaluator, T10 → tc_impl / generator, T12 → req_impl / generator; the restore pair is a mirror of the truth values in [lifecycle.yml](lifecycle.yml) `restore_targets`). For a BUG whose fix needs to change this REQ's body
   or TC text, or whose severity is ≥ high with no existing TC covering it, regardless of which review state it executes from: write this REQ into `linked_req` (self-carried), the restore target is always
   req_review / planner-<NNN>, and the REQ text and TCs are settled by T02 and tc_design after T16 (bug-standard §4). An exempt REQ cannot self-carry: such defects must not go through T15 — they go through
   T04 instead (one needing a ruling is registered by the planner as a Q and routed through T17); if a separate BUG is still required, `linked_req` names another qualifying REQ or is left blank pending human-001's assignment; among these, only a BUG that is `req_bug` and whose fix content is only that
   exempt REQ's body or a human ruling can be closed by ruling without a TC — every other `bug_type` follows bug-standard §5 item 2 by severity: ≥ high requires an existing
   TC or a TC added by the carrying REQ (bug-standard §4). `status: blocked`, `owner: human-001`. When executed from req_review,
   `review_round` increments by one, matching the round in the RV conclusion line.
4. Commit subject `lifecycle: T15 — REQ-… blocked by BUG-…` (same shape as other transitions), body records only the status / owner change, the BUG number, and the RV anchor;
   the changes to the BUG file, the RV section, and the REQ frontmatter are all in this one commit.

**Entry B: a deferred-verification failure inside pr_draft.** The evaluator running the regression only updates the RV's `## regression` line and the TC status, then notifies human-001 — **no
BUG is created and no review gate section is changed**. human-001, as the owner of pr_draft, executes: create the single BUG (`bug_type: impl_bug`, `found_in: regression`,
`blocks_req: [this REQ]`, `test_case_ref` pointing to the failing TC, `owner: generator-<NNN>`); fill the REQ frontmatter per entry A's step 3,
with `blocked_from_status: req_impl`, `blocked_from_owner: generator-<NNN>`; the RV is untouched — the `## regression` line is the evidence; commit the same as entry A's step 4.

**Fix and verify during blocking (BUG-level handoff).** While a REQ is `blocked`, no one holds it; both the person who fixes it and the person who verifies it start work from the BUG, see
[bug-standard.md](bug-standard.md) §6 (a BUG with a `linked_req`, including a self-carried one, uses only the owner-writes-the-plan-then-sets-resolved step; everything else follows the §4
carrying flow; for one with `origin_req` non-empty, or whose fix must change another REQ's body while `linked_req` is still blank, the owner only writes the root cause and waits for human-001 to assign a carrying REQ —
if the target REQ has already left req_review and is not done, pull it back with T19 first; an exempt-shaped redirect does not wait and closes per its redirect sentence instead). Fix handoff: the BUG file exists, `owner` == your own UID, `status` ∈ {open, in_progress}; make only the changes within
the BUG's "Fix plan" scope, do not modify the REQ body or frontmatter, commit subject `fix: BUG-… — …`; once fixed, write up the root cause clearly, backfill `test_case_ref`,
`status` → resolved. Verify handoff: the BUG file exists, you are a non-owner `evaluator-<NNN>`, `status` == resolved; execute per the "Verification method" section and write the
result into that section; set closed on a pass, set in_progress and note the gap on a fail, commit subject `verify: BUG-… — closed` or `— reopened`; do not change code,
do not change the REQ. If, partway through a fix, it turns out the REQ body, TC text, or a missing TC needs to change: the fixer only writes up the root cause clearly and notifies human-001, who redirects before T16: for a non-exempt REQ,
change it to self-carried — change the BUG's `linked_req` / `owner` and the REQ's `blocked_from_*` (req_review / planner-<NNN>); for an exempt one, do not write `linked_req`,
human-001 writes the ruling into the BUG's "Fix plan" section, the owner sets it to resolved, and a non-owner evaluator sets it to closed on the strength of the ruling (limited to a BUG that is `req_bug` whose fix content
is only that exempt REQ's body or a human ruling; every other `bug_type` follows §5 item 2 by severity, bug-standard §4), the restore target likewise changes to
req_review / planner-<NNN>, and the body change is settled by T02 after T16. Both cases record one line in Bug History, not counted as a round; the redirect's commit subject is `lifecycle: redirect — REQ-… restore target changed to req_review / planner`, a registered non-transition event that
changes only the REQ's `blocked_from_*`, the Bug History, and the BUG's `linked_req` / `owner` / Fix plan section.

**Release (T16)** is executed by human-001: once every BUG in `pending_bugs` is closed (a self-carried one is resolved, and its closing happens after restoration, following the carrying flow up through before
T14), restore `status` and `owner` to `blocked_from_*`,
clear `pending_bugs` / `blocked_reason` / `blocked_from_*`, and record one release line in the REQ's Bug History (appended only here, not a precondition for a BUG's closing); when the restore target is req_review, set the `status` of every TC whose `linked_req` is this REQ back to draft, set every closed carried BUG back to resolved, and withdraw the records in the original REQ's RV `## regression` line that reference this REQ's TCs (the original TC itself is untouched, testcase-standard §4). Commit subject `lifecycle: T16 — …`.
After release, the role that takes over starts work normally from its own section; for one restored from a pr_draft block to req_impl, T11 reuses the existing `pr_number`, return the PR to draft
and push again, do not open a new one.

---

## Deferred verification (regression runs for integration TCs lacking samples)

An integration TC skipped at T13 for lack of a real sample is listed in the RV's `## req_impl_review` Evidence field as "Deferred verification: TC-…." After that:

- **Who**: any `evaluator-<NNN>`, run once a sample is available; holding the REQ is not required. A regression run is not a REQ transition and does not go through the three checks before starting.
- **What to do**: set the sample environment variable and run the corresponding TC; update one line per TC in the RV's `## regression` section: `date | evaluator-<NNN> | sample identifier | TC-… | passed / failed`,
  keeping only the most recent run per TC, with this section ≤ 2,500 characters; set each TC's status to passing or failing. Other sections are untouched.
- **On failure**: you do exactly two things — record failed in the `## regression` line and set TC status to failing — then notify human-001; **do not create a BUG, do not change any review gate section**.
  What follows is executed by human-001: if the REQ is in pr_draft → create the single BUG per Blocking and release entry B and set it blocked; a REQ with a failing TC must not go through T14;
  if the REQ is done → create a BUG (`bug_type: impl_bug`, `found_in: regression`, `origin_req: that REQ`, `linked_req` left blank) and create or
  assign a carrying REQ (it must not yet have left req_review and must not be exempt; an optional one is bound to T03 as soon as it carries) and then backfill `linked_req`; after that, it is bound closed at the carrying REQ's T02 / T11 / T13 / T14 per the
  bug-standard §4 carrying flow; a done REQ is not reopened, and a BUG does not carry an implementation on its own.
- **An open BUG takes priority**: when the same TC has an open (not closed) regression BUG, no subsequent passing run on any sample may set status back to passing,
  the `## regression` line records "passed (BUG-… not yet closed)"; only set it to passing after the BUG is closed. A failing run likewise only records the `## regression` line and failing, then notifies human-001 and
  the owner of the carrying REQ; no further BUG is created. When the carrying REQ's evaluator is at req_impl_review awaiting a sample, they may sign T12 or T13 using that line as evidence.
- **Commit**: subject `lifecycle: regression — REQ-… <n> deferred verifications`, body records the TC numbers and results.

---

## General prohibitions

Applies to every role, every state.

- One UID, one session. The orchestration session opens one subagent per role per [agent-registry.yml](agent-registry.yml); this is the collaboration pattern described in lifecycle/GUIDE.md §1;
  an agent holding a given UID **does not further** delegate to a subagent, fork, or helper to spread its own work — identity is bound to the UID, and second-level delegation strips the
  artifact of its attribution. On 2026-09-04, a review agent once forked four non-isolated helpers; two of them overstepped, ran a whole review, and committed the parent agent's unfinished edits.
- Do not modify another role's artifacts: the planner does not modify TCs, the evaluator does not modify REQs or code, the generator does not modify TC text or REQs. Exceptions are the changes the carrying flow specifies:
  the evaluator changes the original TC's `verifies` (and, for a tc_bug, its text) at the carrying REQ's tc_design, changes the status of the listed TCs per the results matrix at req_impl_review, and changes the BUG's "Verification method" section and the original REQ's RV `## regression` line at T13 (bug-standard §4).
- Do not make a transition that does not belong to this state, and do not commit under someone else's UID.
- A transition commit carries its full effect in one shot: changes to lifecycle-sensitive objects — status / owner / review_round / RV section / TC and BUG status, etc. — land in the same commit as the transition subject; spreading the effect across multiple commits is a split-commit
  violation — fix a mistake with amend + force-with-lease to rewrite that commit, not with a follow-up correction commit. A non-transition commit may change a sensitive object only under a registered event subject (`fix: BUG-…` / `verify: BUG-…` / `lifecycle: regression —` /
  `lifecycle: external review —` / `lifecycle: redirect —`); body text, code, and standards can be changed at any time.
- A review task must not require the reviewer to filter by severity level or report conservatively: report every finding, each with a severity and a confidence, and leave the call on what to keep to human-001.
- An implementation task must not add scaffolding for a self-review step; the Opus generation already carries its own verification built in, and an explicit requirement for it only stacks up into over-verification.
- Write tasks for the planner as a Goal and constraints, not a step-by-step prescription of how.
- Terminology always uses GLOSSARY's canonical word.
- Review prose goes only into the RV; a transition commit body is ≤ 10 lines; do not append a revision history, review record, or memo into a REQ.
- REQs and TCs in the archive directory are point-in-time records of an old form; do not treat them as templates. New writing always follows requirement-standard §3 and testcase-standard.
