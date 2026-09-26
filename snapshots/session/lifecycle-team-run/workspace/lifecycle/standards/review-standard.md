# Review Standard (RV review record specification)

Review evidence has exactly one destination: one review record per REQ. Commit bodies, REQ text, and PR comments no longer carry review prose.

## 1. Location and naming

- Path: `lifecycle/tasks/reviews/<scope>/RV-<PREFIX>-NNN.md`, sharing the REQ's number
- Created by the evaluator on the first round in `req_review`; the RV does not move when the REQ is archived

## 2. Frontmatter

```yaml
---
rv_id: RV-CBOM-021        # must match the filename
tool: canonical-bom       # must match the containing directory
linked_req: REQ-CBOM-021
---
```

There is no owner field: whoever holds the corresponding review state writes the corresponding section.

## 3. Body

One level-2 heading per review gate; only these six are allowed: `## req_review`, `## tc_review` (written by generator), `## tc_impl_review`,
`## req_impl_review`, `## external_review` (optional, an out-of-repo review transcribed by human-001 or an evaluator), `## regression` (optional, the record of deferred-verification regression runs,
see [testcase-standard.md](testcase-standard.md) §4). The first five each have fixed fields, in a fixed order:

```
Conclusion: PASS | REJECT (round N, YYYY-MM-DD, <uid>); `## req_impl_review` has one additional unsigned-off form, AWAITING SAMPLE (YYYY-MM-DD, <uid>), see §4 state binding
Fixed items: (req_review section only)
- [ ] CHK01 No implementation detail: no HOW-lexicon hits in the body, intent, or acceptance
- [ ] CHK02 Every AC is one sentence, present tense, an observable artifact
- [ ] CHK03 Behavior and Acceptance criteria do not double-write the same rule
- [ ] CHK04 Every business term is a GLOSSARY canonical word
- [ ] CHK05 Non-goals is non-empty and consistent with depends_on and neighboring REQ boundaries
- [ ] CHK06 Pending decisions == None
- [ ] CHK07 No restating of the contract; the design documents this REQ touches contain no "rule is in REQ"
- [ ] CHK08 CLAUDE.md §2's five disciplines checked one by one
Review scope: commits and files checked
Evidence: ≤ 5 items of data (tests passed/skipped, gates, real samples, worktree comparison; the req_impl_review section additionally holds the per-item verification results for manual TCs and TC-waived ACs, plus a "Deferred verification: TC-…" list)
Findings:
| # | Location | Finding | severity | confidence | Disposition |
|---|---|---|---|---|---|
Pending human-001: None | Matters
```

## 4. Rules

- **Report everything**: every finding carries a severity (blocker / major / minor / nit) and a confidence (high / medium / low), unfiltered by level —
  the call on what to keep belongs to human-001.
- **Rewritten in place**: a section always shows only the latest round; fixed findings are deleted, and the conclusion line records the round. History lives in git. `## regression` is likewise updated in place: each TC
  keeps only the line for its most recent run.
- **Signing role**: the conclusion of each RV gate section can only be signed by a UID of the role in the table below, checked by the gates ([GUIDE §6](GUIDE.md#6-gates)). This table mirrors [lifecycle.yml](lifecycle.yml)'s
  `gates`, compared row by row as a closed set per RV section.

  | RV section | Signing role |
  |---|---|
  | `## req_review` | evaluator |
  | `## tc_review` | generator |
  | `## tc_impl_review` | evaluator |
  | `## req_impl_review` | evaluator |

- **State binding**: a gate's section can only be written while the REQ is in that gate's corresponding state and the writer is that state's owner (the three preflight checks hold). Once the conclusion is signed off, the section
  freezes until the REQ enters that state again. A problem found within `pr_draft` after sign-off is decided by human-001: accept it and note it in the PR, or pull back for re-review with T19;
  the RV is not changed within `pr_draft`, and a reviewer does not re-sign outside their own state. The one unsigned-off form is the sample wait in the carrying process (bug-standard §4):
  while the REQ sits in `req_impl_review`, the `## req_impl_review` conclusion line reads "AWAITING SAMPLE (date, UID)" — this is not a sign-off, does not freeze the section, and does not satisfy "PASS
  before advancing"; once the sample arrives, the same state's owner changes it in place to PASS or REJECT. The sole exception is `## regression`: any evaluator-* may update it at any time,
  recording only two kinds of results — a deferred-verification regression run, and a passed recorded by the carrying REQ's evaluator once the carrying process's T13 verification passes (bug-standard §4;
  when the original REQ has no RV, none is created for it — the evidence lands in the carrying REQ's RV) — without changing other sections. The timing of a gate section's changes (whether it was changed by the transition commit of the corresponding state, and whether the conclusion matches the declared transition)
  is checked by transition evidence along the PR's commit chain ([GUIDE §6](GUIDE.md#6-gates)).
- **The external_review section**: optional, not bound to a state, changed only by a `lifecycle: external review —` event commit; when present, every row of the findings table has a non-empty Disposition, and the conclusion line is signed by human-001 or an
  evaluator role. Under a cross-vendor provider set, the implementation review itself is already carried by an evaluator from a different vendor, so no separate mandatory external-review step is imposed (ADR-011).
- **Rounds**: a REQ's `review_round` = the number of times the evaluator signs off a conclusion (PASS or REJECT) in `req_review`: T03 / T03b / T03c / T04,
  and a REJECT via T15 in place of T04 from `req_review`, each add one; the round in the RV conclusion line matches it. A conclusion written outside a review state does not count toward the round,
  and must not remain in the file.
- **PASS before advancing**: for status to enter a state in the left column below, the corresponding RV section must already be PASS.

  | State entered | `required` / `optional` with TC | `optional` TC waived (T03c) | `exempt` (T03b) |
  |---|---|---|---|
  | `tc_design` | `## req_review` | not applicable | not applicable |
  | `tc_impl` | `## tc_review` | not applicable | not applicable |
  | `req_impl` | `## tc_impl_review` | `## req_review`, including the TC waiver reason | not applicable |
  | `pr_draft`, `done` | `## req_impl_review` | `## req_review` + `## req_impl_review` | `## req_review` |

  This table mirrors [lifecycle.yml](lifecycle.yml)'s `pass_to_enter`, checked item-for-item by the gates; not applicable = the empty set.

  For a TC-waived REQ, the verification evidence for every AC is written into the `## req_impl_review` Evidence column (manual verification, gate output, real samples),
  standing in for actual TC-run figures.
- **Budget**: each section ≤ 2,500 characters, whole document ≤ 12,000; `## regression` is separately ≤ 2,500 characters, one line per TC, and does not count toward the whole-document budget. Method narration is not kept —
  only the conclusion, scope, figures, and findings remain.
- **Transition commit**: subject `lifecycle: T<NN> — one sentence`, body ≤ 10 lines, recording only `status: a → b; owner: x → y; review record: RV-…#<gate>`;
  the RV section's changes and the status / owner changes are in the same transition commit.
- The PR review package (`.github/pull_request_template.md`) links to the corresponding RV section, without pasting its content.
