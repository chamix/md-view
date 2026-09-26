import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// Task 44 #146: the ONE definition of "the document view is pristine". Used
// both by ui-shell.spec.ts's no-argv launch test and by close-document.spec.ts
// after Close, so round-trip equivalence is proven against the same
// locators/assertions as launch, never a re-derived expectation.
//
// Keeps every assertion the original inline launch test made (#empty-state
// visible, status bar "No file open", #copy-raw-source disabled -- Task 7 /
// Task 34 #100), and extends it with the rest of #146's pristine facts.
export async function expectPristineDocumentView(window: Page): Promise<void> {
  await expect(window.locator('#empty-state')).toBeVisible();
  await expect(window.locator('#status-bar')).toHaveText('No file open');

  // Task 34 guardrail #100: the copy-raw-source button is disabled whenever
  // there's no successfully-rendered file.
  await expect(window.locator('#copy-raw-source')).toBeDisabled();

  await expect(window.locator('#content')).toBeEmpty();
  await expect(window.locator('#code-content')).toBeEmpty();
  await expect(window.locator('#frontmatter')).toBeHidden();
  // Hidden is not enough: at launch #frontmatter is also empty (#146).
  await expect(window.locator('#frontmatter')).toHaveText('');
  await expect(window.locator('.tree-row-active')).toHaveCount(0);

  // The pristine screen already shows the (empty) document card; Close
  // restores that, it never hides or removes it.
  await expect(window.locator('#document-container')).toBeVisible();
}
