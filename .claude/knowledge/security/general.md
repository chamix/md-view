# Security Principles (Cross-Stack)

> **Source & license:** this file is a curated, reworded extract — not a
> verbatim copy — informed by the security section of
> [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices)
> (CC-BY-SA-4.0) and the [OWASP Top 10](https://owasp.org/www-project-top-ten/).
> Licensed **CC-BY-SA-4.0**, same as the source. See `THIRD-PARTY-NOTICES.md`.

Consumed as a **declared-per-task** knowledge module (ADR-006): the Lead
references this path in a delegation prompt whenever a task touches
anything security-relevant, regardless of stack. Stack-specific
additions live alongside their own stack (e.g. `nodejs/security.md`) —
this file stays free of anything that only applies to one runtime.

## Secrets management

- Never commit plain-text secrets (API keys, DB credentials, tokens) to
  configuration files or source code. Use environment variables or a
  dedicated secrets manager (e.g. Vault, cloud KMS, platform-native
  secrets stores).
- Treat `.env` files (or equivalent) as untracked-by-default; a
  committed `.env.example` with placeholder values is fine, real values
  are not.

## Authentication & password storage

- Never store passwords as plain text or with fast, general-purpose
  hashes (MD5, SHA-1/256 alone). Use a purpose-built, slow hashing
  function (bcrypt, scrypt, or Argon2) with a unique salt per user.
- Prefer existing, audited authentication libraries over hand-rolled
  session/token logic.

## Input validation & injection

- Treat all external input (request bodies, query params, headers,
  file uploads) as untrusted. Validate shape and type at the boundary
  before it reaches business logic.
- Use parameterized queries / an ORM's safe query builder for anything
  that touches a datastore — never string-concatenate user input into a
  query.

## Transport & network exposure

- Terminate all external traffic over TLS; redirect plain HTTP.
  Certificates are effectively free and simple to automate today, so
  there's no good reason to run production traffic unencrypted.
- Apply `Strict-Transport-Security` and standard security headers.
- Segment the network so each service has only the access it needs
  (least privilege at the network layer, not just the application
  layer).

## Availability & abuse

- Rate-limit public endpoints. Denial-of-service attempts are common
  and cheap to attempt; unprotected endpoints are an easy target.
- Fail closed on auth/authorization checks — an error in the check
  should deny access, not silently allow it.

## Dependency hygiene

- Third-party packages are a documented, high-frequency source of
  vulnerabilities (OWASP's list of top web-application risks includes
  vulnerable/outdated components). Audit dependencies regularly as part
  of the normal build/CI process, not as an occasional manual task.
  Stack-specific tooling for this lives in the relevant stack's own
  knowledge module.

## Logging & error handling

- Never log secrets, tokens, or full request bodies that might contain
  them.
- Return generic error messages to clients; keep stack traces and
  internal details in server-side logs only.
