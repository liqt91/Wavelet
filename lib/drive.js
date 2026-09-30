/**
 * drive.js — 车程计算（P0-01 修复）
 *
 * 设计原则（重要）：
 *   1. **永不阻塞**：算不出真实车程时，立刻回落到预设值，页面照常可用。
 *   2. **不硬依赖 key**：没有配置高德 key 时，用「Haversine 直线距离 × 绕行系数 ÷ 平均车速」
 *      做粗估，并在界面上**明确标注这是估算**，不冒充真实路况。
 *   3. **用户可覆盖**：用户手动填的车程优先级最高，一旦填过就永久生效（存 localStorage）。
 *   4. **缓存**：同一「起点→点位」24 小时内只请求一次，避免浪费配额。
 *
 * 优先级：用户手填 > 高德真实路径 > 本地估算
 */

const DriveService = (function () {

  /** 各点位默认车程（分钟）—— 最后兜底，也是无 key 时的估算基准校准值 */
  const FALLBACK_DRIVE = {
    yanguan: 75,
    laoyancang: 70,
    dakouque: 65,
    meinvba: 35,
    chengshiyangtai: 15
  };

  /** 常用出发地（GCJ-02）。用于无 key 时的本地估算，以及给高德 API 传 origin */
  const ORIGINS = [
    { id: 'hangzhou-cbd', name: '杭州市中心（武林广场）', lng: 120.1614, lat: 30.2795 },
    { id: 'hangzhou-east', name: '杭州东站', lng: 120.2135, lat: 30.2905 },
    { id: 'xiaoshan', name: '萧山城区', lng: 120.2641, lat: 30.1673 },
    { id: 'haining', name: '海宁市区', lng: 120.6813, lat: 30.5105 },
    { id: 'shanghai', name: '上海（人民广场）', lng: 121.4737, lat: 31.2304 },
    { id: 'ningbo', name: '宁波（市中心）', lng: 121.5498, lat: 29.8683 },
    { id: 'suzhou', name: '苏州（观前街）', lng: 120.6199, lat: 31.3170 }
  ];

  /** 绕行系数：道路非直线，实际里程约为直线距离的 1.25–1.4 倍，取 1.3 */
  const DETOUR_FACTOR = 1.3;
  /** 平均车速（km/h）：市区 + 高速 + 景区拥堵混合，取 55 */
  const AVG_SPEED_KMH = 55;
  /** 缓存有效期（毫秒）：24 小时 */
  const CACHE_TTL = 24 * 3600 * 1000;

  const CACHE_KEY = 'cx_drive_cache_v1';

  /** 无 key 时估算值的界面标签 */
  const AMAP_LABEL_EST = '按起终点估算';

  /* ---------------- 工具 ---------------- */

  function toRad(d) { return d * Math.PI / 180; }

  /** Haversine 直线距离（公里） */
  function straightLineKm(a, b) {
    const R = 6371;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /** 本地粗估车程（分钟）—— 无 key 或请求失败时使用 */
  function estimateMinutes(origin, dest) {
    if (!origin || !dest) return null;
    const km = straightLineKm(origin, dest) * DETOUR_FACTOR;
    // 起步 + 停车找位固定加 12 分钟；景区大潮日常有额外拥堵，此处不叠加（由用户按需手改）
    return Math.max(10, Math.round(km / AVG_SPEED_KMH * 60 + 12));
  }

  /* ---------------- 缓存 ---------------- */

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeCache(obj) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function cacheGet(key) {
    const c = readCache()[key];
    if (!c) return null;
    if (Date.now() - c.at > CACHE_TTL) return null;
    return c;
  }
  function cacheSet(key, minutes, source) {
    const c = readCache();
    c[key] = { minutes, source, at: Date.now() };
    writeCache(c);
  }

  /* ---------------- 高德真实路径 ---------------- */

  /** 读取页面配置的高德 key（未配置则为空） */
  function amapKey() {
    return (typeof window !== 'undefined' && window.__AMAP_KEY__) || '';
  }

  /**
   * 调高德驾车路径规划。成功返回分钟数，失败/无 key 返回 null（不抛错）。
   * 注意：浏览器可直连 restapi.amap.com，但 key 必须绑定安全域名，
   * file:// 场景下 Referer 为空可能被拒 —— 所以这层永远是"尽力而为"。
   */
  async function amapDrivingMinutes(origin, dest) {
    const key = amapKey();
    if (!key || !origin || !dest) return null;
    const url = `https://restapi.amap.com/v3/direction/driving`
      + `?origin=${origin.lng},${origin.lat}`
      + `&destination=${dest.lng},${dest.lat}`
      + `&strategy=0&extensions=base&key=${encodeURIComponent(key)}`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.status !== '1' || !data.route || !data.route.paths || !data.route.paths.length) return null;
      const sec = parseInt(data.route.paths[0].duration, 10);
      return Number.isFinite(sec) ? Math.round(sec / 60) : null;
    } catch (e) {
      return null; // 超时、跨域、网络异常一律静默回落
    }
  }

  /* ---------------- 对外主入口 ---------------- */

  /**
   * 计算车程（分钟）。
   * @param {string} pointId 点位 id
   * @param {object} destGeo 点位坐标（GCJ-02）
   * @param {object} opts { originId, userMinutes, allowNetwork }
   * @returns {{ minutes:number, source:'user'|'amap'|'estimate'|'fallback', label:string }}
   */
  function resolve(pointId, destGeo, opts) {
    opts = opts || {};

    // 1) 用户手填优先，且不接受"实时性"质疑——用户最清楚自己的路况
    if (Number.isFinite(opts.userMinutes) && opts.userMinutes > 0) {
      return { minutes: Math.round(opts.userMinutes), source: 'user', label: '按你填写的车程' };
    }

    const fallback = FALLBACK_DRIVE[pointId] != null ? FALLBACK_DRIVE[pointId] : 60;
    const origin = ORIGINS.find(o => o.id === opts.originId);
    if (!origin || !destGeo) {
      return { minutes: fallback, source: 'fallback', label: '预设值（杭州市区出发估算）' };
    }

    const cacheKey = `${origin.id}->${pointId}`;
    const hit = cacheGet(cacheKey);
    if (hit) {
      return {
        minutes: hit.minutes,
        source: hit.source,
        label: hit.source === 'amap' ? '高德实时车程' : AMAP_LABEL_EST
      };
    }

    const est = estimateMinutes(origin, destGeo);
    const minutes = (est != null) ? est : fallback;
    return { minutes, source: 'estimate', label: `${origin.name}出发估算` };
  }

  /**
   * 异步升级：先同步返回估算值让界面立刻可用，再尝试用高德真实值覆盖。
   * @returns {Promise<{minutes:number, source:string, label:string}|null>} 有提升时返回新值，否则 null
   */
  async function upgrade(pointId, destGeo, opts) {
    opts = opts || {};
    if (Number.isFinite(opts.userMinutes) && opts.userMinutes > 0) return null; // 用户填了，不覆盖
    if (!amapKey()) return null;

    const origin = ORIGINS.find(o => o.id === opts.originId);
    if (!origin || !destGeo) return null;

    const cacheKey = `${origin.id}->${pointId}`;
    const real = await amapDrivingMinutes(origin, destGeo);
    if (real == null) return null;

    const cur = cacheGet(cacheKey);
    cacheSet(cacheKey, real, 'amap');
    if (cur && cur.minutes === real) return null; // 没变化，不必重渲染
    return { minutes: real, source: 'amap', label: '高德实时车程' };
  }

  return {
    FALLBACK_DRIVE,
    ORIGINS,
    resolve,
    upgrade,
    estimateMinutes,
    straightLineKm,
    amapDrivingMinutes,
    amapKey
  };
})();

if (typeof window !== 'undefined') window.DriveService = DriveService;
if (typeof module !== 'undefined' && module.exports) module.exports = DriveService;
