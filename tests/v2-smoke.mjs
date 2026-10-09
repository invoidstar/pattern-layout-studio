import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:4173/pattern-layout-studio/';
const server = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
server.stderr.on('data', (chunk) => { serverOutput += String(chunk); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited unexpectedly: ${serverOutput}`);
    }
    try {
      const result = await fetch(BASE_URL);
      if (result.ok) return;
    } catch {}
    await sleep(450);
  }
  throw new Error(`Vite was not ready: ${serverOutput}`);
}

await mkdir('tests/screenshots', { recursive: true });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const desktopErrors = [];
  desktop.on('pageerror', (error) => desktopErrors.push(error.message));
  await desktop.goto(BASE_URL);
  await desktop.locator('.v2-topbar').waitFor();
  await desktop.locator('.v2-announcement-banner').waitFor();

  await desktop.locator('.v2-announcement-read').click();
  await desktop.locator('.v2-announcement-dialog').waitFor();
  assert.ok((await desktop.locator('.v2-release-row').count()) >= 2);
  await desktop.getByRole('button', { name: '知道了' }).click();

  await desktop.getByRole('button', { name: '处理设置' }).click();
  await desktop.locator('.v2-settings-dialog').waitFor();
  await desktop.locator('.v2-settings-dialog .v2-icon-button').click();
  await desktop.getByRole('button', { name: '导出', exact: true }).click();
  await desktop.locator('.v2-export-dialog').waitFor();
  await desktop.locator('.v2-export-dialog .v2-icon-button').click();

  await desktop.screenshot({ path: 'tests/screenshots/v2-desktop.png', fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobileErrors = [];
  mobile.on('pageerror', error => mobileErrors.push(error.message));
  await mobile.goto(BASE_URL);
  await mobile.locator('.v2-mobile-nav').waitFor();
  await mobile.locator('.v2-mobile-tab').nth(1).click();
  assert.equal(await mobile.locator('.v2-source-panel').isVisible(), true);
  await mobile.locator('.v2-mobile-tab').nth(2).click();
  assert.equal(await mobile.locator('.v2-inspector-panel').isVisible(), true);
  await mobile.locator('.v2-mobile-tab').nth(0).click();
  assert.equal(await mobile.locator('.v2-canvas-panel').isVisible(), true);
  const mobileOverflow = await mobile.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  assert.ok(
    mobileOverflow.pageWidth <= mobileOverflow.viewportWidth + 2,
    `Mobile horizontal overflow: ${JSON.stringify(mobileOverflow)}`,
  );
  await mobile.screenshot({ path: 'tests/screenshots/v2-mobile.png', fullPage: true });

  const valid = await desktop.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2970;
    canvas.height = 2100;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 2970, 2100);
    ctx.fillStyle = '#4a60b0';
    ctx.fillRect(210, 240, 1100, 1450);
    ctx.fillStyle = '#e5a76e';
    ctx.fillRect(1760, 480, 650, 790);
    return canvas.toDataURL('image/png').split(',')[1];
  });

  await desktop.locator('input[type=file]').setInputFiles({
    name: 'sample-a4.png',
    mimeType: 'image/png',
    buffer: Buffer.from(valid, 'base64'),
  });
  await desktop.waitForFunction(
    () => document.querySelector('.v2-statusbar')?.textContent?.includes('完成：'),
    { timeout: 180000 },
  );
  assert.ok((await desktop.locator('.v2-part-item').count()) >= 1, 'No extracted parts');
  await desktop.getByRole('button', { name: '移动画布' }).click();
  await desktop.getByRole('button', { name: '放大' }).click();
  assert.ok((await desktop.locator('.v2-zoom-tools span').textContent()).includes('125%'));
  await desktop.getByRole('button', { name: '适应画布' }).click();
  assert.ok((await desktop.locator('.v2-zoom-tools span').textContent()).includes('100%'));
  await desktop.locator('.v2-part-item').first().click();
  assert.equal(await desktop.locator('.v2-selected-part').isVisible(), true);

  await desktop.screenshot({ path: 'tests/screenshots/v2-desktop-project.png', fullPage: true });

  const invalidPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await invalidPage.goto(BASE_URL);
  const bad = await invalidPage.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await invalidPage.locator('input[type=file]').setInputFiles({
    name: 'unsupported.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bad, 'base64'),
  });
  await invalidPage.locator('.input-gate-dialog').waitFor({ timeout: 20000 });
  assert.ok((await invalidPage.locator('.input-gate-dialog').textContent()).includes('640 × 480'));

  assert.deepEqual(desktopErrors, [], 'Desktop page exceptions');
  assert.deepEqual(mobileErrors, [], 'Mobile page exceptions');
  console.log('V2 browser smoke PASS: desktop, mobile, announcements, settings, export drawer, processing, zoom, selection, size gate');
  console.log(`Mobile width: ${mobileOverflow.pageWidth}/${mobileOverflow.viewportWidth}`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
