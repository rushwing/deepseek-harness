---
tc_id: TC-PLAT-009-16
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-24]
title: "Synthetic tree carries the six specs by default; mirror closed set at the zero-file boundary"
status: passing
level: e2e
owner: evaluator-002
automated: true
---

## Preconditions

Use the default call `harness_gate_api.build_tree(tmp_path)` as the positive case without writing any spec file yourself; check that it automatically lands compliant copies at the six `MIRRORED_SPECS` paths. The negative case deletes exactly those six copies from a synthetic tree that already passed, leaving the lifecycle table, the registry and the rest of the skeleton unchanged; the entry point may not skip on `any(is_file())` or on an empty set. Use the current working tree as the REQ-PLAT-007/008 regression baseline. (A1, A7)

## Steps

1. Call `build_tree`, assert that all six paths exist and are non-empty, and that the whole-tree mirror check reports no violation.
2. Remove only the six copies, run `req_lint.run_all`, filter and count the not-found diagnostics and their file names.
3. Scan the entry-point calls to confirm the closed set is iterated one by one; run the existing REQ-PLAT-007/008 TCs and gate tests.

## Expected results

- AC-PLAT-009-24: The default tree carries six copies that pass; after deleting all of them there are exactly six missing diagnostics, one per registered path, never an empty result; the entry point has no overall existence guard, and the existing 007/008 tests stay green.

## Implementation location

`tests/gates/test_req_lint_entry.py::TestMirroredSpecsClosedSet`
