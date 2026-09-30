/**
 * shot-new.mjs — 为新一轮交互截图（两视图流程）。
 * 用 file:// 打开（沙箱拦本地端口），逐屏截图存到 shots/。
 */
import { webkit } from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'node:fs';

const URL = 'file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html';
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(900);

const shot = async (name) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const h = await page.evaluate(() => ({ h: document.body.scrollHeight, v: window.innerHeight }));
  console.log(`  ${name}.png  (${h.h}px ≈ ${(h.h / h.v).toFixed(1)} 屏)`);
};

console.log('截图：');
await shot('01-ask-safety');       // 第 1 步 安全确认

// 安全确认（按钮即知情同意）
await page.click('#askNext'); await page.waitForTimeout(300);
await shot('02-ask-date');         // 第 2 步 选日期

await page.evaluate(() => { const b = document.querySelector('#askDates .ask-date[data-date="2026-10-10"]') || document.querySelector('#askDates .ask-date'); if (b) b.click(); });
await page.waitForTimeout(200);
await page.click('#askNext'); await page.waitForTimeout(300);
await shot('03-ask-companion');    // 第 3 步 同行人

await page.click('#askPanel .ask-opt:nth-child(3)');   // 拍大片
await page.click('#askNext'); await page.waitForTimeout(300);
await shot('04-ask-origin');       // 第 4 步 出发地

await page.selectOption('#askOrigin', 'hangzhou-cbd');
await page.click('#askNext'); await page.waitForTimeout(800);
// L4 遮罩（若弹出）单独记一张
const l4 = await page.evaluate(() => !document.getElementById('wildOverlay').hidden);
if (l4) {
  await page.screenshot({ path: `${OUT}/05-l4-wild.png` });
  console.log('  05-l4-wild.png  (L4 强确认遮罩)');
  await page.click('#wildCancel'); await page.waitForTimeout(500);
}
await page.evaluate(() => window.App && window.App.pick('yanguan'));
await page.waitForTimeout(700);
await shot('06-plan');             // 方案页（默认，参考区折叠）

// 展开一个参考区看看
await page.evaluate(() => {
  const d = document.getElementById('ref-pitfalls'); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/07-refs-open.png` });
console.log('  07-refs-open.png  (展开「避雷」参考区)');

await browser.close();
console.log('done');
