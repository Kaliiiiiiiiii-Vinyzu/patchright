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

it('should inject init scripts once without changing HTTP document parsing @patchright', async ({ context, page, server }) => {
  server.setRedirect('/patchright-init-redirect.html', '/patchright-init.html');
  server.setRoute('/patchright-init.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><meta charset="utf-8"><title>init</title><main>document</main>');
  });

  await context.addInitScript(() => window['contextInitCount'] = (window['contextInitCount'] || 0) + 1);
  await page.addInitScript(() => window['pageInitCount'] = (window['pageInitCount'] || 0) + 1);

  await page.goto(server.PREFIX + '/patchright-init-redirect.html');
  expect(await page.evaluate(() => ({
    context: window['contextInitCount'],
    page: window['pageInitCount'],
    compatMode: document.compatMode,
    charset: document.characterSet,
    body: document.querySelector('main')?.textContent,
  }), undefined, undefined, false)).toEqual({
    context: 1,
    page: 1,
    compatMode: 'CSS1Compat',
    charset: 'UTF-8',
    body: 'document',
  });

  await page.reload();
  expect(await page.evaluate(() => [window['contextInitCount'], window['pageInitCount']], undefined, undefined, false)).toEqual([1, 1]);
});

it('should keep functions and bindings available after frame and page navigation @patchright', async ({ context, page, server }) => {
  server.setRoute('/patchright-binding.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><iframe src="/patchright-binding-frame.html"></iframe>');
  });
  server.setRoute('/patchright-binding-frame.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>binding frame</title>');
  });

  await context.exposeFunction('patchrightAdd', (a: number, b: number) => a + b);
  await context.exposeBinding('patchrightSource', source => ({
    isMainFrame: source.frame === source.page.mainFrame(),
    url: source.frame.url(),
  }));

  const assertBindings = async () => {
    expect(await page.evaluate(() => window['patchrightAdd'](2, 3), undefined, undefined, false)).toBe(5);
    expect(await page.evaluate(() => window['patchrightSource'](), undefined, undefined, false)).toEqual({
      isMainFrame: true,
      url: server.PREFIX + '/patchright-binding.html',
    });

    const frame = page.frames()[1];
    expect(await frame.evaluate(() => window['patchrightAdd'](4, 5), undefined, undefined, false)).toBe(9);
    expect(await frame.evaluate(() => window['patchrightSource'](), undefined, undefined, false)).toEqual({
      isMainFrame: false,
      url: server.PREFIX + '/patchright-binding-frame.html',
    });
  };

  await page.goto(server.PREFIX + '/patchright-binding.html');
  await assertBindings();
  await page.reload();
  await assertBindings();
});
