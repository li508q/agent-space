# AgentSpace documentation

AgentSpace is a local workspace for direct writing and clear collaboration with AI agents. Begin with the usage guide; the engineering documents explain the shared data model, implementation and verified boundaries.

## Use the product

| Language | Overview                        | Usage guide                      |
| -------- | ------------------------------- | -------------------------------- |
| English  | [README](../README.md)          | [Using AgentSpace](guides/en.md) |
| 简体中文 | [项目介绍](../README.zh-CN.md)  | [使用指南](guides/zh-CN.md)      |
| 日本語   | [概要](../README.ja.md)         | [使い方](guides/ja.md)           |
| 한국어   | [소개](../README.ko.md)         | [사용 안내](guides/ko.md)        |
| Español  | [Presentación](../README.es.md) | [Guía de uso](guides/es.md)      |

## Understand the product

- [Product brief](product-brief.md): the focused promise and first-release scope.
- [Requirements](PRD.md): interview-origin scenarios and concrete acceptance targets.
- [Interaction design](UX.md): writing, review, navigation and recovery behavior.
- [Design system](design-system.md): visual and interaction rules.
- [Delivery evidence](DELIVERY.md): phase outcomes and delivery status.

## Build and integrate

- [Architecture](ARCHITECTURE.md): Core, adapters, native boundary and decisions.
- [Core API](CORE_API.md): strict commands, reads, references and mutation contracts.
- [Agent protocol](AGENT_PROTOCOL.md): the actual MCP tools, CLI and configuration.
- [Desktop](DESKTOP.md): native behavior, development and application packaging.
- [Local data](LOCAL_DATA.md): import, backup, readable export, restore and drafts.
- [Data and trust boundaries](SECURITY.md): authority, access, observed activity and local file protection.
- [Implementation](IMPLEMENTATION.md): implementation slices and source ownership.
- [Verification](TESTING.md): executed checks, scenario coverage and precise limits.
- [Contributing](../CONTRIBUTING.md): development commands and contribution expectations.

The usage guides are localized. Technical contracts use English to keep one reviewable reference. Research and private interview source material are retained separately; this public repository contains the resulting product requirements and decisions, without personal source files.
