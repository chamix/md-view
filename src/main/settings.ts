import { z } from 'zod';
import type { ViewSettings } from '../preload/api';

// .strict() at both levels (functional_domain.md guardrails #103/#104): an
// unknown/extra key or a wrong-shaped 'View' object fails validation exactly
// like a missing key or a wrong-typed value does -- no partial recovery.
const settingsSchema = z
  .object({
    View: z
      .object({
        'Dark Mode': z.boolean(),
        'Show Frontmatter': z.boolean(),
        'Show File Tree': z.boolean(),
      })
      .strict(),
  })
  .strict();

export type SettingsFile = z.infer<typeof settingsSchema>;

// v1 defaults match today's existing session defaults exactly (confirmed
// with the user -- see functional_domain.md/initial_scaffold.md Task 37).
export const defaultSettingsFile: SettingsFile = {
  View: { 'Dark Mode': false, 'Show Frontmatter': true, 'Show File Tree': true },
};

// One pass/fail question, never distinguishing "bad JSON" from "bad shape"
// to its caller (functional_domain.md guardrail #104) -- JSON.parse syntax
// errors and zod schema failures both collapse to the same null result.
export function parseSettings(raw: string): SettingsFile | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = settingsSchema.safeParse(parsedJson);
  return result.success ? result.data : null;
}

// Narrow, symmetric adapter functions between the on-disk Title-Case/'View'-
// namespaced shape and the in-memory ViewSettings camelCase shape.
// currentTab is deliberately absent from both directions -- it is not part
// of the persisted schema (functional_domain.md Task 37 intro).
export function toPersistedViewSettings(
  file: SettingsFile
): Pick<ViewSettings, 'darkMode' | 'showFrontmatter' | 'showTreePanel'> {
  return {
    darkMode: file.View['Dark Mode'],
    showFrontmatter: file.View['Show Frontmatter'],
    showTreePanel: file.View['Show File Tree'],
  };
}

export function fromViewSettings(
  v: Pick<ViewSettings, 'darkMode' | 'showFrontmatter' | 'showTreePanel'>
): SettingsFile {
  return {
    View: {
      'Dark Mode': v.darkMode,
      'Show Frontmatter': v.showFrontmatter,
      'Show File Tree': v.showTreePanel,
    },
  };
}
