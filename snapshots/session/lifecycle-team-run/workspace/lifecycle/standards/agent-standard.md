# Agent Standard (multi-agent registration and identity mapping specification)

This repository uses multiple LLMs to assist development and review. This specification defines the registration mechanism for **abstract identity ↔ actual model**,
with the single source of truth in [`agent-registry.yml`](agent-registry.yml), validated by the gate
[`scripts/gates/check_agents.py`](../scripts/gates/check_agents.py) (CI-blocking).

## 1. The three abstract roles (Planner / Generator / Evaluator)

Taken from Anthropic's "[Harness Design for Long-Running Agentic Applications](https://www.anthropic.com/engineering/harness-design-long-running-apps)":

| Role | Responsibility | States handled (`handles`) |
|---|---|---|
| **Planner** | Expands a REQ/goal into a spec and a plan (scope, technical direction, decomposition), without getting stuck in implementation detail | `req_review` (design side) |
| **Generator** | Implements iteratively per the spec (TC code / requirement code / documentation), **self-checks before delivery** | `tc_review` / `tc_impl` / `req_impl` |
| **Evaluator** | Independent quality gatekeeping: **writes the TC text that sets the acceptance criteria** + reviews + runs the gates to judge pass/fail | `req_review` / `tc_design` / `tc_impl_review` / `req_impl_review` |
| **human** | The human orchestrator: approves scope, rules on Pending decisions within req_review and pulls back for a rewrite, final merge, clears blocked and redirects, decides on model selection | `draft` / `req_review` / `pr_draft` / `blocked` / `done` |

> 🔴 **Separation principle**: Generator and Evaluator must be **different identities** — a model has a self-flattering bias toward its own output,
> and only an independent Evaluator can give objective, actionable feedback. `check_agents.py` blocks the same UID holding both roles.

> 🔑 **The one who sets the standard ≠ the one who implements it**: `tc_design` (writing the TC text = setting the acceptance criteria) belongs to the Evaluator,
> `tc_impl` / `req_impl` (writing code) belongs to the Generator.

## 2. Naming and registration

- **Naming**: `<role>-NNN` (e.g. `planner-001`); the human is `human-001`.
- **One identity, multiple models**: each agent has a `model` (primary binding) + `fallbacks` (an ordered list of alternates).
  When the primary model is unavailable/rate-limited, it falls through to the next alternate; the **UID does not change**, so the attribution of reviews/commits stays stable.
- **`handles`**: the lifecycle states this agent may hold, equal to that role's legal states as derived from the [lifecycle.yml](lifecycle.yml) transition table; the gates check they are exactly equal; the §1 table and requirement-standard §0 are mirrors of each other.
- **Bindings can evolve**: once a model's capability improves, just change `model` / `effort` — no need to change the process or rewrite history.

## 3. Provider sets — two kinds, cross-vendor is the default

`provider_sets` registers planner/generator/evaluator as complete sets, and `active_set` points at the one currently in effect. Sets fall into two kinds (the cross-vendor evaluator decision (ADR-011)):

- **Cross-vendor set** (the default active one): the generator's and evaluator's models come from different vendors. Two REQ-PLAT-007 / 008 cycles showed empirically: three rounds of internal review from the same model family caught not a single
  implementation-level P1 ahead of an external one, while one round of Codex caught 14 — a model has a systematic blind spot for its own family's output, so an independent evaluator must switch vendors to actually be independent.
  Currently active: planner-001 / generator-001 / evaluator-002 (Codex CLI, invoked locally and non-interactively by the orchestrating session); tc_impl_review is a mechanical, code-level review, and
  per the agreement at the top of [briefs.md](briefs.md) is assigned to the same-vendor evaluator-001.
- **Same-vendor set** (fallback): every member is from the same vendor, letting one vendor's flagship model run the whole process with subagents from its own family. The original reasoning for "one agent set must be same-vendor" was that
  Claude Code was thought unable to call the Codex CLI, which stopped holding as of 2026-09-11; the same-vendor set only switches in wholesale when the cross-vendor set is unavailable.

Therefore:

- `fallbacks` still **prefers the same vendor first** (e.g. `claude-opus-5` → `claude-opus-4-8`), with cross-vendor placed last — this is the alternates for a single agent, not the category of the set;
- switching uses `active_set` to switch as a whole, not swapping models agent by agent; the UID does not change;
- `check_agents.py` checks by category: mixing multiple vendors within a same-vendor set is a violation, and the cross-vendor set's generator and evaluator being the same vendor is a violation (only same-vendor is recognized before REQ-PLAT-009 lands).

## 4. Basis for model and effort selection

> ⚠️ Every entry below is **a binding with a specific reason**, not something filled in casually. Read the corresponding entry in full before changing a binding.

### Current bindings

| UID | Model | effort | Reason |
|---|---|---|---|
| `planner-001` | `claude-fable-5-1` | `xhigh` | Fable 5.1's thinking is always on and cannot be turned off, so depth can only be tuned via effort. The vendor recommends `high` for most tasks and `xhigh` for capability-sensitive scenarios; architecture and spec decomposition are the latter. |
| `generator-001` | `claude-opus-5` | `xhigh` (`high` for `tc_impl`) | Opus 5 is recommended to start at `xhigh` for coding/agentic work. But this generation's `low`/`medium` punch unusually far above their weight — once implementation has landed, **an effort sweep should be run per route** and then settled; don't treat `xhigh` as a permanent default. TC code is relatively mechanical, so `high` is already enough. |
| `evaluator-001` | `claude-sonnet-5` | `high` (`xhigh` for `req_impl_review`) | Sonnet 5's default `high` already covers most reviews; `req_impl_review` is the last gate before merge, worth the extra tier. Review is "mostly reading, little writing" — it doesn't need `xhigh` throughout. Under the cross-vendor set it takes only `tc_impl_review`. |
| `evaluator-002` | `gpt-5.6-sol` | `xhigh` | The cross-vendor set's evaluator seat (`req_review` / `tc_design` / `req_impl_review`), invoked non-interactively via the Codex CLI; review is the last, adversarial, independent gate, so `xhigh` throughout. |

> `claude-sonnet-4-8` **does not exist** — the Sonnet line runs 4.5 → 4.6 → 5. Don't make up a model number from memory when writing the registry;
> look it up if unsure — getting it wrong fails silently with a 404.

### Model-specific prompting gates

These rules **directly affect the quality of what the harness produces**, and must be followed when writing prompts:

| Subject | Rule | Why |
|---|---|---|
| **Evaluator (Sonnet 5 / Opus 5)** | Review prompts **must not** say "only report high-severity" / "be conservative" / "don't nitpick." Instead say "**report everything**, with confidence and severity on every item," and leave the filtering to `human-001` | This generation of models will follow it to the letter — it still checks just as carefully, then proactively drops findings it judges to be below the bar itself. Precision goes up, **recall goes down**, and a missed finding is review's most expensive failure |
| **Generator (Opus 5)** | **Delete** all "double-check your answer" / "add one more verification pass at the end" scaffolding | Opus 5 already verifies on its own; an explicit request stacks on top into over-verification, burning tokens and lengthening turns |
| **Generator (Opus 5)** | Give it explicit **scope discipline**: do only what the requirement asks, no opportunistic refactoring, no unrequested abstraction or defensive code | It tends to expand task scope on its own |
| **Generator (Opus 5)** | Give it an explicit **subagent ceiling**: don't dispatch a subagent for something that can be done in a few steps itself; keep review/verification in the main loop | It is more eager to open subagents than the previous generation, and every subagent has to rebuild context, doubling the cost |
| **Planner (Fable 5)** | Write prompts with **goals and constraints**, not step-by-step prescribed methods | An overly prescriptive prompt **degrades** Fable 5's output quality; step-by-step scaffolding written for older models should be deleted |
| **All agents** | Terminology always uses the canonical words from [GLOSSARY.md](../GLOSSARY.md) | Avoids the same concept having three different names across the REQ, the TC, and the code |

These rules are already written into the "How to write" and "General prohibitions" of every section in [briefs.md](briefs.md); task briefs are drawn uniformly from there, and are not rewritten for every session.
`check_agents.py` scans briefs.md, and finding one of the banned phrases in the table above is a red flag; the table above and the gate's constants mirror each other, and either side changing while the other does not is likewise red ([GUIDE §6](GUIDE.md#6-gates)).

### When to change a binding

- A clearly stronger same-vendor model appears → change `model`, with `fallbacks` shifting the old model down;
- A given state keeps going over budget → lower `effort` first, then consider changing the model;
- A given state's quality is unstable → raise `effort` first and check whether it has tripped the prompting gates in the table above, **then** consider changing the model.

Changes to `agent-registry.yml` go through a PR, validated as a CI-blocking check by `check_agents.py`.

## 5. Usage

- Actions in a REQ / TC / BUG / ADR are signed with a role-UID (`owner` / ruling / fix record).
- One role may have multiple instances (e.g. `evaluator-001` / `evaluator-002` doing multi-AI adversarial review).
- An agent must pass the [three preflight checks](requirement-standard.md#0-mandatory-preflight-protocol-hard-stop) before starting work.
