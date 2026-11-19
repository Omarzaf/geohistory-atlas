/** Run both behavioral suites with an existing Playwright installation; no package installation. */
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { verifyLearning, captureLearning } from './browser-learning.qa.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const receipt = { checkedAt: new Date().toISOString(), scope: 'Local Chrome desktop and mobile emulation; not physical-device or Safari certification' };
try {
  const baseline = vm.runInNewContext(await fs.readFile('scripts/browser-region.qa.js', 'utf8'));
  try { receipt.baseline = await baseline(page); } catch (error) { receipt.baselineError = error.message; }
  receipt.learning = await verifyLearning(page);
  receipt.pageErrors = errors;
  await captureLearning(page, '.impeccable/review');
  await fs.writeFile('receipts/learning-browser-verification.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.baselineError || receipt.learning.failures.length || errors.length) process.exitCode = 1;
} finally { await browser.close(); }
