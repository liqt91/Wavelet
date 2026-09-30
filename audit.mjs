/**
 * audit.mjs — 交互与视觉可用性评审（客观测量）
 *
 * 不靠"看代码猜"，用真实浏览器测：
 *   A 对比度（WCAG 2.2 AA：正文 4.5:1，大字/UI 组件 3:1）
 *   B 点击目标尺寸（移动端最小 44×44 CSS px）
 *   C 信息层级与首屏可见性
 *   D 可访问性与语义
 *   E 交互一致性（同一动作是否同一结果）
 *   F 内容冗余与认知负担
 */
import { webkit } from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs';

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto('file:///C:/Users/Administrator/WorkBuddy/2026-09-30-10-11-28/chaoxi-app/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1000);

/* 走完两视图流程：安全确认 → 日期 → 同行人 → 出发地 → 方案页，
   然后固定到盐官（official），让审计口径稳定。 */
await page.click('#askNext'); await page.waitForTimeout(300);   // 安全步：按钮即确认
await page.evaluate(() => {
  const b = document.querySelector('#askDates .ask-date'); if (b) b.click();
});
await page.waitForTimeout(150);
await page.click('#askNext'); await page.waitForTimeout(300);
await page.click('#askPanel .ask-opt:nth-child(1)');
await page.click('#askNext'); await page.waitForTimeout(300);
await page.selectOption('#askOrigin', 'hangzhou-cbd');
await page.click('#askNext'); await page.waitForTimeout(600);
const l4 = await page.evaluate(() => !document.getElementById('wildOverlay').hidden);
if (l4) { await page.click('#wildCancel'); await page.waitForTimeout(400); }
await page.evaluate(() => window.App && window.App.pick('yanguan'));
await page.waitForTimeout(600);

// 先记录"折叠区默认态"——必须在展开之前采样，否则会把审计自己的动作当成产品缺陷
const refsDefault = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('details.ref'));
  return { total: all.length, openByDefault: all.filter(d => d.open).length };
});

// 展开全部折叠参考区，否则 innerText 为空、对比度取样取不到
await page.evaluate(() => {
  document.querySelectorAll('details.ref').forEach(d => { d.open = true; });
});
await page.waitForTimeout(400);

const issues = [];
const add = (sev, area, title, detail) => issues.push({ sev, area, title, detail });

/* ===== A0. 配色方案理论对比度（不依赖当前状态，逐对计算）===== */
const palette = await page.evaluate(() => {
  function lum(rgb) {
    const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function hex2rgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function ratio(a, b) {
    const L1 = lum(hex2rgb(a)), L2 = lum(hex2rgb(b));
    return ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
  }
  const pairs = [
    ['首屏建议·绿字', '#2c5238', '#e9f1e6'],
    ['首屏建议·黄字', '#6b4a10', '#faf2dd'],
    ['首屏建议·红字', '#8f2b1e', '#f9ebe6'],
    ['首屏建议·黛青字', '#22484a', '#e7eeea'],
    ['预期管理·正文', '#000000', '#f3e9cd'],
    ['L2 红条白字', '#ffffff', '#b03a2a'],
    ['海报安全须知白字', '#ffffff', '#b03a2a'],
    ['海报免责灰字', '#5f6661', '#f6f3ec'],
    ['禁用按钮文字', '#5f6661', '#eee9dc'],
    ['日历经色块·白字(橙)', '#ffffff', '#a06a24'],
    ['日历经色块·白字(浓汤)', '#ffffff', '#7a4a16'],
    ['日历经色块·深字(浅汤)', '#000000', '#d4bf90']
  ];
  return pairs.map(([n, fg, bg]) => ({ n, fg, bg, r: +ratio(fg, bg).toFixed(2) }));
});
console.log('\n=== A0. 配色方案理论对比度（关键组合）===');
palette.forEach(p => {
  const need = 4.5;
  const ok = p.r >= need;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${p.n}  ${p.r}:1  (${p.fg} on ${p.bg})`);
  if (!ok) add('高', '对比度', `${p.n} 对比度不足`, `${p.r}:1，需 ${need}:1（${p.fg} on ${p.bg}）`);
});

/* ===== A. 对比度 ===== */
const contrast = await page.evaluate(() => {
  function lum(rgb) {
    const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function parse(s) {
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }
  function bgOf(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const st = getComputedStyle(n);
      // 渐变背景：backgroundColor 是 transparent，但视觉上是实色 —— 从 backgroundImage 里取第一个色值
      if (/gradient/.test(st.backgroundImage)) {
        const m = st.backgroundImage.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) return [+m[1], +m[2], +m[3]];
      }
      const a = st.backgroundColor;
      if (!/rgba\(0,\s*0,\s*0,\s*0\)/.test(a) && !/transparent/.test(a)) {
        const bg = parse(a);
        if (bg) return bg;
      }
      n = n.parentElement;
    }
    return [255, 255, 255];
  }
  function ratio(fg, bg) {
    const L1 = lum(fg), L2 = lum(bg);
    return ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
  }
  const out = [];
  const sel = [
    ['.topbar h1', '顶部主标题'], ['.topbar .sub', '顶部副标题'],
    ['.footer .src', '页脚数据来源'],
    ['.safety-bar', 'L2 安全红条'],
    ['.plan-kicker', '方案·小标题'],
    ['.plan-when', '方案·日期行'],
    ['.plan-why', '方案·推荐理由'],
    ['.plan-times .k', '方案·格标签'],
    ['.plan-times .v', '方案·格数值'],
    ['.plan-times .n', '方案·格备注'],
    ['.plan-count .lbl', '方案·倒计时标签'],
    ['.answer-pill', '答案条·回改按钮'],
    ['.ask-q', '向导·问题标题'],
    ['.ask-hint', '向导·问题提示'],
    ['.ask-opt .body span', '向导·选项副文案'],
    ['.ask-date span', '向导·日期格副文案'],
    ['.stale-note', '过期说明块'],
    ['details.ref summary', '折叠区标题'],
    ['.point-types', '点位潮型小字'],
    ['.point-ticket.free', '免费标签'],
    ['.point-ticket.paid', '购票标签'],
    ['.tag', '通用标签'],
    ['.tag.pass', '需通行证标签'],
    ['.l3-safety', 'L3 点位风险框'],
    ['.pit-item .why', '避雷·真实情况'],
    ['.pit-item .how', '避雷·怎么办'],
    ['.check-progress', '清单进度条'],
    ['.cal-cell', '日历色块'],
    ['.official-btn small', '官方入口副标题'],
    ['.btn-ghost', '次要按钮'],
    ['.btn-outline', '描边按钮'],
    ['#toast', 'Toast']
  ];
  sel.forEach(([s, name]) => {
    const el = document.querySelector(s);
    if (!el) { out.push({ name, err: '未找到元素' }); return; }
    const st = getComputedStyle(el);
    const fg = parse(st.color);
    if (!fg) { out.push({ name, err: '无法解析颜色' }); return; }
    const bg = bgOf(el);
    // opacity 是元素级：文字与背景一起被稀释。逐通道做 alpha 混合到实际背景上。
    const op = parseFloat(st.opacity);
    let adj = fg;
    if (!isNaN(op) && op < 1) {
      adj = fg.map((v, i) => Math.round(v * op + bg[i] * (1 - op)));
    }
    const size = parseFloat(st.fontSize);
    const bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
    const isLarge = size >= 24 || (size >= 18.66 && bold);
    const need = isLarge ? 3.0 : 4.5;
    out.push({ name, ratio: +ratio(adj, bg).toFixed(2), need, size, pass: ratio(adj, bg) >= need });
  });
  return out;
});

console.log('\n=== A. 对比度（WCAG 2.2 AA）===');
contrast.forEach(c => {
  if (c.err) { console.log(`  ????  ${c.name} → ${c.err}`); return; }
  const mark = c.pass ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${c.name}  ${c.ratio}:1  (需 ${c.need}:1, ${c.size}px)`);
  if (!c.pass) add('高', '对比度', `${c.name} 对比度不足`, `${c.ratio}:1，AA 要求 ${c.need}:1（字号 ${c.size}px）`);
});

/* ===== B. 点击目标尺寸 ===== */
const taps = await page.evaluate(() => {
  const out = [];
  const els = document.querySelectorAll('button, a, summary, .cal-cell, label.check-item, [data-pick], [data-date]');
  els.forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // 排除被 <label> 包裹的原生 checkbox：其可点热区是整行 label，不是 20×20 的方框
    if (el.matches('input[type=checkbox]') && el.closest('label')) return;
    const label = (el.textContent || el.id || el.className || '').trim().slice(0, 22).replace(/\s+/g, ' ');
    out.push({ label, w: Math.round(r.width), h: Math.round(r.height) });
  });
  return out;
});
console.log('\n=== B. 点击目标尺寸（移动端建议 ≥44×44）===');
const small = taps.filter(t => t.h < 44 || t.w < 44);
console.log(`  共 ${taps.length} 个可点元素，其中 ${small.length} 个小于 44px：`);
small.slice(0, 20).forEach(t => console.log(`    · "${t.label}"  ${t.w}×${t.h}`));
if (small.length) add('中', '点击目标', `${small.length} 个可点元素小于 44×44`, small.map(t => `"${t.label}" ${t.w}×${t.h}`).slice(0, 6).join('；'));

/* ===== C. 首屏与信息层级 ===== */
const firstScreen = await page.evaluate(() => ({
  docHeight: document.body.scrollHeight,
  screenH: window.innerHeight,
  planText: (document.getElementById('planMain') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
  h1: document.querySelectorAll('h1').length,
  h2: document.querySelectorAll('h2').length,
  h3: document.querySelectorAll('h3').length,
  h4: document.querySelectorAll('h4').length,
  planCardTop: (() => { const e = document.querySelector('.plan-card'); return e ? Math.round(e.getBoundingClientRect().top) : null; })(),
  refsTop: (() => { const e = document.querySelector('.refs-head'); return e ? Math.round(e.getBoundingClientRect().top) : null; })(),
  cardTitles: Array.from(document.querySelectorAll('.ask-q, .plan-kicker, .refs-head')).map(e => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 30))
}));
console.log('\n=== C. 首屏与信息层级 ===');
console.log(`  页面总高 ${firstScreen.docHeight}px，视口 ${firstScreen.screenH}px → 约 ${(firstScreen.docHeight / firstScreen.screenH).toFixed(1)} 屏`);
console.log(`  方案卡起始 y=${firstScreen.planCardTop}px，参考资料区起始 y=${firstScreen.refsTop}px`);
console.log(`  标题层级：h1=${firstScreen.h1} h2=${firstScreen.h2} h3=${firstScreen.h3} h4=${firstScreen.h4}`);
console.log(`  模块标题（${firstScreen.cardTitles.length} 个）：`);
firstScreen.cardTitles.forEach(t => console.log(`    · ${t}`));

/* ===== D. 可访问性与语义 ===== */
const a11y = await page.evaluate(() => {
  const imgs = document.querySelectorAll('img');
  const btns = document.querySelectorAll('button');
  const inputs = document.querySelectorAll('input');
  const labels = document.querySelectorAll('label');
  const checkboxNoLabel = Array.from(inputs).filter(i => i.type === 'checkbox' && !i.closest('label') && !i.getAttribute('aria-label'));
  const emptyBtn = Array.from(btns).filter(b => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.title);
  const noLang = !document.documentElement.lang;
  const btnNoType = Array.from(btns).filter(b => !b.getAttribute('type'));
  // 内联 onclick 数量
  const inlineOnclick = document.querySelectorAll('[onclick]').length;
  const tabIndexNeg = document.querySelectorAll('[tabindex="-1"]').length;
  const liveRegions = document.querySelectorAll('[aria-live]').length;
  const roleCount = document.querySelectorAll('[role]').length;
  return {
    imgNoAlt: imgs.length - Array.from(imgs).filter(i => i.alt != null).length,
    imgTotal: imgs.length,
    checkboxNoLabel: checkboxNoLabel.length,
    emptyBtn: emptyBtn.length,
    noLang,
    btnNoType: btnNoType.length,
    inlineOnclick, tabIndexNeg, liveRegions, roleCount,
    labelCount: labels.length
  };
});
console.log('\n=== D. 可访问性与语义 ===');
console.log(`  <html lang> 存在: ${!a11y.noLang}`);
console.log(`  图片总数 ${a11y.imgTotal}，缺 alt: ${a11y.imgNoAlt}`);
console.log(`  checkbox 无标签: ${a11y.checkboxNoLabel}`);
console.log(`  空文本按钮（无 aria-label）: ${a11y.emptyBtn}`);
console.log(`  button 无 type 属性: ${a11y.btnNoType}`);
console.log(`  内联 onclick: ${a11y.inlineOnclick} 处`);
console.log(`  aria-live 区域: ${a11y.liveRegions}`);
console.log(`  带 role 的元素: ${a11y.roleCount}`);
if (a11y.noLang) add('中', '可访问性', 'html 缺 lang 属性', '影响屏幕阅读器发音');
if (a11y.emptyBtn) add('高', '可访问性', `${a11y.emptyBtn} 个按钮无可访问名称`, '图标按钮需要 aria-label');
if (a11y.checkboxNoLabel) add('中', '可访问性', `${a11y.checkboxNoLabel} 个 checkbox 缺标签`, '屏幕阅读器读不出用途');
if (a11y.liveRegions === 0) add('中', '可访问性', '没有 aria-live 区域', '倒计时更新对屏幕阅读器不可感知（每秒朗读会太吵，但至少需要 aria-atomic 或降频）');
if (a11y.inlineOnclick > 0) add('低', '代码质量', `${a11y.inlineOnclick} 处内联 onclick`, '无法用 CSP 加固，且事件顺序难控');

/* ===== E. 交互一致性 ===== */
console.log('\n=== E. 交互一致性 ===');
// E1: 方案页与底部栏是否都提供"生成观潮长图"，且是同一行为
const bothPoster = await page.evaluate(() => {
  const top = document.getElementById('btnPoster');
  const bottom = Array.from(document.querySelectorAll('.bottom-bar button')).find(b => b.textContent.includes('生成'));
  return { top: !!top, bottom: !!bottom,
    sameText: top && bottom && top.textContent.trim() === bottom.textContent.trim() };
});
console.log(`  方案页与底部栏都有"生成观潮长图": ${bothPoster.top && bothPoster.bottom}（文案一致: ${bothPoster.sameText}）`);
// E2: "看导航"只复制不跳转 —— 用户预期是打开地图
const navBehavior = await page.evaluate(() => {
  const b = document.querySelector('[data-viewmap]');
  return b ? b.textContent.trim() : null;
});
console.log(`  "看导航"按钮文案: "${navBehavior}"（实际行为需点按确认）`);

// E3: 向导日期格数量与语义
const dateBtns = await page.evaluate(() => {
  const b = document.querySelectorAll('#askDates [data-date]');
  return { count: b.length, first: b[0] ? b[0].textContent.trim().replace(/\s+/g, ' ') : null };
});
console.log(`  向导日期格 ${dateBtns.count} 个，首个显示 "${dateBtns.first}"`);

// E4: 清单总量
const clTotal = await page.evaluate(() => document.querySelectorAll('.check-item').length);
console.log(`  行前清单共 ${clTotal} 项`);

// E5: 两个视图互斥（同一时刻只能看到一个）
const views = await page.evaluate(() => ({
  askHidden: document.getElementById('view-ask').hidden,
  planHidden: document.getElementById('view-plan').hidden
}));
console.log(`  视图互斥: ask.hidden=${views.askHidden} plan.hidden=${views.planHidden}`);
console.log(`  参考资料折叠区 ${refsDefault.total} 个，默认展开 ${refsDefault.openByDefault} 个（应为 0）`);
if (refsDefault.openByDefault > 0) add('中', '信息层级', '参考区默认展开', '会重新把页面撑长，违背"先给方案再给资料"的规划');

/* ===== F. 内容密度 ===== */
const density = await page.evaluate(() => {
  const secs = ['#planMain', '#planAlt', '#planShare', '#ref-checklist', '#ref-pitfalls',
    '#ref-safety', '#ref-calendar', '#ref-wild', '#ref-official', '.bottom-bar'];
  const out = {};
  secs.forEach(s => {
    const el = document.querySelector(s);
    if (el) out[s] = Math.round(el.getBoundingClientRect().height);
  });
  return out;
});
console.log('\n=== F. 各模块高度（信息密度）===');
Object.entries(density).forEach(([k, v]) => console.log(`  ${k.padEnd(14)} ${v}px`));

console.log('\n' + '='.repeat(58));
console.log(`自动检出问题：${issues.length} 项`);
console.log('='.repeat(58));
issues.forEach((it, i) => console.log(`${i + 1}. [${it.sev}] ${it.area} · ${it.title}\n   ${it.detail}`));

await browser.close();
