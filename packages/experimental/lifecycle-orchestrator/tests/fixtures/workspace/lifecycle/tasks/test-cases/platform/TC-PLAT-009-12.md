---
tc_id: TC-PLAT-009-12
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-19]
title: "Two-kind provider set constraints and the cross-vendor active set"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Copy the agents and the two kinds of set from the real registry; the active set is explicitly cross-vendor with its three roles fixed to planner-001, generator-001 and evaluator-002; each negative case changes only one set's `kind`, one member or one model, with the other agents/handles compliant. Construct separately: a cross-vendor set whose generator/evaluator share a vendor, a same_vendor set mixing vendors, a missing kind, an unknown kind, and empty members; every name is unique so a diagnostic cannot be misattributed to another set. (A3, A4)

## Steps

1. Run `check_agents.run_all` on the real registry and read the three active-set members and their vendors.
2. Run the per-item checks on the two kinds of compliant set separately.
3. Run the five minimal negative cases one by one, counting problems and looking for the set name, role or kind.

## Expected results

- AC-PLAT-009-19: The real active set is exactly the specified cross-vendor trio and passes; the registered same_vendor/cross_vendor positive cases both pass; all five negative cases fail and name the set, and where member vendors are involved also name generator/evaluator or the corresponding role.

## Implementation location

`tests/gates/test_check_agents_provider_sets.py::TestProviderSetKinds`
