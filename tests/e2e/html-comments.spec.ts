import * as path from 'path';
import { test, expect } from './support/fixtures';

test.use({ electronArgs: [path.join(process.cwd(), 'tests/e2e/fixtures/with-html-comment/doc.md')] });

test('strips standalone HTML comments from the rendered preview while leaving fenced/raw HTML literal', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  const content = window.locator('#content');
  await expect(content).toContainText('HTML Comment Fixture', { timeout: 10000 });

  const text = await content.textContent();
  expect(text).not.toContain('should not be visible');
  expect(text).not.toContain('should also be stripped');
  expect(text).toContain('INSIDE a fenced code block');
  expect(text).toContain('This raw tag sits outside any fence');
});
