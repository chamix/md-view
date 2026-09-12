# ADR-008: Adopt zod for settings.json schema validation

## Status
Accepted

## Context
Task 37 introduces the app's first on-disk, human-editable persistence
(`settings.json`) and needs to validate arbitrary file content (which a
user can hand-edit into any shape) against a defined schema before
trusting it, distinguishing "fully valid" from "reject entirely" with
no partial-key recovery in this version. None of the app's current
dependencies (`chokidar`, `github-markdown-css`, `highlight.js`,
`markdown-it`) do schema validation, so this is a new dependency and,
per this project's standing convention of disclosing the trade-off
before adding a library (established for the chokidar-over-`fs.watch`
and highlight.js-over-Shiki decisions, per `CLAUDE.md`'s Dependency
note convention — those predate this project's ADR-file practice and
were disclosed inline rather than as standalone ADR documents), the
trade-off against not adding one must be disclosed here before the
choice is made.

## Decision
Add `zod` and validate `settings.json` with a `.strict()`-at-every-level
object schema (rejecting unknown keys as well as wrong types/missing
keys), rather than hand-rolled type-guard functions.

## Alternatives considered
- **Hand-rolled type guards** (`typeof x === 'boolean'` checks chained
  through a plain function, zero new dependency). Viable and sufficient
  for today's exact shape — three booleans under one namespace — but
  the functional_domain.md Task 37 entry explicitly frames this schema
  as one namespace among others a growing settings file will add over
  time (an `Editor` or `Window` section, say), each with its own nested
  shape. Hand-rolled guards do not compose: every new nested object
  needs its own hand-written recursive checker, re-deriving what a
  schema library already generalizes, and the failure mode (a typo'd
  guard silently under- or over-validating a new nested field) has no
  compile-time or runtime cross-check the way a declarative schema's
  own `.strict()`/type-inference does. Rejected for this task
  specifically because the schema is stated to grow, not because
  hand-rolled guards are wrong in general — they remain the right
  choice for a fixed, small, non-growing shape elsewhere in this
  codebase.
- **`ajv`** (JSON-Schema-based validation). Rejected: JSON Schema is a
  second schema language to hand-maintain in sync with the TypeScript
  `SettingsFile` type it describes; zod's schema *is* the source of
  static type inference (`z.infer<...>`), so there is exactly one
  definition to keep correct, not two.
- **`io-ts`**. Rejected: comparable capability to zod, but a materially
  smaller ecosystem/maintenance footprint and less ergonomic error
  reporting for this project's "the pure function just reports
  pass/fail" needs; zod's `.safeParse()` shape maps directly onto that
  requirement with less code.

## Consequences
- `zod` joins the app's dependency list; `src/main/settings.ts` is the
  only file that imports it — no other module needs to know validation
  is zod-based rather than hand-rolled, since `parseSettings`'s
  exported contract is just `(raw: string) => SettingsFile | null`.
- Future settings-schema growth (new namespaces/keys) extends the one
  zod object in `settings.ts`, not a hand-rolled checker scattered
  across call sites — this is the concrete payoff this ADR is betting
  on; if the schema never actually grows beyond v1's three booleans,
  this dependency will have bought more generality than was strictly
  needed for that narrower outcome.
