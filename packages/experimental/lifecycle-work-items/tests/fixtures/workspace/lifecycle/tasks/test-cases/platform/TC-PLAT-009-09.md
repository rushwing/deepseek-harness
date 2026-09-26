---
tc_id: TC-PLAT-009-09
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-16]
title: "Event gating, full history and failure isolation of the CI governance job's fifth step"
status: passing
level: e2e
owner: evaluator-002
automated: false
---

## Preconditions

Inspect `.github/workflows/ci.yml` and the `scripts/gates/req_lint.py` CLI definition directly; keep the names, commands and order of the four pre-change gate steps as the baseline for comparison. The review of what happens when the fifth step's command fails only checks the workflow control flow and does not execute external GitHub services.

## Steps

1. Check the checkout's full-history configuration, the governance job's existing four steps and the newly added fifth-step command.
2. Trace the three event types along the fifth step's `if` and its parameter sources, confirming that all three PR fields come from the event file and that a sync does not reuse the previous result.
3. Check the job/step failure control: when the fifth step fails, determine whether the other four steps still run.
4. Search for added workflows, scripts and console entries, confirming there is no second governance job or new command entry point.

## Expected results

- AC-PLAT-009-16: Only pull_request runs the fifth step and passes the PR number, base and head from the event; full history is available and the whole chain is re-run every time; push and manual triggers skip it; the existing four steps stay as they were and are not short-circuited by a fifth-step failure; no job or command entry point was added.

## Implementation location

Manual: results are recorded in the RV `## req_impl_review` Evidence field
