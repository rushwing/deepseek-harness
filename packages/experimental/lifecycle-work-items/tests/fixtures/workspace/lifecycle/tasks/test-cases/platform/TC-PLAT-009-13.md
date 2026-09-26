---
tc_id: TC-PLAT-009-13
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-20, AC-PLAT-009-28]
title: "Cross-vendor specifications, ADR status and the lifecycle two-phase criteria"
status: passing
level: e2e
owner: evaluator-002
automated: false
---

## Preconditions

Read directly `harness/agent-standard.md` §3, `harness/README.md` §1/§6, the provider set entry in `GLOSSARY.md`, the header comment of `harness/lifecycle.yml`, `docs/adr/ADR-010-lifecycle-as-data.md` and `ADR-011-cross-vendor-evaluator.md`. For the two-phase criteria, additionally refer to the independent variant names and violation counts of the load phase and the self-consistency phase in `test_lifecycle_table.py`; do not treat the same wording compared against itself as proof.

## Steps

1. Check each place for the wording on cross-vendor default, same-vendor fallback and the old rationale no longer holding, confirming no residual copy still claims the active set must be same-vendor.
2. Check the four parts of ADR-011 (context/decision/rejected alternatives/consequences) and the status of ADR-010/011.
3. Compare the two-phase definitions in README §6 and the table header comment, mapping one by one: an extra item, reordering, duplicates, a missing item, emptied.
4. Check the test evidence: the first three kinds each produce one line in the load phase, the last two each one line in the self-consistency phase; the same variant must not produce cascading lines.

## Expected results

- AC-PLAT-009-20: All three specifications express cross-vendor default / same-vendor fallback and the change of rationale; the four parts of ADR-011 are complete, ADR-010/011 are both accepted, and there is no contrary residual wording.
- AC-PLAT-009-28: README and the table header comment agree on the phase assignment of the five variants; in the corresponding tests each variant yields exactly one root-cause violation, with neither an empty list nor multiple cascading lines passed off as the result.

## Implementation location

Manual: results are recorded in the RV `## req_impl_review` Evidence field
