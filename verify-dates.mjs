/**
 * verify-dates.mjs — 日期窗口与农历口径验证（本轮反馈修复）
 *
 * 用户反馈：「为啥观潮的时间里没有 9月30日到 10月9日？另外今天已经 9月30日了，
 *            此前的日期没啥意义」
 *
 * 三条要验：
 *   A. 列表不得出现「今天以前」的日期（今天 9/30，就不能有 9/25）
 *   B. 农历标注必须与权威口径一致（9/25=八月十五、10/10=九月初一、10/24=九月十五）
 *   C. 峰值日必须是真正的「十八」（9/28 八月十八、10/27 九月十八），不是随便挑的
 *   D. 窗口间隙要解释清楚（列表从 9/29 跳到 10/10，用户得知道为什么）
 */
import { webkit } from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const URL = 'file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
};

/** 冻结到指定日期打开页面（FIXED 之后的第 n 天） */
async function open(fixed, { freezeDays = 0 } = {}) {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  if (freezeDays !== 0 || fixed) {
    await p.addInitScript((args) => {
      const FIXED = new Date(args.iso).getTime() + args.n * 86400000;
      const _D = Date;
      function FD(...a) { return a.length ? new _D(...a) : new _D(FIXED); }
      FD.now = () => FIXED; FD.parse = _D.parse; FD.UTC = _D.UTC;
      FD.prototype = _D.prototype;
      window.Date = FD;
    }, { iso: fixed, n: freezeDays });
  }
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(900);
  return { b, p, errs };
}

/* ================= A. 纯数据层：过去日期不得出现 ================= */
console.log('\n=== A. 数据层：今天之前的日期必须被滤掉 ===');
{
  const { b, p } = await open('2026-09-30T10:00:00+08:00');
  const r = await p.evaluate(() => ({
    today: window.TideData._today,
    all: window.TideData.allDates,
    raw: window.TideData.allDatesRaw,
    anyPast: window.TideData.allDates.some(d => d < window.TideData._today)
  }));
  check('_today 已注入为 2026-09-30', r.today === '2026-09-30', r.today);
  check('内置表仍是完整 15 天（数据没删）', r.raw.length === 15, r.raw.length);
  check('★核心：可见列表不含任何过去日期', r.anyPast === false,
    r.all.filter(d => d < r.today));
  check('★核心：可见列表从 10/10 开始（9/25–9/29 已过）',
    r.all[0] === '2026-10-10', { first: r.all[0], all: r.all });
  console.log('    可见日期:', r.all.join(' '));
  await b.close();
}

/* ================= B. 农历标注必须与权威口径一致 ================= */
console.log('\n=== B. 农历标注（权威：海宁水利局发布会 + 央视） ===');
{
  const { b, p } = await open('2026-09-30T10:00:00+08:00');
  const r = await p.evaluate(() => {
    const g = (d) => (window.TideData.TIDE_TABLE[d] || {}).lunisolar;
    return {
      d925: g('2026-09-25'), d928: g('2026-09-28'), d1010: g('2026-10-10'),
      d1024: g('2026-10-24'), d1027: g('2026-10-27')
    };
  });
  check('★9/25 = 农历八月十五（中秋节）', r.d925 === '农历八月十五', r.d925);
  check('★9/28 = 农历八月十八（全年潮势巅峰）', r.d928 === '农历八月十八', r.d928);
  check('10/10 = 农历九月初一', r.d1010 === '农历九月初一', r.d1010);
  check('10/24 = 农历九月十五', r.d1024 === '农历九月十五', r.d1024);
  check('★10/27 = 农历九月十八', r.d1027 === '农历九月十八', r.d1027);
  await b.close();
}

/* ================= C. 峰值日必须是真正的「十八」 ================= */
console.log('\n=== C. 峰值日标记 ===');
{
  const { b, p } = await open('2026-09-30T10:00:00+08:00');
  const r = await p.evaluate(() => {
    const peaks = window.TideData.allDatesRaw.filter(d => window.TideData.TIDE_TABLE[d].peak);
    return { peaks, w: window.TideData.WINDOWS.map(x => ({ id: x.id, peakDate: x.peakDate })) };
  });
  check('★峰值日每窗口一个：9/28（十八）· 10/10（朔·初一）· 10/27（十八）',
    JSON.stringify(r.peaks) === JSON.stringify(['2026-09-28', '2026-10-10', '2026-10-27']), r.peaks);
  check('窗口元数据里的 peakDate 与表内 peak 标记一致',
    r.w.map(x => x.peakDate).join() === '2026-09-28,2026-10-10,2026-10-27',
    r.w);
  await b.close();
}

/* ================= D. 窗口间隙必须被解释 ================= */
console.log('\n=== D. 窗口间隙说明（用户问的「为什么没有 10/1–10/9」）===');
{
  const { b, p } = await open('2026-09-30T10:00:00+08:00');
  const r = await p.evaluate(() => {
    const T = window.TideData;
    return {
      inWin: !!T.inWindowToday(),
      next: T.nextWindow(),
      gap: T.gapDaysToNextWindow()
    };
  });
  check('今天不在任何大潮窗口内（9/30 是八月二十，官方窗口止于 9/29）', r.inWin === false);
  check('下一个窗口是 10/10 那轮', r.next && r.next.start === '2026-10-10', r.next);
  check('★距下个窗口 10 天（9/30 → 10/10）', r.gap === 10, r.gap);

  // 界面上必须真的把这段解释出来（安全步：按钮即确认）
  await p.click('#askNext'); await p.waitForTimeout(350);
  const ui = await p.evaluate(() => ({
    hasDates: !!document.getElementById('askDates'),
    smallDay: !!document.querySelector('#askDates .ask-date[data-date="2026-10-03"]'),
    tabs: document.querySelectorAll('.ask-cal-tab').length,
    pastDisabled: document.querySelectorAll('#askDates .ask-date:disabled').length,
    expectPast: (() => { const t = document.querySelector('#askDates .ask-date.today b'); return t ? +t.textContent - 1 : 0; })(),
    legend: (document.querySelector('.ask-cal-legend') || { innerText: '' }).innerText.replace(/\s+/g, ' '),
    datesText: (document.getElementById('askDates') || { innerText: '' }).innerText.replace(/\s+/g, ' ')
  }));
  check('日期列表存在（月历）', ui.hasDates === true);
  check('★小潮日也列在日历里（10/1–10/9 不再跳段）', ui.smallDay === true);
  check('月份切换：本月 + 后三个月', ui.tabs === 4, ui.tabs);
  check('本月已过去的日子不可点', ui.pastDisabled === ui.expectPast, `${ui.pastDisabled} vs 今天前 ${ui.expectPast} 天`);
  check('潮势说明合并在日历下方', /潮势|大潮日/.test(ui.legend), ui.legend.slice(0, 80));
  console.log('    图例:', ui.legend.slice(0, 150));
  console.log('    日期格:', ui.datesText.slice(0, 90));
  await b.close();
}

/* ================= E. 存档里的过去日期要被丢弃 ================= */
console.log('\n=== E. 存档恢复：昨天选好的日期，今天打开要作废 ===');
{
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  // 冻到 9/30，但存档里写着 9/25（过去）
  await p.addInitScript(() => {
    const FIXED = new Date('2026-09-30T10:00:00+08:00').getTime();
    const _D = Date;
    function FD(...a) { return a.length ? new _D(...a) : new _D(FIXED); }
    FD.now = () => FIXED; FD.parse = _D.parse; FD.UTC = _D.UTC;
    FD.prototype = _D.prototype;
    window.Date = FD;
    try {
      localStorage.setItem('chaoxi.plan.v1', JSON.stringify({
        date: '2026-09-25', originId: 'hangzhou-cbd', companionType: 'family',
        safetyAck: true, chosen: { date: true, origin: true }
      }));
    } catch (e) {}
  });
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => ({
    date: window.App && window.App.getState ? window.App.getState().date : null,
    today: window.TideData._today,
    isPast: window.App && window.App.getState ? window.TideData.isPast(window.App.getState().date || '') : null,
    lsRaw: (() => { try { return JSON.parse(localStorage.getItem('chaoxi.plan.v1') || '{}').date; } catch (e) { return null; } })()
  }));
  console.log('    localStorage 里:', r.lsRaw, '| 实际采用:', r.date, '| 今天:', r.today);
  check('存档里的 9/25 已被丢弃（不采用过去日期）',
    r.date !== '2026-09-25', r.date);
  check('采用的新日期不是过去', r.date === null || r.isPast === false, r.date);
  check('无运行期错误', errs.length === 0, errs);
  await b.close();
}

console.log('\n' + '='.repeat(52));
console.log(`日期窗口验证：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
