---
req_id: REQ-CBOM-021
tool: canonical-bom
title: "Phase 5: natural-language difference queries by an AI agent"
status: draft
owner: human-001
priority: P3
phase: M5
scope: backend
tc_policy: required
exempt_reason: ""
depends_on: [REQ-CBOM-017, REQ-CBOM-020]
test_case_ref: []
acceptance: "An AI agent resolves any two registered BOMs from a natural-language prompt and returns the standard difference-classification report identical to the GUI's; when no unique target can be resolved it asks the user to clarify instead of guessing"
review_round: 0
pending_bugs: []
blocked_reason: ""
blocked_from_status: ""
blocked_from_owner: ""
pr_number: null
---

## Background

Stage 5 of the ICT phased delivery (Feature-005): query the difference report between any two
BOM lists through a prompt. The tool already has an MCP surface (REQ-CBOM-007); this REQ's
increment is a **registry-aware BOM selector** — locating BOMs by registry coordinates
(CM / Factory / Shop Floor / Product / SKU / Product Version) rather than by file path.

## Requirement description

1. MCP tool parameter extension: accept registry coordinates (including the SKU level, e.g. "the
   latest two revisions of PG558 SKU0202 at FXHC") and resolve them to concrete BOM records;
   coordinates without a SKU are ambiguous when the Product has several SKUs; resolution is
   deterministic first, and when ambiguous it lists the candidates and asks the user to clarify — **never guesses**.
2. Return exactly the same standard difference classification as the GUI comparison (same service entry point, tri-surface consistency contract).
3. skill/SKILL.md (ADR-005 graduation path) describes the trigger scenarios and prompt examples in step.

## Non-goals

- No comparison logic implemented on the agent side (selector + service call only)
- No cross-session memory or subscription push

## Acceptance criteria detail

(draft — to be expanded by the Planner after human-001 approves the scope)

## Design references

- [ADR-007](../../../../docs/adr/ADR-007-pairwise-bom-comparison.md)
- [ADR-002](../../../../docs/adr/ADR-002-tri-surface-cli-http-mcp.md) (tri-surface consistency)
- [ADR-008](../../../../docs/adr/ADR-008-headless-engine-vave3-boundary.md) — the MCP surface stays in
  factory-tools and does not go through vave3 (the two-repository boundary does not affect this REQ); the AI query bar
  in the VAVE3 GUI is a reserved hidden item (REQ-CBOM-023 non-goal)
- [ICT source requirement](../../../../docs/tools/canonical-bom/design/sources/ict-task-submissions.md) Feature-005

## Bug History

(none yet)
