import { webkit } from 'playwright-core';
const b = await webkit.launch();
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'load' });
await p.waitForTimeout(900);

/* 真实用户路径：勾同意 → 进 → 点清单行 → 刷新生效 */
const agree = await p.$('#l1Agree');
await agree.click();
await p.waitForTimeout(150);
await p.click('#l1Ok');
await p.waitForTimeout(400);
const l1Hidden = await p.evaluate(() => document.getElementById('l1Overlay').hidden);
console.log('1. L1 关闭:', l1Hidden ? '✓' : '✗');

// 真实鼠标点清单第 4 行（纯文字区，不点方框）
const pt = await p.evaluate(() => {
  const lab = Array.from(document.querySelectorAll('label.check-item'))[3];
  lab.scrollIntoView({ block: 'center' });
  const t = lab.querySelector('.txt').getBoundingClientRect();
  return { x: t.left + t.width * 0.6, y: t.top + t.height / 2, label: lab.querySelector('.txt').textContent };
});
const before = await p.evaluate(() => Array.from(document.querySelectorAll('label.check-item'))[3].querySelector('input').checked);
await p.mouse.click(pt.x, pt.y);
await p.waitForTimeout(350);
const after = await p.evaluate(() => Array.from(document.querySelectorAll('label.check-item'))[3].querySelector('input').checked);
const ls = await p.evaluate(() => localStorage.getItem('cx_checklist_v1'));
console.log('2. 点文字区切换:', `${before}→${after}`, after !== before ? '✓' : '✗', '| 落库:', ls);
console.log('   项目:', pt.label);

// 刷新持久化
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(900);
await p.evaluate(() => { const c = document.getElementById('l1Agree'); if (c) { c.checked = true; c.dispatchEvent(new Event('change')); } const o = document.getElementById('l1Ok'); if (o) o.click(); });
await p.waitForTimeout(400);
const persisted = await p.evaluate(() => document.querySelectorAll('label.check-item.done').length);
console.log('3. 刷新后仍勾选:', persisted > 0 ? `✓ (${persisted} 项)` : '✗');

// 折叠标题真实点击（点中部文字）
await p.evaluate(() => document.querySelector('.footer details summary').scrollIntoView({ block: 'center' }));
await p.waitForTimeout(200);
const sp = await p.evaluate(() => { const e = document.querySelector('.footer details summary'); const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height / 2, h: Math.round(r.height) }; });
await p.mouse.click(sp.x, sp.y);
await p.waitForTimeout(300);
const opened = await p.evaluate(() => document.querySelector('.footer details').open);
console.log(`4. 折叠标题(h=${sp.h}px)点中部展开:`, opened ? '✓' : '✗');

// 底栏遮挡检查：滚到底部，看最后一个模块是否被固定底栏盖住
const cover = await p.evaluate(() => {
  window.scrollTo(0, document.body.scrollHeight);
  return new Promise(r => setTimeout(() => {
    const bar = document.querySelector('.bottom-bar');
    const br = bar.getBoundingClientRect();
    const els = document.elementsFromPoint(window.innerWidth / 2, br.top - 4).map(e => e.tagName + '.' + (e.className || ''));
    r({ barTop: Math.round(br.top), beneath: els.slice(0, 3) });
  }, 300));
});
console.log('5. 底栏上方元素:', JSON.stringify(cover));
console.log('运行期错误:', errs.length ? errs : '（无）');
await b.close();
