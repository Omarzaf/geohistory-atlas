/** Run existing and Confluence browser checks in isolated Chrome; never install or publish. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { verifyLearning, captureLearning } from './browser-learning.qa.mjs';
import { verifyConfluence, captureConfluence } from './browser-confluence.qa.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.ATLAS_ORIGIN || 'http://127.0.0.1:8767';
const directory = '.impeccable/review/continuous-page';
await fs.mkdir(directory, { recursive: true });
const headless = process.env.ATLAS_HEADLESS !== '0';
const browser = await chromium.launch({ channel: 'chrome', headless, chromiumSandbox: true });
const receipt = {
  checkedAt: new Date().toISOString(), origin, headless,
  scope: 'Isolated local Chrome, desktop and mobile viewport emulation; not physical-device, Safari or production certification.',
  suites: {}, pageErrors: [], captures: [],
};
try {
  const baseline = vm.runInNewContext(await fs.readFile('scripts/browser-region.qa.js', 'utf8'));
  for (const [name, run] of [['baseline', baseline], ['learning', verifyLearning], ['confluence', verifyConfluence]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(20000);
    page.on('pageerror', error => receipt.pageErrors.push({ suite: name, message: error.message }));
    try { receipt.suites[name] = await run(page, origin); }
    catch (error) {
      receipt.suites[name] = { error: error.message };
      console.error(`${name}: ${error.message}`);
      await page.screenshot({ path: `${directory}/${name}-failure.png`, animations: 'disabled' }).catch(() => {});
    } finally { await context.close(); }
    const suite = receipt.suites[name];
    console.log(`${name}: ${suite.error || suite.failures?.length ? 'FAIL' : suite.blocked?.length ? 'PASS_WITH_LIMITATIONS' : 'PASS'}`);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => receipt.pageErrors.push({ suite: 'captures', message: error.message }));
  try {
    receipt.captures = await captureConfluence(page, directory, origin);
    await captureLearning(page, `${directory}/learning`, origin);
  } catch (error) { receipt.captureError = error.message; }
  finally { await context.close(); }
  receipt.counts = { pass: 0, fail: 0, blocked: 0 };
  for (const suite of Object.values(receipt.suites)) {
    if (suite.error) receipt.counts.fail++;
    for (const check of suite.checks || []) receipt.counts[check.status]++;
  }
  const noFailures = !receipt.captureError && receipt.pageErrors.length === 0 && receipt.counts.fail === 0;
  receipt.passed = noFailures && receipt.counts.blocked === 0;
  receipt.passedWithLimitations = noFailures && receipt.counts.blocked > 0;
  await fs.writeFile(`${directory}/verification.json`, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  if (!receipt.passed && !receipt.passedWithLimitations) process.exitCode = 1;
} finally { await browser.close(); }
