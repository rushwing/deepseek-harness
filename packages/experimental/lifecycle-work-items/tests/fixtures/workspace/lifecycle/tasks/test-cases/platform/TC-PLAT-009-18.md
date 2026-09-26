---
tc_id: TC-PLAT-009-18
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-27]
title: "ATX closing-hash normalisation and exact mirror heading match"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Copy one compliant mirror out of the six specs, leaving the body tables completely unchanged. Three independent heading variants change only the heading line: append a CommonMark-legal ` ###`, rename it to `### Deprecated transition table`, and make the heading text end in a literal `#` with no preceding space; the baseline and each variant test exactly one heading at a time so that no other mirror difference pollutes the result. (A2, A7)

## Steps

1. Call `heading_text` on the original heading and on the heading with the appended closing sequence, and run the full mirror check on each.
2. Run the same check on the genuinely renamed heading and record the missing diagnostic.
3. For the heading whose text ends in `#` without satisfying "whitespace + closing sequence", check the normalised result and confirm no body character was stripped.

## Expected results

- AC-PLAT-009-27: The original heading and the heading with a closing sequence normalise to the same value and both mirrors are found; a genuine rename still reports missing; body hashes that are not closing syntax are not stripped.

## Implementation location

`tests/gates/test_lifecycle_mirror.py::TestAtxClosingSequence`
