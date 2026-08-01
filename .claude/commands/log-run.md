---
description: Appends a row to the CLEAR-lite run log after a task closes (success, escalation, or rescope)
---

Trigger immediately after Step 3 (Deliver) of CLAUDE.md, once a task has reached a terminal state.

1. Gather: task description, personas involved, RGR cycles the engineer needed, the reviewer's top-line verdict from `.agents/specs/review_report.md`, and wall-clock time. Run `/cost` for real cost data; estimate and mark `(est.)` only if unavailable.
2. Append one row to `.agents/metrics/RUN_LOG.md`. Never rewrite or delete prior rows — this log is append-only.
3. Flag drift: if RGR cycles-to-green has risen for 2+ consecutive tasks, or the reviewer has issued 2+ consecutive Blocked verdicts, say so explicitly — that pattern usually means the specs are getting vaguer, not that quality is dropping.
4. Delete `.agents/current_scope.json` if it still exists — the contract is closed.
