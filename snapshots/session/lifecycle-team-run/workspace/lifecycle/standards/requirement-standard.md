# Requirement Standard (REQ specification)

## 0. Mandatory preflight protocol (HARD STOP)

**Before writing any code/documentation/artifact for a REQ, the agent must check the three items below; if any one is not satisfied, stop immediately and report to `human-001` — do not write anything.**

| # | Condition | How to check | Action on failure |
|---|---|---|---|
| C1 | REQ file exists | `ls lifecycle/tasks/features/<scope>/REQ-<PREFIX>-NNN.md` | Stop. Ask human-001 for the correct REQ ID |
| C2 | `owner` == your UID | `grep '^owner:' …REQ-….md` | Stop. This REQ belongs to another agent; do not overstep |
| C3 | `status` is a legal working state for your role | See table below | Stop. Report its current status |

The only transition exempt from C2/C3 is T19 (human-001 pulls back for a rewrite): its action is exactly to reclaim the owner, so it does not require already being the owner before execution. No such exception exists for agent transitions; T15 (set to blocked) is executed by the current owner, not a privilege. Two further kinds of actions are not REQ transitions and do not change the REQ, so they do not go through the REQ's three preflight checks: a regression run for deferred verification only updates the RV `## regression` section and TC status ([testcase-standard.md](testcase-standard.md) §4); BUG fixing and verification during REQ `blocked` start work on the strength of the BUG-level handoff (the fixer and the verifying evaluator each have their own set of checks, [bug-standard.md](bug-standard.md) §6). Changes to the original REQ's artifacts made within the carrying process ([bug-standard.md](bug-standard.md) §4) — the original TC's `verifies` and status, the original REQ's RV `## regression` line — are authorized by the carrying REQ's three preflight checks, with no separate exception.

### Legal working states per agent

This table, the per-role legal states derived from the [lifecycle.yml](lifecycle.yml) transition table, and the `handles` field of [agent-registry.yml](agent-registry.yml) are mutually consistent, checked by the gates ([GUIDE §6](GUIDE.md#6-gates)). What each role reads, writes, and delivers in each state is in [briefs.md](briefs.md).

| Agent | Legal `status` | What it does in that state |
|---|---|---|
| **planner-<NNN>** | `req_review` | Shapes the REQ into v2 body text; puts HOW into the design document; writes anything uncertain into Pending decisions |
| **generator-<NNN>** | `tc_review` | Reviews the TC text written by the evaluator; writes the conclusion in the RV |
| **generator-<NNN>** | `tc_impl` | Implements the TC code |
| **generator-<NNN>** | `req_impl` | Implements the requirement code; opens a draft PR from the review-package template once CI is green |
| **evaluator-<NNN>** | `req_review` | Reviews the requirement against CHK01–08; writes the conclusion and findings in the RV; passes or rejects |
| **evaluator-<NNN>** | `tc_design` | Writes the TC text under `tasks/test-cases/<scope>/` (sets the acceptance criteria, including verifies) |
| **evaluator-<NNN>** | `tc_impl_review` | Reviews the TC code written by the generator; writes the conclusion in the RV |
| **evaluator-<NNN>** | `req_impl_review` | Reviews the implementation; writes the conclusion and evidence in the RV; `gh pr ready` on pass |
| **human-<NNN>** | `draft` | Approves scope, sets `req_review` |
| **human-<NNN>** | `req_review` | Rules on Pending decisions (T18); pulls back for a rewrite (T19) |
| **human-<NNN>** | `pr_draft` | Reviews and merges a ready PR |
| **human-<NNN>** | `done` | No further action after archiving; the owner after T14 |
| **human-<NNN>** | `blocked` | Clears the block (T16); before T16 may redirect: non-exempt becomes self-carried and changes the restore target; exempt only changes the restore target to req_review and writes the ruling into the BUG; a fix that lives in another REQ has its `linked_req` set to that REQ — if that REQ has already left req_review, pull it back with T19 first (bug-standard §6) |

> 🔑 **The one who sets the standard ≠ the one who implements it**: `tc_design` (writing the TC text = setting the acceptance criteria) belongs to the **Evaluator**,
> `tc_impl` / `req_impl` (writing code) belongs to the **Generator**. Setting the standard and implementing it for the same artifact are held by different identities.
>
> The UIDs in the table represent roles: other instances of the same role (e.g. `evaluator-002` in a cross-vendor set) have the same legal working states; seat assignment is at the top of [briefs.md](briefs.md)
> (tc_impl_review goes to evaluator-001); gates and transition evidence check only the role.

## 1. File location and naming

- Path: `lifecycle/tasks/features/<scope>/REQ-<PREFIX>-NNN.md`, where `NNN` is a zero-padded three-digit sequence number
- The `<scope>` ↔ `<PREFIX>` mapping is in [tasks/id-scheme.yml](tasks/id-scheme.yml)
- On completion, move into `lifecycle/tasks/archive/done/`; the review record RV and design plan PL sharing the same number are **not moved** (§7)
- A REQ superseded by a new REQ before completing its lifecycle gets a `superseded_by` annotation field and a "Superseded record" section appended to its body, then
  moves into `lifecycle/tasks/archive/superseded/` (human-001 rules on this; archive is not scanned by req_lint)
- One REQ describes exactly **one independently acceptable** requirement; split an oversized requirement and link the parts with `depends_on`

## 2. Required frontmatter fields

```yaml
---
req_id: REQ-CBOM-001    # must match the filename
tool: canonical-bom     # must match the containing directory
title: "One-sentence requirement title"
intent: "One sentence, one intent: what this requirement gets for whom"
status: draft           # see §4 lifecycle
owner: human-001        # must be a UID registered in agent-registry.yml
priority: P0            # P0-P3
phase: M1               # milestone code
scope: backend          # design | backend | frontend | fullstack | infra | docs | harness | tooling
tc_policy: required     # required | optional | exempt (exempt must have exempt_reason)
exempt_reason: ""
depends_on: []          # [REQ-…, …]
test_case_ref: []       # [TC-…, …]
acceptance: "One sentence, present tense, a verifiable acceptance criterion; the two-tier rule in §5 applies here too"
review_round: 0         # number of times the evaluator has signed off a conclusion in req_review: T03 / T03b / T03c / T04, and T15 executed from req_review, each add one
pending_bugs: []        # registers only BUGs that sent this REQ back on review; non-empty means blocked
blocked_reason: ""
blocked_from_status: "" # the status to return to once T16 clears the block: the row this rejection should have gone to (see briefs "Blocking and clearing")
blocked_from_owner: ""  # the owner to return to once T16 clears the block
pr_number: null
lifecycle_schema: 2       # body follows the §3 skeleton; required once status leaves draft / req_review
---
```

`intent` is a scalar: a REQ has exactly one intent, and the type is the constraint itself.
An absent `lifecycle_schema` means the legacy form, checked only via frontmatter; existing drafts convert to v2 in their own T02, archived files are not changed.

## 3. Body structure (lifecycle_schema: 2)

Exactly seven level-2 headings, order fixed; level-3 headings are allowed only inside Behavior. Budgets are counted in characters, not lines: take the raw text of the section from its heading line up to (not including) the next level-2 heading, including newlines and spaces, as returned by Python `len`.

| Section | Budget | Contents |
|---|---|---|
| `## Goal` | ≤ 800 | The expansion of intent: why, what, and what's different once it's done |
| `## Behavior` | ≤ 6,000 | Externally observable rules and invariants — only the context that sits above the acceptance items; **anything that can be written as an AC is written directly as an AC, no double-writing**. An optional `### Assumptions and defaults` subsection is allowed, reserved for default choices the agent makes on the human's behalf and assumptions about external dependencies |
| `## Non-goals` | ≤ 800, non-empty | States explicitly what is not being done, to prevent scope creep |
| `## Acceptance criteria` | ≤ 6,000; each item ≤ 240 (the whole line as written, including the `- **AC-…** ` prefix, newline, and indentation) | `- **AC-<PREFIX>-NNN-SS** …`: globally unique numbering, prefix and sequence match the owning REQ; one sentence, present tense, an observable artifact; use the three-part "given …, when …, then …" form when preconditions need spelling out; numbers are stable and never reused — deleted items leave their number retired; cross-REQ references cite the other REQ's number directly |
| `## Pending decisions` | ≤ 1,200 | `- **Q-01** (proposer, date) question? \| option A / B / C \| default A \| deadline YYYY-MM-DD`; this section must read exactly `None` once status leaves `req_review` |
| `## Design references` | ≤ 1,000 | ADRs, `docs/tools/<tool>/NN-*.md#anchor`, GLOSSARY entries, PL files; links must resolve to an existing file or anchor; **HOW lexicon is allowed only in this section** |
| `## Bug History` | None | Records of T15 / T16 / T19 |

Whole document (excluding frontmatter) ≤ 14,000 characters. Banned headings: Background, Requirement description, Revision history, Review record, Notes, Implementation slices. Revision history lives in git, review lives in the RV (§7), implementation slices live in the PL (§7), design rationale lives in an ADR or design document.

### HOW lexicon

Applies to `acceptance`, `intent`, and every section except Design references. A match is a violation; the regex constants live in `req_lint` (the rule bodies are in `harness_rules.py` in the same directory), this table is a mirror, and the gates check the two item-for-item ([GUIDE §6](GUIDE.md#6-gates)).

| Category | Regex |
|---|---|
| Code paths | `\b(src\|tests\|tools\|libs\|services)/\S+\.(py\|yaml\|json)\b`, `::` |
| CLI flags | `(?<![\w-])--[a-z][a-z0-9-]*` |
| Exit codes / HTTP | `\bexit\s*\d`, `exit code\s*\d`, `\bHTTP\s*\d{3}`, `(?<![\d,.])\b(422\|500)\b(?![\d,.]\|\s*(rows\|items\|lines\|copies\|entries\|characters))` |
| Request/response model names | `\b[A-Z][A-Za-z]+(Request\|Response)\b` |
| Code fences | ``` fences forbidden outside Design references |

Allowed: GLOSSARY-registered field names and enum values inside backticks, error class names (`ConfigError` / `ValidationError` / `InputFormatError`), ADR and documentation links.

### Design contract layer

`docs/tools/<tool>/NN-*.md` and `docs/architecture/` are the sole home for HOW: field tables, canonical encodings, CLI / HTTP / MCP shapes,
the mapping from error classes to exit codes and HTTP statuses, module placement. Two rules:

- the planner changes the design document and the REQ **in the same T02 commit**;
- a design document may note "sourced from REQ-xxx", but **must not** carry a normative rule via "rule is in REQ-xxx".

## 4. Lifecycle

```
draft → req_review ⇄ tc_design → tc_review ⇄ tc_impl → tc_impl_review
      → req_impl → req_impl_review → pr_draft → done
any state →(blocked by a BUG)→ blocked →(BUG closed)→ restores to the original state
```

`tc_policy` decides the exit from req_review:

| tc_policy | Exit | Path |
|---|---|---|
| `required` | T03 | Full path, TC covers every AC |
| `optional`, evaluator judges TC needed | T03 | Full path, same as `required`: TC covers every AC, ACs that cannot be automated use a manual TC with `automated: false` (testcase-standard §4) |
| `optional`, evaluator judges the TC waived, and no BUG's `linked_req` points at this REQ | T03c | `draft → req_review → req_impl → req_impl_review → pr_draft → done`; the RV `## req_review` states the TC waiver reason. When a BUG's `linked_req` points at this REQ, the TC cannot be waived — only T03 is allowed (a carrying REQ can only take T03, bug-standard §4) |
| `exempt` (pure specification/documentation, must have `exempt_reason`) | T03b | `draft → req_review → pr_draft → done`; the planner opens a draft PR in T02 and fills in `pr_number`, the evaluator runs `gh pr ready` at T03b. An exempt REQ must not carry: any BUG whose `linked_req` points at it is a violation |

The exit table and the transition table below are both mirrors of [lifecycle.yml](lifecycle.yml): the gates check that the exit table's (tc_policy, exit) and the transition table's #, From, Actor, To, Owner after columns are item-for-item consistent; the Event column is prose and is not compared ([GUIDE §6](GUIDE.md#6-gates)).

### Transition table

| # | From | Actor | Event | To | Owner after |
|---|---|---|---|---|---|
| T01 | `draft` | human-<NNN> | Approves scope (a draft already meeting §3 may be set directly to `lifecycle_schema: 2`) | `req_review` | planner-<NNN> |
| T02 | `req_review` | planner-<NNN> | Body shaped per §3 and set to `lifecycle_schema: 2`; HOW put into the design document in the same commit; Pending decisions is None or lists items; opens a draft PR and fills in `pr_number` when `exempt` | `req_review` | evaluator-<NNN> |
| T03 | `req_review` | evaluator-<NNN> | Review passes, `required` or `optional` and TC needed: RV `## req_review` PASS, Pending decisions == None | `tc_design` | evaluator-<NNN> |
| T03b | `req_review` | evaluator-<NNN> | Review passes and `exempt`, and no BUG's `linked_req` points at this REQ (exempt must not carry): RV `## req_review` PASS; `gh pr ready` | `pr_draft` | human-<NNN> |
| T03c | `req_review` | evaluator-<NNN> | Review passes, `optional` and TC waived, and no BUG's `linked_req` points at this REQ (a carrying REQ can only take T03): RV `## req_review` PASS and states the TC waiver reason | `req_impl` | generator-<NNN> |
| T04 | `req_review` | evaluator-<NNN> | Review sends back: RV `## req_review` conclusion REJECT + findings table, `review_round` incremented by one; a BUG is attached only when the requirement defect needs a separate REQ to carry it | `req_review` | planner-<NNN> |
| T05 | `tc_design` | evaluator-<NNN> | TC text is ready (with `verifies`, covering every AC) | `tc_review` | generator-<NNN> |
| T06 | `tc_review` | generator-<NNN> | TC text is accepted: RV `## tc_review` PASS; every TC whose `linked_req` is this REQ has its `status` → reviewed (except the original TC of a carried BUG) | `tc_impl` | generator-<NNN> |
| T07 | `tc_review` | generator-<NNN> | TC text disputed: RV `## tc_review` REJECT | `tc_design` | evaluator-<NNN> |
| T08 | `tc_impl` | generator-<NNN> | TC code is ready; a manual TC has no code written for it, and Implementation location states manual | `tc_impl_review` | evaluator-<NNN> |
| T09 | `tc_impl_review` | evaluator-<NNN> | TC code passes: RV `## tc_impl_review` PASS; a manual TC is checked only for whether its steps are executable | `req_impl` | generator-<NNN> |
| T10 | `tc_impl_review` | evaluator-<NNN> | TC code sent back: RV `## tc_impl_review` REJECT | `tc_impl` | generator-<NNN> |
| T11 | `req_impl` | generator-<NNN> | Implementation ready + CI green; opens a draft PR from the review-package template and fills in `pr_number`; reuses `pr_number` if one already exists, does not open a new one; every carried BUG (`linked_req` points at this REQ) is resolved | `req_impl_review` | evaluator-<NNN> |
| T12 | `req_impl_review` | evaluator-<NNN> | Implementation sent back: RV `## req_impl_review` REJECT; failing TCs set to failing | `req_impl` | generator-<NNN> |
| T13 | `req_impl_review` | evaluator-<NNN> | Implementation passes: RV `## req_impl_review` PASS; TCs get their status set per the result matrix in testcase-standard §4, none failing, sample-missing skips are individually listed as Deferred verification (carried-BUG TCs missing samples do not get T13 signed off, the conclusion line reads AWAITING SAMPLE); manual TCs are executed by the evaluator; carried BUGs, once verified, are all set to closed and their original TC to passing (bug-standard §4 carrying process); update the PR evidence line, `gh pr ready` | `pr_draft` | human-<NNN> |
| T14 | `pr_draft` | human-<NNN> | Merge the PR (no failing TC, `pending_bugs` empty, all carried BUGs closed); the REQ moves to `archive/done/`, RV / PL / TC do not move | `done` | human-<NNN> |
| T15 | Any review state or `pr_draft` | current owner | Used instead of an ordinary send-back when a defect needs a separate BUG to carry it: create a single BUG (with `blocks_req`), register `pending_bugs`, write `blocked_reason` and the restore target; a BUG whose fix needs changes to this REQ's body, TC text, or an added TC self-carries: `linked_req` set to this REQ, restore target `req_review` / planner (exempt does not self-carry, it goes through T04 / T17; bug-standard §4); `review_round` is incremented by one when executed from `req_review`; when executed by human-001 within `pr_draft`, used for a failed deferred verification, does not change the review gate section, restore target req_impl / generator; the contract is in briefs "Blocking and clearing" | `blocked` | human-<NNN> |
| T16 | `blocked` | human-<NNN> | All `pending_bugs` are closed, self-carried ones are resolved (per BUG-level handoff and the carrying process, bug-standard §6 / §4): restore and clear the blocking fields, Bug History records one line for the clearing (not a precondition of the BUG's own closing); when the restore target is `req_review`, every TC whose `linked_req` is this REQ goes back to draft, carried BUGs already closed go back to resolved, and lines in the original REQ's RV `## regression` referencing this REQ's TCs are withdrawn together | Restores `blocked_from_status` | Restores `blocked_from_owner` |
| T17 | `req_review` | planner-<NNN> | Pending decisions is non-empty, needs human-001 to rule | `req_review` | human-<NNN> |
| T18 | `req_review` | human-<NNN> | Ruling written back into Behavior / Acceptance criteria text, Pending decisions set to None | `req_review` | planner-<NNN> |
| T19 | Any (except `done` / `blocked`) | human-<NNN> | Pull back for a rewrite, no BUG attached; Bug History records one line; the only transition exempt from C2/C3; a REQ that already has a PR reverts to draft; every TC whose `linked_req` is this REQ goes back to `draft`, carried BUGs already closed go back to resolved, and lines in the original REQ's RV `## regression` referencing this REQ's TCs are withdrawn together (the original TC itself is untouched, testcase-standard §4) | `req_review` | planner-<NNN> |

- A backward state move (⇄) is **triggered only by a review send-back or T19**; a send-back must leave a findings table in the RV
- Each transition is executed by the current owner, and after producing its output, hands off to the next owner per the transition table; the sole exception is T19, where human-001 need not be the owner
- **Review records are written only in the RV** (§7). The transition commit subject is `lifecycle: T<NN> — one sentence`, body ≤ 10 lines, recording only
  `status: a → b; owner: x → y; review record: RV-…#<gate>`. The subject shape of each transition, the guard on the pre-transition tree, and the effect on the diff are registered in
  [lifecycle.yml](lifecycle.yml); CI checks them commit-by-commit along the PR's first-parent commit chain (transition evidence, [GUIDE §6](GUIDE.md#6-gates)); the full effect of one transition must land in
  the same transition commit — splitting it into multiple commits is a violation, and a mistake can only be fixed by rewriting that commit
- **Non-transition events**: a commit that does not change REQ status / owner must not change a lifecycle-sensitive object (REQ lifecycle fields, TC status, the status of an existing BUG, an RV gate section's conclusion line),
  unless the subject is one of the registered events — `fix: BUG-…`, `verify: BUG-…`, `lifecycle: regression —`, `lifecycle: external review —`, `lifecycle: redirect —` (human-001 changing the restore target before T16) — and the diff matches its effect; creating a new BUG file is not restricted by this.
  The event list, subjects, and effects are governed by the events section of [lifecycle.yml](lifecycle.yml); this bullet and the narrative in briefs are mirrors of it
- **Pending decisions must be empty before T03 / T03b / T03c**: TC text and implementation must not target unresolved questions; anything that can be registered as a Q while the REQ is still in req_review must not be left for the
  Pending human-001 line in the PR — that line lists only things generator / evaluator discover after the REQ has left req_review, for human-001 to accept in pr_draft or pull back with T19
- **T03 / T03b / T03c / T04, and T15 executed from `req_review`, each increment `review_round` by one**: every time the evaluator signs off a conclusion in req_review, it counts as one round
- **Coverage and tc_policy**: "every AC has ≥ 1 TC" applies to `required` and to `optional` that goes through T03; ACs that cannot be automated use a manual TC;
  `optional` that goes through T03c, and `exempt`, do not write TCs — their ACs are verified by the RV's PASS and PR review (T03c additionally records evidence for each one in the `## req_impl_review` evidence column)
- **RV state binding**: a gate's RV section can only be written by that state's owner while the REQ is in that gate's corresponding state, and freezes once signed off; issues found within `pr_draft`
  are accepted by human-001 or sent back with T19 — the RV is not changed within `pr_draft` ([review-standard.md](review-standard.md) §4)
- A non-empty `pending_bugs` sets the whole REQ to `blocked` (T15); the commit subject has the same shape as other transitions: `lifecycle: T15 — REQ-… blocked by BUG-…`
- **`pending_bugs` and `linked_req` are two separate mechanisms**: `pending_bugs` registers BUGs that **sent this REQ back on review** (→ blocked);
  a BUG's `linked_req` only means "this BUG is carried and fixed by this REQ" — it does **not** automatically enter `pending_bugs`, and does **not** change status
- **Precondition for done**: while any BUG whose `linked_req` points at this REQ is not `closed` (any `bug_type`, `resolved` is not enough), this REQ must not be set to `done`,
  closed is set once verified by this REQ's T13 evaluator; this applies only to `lifecycle_schema: 2` REQs — old REQs follow the old rule (a `req_bug` that is not `resolved` / `closed`
  blocks done), historical BUGs are not migrated; the REQ also must not go to T14 while any TC is `failing` or `pending_bugs` is non-empty
- **Defects found after done**: the REQ is not reopened; the BUG records its origin via `origin_req`, and the fix is carried by a REQ that human-001 creates or designates (`linked_req`),
  a BUG never carries its own implementation; the carrying REQ must go through T03 (non-exempt; once `optional` carries a BUG it is bound to T03), bound to closing the BUG and the original TC at T02 / tc_design /
  T11 / T13 / T14 per the bug-standard §4 carrying process

## 5. Writing acceptance criteria (two tiers)

An acceptance item is one sentence, present tense, with an observable artifact — never write "correct", "good", or "efficient". Observable artifacts split into two tiers:

| Tier | Written where | Words allowed |
|---|---|---|
| Tier 1 | The REQ's Acceptance criteria and `acceptance` | Behavior, files, fields, logs, error class names (`ConfigError` / `ValidationError` / `InputFormatError`), GLOSSARY-registered field names and enum values, structural commitments like "consistent across the three surfaces" |
| Tier 2 | The design contract layer (§3) | Exit code and HTTP status values, CLI flag spelling, MCP tool names, canonical encodings, module and file paths, request/response model names — written once |

A TC is the verification tier and is not bound by this: it asserts concrete values as usual, taken from the design document's mapping.

✅ `When two BOMs at the same Location have different normalized P/Ns but the same Description, the report outputs a record with kind=PN_MISMATCH, listing the actual values from both plants`

✅ `A weight-configuration violation is rejected as ConfigError at config load, consistent across all three surfaces`

❌ `A weight-configuration violation is rejected as ConfigError (exit 2 / HTTP 500)` (the values belong to Tier 2)

❌ `BOM comparison works correctly` (not verifiable)

## 6. Relationship to GLOSSARY

Every business term appearing in a REQ must be a canonical term registered in [GLOSSARY.md](../GLOSSARY.md).
When a new term is needed, **change GLOSSARY first** (see REQ-PLAT-004) — otherwise the implementation phase inevitably ends up with two names for the same thing.

## 7. Review records and design plans

- **RV**: one review record per REQ, at `lifecycle/tasks/reviews/<scope>/RV-<PREFIX>-NNN.md`, one section per review gate, the evidence for state progression;
  an optional `## regression` section records deferred verification of sample-missing integration TCs after T13, and is not bound by the REQ's state. Format and rules are in
  [review-standard.md](review-standard.md).
- **PL** (optional): `lifecycle/tasks/plans/<scope>/PL-<PREFIX>-NNN.md`, created by the planner at T02, **only when** one of these holds: the REQ changes a design contract document under
  `docs/tools/<tool>/` or `docs/architecture/`; the product code touches more than two modules; a specification-type REQ (scope harness
  or docs) rewrites more than two specification or entry-point files. Frontmatter has only `pl_id`, `tool`, `linked_req`. Four sections: `## Contract changes` (pointers into the design document's changed sections, not a restatement of the fields), `## Module placement and slicing`, `## Test support` (needed fixture README entries), `## Risks and open technical points`. Whole document ≤ 6,000 characters.
- RV and PL share the REQ's number and **do not move when the REQ is archived**; link targets stay stable.
