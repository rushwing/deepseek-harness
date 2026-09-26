---
bug_id: BUG-PLAT-006
tool: platform
title: "Exact heading match does not strip the CommonMark-legal ATX closing #; `### Transition table ###` is falsely reported as a missing mirror"
status: closed
severity: low
bug_type: impl_bug
owner: generator-001
linked_req: REQ-PLAT-009
origin_req: ""
blocks_req: []
found_in: req_impl_review
test_case_ref: [TC-PLAT-009-18]
---

## Symptom

`scripts/gates/harness_rules.py::heading_text` (lines 711–713) was changed to exact whole-heading matching to fix Codex round 2 #4 (substring-containment false match,
`### Deprecated transition table` taken as `### Transition table`):

```python
def heading_text(line: str) -> str:
    """Comparison form of an ATX heading line: strip leading ``#``, back-tick markers and surrounding whitespace."""
    return plain_cell(line.lstrip("#"))
```

`str.lstrip("#")` strips only **leading** `#` and not the CommonMark-legal ATX closing sequence (any number of `#` may close the heading after its text,
as in `### Transition table ###`). None of the six real spec files writes headings that way, but it is not illegal Markdown — a spec file whose heading is written
`### Transition table ###`, with the table content unchanged to the letter, is still falsely reported as "cannot find the registered mirror '§4 transition table'".

Codex round 3 scoped re-review n3-2 (P2, high) pointed out this form. evaluator-001 reproduced it personally in req_impl_review round 3
(`scratchpad/repro_n3_2.py` and `repro_n3_2b.py`):

```
heading_text("### Transition table")      -> "Transition table"
heading_text("### Transition table ###")  -> "Transition table ###"   # closing # not stripped, no longer equal to the registered heading
```

Running `check_lifecycle_mirror` on a copy of the real `requirement-standard.md` with only `### Transition table` changed to `### Transition table ###` (the table under the heading completely untouched)
returns:

```
["harness/requirement-standard.md: cannot find the registered mirror '§4 transition table' (heading, indent, fence, comment or the file itself?)"]
```

## Expected vs actual

- Expected: the comparison form of a heading strips the leading `#`, the optional trailing ATX closing `#` sequence (and the whitespace before it), back-tick markers and surrounding whitespace before
  exact matching; both CommonMark-legal ATX forms (with and without closing `#`) are recognised as the same heading.
- Actual: only the leading `#` is stripped; the trailing closing `#` sequence is treated as part of the heading text, so that form is misjudged as "heading renamed / mirror missing".

## Root cause (filled in after diagnosis)

The `heading_text` implementation handled only the one known negative case from round 2 #4 (substring-containment miss) and did not cover the other equivalent form
that CommonMark ATX heading syntax itself allows (closing `#`). None of the six real spec files uses the closing-`#` form today, so this gap does not affect the verdict on the current repository tree,
but it is a robustness gap: if someone later adds a closing `#` to a heading using legal CommonMark syntax, the mirror check will falsely report that file as
"heading renamed / missing".

## Fix plan

After stripping the leading `#` and before `plain_cell`, `heading_text` first strips the trailing ATX closing sequence: the regex
`re.sub(r'\s+#+\s*$', '', text)` or an equivalent (strip only when the ending is whitespace + one or more `#`, to avoid harming the edge case, if any, of heading text that itself
ends in `#`).

human-001 ruling 2026-09-12 (PR #24): carried by REQ-PLAT-009; 009 T01 fills `linked_req`.

## Verification method (linked TC)

The carrier REQ named by `linked_req` adds one TC in its tc_design (or appends to the `verifies` of TC-PLAT-008-13): append ` ###` to a registered heading in one of the six specs
(content unchanged) and assert the mirror check still judges it "found" and reports nothing missing; as control, genuinely renamed negative cases such as
`### Deprecated transition table` keep being reported missing (the round 2 #4 regression is unaffected). severity `low`, does not block
this round's REQ-PLAT-008 closure; none of the six real specs triggers the gap today.

Fix 2026-09-13 (REQ-PLAT-009 T11):

- Root cause: `heading_text` did only `plain_cell(line.lstrip("#"))`, stripping the leading `#` but not the trailing closing sequence allowed by CommonMark 4.2,
  so `### Transition table ###` normalised to `Transition table ###`, unequal to the registered heading, and was judged a missing mirror.
- Fix: a new `ATX_CLOSING = re.compile(r"\s+#+\s*$")` strips the closing sequence before `plain_cell`. Per the spec the closing sequence
  needs whitespace before the `#`, so body text that itself ends in `#`, such as `### Transition table#`, is not a closing sequence and is not stripped (the third variant of TC-PLAT-009-18).
- Regression unaffected: the genuinely renamed `### Deprecated transition table` is still reported missing (round 2 #4).

Verification record: 2026-09-13 evaluator-002, TC-PLAT-009-18 real run, 2 items passed; see [RV-PLAT-009 req_impl_review evidence](../../reviews/platform/RV-PLAT-009.md#req_impl_review).
