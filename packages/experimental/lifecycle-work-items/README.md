---
description: "Lifecycle team work items: parses REQ, TC, BUG, RV, and PL Markdown artifacts into a graph, loads the artifact contract, lints the graph against the standards, judges lifecycle steps against the table's guards, effects, and may_change, plans effect edits, and writes them atomically with rollback."
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-lifecycle-work-items

English | [中文](README.zh.md)

## Summary

The lifecycle team's work items are Markdown files under a workspace's `lifecycle/tasks/` directory: requirements (REQ), test cases (TC), bugs (BUG), review records (RV), and design plans (PL). This library parses them into an artifact graph, loads the `artifact-contract.yml` that pins headings, budgets, review fields, and the implementation lexicon, lints the graph with every rule group of the factory-tools gates, judges one lifecycle step against the table's guards, effects, and `may_change`, plans the frontmatter edits a step's effects require, and writes files atomically with rollback. It registers nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Every entry point is a pure function over values the caller already holds; only `directorySource` and `writeAtomically` touch the file system. The fixture tree under [`tests/fixtures/workspace/`](tests/fixtures/workspace/) is the translated factory-tools workspace and lints clean.

### Load the graph

`loadGraph(source, parseOptionsOf(contract))` reads every Markdown file of a `WorkItemSource` (`directorySource(absoluteTasksDir, 'lifecycle/tasks')` or `memorySource(tasksDir, files)`) and returns an `ArtifactGraph`: `reqs`, `tcs`, `bugs`, `rvs`, and `pls` by id, `artifacts` in path order, `problems` for files that could not become nodes (a name outside the five id shapes, a wrong directory, missing or invalid frontmatter), `duplicates` for ids claimed twice (the first file in path order wins), and the relations rules read: `acs` (acceptance-criterion id to owning REQ), `ownTcs`, `carriedBugs`, `blockingBugs`, `rvOf`, `plOf`, plus `resolve`, `resolveReq`, `ownTcsOf`, `carriedBugsOf`, and `blockingBugsOf`. Frontmatter is read with the YAML 1.2 core schema and unique keys; files are LF-only. A REQ follows the current body contract (`v2`) when its frontmatter carries the contract's schema key and version; a blocked REQ is judged by its `blocked_from_status` (`effectiveStatus`).

### Load the artifact contract

`loadArtifactContract(text, label = 'artifact-contract.yml')` returns `{ contract, problems }`: the seven REQ headings, banned headings, section and body budgets, the acceptance-entry budget, priorities, scopes, and pending-decision labels; the four TC headings, budgets, and manual marker; BUG severities; the four PL headings and budget; the review vocabulary (conclusion label, verdicts, fixed fields, scope and evidence fields, checklist count, waiver and deferred markers, budgets); and the implementation lexicon (regular-expression categories and allowed terms). `DEFAULT_ARTIFACT_CONTRACT` is the English contract the orchestrator scaffolds; its budgets are 2.5 times the Chinese originals. Structural problems are reported together with their paths; content problems (a heading naming two sections, a banned heading that is a section, a budget for an unknown heading, a field outside the fixed fields, a pattern that does not compile) are reported together once the structure is valid.

### Lint

`lint({ graph, contract, table, registry, idScheme, workspace })` runs every rule group to completion and returns `Violation[]` (`file`, `rule`, `message`); graph problems come first under rule `graph`. Without a `registry`, ownership and signer checks are skipped; without an `idScheme`, scope placement is skipped. `workspace` is a `FileProbe` (`kind(path)` → `file`, `directory`, or `missing`) the link rule resolves targets against. The rule ids:

| Group | Rules |
|---|---|
| Frontmatter | `placement`, `req-fields`, `tc-fields`, `bug-fields`, `req-frontmatter`, `blocked-fields`, `pr-number`, `archive-consistency`, `artifact-uniqueness` |
| REQ body (live REQs on the current schema) | `req-body`, `req-budgets`, `ac-ids` (id uniqueness also across archived and legacy REQs), `how-lexicon`, `pending-decisions` |
| PL and links | `pl`; `links` for current-schema REQs, their TCs, and every BUG, RV, and PL |
| TC | `tc-frontmatter`, `ac-coverage`, `tc-body`, `tc-status`, `deferred-verification` |
| RV | `rv-structure`, `rv-signatures`, `rv-gate-pass`, `rv-budgets`, `rv-regression`, `rv-external-review` |
| Lifecycle consistency | `tc-policy`, `bug-binding`, `bug-frontmatter`, `bug-closure`, `bug-closed` |

### Judge a step

`evidence({ pre, post, table, contract, registry, reqId, eventPr })` pairs the tree before a step with the tree after it. `checkTransition(evidence, transition)` returns every problem: another REQ moved, a guard that did not hold on `pre`, an effect that does not hold on the change, or a lifecycle-sensitive change outside `may_change`. `checkEvent(evidence, event)` additionally requires the REQ's status and owner unchanged. `checkClauses` evaluates guards or effects alone; `PREDICATES` maps every name of the English table vocabulary to its check (`on: 'pre'` for guards, `'delta'` for effects), and a clause naming an unknown predicate is a problem. `sensitiveDelta(pre, post, table)` lists the changes by `may_change` kind; `changedReqs` lists the REQs whose status or owner moved; `restorePairFor` derives the T16 restore pair: the recorded pair while blocked, `req_review` / planner when self-carried, `req_impl` / generator from `pr_draft`, otherwise the restore target whose rejection transition leaves the source state.

### Apply effects and write

`planEffects({ graph, table, contract, registry, reqId, clauses, decisions, eventPr, ownerFor, read })` turns a transition's or event's effects into whole-file writes over the tree the child left: REQ status, owner (`ownerFor(role, state)`), counters, `pr_number`, blocked fields and the restore pair, TC and BUG statuses in scope, and regression-line withdrawal. Effects that admit several values (`req.fields_set`, a multi-valued `tc.status_to` or `bug.status_to`) take the choice from `decisions`; a single-valued status effect without decisions applies to every artifact in scope, only to those in `from` when given. Review-record effects are verified by the predicates, never written. Problems (an undecided field, a decision outside scope or the allowed values, an unknown scope or effect, no agent for a role) return no writes. `editFrontmatter(text, edits)` keeps field order, quoting, and comments and writes lists in flow style; `withdrawRegression(text, tcIds)` drops the regression lines citing the TCs. `writeAtomically(root, writes, fs?)` replaces each file through a temporary name and rename and, on failure, restores every file already replaced to its original bytes (removing files it created) before rethrowing; a rollback that fails throws an `AggregateError`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the modules are split; the observable behavior lives in [Use this package](#use-this-package).

### Design concept

- **Files are the only truth.** The graph is rebuilt from the tree for every lint and every step; nothing is cached across calls.
- **Visible text decides.** One mask blanks fenced code, indented code, and HTML comments before headings, entries, links, checklist items, and lexicon hits are read, so examples never count as facts.
- **Rules run to completion.** Every rule group is a pure function returning violations; one lint shows every defect, and the fixture pins one satisfy and one violate case per rule.
- **Guards read `pre`, effects read the change.** The two trees never stand in for each other, and the applier plans from the child's tree with the same predicates that later judge it.
- **The contract, not the code, carries language.** Headings, labels, budgets, and lexicon patterns come from `artifact-contract.yml`; state names, ids, and result words are fixed protocol vocabulary.

### Source map

| File | Role |
|---|---|
| [`src/text.ts`](src/text.ts) | LF splitting, the visibility mask, H2 slicing, code-point length |
| [`src/frontmatter.ts`](src/frontmatter.ts) | Frontmatter block splitting and value coercions |
| [`src/ids.ts`](src/ids.ts), [`src/acceptance.ts`](src/acceptance.ts), [`src/review.ts`](src/review.ts), [`src/markdown-links.ts`](src/markdown-links.ts) | Id shapes and derivations, acceptance items, review sections and regression lines, link syntax |
| [`src/artifacts.ts`](src/artifacts.ts), [`src/graph.ts`](src/graph.ts), [`src/source.ts`](src/source.ts) | Nodes, the graph and its relations, directory and memory sources |
| [`src/contract.ts`](src/contract.ts), [`src/defaults.ts`](src/defaults.ts) | Contract schema, loader, and the English default |
| [`src/lint.ts`](src/lint.ts), [`src/rules/`](src/rules/) | The lint entry and the rule groups over a shared `LintContext` |
| [`src/predicates.ts`](src/predicates.ts) | Evidence, the predicate registry, restore pairs, the sensitive delta, step checks |
| [`src/apply.ts`](src/apply.ts), [`src/writer.ts`](src/writer.ts) | Effect planning, frontmatter editing, atomic writes |
| [`src/format.ts`](src/format.ts), [`src/index.ts`](src/index.ts) | Message rendering; consumer interface |
| — | No runtime invariant companion is published; every function returns values from its arguments and keeps no state. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the function contracts are not enough. They move from this library to the tables it judges against and the team design it serves.

- [Lifecycle table](../lifecycle-table/README.md) — the table, registry, and id scheme every rule and predicate reads.
- [Lifecycle team](../../../.agents/notes/proposed/architecture/2026-09-26-lifecycle-team.md) — the team design whose artifacts this library parses and judges.
- [Experimental packages](../README.md) — where the orchestrator and the team profile appear as they land.

-----

<a id="model-experience"></a>
## Model Experience

None, as this is a work-item library; the orchestrator that renders lint results, step verdicts, and briefs owns every model-visible fact.

#### KV Cache effect

None; this package neither assembles nor sends a harness model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the library does not cover. They are current package constraints, not a task backlog.

- **LF only** — a file with CRLF line endings reports `missing YAML frontmatter` and never becomes a node.
- **No anchor checks** — the link rule resolves files, not heading anchors; a link to a missing heading passes.
- **Standards and glossary are not linted** — only artifacts under the tasks directory are read, and the allowed lexicon terms come from the contract, not from a glossary file.
- **Best-effort atomicity** — files are replaced one at a time; a crash between writes leaves a partial step that the next lint reports, and a failed rollback surfaces as an `AggregateError`.
- **Review-record effects are verified, not applied** — a child signs conclusions; the applier never edits an RV except to withdraw regression lines.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. The rules and predicates are ports of the factory-tools gates (`harness_rules.py`, `lifecycle_predicates.py`, `lifecycle_rules.py`); the port fixes the predicate defects the research found (`req.pending_questions_empty` reads the section, T16 uses the recorded restore pair, `bug.status_to.from` is enforced, `pending_bugs_in` relaxes only self-carried BUGs, `rv:regression` is part of the sensitive delta) instead of reproducing them. Every message is pinned by a spec row; changing a message means changing its row. `tests/step-scenarios.ts` holds one satisfying step per transition and event that the predicate and applier specs both replay.

</details>

**Runtime invariant:** No companion is published. Every function returns values computed from its arguments and keeps no state between calls.
