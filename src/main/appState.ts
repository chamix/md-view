import { z } from 'zod';

// Internal bookkeeping, deliberately NOT part of settings.json (guardrail
// #136 / ADR-009). .strict() so an unknown key fails validation exactly like
// a missing key or wrong-typed value does -- no partial recovery (#135).
//
// Task 54 (#241/#242): all three fields are .nullable().optional() -- a
// deliberate, disclosed widening (lastSeenVersion was previously a required
// non-empty string) so a state.json written by any build through Task 53
// (missing the two new keys) still parses, with the new fields read as
// undefined rather than invalidating the whole file. .strict() is unchanged:
// an unknown extra key still invalidates everything (#135, no partial
// recovery -- that guardrail governs malformed data, not which keys a later
// schema version adds).
const appStateSchema = z
  .object({
    lastSeenVersion: z.string().min(1).nullable().optional(),
    lastFolderPath: z.string().min(1).nullable().optional(),
    lastFileOpenPath: z.string().min(1).nullable().optional(),
  })
  .strict();

export type AppState = z.infer<typeof appStateSchema>;

// One pass/fail question, never distinguishing "bad JSON" from "bad shape"
// to its caller -- same posture as parseSettings (guardrail #104).
export function parseAppState(raw: string): AppState | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = appStateSchema.safeParse(parsedJson);
  return result.success ? result.data : null;
}

export type WhatsNewDecision = 'first-launch' | 'up-to-date' | 'announce';

// Inequality, not ordering: a downgrade also announces (there is no
// version-comparison logic anywhere in this feature).
export function decideWhatsNew(lastSeenVersion: string | null, currentVersion: string): WhatsNewDecision {
  if (lastSeenVersion === null) return 'first-launch';
  return lastSeenVersion === currentVersion ? 'up-to-date' : 'announce';
}

// Task 54 (ADR-015): the single merge step behind index.ts's persistAppState
// choke point. A shallow merge -- `current: null` (fresh install, no
// state.json yet) defaults to `{}`. An explicit `null` in patch is a
// deliberate overwrite (e.g. Close's `{ lastFileOpenPath: null }`); callers
// never pass `undefined` for a key they don't mean to touch -- they omit the
// key entirely, which this merge then leaves exactly as `current` had it.
export function mergeAppState(current: AppState | null, patch: Partial<AppState>): AppState {
  return { ...(current ?? {}), ...patch };
}

// Task 54 (#252): the merge-write-catch logic behind index.ts's
// persistAppState choke point, extracted here (ports-based -- `write` and
// `warn` are injected, mirroring whatsNew.ts's WhatsNewPorts pattern) so the
// write-failure containment is unit-testable without index.ts's Electron
// composition-root scaffolding. `write` is called with the merged state so
// its own side effects (the real binding also updates index.ts's in-memory
// `appState`, synchronously, before any await -- preserving the existing
// choke-point ordering) happen before the write is attempted. A rejected
// `write` is caught and `warn`'d exactly once; it is NEVER rethrown, so the
// returned promise always resolves -- the fire-and-forget callers in
// establishTreeRoot/onOpenFileChanged (and the awaited 'will-quit' hold)
// never see a throw.
export async function persistAppStatePatch(
  current: AppState,
  patch: Partial<AppState>,
  write: (next: AppState) => Promise<void>,
  warn: (...args: unknown[]) => void = console.warn
): Promise<AppState> {
  const next = mergeAppState(current, patch);
  try {
    await write(next);
  } catch (error) {
    warn('md-view: state.json write failed', error);
  }
  return next;
}

export interface SessionRestoreInput {
  lastFolderPath: string | null;
  lastFileOpenPath: string | null;
  folderExists: boolean;
  fileExists: boolean;
}

export interface SessionRestoreDecision {
  folderPath: string | null;
  filePath: string | null;
}

// Task 54 (#246-#248): pure filter, deliberately simple -- each remembered
// path is kept only if its OWN existence flag says it is still there,
// independently of the other. Ordering, the divergent-folder case (#244) and
// not forcing the tree panel open (#245) are all orchestration concerns that
// live in index.ts, not here -- this function only answers "which of these
// two remembered paths are still valid targets?".
export function decideSessionRestore(input: SessionRestoreInput): SessionRestoreDecision {
  return {
    folderPath: input.folderExists ? input.lastFolderPath : null,
    filePath: input.fileExists ? input.lastFileOpenPath : null,
  };
}
