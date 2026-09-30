import { webkit } from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 414, height: 896 } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

let pass = 0, fail = 0;
const check = (n, c, extra) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (extra ? ' → ' + extra : '')); } };

/* 走完向导的辅助函数：安全确认 → 日期 → 同行人 → 出发地（→ 可能的 L4）。
   注意：若推荐落在野生点位会弹 L4 —— 这里选「取消」，回落到正规点位，
   保持本会话 L4 未确认状态，让后面的 L4 用例可独立验证。 */
async function walkWizard({ date = '2026-10-24', comp = 1, origin = 'hangzhou-cbd' } = {}) {
  await page.click('#askNext');                       // 安全确认（按钮即同意）→ date
  await page.waitForTimeout(200);
  await page.click(`#askDates .ask-date[data-date="${date}"]`);
  await page.click('#askNext');                       // → companion
  await page.waitForTimeout(200);
  await page.click(`#askPanel .ask-opt:nth-child(${comp})`);
  await page.click('#askNext');                       // → origin
  await page.waitForTimeout(200);
  await page.selectOption('#askOrigin', origin);
  await page.click('#askNext');                       // → plan（可能弹 L4）
  await page.waitForTimeout(500);
  const l4 = await page.evaluate(() => !document.getElementById('wildOverlay').hidden);
  if (l4) {
    await page.click('#wildCancel');                  // 取消 → 回落正规点位
    await page.waitForTimeout(500);
  }
}

console.log('\n=== A. 运行时错误（向导视图） ===');
check('无控制台错误', errors.length === 0, errors.join(' | '));

console.log('\n=== B. 提问向导：未答完不展示方案 ===');
const askVisible = await page.evaluate(() => !document.getElementById('view-ask').hidden);
check('首次进入显示提问向导', askVisible === true);
const planHidden = await page.evaluate(() => document.getElementById('view-plan').hidden);
check('方案页在答完前隐藏（未答完不给方案）', planHidden === true);
const q1 = await page.evaluate(() => (document.querySelector('.ask-q') || {}).textContent || '');
check('第一步是安全确认（原 L1 并入向导）', q1.includes('30 秒'), q1);
const ackBtn = await page.evaluate(() => {
  const b = document.getElementById('askNext');
  return b ? { text: b.textContent, disabled: b.disabled } : null;
});
check('安全步按钮即确认（文案含知情同意）', !!ackBtn && /知晓/.test(ackBtn.text), ackBtn && ackBtn.text);
check('确认并入按钮后可按（无独立勾选框）', !!ackBtn && ackBtn.disabled === false);
check('安全步无勾选框（确认动作收进主按钮）', await page.evaluate(() => !document.getElementById('askAgree')));
// 进度条不撒谎：日期/出发地有默认值但未答，不应显示 ✓
const progressMarks = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ask-step')).map(s => s.classList.contains('done') ? 1 : 0).join(''));
check('进度条不把预填默认值标成已答', progressMarks === '0000', progressMarks);

console.log('\n=== C. 走完向导 → 方案页 ===');
await walkWizard({ date: '2026-10-24', comp: 1, origin: 'hangzhou-cbd' });
const planShown = await page.evaluate(() => !document.getElementById('view-plan').hidden);
check('答完后进入方案页', planShown === true);
/* ★ 视图互斥必须查 computed display，不能只查 hidden 属性。
   曾经的真 bug：app.css 给 #view-ask/#view-plan 写了 author 级 display:block，
   把 [hidden] 的 UA 样式盖掉 —— hidden 属性是真的、页面上两个视图却同时可见，
   而所有旧断言查的都是属性，全绿照样漏。 */
const viewMutex = await page.evaluate(() => ({
  askDisplay: getComputedStyle(document.getElementById('view-ask')).display,
  planDisplay: getComputedStyle(document.getElementById('view-plan')).display
}));
check('★视图互斥（computed display，防 CSS 盖掉 hidden）',
  viewMutex.askDisplay === 'none' && viewMutex.planDisplay !== 'none',
  viewMutex);
const planWhere = await page.evaluate(() => (document.querySelector('.plan-where') || {}).textContent || '');
check('方案页给出唯一推荐点位', planWhere.startsWith('去 ') && planWhere.length > 3, planWhere);

/* 固定到盐官（official，无 L4 干扰），后续断言口径稳定 */
await page.evaluate(() => window.App.pick('yanguan'));
await page.waitForTimeout(600);

console.log('\n=== D. 方案页与资料区渲染 ===');
for (const id of ['planMain', 'planAlt', 'answersBar', 'pitfalls', 'checklist', 'wild', 'calendar', 'safety', 'official', 'correction', 'footerDisclaimer']) {
  const len = await page.evaluate(i => { const e = document.getElementById(i); return e ? e.innerHTML.length : -1; }, id);
  check('#' + id + ' 已渲染', len > 50, '长度 ' + len);
}
const pills = await page.evaluate(() => document.querySelectorAll('.answer-pill[data-edit]').length);
check('答案条给出三个可回改的答案（哪天/和谁/从哪）', pills === 3, '实际 ' + pills);
const refsClosed = await page.evaluate(() =>
  Array.from(document.querySelectorAll('details.ref')).filter(d => !d.open).length);
const refsTotal = await page.evaluate(() => document.querySelectorAll('details.ref').length);
check('参考资料默认全部折叠', refsClosed === refsTotal && refsTotal >= 5, `${refsTotal - refsClosed}/${refsTotal} 未折叠`);

console.log('\n=== E. 方案页核心数字 ===');
const timesTxt = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
check('给出潮时', /\d{1,2}:\d{2}/.test(timesTxt), timesTxt.slice(0, 60));
check('给出建议出发时间', /建议出发/.test(timesTxt), timesTxt.slice(0, 60));
check('给出车程', /车程/.test(timesTxt), timesTxt.slice(0, 60));
const srcNote = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
check('车程标注来源（估算/实时/手填之一）', /估算|实时|手动填写/.test(srcNote), srcNote.slice(-40));

console.log('\n=== F. 倒计时 tick ===');
const t1 = await page.evaluate(() => { const e = document.getElementById('heroCount'); return e ? e.textContent.trim() : null; });
check('方案页有倒计时（未来大潮日）', !!t1, t1);
check('计划期粒度按远近分档（不制造秒级焦虑）', /天|小时|分/.test(t1 || '') && !/秒/.test(t1 || ''), t1);
await page.evaluate(() => {
  window.__tickCount = 0;
  const el = document.getElementById('heroCount');
  if (!el) return;
  new MutationObserver(() => { window.__tickCount++; }).observe(el, { childList: true, characterData: true, subtree: true });
});
await page.waitForTimeout(3200);
const ticks = await page.evaluate(() => window.__tickCount);
check('倒计时 tick 定时器在运行', ticks >= 1, '实际 ' + ticks + ' 次写入');

console.log('\n=== G. L2 常驻安全条（不可关闭）===');
const l2 = await page.evaluate(() => { const e = document.querySelector('.safety-bar'); return e ? e.textContent.trim() : null; });
check('L2 红条存在且有文案', !!l2 && l2.length > 10, l2);
const l2NoClose = await page.evaluate(() => !document.querySelector('.safety-bar button, .safety-bar [onclick*="hide"]'));
check('L2 没有关闭按钮（不可关闭）', l2NoClose === true);

console.log('\n=== I. 方案切换仍走 L4（红线不允许绕过）===');
await page.evaluate(() => { const cb = document.getElementById('wildAgree'); if (cb) { cb.checked = false; } });
const wildAltBtn = await page.$('#planAlt [data-switch]');
if (wildAltBtn) {
  const pid = await wildAltBtn.getAttribute('data-switch');
  const isWild = await page.evaluate(id => TideData.getPoint(id).type === 'wild', pid);
  await wildAltBtn.click();
  await page.waitForTimeout(400);
  if (isWild) {
    const l4Shown = await page.evaluate(() => !document.getElementById('wildOverlay').hidden);
    check('点野生备选弹出 L4（App.pick 入口拦截）', l4Shown === true);
    await page.evaluate(() => document.getElementById('wildCancel').click());
    await page.waitForTimeout(300);
    const kept = await page.evaluate(() => (document.querySelector('.plan-where') || {}).textContent || '');
    check('取消后保留原方案', kept.includes('盐官'), kept);
  } else {
    check('(本用例备选是正规点位，L4 不触发——符合预期)', true);
  }
}

console.log('\n=== H. M9 野生点位 L4 阻断 ===');
await page.evaluate(() => { const b = document.getElementById('openWild'); if (b) b.click(); });
await page.waitForTimeout(300);
const l4Visible = await page.evaluate(() => !document.getElementById('wildOverlay').hidden);
check('点「查看点位」弹出 L4 免责声明', l4Visible === true);
const l4BtnDisabled = await page.evaluate(() => document.getElementById('wildOk').disabled);
check('L4 按钮默认 disabled', l4BtnDisabled === true);
await page.evaluate(() => document.getElementById('wildOk').click());
await page.waitForTimeout(200);
const l4Still = await page.evaluate(() => !document.getElementById('wildOverlay').hidden);
check('负向验证：不勾选 L4 进不去', l4Still === true);
await page.evaluate(() => { const cb = document.getElementById('wildAgree'); cb.checked = true; cb.dispatchEvent(new Event('change')); });
await page.waitForTimeout(150);
await page.evaluate(() => document.getElementById('wildOk').click());
await page.waitForTimeout(400);
const l4Closed = await page.evaluate(() => document.getElementById('wildOverlay').hidden);
check('勾选后 L4 放行', l4Closed === true);

console.log('\n=== J. 手动车程覆盖（P0-01 保留功能）===');
const driveBefore = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
await page.evaluate(() => {
  window.prompt = () => '300';   // 杭州市中心→盐官 ≈ 67min，改 300 必然可见变化
  const b = document.getElementById('driveEdit');
  if (b) b.click();
});
await page.waitForTimeout(600);
const driveAfter = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
check('手填车程后数字变化', driveBefore !== driveAfter, `${driveBefore.match(/约 \d+ 分/)} → ${driveAfter.match(/约 \d+ 分/)}`);
check('手填后标注「你手动填写」', /手动填写/.test(driveAfter), driveAfter.slice(-40));
await page.evaluate(() => { const b = document.getElementById('driveReset'); if (b) b.click(); });
await page.waitForTimeout(600);
const driveReset = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
check('改回自动估算后恢复', !/手动填写/.test(driveReset), driveReset.slice(-40));

console.log('\n=== K. 清单持久化 + 刷新恢复 ===');
const cbClicked = await page.evaluate(() => {
  const cb = document.querySelector('input[data-cid="pass"]');
  if (!cb) return false;
  cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
});
check('可勾选行前清单', cbClicked === true);
await page.waitForTimeout(300);
const cl = await page.evaluate(() => localStorage.getItem('cx_checklist_v1'));
check('清单状态已持久化', !!cl && cl.includes('pass'), cl);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
const planAfterReload = await page.evaluate(() => ({
  view: document.getElementById('view-ask').hidden ? 'plan' : 'ask',
  where: (document.querySelector('.plan-where') || {}).textContent || ''
}));
check('刷新后直接进方案页（不再重复提问）', planAfterReload.view === 'plan');
check('刷新后方案仍是已选点位', planAfterReload.where.includes('盐官'), planAfterReload.where);

console.log('\n=== L. 手填校正真的生效（口径不分叉）===');
const timesBefore = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
await page.evaluate(() => {
  const det = document.getElementById('ref-official'); if (det) det.open = true;
  const am = document.getElementById('customAM');
  const pm = document.getElementById('customPM');
  if (am) { am.value = '09:15'; am.dispatchEvent(new Event('input', { bubbles: true })); }
  if (pm) { pm.value = '20:45'; pm.dispatchEvent(new Event('input', { bubbles: true })); }
  document.getElementById('saveCustom').click();
});
await page.waitForTimeout(700);
const timesAfter = await page.evaluate(() => (document.querySelector('.plan-times') || {}).innerText || '');
check('方案页潮时随手填改变', timesBefore !== timesAfter && /20:45|09:15/.test(timesAfter),
  timesAfter.match(/潮时\s*\S[\s\S]{0,40}/)?.[0]);
check('标注「已按你的校正」', /已按你的校正/.test(timesAfter), timesAfter.slice(0, 80));

console.log('\n=== M. 海报渲染（M11）===');
const h2c = await page.evaluate(() => typeof html2canvas);
check('html2canvas 已加载', h2c === 'function', h2c);
await page.evaluate(() => { document.getElementById('btnPoster') && document.getElementById('btnPoster').click(); });
await page.waitForTimeout(3000);
const posterImg = await page.evaluate(() => {
  const img = document.querySelector('#posterPreview img');
  return img ? { len: img.src.length, isPng: img.src.startsWith('data:image/png') } : null;
});
check('海报生成成功（PNG data URL）', !!posterImg && posterImg.isPng && posterImg.len > 5000,
  posterImg ? `长度 ${posterImg.len}` : '未生成');
const posterHasSafety = await page.evaluate(() => {
  const p = document.querySelector('#posterStage .po-root');
  return p ? (p.textContent.includes('安全须知') && p.textContent.includes('风险自担')) : false;
});
check('海报含安全须知 + 免责声明（强制入图）', posterHasSafety === true);

console.log('\n=== N. 离线可用（零外部依赖）===');
const reqs = [];
page.on('request', r => reqs.push(r.url()));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);
const external = reqs.filter(u => !u.startsWith('file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app') && !u.startsWith('data:') && !u.startsWith('blob:'));
check('刷新过程无任何外部网络请求', external.length === 0, external.join(', '));

console.log('\n' + '='.repeat(50));
console.log(`浏览器端验证：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50) + '\n');

await browser.close();
process.exit(fail ? 1 : 0);
