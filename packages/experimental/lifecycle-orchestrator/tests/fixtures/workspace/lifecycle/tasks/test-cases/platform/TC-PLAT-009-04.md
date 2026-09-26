---
tc_id: TC-PLAT-009-04
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-05, AC-PLAT-009-06]
title: "First-parent per-commit judgement, the three activation states and the two merge kinds"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Use the `harness_gate_api` constructors and lifecycle recipes to build each commit's first-parent tree and own tree explicitly, without reading real git: a legal transition's guards hold only on the first parent and its effects hold only on the own-tree delta; swapping the two trees yields an independent negative case. Additionally build a base-sync merge (second parent is an ancestor of base), a non-sync merge, and a chain with zero transitions and zero sensitive delta. Each of the three activation states has a non-empty chain: neither tree has v2 keys before activation, only the own tree has keys at the activation commit, and after activation the table or keys are removed again; the constructors must not fill in keys by default. (A6, A8)

## Steps

1. Run the pure-function chain check on the legal transition, the negative case with swapped evaluation objects, ordinary commits and the zero-transition chain.
2. For the two merge kinds, make the sensitive delta equal / not equal to the second parent, and check classification and result.
3. Run the three pre-activation states; then check the same chain in chain-end-table mode and compare against the default per-commit mode.

## Expected results

- AC-PLAT-009-05: Evidence is taken commit by commit along the first-parent sequence only; tearing out a first-parent guard or an own-tree effect fails correspondingly, a base-sync merge accepts only the second parent's values, a non-sync merge is handled as an ordinary commit, and zero transitions with zero sensitive delta pass.
- AC-PLAT-009-06: Before activation every vacuum commit gets its own notice, the activation commit uses its own table and can judge its delta, and after activation a missing table/key is a named violation; chain-end-table mode can cover the whole chain, and the default mode never borrows a future table.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestCommitTablesAndMerges`
