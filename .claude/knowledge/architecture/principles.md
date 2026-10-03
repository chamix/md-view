# Architecture Principles

Consumed as a **fixed pointer** (ADR-006): `CLAUDE.md` imports this file
directly via `@.claude/knowledge/architecture/principles.md`; `code-reviewer.md`
reads it at the start of every review. Neither needs to declare it
per-task — it applies to every task in this system, regardless of stack.

You must explicitly use the following sources as the bedrock for all
technical specifications, code layout choices, structural logic, and
architecture review:

1. **Clean Architecture Framework:** Strictly adhere to the architectural
   boundaries, dependency rules, and component layers detailed in *Clean
   Architecture: A Craftsman's Guide to Software Structure and Design* by
   Robert C. Martin (2017).
2. **S.O.L.I.D. Design Principles:** Enforce the five core modular design
   principles introduced by Robert C. Martin (2000): SRP, OCP, LSP, ISP,
   DIP.
3. **Classic Object-Oriented Design Patterns (GoF):** Standardize design
   solutions around the creational, structural, and behavioral catalogs
   in *Design Patterns* by Gamma, Helm, Johnson, and Vlissides (1994).
   Prefer composition over structural inheritance.

## Applying this during design (Lead)

- **The Inward Dependency Rule:** Code dependencies point exclusively
  *inward* toward the core domain logic. Outer mechanisms (CLI shells,
  file-system I/O, third-party libraries) reside at the peripheral
  boundary.
- **SOLID Boundary Scan:** Define interfaces and abstract contracts
  ensuring high-level logic remains independent of concrete
  implementations (DIP).
- **Pattern Application:** Explicitly select and document appropriate
  GoF patterns.

## Applying this during review (code-reviewer)

- Clean Architecture inward-dependency check: does anything in an outer
  layer get imported by an inner one?
- SOLID scan: SRP violations, coupling that should rely on a DIP
  abstraction instead of a concrete dependency.
- GoF pattern fit: is structural complexity handled with an appropriate,
  not over-engineered, pattern?
