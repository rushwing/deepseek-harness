---
req_id: REQ-PLAT-009
tool: platform
title: "harness transition evidence and cross-vendor review baseline: commit-chain verification, non-transition events and a mixed provider set"
intent: "Make every PR's process machine-provable: transitions happen by the declared role per the lifecycle table, and implementation review is done by a seat from a different vendor"
status: done
owner: human-001
priority: P1
phase: M5
scope: harness
tc_policy: required
exempt_reason: ""
depends_on: [REQ-PLAT-008]
test_case_ref: [TC-PLAT-009-01, TC-PLAT-009-02, TC-PLAT-009-03, TC-PLAT-009-04, TC-PLAT-009-05, TC-PLAT-009-06, TC-PLAT-009-07, TC-PLAT-009-08, TC-PLAT-009-09, TC-PLAT-009-10, TC-PLAT-009-11, TC-PLAT-009-12, TC-PLAT-009-13, TC-PLAT-009-14, TC-PLAT-009-15, TC-PLAT-009-16, TC-PLAT-009-17, TC-PLAT-009-18, TC-PLAT-009-19, TC-PLAT-009-20, TC-PLAT-009-21]
acceptance: "On a PR the governance gate checks the first-parent commit chain commit by commit: a transition commit's declaration matches its delta relative to the first parent and non-transition commits do not change lifecycle-sensitive objects, and replaying the PR #22 chain names the known violations; the registry takes effect with a cross-vendor set and the gate accepts it; the four carried BUGs are closed; the TCs and gate tests of REQ-PLAT-007 and 008 keep passing and the four gates are green on the current tree"
review_round: 8
pending_bugs: []
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
pr_number: 26
lifecycle_schema: 2
---

## Goal

REQ-PLAT-008 turned the static lifecycle into one table: the gate can decide whether a snapshot is legal, but not "who made this state change, on what authority, and completely":
an RV signed outside its state, a pre-filled PASS, one transition split across several commits, an owner that does not match the declared role — none of these show in a snapshot. At the same time the PLAT-007 and PLAT-008
cycles showed that three rounds of internal same-family review did not catch implementation-level bypasses; the out-of-repository Codex review filled the gap, and that arrangement so far existed only in the briefs.

This requirement turns two things into rules and gates: first, every transition registers a subject shape, guards, effects and permitted changes, and on a PR, CI walks the first-parent commit chain commit by commit checking
"the declared transition = that commit's delta relative to its first parent", while non-transition commits may change lifecycle-sensitive objects only through registered events; second, the registry takes effect with a cross-vendor provider set,
implementation review is done by an evaluator from a different vendor than the implementer, and the adversarial review framework and the Codex invocation contract are written into the briefs. It also carries the
four BUGs downgraded when REQ-PLAT-008 closed.

## Behavior

### Terms and truth source

- The machine truth is the transition and event registration of the new lifecycle-table version plus the gate implementation; the related text in requirement-standard §4, review-standard §4, briefs and README §6 is a mirror and
  operating instructions and does not redefine the rules.
- Lifecycle-sensitive objects: a REQ's status, owner, review_round, pr_number, pending_bugs, blocked_reason, blocked_from_status, blocked_from_owner; a TC's
  status; a BUG's status; the conclusion lines of the four RV gate sections. Nothing else is constrained by transition evidence.
- Transition commit: a commit whose subject matches a registered transition's subject shape (starting with `harness: T<id> —— `; T15 has the same shape). Event commit: a non-transition commit whose subject matches a shape registered
  in the events section (bug_fix, bug_verify, regression, external_review, bug_redirect). Everything else is an ordinary commit.
- Chain: the first-parent commit sequence from base (merge base) to head. Transition segment: the commits after the previous transition commit up to and including this one, used only as a grouping and reporting unit; the unit of evidence is the commit —
  guards are evaluated on the commit's first-parent tree, effects and delta constraints on the commit's delta relative to its first parent, and a segment's sensitive delta is composed of the transition commit's delta plus the deltas of event commits in the segment.
- Judging table: a commit is judged by the table in its first-parent tree; a commit whose first-parent tree has no key but whose own tree has one is the activation commit and is judged by its own tree's table; a commit whose first-parent and own trees both lack the key, with no keyed tree earlier on the chain,
  is vacuum. Merge commits: one whose second parent is an ancestor of base is a base sync; other merge commits are treated as ordinary commits.
- The predicate vocabulary is closed: pure-data predicates are referenced by the table and evaluated by the gate; predicates only expressible in code are referenced by registered name.

### Context

- This requirement's own PR is the first chain to be checked: the base tree's table is version 1 and activation falls on the implementation commit.
- Cross-vendor seat: provider sets split into same-vendor and cross-vendor kinds; evaluator-002 is the Codex CLI and takes req_review, tc_design and req_impl_review, while tc_impl_review
  is handed to evaluator-001 by the briefs; transition evidence checks roles only. The implementation review is itself the cross-vendor review; the RV External review section stays optional; the adversarial review framework and the Codex invocation contract
  live in the briefs.
- Carrying: BUG-PLAT-003, 005 and 006 are implementation fixes, BUG-PLAT-004 is a tc_design text correction; the REQ-PLAT-008 AC-16 two-phase criteria are written as mirrors in README §6 and the table-header comment,
  and the archived 008 body is not changed. ADR-010 and ADR-011 (created at this requirement's T02) are set to accepted at closure.

### Assumptions and defaults

- New code depends only on the standard library, PyYAML and the git command line; no Python dependency, CI job or command entry point is added.
- The rulings on Q-01 to Q-15 are recorded in ADR-010 Review Notes 10 and the ADR-011 Review Notes and are not repeated here.

## Non-goals

- No checking of post-merge main history, no retroactive check of PR #22 and PR #24 (they are only inputs to local-replay manual TCs); no merge queue; no recovery of chains destroyed by squash / rebase merges.
- No checking of commit author identity or signatures, nor of GitHub-side state (whether the PR is draft, approvals); Co-Authored-By is notice only.
- No change to the semantics, numbering, endpoints or handover roles of the 21 transitions, no new states; no path-level allow list; no checking of changes to body text, code or spec wording.
- No Markdown or briefs generated from the table; Codex is not wired into CI as a reviewer, evaluator-002 is invoked locally by the orchestrating session.
- No changes to product code or vave3.

## Acceptance criteria

- **AC-PLAT-009-01** The lifecycle table version is raised, the version 1 states, roles and the five columns of the 21 transitions are unchanged; every transition has the four items subject shape, guards, effects and permitted changes, and the T16 and T19
  postcondition text becomes effects; a top-level events section registers the five kinds bug_fix, bug_verify, regression, external_review and bug_redirect, and an event whose effects or permitted changes include REQ status or owner is a self-consistency violation.
- **AC-PLAT-009-02** Predicate names, artifact kinds, RV section names and TC / BUG states referenced by the table must be registered; an unregistered key and an unregistered reference each name the transition or event id and the field; every transition's subject
  shape contains exactly one id equal to its own, and event subject shapes contain no transition id; multiple ids, no id and a mismatched id are each violations.
- **AC-PLAT-009-03** Given any commit hash, the artifact graph built from that commit and the graph built after checking the same commit out into the working tree are equal field by field; the graph parsing layer does not call git directly,
  git access lives in a single source module, and rule groups other than transition evidence do not read git.
- **AC-PLAT-009-04** Given git unavailable, an unresolvable range, or base and head with no common ancestor, when the transition-evidence rules run, then exactly one violation containing the range is output, the other rule groups still run,
  and there is no traceback.
- **AC-PLAT-009-05** The chain is the first-parent sequence from base to head and evidence is checked per commit: transition commits are recognised by subject shape, guards against their first-parent tree, effects against their delta relative to the first parent; for a merge commit whose second parent is
  an ancestor of base, the delta of sensitive objects must equal the second parent's values, and other merge commits are checked as ordinary commits; a PR with zero transitions and zero sensitive delta passes.
- **AC-PLAT-009-06** A commit is judged by the table of its first-parent tree; the activation commit judges its delta by its own tree's table; a commit whose first-parent and own trees both lack the key, with no keyed tree earlier on the chain, is judged vacuum and outputs one notice line each;
  once a key has appeared, a commit whose first-parent tree lacks the table or key is a violation and is named; local replay may specify the chain-end table to check the whole chain, CI does not use it.
- **AC-PLAT-009-07** A transition commit changes exactly one REQ's status or owner relative to its first parent; a T01 whose first-parent tree lacks the REQ is treated as draft and human; two REQs changing at once, zero change,
  or a changed REQ that differs from the declaration are each violations that name the commit short hash and the transition id.
- **AC-PLAT-009-08** In a transition commit, the first-parent tree's status equals the start state (a set for multi-start transitions, T16 per blocked_from_status), the first-parent owner's role equals the executing role (T19 exempt,
  T15 the current owner), and the owner role after the commit equals the handover role (T16 per blocked_from_owner); any mismatch names the field.
- **AC-PLAT-009-09** review_round increases by one only in the transition commits of T03, T03b, T03c, T04 and a T15 executed from req_review; any other commit changing it is a violation.
- **AC-PLAT-009-10** An RV gate section is changed only by the transition commit of that gate's state; the conclusion line's PASS / REJECT matches the declared transition, and the round equals the first-parent tree's round for that section plus one (1 on first sign-off),
  the req_review section's round additionally equals review_round after the commit; a commit in a non-matching state changing a gate section, a pre-filled PASS, and a mismatched verdict or round each name the RV and the section.
- **AC-PLAT-009-11** A T13 commit may change the Regression section of a carried BUG's origin REQ RV; T19 and a T16 restoring to req_review must withdraw the lines of the origin REQ RV Regression section that cite this REQ's TCs,
  and not withdrawing is a violation; other commits may not change another REQ's RV.
- **AC-PLAT-009-12** TC and BUG status deltas fall within the declared transition's effects: T06 sets reviewed excluding carried origin TCs, T12 sets failing, T13 sets passing or
  failing and closes carried BUGs, T19 and a T16 restoring to req_review return to draft and closed returns to resolved; out-of-bounds changes each name the TC or BUG.
- **AC-PLAT-009-13** pr_number equal to the event PR number is checked only in T11 and exempt T02 transition commits, other commits are not checked; a T11 re-entering req_impl that reuses the original number passes.
- **AC-PLAT-009-14** A non-transition commit that changes REQ lifecycle fields, TC status, an existing BUG's status or an RV gate conclusion line relative to its first parent is a violation unless its subject matches an event and the delta fits that event's
  effects; creating a new BUG file as open is allowed in any commit; an event commit changing objects outside its declaration is a violation.
- **AC-PLAT-009-15** When a transition commit's Co-Authored-By model differs from the executing role's model in the registry active set, one notice line is output without blocking; a missing trailer is likewise notice only.
- **AC-PLAT-009-16** The governance gate job gains a fifth step that runs only on PR events, takes the PR number, base and head from the event file, and re-runs the whole chain on every sync; push and manual triggers skip the step;
  full history is checked out; the existing four steps are unchanged and still run when the fifth fails; no new command entry point is added.
- **AC-PLAT-009-17** Every transition has a positive case generated from the table, and every guard and every effect has one independent negative case; a wrong declared id, mismatched start, mismatched role, out-of-range restore pair, T19 from done or
  blocked, review_round changed by a non-enumerated transition, sensitive objects changed by a non-transition commit, before/after activation, and both merge kinds each have at least one case; a temporary git repository has one legal chain and one split-commit chain; all run for real, no skip and no xfail.
- **AC-PLAT-009-18** Replaying the PR #22 first-parent chain with the chain-end table names the split commit 2bb6571, the implementation commit 1ebf3c4 flipping BUG status, and the tc_review round
  skips of ff7ecdb and 2d9c95e; it does not name the first-round T07 / T09 / T13 (each signing its gate section for the first time in the matching state); the run does not crash; the complete list of named commits is recorded by a manual TC.
- **AC-PLAT-009-19** The registry's provider sets split into same-vendor and cross-vendor kinds, and the active set is the cross-vendor set (planner-001, generator-001, evaluator-002);
  the gate accepts the registered cross-vendor set and rejects a generator and evaluator from the same vendor, mixed vendors inside a same-vendor set, a missing kind, an unknown kind and empty members, each naming the set and the role.
- **AC-PLAT-009-20** agent-standard §3, harness README §1 and the GLOSSARY provider set entry change to cross-vendor default with same-vendor fallback and state that the original reason no longer
  holds; ADR-011 exists and records context, decision, rejected alternatives and consequences; ADR-010 and ADR-011 are set to accepted.
- **AC-PLAT-009-21** The three evaluator sections of the briefs (req_review, tc_design, req_impl_review) contain the adversarial review framework: bypass assumption, minimal-input real-run proof,
  the eight-category list, and per-item reproduction of external findings; the banned-phrase gate has zero hits on the added text.
- **AC-PLAT-009-22** The briefs contain the Codex invocation contract: non-interactive execution, workspace-write sandbox, scope written into the prompt, full output kept in the scratchpad, the RV transcribing only conclusion and findings table,
  a clean working tree after the run, re-review in a new scoped session, the commit trailer form, T08 handed to evaluator-001; brief report filenames do not contain report.
- **AC-PLAT-009-23** When an RV External review section exists, every non-empty findings-table row must parse to all six columns with a non-empty Disposition, and the conclusion line is signed by human-001 or an evaluator role;
  a malformed row, a missing column, a missing disposition or a mismatched signer role each name the row.
- **AC-PLAT-009-24** BUG-PLAT-003: the synthetic artifact tree lands compliant copies of the six registered specs by default, and the mirror-check entry point traverses the closed set of six unconditionally; a tree missing all six reports six not-found violations;
  the existing TCs and gate tests of REQ-PLAT-007 and 008 keep passing.
- **AC-PLAT-009-25** BUG-PLAT-004: the preconditions, steps and expected results of TC-PLAT-008-12 all three describe the REQ state table missing draft as the discriminating axis and the BUG state table missing open as the control;
  the tests at its implementation location assert a violation for the missing-draft variant and no change for the missing-open variant, with the axis names identical on both sides.
- **AC-PLAT-009-26** BUG-PLAT-005: when the lifecycle table is invalid, the tc_policy exit rule skips only the state-set and main-chain-position judgements; the three checks exempt carrying a BUG, own TCs still
  pointing at it, and non-empty test_case_ref are still reported, with output identical to a valid table.
- **AC-PLAT-009-27** BUG-PLAT-006: mirror heading comparison strips the leading and the CommonMark-legal trailing closing `#` sequence before exact matching; a registered heading with a closing `#` is judged found,
  and a genuinely renamed heading is still reported missing.
- **AC-PLAT-009-28** The harness README §6 lifecycle-table row and the table-header comment state the two-phase criteria of version fixation: the load phase reports an extra item, reordering and duplicates, the self-consistency phase reports a missing item and an emptied list;
  the self-consistency group reports exactly one violation per root cause.
- **AC-PLAT-009-29** Given the repository tree completing this requirement, when the four gates, the gate tests and the chain check of this requirement's own PR run, then all pass with no skip and no xfail in the tests, and the existing check function names
  and required parameter names are unchanged; tearing one effect out of any transition commit after activation and replaying it in a temporary repository makes the fifth step fail and name that commit and effect.
- **AC-PLAT-009-30** For any checked commit on the chain, if any artifact, the registry or the lifecycle table in its first-parent or own tree fails to parse, that commit is a violation naming the file and the commit, and guards and effects are not
  judged with default values; the other commits are still checked, no traceback.
- **AC-PLAT-009-31** One violation per line: a transition commit's line contains the short hash, the declared id, the REQ id and the field or section name, with the resembling id appended when it resembles another transition; an event commit's line contains the short hash, the event name and
  the id of the changed object (REQ, TC, BUG or RV); an ordinary commit's contains the short hash and the changed object; a parse failure contains the short hash and the file; a range or git-layer failure contains the range.
- **AC-PLAT-009-32** A T15 commit sets blocked, non-empty pending_bugs and blocked_reason, and the restore target is the end state and handover role of the reject transition matching the source state (pr_draft takes
  req_impl and generator, self-carried takes req_review and planner); a mismatch names the field, and each of the five sources has a positive and a negative case.
- **AC-PLAT-009-33** A T16 commit clears pending_bugs and the three blocking fields and restores status and owner per the restore target; the BUGs listed in its first-parent tree's pending_bugs are all closed (self-carried may be
  resolved); a bug_redirect event may change the restore target to req_review and planner only when the first-parent tree has that REQ blocked with a human owner; any other commit changing the four fields is a violation.

## Pending decisions

None

## Design references

- [PL-PLAT-009](../../plans/platform/PL-PLAT-009.md): contract changes, module placement, the new table version's key set and per-transition guards / effects, test support
- [ADR-010](../../../../docs/adr/ADR-010-lifecycle-as-data.md) decisions 5 / 6 and Notes 8–10; [ADR-011](../../../../docs/adr/ADR-011-cross-vendor-evaluator.md): cross-vendor review seat
- [REQ-PLAT-008](../../archive/done/REQ-PLAT-008.md): baseline of the static table, self-consistency and mirrors; [lifecycle.yml](../../../lifecycle.yml), [agent-registry.yml](../../../agent-registry.yml): machine truth
- [harness/README §6](../../../README.md#6-gates): contract table of rule groups and applicable boundaries
- [requirement-standard](../../../standards/requirement-standard.md) §4, [review-standard](../../../standards/review-standard.md) §4, [briefs](../../../standards/briefs.md), [agent-standard](../../../standards/agent-standard.md) §3: mirrors
- [BUG-PLAT-003](../../bugs/platform/BUG-PLAT-003.md), [BUG-PLAT-004](../../bugs/platform/BUG-PLAT-004.md), [BUG-PLAT-005](../../bugs/platform/BUG-PLAT-005.md), [BUG-PLAT-006](../../bugs/platform/BUG-PLAT-006.md): carried defects
- [GLOSSARY §4](../../../../GLOSSARY.md): transition evidence, transition segment, non-transition event, lifecycle-sensitive object, provider set

## Bug History

- 2026-09-12 T19: human-001 pulled back for rewrite (tc_review round 1 found the AC-10 round criterion in conflict with the project-wide per-gate counting practice, and the AC-18 naming basis needed verification); tc_design → req_review, TCs stay draft, no carried BUG to return to resolved.
