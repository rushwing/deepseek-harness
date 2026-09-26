---
pl_id: PL-PLAT-009
tool: platform
linked_req: REQ-PLAT-009
---

## Contract changes

Rulings: [ADR-010](../../../../docs/adr/ADR-010-lifecycle-as-data.md) decisions 5 / 6, Notes 10–11; [ADR-011](../../../../docs/adr/ADR-011-cross-vendor-evaluator.md) (cross-vendor review seat).

| File | Change | When |
|---|---|---|
| harness/lifecycle.yml | version 2: every transition gains subjects / guards / effects / may_change; top-level events (bug_fix / bug_verify / regression / external_review / bug_redirect) and a predicates vocabulary; T16 / T19 post becomes effects. Key set in the table below | T11 (the v1 loader rejects unregistered keys, so it cannot land at T02) |
| agent-registry.yml | T02: planner-001 model, evaluator-002 effort and description, header comment on the two set kinds; T11: each provider_sets entry gains kind (same_vendor / cross_vendor), a new mixed set, active_set → mixed | T02 / T11 |
| The seven spec mirrors (requirement / review / agent-standard, briefs, README, GLOSSARY, CLAUDE.md) | T15 subject, non-transition events, External review section rules, adversarial framework, Codex contract, the two set kinds, the transition-evidence row | T02 |
| requirement-standard §4 transition table Actor / Owner columns | `planner-001` etc. become `<role>-<NNN>` placeholders (Q-05); the anchored fragments in `tests/gates/test_lifecycle_table.py::TestMutationDetection` change in step | T11 |
| .github/workflows/ci.yml | checkout `fetch-depth: 0`; the fifth step runs `req_lint.py --transitions --event "$GITHUB_EVENT_PATH"` only on the `pull_request` event; ADR-010 / 011 set to accepted in the same batch | T11 |

## Module placement and slices

| Location | Content | AC |
|---|---|---|
| `scripts/gates/harness_git.py` (new, the only import of subprocess) | `GitTreeSource(repo, sha)` implements `Source`: one `git ls-tree -r -z` fetches harness/tasks, the registry and the table, text is read by oid via `cat-file --batch` and cached across the chain; `Chain.from_range`: `merge-base`, `rev-list --first-parent --reverse`, one `git log` for %H %P %s %b and the Co-Authored-By trailer; `GitUnavailable` → one violation containing the range | 03, 04 |
| `harness_model.py` | `Source.read_optional`; `_parse_registry(source)` goes through Source | 03 |
| `harness_lifecycle.py` | `SUPPORTED_VERSIONS = {1, 2}`; v2 keys: `transitions[*].subjects` (regex list, default `^harness: T<id> —— \S`), `guards`, `effects`, `may_change` (⊆ sensitive-object kinds: eight REQ fields, tc_status, bug_status, rv:<section>); `events[*]` same shape plus `req_unchanged: true`, schema-level ban on effects / may_change containing req_status / req_owner; `predicates` (data: name → parameter signature; code: name list); self-consistency: closed reference set, transition subjects contain exactly one own id, event subjects contain no id | 01, 02, 14 |
| `scripts/gates/lifecycle_predicates.py` (new) | pure-data predicates (parameter signatures registered in the table's predicates section): `req.status_delta`, `req.owner_role`, `req.counter_inc`, `req.pr_number_eq_event`, `tc.status_delta`, `bug.status_delta`, `rv.gate_conclusion` (round = first-parent tree's round for the section + 1, req_review additionally = review_round), `rv.only_sections_changed`, `rv.regression_lines_withdrawn`, `no_sensitive_change`; code predicates: `restore_target_legal`, `t19_source_legal`, `carried_origin_tcs_excluded`, `carried_bugs_closed` | 07–14 |
| `scripts/gates/lifecycle_rules.py` (new) | `segment(chain)`, `check_transition(pre, post, commit, transition)`, `check_event`, `run_transitions(repo, base, head, event_pr, table_mode=pre/head)`; **unit of evidence = commit**: transition-commit guards against the p1 tree, effects against diff(p1 → c); a non-transition commit's sensitive-object diff must be empty unless its subject matches an event and the delta ⊆ that event's effects; segments are only for grouping / reporting (ADR-010 decision 5's "segment delta" = transition commit delta + in-segment event deltas); **judging table and activation**: default is the p1 tree's table; p1 without key and c's own tree with key (activation commit) → check its delta with c's own table; p1 and c both without key and no keyed tree before c on the chain (including base) → vacuum; after a key has appeared, p1 lacking the table / key → violation; **merge commits**: `merge-base --is-ancestor p2 base.sha` holds → every sensitive object with a delta relative to p1 must equal p2's value; otherwise → checked as an ordinary commit; **parse failure**: each checked commit's p1 tree and own tree must have empty `Graph.problems`, a loadable table and a readable registry, otherwise one violation for that commit naming the file and commit, no predicate evaluation; violation lines by kind: transition commit `<short> <T code> <REQ>.<field|section>: …` (with `~T code` appended when it resembles another transition), event commit `<short> <event> <REQ|TC|BUG|RV id>: …`, ordinary commit `<short> <object>: …`, parse failure `<short> <file>: …`, range failure `<range>: …`; the Co-Authored-By normalisation table (registry model ↔ trailer model name) is notice only | 05–15, 31 |
| `req_lint.py` | `--transitions --event <path>` (reads `pull_request.number / base.sha / head.sha`) and `--range <base>..<head> [--table head]`; behaviour without arguments unchanged | 04, 06, 16 |
| `check_agents.py` | two provider-set kind rules: `kind` required, `same_vendor` all one vendor, `cross_vendor` generator and evaluator from different vendors; missing kind, unknown kind and empty members one violation each; all three roles present | 19 |
| `harness_rules.py` | BUG-PLAT-005: `check_tc_policy_exit` early return narrowed to the two places `reachable_states` / `at_or_after`; BUG-PLAT-006: `heading_text` strips `\s+#+\s*$`; new `check_rv_external_review`: when the External review section exists, non-empty findings rows must parse to six columns, Disposition non-empty, conclusion signer role ∈ {human, evaluator}, with malformed / missing column / missing disposition / wrong role each naming the row | 23, 26, 27 |
| `req_lint.py` / `harness_gate_api.py` | BUG-PLAT-003: delete the `any(... is_file())` guard, group J traverses all six unconditionally; `build_tree` lands compliant copies of the six specs by default | 24 |
| lifecycle.yml v2 per transition | guards: the T03 family requires Pending decisions == None and RV req_review PASS; T06 tc_review PASS; T09 / T13 their section PASS; T11 carried BUGs all resolved; T14 carried BUGs all closed, no failing, pending empty; T16 pending all closed (self-carried restoring to req_review may be resolved); T19 from ∉ {done, blocked}. effects: status_delta and owner_role for all; review_round +1 on T03 / T03b / T03c / T04 / T15@req_review; T06 tc → reviewed (own, excluding carried origin TCs); T12 tc → failing (own ∪ carried); T13 tc → passing / failing (own ∪ carried) + bug → closed (carried) + rv:regression (another REQ's RV); T16→req_review / T19 tc → draft (own), bug closed → resolved (carried), rv regression lines withdrawn; T15 status → blocked + pending_bugs non-empty + blocked_reason + restore pair = (to, owner_after) of the reject transition matching the source state (req_review→T04, tc_review→T07, tc_impl_review→T10, req_impl_review→T12, pr_draft→req_impl / generator; self-carried always req_review / planner), T16 clears the four fields + status / owner per the restore target; bug_redirect event guard: first-parent tree REQ status = blocked and owner role = human; effect only changes blocked_from_* → req_review / planner; T11 and exempt T02 pr_number_eq_event; may_change lists only the objects above for each | 07–13, 32, 33 |

Slice order: BUG fixes → Source / GitTreeSource → table v2 → predicates and segmentation → entry point and CI → registry → ADR. A single T11 PR.

## Test support

- `tests/gates/lifecycle_recipes.py`: one (satisfy, violate) recipe pair per predicate, building the pre-tree with the harness_gate_api constructors and applying effects to get the post-tree.
- `test_lifecycle_generated.py`: positive cases parametrised over all 21 transitions and 5 event kinds; negative cases = each guard and each effect torn out once, plus the categories listed in AC-17 (three activation states, two merge kinds, parse failure, T15 restore pairs for the five sources, bug_redirect on a non-blocked / non-human first-parent tree); chain-end table mode. `test_req_lint_rv.py` gains the External review six-column / disposition / signer-role negative cases (AC-23). Review records collected / passed / skipped / xfailed, the last two must be 0 (AC-17, 29).
- `test_lifecycle_git.py`: tempfile `git init` legal chain / split-commit chain / event chain / no common ancestor / git missing.
- Manual TCs: PR #22 chain replay (AC-18: 2bb6571, 1ebf3c4, ff7ecdb, 2d9c95e; replay only, no retroactive enforcement); this REQ's chain with effects torn out and replayed (AC-29); spec / ADR / GLOSSARY text checks (AC-20–22, 28); CI fifth-step text (AC-16).
- fixture: after `build_tree` lands the six spec copies, all 007 / 008 tests stay green (AC-24).

## Risks and open technical points

- Bootstrapping: activation falls on the T11 implementation commit (checked by its own table); if T12 / T13 misfire the only fix is amend + force-with-lease.
- The Codex sandbox has read-only .git (tested): evaluator-002 changes only the working tree, the planner commits on its behalf with its trailer.
- Early PR #22 commits lack review_round and other fields, so the replay is noisy; the manual TC asserts only the known named commits.
- squash / rebase merges destroy the chain; only the merge commit survives.
