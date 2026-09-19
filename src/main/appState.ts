import { z } from 'zod';

// Internal bookkeeping, deliberately NOT part of settings.json (guardrail
// #136 / ADR-009). .strict() so an unknown key fails validation exactly like
// a missing key or wrong-typed value does -- no partial recovery (#135).
const appStateSchema = z
  .object({
    lastSeenVersion: z.string().min(1),
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
