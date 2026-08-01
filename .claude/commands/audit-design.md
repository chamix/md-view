---
description: Architectural compliance audit (Clean Architecture, SOLID, GoF) via the independent code-reviewer
---

Delegate to the code-reviewer subagent, not yourself — the Lead authored the rules being checked. Audit files changed on this branch (`git diff --name-only main...HEAD`) plus anything staged, against the standards in CLAUDE.md:

1. Clean Architecture check: dependencies pointing strictly inward; no framework leaks in the domain.
2. SOLID verification: SRP violations, coupling that should rely on DIP abstractions.
3. GoF pattern review: structural complexity handled with appropriate patterns.

Report in three sections with evidence (diff hunks cited): Compliant Areas / Architectural Risks & Violations / Refactoring Strategy. $ARGUMENTS
