---
description: "The product-runtime group map: the pinned external agent products and their protocol clients that both the one-shot subagent providers and the conversation backends build on."
kind: "package-group"
---

# product-runtime/ — external agent product runtimes

English | [中文](README.zh.md)

## Summary

The harness reaches two external agent products, Codex and Claude Code, through their official integration surfaces: the Codex app-server protocol and the Claude Agent SDK. Each product is consumed twice: a one-shot subagent provider runs a fresh product conversation per delegation, and a conversation backend keeps one product conversation per Session. This group holds what those consumers share per product: the single pinned official runtime, the process command, the protocol client, and the permission-mode vocabulary. It provides no service, tool, or plugin; the consuming packages decide when a product starts and how a human is involved.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`codex-app-server`](codex-app-server/README.md) | Pins `@openai/codex`, builds the package-local app-server command, and offers the shared protocol helpers plus a persistent multi-thread connection | library — no ctx key |

Consumers keep product-specific lifecycle: the [Codex subagent provider](../subagent/subagent-codex/README.md) owns its one-shot run, and a conversation backend owns per-Session threads.

-----

<a id="related-documentation"></a>
## Related documentation

- [Subagent subsystem](../../docs/subsystems/subagent.md) — the seam the one-shot product providers register on.
- [External agent conversation backends](../../.agents/notes/proposed/architecture/2026-09-26-external-agent-conversation-backends.md) — why the runtimes are shared between the providers and the backends.
- [Claude Code and Codex backends](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md) — the one-shot providers' product protocols and process lifecycle.

-----

<a id="dev-note"></a>
## Dev Note

None.
