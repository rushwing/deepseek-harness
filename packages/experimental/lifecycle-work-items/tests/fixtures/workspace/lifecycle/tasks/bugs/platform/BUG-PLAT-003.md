---
bug_id: BUG-PLAT-003
tool: platform
title: "req_lint group J is exempted as a whole when the tree has zero spec files; degenerate boundary of AC-17 'a missing file is always named'"
status: closed
severity: low
bug_type: req_bug
owner: planner-001
linked_req: REQ-PLAT-009
origin_req: ""
blocks_req: []
found_in: req_impl_review
test_case_ref: [TC-PLAT-009-16]
---

## Symptom

`scripts/gates/req_lint.py::run_all` runs `check_lifecycle_mirror` over the six files only when **at least one** `MIRRORED_SPECS` registered spec file exists in the tree;
on a synthetic tree where all six are absent, group J does not run at all and `run_all` returns `[]`. This is in tension with the literal AC-PLAT-008-17
"a missing file is named as a missing mirror": a tree missing all six specs should report six not-found violations, but reports zero.
Codex round 2 scoped re-review r2-2 (matching the PARTIALLY verdict on round 1 #1) and line 2 of the "PR pending decisions" the generator listed
in its own req_impl r2 report are the same code location and the same finding.

## Reproduction steps

1. `build_tree(tmp)` builds a minimal synthetic tree with only `lifecycle.yml` / `agent-registry.yml` / `id-scheme.yml` (landing no
   `MIRRORED_SPECS` file);
2. Confirm `present = [rel for rel in MIRRORED_SPECS if (root/rel).is_file()]` is `[]`;
3. Call `req_lint.run_all(root)`; it returns `[]` (should be six not-found violations).

evaluator-001 re-ran the three steps personally in req_impl_review round 2; the result matches Codex r2-2.

## Expected vs actual

- Expected (literal AC-17): every registered mirror table is found and non-empty, and a missing file is always named as a missing mirror; six missing files should yield six violations.
- Actual: the guard `if lifecycle is not None and any((root/relative).is_file() for relative in MIRRORED_SPECS):` in `run_all`
  keeps the whole of group J from running when "not a single one exists", returning an empty list, zero violations.

## Root cause (filled in after diagnosis)

The guard was added so that REQ-PLAT-007's minimal synthetic trees (carrying no harness spec files) would not break
AC-PLAT-007-27 "a clean tree has zero violations" by having group J report nine extra items; the literal texts of the two ACs are mutually exclusive in this one degenerate scenario (a synthetic tree with zero spec files),
and the implementation chose to protect AC-PLAT-007-27 and let AC-PLAT-008-17 not apply in that scenario.

The real repository tree does not fall into this degenerate scenario: evaluator-001 verified on the real tree — deleting any one spec file (e.g.
`review-standard.md`) still reports that file missing (`cannot find the "§4 signer role table"` and so on); only "all six absent at once" triggers the exemption,
and the real repository always carries the full set of six specs, so it never slides into this scenario.

## Fix plan

Two options, for human-001 to rule on:

1. Accept the boundary and add one sentence to REQ-PLAT-008 and `harness/README.md` §6: "group J checks the closed set of six only when the tree carries at least one registered spec;
   a minimal synthetic tree with none is out of scope", explicitly carving the degenerate scenario out of AC-17's applicability;
2. Change `tests/gates/harness_gate_api.py::build_tree` so the synthetic tree carries (compliant) copies of the six registered specs by default, so that
   the REQ-PLAT-007 batch of minimal synthetic-tree cases no longer triggers the exemption path, the `any(...)` guard in `run_all` can be deleted entirely,
   and group J checks "the closed set of six" unconditionally.

evaluator-001 and generator-001 both lean to option 2 (eliminates the degenerate scenario once, simpler code, no patch on AC-17's wording), but
the `build_tree` change touches every existing TC and gate test that depends on it (including REQ-PLAT-007's 24 TCs), which exceeds this REQ's
minimal T12 scope of "touching no files beyond implementation code", so it is not handled this round; human-001 rules which option to take and assigns `linked_req`
(expected REQ-PLAT-009 or a new small REQ).

human-001 ruling 2026-09-12 (PR #24): take option 2, carried by REQ-PLAT-009; 009 T01 fills `linked_req`.

Fix 2026-09-13 (REQ-PLAT-009 T11, per option 2):

- `tests/gates/harness_gate_api.py` gains `SPEC_MIRRORS` and `write_spec_mirrors()`; `build_tree` copies the six registered specs
  into the synthetic tree by default; the copies are the real files with only the in-repository relative links downgraded to plain text — the copies would otherwise drag the real repository's link graph into the synthetic tree,
  which has no `scripts/` or `docs/`. The downgrade touches only link syntax; mirror tables are compared by visible text, cell by cell unchanged.
- `scripts/gates/req_lint.py::run_all` drops the `any(... is_file())` existence guard; group J traverses the closed set of six unconditionally.
- `scripts/gates/harness_rules.py::check_lifecycle_mirror` reports a file that is absent as a whole with a single line naming the file itself:
  the root cause is that the spec is gone, not that each mirror it registers has been hidden; a tree missing all six therefore yields exactly six lines (AC-PLAT-009-24).
- Precondition: the concrete UIDs registered in the mirrors of the six specs have been changed to `<role>-<NNN>` role placeholders (same batch as Q-05), so the copies no longer depend on registry normalisation.

## Verification method (linked TC)

The carrier REQ named by `linked_req` adds one TC in its tc_design: run `run_all` on a synthetic tree "with all six specs absent" and
assert six not-found violations rather than `[]`; or (option 2) verify that after `build_tree` lands the six compliant spec copies by default,
all existing REQ-PLAT-007 TCs and gate tests stay green. severity `low`, does not block this round's REQ-PLAT-008 closure.

Verification record: 2026-09-13 evaluator-002, TC-PLAT-009-16 real run, 4 items passed; see [RV-PLAT-009 req_impl_review evidence](../../reviews/platform/RV-PLAT-009.md#req_impl_review).
