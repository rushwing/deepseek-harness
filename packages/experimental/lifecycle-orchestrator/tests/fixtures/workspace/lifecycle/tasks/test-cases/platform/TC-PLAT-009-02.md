---
tc_id: TC-PLAT-009-02
tool: platform
linked_req: REQ-PLAT-009
verifies: [AC-PLAT-009-03]
title: "Field-by-field equivalence of the artifact graph built from a commit-tree Source and a worktree Source"
status: passing
level: e2e
owner: evaluator-002
automated: true
---

## Preconditions

Run `git init` inside `tmp_path`, use `write_req`, `write_tc`, `write_rv`, `write_bug`, `write_lifecycle` and the registry to write out a synthetic tree containing normal artifacts, archived artifacts and one parseable broken artifact, then commit it; all default values are fixed. For the same SHA create a `GitTreeSource` and, after checking that SHA out, a `WorktreeSource`; generating both sides' expectations from the same Source is not allowed. Additionally scan git access and rule-group calls with an import/AST probe. (A3, A4)

## Steps

1. `load_graph` each of the two Sources, serialise every node field, index, problems, broken and duplicates, then compare.
2. Commit once more a version that changes only one TC status, repeat the comparison for the new SHA, and confirm the old SHA's graph was not polluted by the cache.
3. Scan the gate modules: locate git command calls and the transition-evidence entry point; install a git stub that fails when calling the existing A–J rule groups.

## Expected results

- AC-PLAT-009-03: The two graphs for each SHA are field-by-field equal and values do not leak across SHAs; only `harness_git.py` executes git, the artifact-graph parsing layer makes no git calls, and rule groups other than transition evidence still complete under the failing stub without triggering it.

## Implementation location

`tests/gates/test_lifecycle_git.py::TestGitTreeSourceEquivalence`
