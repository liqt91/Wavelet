/**
 * verify-p001.mjs — 方案卡信息维度端到端验证
 * 证明：方案卡含「怎么去」路线、涌高、潮型、星级分级说明；
 *       前一天/后一天切换只换日期、不动其他答案。
 */
import { webkit } from 'playwright-core';

const URL = 'file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
};

const b = await webkit.launch();
const errs = [];

async function fresh() {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.click('#askNext'); await p.waitForTimeout(150);                    // 安全步（按钮即确认）
  await p.click('#askDates .ask-date[data-date="2026-10-24"]');
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.click('#askPanel .ask-opt:nth-child(1)');
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.selectOption('#askOrigin', 'hangzhou-cbd');
  await p.click('#askNext'); await p.waitForTimeout(500);
  const l4 = await p.evaluate(() => !document.getElementById('wildOverlay').hidden);
  if (l4) { await p.click('#wildCancel'); await p.waitForTimeout(300); }
  return p;
}

const p = await fresh();
const card = await p.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');

console.log('\n=== A. 方案卡信息维度 ===');
check('含「怎么去」路线区', /怎么去/.test(card), card.slice(0, 80));
check('含铁路与自驾两条路线', /铁路/.test(card) && /自驾/.test(card), card.slice(0, 120));
check('含涌高', /涌高约/.test(card), card.slice(0, 120));
check('含潮型', /潮型/.test(card), card.slice(0, 120));
check('含星级分级说明', /推荐观潮|强烈推荐|适宜观潮/.test(card), card.slice(0, 120));

console.log('\n=== B. 前一天 / 后一天 ===');
const when0 = await p.evaluate(() => (document.querySelector('.plan-when span') || {}).textContent || '');
await p.click('#dayNext'); await p.waitForTimeout(500);
const when1 = await p.evaluate(() => (document.querySelector('.plan-when span') || {}).textContent || '');
check('后一天日期变化', when0 !== when1, `${when0} → ${when1}`);
const pillKept = await p.evaluate(() => (document.querySelector('.answer-pill[data-edit="companion"]') || {}).textContent || '');
check('换日不动其他答案（和谁仍在）', /带娃/.test(pillKept), pillKept);
await p.click('#dayPrev'); await p.waitForTimeout(500);
const when2 = await p.evaluate(() => (document.querySelector('.plan-when span') || {}).textContent || '');
check('前一天切回', when2 === when0, when2);

console.log('\n=== C. 换到小潮日 → 小潮卡 ===');
await p.click('#dayPrev'); await p.waitForTimeout(500);   // 10/24 → 10/23（小潮日）
const small = await p.evaluate(() => (document.querySelector('.plan-where') || {}).textContent || '');
check('小潮日给出明确提示', /小潮/.test(small), small);

console.log('\n运行期错误:', errs.length ? errs : '（无）');
check('无运行期错误', errs.length === 0, errs);

await p.close();
console.log('\n' + '='.repeat(50));
console.log(`方案卡信息维度验证：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
await b.close();
process.exit(fail ? 1 : 0);
