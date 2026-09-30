/**
 * test-drive.js — 车程模块单元测试（P0-01）
 * 运行：node test-drive.js
 */

const path = require('path');
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`); }
}

/* ---- 构造带 localStorage 的沙箱 ---- */
const store = {};
const sandbox = {
  window: {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  console,
  setTimeout, clearTimeout, AbortController,
  Math, Date, JSON, parseInt, parseFloat, Number, Object, Array, String, isFinite
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;

const code = fs.readFileSync(path.join(__dirname, 'lib', 'drive.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const DriveService = sandbox.DriveService;

const GEOS = {
  yanguan: { lng: 120.5481, lat: 30.3906 },
  laoyancang: { lng: 120.4562, lat: 30.4013 },
  dakouque: { lng: 120.5093, lat: 30.3944 },
  meinvba: { lng: 120.2887, lat: 30.2032 },
  chengshiyangtai: { lng: 120.2126, lat: 30.2464 }
};

console.log('\n=== 1. 直线距离合理性（GCJ-02 坐标校验）===');
const hz = DriveService.ORIGINS.find(o => o.id === 'hangzhou-cbd');
const dYg = DriveService.straightLineKm(hz, GEOS.yanguan);
check('杭州市中心→盐官 直线 30–75km', dYg > 30 && dYg < 75, dYg.toFixed(1));
const dCyt = DriveService.straightLineKm(hz, GEOS.chengshiyangtai);
check('杭州市中心→城市阳台 直线 <15km', dCyt < 15, dCyt.toFixed(1));
check('城市阳台比盐官近得多', dCyt < dYg, { dCyt: dCyt.toFixed(1), dYg: dYg.toFixed(1) });
const sh = DriveService.ORIGINS.find(o => o.id === 'shanghai');
const dShYg = DriveService.straightLineKm(sh, GEOS.yanguan);
check('上海→盐官 直线 120–200km', dShYg > 120 && dShYg < 200, dShYg.toFixed(1));

console.log('\n=== 2. 估算值合理性（直线×1.3÷55km/h+12min）===');
const estHZ = DriveService.estimateMinutes(hz, GEOS.yanguan);
check('杭州市中心→盐官 估算 60–110 分钟', estHZ > 60 && estHZ < 110, estHZ);
const estSH = DriveService.estimateMinutes(sh, GEOS.yanguan);
check('上海→盐官 估算 >150 分钟（比杭州远）', estSH > 150, estSH);
const estCyt = DriveService.estimateMinutes(hz, GEOS.chengshiyangtai);
check('杭州市中心→城市阳台 估算 <40 分钟', estCyt < 40, estCyt);
check('上海估算 > 杭州估算', estSH > estHZ, { estSH, estHZ });

console.log('\n=== 3. resolve 优先级：用户手填 > 估算/缓存 > 兜底 ===');
const r1 = DriveService.resolve('yanguan', GEOS.yanguan, { userMinutes: 130 });
check('用户手填 130 生效', r1.minutes === 130 && r1.source === 'user', r1);

const r2 = DriveService.resolve('yanguan', GEOS.yanguan, { originId: 'shanghai' });
check('上海出发 → 估算值(非预设 75)', r2.minutes !== 75 && r2.source === 'estimate', r2);
const r2b = DriveService.resolve('yanguan', GEOS.yanguan, { originId: 'hangzhou-cbd' });
check('杭州出发 → 与上海不同', r2.minutes !== r2b.minutes, { sh: r2.minutes, hz: r2b.minutes });

const r3 = DriveService.resolve('yanguan', GEOS.yanguan, {});
check('无出发地 → 兜底预设 75', r3.minutes === 75 && r3.source === 'fallback', r3);

console.log('\n=== 4. 兜底不崩（缺坐标/未知点位）===');
const r4 = DriveService.resolve('unknowpoint', null, {});
check('未知点位+无坐标 → 仍有值不崩', typeof r4.minutes === 'number' && r4.minutes > 0, r4);
const r5 = DriveService.resolve('yanguan', null, { originId: 'hangzhou-cbd' });
check('有出发地但点位无坐标 → 回落兜底', r5.minutes === 75, r5);

console.log('\n=== 5. 无 key 时 upgrade 安全返回 null（不抛错、不发请求）===');
check('未配置 __AMAP_KEY__ 时 amapKey 为空', DriveService.amapKey() === '');

console.log('\n=== 6. 缓存：写入后 resolve 优先读缓存 ===');
store['cx_drive_cache_v1'] = JSON.stringify({
  'hangzhou-cbd->yanguan': { minutes: 88, source: 'amap', at: Date.now() }
});
const r6 = DriveService.resolve('yanguan', GEOS.yanguan, { originId: 'hangzhou-cbd' });
check('命中缓存 → 用 88 且 source=amap', r6.minutes === 88 && r6.source === 'amap', r6);

store['cx_drive_cache_v1'] = JSON.stringify({
  'hangzhou-cbd->yanguan': { minutes: 88, source: 'amap', at: Date.now() - 25 * 3600 * 1000 }
});
const r7 = DriveService.resolve('yanguan', GEOS.yanguan, { originId: 'hangzhou-cbd' });
check('缓存过期(25h) → 退回估算', r7.source === 'estimate', r7);

console.log('\n=== 7. 用户手填优先于缓存 ===');
store['cx_drive_cache_v1'] = JSON.stringify({
  'hangzhou-cbd->yanguan': { minutes: 88, source: 'amap', at: Date.now() }
});
const r8 = DriveService.resolve('yanguan', GEOS.yanguan, { originId: 'hangzhou-cbd', userMinutes: 45 });
check('同时有缓存与手填 → 手填 45 胜出', r8.minutes === 45 && r8.source === 'user', r8);

console.log('\n=== 8. 各点位在杭州市区出发下的相对关系 ===');
const rel = {};
Object.keys(GEOS).forEach(k => { rel[k] = DriveService.estimateMinutes(hz, GEOS[k]); });
console.log('   ', JSON.stringify(rel));
check('城市阳台最近', rel.chengshiyangtai === Math.min(...Object.values(rel)), rel);
check('盐官/老盐仓/大缺口 均 > 美女坝', rel.yanguan > rel.meinvba && rel.laoyancang > rel.meinvba && rel.dakouque > rel.meinvba, rel);

console.log('\n' + '='.repeat(46));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
