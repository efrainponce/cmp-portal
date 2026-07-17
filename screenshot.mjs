import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

await page.waitForSelector('img[alt="CMP"]', { timeout: 5000 });
await page.screenshot({ path: '/private/tmp/claude-501/-Users-efrain-Documents-dev-cmp-portal/75fda880-4595-452f-95fd-d8dd4c44388a/scratchpad/logo-real.png' });

console.log('Screenshot taken');
await browser.close();
