# Test Case Standard (TC specification)

## 1. File location and naming

- Path: `lifecycle/tasks/test-cases/<scope>/TC-<PREFIX>-NNN-SS.md`
- `NNN` = the number of the associated REQ; `SS` = the test-case sequence number under that REQ (starting at `01`)
- Example: `lifecycle/tasks/test-cases/canonical-bom/TC-CBOM-003-01.md` is associated with `REQ-CBOM-003`

## 2. Frontmatter

```yaml
---
tc_id: TC-CBOM-003-01     # must match the filename
tool: canonical-bom       # must match the containing directory
linked_req: REQ-CBOM-003
verifies: [AC-CBOM-003-01, AC-CBOM-003-02]   # the global AC numbers this verifies; required when linked_req is a v2 REQ
title: "One-sentence test-case title"
status: draft             # draft (tc_design) → reviewed (T06) → implemented (T08, automated) → passing (can sign T13) | failing (T12 / T15); see §4 for the result matrix
level: unit               # unit | integration | e2e
owner: evaluator-001      # must be a registered UID
automated: true           # false = manual TC: body writes out executable steps for a human, lifecycle in §4
---
```

## 3. Body structure

```markdown
## Preconditions   ≤ 1,500 characters; fixture tables, hand-computed anchor values, and version chains go in the fixtures directory's README — link here, don't copy
## Steps           numbered list, one action per step
## Expected results   each item starts with an AC number: `- AC-CBOM-003-01: …`, do not restate the REQ's original text
## Implementation location   for automated cases, the test code path (pytest node id)
```

Whole document ≤ 4,000 characters. When the example text itself contains a backtick, wrap it in double backticks (CommonMark's equal-length pairing); the gates judge by visible lines.

## 4. Conventions

### Who writes the TC text

**The Evaluator**, in the `tc_design` state. The TC text is the executable form of the acceptance criteria —
letting the implementer set their own standard would lose independence. In `tc_review` the Generator is only responsible for accepting the text or raising an objection, with the conclusion written in the RV;
on acceptance (T06) it sets the `status` of every TC whose `linked_req` is this REQ to `reviewed`, and on objection (T07) it leaves them unchanged. The status of a carried BUG's original TC is outside the
scope of T06 / T08, and is changed only in req_impl_review by the evaluator per the result matrix; for an original TC whose text tc_design has changed, the test code at its "Implementation location" is
updated along with the text by the carrying REQ's generator at T08, and reviewed together at T09; the T-group of tc_review and the §3 budget are judged only against TCs whose `linked_req` is this REQ — an
original TC is checked only for whether `verifies` resolves and has a matching assertion for the carried AC, and its legacy-form text is not rewritten (bug-standard §4).
When a REQ returns to `req_review` (pulled back by T19, or restored to req_review by T16), every TC whose `linked_req` is this REQ goes back to `draft`: both the text acceptance and the real-run evidence
assumed the REQ as it stood at the time, so after the REQ is rewritten they go through T06 / T08 / T13 again; the original TC is untouched. Any carried BUG already closed at that T13 goes back to resolved
together with it (the evidence for closed was the TC being passing, and that evidence no longer holds once the TC goes back to draft), to be set to closed again by the re-run T13. Lines in the original REQ's
RV `## regression` referencing these TCs are withdrawn together (their evidence likewise no longer holds), to be recorded again when T13 is re-run.

### REQ state and allowed TC status

A TC whose `linked_req` is a v2 REQ can only have its `status` land within the set allowed by the REQ's current state (for `blocked`, judged by the restore target). This table mirrors
[lifecycle.yml](lifecycle.yml)'s `tc_status_by_state`, checked by the gates.

| REQ state | Allowed TC status |
|---|---|
| `draft`, `req_review`, `tc_design`, `tc_review` | `draft` |
| `tc_impl`, `tc_impl_review` | `reviewed`, `implemented` |
| `req_impl`, `req_impl_review` | `reviewed`, `implemented`, `passing`, `failing` |
| `pr_draft`, `done` | `implemented`, `passing`, `failing` |

### Granularity: n : m

One TC per test module or scenario group, which may verify multiple ACs; every AC has at least one TC, and every TC verifies at least one AC.
Coverage is declared by `verifies`, checked by the gates ([GUIDE §6](GUIDE.md#6-gates)); coverage is connected globally by AC number — any TC whose `verifies` lists that number counts as coverage,
and an original TC's `verifies` may hold ACs from both its `linked_req` and the carrying REQ at once (bug-standard §4). This rule applies to `tc_policy: required` and to
`optional` judged in req_review to need a TC; an AC that cannot be automated is covered by a manual TC with `automated: false`, never left uncovered. `optional` that has waived TC (T03c), and `exempt`,
do not write TCs — their ACs are verified by the RV's PASS and PR review. Do not write one file per AC: of REQ-CBOM-019's 29 TCs,
24 restated the acceptance text verbatim — that is exactly the pattern this rule exists to eliminate.

### Manual TC (`automated: false`)

An AC that cannot be automated is covered by a manual TC. It follows the same path as an automated TC (tc_design → tc_review → tc_impl → tc_impl_review →
req_impl → req_impl_review), with only three differences:

- `## Implementation location` always reads "Manual: results recorded in the RV `## req_impl_review` evidence column", not a pytest node id;
- at T08 the generator writes no code for it, and status stays at `reviewed`; at T09 the evaluator checks only that the steps are executable and the expected results are decidable;
- at req_impl_review the evaluator **executes the steps in person**, writes the results and key figures into the RV `## req_impl_review` Evidence column, and sets
  status per the table below. The executor must be the evaluator — the generator cannot self-report.

### The req_impl_review result matrix

In req_impl_review the evaluator can only place each TC in one row of the table below; the precondition for T13 is that no TC is failing, and every
skip from the implementation-first period has converted to passing.

| TC result | status | Effect on the transition |
|---|---|---|
| Automated TC actually runs and passes | `passing` | Can sign T13 |
| Automated TC actually runs and fails | `failing` | Cannot T13; goes through T12 to send back, or T15 when a separate BUG is needed |
| Integration TC cleanly skipped for missing real samples (`@pytest.mark.integration` and the environment variable unset) | Stays `implemented`, RV Evidence column records "Deferred verification: TC-…" | Can sign T13; afterward follows the "Deferred verification" regression run below, no longer going through the REQ lifecycle. Except for TCs listed on a carried BUG: while samples are missing they keep their original status and do not get T13 signed off — missing samples alone is not grounds for T12, the conclusion line reads AWAITING SAMPLE (bug-standard §4) |
| Manual TC executed and passes | `passing` | Can sign T13 |
| Manual TC executed and fails | `failing` | Cannot T13; goes through T12 or T15 |

After a T12 send-back the generator fixes it; when it re-enters req_impl_review the evaluator reruns it and resets status per this table.

### Deferred verification (regression runs for sample-missing integration TCs)

Real samples do not go into the repository and CI never has them, so a sample-missing skip is allowed to pass T13, but what follows it does not go through the REQ lifecycle — it is a **regression run**:

- **Executor**: any evaluator-*, executed once samples are available, not required to hold the REQ. A regression run is not a REQ transition and does not go through the three preflight checks.
- **Evidence**: written into the RV's optional `## regression` section, keeping only the most recent run's line per TC (date, UID, sample identifier, TC number, result), updated
  in place, with history in git; this section is ≤ 2,500 characters. `## regression` is the only RV section not bound to a state; it does not change other sections.
- **status**: pass → the TC is set to `passing`; fail → set to `failing`.
- **Handling a failure**: the regression evaluator only records the `## regression` line and the TC status and notifies human-001 — it does not file a BUG and does not change any review gate section. The BUG is filed by human-001
  (`bug_type: impl_bug`, `found_in: regression`, `test_case_ref` pointing at the failing TC), split by the REQ's state into two cases:
  - REQ in `pr_draft`: the BUG has `blocks_req: [that REQ]`, human-001, as the owner of pr_draft, executes T15 (`blocked_from_status:
    req_impl`, `blocked_from_owner: generator`); fixing and verification go through the BUG-level handoff (bug-standard §6); once all BUGs are closed, T16 returns to req_impl
    and re-runs T11 → T13, with T11 reusing the existing `pr_number`. A REQ with a failing TC must not go to T14.
  - REQ in `done`: not reopened. The BUG has `origin_req: that REQ`, `linked_req` left empty, to be created or designated by human-001 with a carrying REQ (which must not yet have left
    req_review and must not be exempt — once `optional` carries a BUG it is bound to T03) and backfilled; it is then bound following the bug-standard §4 carrying process: the carrying REQ's T02 adds the AC,
    tc_design pulls the AC into the original TC's verifies, T11 requires the BUG resolved beforehand, T13 runs the original TC, sets it closed and passing, and records passed in this RV's `## regression`
    (when this RV exists); T14 is blocked until all are closed. A BUG never carries its own implementation.
- **Unclosed BUG takes priority**: when the same TC has an unclosed regression BUG, a subsequent passing run must not set status back to `passing`; the `## regression` line records
  "passed (BUG-… not yet closed)"; it is set to `passing` only once the BUG is closed. A failing run likewise only records the `## regression` line and failing, and notifies — no new BUG is filed; while the carrying REQ awaits samples
  its evaluator may sign T12 / T13 using this line as evidence (bug-standard §4).
- **Precondition**: a REQ's deferred-verification TCs at T13 must be listed one by one in the RV Evidence column; this rule does not apply to implementation-first-period skips.

### Fixture discipline

- **Real product BOMs do not go into the repository**. Tests use only synthetic data under `tools/<tool>/tests/fixtures/`.
- A synthetic fixture must ship with a `README.md` explaining **which expected result each planted anomaly corresponds to**,
  otherwise six months later no one will know whether a strange reference designator was deliberate or a slip. A TC's preconditions only link to this README, never copy it.
- A case that needs a real sample to verify gets `level: integration` plus `@pytest.mark.integration`,
  and registers this external dependency in the REQ's body.

### Two-stage review when tests come first

When the component under test has not yet landed (tests come first, and a missing module means `skip`):

- `tc_impl_review` **reviews only whether the code is truthful** — that the test, once its module is ready, will genuinely assert the properties it declares
  (the right object is scanned, the asserted relationship holds, fixtures are legitimate, no fabricated input or false green), and skips cleanly when the environment is missing.
  This stage **does not require an actual passing run**.
- **"Actual-run evidence" belongs to `req_impl_review`** — once the implementation has landed, a `skip` from the implementation-first period must convert to `passing` before T13 can be signed; the only skip allowed to remain
  after T13 is an integration TC missing real samples (row three of the result matrix, which then follows Deferred verification).

Precondition: cases gate at the top level with `importorskip` / `skipif`, not disguising "missing test support" as passing.
A review send-back should target "the code is not truthful," not "it doesn't run in the current environment."

### Regression convention

A BUG with severity `high` / `critical` must have a TC covering it before it closes, with the BUG's and REQ's `test_case_ref` backfilled: a regression BUG uses the original TC,
never a new one; one without TC coverage must have a `linked_req`, and the TC is added at the carrying REQ's tc_design (bug-standard §4 / §5). The sole exception: a
`req_bug` blocking an exempt REQ whose fix content is only that exempt REQ's body text or a human ruling closes on the strength of the ruling and PR review (bug-standard §4 carrying eligibility); a
`bug_type` other than that, blocking an exempt REQ, is not within the exception and follows this rule by severity as usual.

### Automated test stack

`pytest`. Consistency across the three surfaces (CLI / HTTP / MCP produce the same result for the same input) is a **structural contract**,
and every tool must have a corresponding test case — see
`tools/canonical-bom/tests/unit/test_surfaces.py` for reference.
