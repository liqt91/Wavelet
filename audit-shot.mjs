import { webkit } from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.evaluate(() => { const cb=document.getElementById('l1Agree'); cb.checked=true; cb.dispatchEvent(new Event('change')); });
await page.evaluate(() => document.getElementById('l1Ok').click());
await page.waitForTimeout(300);
await page.evaluate(() => { const b=document.querySelector('[data-date="2026-10-24"]'); if(b) b.click(); });
await page.waitForTimeout(400);

async function shotAt(sel, file, pad) {
  pad = pad || 60;
  await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), sel);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file });
}
await shotAt('#calendar', 'a-calendar.png');
await shotAt('#datePicker', 'a-datepicker.png');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await page.screenshot({ path: 'a-footer.png' });
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: 'a-firstscreen.png' });
await browser.close();
console.log('done');
