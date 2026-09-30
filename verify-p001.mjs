/**
 * verify-p001.mjs — P0-01 端到端验证（重构后：向导 + 方案页）
 * 证明：换出发地 → 车程变 → 「建议出发时间」真的变；
 *       手填车程可覆盖、可保留、换出发地时被清掉。
 */
import { webkit } from 'playwright-core';

const URL = 'file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
};

const b = await webkit.launch();

/** 新开一页并走完向导（可指定出发地）；L4 弹出则取消（回落正规点位） */
async function fresh({ origin = 'hangzhou-cbd', date = '2026-10-24' } = {}) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.click(`#askDates .ask-date[data-date="${date}"]`);
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.click('#askPanel .ask-opt:nth-child(1)');       // 带娃/带老人
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.selectOption('#askOrigin', origin);
  await p.click('#askNext'); await p.waitForTimeout(400);
  const l4 = await p.evaluate(() => !document.getElementById('wildOverlay').hidden);
  if (l4) { await p.click('#wildCancel'); await p.waitForTimeout(300); }
  return p;
}

const errs = [];

/** 从方案卡读车程与出发时间
 *  注意：.plan-times 的第一格是「潮时」，HH:MM 必须先命中那一格 —— 早期版本直接取整块里
 *  第一个 HH:MM，读到的其实是潮时，于是「换出发地出发时间变了没」这组断言永远假红。
 *  这里改成按 .k 标签定位单元格，只从「建议出发」格取时间。 */
const readPlan = (p) => p.evaluate(() => {
  const box = document.querySelector('.plan-times');
  const t = (box || { innerText: '' }).innerText.replace(/\s+/g, ' ');
  const drive = (t.match(/约 (\d+) 分/) || [])[1];
  let depart = null, tide = null;
  const cells = box ? Array.from(box.children) : [];
  for (const cell of cells) {
    const k = (cell.querySelector('.k') || {}).textContent || '';
    const v = (cell.querySelector('.v') || {}).textContent || '';
    if (/建议出发/.test(k)) depart = (v.match(/(\d{1,2}:\d{2})/) || [])[1] || null;
    if (/潮时/.test(k)) tide = (v.match(/(\d{1,2}:\d{2})/) || [])[1] || null;
  }
  return { drive: drive ? parseInt(drive, 10) : null, depart, tide, text: t.slice(0, 160) };
});

console.log('\n=== A. 向导第 4 步：出发地选择器 ===');
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.click('#askDates .ask-date[data-date="2026-10-24"]');
  await p.click('#askNext'); await p.waitForTimeout(150);
  await p.click('#askPanel .ask-opt:nth-child(1)');
  await p.click('#askNext'); await p.waitForTimeout(200);
  const sel = await p.evaluate(() => {
    const s = document.getElementById('askOrigin');
    return { exists: !!s, count: s ? s.options.length : 0,
      labels: s ? Array.from(s.options).map(o => o.textContent) : [],
      value: s ? s.value : null };
  });
  check('向导内出发地选择器存在', sel.exists === true);
  check('选项数量 ≥5', sel.count >= 5, sel.count);
  check('默认选中杭州市中心', sel.value === 'hangzhou-cbd', sel.value);
  console.log('    选项:', sel.labels.join(' / '));
  await p.close();
}

console.log('\n=== B. 核心：换出发地 → 出发时间必须变 ===');
const hzp = await fresh({ origin: 'hangzhou-cbd' });
const hz = await readPlan(hzp);
console.log(`    杭州市中心：车程 ${hz.drive} 分 → 建议 ${hz.depart} 出发`);

const shp = await fresh({ origin: 'shanghai' });
const sh = await readPlan(shp);
console.log(`    上海：      车程 ${sh.drive} 分 → 建议 ${sh.depart} 出发`);

check('换出发地后车程变化', hz.drive !== sh.drive, { hz: hz.drive, sh: sh.drive });
check('上海车程 > 杭州车程', (sh.drive || 0) > (hz.drive || 0), { hz: hz.drive, sh: sh.drive });
check('★核心：换出发地后出发时间不同', hz.depart !== sh.depart, { hz: hz.depart, sh: sh.depart });
check('★核心：上海要更早出发', (() => {
  if (!hz.depart || !sh.depart) return false;
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return toMin(sh.depart) < toMin(hz.depart);
})(), { hz: hz.depart, sh: sh.depart });
check('估算值带来源标注（不把估算当事实）', /估算/.test(hz.text), hz.text);

console.log('\n=== C. 手动改车程（方案页「不准？手动改」）===');
await hzp.evaluate(() => { window.prompt = () => '150'; });
await hzp.evaluate(() => { const btn = document.getElementById('driveEdit'); if (btn) btn.click(); });
await hzp.waitForTimeout(500);
const manual = await readPlan(hzp);
check('手填 150 分钟生效', manual.drive === 150, manual.drive);
check('手填后出发时间跟着变', manual.depart !== hz.depart, { manual: manual.depart, hz: hz.depart });
check('标注切换为「你手动填写」', /手动填写/.test(manual.text), manual.text);

console.log('\n=== D. 换出发地时清掉手填（避免静默算错）===');
await shp.evaluate(() => { window.prompt = () => '150'; });
await shp.evaluate(() => { const btn = document.getElementById('driveEdit'); if (btn) btn.click(); });
await shp.waitForTimeout(400);
const shManual = await readPlan(shp);
check('(上海页) 手填 150 生效', shManual.drive === 150, shManual.drive);

// 从答案条回改出发地 → 向导 origin 步 → 选回杭州 → 生成
await shp.evaluate(() => document.querySelector('.answer-pill[data-edit="origin"]').click());
await shp.waitForTimeout(400);
const backInWizard = await shp.evaluate(() => !document.getElementById('view-ask').hidden);
check('答案条「从哪·改」回到向导', backInWizard === true);
await shp.selectOption('#askOrigin', 'hangzhou-cbd');
await shp.waitForTimeout(200);
await shp.click('#askNext'); await shp.waitForTimeout(500);
const afterOrigin = await readPlan(shp);
check('换出发地后手填被清除（不再是 150）', afterOrigin.drive !== 150, afterOrigin.drive);
check('回落到杭州口径的车程', afterOrigin.drive === hz.drive, { after: afterOrigin.drive, hz: hz.drive });

console.log('\n=== E. 手填值在刷新后保留 ===');
const p2 = await fresh({ origin: 'hangzhou-cbd' });
await p2.evaluate(() => { window.prompt = () => '150'; });
await p2.evaluate(() => { const btn = document.getElementById('driveEdit'); if (btn) btn.click(); });
await p2.waitForTimeout(400);
await p2.reload({ waitUntil: 'load' });
await p2.waitForTimeout(900);
const afterReload = await readPlan(p2);
check('刷新后直接进方案页且手填仍在', afterReload.drive === 150, afterReload.drive);

console.log('\n=== F. 改回自动估算 ===');
await p2.evaluate(() => { const btn = document.getElementById('driveReset'); if (btn) btn.click(); });
await p2.waitForTimeout(500);
const afterReset = await readPlan(p2);
check('恢复后不再是手填值', afterReset.drive !== 150, afterReset.drive);
check('来源标注回到估算口径', /估算/.test(afterReset.text) || /实时/.test(afterReset.text), afterReset.text);

console.log('\n运行期错误:', errs.length ? errs : '（无）');
check('无运行期错误', errs.length === 0, errs);

[hzp, shp, p2].forEach(x => x.close().catch(() => {}));
console.log('\n' + '='.repeat(50));
console.log(`P0-01 验证：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
await b.close();
process.exit(fail ? 1 : 0);
