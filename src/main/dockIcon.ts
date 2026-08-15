// Pure predicate isolating the dev-mode Dock-icon decision so it can be
// pinned by a plain unit test without a running Electron instance. No
// Electron imports, no top-level side effects — see
// .agents/specs/functional_domain.md Task 13 guardrail #5 and
// .agents/specs/initial_scaffold.md Task 13 Technical Specification.
export function shouldSetDockIcon(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return !isPackaged && platform === 'darwin';
}
