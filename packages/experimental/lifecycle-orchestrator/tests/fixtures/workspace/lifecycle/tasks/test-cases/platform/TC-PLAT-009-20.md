---
tc_id: TC-PLAT-009-20
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-30, AC-PLAT-009-31]
title: "Per-commit parse-failure isolation and the five violation-line formats"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Build a synthetic chain of at least three commits where the middle commit's first-parent tree or own tree breaks exactly one object at a time: REQ/TC/BUG/RV frontmatter, the registry, the lifecycle table; the commits before and after each carry a decidable legal/violating transition, proving that the other commits keep running. For the format matrix, separately construct transition, event, ordinary, parse and range violations; for the transition subject additionally construct "declares T03, delta resembles T04". The parse layer may not build the graph from default fields. (A1, A2)

## Steps

1. Run the whole chain for each file kind and each of the two tree positions, recording problem count, short hash, file and exceptions.
2. Check that the broken commit never enters guard/effect evaluation while the neighbouring commits still have their own results.
3. Run the five format fixtures and assert each line token by token; verify that every line carries exactly one violation.
4. For the resembles-another-transition scenario check the appended T-code; for the non-resembling scenario confirm none is appended.

## Expected results

- AC-PLAT-009-30: Every parse break makes the corresponding commit a violation naming the short hash and the file, without continuing on default values; the other commits are still checked and there is no traceback anywhere.
- AC-PLAT-009-31: Transition lines carry short hash/T-code/REQ/field or section, event lines carry short hash/event/object, ordinary lines carry short hash/object, parse lines carry short hash/file, range lines carry the range; the resembling scenario appends the resembled T-code and every violation is one line each.

## Implementation location

`tests/gates/test_lifecycle_generated.py::TestParseIsolationAndDiagnostics`
