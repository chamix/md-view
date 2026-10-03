# Security Practices — Node.js Specific

> **Source & license:** curated, reworded extract — not a verbatim copy —
> informed by the security section of
> [goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices)
> (CC-BY-SA-4.0). Licensed **CC-BY-SA-4.0**, same as the source. See
> `THIRD-PARTY-NOTICES.md`.

Additive to `claude/knowledge/security/general.md` — read both. This file
holds only what doesn't generalize beyond the Node.js runtime.

## Dependency auditing tooling

- Run `npm audit` (or the Yarn/pnpm equivalent) as a build/CI step, not
  an occasional manual check. Fail the build on new high/critical
  advisories rather than only warning.
- For deeper, continuously-updated advisory coverage, a service like
  Snyk can be wired into CI and pull-request checks so a vulnerable
  dependency is flagged before it reaches `main`, not after.

## HTTP-layer hardening (Express and similar frameworks)

- Use a middleware like `helmet` to set secure default headers
  (`X-Content-Type-Options`, `X-Frame-Options`, a reasonable
  `Content-Security-Policy`, etc.) instead of hand-rolling them per
  route.
- For rate limiting, `express-rate-limit` (or the equivalent for
  whichever framework is in use) is a reasonable default for small/
  medium apps; larger deployments should push this to the load
  balancer / API gateway layer instead of application middleware.

## Untrusted code execution

- If the application ever evaluates user-supplied code or templates
  (plugins, formula engines, template strings), do not run it in the
  main process. Use a real sandbox (a separate process, a container, or
  a vetted sandboxing library) — Node's single-threaded event loop means
  a hung or malicious eval blocks everything else on that process.

## Environment configuration

- Load environment variables through a single, explicit entry point
  (e.g. `dotenv` in development) rather than scattering
  `process.env.X` reads across the codebase — makes it possible to
  validate required variables exist at startup instead of failing deep
  in a request handler.
