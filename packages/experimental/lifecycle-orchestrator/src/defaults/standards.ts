/**
 * The English standards and the handbook `lifecycle_init` scaffolds under
 * `<lifecycleDir>/standards/` and `<lifecycleDir>/GUIDE.md`, translated from the
 * factory-tools originals. Text only; the loaders never read these.
 *
 * @module @deepseek-ai/dsh-experimental-lifecycle-orchestrator/defaults/standards
 */

/** Standard file name under `standards/` to its Markdown text. */
export const STANDARDS: Readonly<Record<string, string>> = {
  'requirement-standard.md': `# Requirement Standard (REQ specification)

## 0. Mandatory preflight protocol (HARD STOP)

**Before writing any code/documentation/artifact for a REQ, the agent must check the three items below; if any one is not satisfied, stop immediately and report to \`human-001\` — do not write anything.**

| # | Condition | How to check | Action on failure |
|---|---|---|---|
| C1 | REQ file exists | \`ls lifecycle/tasks/features/<scope>/REQ-<PREFIX>-NNN.md\` | Stop. Ask human-001 for the correct REQ ID |
| C2 | \`owner\` == your UID | \`grep '^owner:' …REQ-….md\` | Stop. This REQ belongs to another agent; do not overstep |
| C3 | \`status\` is a legal working state for your role | See table below | Stop. Report its current status |

The only transition exempt from C2/C3 is T19 (human-001 pulls back for a rewrite): its action is exactly to reclaim the owner, so it does not require already being the owner before execution. No such exception exists for agent transitions; T15 (set to blocked) is executed by the current owner, not a privilege. Two further kinds of actions are not REQ transitions and do not change the REQ, so they do not go through the REQ's three preflight checks: a regression run for deferred verification only updates the RV \`## regression\` section and TC status ([testcase-standard.md](testcase-standard.md) §4); BUG fixing and verification during REQ \`blocked\` start work on the strength of the BUG-level handoff (the fixer and the verifying evaluator each have their own set of checks, [bug-standard.md](bug-standard.md) §6). Changes to the original REQ's artifacts made within the carrying process ([bug-standard.md](bug-standard.md) §4) — the original TC's \`verifies\` and status, the original REQ's RV \`## regression\` line — are authorized by the carrying REQ's three preflight checks, with no separate exception.

### Legal working states per agent

This table, the per-role legal states derived from the [lifecycle.yml](lifecycle.yml) transition table, and the \`handles\` field of [agent-registry.yml](agent-registry.yml) are mutually consistent, checked by the gates ([GUIDE §6](GUIDE.md#6-gates)). What each role reads, writes, and delivers in each state is in [briefs.md](briefs.md).

| Agent | Legal \`status\` | What it does in that state |
|---|---|---|
| **planner-<NNN>** | \`req_review\` | Shapes the REQ into v2 body text; puts HOW into the design document; writes anything uncertain into Pending decisions |
| **generator-<NNN>** | \`tc_review\` | Reviews the TC text written by the evaluator; writes the conclusion in the RV |
| **generator-<NNN>** | \`tc_impl\` | Implements the TC code |
| **generator-<NNN>** | \`req_impl\` | Implements the requirement code; opens a draft PR from the review-package template once CI is green |
| **evaluator-<NNN>** | \`req_review\` | Reviews the requirement against CHK01–08; writes the conclusion and findings in the RV; passes or rejects |
| **evaluator-<NNN>** | \`tc_design\` | Writes the TC text under \`tasks/test-cases/<scope>/\` (sets the acceptance criteria, including verifies) |
| **evaluator-<NNN>** | \`tc_impl_review\` | Reviews the TC code written by the generator; writes the conclusion in the RV |
| **evaluator-<NNN>** | \`req_impl_review\` | Reviews the implementation; writes the conclusion and evidence in the RV; \`gh pr ready\` on pass |
| **human-<NNN>** | \`draft\` | Approves scope, sets \`req_review\` |
| **human-<NNN>** | \`req_review\` | Rules on Pending decisions (T18); pulls back for a rewrite (T19) |
| **human-<NNN>** | \`pr_draft\` | Reviews and merges a ready PR |
| **human-<NNN>** | \`done\` | No further action after archiving; the owner after T14 |
| **human-<NNN>** | \`blocked\` | Clears the block (T16); before T16 may redirect: non-exempt becomes self-carried and changes the restore target; exempt only changes the restore target to req_review and writes the ruling into the BUG; a fix that lives in another REQ has its \`linked_req\` set to that REQ — if that REQ has already left req_review, pull it back with T19 first (bug-standard §6) |

> 🔑 **The one who sets the standard ≠ the one who implements it**: \`tc_design\` (writing the TC text = setting the acceptance criteria) belongs to the **Evaluator**,
> \`tc_impl\` / \`req_impl\` (writing code) belongs to the **Generator**. Setting the standard and implementing it for the same artifact are held by different identities.
>
> The UIDs in the table represent roles: other instances of the same role (e.g. \`evaluator-002\` in a cross-vendor set) have the same legal working states; seat assignment is at the top of [briefs.md](briefs.md)
> (tc_impl_review goes to evaluator-001); gates and transition evidence check only the role.

## 1. File location and naming

- Path: \`lifecycle/tasks/features/<scope>/REQ-<PREFIX>-NNN.md\`, where \`NNN\` is a zero-padded three-digit sequence number
- The \`<scope>\` ↔ \`<PREFIX>\` mapping is in [tasks/id-scheme.yml](tasks/id-scheme.yml)
- On completion, move into \`lifecycle/tasks/archive/done/\`; the review record RV and design plan PL sharing the same number are **not moved** (§7)
- A REQ superseded by a new REQ before completing its lifecycle gets a \`superseded_by\` annotation field and a "Superseded record" section appended to its body, then
  moves into \`lifecycle/tasks/archive/superseded/\` (human-001 rules on this; archive is not scanned by req_lint)
- One REQ describes exactly **one independently acceptable** requirement; split an oversized requirement and link the parts with \`depends_on\`

## 2. Required frontmatter fields

\`\`\`yaml
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
\`\`\`

\`intent\` is a scalar: a REQ has exactly one intent, and the type is the constraint itself.
An absent \`lifecycle_schema\` means the legacy form, checked only via frontmatter; existing drafts convert to v2 in their own T02, archived files are not changed.

## 3. Body structure (lifecycle_schema: 2)

Exactly seven level-2 headings, order fixed; level-3 headings are allowed only inside Behavior. Budgets are counted in characters, not lines: take the raw text of the section from its heading line up to (not including) the next level-2 heading, including newlines and spaces, as returned by Python \`len\`.

| Section | Budget | Contents |
|---|---|---|
| \`## Goal\` | ≤ 800 | The expansion of intent: why, what, and what's different once it's done |
| \`## Behavior\` | ≤ 6,000 | Externally observable rules and invariants — only the context that sits above the acceptance items; **anything that can be written as an AC is written directly as an AC, no double-writing**. An optional \`### Assumptions and defaults\` subsection is allowed, reserved for default choices the agent makes on the human's behalf and assumptions about external dependencies |
| \`## Non-goals\` | ≤ 800, non-empty | States explicitly what is not being done, to prevent scope creep |
| \`## Acceptance criteria\` | ≤ 6,000; each item ≤ 240 (the whole line as written, including the \`- **AC-…** \` prefix, newline, and indentation) | \`- **AC-<PREFIX>-NNN-SS** …\`: globally unique numbering, prefix and sequence match the owning REQ; one sentence, present tense, an observable artifact; use the three-part "given …, when …, then …" form when preconditions need spelling out; numbers are stable and never reused — deleted items leave their number retired; cross-REQ references cite the other REQ's number directly |
| \`## Pending decisions\` | ≤ 1,200 | \`- **Q-01** (proposer, date) question? \\| option A / B / C \\| default A \\| deadline YYYY-MM-DD\`; this section must read exactly \`None\` once status leaves \`req_review\` |
| \`## Design references\` | ≤ 1,000 | ADRs, \`docs/tools/<tool>/NN-*.md#anchor\`, GLOSSARY entries, PL files; links must resolve to an existing file or anchor; **HOW lexicon is allowed only in this section** |
| \`## Bug History\` | None | Records of T15 / T16 / T19 |

Whole document (excluding frontmatter) ≤ 14,000 characters. Banned headings: Background, Requirement description, Revision history, Review record, Notes, Implementation slices. Revision history lives in git, review lives in the RV (§7), implementation slices live in the PL (§7), design rationale lives in an ADR or design document.

### HOW lexicon

Applies to \`acceptance\`, \`intent\`, and every section except Design references. A match is a violation; the regex constants live in \`req_lint\` (the rule bodies are in \`harness_rules.py\` in the same directory), this table is a mirror, and the gates check the two item-for-item ([GUIDE §6](GUIDE.md#6-gates)).

| Category | Regex |
|---|---|
| Code paths | \`\\b(src\\|tests\\|tools\\|libs\\|services)/\\S+\\.(py\\|yaml\\|json)\\b\`, \`::\` |
| CLI flags | \`(?<![\\w-])--[a-z][a-z0-9-]*\` |
| Exit codes / HTTP | \`\\bexit\\s*\\d\`, \`exit code\\s*\\d\`, \`\\bHTTP\\s*\\d{3}\`, \`(?<![\\d,.])\\b(422\\|500)\\b(?![\\d,.]\\|\\s*(rows\\|items\\|lines\\|copies\\|entries\\|characters))\` |
| Request/response model names | \`\\b[A-Z][A-Za-z]+(Request\\|Response)\\b\` |
| Code fences | \`\`\` fences forbidden outside Design references |

Allowed: GLOSSARY-registered field names and enum values inside backticks, error class names (\`ConfigError\` / \`ValidationError\` / \`InputFormatError\`), ADR and documentation links.

### Design contract layer

\`docs/tools/<tool>/NN-*.md\` and \`docs/architecture/\` are the sole home for HOW: field tables, canonical encodings, CLI / HTTP / MCP shapes,
the mapping from error classes to exit codes and HTTP statuses, module placement. Two rules:

- the planner changes the design document and the REQ **in the same T02 commit**;
- a design document may note "sourced from REQ-xxx", but **must not** carry a normative rule via "rule is in REQ-xxx".

## 4. Lifecycle

\`\`\`
draft → req_review ⇄ tc_design → tc_review ⇄ tc_impl → tc_impl_review
      → req_impl → req_impl_review → pr_draft → done
any state →(blocked by a BUG)→ blocked →(BUG closed)→ restores to the original state
\`\`\`

\`tc_policy\` decides the exit from req_review:

| tc_policy | Exit | Path |
|---|---|---|
| \`required\` | T03 | Full path, TC covers every AC |
| \`optional\`, evaluator judges TC needed | T03 | Full path, same as \`required\`: TC covers every AC, ACs that cannot be automated use a manual TC with \`automated: false\` (testcase-standard §4) |
| \`optional\`, evaluator judges the TC waived, and no BUG's \`linked_req\` points at this REQ | T03c | \`draft → req_review → req_impl → req_impl_review → pr_draft → done\`; the RV \`## req_review\` states the TC waiver reason. When a BUG's \`linked_req\` points at this REQ, the TC cannot be waived — only T03 is allowed (a carrying REQ can only take T03, bug-standard §4) |
| \`exempt\` (pure specification/documentation, must have \`exempt_reason\`) | T03b | \`draft → req_review → pr_draft → done\`; the planner opens a draft PR in T02 and fills in \`pr_number\`, the evaluator runs \`gh pr ready\` at T03b. An exempt REQ must not carry: any BUG whose \`linked_req\` points at it is a violation |

The exit table and the transition table below are both mirrors of [lifecycle.yml](lifecycle.yml): the gates check that the exit table's (tc_policy, exit) and the transition table's #, From, Actor, To, Owner after columns are item-for-item consistent; the Event column is prose and is not compared ([GUIDE §6](GUIDE.md#6-gates)).

### Transition table

| # | From | Actor | Event | To | Owner after |
|---|---|---|---|---|---|
| T01 | \`draft\` | human-<NNN> | Approves scope (a draft already meeting §3 may be set directly to \`lifecycle_schema: 2\`) | \`req_review\` | planner-<NNN> |
| T02 | \`req_review\` | planner-<NNN> | Body shaped per §3 and set to \`lifecycle_schema: 2\`; HOW put into the design document in the same commit; Pending decisions is None or lists items; opens a draft PR and fills in \`pr_number\` when \`exempt\` | \`req_review\` | evaluator-<NNN> |
| T03 | \`req_review\` | evaluator-<NNN> | Review passes, \`required\` or \`optional\` and TC needed: RV \`## req_review\` PASS, Pending decisions == None | \`tc_design\` | evaluator-<NNN> |
| T03b | \`req_review\` | evaluator-<NNN> | Review passes and \`exempt\`, and no BUG's \`linked_req\` points at this REQ (exempt must not carry): RV \`## req_review\` PASS; \`gh pr ready\` | \`pr_draft\` | human-<NNN> |
| T03c | \`req_review\` | evaluator-<NNN> | Review passes, \`optional\` and TC waived, and no BUG's \`linked_req\` points at this REQ (a carrying REQ can only take T03): RV \`## req_review\` PASS and states the TC waiver reason | \`req_impl\` | generator-<NNN> |
| T04 | \`req_review\` | evaluator-<NNN> | Review sends back: RV \`## req_review\` conclusion REJECT + findings table, \`review_round\` incremented by one; a BUG is attached only when the requirement defect needs a separate REQ to carry it | \`req_review\` | planner-<NNN> |
| T05 | \`tc_design\` | evaluator-<NNN> | TC text is ready (with \`verifies\`, covering every AC) | \`tc_review\` | generator-<NNN> |
| T06 | \`tc_review\` | generator-<NNN> | TC text is accepted: RV \`## tc_review\` PASS; every TC whose \`linked_req\` is this REQ has its \`status\` → reviewed (except the original TC of a carried BUG) | \`tc_impl\` | generator-<NNN> |
| T07 | \`tc_review\` | generator-<NNN> | TC text disputed: RV \`## tc_review\` REJECT | \`tc_design\` | evaluator-<NNN> |
| T08 | \`tc_impl\` | generator-<NNN> | TC code is ready; a manual TC has no code written for it, and Implementation location states manual | \`tc_impl_review\` | evaluator-<NNN> |
| T09 | \`tc_impl_review\` | evaluator-<NNN> | TC code passes: RV \`## tc_impl_review\` PASS; a manual TC is checked only for whether its steps are executable | \`req_impl\` | generator-<NNN> |
| T10 | \`tc_impl_review\` | evaluator-<NNN> | TC code sent back: RV \`## tc_impl_review\` REJECT | \`tc_impl\` | generator-<NNN> |
| T11 | \`req_impl\` | generator-<NNN> | Implementation ready + CI green; opens a draft PR from the review-package template and fills in \`pr_number\`; reuses \`pr_number\` if one already exists, does not open a new one; every carried BUG (\`linked_req\` points at this REQ) is resolved | \`req_impl_review\` | evaluator-<NNN> |
| T12 | \`req_impl_review\` | evaluator-<NNN> | Implementation sent back: RV \`## req_impl_review\` REJECT; failing TCs set to failing | \`req_impl\` | generator-<NNN> |
| T13 | \`req_impl_review\` | evaluator-<NNN> | Implementation passes: RV \`## req_impl_review\` PASS; TCs get their status set per the result matrix in testcase-standard §4, none failing, sample-missing skips are individually listed as Deferred verification (carried-BUG TCs missing samples do not get T13 signed off, the conclusion line reads AWAITING SAMPLE); manual TCs are executed by the evaluator; carried BUGs, once verified, are all set to closed and their original TC to passing (bug-standard §4 carrying process); update the PR evidence line, \`gh pr ready\` | \`pr_draft\` | human-<NNN> |
| T14 | \`pr_draft\` | human-<NNN> | Merge the PR (no failing TC, \`pending_bugs\` empty, all carried BUGs closed); the REQ moves to \`archive/done/\`, RV / PL / TC do not move | \`done\` | human-<NNN> |
| T15 | Any review state or \`pr_draft\` | current owner | Used instead of an ordinary send-back when a defect needs a separate BUG to carry it: create a single BUG (with \`blocks_req\`), register \`pending_bugs\`, write \`blocked_reason\` and the restore target; a BUG whose fix needs changes to this REQ's body, TC text, or an added TC self-carries: \`linked_req\` set to this REQ, restore target \`req_review\` / planner (exempt does not self-carry, it goes through T04 / T17; bug-standard §4); \`review_round\` is incremented by one when executed from \`req_review\`; when executed by human-001 within \`pr_draft\`, used for a failed deferred verification, does not change the review gate section, restore target req_impl / generator; the contract is in briefs "Blocking and clearing" | \`blocked\` | human-<NNN> |
| T16 | \`blocked\` | human-<NNN> | All \`pending_bugs\` are closed, self-carried ones are resolved (per BUG-level handoff and the carrying process, bug-standard §6 / §4): restore and clear the blocking fields, Bug History records one line for the clearing (not a precondition of the BUG's own closing); when the restore target is \`req_review\`, every TC whose \`linked_req\` is this REQ goes back to draft, carried BUGs already closed go back to resolved, and lines in the original REQ's RV \`## regression\` referencing this REQ's TCs are withdrawn together | Restores \`blocked_from_status\` | Restores \`blocked_from_owner\` |
| T17 | \`req_review\` | planner-<NNN> | Pending decisions is non-empty, needs human-001 to rule | \`req_review\` | human-<NNN> |
| T18 | \`req_review\` | human-<NNN> | Ruling written back into Behavior / Acceptance criteria text, Pending decisions set to None | \`req_review\` | planner-<NNN> |
| T19 | Any (except \`done\` / \`blocked\`) | human-<NNN> | Pull back for a rewrite, no BUG attached; Bug History records one line; the only transition exempt from C2/C3; a REQ that already has a PR reverts to draft; every TC whose \`linked_req\` is this REQ goes back to \`draft\`, carried BUGs already closed go back to resolved, and lines in the original REQ's RV \`## regression\` referencing this REQ's TCs are withdrawn together (the original TC itself is untouched, testcase-standard §4) | \`req_review\` | planner-<NNN> |

- A backward state move (⇄) is **triggered only by a review send-back or T19**; a send-back must leave a findings table in the RV
- Each transition is executed by the current owner, and after producing its output, hands off to the next owner per the transition table; the sole exception is T19, where human-001 need not be the owner
- **Review records are written only in the RV** (§7). The transition commit subject is \`lifecycle: T<NN> — one sentence\`, body ≤ 10 lines, recording only
  \`status: a → b; owner: x → y; review record: RV-…#<gate>\`. The subject shape of each transition, the guard on the pre-transition tree, and the effect on the diff are registered in
  [lifecycle.yml](lifecycle.yml); CI checks them commit-by-commit along the PR's first-parent commit chain (transition evidence, [GUIDE §6](GUIDE.md#6-gates)); the full effect of one transition must land in
  the same transition commit — splitting it into multiple commits is a violation, and a mistake can only be fixed by rewriting that commit
- **Non-transition events**: a commit that does not change REQ status / owner must not change a lifecycle-sensitive object (REQ lifecycle fields, TC status, the status of an existing BUG, an RV gate section's conclusion line),
  unless the subject is one of the registered events — \`fix: BUG-…\`, \`verify: BUG-…\`, \`lifecycle: regression —\`, \`lifecycle: external review —\`, \`lifecycle: redirect —\` (human-001 changing the restore target before T16) — and the diff matches its effect; creating a new BUG file is not restricted by this.
  The event list, subjects, and effects are governed by the events section of [lifecycle.yml](lifecycle.yml); this bullet and the narrative in briefs are mirrors of it
- **Pending decisions must be empty before T03 / T03b / T03c**: TC text and implementation must not target unresolved questions; anything that can be registered as a Q while the REQ is still in req_review must not be left for the
  Pending human-001 line in the PR — that line lists only things generator / evaluator discover after the REQ has left req_review, for human-001 to accept in pr_draft or pull back with T19
- **T03 / T03b / T03c / T04, and T15 executed from \`req_review\`, each increment \`review_round\` by one**: every time the evaluator signs off a conclusion in req_review, it counts as one round
- **Coverage and tc_policy**: "every AC has ≥ 1 TC" applies to \`required\` and to \`optional\` that goes through T03; ACs that cannot be automated use a manual TC;
  \`optional\` that goes through T03c, and \`exempt\`, do not write TCs — their ACs are verified by the RV's PASS and PR review (T03c additionally records evidence for each one in the \`## req_impl_review\` evidence column)
- **RV state binding**: a gate's RV section can only be written by that state's owner while the REQ is in that gate's corresponding state, and freezes once signed off; issues found within \`pr_draft\`
  are accepted by human-001 or sent back with T19 — the RV is not changed within \`pr_draft\` ([review-standard.md](review-standard.md) §4)
- A non-empty \`pending_bugs\` sets the whole REQ to \`blocked\` (T15); the commit subject has the same shape as other transitions: \`lifecycle: T15 — REQ-… blocked by BUG-…\`
- **\`pending_bugs\` and \`linked_req\` are two separate mechanisms**: \`pending_bugs\` registers BUGs that **sent this REQ back on review** (→ blocked);
  a BUG's \`linked_req\` only means "this BUG is carried and fixed by this REQ" — it does **not** automatically enter \`pending_bugs\`, and does **not** change status
- **Precondition for done**: while any BUG whose \`linked_req\` points at this REQ is not \`closed\` (any \`bug_type\`, \`resolved\` is not enough), this REQ must not be set to \`done\`,
  closed is set once verified by this REQ's T13 evaluator; this applies only to \`lifecycle_schema: 2\` REQs — old REQs follow the old rule (a \`req_bug\` that is not \`resolved\` / \`closed\`
  blocks done), historical BUGs are not migrated; the REQ also must not go to T14 while any TC is \`failing\` or \`pending_bugs\` is non-empty
- **Defects found after done**: the REQ is not reopened; the BUG records its origin via \`origin_req\`, and the fix is carried by a REQ that human-001 creates or designates (\`linked_req\`),
  a BUG never carries its own implementation; the carrying REQ must go through T03 (non-exempt; once \`optional\` carries a BUG it is bound to T03), bound to closing the BUG and the original TC at T02 / tc_design /
  T11 / T13 / T14 per the bug-standard §4 carrying process

## 5. Writing acceptance criteria (two tiers)

An acceptance item is one sentence, present tense, with an observable artifact — never write "correct", "good", or "efficient". Observable artifacts split into two tiers:

| Tier | Written where | Words allowed |
|---|---|---|
| Tier 1 | The REQ's Acceptance criteria and \`acceptance\` | Behavior, files, fields, logs, error class names (\`ConfigError\` / \`ValidationError\` / \`InputFormatError\`), GLOSSARY-registered field names and enum values, structural commitments like "consistent across the three surfaces" |
| Tier 2 | The design contract layer (§3) | Exit code and HTTP status values, CLI flag spelling, MCP tool names, canonical encodings, module and file paths, request/response model names — written once |

A TC is the verification tier and is not bound by this: it asserts concrete values as usual, taken from the design document's mapping.

✅ \`When two BOMs at the same Location have different normalized P/Ns but the same Description, the report outputs a record with kind=PN_MISMATCH, listing the actual values from both plants\`

✅ \`A weight-configuration violation is rejected as ConfigError at config load, consistent across all three surfaces\`

❌ \`A weight-configuration violation is rejected as ConfigError (exit 2 / HTTP 500)\` (the values belong to Tier 2)

❌ \`BOM comparison works correctly\` (not verifiable)

## 6. Relationship to GLOSSARY

Every business term appearing in a REQ must be a canonical term registered in [GLOSSARY.md](../GLOSSARY.md).
When a new term is needed, **change GLOSSARY first** (see REQ-PLAT-004) — otherwise the implementation phase inevitably ends up with two names for the same thing.

## 7. Review records and design plans

- **RV**: one review record per REQ, at \`lifecycle/tasks/reviews/<scope>/RV-<PREFIX>-NNN.md\`, one section per review gate, the evidence for state progression;
  an optional \`## regression\` section records deferred verification of sample-missing integration TCs after T13, and is not bound by the REQ's state. Format and rules are in
  [review-standard.md](review-standard.md).
- **PL** (optional): \`lifecycle/tasks/plans/<scope>/PL-<PREFIX>-NNN.md\`, created by the planner at T02, **only when** one of these holds: the REQ changes a design contract document under
  \`docs/tools/<tool>/\` or \`docs/architecture/\`; the product code touches more than two modules; a specification-type REQ (scope harness
  or docs) rewrites more than two specification or entry-point files. Frontmatter has only \`pl_id\`, \`tool\`, \`linked_req\`. Four sections: \`## Contract changes\` (pointers into the design document's changed sections, not a restatement of the fields), \`## Module placement and slicing\`, \`## Test support\` (needed fixture README entries), \`## Risks and open technical points\`. Whole document ≤ 6,000 characters.
- RV and PL share the REQ's number and **do not move when the REQ is archived**; link targets stay stable.
`,
  'testcase-standard.md': `# Test Case Standard (TC specification)

## 1. File location and naming

- Path: \`lifecycle/tasks/test-cases/<scope>/TC-<PREFIX>-NNN-SS.md\`
- \`NNN\` = the number of the associated REQ; \`SS\` = the test-case sequence number under that REQ (starting at \`01\`)
- Example: \`lifecycle/tasks/test-cases/canonical-bom/TC-CBOM-003-01.md\` is associated with \`REQ-CBOM-003\`

## 2. Frontmatter

\`\`\`yaml
---
tc_id: TC-CBOM-003-01     # must match the filename
tool: canonical-bom       # must match the containing directory
linked_req: REQ-CBOM-003
verifies: [AC-CBOM-003-01, AC-CBOM-003-02]   # the global AC numbers this verifies; required when linked_req is a v2 REQ
title: "One-sentence test-case title"
status: draft             # draft (tc_design) → reviewed (T06) → implemented (T08, automated) → passing (can sign T13) | failing (T12 / T15); see §4 for the result matrix
level: unit               # unit | integration | e2e
owner: evaluator-001      # must be a registered UID
automated: true           # false = manual TC: body writes out executable steps for a human, lifecycle in §4
---
\`\`\`

## 3. Body structure

\`\`\`markdown
## Preconditions   ≤ 1,500 characters; fixture tables, hand-computed anchor values, and version chains go in the fixtures directory's README — link here, don't copy
## Steps           numbered list, one action per step
## Expected results   each item starts with an AC number: \`- AC-CBOM-003-01: …\`, do not restate the REQ's original text
## Implementation location   for automated cases, the test code path (pytest node id)
\`\`\`

Whole document ≤ 4,000 characters. When the example text itself contains a backtick, wrap it in double backticks (CommonMark's equal-length pairing); the gates judge by visible lines.

## 4. Conventions

### Who writes the TC text

**The Evaluator**, in the \`tc_design\` state. The TC text is the executable form of the acceptance criteria —
letting the implementer set their own standard would lose independence. In \`tc_review\` the Generator is only responsible for accepting the text or raising an objection, with the conclusion written in the RV;
on acceptance (T06) it sets the \`status\` of every TC whose \`linked_req\` is this REQ to \`reviewed\`, and on objection (T07) it leaves them unchanged. The status of a carried BUG's original TC is outside the
scope of T06 / T08, and is changed only in req_impl_review by the evaluator per the result matrix; for an original TC whose text tc_design has changed, the test code at its "Implementation location" is
updated along with the text by the carrying REQ's generator at T08, and reviewed together at T09; the T-group of tc_review and the §3 budget are judged only against TCs whose \`linked_req\` is this REQ — an
original TC is checked only for whether \`verifies\` resolves and has a matching assertion for the carried AC, and its legacy-form text is not rewritten (bug-standard §4).
When a REQ returns to \`req_review\` (pulled back by T19, or restored to req_review by T16), every TC whose \`linked_req\` is this REQ goes back to \`draft\`: both the text acceptance and the real-run evidence
assumed the REQ as it stood at the time, so after the REQ is rewritten they go through T06 / T08 / T13 again; the original TC is untouched. Any carried BUG already closed at that T13 goes back to resolved
together with it (the evidence for closed was the TC being passing, and that evidence no longer holds once the TC goes back to draft), to be set to closed again by the re-run T13. Lines in the original REQ's
RV \`## regression\` referencing these TCs are withdrawn together (their evidence likewise no longer holds), to be recorded again when T13 is re-run.

### REQ state and allowed TC status

A TC whose \`linked_req\` is a v2 REQ can only have its \`status\` land within the set allowed by the REQ's current state (for \`blocked\`, judged by the restore target). This table mirrors
[lifecycle.yml](lifecycle.yml)'s \`tc_status_by_state\`, checked by the gates.

| REQ state | Allowed TC status |
|---|---|
| \`draft\`, \`req_review\`, \`tc_design\`, \`tc_review\` | \`draft\` |
| \`tc_impl\`, \`tc_impl_review\` | \`reviewed\`, \`implemented\` |
| \`req_impl\`, \`req_impl_review\` | \`reviewed\`, \`implemented\`, \`passing\`, \`failing\` |
| \`pr_draft\`, \`done\` | \`implemented\`, \`passing\`, \`failing\` |

### Granularity: n : m

One TC per test module or scenario group, which may verify multiple ACs; every AC has at least one TC, and every TC verifies at least one AC.
Coverage is declared by \`verifies\`, checked by the gates ([GUIDE §6](GUIDE.md#6-gates)); coverage is connected globally by AC number — any TC whose \`verifies\` lists that number counts as coverage,
and an original TC's \`verifies\` may hold ACs from both its \`linked_req\` and the carrying REQ at once (bug-standard §4). This rule applies to \`tc_policy: required\` and to
\`optional\` judged in req_review to need a TC; an AC that cannot be automated is covered by a manual TC with \`automated: false\`, never left uncovered. \`optional\` that has waived TC (T03c), and \`exempt\`,
do not write TCs — their ACs are verified by the RV's PASS and PR review. Do not write one file per AC: of REQ-CBOM-019's 29 TCs,
24 restated the acceptance text verbatim — that is exactly the pattern this rule exists to eliminate.

### Manual TC (\`automated: false\`)

An AC that cannot be automated is covered by a manual TC. It follows the same path as an automated TC (tc_design → tc_review → tc_impl → tc_impl_review →
req_impl → req_impl_review), with only three differences:

- \`## Implementation location\` always reads "Manual: results recorded in the RV \`## req_impl_review\` evidence column", not a pytest node id;
- at T08 the generator writes no code for it, and status stays at \`reviewed\`; at T09 the evaluator checks only that the steps are executable and the expected results are decidable;
- at req_impl_review the evaluator **executes the steps in person**, writes the results and key figures into the RV \`## req_impl_review\` Evidence column, and sets
  status per the table below. The executor must be the evaluator — the generator cannot self-report.

### The req_impl_review result matrix

In req_impl_review the evaluator can only place each TC in one row of the table below; the precondition for T13 is that no TC is failing, and every
skip from the implementation-first period has converted to passing.

| TC result | status | Effect on the transition |
|---|---|---|
| Automated TC actually runs and passes | \`passing\` | Can sign T13 |
| Automated TC actually runs and fails | \`failing\` | Cannot T13; goes through T12 to send back, or T15 when a separate BUG is needed |
| Integration TC cleanly skipped for missing real samples (\`@pytest.mark.integration\` and the environment variable unset) | Stays \`implemented\`, RV Evidence column records "Deferred verification: TC-…" | Can sign T13; afterward follows the "Deferred verification" regression run below, no longer going through the REQ lifecycle. Except for TCs listed on a carried BUG: while samples are missing they keep their original status and do not get T13 signed off — missing samples alone is not grounds for T12, the conclusion line reads AWAITING SAMPLE (bug-standard §4) |
| Manual TC executed and passes | \`passing\` | Can sign T13 |
| Manual TC executed and fails | \`failing\` | Cannot T13; goes through T12 or T15 |

After a T12 send-back the generator fixes it; when it re-enters req_impl_review the evaluator reruns it and resets status per this table.

### Deferred verification (regression runs for sample-missing integration TCs)

Real samples do not go into the repository and CI never has them, so a sample-missing skip is allowed to pass T13, but what follows it does not go through the REQ lifecycle — it is a **regression run**:

- **Executor**: any evaluator-*, executed once samples are available, not required to hold the REQ. A regression run is not a REQ transition and does not go through the three preflight checks.
- **Evidence**: written into the RV's optional \`## regression\` section, keeping only the most recent run's line per TC (date, UID, sample identifier, TC number, result), updated
  in place, with history in git; this section is ≤ 2,500 characters. \`## regression\` is the only RV section not bound to a state; it does not change other sections.
- **status**: pass → the TC is set to \`passing\`; fail → set to \`failing\`.
- **Handling a failure**: the regression evaluator only records the \`## regression\` line and the TC status and notifies human-001 — it does not file a BUG and does not change any review gate section. The BUG is filed by human-001
  (\`bug_type: impl_bug\`, \`found_in: regression\`, \`test_case_ref\` pointing at the failing TC), split by the REQ's state into two cases:
  - REQ in \`pr_draft\`: the BUG has \`blocks_req: [that REQ]\`, human-001, as the owner of pr_draft, executes T15 (\`blocked_from_status:
    req_impl\`, \`blocked_from_owner: generator\`); fixing and verification go through the BUG-level handoff (bug-standard §6); once all BUGs are closed, T16 returns to req_impl
    and re-runs T11 → T13, with T11 reusing the existing \`pr_number\`. A REQ with a failing TC must not go to T14.
  - REQ in \`done\`: not reopened. The BUG has \`origin_req: that REQ\`, \`linked_req\` left empty, to be created or designated by human-001 with a carrying REQ (which must not yet have left
    req_review and must not be exempt — once \`optional\` carries a BUG it is bound to T03) and backfilled; it is then bound following the bug-standard §4 carrying process: the carrying REQ's T02 adds the AC,
    tc_design pulls the AC into the original TC's verifies, T11 requires the BUG resolved beforehand, T13 runs the original TC, sets it closed and passing, and records passed in this RV's \`## regression\`
    (when this RV exists); T14 is blocked until all are closed. A BUG never carries its own implementation.
- **Unclosed BUG takes priority**: when the same TC has an unclosed regression BUG, a subsequent passing run must not set status back to \`passing\`; the \`## regression\` line records
  "passed (BUG-… not yet closed)"; it is set to \`passing\` only once the BUG is closed. A failing run likewise only records the \`## regression\` line and failing, and notifies — no new BUG is filed; while the carrying REQ awaits samples
  its evaluator may sign T12 / T13 using this line as evidence (bug-standard §4).
- **Precondition**: a REQ's deferred-verification TCs at T13 must be listed one by one in the RV Evidence column; this rule does not apply to implementation-first-period skips.

### Fixture discipline

- **Real product BOMs do not go into the repository**. Tests use only synthetic data under \`tools/<tool>/tests/fixtures/\`.
- A synthetic fixture must ship with a \`README.md\` explaining **which expected result each planted anomaly corresponds to**,
  otherwise six months later no one will know whether a strange reference designator was deliberate or a slip. A TC's preconditions only link to this README, never copy it.
- A case that needs a real sample to verify gets \`level: integration\` plus \`@pytest.mark.integration\`,
  and registers this external dependency in the REQ's body.

### Two-stage review when tests come first

When the component under test has not yet landed (tests come first, and a missing module means \`skip\`):

- \`tc_impl_review\` **reviews only whether the code is truthful** — that the test, once its module is ready, will genuinely assert the properties it declares
  (the right object is scanned, the asserted relationship holds, fixtures are legitimate, no fabricated input or false green), and skips cleanly when the environment is missing.
  This stage **does not require an actual passing run**.
- **"Actual-run evidence" belongs to \`req_impl_review\`** — once the implementation has landed, a \`skip\` from the implementation-first period must convert to \`passing\` before T13 can be signed; the only skip allowed to remain
  after T13 is an integration TC missing real samples (row three of the result matrix, which then follows Deferred verification).

Precondition: cases gate at the top level with \`importorskip\` / \`skipif\`, not disguising "missing test support" as passing.
A review send-back should target "the code is not truthful," not "it doesn't run in the current environment."

### Regression convention

A BUG with severity \`high\` / \`critical\` must have a TC covering it before it closes, with the BUG's and REQ's \`test_case_ref\` backfilled: a regression BUG uses the original TC,
never a new one; one without TC coverage must have a \`linked_req\`, and the TC is added at the carrying REQ's tc_design (bug-standard §4 / §5). The sole exception: a
\`req_bug\` blocking an exempt REQ whose fix content is only that exempt REQ's body text or a human ruling closes on the strength of the ruling and PR review (bug-standard §4 carrying eligibility); a
\`bug_type\` other than that, blocking an exempt REQ, is not within the exception and follows this rule by severity as usual.

### Automated test stack

\`pytest\`. Consistency across the three surfaces (CLI / HTTP / MCP produce the same result for the same input) is a **structural contract**,
and every tool must have a corresponding test case — see
\`tools/canonical-bom/tests/unit/test_surfaces.py\` for reference.
`,
  'review-standard.md': `# Review Standard (RV review record specification)

Review evidence has exactly one destination: one review record per REQ. Commit bodies, REQ text, and PR comments no longer carry review prose.

## 1. Location and naming

- Path: \`lifecycle/tasks/reviews/<scope>/RV-<PREFIX>-NNN.md\`, sharing the REQ's number
- Created by the evaluator on the first round in \`req_review\`; the RV does not move when the REQ is archived

## 2. Frontmatter

\`\`\`yaml
---
rv_id: RV-CBOM-021        # must match the filename
tool: canonical-bom       # must match the containing directory
linked_req: REQ-CBOM-021
---
\`\`\`

There is no owner field: whoever holds the corresponding review state writes the corresponding section.

## 3. Body

One level-2 heading per review gate; only these six are allowed: \`## req_review\`, \`## tc_review\` (written by generator), \`## tc_impl_review\`,
\`## req_impl_review\`, \`## external_review\` (optional, an out-of-repo review transcribed by human-001 or an evaluator), \`## regression\` (optional, the record of deferred-verification regression runs,
see [testcase-standard.md](testcase-standard.md) §4). The first five each have fixed fields, in a fixed order:

\`\`\`
Conclusion: PASS | REJECT (round N, YYYY-MM-DD, <uid>); \`## req_impl_review\` has one additional unsigned-off form, AWAITING SAMPLE (YYYY-MM-DD, <uid>), see §4 state binding
Fixed items: (req_review section only)
- [ ] CHK01 No implementation detail: no HOW-lexicon hits in the body, intent, or acceptance
- [ ] CHK02 Every AC is one sentence, present tense, an observable artifact
- [ ] CHK03 Behavior and Acceptance criteria do not double-write the same rule
- [ ] CHK04 Every business term is a GLOSSARY canonical word
- [ ] CHK05 Non-goals is non-empty and consistent with depends_on and neighboring REQ boundaries
- [ ] CHK06 Pending decisions == None
- [ ] CHK07 No restating of the contract; the design documents this REQ touches contain no "rule is in REQ"
- [ ] CHK08 CLAUDE.md §2's five disciplines checked one by one
Review scope: commits and files checked
Evidence: ≤ 5 items of data (tests passed/skipped, gates, real samples, worktree comparison; the req_impl_review section additionally holds the per-item verification results for manual TCs and TC-waived ACs, plus a "Deferred verification: TC-…" list)
Findings:
| # | Location | Finding | severity | confidence | Disposition |
|---|---|---|---|---|---|
Pending human-001: None | Matters
\`\`\`

## 4. Rules

- **Report everything**: every finding carries a severity (blocker / major / minor / nit) and a confidence (high / medium / low), unfiltered by level —
  the call on what to keep belongs to human-001.
- **Rewritten in place**: a section always shows only the latest round; fixed findings are deleted, and the conclusion line records the round. History lives in git. \`## regression\` is likewise updated in place: each TC
  keeps only the line for its most recent run.
- **Signing role**: the conclusion of each RV gate section can only be signed by a UID of the role in the table below, checked by the gates ([GUIDE §6](GUIDE.md#6-gates)). This table mirrors [lifecycle.yml](lifecycle.yml)'s
  \`gates\`, compared row by row as a closed set per RV section.

  | RV section | Signing role |
  |---|---|
  | \`## req_review\` | evaluator |
  | \`## tc_review\` | generator |
  | \`## tc_impl_review\` | evaluator |
  | \`## req_impl_review\` | evaluator |

- **State binding**: a gate's section can only be written while the REQ is in that gate's corresponding state and the writer is that state's owner (the three preflight checks hold). Once the conclusion is signed off, the section
  freezes until the REQ enters that state again. A problem found within \`pr_draft\` after sign-off is decided by human-001: accept it and note it in the PR, or pull back for re-review with T19;
  the RV is not changed within \`pr_draft\`, and a reviewer does not re-sign outside their own state. The one unsigned-off form is the sample wait in the carrying process (bug-standard §4):
  while the REQ sits in \`req_impl_review\`, the \`## req_impl_review\` conclusion line reads "AWAITING SAMPLE (date, UID)" — this is not a sign-off, does not freeze the section, and does not satisfy "PASS
  before advancing"; once the sample arrives, the same state's owner changes it in place to PASS or REJECT. The sole exception is \`## regression\`: any evaluator-* may update it at any time,
  recording only two kinds of results — a deferred-verification regression run, and a passed recorded by the carrying REQ's evaluator once the carrying process's T13 verification passes (bug-standard §4;
  when the original REQ has no RV, none is created for it — the evidence lands in the carrying REQ's RV) — without changing other sections. The timing of a gate section's changes (whether it was changed by the transition commit of the corresponding state, and whether the conclusion matches the declared transition)
  is checked by transition evidence along the PR's commit chain ([GUIDE §6](GUIDE.md#6-gates)).
- **The external_review section**: optional, not bound to a state, changed only by a \`lifecycle: external review —\` event commit; when present, every row of the findings table has a non-empty Disposition, and the conclusion line is signed by human-001 or an
  evaluator role. Under a cross-vendor provider set, the implementation review itself is already carried by an evaluator from a different vendor, so no separate mandatory external-review step is imposed (ADR-011).
- **Rounds**: a REQ's \`review_round\` = the number of times the evaluator signs off a conclusion (PASS or REJECT) in \`req_review\`: T03 / T03b / T03c / T04,
  and a REJECT via T15 in place of T04 from \`req_review\`, each add one; the round in the RV conclusion line matches it. A conclusion written outside a review state does not count toward the round,
  and must not remain in the file.
- **PASS before advancing**: for status to enter a state in the left column below, the corresponding RV section must already be PASS.

  | State entered | \`required\` / \`optional\` with TC | \`optional\` TC waived (T03c) | \`exempt\` (T03b) |
  |---|---|---|---|
  | \`tc_design\` | \`## req_review\` | not applicable | not applicable |
  | \`tc_impl\` | \`## tc_review\` | not applicable | not applicable |
  | \`req_impl\` | \`## tc_impl_review\` | \`## req_review\`, including the TC waiver reason | not applicable |
  | \`pr_draft\`, \`done\` | \`## req_impl_review\` | \`## req_review\` + \`## req_impl_review\` | \`## req_review\` |

  This table mirrors [lifecycle.yml](lifecycle.yml)'s \`pass_to_enter\`, checked item-for-item by the gates; not applicable = the empty set.

  For a TC-waived REQ, the verification evidence for every AC is written into the \`## req_impl_review\` Evidence column (manual verification, gate output, real samples),
  standing in for actual TC-run figures.
- **Budget**: each section ≤ 2,500 characters, whole document ≤ 12,000; \`## regression\` is separately ≤ 2,500 characters, one line per TC, and does not count toward the whole-document budget. Method narration is not kept —
  only the conclusion, scope, figures, and findings remain.
- **Transition commit**: subject \`lifecycle: T<NN> — one sentence\`, body ≤ 10 lines, recording only \`status: a → b; owner: x → y; review record: RV-…#<gate>\`;
  the RV section's changes and the status / owner changes are in the same transition commit.
- The PR review package (\`.github/pull_request_template.md\`) links to the corresponding RV section, without pasting its content.
`,
  'bug-standard.md': `# Bug Standard (BUG specification)

## 1. File location and naming

- Path: \`lifecycle/tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md\`
- Example: \`lifecycle/tasks/bugs/canonical-bom/BUG-CBOM-001.md\`

## 2. Frontmatter

\`\`\`yaml
---
bug_id: BUG-CBOM-001      # must match the filename
tool: canonical-bom       # must match the containing directory
title: "One-sentence defect title"
status: open              # open | in_progress | blocked | resolved | closed
severity: high            # low | medium | high | critical
bug_type: impl_bug        # req_bug (requirement/design defect) | impl_bug (implementation defect) | tc_bug (test-case defect)
owner: generator-001      # must be a registered UID; during REQ blocked, the fixer starts work on the strength of this field (§6)
linked_req: REQ-CBOM-003  # which REQ carries the fix (may be empty, pending human-001's designation; non-empty enters the §4 carrying process)
origin_req: ""            # optional: fill in when the defect's origin REQ is already done and differs from the REQ carrying the fix
blocks_req: []            # filled when a review sends a REQ back; this enters that REQ's pending_bugs
found_in: req_impl_review # the state in which it was found; a deferred-verification regression-run failure writes regression
test_case_ref: []         # must be backfilled before closing (severity ≥ high)
---
\`\`\`

## 3. Body structure

\`\`\`markdown
## Symptoms
## Reproduction steps
## Expected vs actual
## Root cause (filled in after diagnosis)
## Fix plan
## Verification method (linked TC)
\`\`\`

## 4. Two linking mechanisms — do not mix them

| Field | Semantics | Effect on the REQ lifecycle |
|---|---|---|
| \`blocks_req\` | **Sends a REQ back on review**, pushing it backward/onto hold | This BUG enters that REQ's \`pending_bugs\` → the REQ is set to \`blocked\` |
| \`linked_req\` | An ordinary link meaning "this BUG is carried and fixed by this REQ" | Does **not** change REQ state; appears as a gate at T03b / T03c (a REQ with a carried BUG can only take T03), T11 (all carried BUGs resolved), T13 / T14 (all closed) — see the carrying process below |
| \`origin_req\` | The defect's origin REQ (already done, not reopened) | None; the fix is carried by the REQ designated by \`linked_req\`, a BUG never carries its own implementation |

**Precondition for done**: while any BUG whose \`linked_req\` points at a REQ is not \`closed\` (any \`bug_type\`, \`resolved\` is not enough), that REQ must not be set to
\`done\`. This applies only to \`lifecycle_schema: 2\` REQs; old REQs and the BUGs pointing at them follow the old rule (any unclosed — i.e. not \`resolved\` / \`closed\` —
\`req_bug\` blocks done), historical BUGs are not migrated and their status is not changed.

**Carrying process** (a BUG with a non-empty \`linked_req\`, of any \`bug_type\`): the BUG is implemented and verified within the carrying REQ's lifecycle, on the strength of the carrying REQ's three preflight checks;
§6 leaves it only the one step of the owner writing the plan in the BUG file and setting it to \`resolved\`.

- Carrying eligibility: when \`linked_req\` is designated, the carrying REQ must not yet have left \`req_review\`, or must be the REQ itself named in this BUG's \`blocks_req\` whose restore target is \`req_review\`
  (self-carried, including one whose restore target was rewritten by a §6 redirect). A carrying REQ always goes through T03: \`tc_policy: exempt\` has no T11 / T13 and must not carry; once \`optional\` carries a BUG it is bound to T03,
  and the evaluator must not T03c — with no tc_design, no one connects a TC to the carried AC. An exempt REQ also does not self-carry: a defect on it needing a body-text change or a ruling goes through
  T04 / T17 in req_review, not T15; one that still needs a separate BUG has its (upstream, cross-REQ) \`linked_req\` designate another eligible REQ, or leaves it empty pending human-001's designation,
  with T16 gated on it being closed. The TC requirement in §5 item 2 does not apply only to a BUG that is a **\`req_bug\` whose fix content is only that exempt REQ's body text or a human ruling**
  (the evidence is the ruling and PR review); every other \`bug_type\` follows §5 item 2 as usual: \`severity\` ≥ \`high\` must have existing TC coverage, otherwise \`linked_req\` designates an eligible
  carrying REQ to add the TC at its tc_design (synonymous with the testcase-standard §4 regression convention).
- T02: the planner adds one AC per carried BUG (a regression BUG writes "TC-… restored to passing"), and a ruling that needs a REQ body-text change is implemented here. The BUG's \`owner\` is the
  role implementing the fix: for an implementation defect it is the carrying REQ's generator, for a test-case defect (TC text) it is the evaluator, changing the text at tc_design.
- tc_design: when the BUG's \`test_case_ref\` is non-empty (a regression BUG) → the evaluator appends the AC to the listed original TC's \`verifies\`, without writing a new TC; the original TC's \`verifies\`
  therefore holds ACs from two REQs at once, its legacy-form text is not rewritten, and tc_review checks only that \`verifies\` resolves and has a matching assertion for the carried AC; when empty → a TC is written for the AC as usual
  (a manual TC for anything not automatable), and the BUG's \`test_case_ref\` is backfilled.
- T08 / T09: for an original TC whose text tc_design has changed (tc_bug or a carried AC), the test code at its "Implementation location" is updated along with the text by the carrying REQ's generator, and reviewed together at T09;
  the original TC's status does not go through T06 / T08, and is changed only in req_impl_review by the evaluator per the result matrix (T12 sets failing, T13 sets passing,
  a missing sample keeps the original status).
- resolved: set by the owner once the root cause or ruling and fix plan are clearly written, no later than before T11; T11 requires every carried BUG to be \`resolved\` beforehand.
- T13: the evaluator runs the TCs listed in \`test_case_ref\`; on pass, the BUG is set \`closed\`, that TC to \`passing\`, and a line is recorded in the BUG's "Verification method" section pointing to the evidence in the carrying REQ's RV;
  when the original REQ has an RV (\`lifecycle_schema: 2\`), passed is additionally recorded in its \`## regression\`; an old REQ with no RV gets none created for it. Any that does not pass is set failing, going through T12. When the listed TC is a
  sample-missing integration TC, T13 assumes the sample is available: the evaluator sets the sample environment variable and runs it for real; without a sample, T13 is not signed, and the missing sample alone is not grounds for T12 either — when the rest of the
  TCs have no failing, the REQ stays in req_impl_review awaiting the sample, the RV \`## req_impl_review\` conclusion line reads "AWAITING SAMPLE" (review-standard §4), the Evidence column records
  "AWAITING SAMPLE: TC-…", and the listed TC keeps its original status; if the rest of the TCs have a failing, T12 still applies per the result matrix. Any evaluator holding the sample may do the regression run first, and its line in the original REQ's RV \`## regression\`
  (or a notification, when there is no RV) can serve as the evidence the carrying REQ's evaluator uses to sign T12 / T13; when the same TC already has an unclosed regression BUG, a failing run does not file a new BUG.
  When human-001 designates the carrying REQ, it must confirm the sample will be obtainable.
- T14: T14 is blocked until every carried BUG is \`closed\` (precondition for done).

All of the above changes to the original TC, the BUG file, and the original REQ's RV are authorized by the carrying REQ's three preflight checks, with no separate exception; once the original REQ is done, its owner takes no part.

The operational contract for \`blocks_req\` (who files the BUG, how a REQ's \`pending_bugs\` / \`blocked_reason\` / \`blocked_from_*\` are filled in, the commit format,
how human-001 clears it) is in [briefs.md](briefs.md) "Blocking and clearing".

## 5. Preconditions for closing

1. The root cause is clearly written (not "it's fixed because I changed something");
2. When \`severity\` ≥ \`high\`, there must be a TC covering it with \`test_case_ref\` backfilled: a regression BUG uses the original TC, never a new one; one without TC coverage cannot close on the strength of §6,
   and must have a \`linked_req\`, with the TC added at the carrying REQ's tc_design (§4);
3. \`resolved\` is set by the BUG's \`owner\`. \`closed\` is set by an evaluator-*, with authorization routed by whether \`linked_req\` is present: absent → an evaluator other than the owner, on the strength of the §6
   verification handoff, with evidence written into the "Verification method" section; present → the carrying REQ's T13 evaluator, on the strength of §4, not restricted to a non-owner (independence is guaranteed by the carrying REQ's RV evidence), with evidence in the carrying REQ RV's Evidence column (plus a \`## regression\`
   line when the original REQ has an RV), and one line in the "Verification method" section pointing to it;
4. Closing is not gated on the REQ's Bug History: for a BUG arising from a review send-back (\`blocks_req\` non-empty), the record of clearing is appended by human-001 at T16,
   timed at T16 (all \`pending_bugs\` closed, self-carried ones resolved).

## 6. BUG-level handoff (fix and verification)

While a REQ is \`blocked\`, no one holds it, so neither the fixer nor the verifier can start work on the strength of the REQ's three preflight checks — they go by the BUG instead. Two sets of checks, three items each.
A BUG with no \`linked_req\` uses both sets; two exceptions only write the root cause and neither fix nor close, waiting for human-001 to designate \`linked_req\` and then following §4: one with a non-empty \`origin_req\` (a BUG never
carries its own implementation); one whose fix needs a change to another REQ's body text (when the target REQ has already left req_review and is not done, human-001 pulls that REQ back with T19 first, then designates it). One that human-001
redirects in the exempt form no longer waits on \`linked_req\` — it is set resolved / closed per the redirect sentence; one with a \`linked_req\` (including self-carried) uses only the fix handoff's step of "the owner writes the root cause or ruling and fix plan clearly in the BUG file and
sets it to \`resolved\`" — it changes no code, and implementation, verification, and \`closed\` follow the §4 carrying process.

Fix handoff:

| # | Condition | How to check |
|---|---|---|
| B1 | BUG file exists | \`ls lifecycle/tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md\` |
| B2 | \`owner\` == your UID | \`grep '^owner:' …BUG-….md\` |
| B3 | \`status\` ∈ {open, in_progress} | \`grep '^status:' …BUG-….md\` |

The authorized scope is only the changes stated in the BUG's "Fix plan" section: code, tests, fixtures, design documents; it **does not change** the REQ's body or frontmatter: a BUG whose fix plan needs to change this
REQ's body or TC text, or one with \`severity\` ≥ \`high\` and no TC coverage, is not fixed on this path — it becomes self-carried instead (§4; except an exempt REQ, see §4
carrying eligibility). One discovered to be of this kind while already \`blocked\`: the fixer only writes the root cause clearly and notifies human-001; human-001, as the owner of blocked, **redirects** before T16, in one of two forms:
non-exempt → self-carried, the BUG's \`linked_req\` is set to this REQ, \`owner\` changed to the implementing role, the REQ's \`blocked_from_*\` changed to
\`req_review\` / planner; exempt → \`linked_req\` is not set, human-001 writes the ruling into the BUG's "Fix plan" section, the owner sets it to resolved, and an
evaluator other than the owner sets it to closed on the strength of §6 with the ruling as evidence, \`blocked_from_*\` likewise changed to \`req_review\` / planner, and the body-text change is implemented by the restored T02. Both record one line in
Bug History; a redirect is not a transition and does not count toward the round. Commit subject \`fix: BUG-<PREFIX>-NNN — one sentence\`. Once fixed, write the root cause clearly, backfill \`test_case_ref\`, \`status\` → resolved.

Verification handoff:

| # | Condition | How to check |
|---|---|---|
| V1 | BUG file exists | Same as B1 |
| V2 | You are an evaluator-*, and \`owner\` != your UID | \`grep '^owner:' …BUG-….md\` |
| V3 | \`status\` == resolved | \`grep '^status:' …BUG-….md\` |

The authorized scope is only the BUG file itself: execute per the "Verification method" section (run the TCs in \`test_case_ref\`, or the reproduction steps), and write the result into that section; on pass, \`status\` →
closed; on fail, \`status\` → in_progress with the gap stated, \`owner\` unchanged, and the fixer picks it back up on the strength of the fix handoff. Commit subject
\`verify: BUG-<PREFIX>-NNN — closed\` or \`— reopened\`. The verifier does not change code and does not change the REQ.

Once all \`pending_bugs\` are closed (self-carried ones resolved), human-001 performs T16, and the Bug History clearing record is appended at that step. Operational steps are in [briefs.md](briefs.md) "Blocking and clearing".
`,
  'agent-standard.md': `# Agent Standard (multi-agent registration and identity mapping specification)

This repository uses multiple LLMs to assist development and review. This specification defines the registration mechanism for **abstract identity ↔ actual model**,
with the single source of truth in [\`agent-registry.yml\`](agent-registry.yml), validated by the gate
[\`scripts/gates/check_agents.py\`](../scripts/gates/check_agents.py) (CI-blocking).

## 1. The three abstract roles (Planner / Generator / Evaluator)

Taken from Anthropic's "[Harness Design for Long-Running Agentic Applications](https://www.anthropic.com/engineering/harness-design-long-running-apps)":

| Role | Responsibility | States handled (\`handles\`) |
|---|---|---|
| **Planner** | Expands a REQ/goal into a spec and a plan (scope, technical direction, decomposition), without getting stuck in implementation detail | \`req_review\` (design side) |
| **Generator** | Implements iteratively per the spec (TC code / requirement code / documentation), **self-checks before delivery** | \`tc_review\` / \`tc_impl\` / \`req_impl\` |
| **Evaluator** | Independent quality gatekeeping: **writes the TC text that sets the acceptance criteria** + reviews + runs the gates to judge pass/fail | \`req_review\` / \`tc_design\` / \`tc_impl_review\` / \`req_impl_review\` |
| **human** | The human orchestrator: approves scope, rules on Pending decisions within req_review and pulls back for a rewrite, final merge, clears blocked and redirects, decides on model selection | \`draft\` / \`req_review\` / \`pr_draft\` / \`blocked\` / \`done\` |

> 🔴 **Separation principle**: Generator and Evaluator must be **different identities** — a model has a self-flattering bias toward its own output,
> and only an independent Evaluator can give objective, actionable feedback. \`check_agents.py\` blocks the same UID holding both roles.

> 🔑 **The one who sets the standard ≠ the one who implements it**: \`tc_design\` (writing the TC text = setting the acceptance criteria) belongs to the Evaluator,
> \`tc_impl\` / \`req_impl\` (writing code) belongs to the Generator.

## 2. Naming and registration

- **Naming**: \`<role>-NNN\` (e.g. \`planner-001\`); the human is \`human-001\`.
- **One identity, multiple models**: each agent has a \`model\` (primary binding) + \`fallbacks\` (an ordered list of alternates).
  When the primary model is unavailable/rate-limited, it falls through to the next alternate; the **UID does not change**, so the attribution of reviews/commits stays stable.
- **\`handles\`**: the lifecycle states this agent may hold, equal to that role's legal states as derived from the [lifecycle.yml](lifecycle.yml) transition table; the gates check they are exactly equal; the §1 table and requirement-standard §0 are mirrors of each other.
- **Bindings can evolve**: once a model's capability improves, just change \`model\` / \`effort\` — no need to change the process or rewrite history.

## 3. Provider sets — two kinds, cross-vendor is the default

\`provider_sets\` registers planner/generator/evaluator as complete sets, and \`active_set\` points at the one currently in effect. Sets fall into two kinds (the cross-vendor evaluator decision (ADR-011)):

- **Cross-vendor set** (the default active one): the generator's and evaluator's models come from different vendors. Two REQ-PLAT-007 / 008 cycles showed empirically: three rounds of internal review from the same model family caught not a single
  implementation-level P1 ahead of an external one, while one round of Codex caught 14 — a model has a systematic blind spot for its own family's output, so an independent evaluator must switch vendors to actually be independent.
  Currently active: planner-001 / generator-001 / evaluator-002 (Codex CLI, invoked locally and non-interactively by the orchestrating session); tc_impl_review is a mechanical, code-level review, and
  per the agreement at the top of [briefs.md](briefs.md) is assigned to the same-vendor evaluator-001.
- **Same-vendor set** (fallback): every member is from the same vendor, letting one vendor's flagship model run the whole process with subagents from its own family. The original reasoning for "one agent set must be same-vendor" was that
  Claude Code was thought unable to call the Codex CLI, which stopped holding as of 2026-09-11; the same-vendor set only switches in wholesale when the cross-vendor set is unavailable.

Therefore:

- \`fallbacks\` still **prefers the same vendor first** (e.g. \`claude-opus-5\` → \`claude-opus-4-8\`), with cross-vendor placed last — this is the alternates for a single agent, not the category of the set;
- switching uses \`active_set\` to switch as a whole, not swapping models agent by agent; the UID does not change;
- \`check_agents.py\` checks by category: mixing multiple vendors within a same-vendor set is a violation, and the cross-vendor set's generator and evaluator being the same vendor is a violation (only same-vendor is recognized before REQ-PLAT-009 lands).

## 4. Basis for model and effort selection

> ⚠️ Every entry below is **a binding with a specific reason**, not something filled in casually. Read the corresponding entry in full before changing a binding.

### Current bindings

| UID | Model | effort | Reason |
|---|---|---|---|
| \`planner-001\` | \`claude-fable-5-1\` | \`xhigh\` | Fable 5.1's thinking is always on and cannot be turned off, so depth can only be tuned via effort. The vendor recommends \`high\` for most tasks and \`xhigh\` for capability-sensitive scenarios; architecture and spec decomposition are the latter. |
| \`generator-001\` | \`claude-opus-5\` | \`xhigh\` (\`high\` for \`tc_impl\`) | Opus 5 is recommended to start at \`xhigh\` for coding/agentic work. But this generation's \`low\`/\`medium\` punch unusually far above their weight — once implementation has landed, **an effort sweep should be run per route** and then settled; don't treat \`xhigh\` as a permanent default. TC code is relatively mechanical, so \`high\` is already enough. |
| \`evaluator-001\` | \`claude-sonnet-5\` | \`high\` (\`xhigh\` for \`req_impl_review\`) | Sonnet 5's default \`high\` already covers most reviews; \`req_impl_review\` is the last gate before merge, worth the extra tier. Review is "mostly reading, little writing" — it doesn't need \`xhigh\` throughout. Under the cross-vendor set it takes only \`tc_impl_review\`. |
| \`evaluator-002\` | \`gpt-5.6-sol\` | \`xhigh\` | The cross-vendor set's evaluator seat (\`req_review\` / \`tc_design\` / \`req_impl_review\`), invoked non-interactively via the Codex CLI; review is the last, adversarial, independent gate, so \`xhigh\` throughout. |

> \`claude-sonnet-4-8\` **does not exist** — the Sonnet line runs 4.5 → 4.6 → 5. Don't make up a model number from memory when writing the registry;
> look it up if unsure — getting it wrong fails silently with a 404.

### Model-specific prompting gates

These rules **directly affect the quality of what the harness produces**, and must be followed when writing prompts:

| Subject | Rule | Why |
|---|---|---|
| **Evaluator (Sonnet 5 / Opus 5)** | Review prompts **must not** say "only report high-severity" / "be conservative" / "don't nitpick." Instead say "**report everything**, with confidence and severity on every item," and leave the filtering to \`human-001\` | This generation of models will follow it to the letter — it still checks just as carefully, then proactively drops findings it judges to be below the bar itself. Precision goes up, **recall goes down**, and a missed finding is review's most expensive failure |
| **Generator (Opus 5)** | **Delete** all "double-check your answer" / "add one more verification pass at the end" scaffolding | Opus 5 already verifies on its own; an explicit request stacks on top into over-verification, burning tokens and lengthening turns |
| **Generator (Opus 5)** | Give it explicit **scope discipline**: do only what the requirement asks, no opportunistic refactoring, no unrequested abstraction or defensive code | It tends to expand task scope on its own |
| **Generator (Opus 5)** | Give it an explicit **subagent ceiling**: don't dispatch a subagent for something that can be done in a few steps itself; keep review/verification in the main loop | It is more eager to open subagents than the previous generation, and every subagent has to rebuild context, doubling the cost |
| **Planner (Fable 5)** | Write prompts with **goals and constraints**, not step-by-step prescribed methods | An overly prescriptive prompt **degrades** Fable 5's output quality; step-by-step scaffolding written for older models should be deleted |
| **All agents** | Terminology always uses the canonical words from [GLOSSARY.md](../GLOSSARY.md) | Avoids the same concept having three different names across the REQ, the TC, and the code |

These rules are already written into the "How to write" and "General prohibitions" of every section in [briefs.md](briefs.md); task briefs are drawn uniformly from there, and are not rewritten for every session.
\`check_agents.py\` scans briefs.md, and finding one of the banned phrases in the table above is a red flag; the table above and the gate's constants mirror each other, and either side changing while the other does not is likewise red ([GUIDE §6](GUIDE.md#6-gates)).

### When to change a binding

- A clearly stronger same-vendor model appears → change \`model\`, with \`fallbacks\` shifting the old model down;
- A given state keeps going over budget → lower \`effort\` first, then consider changing the model;
- A given state's quality is unstable → raise \`effort\` first and check whether it has tripped the prompting gates in the table above, **then** consider changing the model.

Changes to \`agent-registry.yml\` go through a PR, validated as a CI-blocking check by \`check_agents.py\`.

## 5. Usage

- Actions in a REQ / TC / BUG / ADR are signed with a role-UID (\`owner\` / ruling / fix record).
- One role may have multiple instances (e.g. \`evaluator-001\` / \`evaluator-002\` doing multi-AI adversarial review).
- An agent must pass the [three preflight checks](requirement-standard.md#0-mandatory-preflight-protocol-hard-stop) before starting work.
`,
}

/** The process handbook written to `<lifecycleDir>/GUIDE.md`. */
export const GUIDE: string = `# Harness Engineering — Engineering Method Notes

> Conventions are inherited from the \`harness/\` system in [rushwing/ai-family](https://github.com/rushwing/ai-family),
> adapted for this repository (multi-tool, three-surface exposure, design-first).
> Terminology follows [GLOSSARY.md](../GLOSSARY.md) §4 at the repository root.

## 1. Core idea

All work items (requirements, test cases, defects, architecture decisions) are **Markdown files inside the version-controlled repository**,
carrying structured frontmatter and an explicit lifecycle state.
Collaboration between humans and the various AI agents hands off through **file-state transitions**, not verbal/session memory.

This way, a requirement can be handed to any vendor's flagship model: acting as the orchestrating session, it opens
one subagent per role per [agent-registry.yml](agent-registry.yml), and can walk the whole development process through — because "what's next, who owns it, where the acceptance criteria are" is all written in the files.
One UID, one session; role agents do not delegate further downward ([briefs.md](briefs.md) general prohibitions).
Roles can span vendors: in the default active provider set, generator and evaluator come from different vendors (the evaluator seat is the Codex CLI, invoked locally and non-interactively by the orchestrating session),
with a same-vendor set serving only as fallback (the cross-vendor evaluator decision (ADR-011)).

## 2. Directory layout and numbering

\`\`\`
lifecycle/
├── standards/
│   ├── agent-standard.md      # agent registration and identity-mapping specification (includes model/effort rationale)
│   ├── requirement-standard.md   # REQ specification
│   ├── testcase-standard.md      # TC specification
│   ├── review-standard.md        # RV review record specification
│   ├── bug-standard.md           # BUG specification
│   ├── adr-standard.md           # ADR specification (the ADRs themselves live in docs/adr/)
│   └── briefs.md               # role x state task briefs; an agent reads only its own section before starting work
├── agent-registry.yml         # ★ single source of truth for role <-> model; handles is a projection of lifecycle.yml
├── lifecycle.yml              # ★ lifecycle table: single source of truth for states / roles / transitions / exits / restore targets
└── tasks/
    ├── id-scheme.yml          # ★ mapping of scope directory -> ID prefix; gates validate against it
    ├── features/<scope>/     REQ-<PREFIX>-NNN.md
    ├── test-cases/<scope>/   TC-<PREFIX>-NNN-SS.md
    ├── bugs/<scope>/         BUG-<PREFIX>-NNN.md
    ├── reviews/<scope>/      RV-<PREFIX>-NNN.md   review record, shares the REQ's number, does not move on archive
    ├── plans/<scope>/        PL-<PREFIX>-NNN.md   optional design plan, same as above
    └── archive/done/         archive of completed items (only the REQ moves)
\`\`\`

**Difference from ai-family: IDs carry a tool prefix, directories are split by tool.**
In a multi-tool repository, a global sequence number like \`REQ-007\` quickly loses indexability — seeing the number tells you nothing about which tool it belongs to,
and it can't let different tools' requirements advance in parallel without colliding on a number. So:

| Type | Path | Example |
|---|---|---|
| Requirement | \`tasks/features/<scope>/REQ-<PREFIX>-NNN.md\` | \`tasks/features/canonical-bom/REQ-CBOM-001.md\` |
| Test case | \`tasks/test-cases/<scope>/TC-<PREFIX>-NNN-SS.md\` | \`tasks/test-cases/canonical-bom/TC-CBOM-001-01.md\` |
| Defect | \`tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md\` | \`tasks/bugs/canonical-bom/BUG-CBOM-001.md\` |

The \`<scope>\` ↔ \`<PREFIX>\` mapping is in [tasks/id-scheme.yml](tasks/id-scheme.yml),
and \`scripts/gates/req_lint.py\` validates that "directory ↔ prefix ↔ the frontmatter's \`tool\` field" are all three consistent.

**ADRs carry no prefix** — an architecture decision is repository-level, with a globally unique number: \`docs/adr/ADR-NNN-<slug>.md\`.

## 3. Lifecycle (REQ primary state machine)

\`\`\`
draft → req_review ⇄ tc_design → tc_review ⇄ tc_impl → tc_impl_review
      → req_impl → req_impl_review → pr_draft → done
any state →(blocked by a BUG)→ blocked →(BUG closed)→ restores to the original state
\`\`\`

\`tc_policy\` decides the exit from req_review: \`required\`, and \`optional\` that needs a TC, take the full T03 path; \`optional\` with TC waived takes T03c and goes directly into
\`req_impl\`; pure specification/documentation \`exempt\` takes T03b: \`draft → req_review → pr_draft → done\`, with the planner opening a draft PR at T02.
When a BUG's \`linked_req\` points at a REQ, that REQ is a carrying REQ and can only take T03: \`optional\` must not waive TC, and \`exempt\` must not carry ([bug-standard.md](bug-standard.md) §4).

Every review gate's conclusion and findings are written into the review record RV sharing the REQ's number ([review-standard.md](review-standard.md)),
and state progression is evidenced by the RV's PASS; a transition commit's body records only the status / owner change and the RV anchor.
The machine source of truth is [lifecycle.yml](lifecycle.yml); the full human-readable transition table is in [requirement-standard.md](requirement-standard.md) §4, which mirrors it, checked by the gates (§6).

## 4. Handoff protocol (three preflight checks)

Any executor (human or AI agent) must confirm the following before starting a piece of work:

1. The corresponding REQ file exists;
2. Their own UID matches the REQ's \`owner\` field;
3. The REQ's \`status\` is one of their legal working states.

If any of the three is not satisfied, **do not proceed** — report the conflict to \`human-001\`.
The sole exception belongs to human-001: T19 (pull back for a rewrite) is not bound by items 2 and 3, because its action is precisely to reclaim the owner. T15 (set to blocked) is executed by the current owner.
Two kinds of actions are not REQ transitions and do not change the REQ, so they do not go through the three preflight checks: a regression run for deferred verification only updates the RV's regression section and TC status
([testcase-standard.md](testcase-standard.md) §4); BUG fixing and verification during REQ blocked starts work on the strength of the BUG-level handoff
([bug-standard.md](bug-standard.md) §6). The carrying process ([bug-standard.md](bug-standard.md) §4) changing the original REQ's TC verifies / status and the
RV regression line is authorized by the carrying REQ's three preflight checks, with no separate exception.

The executors registered in this repository and their legal working states:

| UID | Role | Model | effort | Legal working states |
|---|---|---|---|---|
| \`planner-001\` | Planner | \`claude-fable-5-1\` | xhigh | \`req_review\` |
| \`generator-001\` | Generator | \`claude-opus-5\` | xhigh (\`high\` for \`tc_impl\`) | \`tc_review\`, \`tc_impl\`, \`req_impl\` |
| \`evaluator-001\` | Evaluator (same vendor; under the cross-vendor set takes only \`tc_impl_review\`) | \`claude-sonnet-5\` | high (\`xhigh\` for \`req_impl_review\`) | \`req_review\`, \`tc_design\`, \`tc_impl_review\`, \`req_impl_review\` |
| \`evaluator-002\` | Evaluator (cross-vendor seat, Codex CLI) | \`gpt-5.6-sol\` | xhigh | Same as above; in practice takes \`req_review\`, \`tc_design\`, \`req_impl_review\` |
| \`planner-002\` / \`generator-002\` | Same-vendor fallback set | \`gpt-5.6-sol\` | high | Same as their respective role |
| \`human-001\` | Human orchestrator | — | — | \`draft\`, \`req_review\` (rulings and pull-backs), \`pr_draft\`, \`blocked\`, \`done\` |

The single source of truth is [agent-registry.yml](agent-registry.yml); the basis for model and effort selection,
and the **model-specific prompting gates**, are in [agent-standard.md](agent-standard.md).
What each role reads, writes, and delivers in each state is in [briefs.md](briefs.md).

## 5. Review-feedback routing rules

Review output **does not directly change the design plan**; instead:

- A design defect → file a \`BUG-<PREFIX>-NNN\` (\`bug_type: req_bug\`), linked to the corresponding REQ; when it needs to block the REQ, go through T15 per [briefs.md](briefs.md) "Blocking and clearing";
- A new ask → file a new \`REQ-<PREFIX>-NNN\` (\`status: draft\`);
- A model-selection dispute → append comments to the corresponding ADR's Review Notes section, ruled on by \`human-001\`.

**Precondition for done**: while any BUG whose \`linked_req\` points at a REQ is not \`closed\` (any \`bug_type\`), that REQ must not be set to \`done\`; this applies only to
\`lifecycle_schema: 2\` REQs, and old REQs follow "a \`req_bug\` that is not \`resolved\` / \`closed\` blocks done," with historical BUGs not migrated. How the closing of the carrying REQ and the BUG / original TC are bound
is in [bug-standard.md](bug-standard.md) §4 "Carrying process".

## 6. Gates

Four scripts are the blocking gates of the CI governance job, run before installing the workspace, depending only on the standard library and PyYAML, importing no project packages.
Rules for harness artifacts are folded into the existing scripts rather than adding new entry points (the rule bodies live in \`scripts/gates/harness_rules.py\`); each rule is a check function that takes explicit input and returns a list of violations
(following the REQ-PLAT-004 form), the entry point runs every rule to completion before failing, one violation per line (relative file path + the rule point), with a one-line summary when there are no violations.

| Script | Rule group | Scope of application |
|---|---|---|
| \`scripts/gates/check_glossary.py\` | Terminology/aliases ↔ config ↔ code are all three consistent (GLOSSARY §6) | Whole repository |
| \`scripts/gates/check_layout.py\` | Dependency direction is one-way; the three-surface adapters stay thin | Whole-repository code |
| \`scripts/gates/check_agents.py\` | Registry structure; \`handles\` ⊆ the state set of lifecycle.yml; provider sets checked by category (a same-vendor set is entirely same-vendor, a cross-vendor set's generator and evaluator are different vendors); scans for **briefs.md banned phrases**, with the banned-phrase constants matching the agent-standard §4 table item-for-item | The registry, briefs, agent-standard |
| \`scripts/gates/req_lint.py\` | Work-item frontmatter; directory ↔ prefix ↔ \`tool\`; each artifact kind is recognized only in its own specification directory (a wrong directory is a violation, not a non-match); REQ / TC / BUG numbers are unique repository-wide; owner is registered and \`status ∈ handles[owner]\`; blocked fields are consistent (all four blocking fields empty when not blocked) | All REQs / TCs / BUGs (including the owner and status of archived REQs) |
| \`req_lint.py\` (v2 body) | The seven headings and their order, banned headings, H3 placement, section and whole-document budgets, AC numbering and the 240-character line limit, the Pending decisions format and state, the HOW lexicon (the regex constants live here, requirement-standard §3 mirrors them, and the gates check the two match) | In-flight REQs with \`lifecycle_schema: 2\` |
| \`req_lint.py\` (links) | Both inline (including title) and reference-style relative links resolve to an existing **regular file**; every use site of a reference-style link (full form \`[text][label]\`, collapsed form \`[text][]\`) must have a definition line; an anchor resolves to the target heading (GitHub slug rules) | v2 REQs and their TC, RV, PL, BUG, \`lifecycle/standards/*.md\`, CLAUDE.md, GLOSSARY.md |
| \`req_lint.py\` (TC) | Exactly four body sections in order, Preconditions / Steps / Implementation location each non-empty, \`verifies\` resolves, Expected results starts each item with a number and has content after it, owner is an evaluator, budgets, manual TC, the status path, coverage (globally connected by AC number) synced with \`test_case_ref\`, the deferred-verification list | TCs whose \`linked_req\` is a v2 REQ |
| \`req_lint.py\` (RV) | Existence and frontmatter, the six headings, the five sections' field order, the conclusion line and the signing role, round == \`review_round\`, the PASS-before-advancing table, the AWAITING SAMPLE form, budgets, per-item evidence for TC-waived and passing manual TCs, the \`## regression\` lines (each line's result consistent with the TC / BUG facts, including that a TC with an unclosed BUG must not be passing) | RVs of every v2 REQ, including those under \`archive/done\` (budget and \`## regression\` are checked the same way); those under \`archive/superseded\` are not checked |
| \`req_lint.py\` (lifecycle) | The tc_policy exit and carrying guards, the timing of \`pr_number\`, BUG frontmatter and target resolution, the timing of a carried BUG's AC / test_case_ref / resolved / closed, the precondition for done (v2: any bug_type must be closed; old: a req_bug not resolved / closed), the §5 closing conditions, the PL shape | v2 REQs and their BUGs, PLs; old REQs run only the old done gate |
| \`req_lint.py\` (lifecycle table) | The shape, version, and self-consistency of \`lifecycle.yml\` (start/end points and role registration, exits, restore targets, signing roles, the TC status matrix); the registry's \`handles\` is exactly equal to the role's legal states as derived from the table; the mirrors in requirement-standard §0 / §4, review-standard §4, briefs, testcase-standard §4, agent-standard §1, and GLOSSARY §4 are item-for-item consistent; every registered mirror must be found and non-empty (a renamed heading, a re-indented table, hiding it inside a fence or comment, or a missing file are all reported as a missing mirror); versioning fixes two-phase judging: the load phase reports an extra item / reordering / duplication, the self-consistency phase reports a missing item / an empty one, with exactly one report per root cause in the self-consistency group | \`lifecycle.yml\`, the registry, the seven specification mirrors (the list is a closed set, the six specifications are traversed unconditionally) |
| \`req_lint.py\` (transition evidence) | Step five, run only on PR events: checks commit-by-commit along the base…head first-parent commit chain — a transition commit is checked against its guard by the pre-first-parent tree, and against its effect by its own diff (starting point, executing / handing-off role, the \`review_round\` increment, the RV gate section's conclusion and round, TC / BUG status, \`pr_number\`); a non-transition commit must have zero sensitive diff unless it is a registered event; a merge commit syncing to a base must have its sensitive diff equal to its second parent; Co-Authored-By ↔ role-model is only a hint; the rules take the transitions / events registered in lifecycle.yml as ground truth | The PR's commit chain; judged by the first-parent tree's table (the activating commit is judged by its own table), a vacuum before activation and a missing table / missing key after it are both red, and a failure to resolve the tree before/after the checked commit is red; push and manual triggers do not run this |

**Boundaries**: version is judged by \`lifecycle_schema\` (absent = old REQ, frontmatter checked only, old TC / BUG not migrated); location is judged by directory, with only \`done\` and \`superseded\` recognized under \`archive/\` (in-flight REQs run every rule;
a v2 REQ's body under \`archive/done\` is not re-run, but the RV budget and the \`## regression\` lines are still checked; \`archive/superseded\` does not check body text, and its RV is not checked either; an archived REQ or TC still participates in every rule
as the target of link, numbering, and state lookups). A \`blocked\` REQ is judged by \`blocked_from_status\`. State invariants read only the working tree; transition evidence reads the PR's commit chain (step five, run locally with range parameters). Tests are in \`tests/gates/\`.
`
