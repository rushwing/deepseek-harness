---
tc_id: TC-PLAT-009-01
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-01, AC-PLAT-009-02]
title: "Lifecycle table v2 shape, closed reference set and subject-id self-consistency"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

The state/role sections of the real v1 table and the transition five-tuple snapshot in `tests/gates/test_lifecycle_table.py` are the independent baseline; the upgraded copy only adds the v2 registrations. Each negative case changes exactly one thing in a compliant v2 copy: delete one of the four new fields, leave the old `post` on T16/T19, let an event change REQ status/owner, reference an unregistered predicate/artifact/RV section/TC or BUG state inside some transition or event, or add an unregistered key; the subject negative cases make T03 carry no id, carry both T03 and T04, carry only T04, or make an event subject contain T03. The constructor must not put deleted keys back. (A2, A3, A4)

## Steps

1. Load the compliant v2 table, compare all version 1 states, roles and the 21 transition five-tuples field by field with the v1 snapshot, and read the five event kinds and the predicate registration.
2. Load each structural, unregistered-key and event-effect negative case and run the table self-consistency check.
3. Inject each kind of unregistered reference into each field of transitions and events, and record the id and field named in the violation.
4. Check the no-id, multi-id and wrong-id transition subjects and the event subject containing a transition id one by one, keeping the positive case with a single correct id.

## Expected results

- AC-PLAT-009-01: the compliant table's version rises to a supported new value and loads, the old version 1 still loads; v1 states, roles and the 21 five-tuples are equal item by item, T16/T19 are expressed with effects only; any copy with a missing item or an event touching REQ status/owner fails and names the field, and all five event kinds are present.
- AC-PLAT-009-02: all references fall within the registered closed set; each minimal negative case yields at least one line naming its transition or event and the field, and the four subject positive/negative cases yield distinguishable results: pass, no id, multiple ids, mismatched id or event containing an id.

## Implementation location

`tests/gates/test_lifecycle_table.py::TestV2SchemaAndConsistency`
