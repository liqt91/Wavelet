/**
 * test-engine.js — 倒计时引擎行为验证
 *
 * 用固定 now 注入，验证状态机五态、手填覆盖、边界情况。
 * 这些是「能失败」的断言 —— 不是走过场的 console.log。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = { console };
sandbox.window = sandbox;          // 让 lib 里的 `window.TideData = ...` 落回沙箱顶层
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['lib/tide-data.js', 'lib/countdown.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const TideData = sandbox.TideData;
const CountdownEngine = sandbox.CountdownEngine;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

function at(dateStr, hhmm) {
  const d = new Date(dateStr + 'T00:00:00');
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

console.log('\n=== 1. 基础数据完整性 ===');
check('5 个点位都有 id', TideData.POINTS.length === 5);
check('每个点位都有 l3Safety（L3 点位级安全提示）',
  TideData.POINTS.every(p => p.l3Safety && p.l3Safety.length > 10));
check('每个点位都有 whatYouSee（预期管理 M3c）',
  TideData.POINTS.every(p => p.whatYouSee && p.whatYouSee.length > 5));
check('所有野生点位风险等级不为"低"（M7e 第 3 条红线）',
  TideData.POINTS.filter(p => p.type === 'wild').every(p => p.risk !== '低'));
/* allDates 只返回「今天及以后」—— 所以断言基准是「内置表总天数」而不是过滤后的。
   今天(2026-09-30)时窗口一(9/25-9/29)已过去，可见日期为 10 天。 */
check('内置潮汐表覆盖 15 天（3 个窗口）', TideData.allDatesRaw.length === 15, '实际 ' + TideData.allDatesRaw.length);
check('可见日期已滤掉过去（今天 9/30 → 只剩 10 天）', TideData.allDates.length === 10, '实际 ' + TideData.allDates.length);
check('可见日期全部 >= 今天', TideData.allDates.every(d => d >= '2026-09-30'), TideData.allDates[0]);
check('每天都 5 个点位齐全',
  TideData.allDates.every(d => Object.keys(TideData.TIDE_TABLE[d].tides).length === 5));

console.log('\n=== 2. 状态机五态（以 10/27 峰值日 老盐仓 晚潮 18:10 为例）===');
/* 10/27 = 农历九月十八，是本轮大潮的峰值日（提前量 2h）。
   原用例用 10/25，但 10/25 实为九月十六、非峰值日 —— 峰值已校正到 10/27。 */
const D = '2026-10-27', P = 'laoyancang';
const tide = TideData.getTide(D, P);
check('10/27 老盐仓晚潮为 18:10', tide.evening === '18:10', tide.evening);
check('10/27 为峰值日（提前量应为 2h）', tide.peak === true);

// 峰值日：提前 120 分 + 车程 70 分 = 190 分 → 出发 15:00
let c = CountdownEngine.compute(D, P, { now: at(D, '08:00') });
check('早 8 点 → 计划中', c.phase === 'planned', c.phase);
check('出发时间算出为 15:00', CountdownEngine.hhmm(c.departAt) === '15:00', CountdownEngine.hhmm(c.departAt));
check('提前量为 120 分钟', c.leadMinutes === 120, c.leadMinutes);

c = CountdownEngine.compute(D, P, { now: at(D, '14:40') });
check('14:40（距出发 20 分）→ 该出发了', c.phase === 'depart', c.phase);

c = CountdownEngine.compute(D, P, { now: at(D, '16:00') });
check('16:00（已过出发点）→ 候潮中', c.phase === 'waiting', c.phase);

c = CountdownEngine.compute(D, P, { now: at(D, '18:00') });
check('18:00（潮前 10 分）→ 潮马上到', c.phase === 'arriving', c.phase);

c = CountdownEngine.compute(D, P, { now: at(D, '18:15') });
check('18:15（潮已过）→ 已散潮', c.phase === 'passed', c.phase);

console.log('\n=== 3. 提前量分级（大潮日 2h / 平日 1h）===');
const tide11 = TideData.getTide('2026-10-11', 'yanguan');
check('10/11 盐官非峰值日', tide11.peak === false);
c = CountdownEngine.compute('2026-10-11', 'yanguan', { now: at('2026-10-11', '08:00') });
check('非峰值日提前量为 60 分钟', c.leadMinutes === 60, c.leadMinutes);

console.log('\n=== 4. 点位差异（车程不同 → 出发时间不同）===');
const cY = CountdownEngine.compute(D, 'yanguan', { now: at(D, '08:00') });
const cC = CountdownEngine.compute(D, 'chengshiyangtai', { now: at(D, '08:00') });
check('盐官车程 75 分', cY.driveMinutes === 75, cY.driveMinutes);
check('城市阳台车程 15 分', cC.driveMinutes === 15, cC.driveMinutes);
check('两者出发时间不同', CountdownEngine.hhmm(cY.departAt) !== CountdownEngine.hhmm(cC.departAt));

console.log('\n=== 5. 手填校正覆盖（方案 ③ —— 必须影响所有读取路径）===');
// 未校正：用内置值
let raw = TideData.getTide(D, P);
check('校正前 evening = 18:10', raw.evening === '18:10', raw.evening);
check('校正前 overridden = false', raw.overridden === false);

TideData.setOverride(D, P, '10:00', '17:30');
let ov = TideData.getTide(D, P);
check('校正后 evening = 17:30', ov.evening === '17:30', ov.evening);
check('校正后 morning = 10:00', ov.morning === '10:00', ov.morning);
check('校正后 overridden = true', ov.overridden === true);

// 关键：倒计时也必须跟着变（这是最容易分叉的地方）
// 注意：08:00 时「早潮 10:00」还没过，引擎取紧接着的早潮 → 出发 06:50（与基准日无关）
//      这是正确行为（先生效的潮优先）。下面同时验证只填晚潮的情况。
c = CountdownEngine.compute(D, P, { now: at(D, '08:00') });
check('校正后引擎取紧接着的早潮 10:00，出发 06:50',
  CountdownEngine.hhmm(c.departAt) === '06:50' && c.tideLabel === '早潮',
  CountdownEngine.hhmm(c.departAt) + '/' + c.tideLabel);

// 只填晚潮（清掉早潮）→ 应取晚潮 17:30，出发 = 17:30 − 190 分 = 14:20
TideData.setOverride(D, P, '', '17:30');
c = CountdownEngine.compute(D, P, { now: at(D, '08:00') });
check('只填晚潮 17:30 → 出发时间为 14:20',
  CountdownEngine.hhmm(c.departAt) === '14:20' && c.tideLabel === '晚潮',
  CountdownEngine.hhmm(c.departAt) + '/' + c.tideLabel);
check('未填的早潮仍用内置值（10/27 老盐仓无早潮）',
  TideData.getTide(D, P).morning === '...', TideData.getTide(D, P).morning);

// 别的点位不该被污染
const other = TideData.getTide(D, 'yanguan');
check('其他点位不受影响（盐官仍 17:15）', other.evening === '17:15', other.evening);
check('其他点位 overridden = false', other.overridden === false);

// 别的日期不该被污染
const otherDay = TideData.getTide('2026-10-26', P);
check('其他日期不受影响（10/26 老盐仓 17:25）', otherDay.evening === '17:25', otherDay.evening);

TideData.clearOverride();
check('clearOverride 后恢复内置值', TideData.getTide(D, P).evening === '18:10');

console.log('\n=== 6. 无数据 / 边界 ===');
const noData = TideData.getTide('2026-10-01', 'yanguan');
check('非大潮日无数据 → null', noData === null);
c = CountdownEngine.compute('2026-10-01', 'yanguan', { now: new Date() });
check('非大潮日 → phase = nodata', c.phase === 'nodata', c.phase);

// 只有晚潮的日期，早潮为 "..." 不应被当成有效时间
const d10 = TideData.getTide('2026-10-10', 'yanguan');
check('10/10 早潮为 "..."（无早潮）', d10.morning === '...', d10.morning);
c = CountdownEngine.compute('2026-10-10', 'yanguan', { now: at('2026-10-10', '08:00') });
check('无早潮时仍能算出晚潮时间线', c.phase === 'planned' && c.tideLabel === '晚潮', c.phase + '/' + c.tideLabel);

console.log('\n=== 7. 时长格式化 ===');
check('0 分钟', CountdownEngine.humanDur(0) === '不到 1 分钟', CountdownEngine.humanDur(0));
check('45 分', CountdownEngine.humanDur(45 * 60000) === '45 分钟', CountdownEngine.humanDur(45 * 60000));
check('2 小时', CountdownEngine.humanDur(120 * 60000) === '2 小时', CountdownEngine.humanDur(120 * 60000));
check('3 小时 12 分', CountdownEngine.humanDur((3 * 60 + 12) * 60000) === '3 小时 12 分',
  CountdownEngine.humanDur((3 * 60 + 12) * 60000));
check('负数取绝对值（已过时）', CountdownEngine.humanDur(-30 * 60000) === '30 分钟',
  CountdownEngine.humanDur(-30 * 60000));

console.log('\n=== 7b. 现场期秒级粒度（M2 分档：计划期到分 / 现场期到秒）===');
// 这里复刻 app.js 的 humanDurSec —— 两侧不一致会导致显示行为回归
function humanDurSec(ms) {
  const past = ms < 0;
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  let body;
  if (m > 0) body = `${m} 分 ${String(s).padStart(2, '0')} 秒`;
  else body = `${s} 秒`;
  return past ? `已过 ${body}` : body;
}
check('5 分 30 秒', humanDurSec(330 * 1000) === '5 分 30 秒', humanDurSec(330 * 1000));
check('补零（1 分 07 秒）', humanDurSec(67 * 1000) === '1 分 07 秒', humanDurSec(67 * 1000));
check('不足 1 分钟（47 秒）', humanDurSec(47 * 1000) === '47 秒', humanDurSec(47 * 1000));
check('已过（负值）', humanDurSec(-30 * 1000) === '已过 30 秒', humanDurSec(-30 * 1000));
// 分档边界：20 分钟
const D2 = '2026-10-25', P2 = 'laoyancang';
let cc = CountdownEngine.compute(D2, P2, { now: at(D2, '16:25') });   // 潮前 15 分
check('潮前 15 分 → 处于现场期（≤20 分钟）', Math.abs(cc.msToTide) <= 20 * 60000 && cc.phase === 'arriving',
  cc.phase + '/' + Math.round(cc.msToTide / 60000) + '分');
cc = CountdownEngine.compute(D2, P2, { now: at(D2, '15:00') });       // 潮前 100 分
check('潮前 100 分 → 处于计划期（>20 分钟）', Math.abs(cc.msToTide) > 20 * 60000,
  Math.round(cc.msToTide / 60000) + '分');

console.log('\n=== 8. 数据过期判定（14 天）===');
check('当天不算过期', TideData.isStale(TideData.DATA_DATE) === false);
check('13 天后不算过期', TideData.isStale('2026-10-13') === false);
check('15 天后算过期', TideData.isStale('2026-10-15') === true);

console.log('\n=== 9. 安全内容完整性（M7 红线）===');
check('免责声明有 5 段', TideData.SAFETY.wildDisclaimer.paras.length === 5);
check('免责声明勾选文案存在', TideData.SAFETY.wildDisclaimer.checkbox.length > 10);
check('页脚免责声明有 6 条', TideData.SAFETY.footer.length === 6);
check('禁止清单有 6 条', TideData.SAFETY.layers.forbid.length === 6);
check('预警信号有 3 条', TideData.SAFETY.layers.warnings.length === 3);

console.log('\n=== 10. 避雷数据（M10）===');
let pitCount = 0;
TideData.PITFALLS.forEach(c => pitCount += c.items.length);
check('避雷条目共 10 条', pitCount === 10, '实际 ' + pitCount);
check('每条都有 why 和 how（不只有情绪）',
  TideData.PITFALLS.every(c => c.items.every(i => i.why && i.how)));
check('劝退四类人', TideData.DISCOURAGE.length === 4);
check('每类劝退都有替代建议', TideData.DISCOURAGE.every(d => d.alt && d.alt.length > 5));

console.log('\n=== 11. 海报内容（M11 强制项）===');
check('海报安全须知 4 条', TideData.SAFETY.posterSafety.length === 4);
check('海报免责声明存在', TideData.SAFETY.posterDisclaimer.includes('风险自担'));

console.log('\n' + '='.repeat(46));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(46) + '\n');
process.exit(fail ? 1 : 0);
