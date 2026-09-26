# Bug Standard (BUG specification)

## 1. File location and naming

- Path: `lifecycle/tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md`
- Example: `lifecycle/tasks/bugs/canonical-bom/BUG-CBOM-001.md`

## 2. Frontmatter

```yaml
---
bug_id: BUG-CBOM-001      # must match the filename
tool: canonical-bom       # must match the containing directory
title: "One-sentence defect title"
status: open              # open | in_progress | blocked | resolved | closed
severity: high            # low | medium | high | critical
bug_type: impl_bug        # req_bug (requirement/design defect) | impl_bug (implementation defect) | tc_bug (test-case defect)
owner: generator-001      # must be a registered UID; during REQ blocked, the fixer starts work on the strength of this field (§6)
linked_req: REQ-CBOM-003  # which REQ carries the fix (may be empty, pending human-001's designation; non-empty enters the §4 carrying process)
origin_req: ""            # optional: fill in when the defect's origin REQ is already done and differs from the REQ carrying the fix
blocks_req: []            # filled when a review sends a REQ back; this enters that REQ's pending_bugs
found_in: req_impl_review # the state in which it was found; a deferred-verification regression-run failure writes regression
test_case_ref: []         # must be backfilled before closing (severity ≥ high)
---
```

## 3. Body structure

```markdown
## Symptoms
## Reproduction steps
## Expected vs actual
## Root cause (filled in after diagnosis)
## Fix plan
## Verification method (linked TC)
```

## 4. Two linking mechanisms — do not mix them

| Field | Semantics | Effect on the REQ lifecycle |
|---|---|---|
| `blocks_req` | **Sends a REQ back on review**, pushing it backward/onto hold | This BUG enters that REQ's `pending_bugs` → the REQ is set to `blocked` |
| `linked_req` | An ordinary link meaning "this BUG is carried and fixed by this REQ" | Does **not** change REQ state; appears as a gate at T03b / T03c (a REQ with a carried BUG can only take T03), T11 (all carried BUGs resolved), T13 / T14 (all closed) — see the carrying process below |
| `origin_req` | The defect's origin REQ (already done, not reopened) | None; the fix is carried by the REQ designated by `linked_req`, a BUG never carries its own implementation |

**Precondition for done**: while any BUG whose `linked_req` points at a REQ is not `closed` (any `bug_type`, `resolved` is not enough), that REQ must not be set to
`done`. This applies only to `lifecycle_schema: 2` REQs; old REQs and the BUGs pointing at them follow the old rule (any unclosed — i.e. not `resolved` / `closed` —
`req_bug` blocks done), historical BUGs are not migrated and their status is not changed.

**Carrying process** (a BUG with a non-empty `linked_req`, of any `bug_type`): the BUG is implemented and verified within the carrying REQ's lifecycle, on the strength of the carrying REQ's three preflight checks;
§6 leaves it only the one step of the owner writing the plan in the BUG file and setting it to `resolved`.

- Carrying eligibility: when `linked_req` is designated, the carrying REQ must not yet have left `req_review`, or must be the REQ itself named in this BUG's `blocks_req` whose restore target is `req_review`
  (self-carried, including one whose restore target was rewritten by a §6 redirect). A carrying REQ always goes through T03: `tc_policy: exempt` has no T11 / T13 and must not carry; once `optional` carries a BUG it is bound to T03,
  and the evaluator must not T03c — with no tc_design, no one connects a TC to the carried AC. An exempt REQ also does not self-carry: a defect on it needing a body-text change or a ruling goes through
  T04 / T17 in req_review, not T15; one that still needs a separate BUG has its (upstream, cross-REQ) `linked_req` designate another eligible REQ, or leaves it empty pending human-001's designation,
  with T16 gated on it being closed. The TC requirement in §5 item 2 does not apply only to a BUG that is a **`req_bug` whose fix content is only that exempt REQ's body text or a human ruling**
  (the evidence is the ruling and PR review); every other `bug_type` follows §5 item 2 as usual: `severity` ≥ `high` must have existing TC coverage, otherwise `linked_req` designates an eligible
  carrying REQ to add the TC at its tc_design (synonymous with the testcase-standard §4 regression convention).
- T02: the planner adds one AC per carried BUG (a regression BUG writes "TC-… restored to passing"), and a ruling that needs a REQ body-text change is implemented here. The BUG's `owner` is the
  role implementing the fix: for an implementation defect it is the carrying REQ's generator, for a test-case defect (TC text) it is the evaluator, changing the text at tc_design.
- tc_design: when the BUG's `test_case_ref` is non-empty (a regression BUG) → the evaluator appends the AC to the listed original TC's `verifies`, without writing a new TC; the original TC's `verifies`
  therefore holds ACs from two REQs at once, its legacy-form text is not rewritten, and tc_review checks only that `verifies` resolves and has a matching assertion for the carried AC; when empty → a TC is written for the AC as usual
  (a manual TC for anything not automatable), and the BUG's `test_case_ref` is backfilled.
- T08 / T09: for an original TC whose text tc_design has changed (tc_bug or a carried AC), the test code at its "Implementation location" is updated along with the text by the carrying REQ's generator, and reviewed together at T09;
  the original TC's status does not go through T06 / T08, and is changed only in req_impl_review by the evaluator per the result matrix (T12 sets failing, T13 sets passing,
  a missing sample keeps the original status).
- resolved: set by the owner once the root cause or ruling and fix plan are clearly written, no later than before T11; T11 requires every carried BUG to be `resolved` beforehand.
- T13: the evaluator runs the TCs listed in `test_case_ref`; on pass, the BUG is set `closed`, that TC to `passing`, and a line is recorded in the BUG's "Verification method" section pointing to the evidence in the carrying REQ's RV;
  when the original REQ has an RV (`lifecycle_schema: 2`), passed is additionally recorded in its `## regression`; an old REQ with no RV gets none created for it. Any that does not pass is set failing, going through T12. When the listed TC is a
  sample-missing integration TC, T13 assumes the sample is available: the evaluator sets the sample environment variable and runs it for real; without a sample, T13 is not signed, and the missing sample alone is not grounds for T12 either — when the rest of the
  TCs have no failing, the REQ stays in req_impl_review awaiting the sample, the RV `## req_impl_review` conclusion line reads "AWAITING SAMPLE" (review-standard §4), the Evidence column records
  "AWAITING SAMPLE: TC-…", and the listed TC keeps its original status; if the rest of the TCs have a failing, T12 still applies per the result matrix. Any evaluator holding the sample may do the regression run first, and its line in the original REQ's RV `## regression`
  (or a notification, when there is no RV) can serve as the evidence the carrying REQ's evaluator uses to sign T12 / T13; when the same TC already has an unclosed regression BUG, a failing run does not file a new BUG.
  When human-001 designates the carrying REQ, it must confirm the sample will be obtainable.
- T14: T14 is blocked until every carried BUG is `closed` (precondition for done).

All of the above changes to the original TC, the BUG file, and the original REQ's RV are authorized by the carrying REQ's three preflight checks, with no separate exception; once the original REQ is done, its owner takes no part.

The operational contract for `blocks_req` (who files the BUG, how a REQ's `pending_bugs` / `blocked_reason` / `blocked_from_*` are filled in, the commit format,
how human-001 clears it) is in [briefs.md](briefs.md) "Blocking and clearing".

## 5. Preconditions for closing

1. The root cause is clearly written (not "it's fixed because I changed something");
2. When `severity` ≥ `high`, there must be a TC covering it with `test_case_ref` backfilled: a regression BUG uses the original TC, never a new one; one without TC coverage cannot close on the strength of §6,
   and must have a `linked_req`, with the TC added at the carrying REQ's tc_design (§4);
3. `resolved` is set by the BUG's `owner`. `closed` is set by an evaluator-*, with authorization routed by whether `linked_req` is present: absent → an evaluator other than the owner, on the strength of the §6
   verification handoff, with evidence written into the "Verification method" section; present → the carrying REQ's T13 evaluator, on the strength of §4, not restricted to a non-owner (independence is guaranteed by the carrying REQ's RV evidence), with evidence in the carrying REQ RV's Evidence column (plus a `## regression`
   line when the original REQ has an RV), and one line in the "Verification method" section pointing to it;
4. Closing is not gated on the REQ's Bug History: for a BUG arising from a review send-back (`blocks_req` non-empty), the record of clearing is appended by human-001 at T16,
   timed at T16 (all `pending_bugs` closed, self-carried ones resolved).

## 6. BUG-level handoff (fix and verification)

While a REQ is `blocked`, no one holds it, so neither the fixer nor the verifier can start work on the strength of the REQ's three preflight checks — they go by the BUG instead. Two sets of checks, three items each.
A BUG with no `linked_req` uses both sets; two exceptions only write the root cause and neither fix nor close, waiting for human-001 to designate `linked_req` and then following §4: one with a non-empty `origin_req` (a BUG never
carries its own implementation); one whose fix needs a change to another REQ's body text (when the target REQ has already left req_review and is not done, human-001 pulls that REQ back with T19 first, then designates it). One that human-001
redirects in the exempt form no longer waits on `linked_req` — it is set resolved / closed per the redirect sentence; one with a `linked_req` (including self-carried) uses only the fix handoff's step of "the owner writes the root cause or ruling and fix plan clearly in the BUG file and
sets it to `resolved`" — it changes no code, and implementation, verification, and `closed` follow the §4 carrying process.

Fix handoff:

| # | Condition | How to check |
|---|---|---|
| B1 | BUG file exists | `ls lifecycle/tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md` |
| B2 | `owner` == your UID | `grep '^owner:' …BUG-….md` |
| B3 | `status` ∈ {open, in_progress} | `grep '^status:' …BUG-….md` |

The authorized scope is only the changes stated in the BUG's "Fix plan" section: code, tests, fixtures, design documents; it **does not change** the REQ's body or frontmatter: a BUG whose fix plan needs to change this
REQ's body or TC text, or one with `severity` ≥ `high` and no TC coverage, is not fixed on this path — it becomes self-carried instead (§4; except an exempt REQ, see §4
carrying eligibility). One discovered to be of this kind while already `blocked`: the fixer only writes the root cause clearly and notifies human-001; human-001, as the owner of blocked, **redirects** before T16, in one of two forms:
non-exempt → self-carried, the BUG's `linked_req` is set to this REQ, `owner` changed to the implementing role, the REQ's `blocked_from_*` changed to
`req_review` / planner; exempt → `linked_req` is not set, human-001 writes the ruling into the BUG's "Fix plan" section, the owner sets it to resolved, and an
evaluator other than the owner sets it to closed on the strength of §6 with the ruling as evidence, `blocked_from_*` likewise changed to `req_review` / planner, and the body-text change is implemented by the restored T02. Both record one line in
Bug History; a redirect is not a transition and does not count toward the round. Commit subject `fix: BUG-<PREFIX>-NNN — one sentence`. Once fixed, write the root cause clearly, backfill `test_case_ref`, `status` → resolved.

Verification handoff:

| # | Condition | How to check |
|---|---|---|
| V1 | BUG file exists | Same as B1 |
| V2 | You are an evaluator-*, and `owner` != your UID | `grep '^owner:' …BUG-….md` |
| V3 | `status` == resolved | `grep '^status:' …BUG-….md` |

The authorized scope is only the BUG file itself: execute per the "Verification method" section (run the TCs in `test_case_ref`, or the reproduction steps), and write the result into that section; on pass, `status` →
closed; on fail, `status` → in_progress with the gap stated, `owner` unchanged, and the fixer picks it back up on the strength of the fix handoff. Commit subject
`verify: BUG-<PREFIX>-NNN — closed` or `— reopened`. The verifier does not change code and does not change the REQ.

Once all `pending_bugs` are closed (self-carried ones resolved), human-001 performs T16, and the Bug History clearing record is appended at that step. Operational steps are in [briefs.md](briefs.md) "Blocking and clearing".
