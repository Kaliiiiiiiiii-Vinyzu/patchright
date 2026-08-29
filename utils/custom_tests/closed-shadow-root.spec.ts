/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { expect, contextTest as it } from '../../config/browserTest';

it('should support representative locator operations in closed shadow roots @patchright', async ({ page }) => {
  await page.setContent('<div id="host"></div>');
  await page.evaluate(() => {
    const root = document.querySelector('#host')!.attachShadow({ mode: 'closed' });
    root.innerHTML = '<button class="item action" data-value="button">Click me</button><input value="input value">';
    window['clickCount'] = 0;
    root.querySelector('button')!.addEventListener('click', () => ++window['clickCount']);
  }, undefined, undefined, false);

  const button = page.locator('#host .action');
  expect(await button.count()).toBe(1);
  await button.waitFor({ state: 'visible' });
  await expect(button).toHaveText('Click me');
  expect(await button.textContent()).toBe('Click me');
  expect(await button.getAttribute('data-value')).toBe('button');
  expect(await page.locator('#host input').inputValue()).toBe('input value');
  expect(await button.evaluate(element => element.tagName)).toBe('BUTTON');
  expect(await page.locator('#host .item').evaluateAll(elements => elements.map(element => element.textContent))).toEqual(['Click me']);
  expect(await page.locator('#host .item').allTextContents()).toEqual(['Click me']);

  await button.click();
  expect(await page.evaluate(() => window['clickCount'], undefined, undefined, false)).toBe(1);
});

it('should preserve order and locator composition after closed shadow DOM changes @patchright', async ({ page }) => {
  await page.setContent('<span class="entry">light-1</span><div id="host"></div><span class="entry">light-2</span>');
  await page.evaluate(() => {
    const root = document.querySelector('#host')!.attachShadow({ mode: 'closed' });
    root.innerHTML = '<span class="entry">shadow-1</span><div id="nested"></div>';
    const nestedRoot = root.querySelector('#nested')!.attachShadow({ mode: 'closed' });
    nestedRoot.innerHTML = '<span class="entry" data-kind="target">nested</span>';
    window['shadowRootForTest'] = root;
  }, undefined, undefined, false);

  const entries = page.locator('.entry');
  await expect(entries).toHaveCount(4);
  expect(await entries.allTextContents()).toEqual(['light-1', 'shadow-1', 'nested', 'light-2']);
  await expect(entries.first()).toHaveText('light-1');
  await expect(entries.nth(2)).toHaveText('nested');
  await expect(entries.last()).toHaveText('light-2');
  await expect(entries.filter({ hasText: 'shadow-1' })).toHaveCount(1);
  await expect(entries.and(page.locator('[data-kind="target"]'))).toHaveText('nested');

  await page.evaluate(() => {
    window['shadowRootForTest'].querySelector('.entry')!.textContent = 'shadow-updated';
  }, undefined, undefined, false);
  expect(await entries.allTextContents()).toEqual(['light-1', 'shadow-updated', 'nested', 'light-2']);
});

it('should locate nested closed shadow DOM through a cross-origin iframe and XPath @patchright', async ({ page, server }) => {
  server.setRoute('/patchright-shadow-frame.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html><div id="frame-host"></div><script>
      const root = document.querySelector('#frame-host').attachShadow({ mode: 'closed' });
      root.innerHTML = '<div id="nested-host"></div>';
      const nested = root.querySelector('#nested-host').attachShadow({ mode: 'closed' });
      nested.innerHTML = '<button data-testid="shadow-button">Nested button</button>';
      nested.querySelector('button').addEventListener('click', () => document.body.dataset.clicked = 'true');
    </script>`);
  });

  await page.goto(server.EMPTY_PAGE);
  const frameUrl = server.CROSS_PROCESS_PREFIX + '/patchright-shadow-frame.html';
  const frameNavigation = page.waitForEvent('framenavigated', frame => frame.url() === frameUrl);
  await page.evaluate(url => {
    const root = document.body.attachShadow({ mode: 'closed' });
    const iframe = document.createElement('iframe');
    iframe.src = url;
    root.append(iframe);
  }, frameUrl, undefined, false);
  await frameNavigation;

  await expect(page.locator('iframe')).toHaveCount(1);
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('body')).toBeVisible();
  const cssButton = frame.locator('[data-testid="shadow-button"]');
  await expect(cssButton).toHaveText('Nested button');
  await expect(frame.locator('xpath=//*[@data-testid="shadow-button"]')).toHaveText('Nested button');
  await cssButton.click();
  await expect(frame.locator('body')).toHaveAttribute('data-clicked', 'true');
});
