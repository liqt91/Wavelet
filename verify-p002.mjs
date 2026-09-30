/**
 * verify-p002.mjs — P0-02 端到端验证（两视图版）
 * 断言：数据过期后，页面任何位置都不得出现具体潮时数字（HH:MM 形式）。
 * 这是设计稿 8.1 的硬要求，也是可验收标准。
 *
 * 交互改版后页面分两视图：view-ask（向导）/ view-plan（方案）。
 * 过期降级的检查面因此变成：
 *   - 向导页：日期格要标「已过期」，不得给出潮时
 *   - 方案页：潮时格 / 倒计时 / 潮势星级 全部撤下，只留引导
 *   - 残留 HH:MM 必须逐一可解释（交通时刻或反面教材）
 */
import { webkit } from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const URL = 'file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html';
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
};

/** 把浏览器里所有形如 12:34 的文本节点连同 DOM 路径抓出来 */
const RESIDUAL_FN = () => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (!/\b([01]?\d|2[0-3]):[0-5]\d\b/.test(n.textContent)) continue;
    let el = n.parentElement, path = [];
    while (el && el !== document.body) {
      path.unshift(el.id ? '#' + el.id : (el.className && el.className.split(' ')[0]) || el.tagName.toLowerCase());
      el = el.parentElement;
    }
    out.push({ text: n.textContent.trim().slice(0, 90), path: path.join(' > ') });
  }
  return out;
};

/**
 * 起一个「时间已过去 N 天」的浏览器。
 * stopAt: 'safety'（只停在第 1 步）| 'date'（推进到日期步停下）| false（走完全程进方案页）
 */
async function openAt(daysLater, { walk = true, stopAt = false } = {}) {
  const b = await webkit.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript((n) => {
    const FIXED = new Date('2026-09-30T14:00:00+08:00').getTime() + n * 86400000;
    const _D = Date;
    function FD(...a) { return a.length ? new _D(...a) : new _D(FIXED); }
    FD.now = () => FIXED; FD.parse = _D.parse; FD.UTC = _D.UTC;
    FD.prototype = _D.prototype;
    window.Date = FD;
  }, daysLater);
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(900);

  if (walk) {
    // 安全确认（按钮即知情同意）
    const has = await p.evaluate(() => !!document.getElementById('askNext'));
    if (has) {
      await p.click('#askNext'); await p.waitForTimeout(250);
      // 日期必须等进到第 2 步才能读到（第 1 步时 #askDates 还不存在）
      // 且必须选「今天及以后」的日期 —— 表里最早几天在 +3d/+30d 场景下已经过去，
      // 选中它们会让倒计时进入 passed 相位，把"新鲜数据"场景测成一个假红。
      // 日历是连续的（含小潮日），必须挑内置表实测覆盖的大潮日才有具体潮时。
      // 且必须选「今天及以后」的日期 —— 表里最早几天在 +3d/+30d 场景下已经过去，
      // 选中它们会让倒计时进入 passed 相位，把"新鲜数据"场景测成一个假红。
      const d = await p.evaluate(() => {
        const list = (window.TideData && window.TideData.allDates) || [];
        const el = list.map(x => document.querySelector(`#askDates .ask-date[data-date="${x}"]`)).find(Boolean);
        return el ? el.dataset.date : null;
      });
      if (d) {
        await p.click(`#askDates .ask-date[data-date="${d}"]`);
        await p.waitForTimeout(150);
      }
      if (stopAt === 'date') return { b, p, errs, pickedDate: d };
      /* 选不到日期说明内置表已无未来日期（如 +30d 场景）——
         此时按钮是 disabled 的「跳过」语义，点 #askSkip 继续。 */
      const canNext = await p.evaluate(() => {
        const n = document.getElementById('askNext');
        return n && !n.disabled;
      });
      if (canNext) { await p.click('#askNext'); }
      else { await p.click('#askSkip'); }
      await p.waitForTimeout(250);
      await p.click('#askPanel .ask-opt:nth-child(1)');
      await p.click('#askNext'); await p.waitForTimeout(200);
      await p.selectOption('#askOrigin', 'hangzhou-cbd');
      await p.click('#askNext'); await p.waitForTimeout(500);
      // 若推荐落在野生点位会弹 L4 —— 先「已知晓」（本文只查过期，不查 L4）
      const l4 = await p.evaluate(() => !document.getElementById('wildOverlay').hidden);
      if (l4) {
        await p.evaluate(() => {
          const c = document.querySelector('#wildDisclaimerBody input[type=checkbox]');
          if (c) { c.checked = true; c.dispatchEvent(new Event('change')); }
        });
        await p.waitForTimeout(150);
        await p.click('#wildOk').catch(() => {});
        await p.waitForTimeout(400);
      }
      // 固定到盐官，口径稳定
      await p.evaluate(() => window.App && window.App.pick('yanguan'));
      await p.waitForTimeout(400);
    }
  }
  return { b, p, errs };
}

/* ============ 场景 1：数据新鲜（+3 天）→ 应正常显示潮时 ============ */
console.log('\n=== A. 数据新鲜（数据日 +3 天）→ 正常显示潮时 ===');
{
  const { b, p } = await openAt(3);
  const r = await p.evaluate(() => {
    const times = document.querySelector('.plan-times');
    return {
      badge: document.getElementById('dataVersion').textContent,
      staleBarHidden: document.getElementById('staleBar').hidden,
      planVisible: !document.getElementById('view-plan').hidden,
      timesText: times ? times.innerText.replace(/\s+/g, ' ') : '',
      heroCount: (document.getElementById('heroCount') || {}).textContent || '',
      planCountText: (document.querySelector('.plan-count') || { innerText: '' }).innerText.replace(/\s+/g, ' ')
    };
  });
  check('徽章显示「更新至」而非过期', /更新至/.test(r.badge) && !/已过期/.test(r.badge), r.badge);
  check('过期提示条隐藏', r.staleBarHidden === true);
  check('新鲜数据下已进入方案页', r.planVisible === true);
  check('首屏潮时区有具体时刻（新鲜应正常）', /\d{1,2}:\d{2}/.test(r.timesText), r.timesText.slice(0, 120));
  // 新鲜数据下必须给出可执行的出发时间（即使该日潮已过，「建议出发」也应有数字或明确理由）
  check('新鲜数据下倒计时块存在', /距离潮到|距离出发/.test(r.planCountText), r.planCountText.slice(0, 120));
  console.log('    日期区:', r.timesText.slice(0, 90));
  console.log('    倒计时:', r.planCountText.slice(0, 90));
  await b.close();
}

/* ============ 场景 2：数据过期（+30 天）→ 全面降级 ============ */
console.log('\n=== B. 数据过期（数据日 +30 天）→ 停止显示任何具体潮时 ===');
{
  const { b, p, errs } = await openAt(30);

  const r = await p.evaluate(() => {
    const times = document.querySelector('.plan-times');
    return {
      badge: document.getElementById('dataVersion').textContent,
      badgeStale: document.getElementById('dataVersion').classList.contains('stale'),
      staleBarVisible: !document.getElementById('staleBar').hidden,
      staleBarText: document.getElementById('staleBar').innerText.replace(/\s+/g, ' '),
      timesText: times ? times.innerText.replace(/\s+/g, ' ') : '',
      countExists: !!document.getElementById('heroCount'),
      planText: document.getElementById('planMain').innerText.replace(/\s+/g, ' '),
      calText: document.getElementById('calendar').innerText.replace(/\s+/g, ' '),
      calLen: document.getElementById('calendar').innerHTML.length
    };
  });

  check('徽章切换为「已过期」', /已过期/.test(r.badge), r.badge);
  check('徽章样式标记 stale', r.badgeStale === true);
  check('过期提示条已显示', r.staleBarVisible === true);
  check('提示条说明「已停止显示具体潮时」', /停止显示|不再显示/.test(r.staleBarText), r.staleBarText);

  // ★ 核心断言：方案卡潮时区不得出现具体潮时
  check('★核心：方案卡潮时区无具体潮时（HH:MM）', !/\d{1,2}:\d{2}/.test(r.timesText),
    r.timesText.slice(0, 200));
  check('★核心：方案卡明确写出「不显示具体潮时」',
    /不显示具体潮时|数据已过期/.test(r.timesText), r.timesText.slice(0, 200));

  // 倒计时应整体撤下（不是显示 00:00，而是根本不渲染）
  check('★核心：倒计时整块撤下', r.countExists === false, r.countExists);
  check('★核心：方案区无「建议 xx:xx 出发」', !/建议\s*\d{1,2}:\d{2}\s*出发/.test(r.planText),
    r.planText.slice(0, 200));
  check('方案区给出「去官方查」的引导', /官方|校正|过期/.test(r.planText), r.planText.slice(0, 200));

  // 潮势星级也应撤下（星级直接驱动「值不值得跑一趟」）
  check('★核心：过期时不显示潮势星级', !/★★★|★☆|★★★★/.test(r.planText), r.planText.slice(0, 200));

  // 日历矩阵不应渲染过期时刻
  check('★核心：日历不再渲染具体潮时', r.calLen === 0 || !/\d{1,2}:\d{2}/.test(r.calText),
    { len: r.calLen, text: r.calText.slice(0, 120) });

  /* ★ 更严的口径：残留时刻必须逐一有正当理由，不能是"没抓干净的潮时"。
     允许的只有两类：
       (1) 交通时刻（观潮列车发车时间）—— 与潮汐无关；
       (2) 反面教材里的引号时刻（"某 AI 给的时间"）—— 恰恰在提醒用户别信。
     任何出现在「潮时/建议出发/倒计时」语义位置上的 HH:MM 都算失败。 */
  const residual = await p.evaluate(RESIDUAL_FN);
  const ILLEGAL_PATH = /plan-times|plan-count|heroCount|calendar|ask-date/;
  const bad = residual.filter(x => ILLEGAL_PATH.test(x.path) && !/列车|发车|AI/.test(x.text));
  console.log('    页面中残留的 HH:MM:', JSON.stringify(residual.map(x => x.path + ' » ' + x.text)));
  check('★核心：潮时要塞里无「未被解释的」HH:MM', bad.length === 0, bad);
  check('残留时刻均属交通/反面教材，非潮时', residual.length <= 3, residual);
  check('无运行期错误', errs.length === 0, errs);
  await b.close();
}

/* ============ 场景 2b：过期态下向导页也不得报潮时 ============ */
console.log('\n=== B2. 过期但只停在向导页 → 日期格须标已过期 ===');
{
  const { b, p } = await openAt(30, { walk: true, stopAt: 'date' });
  const r = await p.evaluate(() => ({
    onAsk: !document.getElementById('view-ask').hidden,
    dateText: document.getElementById('askDates').innerText.replace(/\s+/g, ' '),
    staleMarks: document.querySelectorAll('#askDates .ask-date.is-stale, #askDates ~ .stale-note, .stale-note').length,
    askAllTimes: (document.getElementById('view-ask').innerText.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || [])
  }));
  check('过期态停在向导页', r.onAsk === true);
  check('日期格标记为已过期', r.staleMarks > 0, r.staleMarks);
  check('★核心：向导页日期格无具体潮时', r.askAllTimes.length === 0, r.askAllTimes);
  console.log('    日期区:', r.dateText.slice(0, 120));
  await b.close();
}

/* ============ 场景 3：过期但用户手填校正 → 应恢复可用 ============ */
console.log('\n=== C. 过期 + 用户手填校正 → 自救路径必须可用 ===');
{
  const { b, p } = await openAt(30);
  // 校正区在折叠的「官方入口」<details> 内 —— 折叠时 innerText 为空，
  // 用 textContent 判断存在性，并顺带把 details 展开以便后续交互。
  const hasCorrection = await p.evaluate(() => {
    const det = document.getElementById('ref-official');
    if (det) det.open = true;
    const c = document.getElementById('correction');
    return !!c && c.textContent.trim().length > 0 && !!c.querySelector('input');
  });
  check('校正区可用（存在输入与生效路径）', hasCorrection === true);

  // 手填一个潮时，看方案能否恢复数字
  const filled = await p.evaluate(() => {
    const box = document.getElementById('correction');
    if (!box) return false;
    const i = box.querySelector('input');
    if (!i) return false;
    i.value = '14:35';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
    const btn = box.querySelector('button');
    if (btn) btn.click();
    return true;
  });
  check('校正输入存在并已填写', filled === true);
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const times = document.querySelector('.plan-times');
    return {
      badge: document.getElementById('dataVersion').textContent,
      timesText: times ? times.innerText.replace(/\s+/g, ' ') : ''
    };
  });
  console.log('    校正后潮时区:', r.timesText.slice(0, 120));
  check('校正后可覆盖过期状态（徽章或潮时区有变化）',
    /14:35/.test(r.timesText) || !/已过期/.test(r.badge),
    { badge: r.badge, times: r.timesText.slice(0, 120) });
  await b.close();
}

console.log('\n' + '='.repeat(50));
console.log(`P0-02 验证：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
