# Harness Engineering — Engineering Method Notes

> Conventions are inherited from the `harness/` system in [rushwing/ai-family](https://github.com/rushwing/ai-family),
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

```
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
```

**Difference from ai-family: IDs carry a tool prefix, directories are split by tool.**
In a multi-tool repository, a global sequence number like `REQ-007` quickly loses indexability — seeing the number tells you nothing about which tool it belongs to,
and it can't let different tools' requirements advance in parallel without colliding on a number. So:

| Type | Path | Example |
|---|---|---|
| Requirement | `tasks/features/<scope>/REQ-<PREFIX>-NNN.md` | `tasks/features/canonical-bom/REQ-CBOM-001.md` |
| Test case | `tasks/test-cases/<scope>/TC-<PREFIX>-NNN-SS.md` | `tasks/test-cases/canonical-bom/TC-CBOM-001-01.md` |
| Defect | `tasks/bugs/<scope>/BUG-<PREFIX>-NNN.md` | `tasks/bugs/canonical-bom/BUG-CBOM-001.md` |

The `<scope>` ↔ `<PREFIX>` mapping is in [tasks/id-scheme.yml](tasks/id-scheme.yml),
and `scripts/gates/req_lint.py` validates that "directory ↔ prefix ↔ the frontmatter's `tool` field" are all three consistent.

**ADRs carry no prefix** — an architecture decision is repository-level, with a globally unique number: `docs/adr/ADR-NNN-<slug>.md`.

## 3. Lifecycle (REQ primary state machine)

```
draft → req_review ⇄ tc_design → tc_review ⇄ tc_impl → tc_impl_review
      → req_impl → req_impl_review → pr_draft → done
any state →(blocked by a BUG)→ blocked →(BUG closed)→ restores to the original state
```

`tc_policy` decides the exit from req_review: `required`, and `optional` that needs a TC, take the full T03 path; `optional` with TC waived takes T03c and goes directly into
`req_impl`; pure specification/documentation `exempt` takes T03b: `draft → req_review → pr_draft → done`, with the planner opening a draft PR at T02.
When a BUG's `linked_req` points at a REQ, that REQ is a carrying REQ and can only take T03: `optional` must not waive TC, and `exempt` must not carry ([bug-standard.md](bug-standard.md) §4).

Every review gate's conclusion and findings are written into the review record RV sharing the REQ's number ([review-standard.md](review-standard.md)),
and state progression is evidenced by the RV's PASS; a transition commit's body records only the status / owner change and the RV anchor.
The machine source of truth is [lifecycle.yml](lifecycle.yml); the full human-readable transition table is in [requirement-standard.md](requirement-standard.md) §4, which mirrors it, checked by the gates (§6).

## 4. Handoff protocol (three preflight checks)

Any executor (human or AI agent) must confirm the following before starting a piece of work:

1. The corresponding REQ file exists;
2. Their own UID matches the REQ's `owner` field;
3. The REQ's `status` is one of their legal working states.

If any of the three is not satisfied, **do not proceed** — report the conflict to `human-001`.
The sole exception belongs to human-001: T19 (pull back for a rewrite) is not bound by items 2 and 3, because its action is precisely to reclaim the owner. T15 (set to blocked) is executed by the current owner.
Two kinds of actions are not REQ transitions and do not change the REQ, so they do not go through the three preflight checks: a regression run for deferred verification only updates the RV's regression section and TC status
([testcase-standard.md](testcase-standard.md) §4); BUG fixing and verification during REQ blocked starts work on the strength of the BUG-level handoff
([bug-standard.md](bug-standard.md) §6). The carrying process ([bug-standard.md](bug-standard.md) §4) changing the original REQ's TC verifies / status and the
RV regression line is authorized by the carrying REQ's three preflight checks, with no separate exception.

The executors registered in this repository and their legal working states:

| UID | Role | Model | effort | Legal working states |
|---|---|---|---|---|
| `planner-001` | Planner | `claude-fable-5-1` | xhigh | `req_review` |
| `generator-001` | Generator | `claude-opus-5` | xhigh (`high` for `tc_impl`) | `tc_review`, `tc_impl`, `req_impl` |
| `evaluator-001` | Evaluator (same vendor; under the cross-vendor set takes only `tc_impl_review`) | `claude-sonnet-5` | high (`xhigh` for `req_impl_review`) | `req_review`, `tc_design`, `tc_impl_review`, `req_impl_review` |
| `evaluator-002` | Evaluator (cross-vendor seat, Codex CLI) | `gpt-5.6-sol` | xhigh | Same as above; in practice takes `req_review`, `tc_design`, `req_impl_review` |
| `planner-002` / `generator-002` | Same-vendor fallback set | `gpt-5.6-sol` | high | Same as their respective role |
| `human-001` | Human orchestrator | — | — | `draft`, `req_review` (rulings and pull-backs), `pr_draft`, `blocked`, `done` |

The single source of truth is [agent-registry.yml](agent-registry.yml); the basis for model and effort selection,
and the **model-specific prompting gates**, are in [agent-standard.md](agent-standard.md).
What each role reads, writes, and delivers in each state is in [briefs.md](briefs.md).

## 5. Review-feedback routing rules

Review output **does not directly change the design plan**; instead:

- A design defect → file a `BUG-<PREFIX>-NNN` (`bug_type: req_bug`), linked to the corresponding REQ; when it needs to block the REQ, go through T15 per [briefs.md](briefs.md) "Blocking and clearing";
- A new ask → file a new `REQ-<PREFIX>-NNN` (`status: draft`);
- A model-selection dispute → append comments to the corresponding ADR's Review Notes section, ruled on by `human-001`.

**Precondition for done**: while any BUG whose `linked_req` points at a REQ is not `closed` (any `bug_type`), that REQ must not be set to `done`; this applies only to
`lifecycle_schema: 2` REQs, and old REQs follow "a `req_bug` that is not `resolved` / `closed` blocks done," with historical BUGs not migrated. How the closing of the carrying REQ and the BUG / original TC are bound
is in [bug-standard.md](bug-standard.md) §4 "Carrying process".

## 6. Gates

Four scripts are the blocking gates of the CI governance job, run before installing the workspace, depending only on the standard library and PyYAML, importing no project packages.
Rules for harness artifacts are folded into the existing scripts rather than adding new entry points (the rule bodies live in `scripts/gates/harness_rules.py`); each rule is a check function that takes explicit input and returns a list of violations
(following the REQ-PLAT-004 form), the entry point runs every rule to completion before failing, one violation per line (relative file path + the rule point), with a one-line summary when there are no violations.

| Script | Rule group | Scope of application |
|---|---|---|
| `scripts/gates/check_glossary.py` | Terminology/aliases ↔ config ↔ code are all three consistent (GLOSSARY §6) | Whole repository |
| `scripts/gates/check_layout.py` | Dependency direction is one-way; the three-surface adapters stay thin | Whole-repository code |
| `scripts/gates/check_agents.py` | Registry structure; `handles` ⊆ the state set of lifecycle.yml; provider sets checked by category (a same-vendor set is entirely same-vendor, a cross-vendor set's generator and evaluator are different vendors); scans for **briefs.md banned phrases**, with the banned-phrase constants matching the agent-standard §4 table item-for-item | The registry, briefs, agent-standard |
| `scripts/gates/req_lint.py` | Work-item frontmatter; directory ↔ prefix ↔ `tool`; each artifact kind is recognized only in its own specification directory (a wrong directory is a violation, not a non-match); REQ / TC / BUG numbers are unique repository-wide; owner is registered and `status ∈ handles[owner]`; blocked fields are consistent (all four blocking fields empty when not blocked) | All REQs / TCs / BUGs (including the owner and status of archived REQs) |
| `req_lint.py` (v2 body) | The seven headings and their order, banned headings, H3 placement, section and whole-document budgets, AC numbering and the 240-character line limit, the Pending decisions format and state, the HOW lexicon (the regex constants live here, requirement-standard §3 mirrors them, and the gates check the two match) | In-flight REQs with `lifecycle_schema: 2` |
| `req_lint.py` (links) | Both inline (including title) and reference-style relative links resolve to an existing **regular file**; every use site of a reference-style link (full form `[text][label]`, collapsed form `[text][]`) must have a definition line; an anchor resolves to the target heading (GitHub slug rules) | v2 REQs and their TC, RV, PL, BUG, `lifecycle/standards/*.md`, CLAUDE.md, GLOSSARY.md |
| `req_lint.py` (TC) | Exactly four body sections in order, Preconditions / Steps / Implementation location each non-empty, `verifies` resolves, Expected results starts each item with a number and has content after it, owner is an evaluator, budgets, manual TC, the status path, coverage (globally connected by AC number) synced with `test_case_ref`, the deferred-verification list | TCs whose `linked_req` is a v2 REQ |
| `req_lint.py` (RV) | Existence and frontmatter, the six headings, the five sections' field order, the conclusion line and the signing role, round == `review_round`, the PASS-before-advancing table, the AWAITING SAMPLE form, budgets, per-item evidence for TC-waived and passing manual TCs, the `## regression` lines (each line's result consistent with the TC / BUG facts, including that a TC with an unclosed BUG must not be passing) | RVs of every v2 REQ, including those under `archive/done` (budget and `## regression` are checked the same way); those under `archive/superseded` are not checked |
| `req_lint.py` (lifecycle) | The tc_policy exit and carrying guards, the timing of `pr_number`, BUG frontmatter and target resolution, the timing of a carried BUG's AC / test_case_ref / resolved / closed, the precondition for done (v2: any bug_type must be closed; old: a req_bug not resolved / closed), the §5 closing conditions, the PL shape | v2 REQs and their BUGs, PLs; old REQs run only the old done gate |
| `req_lint.py` (lifecycle table) | The shape, version, and self-consistency of `lifecycle.yml` (start/end points and role registration, exits, restore targets, signing roles, the TC status matrix); the registry's `handles` is exactly equal to the role's legal states as derived from the table; the mirrors in requirement-standard §0 / §4, review-standard §4, briefs, testcase-standard §4, agent-standard §1, and GLOSSARY §4 are item-for-item consistent; every registered mirror must be found and non-empty (a renamed heading, a re-indented table, hiding it inside a fence or comment, or a missing file are all reported as a missing mirror); versioning fixes two-phase judging: the load phase reports an extra item / reordering / duplication, the self-consistency phase reports a missing item / an empty one, with exactly one report per root cause in the self-consistency group | `lifecycle.yml`, the registry, the seven specification mirrors (the list is a closed set, the six specifications are traversed unconditionally) |
| `req_lint.py` (transition evidence) | Step five, run only on PR events: checks commit-by-commit along the base…head first-parent commit chain — a transition commit is checked against its guard by the pre-first-parent tree, and against its effect by its own diff (starting point, executing / handing-off role, the `review_round` increment, the RV gate section's conclusion and round, TC / BUG status, `pr_number`); a non-transition commit must have zero sensitive diff unless it is a registered event; a merge commit syncing to a base must have its sensitive diff equal to its second parent; Co-Authored-By ↔ role-model is only a hint; the rules take the transitions / events registered in lifecycle.yml as ground truth | The PR's commit chain; judged by the first-parent tree's table (the activating commit is judged by its own table), a vacuum before activation and a missing table / missing key after it are both red, and a failure to resolve the tree before/after the checked commit is red; push and manual triggers do not run this |

**Boundaries**: version is judged by `lifecycle_schema` (absent = old REQ, frontmatter checked only, old TC / BUG not migrated); location is judged by directory, with only `done` and `superseded` recognized under `archive/` (in-flight REQs run every rule;
a v2 REQ's body under `archive/done` is not re-run, but the RV budget and the `## regression` lines are still checked; `archive/superseded` does not check body text, and its RV is not checked either; an archived REQ or TC still participates in every rule
as the target of link, numbering, and state lookups). A `blocked` REQ is judged by `blocked_from_status`. State invariants read only the working tree; transition evidence reads the PR's commit chain (step five, run locally with range parameters). Tests are in `tests/gates/`.
