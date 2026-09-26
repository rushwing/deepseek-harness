---
tc_id: TC-PLAT-009-14
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-21, AC-PLAT-009-22]
title: "Closed set of wording for the evaluator adversarial framework and the Codex invocation contract"
status: passing
level: e2e
owner: evaluator-002
automated: false
---

## Preconditions

Read directly in `harness/briefs.md` the sections evaluator @ req_review, tc_design, req_impl_review, the review checklist / adversarial review framework, the Codex evaluator invocation contract, generator @ tc_impl and the general prohibitions; also read the banned-phrase table in `harness/agent-standard.md` §4 and its mirror in `scripts/gates/check_agents.py`. Take visible text by section boundary; a hit inside a code fence or in another section does not count as a hit in the target section.

## Steps

1. In each of the three evaluator sections, check the bypass assumption, minimal-input real-run proof, the A1–A8 references and the item-by-item disposition of external findings.
2. Run the briefs banned-phrase check and the mirror check on the added wording.
3. In the Codex contract, check item by item: non-interactive execution, workspace-write, scope in the prompt, full output in the scratchpad, RV excerpt, clean working tree at wrap-up, new scoped session, trailer, T08 recipient.
4. Search the brief's report-file naming rule, confirming the allowed form is `notes-*` and that the forbidden form does not appear as a filename template.

## Expected results

- AC-PLAT-009-21: All three evaluator states fully carry the four review actions and the eight-class framework; the banned-phrase check and the mirror check return empty.
- AC-PLAT-009-22: All nine invocation/handoff constraints can be located one by one, the report-file template contains no banned word, and there is no contrary command or residual old recipient.

## Implementation location

Manual: results are recorded in the RV `## req_impl_review` Evidence field
