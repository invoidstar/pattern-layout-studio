import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4174/pattern-layout-studio/';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let log = '';
server.stdout.on('data', chunk => { log += String(chunk); });
server.stderr.on('data', chunk => { log += String(chunk); });

async function waitForReady() {
  for (let i = 0; i < 65; i++) {
    if (server.exitCode !== null) throw new Error(`Vite stopped: ${log}`);
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Vite timed out: ${log}`);
}

let browser;
try {
  await waitForReady();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const response = await page.goto(BASE);
  assert.equal(response?.status(), 200);

  const icon = page.locator('link[rel="icon"]');
  const href = await icon.getAttribute('href');
  assert.ok(href?.includes('/pattern-layout-studio/favicon.svg'), 'Missing project-base favicon URL');
  const faviconResponse = await page.request.get(new URL(href, BASE).href);
  assert.equal(faviconResponse.status(), 200, 'Favicon failed to load');
  assert.match(await faviconResponse.text(), /<svg[\s>]/, 'Favicon is not an SVG');

  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.locator('.v2-export-background').waitFor();
  const radio = (value) => page.locator(`input[name="export-background"][value="${value}"]`);
  assert.equal(await radio('detected').isChecked(), true, 'Legacy default background changed');
  await radio('custom').check();
  await page.getByLabel('自定义导出背景颜色').fill('#123456');
  assert.match(await page.locator('.v2-export-custom').textContent(), /#123456/i);
  await radio('transparent').check();
  assert.equal(await radio('transparent').isChecked(), true);
  await page.locator('.v2-export-dialog .v2-icon-button').click();

  // The options survive closing and reopening the dialog.
  await page.getByRole('button', { name: '导出', exact: true }).click();
  assert.equal(await radio('transparent').isChecked(), true);

  const pixels = await page.evaluate(async () => {
    const { renderLayoutPage, buildPagesZip } = await import('/pattern-layout-studio/src/core/export/pages.ts');
    const { resolveExportBackground } = await import('/pattern-layout-studio/src/features/export/background.ts');

    const partCanvas = document.createElement('canvas');
    partCanvas.width = 2;
    partCanvas.height = 2;
    const partCtx = partCanvas.getContext('2d');
    partCtx.fillStyle = '#ef6070';
    partCtx.fillRect(0, 0, 2, 2);
    const part = {
      id: 'test',
      name: 'test',
      imageUrl: partCanvas.toDataURL('image/png'),
      width: 2, height: 2, x: 2, y: 2,
      locked: false, visible: true,
    };
    const target = { width: 8, height: 8, label: 'test' };

    async function inspectBackground(css) {
      const blob = await renderLayoutPage([part], target, css, 300);
      const image = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 8, 8);
      context.drawImage(image, 0, 0);
      const background = [...context.getImageData(0, 0, 1, 1).data];
      const foreground = [...context.getImageData(2, 2, 1, 1).data];
      image.close();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const hasPhys = new TextDecoder('latin1').decode(bytes).includes('pHYs');
      return { background, foreground, hasPhys };
    }
    const original = await inspectBackground(resolveExportBackground('detected', '#ddeeff', '#123456'));
    const white = await inspectBackground(resolveExportBackground('white', '#ddeeff', '#123456'));
    const custom = await inspectBackground(resolveExportBackground('custom', '#ddeeff', '#123456'));
    const transparent = await inspectBackground(resolveExportBackground('transparent', '#ddeeff', '#123456'));
    const zip = await buildPagesZip(
      [{ pageIndex: 0, parts: [part] }, { pageIndex: 1, parts: [part] }],
      target, '#123456', 300,
    );
    return {
      original, white, custom, transparent,
      zip: [...new Uint8Array(await zip.arrayBuffer())],
    };
  });

  assert.deepEqual(pixels.original.background, [221, 238, 255, 255]);
  assert.deepEqual(pixels.white.background, [255, 255, 255, 255]);
  assert.deepEqual(pixels.custom.background, [18, 52, 86, 255]);
  assert.deepEqual(pixels.transparent.background, [0, 0, 0, 0]);
  for (const item of [pixels.original, pixels.white, pixels.custom, pixels.transparent]) {
    assert.deepEqual(item.foreground, [239, 96, 112, 255], 'Export changed the source part RGB');
    assert.equal(item.hasPhys, true, 'DPI pHYs metadata missing');
  }

  const zip = await JSZip.loadAsync(Buffer.from(pixels.zip));
  const zipNames = Object.keys(zip.files);
  assert.equal(zipNames.length, 2, 'ZIP must contain both pages');
  for (const name of zipNames) {
    assert.match(name, /300dpi\.png$/);
    const bytes = await zip.files[name].async('uint8array');
    assert.ok(new TextDecoder('latin1').decode(bytes).includes('pHYs'));
  }

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.v2-export-background').isVisible(), true);
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  assert.ok(sizes.scrollWidth <= sizes.viewport + 2, `Mobile export drawer overflow: ${JSON.stringify(sizes)}`);
  assert.deepEqual(errors, [], 'Browser exceptions');

  console.log('PASS: favicon loads at Pages base path');
  console.log('PASS: export background options and persistent selection');
  console.log('PASS: original / white / custom / transparent PNG pixel & alpha values');
  console.log('PASS: foreground RGB unchanged and PNG DPI preserved');
  console.log('PASS: multi-page ZIP contains both backgrounds and DPI metadata');
  console.log(`PASS: mobile export drawer fits width ${sizes.scrollWidth}/${sizes.viewport}`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  server.stdout.destroy();
  server.stderr.destroy();
}
