---
tc_id: TC-PLAT-009-15
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-23]
title: "External review findings table: six columns, disposition and signer role"
status: passing
level: unit
owner: evaluator-002
automated: true
---

## Preconditions

Use `write_rv` to create a baseline without an External review section, plus two positive cases containing that section with the conclusion signed by human-901/evaluator-901 and a findings table with all six columns and a non-empty disposition. Each negative case changes only one line: a fake table inside a fence, an indented table, seven columns with trailing text, five columns with a missing item, an empty disposition, a planner/generator signature; the other four gate sections stay compliant so that the error comes from the External review section. (A2, A5)

## Steps

1. Run `check_rv_external_review` and the whole-tree entry point on the section-less baseline and the two legal-signature positive cases.
2. Run the malformed, missing-column, trailing-column and missing-disposition negative cases separately, recording the original line number and the diagnostic.
3. Run the two illegal-role signature negative cases separately; use the evaluator's concrete UID with role normalisation as the control.

## Expected results

- AC-PLAT-009-23: No violation of this rule when the section is absent, and both positive cases pass; every table negative case fails and names the exact line, and an empty disposition cannot be passed off with whitespace; planner/generator signatures fail, human/evaluator role signatures pass.

## Implementation location

`tests/gates/test_req_lint_rv.py::TestExternalReviewSection`
