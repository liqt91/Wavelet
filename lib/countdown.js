/**
 * countdown.js — 倒计时引擎（M2 的心脏）
 *
 * 核心设计（见设计文档 8.1 关键设计）：
 *   倒计时**只用本地时间计算**（潮时 − now），不依赖任何网络请求。
 *   即使数据是三天前人工录的，倒计时逻辑也不会崩 —— 只是潮时会偏，
 *   用户用手填校正（③）即可。
 *
 * 状态机（M2c）决定交互"手感"：
 *   计划中 → 该出发了 → 候潮中 → 潮到了 → 已散潮
 */

const CountdownEngine = (function () {

  /** 提前量：大潮日 2 小时，平日 1 小时（含安检、步行、占位） */
  const LEAD_TIME = { peak: 120, normal: 60 };

  /** 各点位默认车程（分钟）—— 用户可改 */
  const DEFAULT_DRIVE = {
    yanguan: 75,
    laoyancang: 70,
    dakouque: 65,
    meinvba: 35,
    chengshiyangtai: 15
  };

  /**
   * 把 "HH:MM" 解析成当天的 Date
   * 返回 null 表示无有效时间（"..." / "—" / 空）
   */
  function parseTime(dateStr, timeStr) {
    if (!timeStr || timeStr === '—' || timeStr === '...') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr).trim());
    if (!m) return null;
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    return d;
  }

  /** 本地日期 → YYYY-MM-DD */
  function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /**
   * 从今天的记录里选「下一个有效的潮」。
   * 早潮已过 → 看晚潮；都过了 → 返回 { phase: 'passed' }
   */
  function pickNextTide(dateStr, pointId, now) {
    const rec = TideData.getTide(dateStr, pointId);
    if (!rec) return { phase: 'nodata' };

    const candidates = [];
    const am = parseTime(dateStr, rec.morning);
    const pm = parseTime(dateStr, rec.evening);
    if (am) candidates.push({ label: '早潮', at: am });
    if (pm) candidates.push({ label: '晚潮', at: pm });

    if (!candidates.length) return { phase: 'nodata' };

    // 找第一个还没过的
    for (const c of candidates) {
      if (c.at.getTime() > now.getTime()) {
        return { phase: 'upcoming', tide: c, rec, all: candidates };
      }
    }
    // 全过了
    return { phase: 'passed', rec, all: candidates };
  }

  /**
   * 计算完整时间线
   * @returns {{
   *   phase: 'nodata'|'passed'|'planned'|'depart'|'waiting'|'arriving'|'arrived',
   *   tideAt: Date|null, tideLabel: string, departAt: Date|null,
   *   msToTide: number, msToDepart: number, leadMinutes: number, driveMinutes: number
   * }}
   */
  function compute(dateStr, pointId, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    const drive = opts.driveMinutes != null
      ? opts.driveMinutes
      : (DEFAULT_DRIVE[pointId] != null ? DEFAULT_DRIVE[pointId] : 60);

    const picked = pickNextTide(dateStr, pointId, now);
    if (picked.phase === 'nodata') return { phase: 'nodata' };
    if (picked.phase === 'passed') {
      return { phase: 'passed', rec: picked.rec, all: picked.all };
    }

    const { tide, rec } = picked;
    const lead = rec.peak ? LEAD_TIME.peak : LEAD_TIME.normal;
    const departAt = new Date(tide.at.getTime() - (drive + lead) * 60000);

    const msToTide = tide.at.getTime() - now.getTime();
    const msToDepart = departAt.getTime() - now.getTime();

    // 状态判定
    let phase;
    if (msToTide <= 0) phase = 'arrived';                     // 潮到
    else if (msToTide <= 20 * 60000) phase = 'arriving';       // 现场：潮前 20 分钟内
    else if (msToDepart <= 0) phase = 'waiting';               // 已过出发时间，候潮中
    else if (msToDepart <= 30 * 60000) phase = 'depart';       // 30 分钟内该出发了
    else phase = 'planned';

    return {
      phase,
      tideAt: tide.at,
      tideLabel: tide.label,
      rec,
      all: picked.all,
      departAt,
      msToTide,
      msToDepart,
      leadMinutes: lead,
      driveMinutes: drive,
      peak: !!rec.peak
    };
  }

  /** ms → "3 小时 12 分" */
  function humanDur(ms) {
    if (ms == null) return '—';
    const abs = Math.abs(ms);
    const totalMin = Math.floor(abs / 60000);
    if (totalMin < 1) return '不到 1 分钟';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h && m) return `${h} 小时 ${m} 分`;
    if (h) return `${h} 小时`;
    return `${m} 分钟`;
  }

  /** Date → "14:35" */
  function hhmm(d) {
    if (!d) return '—';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /** 状态 → 界面文案与主色调 */
  const PHASE_UI = {
    nodata:   { title: '暂无当天数据', main: '请以官方发布为准', cta: '查看官方入口', color: '#8a8f88' },
    passed:   { title: '今天的潮已经过了', main: '看看下一次大潮是哪天', cta: '查看大潮日历', color: '#8a8f88' },
    planned:  { title: '距离出发', main: '先看行前清单', cta: '我要去哪看', color: '#2e5e5a' },
    depart:   { title: '该出发了', main: '现在出发时间刚好，再晚 15 分钟就紧张了', cta: '开始导航', color: '#b96a2f' },
    waiting:  { title: '候潮中', main: '退到护栏内侧，抬头看东侧', cta: '开始导航', color: '#b96a2f' },
    arriving: { title: '潮马上到', main: '抬头看东侧', cta: '开始导航', color: '#b03a2a' },
    arrived:  { title: '潮到了', main: '抬头看东侧', cta: '记录一下', color: '#b03a2a' }
  };

  /** 1 秒一跳的定时器封装 */
  function tick(fn, intervalMs) {
    fn();
    const id = setInterval(fn, intervalMs || 1000);
    return () => clearInterval(id);
  }

  return {
    LEAD_TIME, DEFAULT_DRIVE,
    parseTime, toDateKey, pickNextTide, compute,
    humanDur, hhmm, PHASE_UI, tick
  };
})();

if (typeof window !== 'undefined') window.CountdownEngine = CountdownEngine;
