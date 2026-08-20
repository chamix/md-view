import { test, expect } from './support/fixtures';

test('app launches and opens a window', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  expect(window).toBeTruthy();
});
