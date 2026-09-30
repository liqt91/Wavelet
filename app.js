/**
 * app.js — 观潮攻略 主逻辑
 *
 * 交互骨架（重构后）：**先问，后答**
 *   view=ask   提问向导  renderAsk      safety → date → companion → origin
 *   view=plan  方案页    renderPlanMain  一个推荐点位 + 次优 + 折叠资料区
 *
 * 模块映射（见设计文档三）：
 *   M1  首屏状态卡      renderPlanMain
 *   M2  倒计时+状态机    CountdownEngine + startHeroTick
 *   M3  点位决策器      recommendPointId（已在向导里替用户做完决策）
 *   M5  行前准入清单     renderChecklist（折叠于资料区）
 *   M6  大潮日历        renderCalendar （折叠于资料区）
 *   M7  五层安全提示     L1 并入向导第 1 步；L2/L3/L4/L5 分散在各渲染函数
 *   M9  野生观潮点      renderWild（方案页只给入口，清单在资料区）
 *   M10 避雷清单        renderPitfalls（折叠于资料区）
 *   M11 长图海报导出     exportPoster
 *
 * 存储约定：所有用户状态存本机（localStorage），键前缀 cx_。
 *          不上传任何数据 —— 整站零后端。
 */

(function () {
  'use strict';

  const LS = {
    plan: 'cx_plan_v1',          // { date, pointId, driveMinutes, customTideAM, customTidePM, originId, companionType, safetyAck }
    checklist: 'cx_checklist_v1' // { itemId: true }
  };

  /**
   * 提问向导的题目定义（顺序即流程顺序）
   * 设计原则：每个问题都必须**真的影响方案输出**，否则不该问。
   *   - date      → 决定潮时（潮汐每天推后 40–50 分钟）
   *   - companion → 决定推荐哪个点位（带娃/带老人 ≠ 想拍大片）
   *   - origin    → 决定车程，进而决定出发时间
   *   - safety    → 安全前置确认（原 L1 弹窗合并至此，不再做独立遮罩）
   */
  const QUESTIONS = ['safety', 'date', 'companion', 'origin'];

  /* 同行人类型 → 匹配的点位筛选键（复用 TideData 的 suitFor/filter 语义） */
  const COMPANION = [
    { id: 'family',  ico: '👨‍👩‍👧', name: '带娃 / 带老人', desc: '安全第一，要好走、有护栏、有退路', filter: 'family' },
    { id: 'first',   ico: '🌟',      name: '第一次来',      desc: '想看最经典的那一幕，不折腾',       filter: 'first' },
    { id: 'photo',   ico: '📷',      name: '想拍大片',      desc: '愿意为了机位多跑一点、早到一点',   filter: 'photo' },
    { id: 'near',    ico: '🏙',      name: '不想跑远',      desc: '顺路看看就行，最好别出杭州',       filter: 'near' },
    { id: 'cheap',   ico: '💰',      name: '想省钱',        desc: '免费点位优先，门票能省则省',       filter: 'cheap' }
  ];

  /* 用户状态 */
  let state = {
    date: null,
    pointId: null,
    driveMinutes: null,
    originId: 'hangzhou-cbd',   // 出发地（P0-01），默认杭州市中心
    companionType: null,        // 同行人类型（决定推荐点位）
    safetyAck: false,           // 是否已在向导第 1 步完成安全确认
    customTideAM: '',
    customTidePM: '',
    checklist: {}
  };

  /* 「用户真的选过」标记 —— date/origin 有默认值，但默认值≠用户答过。
     向导进度条只认这两个标记，否则首次进入就会显示"哪天来 ✓"（谎言）。 */
  let chosen = { date: false, origin: false };

  /* 日期步当前查看的月份（'YYYY-MM'）；null = 跟随已选日期/今天 */
  let askCalMonthKey = null;

  /** 当前视图：'ask' 提问向导 / 'plan' 方案页 */
  let view = 'ask';
  /** 向导当前步（QUESTIONS 的下标） */
  let askStep = 0;

  let l4ConfirmedOnce = false; // 本次会话内是否确认过（每次刷新重置 —— 见 M7e 第 2 条）

  /* ============================================================
   * 工具
   * ============================================================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function todayKey() {
    return CountdownEngine.toDateKey(new Date());
  }

  /** '2026-10-10' → '10 月 10 日'（用于文案里指日期，比裸日期亲和） */
  function fmtDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  /* ============================================================
   * 车程统一入口（P0-01 修复）
   * 所有需要车程的地方都走这里，避免多处口径分叉。
   * 优先级：用户手填 > 高德实时(缓存) > 按出发地估算 > 预设值
   * ============================================================ */

  /** 取某点位的车程信息（同步，永不返回空） */
  function driveFor(pointId) {
    const p = pointId ? TideData.getPoint(pointId) : null;
    return DriveService.resolve(pointId, p && p.geo, {
      originId: state.originId,
      userMinutes: state.driveMinutes
    });
  }

  /** 取车程的「分钟数」，供引擎计算用 */
  function driveMinutesOf(pointId) {
    return state.driveMinutes != null ? state.driveMinutes : driveFor(pointId).minutes;
  }

  /**
   * 车程来源的短标注（P0-01 关键：不能把估算值显示成无条件确定值）
   * 返回 '' 表示无需标注（真实路况或用户自填，可信度已足够）
   */
  function driveSourceTag(pointId) {
    if (state.driveMinutes != null) return '';
    const d = driveFor(pointId);
    if (d.source === 'amap') return '';
    if (d.source === 'estimate') return '<span class="drive-tag">估算</span>';
    return '<span class="drive-tag">预设</span>';
  }

  /** 异步用高德真实值升级车程（有提升时重渲染） */
  function upgradeDrive(pointId) {
    if (!pointId) return;
    const p = TideData.getPoint(pointId);
    if (!p || !p.geo) return;
    DriveService.upgrade(pointId, p.geo, {
      originId: state.originId,
      userMinutes: state.driveMinutes
    }).then((better) => {
      if (better) { renderAll(); toast(`已按高德实时路况更新车程：${better.minutes} 分钟`); }
    }).catch(() => { /* 静默：车程升级失败不影响主流程 */ });
  }

  /** 首次进入时选「最近的可用日期」：优先今天，其次未来最近的大潮日 */
  function pickDefaultDate() {
    const t = todayKey();
    if (TideData.TIDE_TABLE[t]) return t;
    /* allDates 已滤掉过去日期；这里再取第一个（最早的未来大潮日）。
       全都过期时返回 null —— 让「还没选日期」成为真实状态，而不是偷偷
       回填一个已经过去的日期（那会让用户拿到一份过期方案）。 */
    const future = TideData.allDates;   // 已是「今天及以后」
    return future.length ? future[0] : null;
  }

  function loadState() {
    try {
      const p = JSON.parse(localStorage.getItem(LS.plan) || '{}');
      /* 存档里的日期可能已经过去（昨天选好、今天再打开）——
         此时必须丢弃，否则用户会直接落到一份过期方案上。 */
      if (p.date && !TideData.isPast(p.date)) { state.date = p.date; chosen.date = true; }
      if (p.pointId) state.pointId = p.pointId;
      if (p.driveMinutes != null) state.driveMinutes = p.driveMinutes;
      if (p.originId) { state.originId = p.originId; chosen.origin = true; }
      if (p.chosen) { if (p.chosen.date) chosen.date = true; if (p.chosen.origin) chosen.origin = true; }
      if (p.companionType) state.companionType = p.companionType;
      if (p.safetyAck) state.safetyAck = true;
      if (p.customTideAM) state.customTideAM = p.customTideAM;
      if (p.customTidePM) state.customTidePM = p.customTidePM;
      state.checklist = JSON.parse(localStorage.getItem(LS.checklist) || '{}');
    } catch (e) { /* 存储不可用时静默降级为内存态 */ }
  }

  function saveState() {
    try {
      localStorage.setItem(LS.plan, JSON.stringify({
        date: state.date, pointId: state.pointId, driveMinutes: state.driveMinutes,
        originId: state.originId, companionType: state.companionType,
        safetyAck: state.safetyAck,
        chosen: chosen,
        customTideAM: state.customTideAM, customTidePM: state.customTidePM
      }));
    } catch (e) { /* 忽略 */ }
  }

  /** 清空用户答案（「重新回答」用）—— 保留清单勾选，那是另一条线 */
  function clearAnswers() {
    state.date = null;
    state.pointId = null;
    state.driveMinutes = null;
    state.originId = 'hangzhou-cbd';
    state.companionType = null;
    state.safetyAck = false;
    state.customTideAM = ''; state.customTidePM = '';
    chosen.date = false; chosen.origin = false;
    try { localStorage.removeItem(LS.plan); } catch (e) {}
  }

  function saveChecklist() {
    try { localStorage.setItem(LS.checklist, JSON.stringify(state.checklist)); } catch (e) {}
  }

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), ms || 2000);
  }

  function stars(level) {
    let s = '';
    for (let i = 1; i <= 5; i++) {
      s += `<span class="${i <= level ? 'on' : 'off'}">★</span>`;
    }
    return `<span class="stars">${s}</span>`;
  }

  function riskClass(risk) {
    if (risk === '低') return 'risk-low';
    if (risk === '高' || risk === '极高') return 'risk-high';
    return 'risk-mid';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ============================================================
   * 潮时取值
   *
   * 已统一收口到 TideData.getTide()（含手填覆盖层），
   * 不再在渲染层各自判断 —— 避免「首屏用手填、点位卡用内置值」的口径分叉。
   * ============================================================ */

  /** 把 state 里的手填值同步到数据层覆盖（所有读取路径统一生效） */
  function syncOverride() {
    if (!state.date || !state.pointId) { TideData.clearOverride(); return; }
    const hasAny = isValidTimeStr(state.customTideAM) || isValidTimeStr(state.customTidePM);
    if (hasAny) {
      TideData.setOverride(state.date, state.pointId, state.customTideAM, state.customTidePM);
    } else {
      TideData.clearOverride();
    }
  }

  function isValidTimeStr(v) {
    return typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim());
  }

  /* ============================================================
   * M1 + M2 · 首屏状态卡 + 倒计时
   * ============================================================ */
  /** 秒级刷新倒计时（纯本地计算，离线可用） */
  let heroTickTimer = null;
  function startHeroTick() {
    if (heroTickTimer) clearInterval(heroTickTimer);
    const el0 = $('#heroCount');
    if (!el0) return;

    const dateStr = state.date;
    const pointId = state.pointId;
    if (!dateStr || !pointId) return;

    const paint = () => {
      const c = CountdownEngine.compute(dateStr, pointId, {
        now: new Date(),
        driveMinutes: driveMinutesOf(pointId)
      });
      const target = $('#heroCount');
      if (!target) return;

      let ms, label;
      if (c.phase === 'planned' || c.phase === 'depart') {
        ms = c.msToDepart; label = '距离出发';
      } else {
        ms = c.msToTide; label = '距离潮到';
      }

      /* 阶段翻转时的重绘必须**异步**（setTimeout 0）。
         曾在这里同步调 renderPlanMain() → 它又会 startHeroTick → paint →
         再 renderPlanMain …… 同步递归直接爆栈（Maximum call stack size exceeded）。
         defer 之后调用栈先退空，且重绘时算出的 phase 与 paint 看到的一致，
         不会再触发第二次重绘 —— 循环自然终止。 */
      const needsRerender =
        c.phase === 'nodata' || c.phase === 'passed' || ms == null;
      const prevPhase = target.dataset.phase;
      const phaseChanged = prevPhase && prevPhase !== c.phase;

      if (needsRerender || phaseChanged) {
        clearInterval(heroTickTimer); heroTickTimer = null;
        setTimeout(renderPlanMain, 0);
        return;
      }

      // 粒度分档（有意设计）：
      //  - 跨天（>48h）：到「天」——「576 小时」没有感知，「24 天」才有
      //  - 当天（2h–48h）：到「分」——「3 小时 12 分」比「3 小时 11 分 47 秒」好读
      //  - 现场期（≤20 分钟）：下到「秒」——真正救急的时刻，秒级读数有意义
      const inField = Math.abs(ms) <= 20 * 60000;
      const inDays = Math.abs(ms) > 48 * 3600000;
      const txt = inField ? humanDurSec(ms)
        : inDays ? humanDurDay(ms)
        : CountdownEngine.humanDur(ms);

      // 把数字放大、单位缩小
      const html = txt.replace(/(\d+)|(天|小时|分钟|秒|不到)/g, (m) =>
        /^\d+$/.test(m) ? `<span>${m}</span>` : `<span class="unit">${m}</span>`
      );
      target.innerHTML = html;
      target.dataset.phase = c.phase;
    };

    paint();
    heroTickTimer = setInterval(paint, 1000);
  }

  /** 天级时长（>48h 使用）："24 天" / "24 天 3 小时" */
  function humanDurDay(ms) {
    const abs = Math.abs(ms);
    const d = Math.floor(abs / 86400000);
    const h = Math.floor((abs % 86400000) / 3600000);
    return h > 0 && d < 7 ? `${d} 天 ${h} 小时` : `${d} 天`;
  }

  /** 出发时刻的日期说明（非当天必须标明是哪天，否则"11:45 出发"有歧义） */
  function departDateNote(departAt) {
    if (!departAt) return '';
    const dk = CountdownEngine.toDateKey(departAt);
    if (dk === todayKey()) return '当天';
    const d = new Date(dk + 'T00:00:00');
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  /** 秒级时长（仅现场期使用）："12 分 07 秒" / "47 秒" / "已过 30 秒" */
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

  /** 一天的潮势取大潮等级（用于未选点位时） */
  function maxLevelOfDay(day) {
    let mx = 1;
    Object.values(day.tides).forEach(t => { if (t.level > mx) mx = t.level; });
    return mx;
  }

  /** 当日潮势最强的点位（未选点位时首屏的默认展示对象） */
  function strongestPointOfDay(day) {
    let best = null;
    TideData.POINTS.forEach(p => {
      const t = day.tides[p.id];
      if (!t) return;
      if (!best || t.level > best.tide.level) best = { point: p, tide: t };
    });
    return best;
  }

  function nextAvailableDate(fromDate) {
    return TideData.allDates.find(d => d > fromDate) || null;
  }

  /** 一句话建议（M1 的"诚实分级"）—— 措辞跟着日期走：只有真看今天才说"今天" */
  function adviceBlock(level, c, day) {
    const isToday = state.date === todayKey();
    const when = isToday ? '今天' : (state.date || '').slice(5).replace('-', ' 月 ') + ' 日';
    if (level >= 4) {
      return `<div class="hero-advice safe"><b>值得去。</b>${when}潮势${TideData.levelText(level)}（${'★'.repeat(level)}），是可以专程跑一趟的等级。记得提前 ${level >= 5 ? '2' : '1'} 小时候潮。</div>`;
    }
    if (level === 3) {
      return `<div class="hero-advice warn"><b>可以看，但别抱太高期待。</b>${when}潮势一般，如果你本来就顺路，可以来；<b>专程跑一趟海宁不划算</b>。下次更强的日子见「大潮日历」。</div>`;
    }
    return `<div class="hero-advice danger"><b>不建议专程去。</b>${when}潮势偏弱（${'★'.repeat(level)}），大概率只是一条很淡的白线。建议改期到就近的大潮日，或改去城市阳台这类顺路点位。</div>`;
  }

  /* ============================================================
   * M3 · 点位决策器
   *
   * 重构说明：原来的 renderPoints 把 5 个点位平铺、让用户自己筛，
   * 等于把决策成本转嫁给用户——这是旧界面"乱"的主因之一。
   * 现在决策改由 recommendPointId() 在向导答完后自动完成，
   * 这里只保留「同行人类型 → 点位池」的映射，供推荐与备选共用。
   * ============================================================ */
  const FILTER_MAP = {
    family: ['chengshiyangtai', 'yanguan'],
    photo: ['dakouque', 'laoyancang', 'meinvba'],
    first: ['yanguan', 'chengshiyangtai'],
    near: ['chengshiyangtai', 'meinvba'],
    cheap: ['laoyancang', 'dakouque', 'meinvba', 'chengshiyangtai']
  };

  function pointCardHtml(p, dateStr) {
    const rec = TideData.getTide(dateStr, p.id);
    const isWild = p.type === 'wild';
    const c = rec ? CountdownEngine.compute(dateStr, p.id, { driveMinutes: driveMinutesOf(p.id) }) : null;

    const timeText = rec
      ? [(rec.morning && rec.morning !== '—' && rec.morning !== '...' ? `早 ${rec.morning}` : ''),
         (rec.evening && rec.evening !== '—' && rec.evening !== '...' ? `晚 ${rec.evening}` : '')
        ].filter(Boolean).join(' · ') || '无数据'
      : (TideData.isStaleNow() ? '数据已过期' : '无数据');
    const level = rec ? rec.level : 0;
    /* 过期时星标/等级色也会误导（用户会以为"5 星=值得去"），一并压掉 */
    const staleNow = TideData.isStaleNow();

    /* 标签 */
    const tags = [];
    if (isWild) {
      tags.push(`<span class="tag ${p.risk === '高' ? 'risk-high' : 'risk-mid'}">风险${p.risk}</span>`);
    } else {
      tags.push(`<span class="tag risk-low">正规景区</span>`);
    }
    if (p.needPass) tags.push(`<span class="tag pass">需通行证</span>`);
    if (p.ticket === '免费') tags.push(`<span class="tag">免费</span>`);
    p.suitFor.slice(0, 3).forEach(s => tags.push(`<span class="tag">${esc(s)}</span>`));

    /* 折叠详情 */
    const detail = `
      <details class="fold">
        <summary>查看详情（交通 · 你会看到什么 · 坑点）</summary>
        <div class="fold-body">
          <div class="kv"><span class="k">导航</span><span class="v">${esc(p.transport.nav)}</span></div>
          ${p.transport.rail ? `<div class="kv"><span class="k">铁路/地铁</span><span class="v">${esc(p.transport.rail)}</span></div>` : ''}
          ${p.transport.extra ? `<div class="kv"><span class="k">补充</span><span class="v">${esc(p.transport.extra)}</span></div>` : ''}
          ${p.transport.parking ? `<div class="kv"><span class="k">停车</span><span class="v">${esc(p.transport.parking)}</span></div>` : ''}
          ${p.needPass ? `<div class="kv"><span class="k">通行证</span><span class="v" style="color:var(--danger);font-weight:600">${esc(p.passNote)}</span></div>` : ''}
          <div class="kv"><span class="k">视野</span><span class="v">${esc(p.view)}</span></div>
          <div class="kv"><span class="k">拥挤度</span><span class="v">${esc(p.crowd)}</span></div>
          <div class="kv"><span class="k">退路</span><span class="v">${esc(p.retreat)}</span></div>
          <div class="kv" style="margin-top:12px"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">你会看到什么</span><span class="v">${esc(p.whatYouSee)}</span></div>
          <div class="kv" style="margin-top:6px"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">预期管理</span><span class="v" style="color:var(--warn)">${esc(p.expectation)}</span></div>
          ${p.traps && p.traps.length ? `<div class="kv" style="margin-top:12px"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">坑点</span><span class="v">${p.traps.map(t => '· ' + esc(t)).join('<br>')}</span></div>` : ''}
        </div>
      </details>`;

    /* L3 点位级安全提示 —— 每个点位必带 */
    const l3 = `
      <div class="l3-safety">
        <b>⚠ 这个点位的风险</b>
        ${esc(p.l3Safety)}
      </div>`;

    /* 野生点位底部重复一句风险自担（M7b 要求） */
    const wildFoot = isWild
      ? `<div class="small" style="padding:0 15px 12px;color:var(--danger);font-weight:600">非正规管理点位，无护栏、无现场管理。风险由你自己承担。</div>`
      : '';

    const selected = state.pointId === p.id;

    return `
      <div class="point-card ${staleNow ? 'is-stale' : riskClass(p.risk)}" data-pid="${p.id}">
        <div class="point-head">
          <div>
            <h4 class="point-name">${esc(p.name)}</h4>
            <div class="point-types">${p.tideTypes.map(esc).join(' · ')}</div>
          </div>
          <div class="point-right">
            <div class="point-time">${staleNow ? '—' : (rec && rec.evening && rec.evening !== '—' && rec.evening !== '...' ? rec.evening : (rec && rec.morning && rec.morning !== '—' && rec.morning !== '...' ? rec.morning : '—'))}</div>
            <div class="point-ticket ${p.ticket === '免费' ? 'free' : 'paid'}">${p.ticket === '免费' ? '免费' : '需购票'}</div>
          </div>
        </div>
        <div class="point-tags">${tags.join('')}</div>
        <div class="point-body">
          <div class="kv"><span class="k">今日潮时</span><span class="v mono"><b>${timeText}</b>${!staleNow && level ? ` · ${stars(level)}` : ''}</span></div>
          ${c && c.phase !== 'nodata' && c.phase !== 'passed' ? `<div class="kv"><span class="k">建议出发</span><span class="v mono">${CountdownEngine.hhmm(c.departAt)}（车程约 ${c.driveMinutes} 分${driveSourceTag(p.id)} + 提前 ${c.leadMinutes} 分候潮）</span></div>` : ''}
        </div>
        ${l3}
        ${wildFoot}
        <div class="point-actions">
          <button class="btn ${selected ? 'btn-primary' : 'btn-outline'}" data-pick="${p.id}">
            ${selected ? '✓ 已选中' : '选它，算出发时间'}
          </button>
          <button class="btn btn-ghost" data-viewmap="${p.id}">复制导航词</button>
        </div>
        ${detail}
      </div>`;
  }

  function bindPoints() {
    document.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      if (pick) {
        window.App.pick(pick.dataset.pick);
        return;
      }
      const map = e.target.closest('[data-viewmap]');
      if (map) {
        const p = TideData.getPoint(map.dataset.viewmap);
        if (p) copyText(p.transport.nav + '（地址可在地图 App 中搜索）', '导航关键词已复制');
      }
    });
  }

  /* ============================================================
   * M5 · 行前准入清单
   * ============================================================ */

  function renderChecklist() {
    const box = $('#checklist');
    let total = 0, done = 0;
    TideData.CHECKLIST_GROUPS.forEach(g => {
      g.items.forEach(it => { total++; if (state.checklist[it.id]) done++; });
    });
    const pct = total ? Math.round(done / total * 100) : 0;

    let html = `
      <div class="check-summary">已完成 ${done} / ${total} 项</div>
      <div class="check-progress"><i style="width:${pct}%"></i></div>`;

    TideData.CHECKLIST_GROUPS.forEach(g => {
      html += `<div class="check-group">
        <h4>${esc(g.title)}</h4>
        ${g.hint ? `<p class="ghint">${esc(g.hint)}</p>` : ''}`;
      g.items.forEach(it => {
        const on = !!state.checklist[it.id];
        html += `
          <label class="check-item ${it.critical ? 'critical' : ''} ${on ? 'done' : ''}" data-cid="${it.id}">
            <input type="checkbox" ${on ? 'checked' : ''} data-cid="${it.id}">
            <span class="txt">${esc(it.text)}</span>
          </label>`;
      });
      html += `</div>`;
    });

    box.innerHTML = html;
  }

  function bindChecklist() {
    // 点整行任意位置都能切换：整行 label 天然是 checkbox 的关联标签，
    // 这里只监听 change（含 label 触发的合成 change），保证与原生行为一致、不重复触发
    document.addEventListener('click', (e) => {
      const item = e.target.closest('label.check-item[data-cid]');
      if (!item) return;
      // 点在 input 上时浏览器会自己派发 change，这里不抢；
      // 点在行内其它位置（文字/空白）时，手动把 input 切一下并派发 change
      const cb = item.querySelector('input[type=checkbox]');
      if (e.target !== cb) {
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    document.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      const item = cb.closest('label.check-item[data-cid]');
      if (!item) return;
      const id = item.dataset.cid;
      if (cb.checked) state.checklist[id] = true; else delete state.checklist[id];
      saveChecklist();
      renderChecklist();
    });
  }

  /* ============================================================
   * M6 · 大潮日历
   * ============================================================ */

  function renderCalendar() {
    const box = $('#calendar');
    const cal = TideData.TIDE_CALENDAR;

    /* 过期降级（P0-02）：日历整块是"具体潮时矩阵"，过期时保留窗口/日期骨架（仍有参考价值），
       但抹掉时刻与星标，避免把过期数字当成可用信息。 */
    if (TideData.isStaleNow()) {
      const ds = TideData.allDates;
      box.innerHTML = `
        <div class="stale-note">
          <b>大潮日历已暂停显示具体潮时</b>
          内置潮汐数据更新至 <b>${esc(TideData.DATA_DATE)}</b>，已过期。下面只保留大潮窗口的日期骨架
          （规律不变），<b>时刻与潮势星级已隐去</b>，以免你按过期数字安排行程。
          <br>请以官方当日发布为准，或用下方「手动校正」填入你查到的潮时。
        </div>
        <div class="small" style="margin:14px 0 10px">${esc(cal.rule)}</div>
        <div class="cal-grid cal-grid-stale">
          ${ds.map(d => {
            const dd = new Date(d + 'T00:00:00');
            return `<div class="cal-cell is-stale" data-date="${d}" title="数据已过期">
              <div class="d">${dd.getMonth() + 1}/${dd.getDate()}</div>
              <div class="t">—</div>
            </div>`;
          }).join('')}
        </div>
        <div class="small" style="margin-top:14px">${esc(cal.note)}</div>`;
      return;
    }

    let html = `<div class="small" style="margin-bottom:12px">${esc(cal.rule)}<br>${esc(cal.pattern)}</div>`;

    /* 按窗口分组渲染 Date × Point 矩阵 */
    const byWindow = {};
    TideData.allDates.forEach(d => {
      const day = TideData.TIDE_TABLE[d];
      (byWindow[day.window] = byWindow[day.window] || []).push(d);
    });

    Object.keys(byWindow).sort().forEach(w => {
      const wInfo = cal.windows2026[w - 1];
      html += `<div class="cal-window"><h4>窗口${w} · ${esc(wInfo.label)}　${esc(wInfo.desc)}</h4>`;
      html += `<div class="cal-grid">`;
      byWindow[w].forEach(d => {
        const day = TideData.TIDE_TABLE[d];
        const lv = maxLevelOfDay(day);
        const dd = new Date(d + 'T00:00:00');
        const isToday = d === todayKey();
        const rec = day.tides.yanguan;
        const t = (rec && rec.evening && rec.evening !== '...' ? rec.evening : (rec ? rec.morning : '—'));
        html += `
          <div class="cal-cell" style="background:${TideData.levelColor(lv)};color:${TideData.levelTextColor(lv)}${isToday ? ';outline:3px solid #2e5e5a;outline-offset:2px' : ''}"
               title="${esc(day.lunisolar)}" data-date="${d}">
            <div class="d">${dd.getMonth() + 1}/${dd.getDate()}</div>
            <div class="t">${esc(t)}</div>
            <div class="l">${'★'.repeat(lv)}</div>
          </div>`;
      });
      html += `</div></div>`;
    });

    html += `
      <div class="small" style="margin-top:14px">
        <b>错峰建议：</b>${esc(cal.note)}<br>
        ${cal.offPeak.map(o => `· <b>${esc(o.name)}</b>：${esc(o.desc)}`).join('<br>')}
      </div>
      <div class="small" style="margin-top:10px;color:var(--warn)">点任意色块可切到该日期。</div>`;

    box.innerHTML = html;

    $$('.cal-cell', box).forEach(c => {
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => {
        setDate(c.dataset.date);
      });
    });
  }

  /**
   * 切日期（日历色块与日期按钮共用）。
   * 语义要点：换日期 → 手填潮时作废（否则 10/5 的校正值会被套用到 10/20，
   * 正是设计稿最在意的那类静默错误）。
   */
  function setDate(d) {
    if (!TideData.TIDE_TABLE[d]) return;
    state.date = d;
    state.customTideAM = ''; state.customTidePM = '';
    saveState();
    renderAll();
    const dt = new Date(d + 'T00:00:00');
    toast('已切到 ' + (dt.getMonth() + 1) + ' 月 ' + dt.getDate() + ' 日');
  }

  /* ============================================================
   * M9 · 野生观潮点
   * ============================================================ */

  function renderWild() {
    const box = $('#wild');
    const dateStr = state.date;
    const wilds = TideData.POINTS.filter(p => p.type === 'wild');

    let html = `
      <div class="card" style="background:var(--danger-bg);border:1px solid var(--danger-border)">
        <h3 class="card-title" style="color:var(--danger-text)"><span>⚠ 进入前请确认</span><span class="badge p0">L4 强制</span></h3>
        <div class="small" style="color:var(--danger-text);font-weight:600;line-height:1.6">
          下面这些点位没有护栏、没有广播、没有喊潮员、没有现场疏导，也没有就近的救援响应。
          以免费、小众为主，<b>但安全性低一档</b>。点「查看点位」前需要先读完免责说明。
        </div>
        <div class="btn-row">
          <button class="btn btn-danger" id="openWild">读免责说明 → 查看点位</button>
        </div>
      </div>`;

    /* 一旦确认过，就展示野生点位卡 */
    if (l4ConfirmedOnce) {
      html += wilds.map(p => pointCardHtml(p, dateStr)).join('');
    }

    box.innerHTML = html;
    $('#openWild').addEventListener('click', () => openWildDisclaimer(null));
  }

  /* L4 免责声明弹层 */
  let pendingWildPick = null;
  function openWildDisclaimer(pendingPick) {
    pendingWildPick = pendingPick;
    const d = TideData.SAFETY.wildDisclaimer;
    const ov = $('#wildOverlay');
    $('#wildDisclaimerBody').innerHTML = `
      <div class="disclaimer-head"><h3>⚠ ${esc(d.title)}</h3></div>
      <div class="disclaimer-body">
        ${d.paras.map(p => `<p>${mdBold(p)}</p>`).join('')}
        <label class="disclaimer-check">
          <input type="checkbox" id="wildAgree">
          <span>${esc(d.checkbox)}</span>
        </label>
        <div class="btn-row" style="margin-top:0">
          <button class="btn btn-ghost" id="wildCancel">算了，不去了</button>
          <button class="btn btn-danger" id="wildOk" disabled>我已知晓，查看点位</button>
        </div>
      </div>`;
    ov.hidden = false;

    const cb = $('#wildAgree');
    const ok = $('#wildOk');
    cb.addEventListener('change', () => { ok.disabled = !cb.checked; });
    $('#wildCancel').addEventListener('click', () => { ov.hidden = true; pendingWildPick = null; });
    ok.addEventListener('click', () => {
      if (!cb.checked) return;
      l4ConfirmedOnce = true;
      ov.hidden = true;
      if (pendingWildPick) {
        const id = pendingWildPick; pendingWildPick = null;
        // 已确认过，直接走统一入口（不会再次触发 L4）
        window.App.pick(id);
      } else {
        renderWild();
        scrollTo('ref-wild');
      }
    });
  }

  /** `**加粗**` → <b>，并转义其余内容 */
  function mdBold(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  /* ============================================================
   * M10 · 避雷清单
   * ============================================================ */

  function renderPitfalls() {
    const box = $('#pitfalls');

    /* 预期管理卡（M10b）—— 放最前 */
    let html = `
      <div class="card expect-card">
        <h3 class="card-title"><span>⚠ 去之前，先知道这三件事</span><span class="badge p0">必读</span></h3>
        <div class="expect-item"><span class="num">1</span>
          <b>你大概率只会看到一条白线</b><br>不是视频里的滔天巨浪。想要震撼，得挑对点位（回头潮 / 冲天潮）+ 赶上大潮日。
        </div>
        <div class="expect-item"><span class="num">2</span>
          <b>潮水只在你眼前停留约 3 分钟</b><br>来之前的两小时才是主菜（占位、吹风、拍照）。
        </div>
        <div class="expect-item"><span class="num">3</span>
          <b>看完之后的落差，80% 来自预期过高</b><br>把它当成一次江边散步 + 3 分钟的惊喜，而不是一次"奇观朝圣"。
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" id="expectOk">知道了，我接受这个预期</button>
        </div>
      </div>`;

    /* 十条坑，按类别 */
    html += `<div class="card-title" style="margin:18px 0 0;padding-left:4px">十条高频避雷</div>`;
    html += `<div class="card">`;
    TideData.PITFALLS.forEach(cat => {
      html += `<div class="pit-cat"><h4>${esc(cat.cat)}</h4>`;
      cat.items.forEach(it => {
        html += `
          <div class="pit-item">
            <div class="t">${esc(it.title)}</div>
            <div class="why"><span class="lbl why">真实情况</span>${esc(it.why)}</div>
            <div class="how"><span class="lbl how">怎么办</span>${esc(it.how)}</div>
          </div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;

    /* 四类人劝退 */
    html += `<div class="card">
      <h3 class="card-title"><span>这四种情况，建议换个安排</span><span class="badge p0">劝退</span></h3>
      <div class="small" style="margin-bottom:11px">网上吐槽最集中的结论就是"有些人不适合去"。直接写出来，比让你花钱买教训好。</div>
      ${TideData.DISCOURAGE.map(d => `
        <div class="disc-item">
          <div class="t">${esc(d.type)}</div>
          <div class="r">${esc(d.reason)}</div>
          <div class="a">→ ${esc(d.alt)}</div>
        </div>`).join('')}
    </div>`;

    box.innerHTML = html;

    $('#expectOk').addEventListener('click', () => toast('记住这个预期，到了现场落差会小很多'));
  }

  /* ============================================================
   * M7 · 安全体系展示
   * ============================================================ */

  function renderSafety() {
    const box = $('#safety');

    const layers = [
      { lv: 'L1', t: '前置确认', s: '首屏进入时全屏风险说明 + 勾选确认（强阻断）' },
      { lv: 'L2', t: '常驻红条', s: '页面顶部细红条，全程可见、不可关闭' },
      { lv: 'L3', t: '点位级', s: '每个点位卡内专属风险 +「这个点位不能站的地方」' },
      { lv: 'L4', t: '野生点位级', s: '进入野生点位模块前的完整免责声明 + 强制勾选' },
      { lv: 'L5', t: '现场级', s: '潮前 20 分钟起启动，大字脉冲提示' }
    ];

    let html = `
      <div class="card">
        <h3 class="card-title"><span>五层安全提示（不是一句话重复五遍）</span></h3>
        <div class="small" style="margin-bottom:6px">钱塘江观潮每年都有伤亡。"提示一次"等于没提示——所以在每个决策点各拦一次，六次触达、六种形态。</div>
        ${layers.map(l => `
          <div class="safety-layer">
            <div class="lv">${l.lv}</div>
            <div class="sd"><b>${esc(l.t)}</b><span>${esc(l.s)}</span></div>
          </div>`).join('')}
      </div>

      <div class="card">
        <h3 class="card-title" style="color:var(--danger)"><span>⚠ 出现这三种情况，立即后撤</span></h3>
        <div class="small" style="margin-bottom:8px">不要拍、不要等、不要回头拿东西。</div>
        <div style="font-size:15px;font-weight:700;color:var(--danger);line-height:1.8">
          ${TideData.SAFETY.layers.warnings.map(w => '· ' + esc(w)).join('<br>')}
        </div>
        <div style="margin-top:14px;font-size:13px;font-weight:700">绝不做这些事：</div>
        <div class="forbid-list">${TideData.SAFETY.layers.forbid.map(f => `<span>${esc(f)}</span>`).join('')}</div>
      </div>

      <div class="card">
        <h3 class="card-title"><span>带娃 / 落水 / 人群</span></h3>
        <div class="kv" style="margin-top:0"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">带儿童老人</span><span class="v">${esc(TideData.SAFETY.layers.kids)}</span></div>
        <div class="kv"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">万一落水</span><span class="v">${esc(TideData.SAFETY.layers.drowning)}</span></div>
        <div class="kv"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">人群踩踏</span><span class="v">${esc(TideData.SAFETY.layers.crowd)}</span></div>
        <div class="kv" style="color:var(--danger);font-weight:700;margin-top:12px">紧急情况拨 ${TideData.SAFETY.layers.emergency}</div>
      </div>

      <div class="card">
        <h3 class="card-title"><span>八处历史危险点</span></h3>
        <div class="forbid-list" style="margin-top:0">
          ${['海宁大缺口','海宁老盐仓','萧山九号坝','萧山美女坝','下沙七格','七堡丁字坝','三堡船闸','九溪'].map(x => `<span>${esc(x)}</span>`).join('')}
        </div>
        <div class="small" style="margin-top:10px">以上来自警方与媒体公开口径。这些地方多数免费、多数没有护栏——<b>正是最需要小心的位置</b>。</div>
      </div>`;

    box.innerHTML = html;
  }

  /* ============================================================
   * L5 · 现场级实时提示
   * ============================================================ */

  function renderLivePanel() {
    const box = $('#live');
    if (!state.date || !state.pointId) { box.hidden = true; return; }

    const c = CountdownEngine.compute(state.date, state.pointId, {
      now: new Date(), driveMinutes: driveMinutesOf(state.pointId)
    });

    if (c.phase === 'arriving' || c.phase === 'arrived') {
      box.hidden = false;
      const t = CountdownEngine.humanDur(c.msToTide);
      box.innerHTML = `
        <div class="lp-title">${c.phase === 'arrived' ? '潮来了 · 抬头看东侧' : '马上到 · 还有 ' + t}</div>
        <div class="lp-sub">
          退到护栏内侧，不要为了取景往前半步。<br>
          潮头过你眼前约 3 分钟，看完不要立刻涌向出口。
        </div>`;
    } else if (c.phase === 'waiting') {
      box.hidden = false;
      box.innerHTML = `
        <div class="lp-title">候潮中 · 还有 ${CountdownEngine.humanDur(c.msToTide)}</div>
        <div class="lp-sub">
          站护栏内侧。水位突然下降 / 远处闷雷 / 江面白线 → 立即后撤。<br>
          潮水推进速度每秒 5–10 米，跑不过它。
        </div>`;
    } else {
      box.hidden = true;
    }
  }

  /* ============================================================
   * M11 · 长图海报导出
   * ============================================================ */

  function buildPosterHtml() {
    const p = state.pointId ? TideData.getPoint(state.pointId) : null;
    const dateStr = state.date;
    const day = dateStr ? TideData.TIDE_TABLE[dateStr] : null;
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();

    const c = (p && dateStr) ? CountdownEngine.compute(dateStr, p.id, { driveMinutes: driveMinutesOf(p.id) }) : null;
    const rec = (p && dateStr) ? TideData.getTide(dateStr, p.id) : null;

    /* 清单状态 */
    let total = 0, done = 0, doneItems = [], undoneItems = [];
    TideData.CHECKLIST_GROUPS.forEach(g => {
      g.items.forEach(it => {
        total++;
        if (state.checklist[it.id]) { done++; doneItems.push(it.text); }
        else undoneItems.push(it.text);
      });
    });

    /* 潮时 */
    let tideText = '—';
    if (rec) {
      const am = (rec.morning && rec.morning !== '—' && rec.morning !== '...') ? rec.morning : null;
      const pm = (rec.evening && rec.evening !== '—' && rec.evening !== '...') ? rec.evening : null;
      tideText = [am ? '早 ' + am : '', pm ? '晚 ' + pm : ''].filter(Boolean).join(' / ') || '—';
    }

    const level = rec ? rec.level : 0;

    /* 二维码区：若未配置链接则隐去（M11e 第 4 条） */
    const QR_LINK = window.__POSTER_QR_LINK__ || '';
    const qrBlock = QR_LINK ? `
      <div class="po-band po-qr">
        <div class="po-qr-canvas"><img src="${QR_LINK}" alt="扫码看完整攻略"></div>
        <div class="po-qr-text">
          <b>查看完整攻略</b>
          <span>扫码打开 · 含实时倒计时、避雷清单、全点位对比</span>
        </div>
      </div>` : `
      <div class="po-band po-qr">
        <div class="po-qr-canvas po-qr-empty">二维码<br>待配置</div>
        <div class="po-qr-text">
          <b>查看完整攻略</b>
          <span>页面发布后此处自动生成二维码<br>（当前为占位，不影响其余信息）</span>
        </div>
      </div>`;

    return `
    <div class="po-root">
      <!-- ① 顶部标识 -->
      <div class="po-head">
        <div class="po-title">钱塘江观潮 · 我的计划</div>
        <div class="po-sub">${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日${day ? ' · ' + esc(day.lunisolar) : ''}</div>
      </div>

      <!-- ② 主决策区（最大字号） -->
      <div class="po-band po-main">
        <div class="po-point">${p ? esc(p.name) : '（未选点位）'}</div>
        <div class="po-tidetime">${esc(tideText)}</div>
        <div class="po-level">${level ? '★'.repeat(level) + '☆'.repeat(5 - level) : ''} ${level ? TideData.levelText(level) : ''}</div>
        <div class="po-types">${p ? p.tideTypes.map(esc).join(' · ') : ''}</div>
        ${c && c.phase !== 'nodata' && c.phase !== 'passed' ? `
        <div class="po-depart">
          <span class="po-depart-label">建议出发</span>
          <span class="po-depart-time">${CountdownEngine.hhmm(c.departAt)}</span>
          <span class="po-depart-note">车程约 ${c.driveMinutes} 分钟${driveSourceTag(p ? p.id : null)} · 提前 ${c.leadMinutes} 分钟候潮</span>
        </div>` : ''}
      </div>

      <!-- ③ 交通 -->
      <div class="po-band">
        <div class="po-h">📍 交通</div>
        <div class="po-line">${p ? esc(p.transport.nav) : '—'}</div>
        ${p && p.ticket === '免费' ? '<div class="po-line">免费 · 公共江堤 · 停车听从现场指挥</div>' : ''}
        ${p && p.ticket !== '免费' ? `<div class="po-line">${esc(p.ticket)}</div>` : ''}
        ${p && p.needPass ? '<div class="po-line po-warnline">需提前申领电子通行证（海宁公安公众号）</div>' : ''}
      </div>

      <!-- ④ 行前清单 -->
      <div class="po-band">
        <div class="po-h">✅ 行前清单（已勾 ${done}/${total}）</div>
        ${doneItems.slice(0, 6).map(t => `<div class="po-check"><span class="po-box on">☑</span>${esc(t)}</div>`).join('')}
        ${undoneItems.slice(0, 4).map(t => `<div class="po-check"><span class="po-box">☐</span>${esc(t)}</div>`).join('')}
      </div>

      <!-- ⑤ 安全须知（红底，强制） -->
      <div class="po-band po-safety">
        <div class="po-safety-h">⚠️ 安全须知</div>
        ${TideData.SAFETY.posterSafety.map(t => `<div class="po-safety-line">· ${esc(t)}</div>`).join('')}
      </div>

      <!-- ⑥ 二维码 -->
      ${qrBlock}

      <!-- ⑦ 免责声明（小字，强制） -->
      <div class="po-band po-disclaimer">
        ${esc(TideData.SAFETY.posterDisclaimer)}
      </div>
    </div>`;
  }

  function injectPosterStyles() {
    if ($('#posterStyles')) return;
    const st = document.createElement('style');
    st.id = 'posterStyles';
    st.textContent = `
      .po-root {
        width: 750px; background: #fdfcf7; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #252a2d;
      }
      .po-head { background: linear-gradient(165deg,#2e5e5a,#22484a); color:#fff; padding: 34px 40px 30px; }
      .po-title { font-size: 40px; font-weight: 700; letter-spacing: 2px; font-family: "Songti SC", "STSong", "SimSun", serif; }
      .po-sub { font-size: 21px; opacity: .86; margin-top: 9px; }
      .po-band { padding: 27px 40px; border-bottom: 1px solid #e4dfd0; }
      .po-main { background: #f6f3ec; padding-top: 32px; padding-bottom: 32px; }
      .po-point { font-size: 46px; font-weight: 700; line-height: 1.18; letter-spacing: .5px; font-family: "Songti SC", "STSong", "SimSun", serif; }
      .po-tidetime { font-size: 42px; font-weight: 800; color: #2e5e5a; margin-top: 12px; font-variant-numeric: tabular-nums; }
      .po-level { font-size: 24px; color: #b96a2f; margin-top: 9px; font-weight: 700; letter-spacing: 2px; }
      .po-types { font-size: 21px; color: #4c5450; margin-top: 9px; }
      .po-depart { margin-top: 22px; padding: 19px 22px; background: #fff; border-radius: 14px; border: 1px solid #e2c889; }
      .po-depart-label { font-size: 19px; color: #4c5450; }
      .po-depart-time { font-size: 40px; font-weight: 800; color: #b96a2f; margin: 0 14px; font-variant-numeric: tabular-nums; }
      .po-depart-note { font-size: 18px; color: #4c5450; display: block; margin-top: 7px; }
      .po-h { font-size: 23px; font-weight: 700; margin-bottom: 13px; font-family: "Songti SC", "STSong", "SimSun", serif; }
      .po-line { font-size: 21px; line-height: 1.62; color: #3a414b; }
      .po-warnline { color: #b03a2a; font-weight: 700; }
      .po-check { font-size: 21px; line-height: 1.5; margin: 9px 0; display: flex; gap: 11px; }
      .po-box { flex-shrink: 0; font-size: 22px; }
      .po-box.on { color: #3f7350; font-weight: 700; }
      .po-box:not(.on) { color: #c6c8bf; }
      .po-safety { background: #b03a2a; color: #fff; border-bottom: none; }
      .po-safety-h { font-size: 26px; font-weight: 800; margin-bottom: 13px; }
      .po-safety-line { font-size: 21px; line-height: 1.72; }
      .po-qr { display: flex; align-items: center; gap: 24px; }
      .po-qr-canvas { width: 150px; height: 150px; flex-shrink: 0; background: #f6f3ec; border: 2px dashed #cfc8b4; border-radius: 10px;
        display: flex; align-items: center; justify-content: center; text-align: center; font-size: 15px; color: #5f6661; line-height: 1.4; }
      .po-qr-canvas img { width: 100%; height: 100%; object-fit: contain; }
      .po-qr-text b { display: block; font-size: 23px; font-weight: 800; margin-bottom: 7px; }
      .po-qr-text span { font-size: 18px; color: #5f6661; line-height: 1.55; }
      .po-disclaimer { font-size: 16px; color: #5f6661; line-height: 1.72; background: #f6f3ec; border-bottom: none; padding-bottom: 32px; }
    `;
    document.head.appendChild(st);
  }

  /** 主入口：导出海报 */
  function exportPoster() {
    if (!state.pointId) {
      toast('先选好日期和同行人，方案页才有内容');
      // 方案页才能生成海报；没点位说明向导没走完
      if (view !== 'plan') { editAnswer('date'); return; }
      const alt = $('#planAlt');
      if (alt) alt.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    injectPosterStyles();
    const stage = $('#posterStage');
    stage.innerHTML = buildPosterHtml();

    toast('正在生成海报…', 1400);

    const done = () => {
      const root = $('.po-root', stage);
      // 兜底：无 html2canvas 时降级为复制文案
      if (typeof html2canvas === 'undefined') {
        copyPosterText();
        return;
      }
      html2canvas(root, {
        backgroundColor: '#fdfcf7',
        scale: 2,
        width: 750,
        windowWidth: 750,
        useCORS: true,
        logging: false
      }).then(canvas => {
        const url = canvas.toDataURL('image/png');
        showPosterPreview(url);
      }).catch(err => {
        console.error('海报渲染失败，降级为复制文案', err);
        toast('海报渲染失败，已改为复制文字版');
        copyPosterText();
      });
    };

    // 等一帧让样式生效
    requestAnimationFrame(() => setTimeout(done, 60));
  }

  function showPosterPreview(url) {
    const box = $('#posterPreview');
    box.hidden = false;
    box.innerHTML = `<img src="${url}" alt="观潮计划长图"><div class="poster-hint">长按图片可保存到相册 / 转发微信。图片宽度 750px，适合手机查看。</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 提供下载
    const a = document.createElement('a');
    a.href = url; a.download = '钱塘江观潮计划.png';
    a.style.display = 'none';
    document.body.appendChild(a);
    setTimeout(() => { a.click(); document.body.removeChild(a); }, 400);
    toast('海报已生成，正在下载');
  }

  /** 降级：复制计划文案 */
  function copyPosterText() {
    const p = state.pointId ? TideData.getPoint(state.pointId) : null;
    if (!p) { toast('请先选点位'); return; }
    const dateStr = state.date;
    const day = dateStr ? TideData.TIDE_TABLE[dateStr] : null;
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    const c = CountdownEngine.compute(dateStr, p.id, { driveMinutes: driveMinutesOf(p.id) });
    const rec = TideData.getTide(dateStr, p.id);

    let tideTxt = '—';
    if (rec) {
      const am = (rec.morning && rec.morning !== '—' && rec.morning !== '...') ? rec.morning : null;
      const pm = (rec.evening && rec.evening !== '—' && rec.evening !== '...') ? rec.evening : null;
      tideTxt = [am ? '早 ' + am : '', pm ? '晚 ' + pm : ''].filter(Boolean).join(' / ') || '—';
    }

    const lines = [
      '【钱塘江观潮计划】',
      `日期：${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日${day ? '（' + day.lunisolar + '）' : ''}`,
      `点位：${p.name}（${p.tideTypes.join(' · ')}）`,
      `潮到：${tideTxt}｜观赏等级 ${rec ? '★'.repeat(rec.level) : '—'}`,
      c && c.departAt ? `出发：建议 ${CountdownEngine.hhmm(c.departAt)} 前出门（车程约 ${c.driveMinutes} 分钟 + 提前 ${c.leadMinutes} 分钟候潮）` : '',
      `导航：${p.transport.nav}${p.ticket === '免费' ? '，免费公共江堤' : ''}`,
      '',
      '⚠️ 站护栏内，不下滩涂丁坝；潮水只停留约 3 分钟；水位突降/闷雷/白线→立即后撤',
      `紧急情况拨 ${TideData.SAFETY.layers.emergency}。潮汐时间以当日官方发布为准，观潮风险自担。`
    ].filter(x => x !== '').join('\n');

    copyText(lines, '计划文案已复制，可粘贴到微信群');
  }

  /* ============================================================
   * 官方入口
   * ============================================================ */

  function renderOfficial() {
    const box = $('#official');
    box.innerHTML = `
      <div class="small" style="margin-bottom:10px">页面内数据是离线内置的，可能过期。查权威潮汐请点下面这些渠道——这也是本页免责口径成立的前提。</div>
      <div class="official-row">
        ${TideData.OFFICIAL_ENTRIES.map(e => `
          <button class="official-btn" data-official="${esc(e.name)}">${esc(e.name)}<small>${esc(e.desc)}</small></button>`).join('')}
      </div>
      <div class="small" style="margin-top:11px">点开后请在各公众号 / 小程序内搜索「钱塘江潮汐」或「潮来了」查看当日具体潮时。</div>`;

    $$('[data-official]', box).forEach(b => {
      b.addEventListener('click', () => {
        toast(`请在微信里搜索「${b.dataset.official}」`);
      });
    });
  }

  /* ============================================================
   * 手动校正（方案 ③）
   * ============================================================ */

  /** 提示引擎实际会取哪个潮 —— 消除"填了两个不知道取哪个"的歧义 */
  function pickHintHtml() {
    if (!state.pointId || !state.date) return '';
    const c = CountdownEngine.compute(state.date, state.pointId, {
      now: new Date(), driveMinutes: driveMinutesOf(state.pointId)
    });
    if (c.phase === 'nodata' || c.phase === 'passed') {
      return `<div class="small" style="margin-top:10px;color:var(--warn)">
        当前已过今日全部潮次。倒计时会等下一个有数据的大潮日。</div>`;
    }
    return `<div class="small" style="margin-top:10px;padding:9px 11px;background:var(--ink-bg);border-radius:8px;color:var(--ink-deep)">
      <b>页面现在取的是：${esc(c.tideLabel)} ${CountdownEngine.hhmm(c.tideAt)}</b><br>
      倒计时总是取「紧接着还没过的那一次潮」。填了两个时刻时，先到的那次生效。
    </div>`;
  }

  function renderCorrection() {
    const box = $('#correction');
    const p = state.pointId ? TideData.getPoint(state.pointId) : null;
    const ovActive = p && TideData.hasOverrideFor(state.date, p.id);

    box.innerHTML = `
      <div class="small" style="margin-bottom:10px">
        内置潮汐表是人工录入的，可能过期。查到官方潮时后填进来，本页会据此重算出发时间和倒计时 —— <b>这是数据永不过期的兜底</b>。
      </div>
      <div class="small" style="margin-bottom:10px;color:${p ? 'var(--info)' : 'var(--warn)'};font-weight:600">
        当前校正对象：${p ? esc(p.name) + '（' + esc(state.date) + '）' : '请先选一个点位'}
        ${ovActive ? '　<b style="color:var(--safe)">· 校正已生效</b>' : ''}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label style="flex:1;min-width:130px">
          <div class="small" style="margin-bottom:4px">早潮时刻</div>
          <input type="time" id="customAM" value="${esc(state.customTideAM)}" ${p ? '' : 'disabled'}
                 style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:15px;font-family:inherit">
        </label>
        <label style="flex:1;min-width:130px">
          <div class="small" style="margin-bottom:4px">晚潮时刻</div>
          <input type="time" id="customPM" value="${esc(state.customTidePM)}" ${p ? '' : 'disabled'}
                 style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:15px;font-family:inherit">
        </label>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" id="saveCustom" ${p ? '' : 'disabled'}>应用校正</button>
        <button class="btn btn-ghost" id="clearCustom">清空</button>
      </div>
      <div class="small" style="margin-bottom:10px">填了就覆盖内置数据；留空则用内置表。<b>切换日期会清空校正</b>，避免旧潮时被套到新日子上。</div>
      ${pickHintHtml()}`;

    const save = $('#saveCustom');
    if (save) save.addEventListener('click', () => {
      state.customTideAM = $('#customAM').value;
      state.customTidePM = $('#customPM').value;
      if (!isValidTimeStr(state.customTideAM) && !isValidTimeStr(state.customTidePM)) {
        toast('请至少填一个时刻');
        return;
      }
      saveState();
      renderAll();
      toast('已应用手填潮时');
    });
    $('#clearCustom').addEventListener('click', () => {
      state.customTideAM = ''; state.customTidePM = '';
      saveState(); renderAll();
      toast('已清空，恢复内置数据');
    });
  }

  /* ============================================================
   * 日期选择
  /* ============================================================

  /* ============================================================
   * L1 首屏风险确认
   * ============================================================ */
  /* ============================================================
   * 复制 / 导航 / 滚动
   * ============================================================ */

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast(okMsg || '已复制'))
        .catch(() => fallbackCopy(text, okMsg));
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(okMsg || '已复制'); }
    catch (e) { toast('复制失败，请手动选择文本'); }
    document.body.removeChild(ta);
  }

  function navigate() {
    const p = state.pointId ? TideData.getPoint(state.pointId) : null;
    if (!p) { if (view !== 'plan') editAnswer('date'); return; }
    copyText(p.transport.nav, '导航关键词已复制：' + p.transport.nav);
    toast('已复制：' + p.transport.nav + '　打开地图 App 粘贴即可');
  }

  function scrollTo(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ============================================================
   * 离线检测（弱网降级）
   * ============================================================ */

  function setupOfflineBadge() {
    const badge = $('#offlineBadge');
    const update = () => { badge.hidden = navigator.onLine; };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  /* ============================================================
   * 顶部数据版本提示
   * ============================================================ */

  function renderDataVersion() {
    const el = $('#dataVersion');
    const stale = TideData.isStaleNow();   // 开关注在 renderAll 开头统一刷新
    el.textContent = stale
      ? `数据已过期（更新至 ${TideData.DATA_DATE}）· 请以官方发布为准`
      : `潮汐数据更新至 ${TideData.DATA_DATE}`;
    el.classList.toggle('stale', stale);

    // 过期时在首屏上方插一条醒目提示，并给出手动校正入口
    const bar = $('#staleBar');
    if (bar) {
      if (stale) {
        bar.hidden = false;
        bar.innerHTML = `本站内置潮汐表已过期（更新至 ${esc(TideData.DATA_DATE)}），
          <b>已停止显示具体潮时</b>，避免你按错误时间到场。
          请点开下方「官方数据入口」查当日权威潮时，或用「手动校正」填入你查到的时刻。`;
      } else {
        bar.hidden = true;
        bar.innerHTML = '';
      }
    }
  }

  /** 页脚常驻免责声明（六） */
  function renderFooter() {
    const box = $('#footerDisclaimer');
    if (!box) return;
    box.innerHTML = TideData.SAFETY.footer
      .map((t, i) => `<li>${i === 5 ? t.replace('110', '<b>110</b>') : esc(t)}</li>`)
      .join('');
  }

  /* ============================================================
   * 重构 · 提问向导（视图 A）
   *
   * 设计约束：
   *  1. 每个问题都必须真的改变方案输出，否则不该问（date/companion/origin 都满足）
   *  2. 「未答完不展示方案」—— 避免用户在没定日期/同行人的情况下看到一堆
   *     不知道适不适合自己的点位，这是原来界面「乱」的根因
   *  3. 可回退、可跳题；已答过的题保留答案
   * ============================================================ */

  /** 某月整月日历结构：含已过去的日子（展示但不可点）。
      大潮日取内置表实测等级，其余日子按天文规律推等级。 */
  function buildMonth(y, m) {   // m 为 0-based
    const first = new Date(y, m, 1);
    const n = new Date(y, m + 1, 0).getDate();
    const days = [];
    for (let d = 1; d <= n; d++) {
      const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const rec = TideData.TIDE_TABLE[key];
      const ld = TideData.lunarDayOf(key);
      days.push({
        key, d,
        past: TideData.isPast(key),
        lv: rec ? maxLevelOfDay(rec) : TideData.approxLevel(key),
        peak: rec ? !!rec.peak : (ld === 3 || ld === 18),
        today: key === todayKey()
      });
    }
    return {
      key: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: `${y} 年 ${m + 1} 月`,
      pad: first.getDay(), days
    };
  }

  /** 某一步是否已答 */
  function isAnswered(step) {
    const q = QUESTIONS[step];
    if (q === 'safety') return state.safetyAck === true;
    if (q === 'date') return chosen.date && !!state.date;
    if (q === 'companion') return !!state.companionType;
    if (q === 'origin') return chosen.origin;
    return true;
  }

  /** 全部答完？（决定是进方案页还是继续向导） */
  function isAllAnswered() {
    return QUESTIONS.every((_, i) => isAnswered(i));
  }

  /** 这一步有没有可用值（默认值也算）——决定「下一步」是否可按。
      与 isAnswered 的区别：进度条只认用户真选过（isAnswered），
      但按钮可用性认"当前有值"——日期/出发地有预填默认值，
      用户看到默认值点继续，就等于接受了默认。 */
  function hasValue(step) {
    const q = QUESTIONS[step];
    if (q === 'safety') return state.safetyAck === true;
    if (q === 'date') return !!state.date;
    if (q === 'companion') return !!state.companionType;
    if (q === 'origin') return !!state.originId;
    return true;
  }

  /** 第一条未答的题（用于「继续」按钮与自动定位） */
  function firstUnanswered() {
    const i = QUESTIONS.findIndex((_, idx) => !isAnswered(idx));
    return i < 0 ? QUESTIONS.length - 1 : i;
  }

  function renderAskProgress() {
    const steps = $('#askSteps');
    const fill = $('#askBarFill');
    if (!steps || !fill) return;
    const done = QUESTIONS.filter((_, i) => isAnswered(i)).length;

    const LABEL = { safety: '安全确认', date: '哪天来', companion: '和谁来', origin: '从哪出发' };
    steps.innerHTML = QUESTIONS.map((q, i) => {
      const cls = i === askStep ? 'on' : (isAnswered(i) ? 'done' : '');
      const mark = isAnswered(i) ? '✓' : String(i + 1);
      return `<div class="ask-step ${cls}"><span class="dot">${mark}</span>
        <span class="lbl">${LABEL[q]}</span></div>`;
    }).join('');

    fill.style.width = Math.round(done / QUESTIONS.length * 100) + '%';
  }

  function renderAsk() {
    renderAskProgress();
    const panel = $('#askPanel');
    const foot = $('#askFoot');
    if (!panel || !foot) return;

    const q = QUESTIONS[askStep];

    if (q === 'safety') {
      panel.innerHTML = `
        <div class="card">
          <h2 class="ask-q">看潮之前，先花 30 秒</h2>
          <p class="ask-hint">钱塘江的潮来得快、力气大，和海边慢慢涨的水不一样。下面几条记住，就能安心看。</p>
          <div class="ask-speed">
            <b>潮头推进速度可达每秒 5–10 米，比人跑得快。</b>
            观潮意外大多发生在自以为安全的位置——所以这几条不是走形式。
          </div>
          <div class="ask-do-h ok">✓ 这样做</div>
          <ul class="ask-safety-list ok">
            <li>站护栏内侧，听现场指挥</li>
            <li>提前 2 小时到，潮水过境只有约 3 分钟</li>
            <li>水位突降 / 远处闷雷 / 江面白线 → 立即后撤</li>
          </ul>
          <div class="ask-do-h no">✕ 别这样做</div>
          <ul class="ask-safety-list no">
            <li>翻越挡墙</li>
            <li>下江滩、丁坝、护坦</li>
            <li>夜间下堤、与潮争道</li>
          </ul>
        </div>`;
      /* 确认并入主按钮：按钮文案即知情同意，点按 = 确认。
         不再有独立勾选框，但「未经主动确认不得前进」这条红线不变。 */
      foot.innerHTML = `
        <span class="spacer"></span>
        <button class="btn btn-primary btn-lg" id="askNext">我已知晓风险，继续</button>`;
      $('#askNext').addEventListener('click', () => {
        state.safetyAck = true;
        saveState();
        renderAskProgress();
        goStep(askStep + 1);
      });
      return;
    }

    if (q === 'date') {
      const tk = todayKey();
      const staleNow = TideData.isStaleNow();

      /* 本月 + 后三个月，Tab 切换；默认落在已选日期所在的月（没选则本月） */
      const tm = new Date(tk + 'T00:00:00');
      const tabMonths = [0, 1, 2, 3].map(i => {
        const d2 = new Date(tm.getFullYear(), tm.getMonth() + i, 1);
        const key = `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}`;
        return { key, label: `${d2.getMonth() + 1} 月${i === 0 ? ' · 本月' : ''}` };
      });
      const defKey = (state.date && tabMonths.some(t => t.key === state.date.slice(0, 7)))
        ? state.date.slice(0, 7) : tabMonths[0].key;
      const activeKey = askCalMonthKey || defKey;
      const am = buildMonth(+activeKey.slice(0, 4), +activeKey.slice(5, 7) - 1);

      panel.innerHTML = `
        <div class="card">
          <h2 class="ask-q">你哪天来看潮？</h2>
          <p class="ask-hint">潮时每天往后挪 40–50 分钟，<b>日期是方案里最关键的变量</b>。</p>
          <div class="ask-cal-tabs" id="askCalTabs">
            ${tabMonths.map(t => `<button type="button" class="ask-cal-tab ${t.key === activeKey ? 'on' : ''}" data-month="${t.key}">${t.label}</button>`).join('')}
          </div>
          <div id="askDates">
            <div class="ask-cal-month">
              <h4>${am.label}</h4>
              <div class="ask-cal-grid">
                ${['日', '一', '二', '三', '四', '五', '六'].map(w => `<span class="ask-cal-wd">${w}</span>`).join('')}
                ${'<span class="ask-cal-pad"></span>'.repeat(am.pad)}
                ${am.days.map(day => day.past
                  ? `<button type="button" class="ask-date" disabled><b>${day.d}</b></button>`
                  : `<button type="button" data-date="${day.key}" data-lv="${day.lv}" aria-pressed="${day.key === state.date}"
                      class="ask-date ${day.key === state.date ? 'on' : ''} ${day.today ? 'today' : ''}"
                      style="--lv:${TideData.levelColor(day.lv)}">
                      <b>${day.d}</b>${day.peak ? '<i>★</i>' : ''}
                    </button>`).join('')}
              </div>
            </div>
          </div>
          ${staleNow ? `<div class="stale-note" style="margin-top:13px">
            内置潮汐表已过期，<b>大潮日的具体潮时已隐去</b>；日历等级按天文规律推算，仍然可用。
            到方案页后请用「官方入口」查当日权威潮时。</div>` : ''}
          <div class="ask-cal-legend">
            颜色是潮势，按天文规律推算：<b>越接近浓汤色潮越大</b>（钱塘江水含沙，大潮本就是浑黄的）。
            ★ 是大潮日（农历初三、十八前后最盛），大潮日给出具体潮时；
            小潮日只有等级，大概率只看到一条白线。出发前以当日官方预报为准。
          </div>
        </div>`;

      $$('#askCalTabs .ask-cal-tab').forEach(b => {
        b.addEventListener('click', () => { askCalMonthKey = b.dataset.month; renderAsk(); });
      });

      $$('#askDates .ask-date').forEach(b => {
        b.addEventListener('click', () => {
          state.date = b.dataset.date;
          chosen.date = true;
          state.customTideAM = ''; state.customTidePM = ''; // 换日期，手填潮时作废
          saveState();
          renderAsk();
          renderAskFoot();
        });
      });
      renderAskFoot();
      return;
    }

    if (q === 'companion') {
      panel.innerHTML = `
        <div class="card">
          <h2 class="ask-q">你和谁一起来？</h2>
          <p class="ask-hint">这决定给你推荐哪个点位——<b>带娃和想拍大片，该去的地方完全不同</b>。</p>
          <div class="ask-opts">
            ${COMPANION.map(c => `
              <button type="button" class="ask-opt ${state.companionType === c.id ? 'on' : ''}" data-comp="${c.id}">
                <span class="ico">${c.ico}</span>
                <span class="body"><b>${esc(c.name)}</b><span>${esc(c.desc)}</span></span>
              </button>`).join('')}
          </div>
        </div>`;

      $$('#askPanel .ask-opt').forEach(b => {
        b.addEventListener('click', () => {
          state.companionType = b.dataset.comp;
          state.pointId = null;                 // 换了同行人 → 原推荐作废，重算
          state.driveMinutes = state.driveMinutes; // 车程保留（与同行人无关）
          saveState();
          renderAsk();
          renderAskFoot();
        });
      });
      renderAskFoot();
      return;
    }

    /* origin */
    panel.innerHTML = `
      <div class="card">
        <h2 class="ask-q">从哪出发？</h2>
        <p class="ask-hint">车程直接决定「建议几点出发」。<b>从上海出发和从杭州市区出发，
          出发时间差两个多小时</b>——所以这一问不能省。算不准也没关系，后面可以改。</p>
        <div class="ask-select-wrap">
          <label class="origin-label" for="askOrigin">出发地</label>
          <select id="askOrigin" class="ask-select">
            ${DriveService.ORIGINS.map(o => `<option value="${o.id}" ${o.id === state.originId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
          </select>
        </div>
        <div class="origin-note" id="askOriginNote" style="margin-top:11px"></div>
      </div>`;

    const sel = $('#askOrigin');
    const note = $('#askOriginNote');
    const paintNote = () => {
      const pid = state.pointId;
      if (pid) {
        const d = driveFor(pid);
        const p = TideData.getPoint(pid);
        note.innerHTML = `去「${esc(p.short)}」约 <b>${d.minutes} 分钟</b>（${d.source === 'amap' ? '高德实时路况' : '按直线距离估算'}）。`;
      } else {
        note.innerHTML = `潮时每天推后 40–50 分钟，车程按直线距离估算；实际以导航为准。`;
      }
    };
    paintNote();
    sel.addEventListener('change', () => {
      state.originId = sel.value;
      chosen.origin = true;
      state.driveMinutes = null;   // 换出发地，手填车程作废（否则静默算错）
      saveState();
      if (state.pointId) upgradeDrive(state.pointId);
      renderAskProgress();
      paintNote();
      renderAskFoot();   // 「生成我的方案」按钮从 disabled 翻转为可用
    });
    renderAskFoot();
  }

  /** 向导底部按钮（随当前步变化） */
  function renderAskFoot() {
    const foot = $('#askFoot');
    if (!foot) return;
    const q = QUESTIONS[askStep];
    if (q === 'safety') return;   // 安全步的底部在 renderAsk 里单独给

    const isLast = askStep === QUESTIONS.length - 1;
    foot.innerHTML = `
      ${askStep > 0 ? `<button class="btn btn-ghost" id="askBack">上一步</button>` : ''}
      <span class="spacer"></span>
      ${hasValue(askStep) ? '' : `<button class="btn btn-ghost" id="askSkip">先跳过</button>`}
      <button class="btn btn-primary btn-lg" id="askNext" ${hasValue(askStep) ? '' : 'disabled'}>
        ${isLast ? '生成我的方案' : '下一步'}
      </button>`;

    const back = $('#askBack'); if (back) back.addEventListener('click', () => goStep(askStep - 1));
    const skip = $('#askSkip'); if (skip) skip.addEventListener('click', () => goStep(askStep + 1));
    $('#askNext').addEventListener('click', () => {
      const q0 = QUESTIONS[askStep];
      if (q0 === 'date' && state.date) chosen.date = true;
      if (q0 === 'origin' && state.originId) chosen.origin = true;
      saveState();
      if (isLast || isAllAnswered()) { finishAsk(); return; }
      goStep(askStep + 1);
    });
    // 未答时也可以继续（跳过语义），但按钮不 disabled 会误导，所以用 skip 承接
    if (!hasValue(askStep)) {
      $('#askNext').disabled = true;
      const s = $('#askSkip');
      if (s) s.style.display = '';
    }
  }

  function goStep(n) {
    askStep = Math.max(0, Math.min(QUESTIONS.length - 1, n));
    renderAsk();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * 从方案页「回改」某一题：回到向导并定位到该步。
   * 回改时不丢弃答案——用户只是要调整某一个变量。
   * 已有答案视为"已选过"（chosen 置真），避免进度条倒退。
   */
  function editAnswer(qName) {
    const i = QUESTIONS.indexOf(qName);
    if (i < 0) return;
    if (qName === 'date' && state.date) chosen.date = true;
    if (qName === 'origin' && state.originId) chosen.origin = true;
    view = 'ask';
    askStep = i;
    askCalMonthKey = null;   // 回改日期时，日历落在已选日期所在的月
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** 完成提问 → 进方案页（并算出推荐点位） */
  function finishAsk() {
    view = 'plan';
    if (!state.pointId) state.pointId = recommendPointId();
    saveState();

    /* 推荐落在野生点位、且本会话还没确认过 L4 → 先弹确认，再落位。
       确认：App.pick(推荐位) 正常落位；取消：回落到最优正规点位，
       方案页不给空白。红线口径与旧版一致：野生点位成为"你的方案"之前，
       必须过一次主动勾选的 L4（每次会话一次）。 */
    const recP = TideData.getPoint(state.pointId);
    if (recP && recP.type === 'wild' && !l4ConfirmedOnce) {
      const fb = fallbackOfficialId();
      if (fb !== state.pointId) {
        state.pointId = fb;
        saveState();
        renderAll();
        openWildDisclaimer(recP.id);
        return;
      }
      /* 候选里没有正规点位可回落（理论上不会发生：盐官恒为 official）→ 也弹 L4 */
      openWildDisclaimer(recP.id);
      return;
    }

    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (state.pointId) upgradeDrive(state.pointId);
  }

  /**
   * 依据「同行人类型 + 日期」推荐点位。
   * 规则：先按 COMPANION 的筛选键取候选集合，再挑当日潮势最强的那个。
   * 注意：候选池**包含野生点位** —— 数据里城市阳台是 wild 但 risk「较高」，
   * 且 suitFor 明确写着「带娃/带老人」；把野生点位一刀切掉，会让
   * 「不想跑远」的用户被推荐去 100 公里外的盐官，这本身就是坏建议。
   * 野生点位的 L4 强确认改在 finishAsk / App.pick 的落位环节执行（红线不放松，
   * 只是位置从"浏览时"挪到"成为你的方案时"）。
   * 兜底顺序：候选集空 → 当日最强 → 第一个点位。永不返回 null。
   */
  function recommendPointId() {
    const day = TideData.TIDE_TABLE[state.date];
    const comp = COMPANION.find(c => c.id === state.companionType);
    const allow = comp ? FILTER_MAP[comp.filter] : null;

    let pool = TideData.POINTS;
    if (allow && allow.length) {
      const hit = TideData.POINTS.filter(p => allow.indexOf(p.id) >= 0);
      if (hit.length) pool = hit;
    }

    if (day) {
      let best = null;
      pool.forEach(p => {
        const t = day.tides[p.id];
        if (!t) return;
        if (!best || t.level > best.lv) best = { id: p.id, lv: t.level };
      });
      if (best) return best.id;
    }
    const strongest = day ? strongestPointOfDay(day) : null;
    return (strongest && strongest.point.id) || TideData.POINTS[0].id;
  }

  /** 最优的「正规点位」（L4 取消时的回落，保证方案页不给空白） */
  function fallbackOfficialId() {
    const day = TideData.TIDE_TABLE[state.date];
    const pool = TideData.POINTS.filter(p => p.type !== 'wild');
    if (day) {
      let best = null;
      pool.forEach(p => {
        const t = day.tides[p.id];
        if (!t) return;
        if (!best || t.level > best.lv) best = { id: p.id, lv: t.level };
      });
      if (best) return best.id;
    }
    return pool[0] ? pool[0].id : TideData.POINTS[0].id;
  }

  /** 备选点位：同一条筛选池里，按潮势排序取前 2（排除已推荐的） */
  function alternativePointIds(mainId) {
    const day = TideData.TIDE_TABLE[state.date];
    const comp = COMPANION.find(c => c.id === state.companionType);
    const allow = comp ? FILTER_MAP[comp.filter] : null;
    let pool = TideData.POINTS.filter(p => p.id !== mainId);
    if (allow && allow.length) {
      const hit = pool.filter(p => allow.indexOf(p.id) >= 0);
      if (hit.length) pool = hit;
    }
    pool.sort((a, b) => {
      const la = day && day.tides[a.id] ? day.tides[a.id].level : -1;
      const lb = day && day.tides[b.id] ? day.tides[b.id].level : -1;
      return lb - la;
    });
    return pool.slice(0, 2).map(p => p.id);
  }

  /* ============================================================
   * 重构 · 方案页（视图 B）
   *
   * 设计约束：只给**一个**结论，然后把"为什么"和"其他选项"附上。
   * 原来的界面是把 5 个点位平铺让用户自己挑 —— 那是把决策成本
   * 转嫁给用户。现在替他们做完决策，再给出改主意的地方。
   * ============================================================ */

  function renderAnswersBar() {
    const box = $('#answersBar');
    if (!box) return;
    const d = state.date ? new Date(state.date + 'T00:00:00') : null;
    const comp = COMPANION.find(c => c.id === state.companionType);
    const origin = DriveService.ORIGINS.find(o => o.id === state.originId);

    const pill = (key, q, label) =>
      `<button class="answer-pill" data-edit="${q}">
        <span class="k">${key}</span>${esc(label)}<span class="edit">改</span>
      </button>`;

    box.innerHTML =
      (d ? pill('哪天', 'date', `${d.getMonth() + 1} 月 ${d.getDate()} 日`) : '') +
      (comp ? pill('和谁', 'companion', comp.name) : '') +
      (origin ? pill('从哪', 'origin', origin.name) : '') +
      `<button class="answer-pill answer-pill-reset" id="pillRestart" title="清空已填内容，重新回答">
        <span class="k">↺</span>重新回答
      </button>`;

    $$('#answersBar .answer-pill[data-edit]').forEach(b => {
      b.addEventListener('click', () => editAnswer(b.dataset.edit));
    });
    const rst = $('#pillRestart');
    if (rst) rst.addEventListener('click', doRestart);
  }

  function doRestart() {
    if (!window.confirm('将清空日期、同行人和出发地，重新回答（行前清单的勾选会保留）。确定吗？')) return;
    clearAnswers();
    view = 'ask';
    askStep = 0;
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('已清空，重新开始');
  }

  function renderPlanMain() {
    const box = $('#planMain');
    if (!box) return;

    const dateStr = state.date;
    const point = state.pointId ? TideData.getPoint(state.pointId) : null;
    const day = TideData.TIDE_TABLE[dateStr];
    const comp = COMPANION.find(c => c.id === state.companionType);

    if (!point || !day) {
      if (!dateStr) {
        box.innerHTML = `<div class="plan-card">
          <div class="plan-kicker">你的方案</div>
          <p class="plan-why">还没选日期。回到「哪天来」挑一天，或到下方参考资料里查官方入口。</p>
          <div class="plan-cta"><button class="btn btn-primary" id="planBackAsk">回去选日期</button></div>
        </div>`;
      } else {
        /* 小潮日：日历按天文规律给了等级，但具体时刻只服务大潮日。
           直接说清"大概率看不到"，并给出最近的大潮日跳转。 */
        const near = TideData.allDates.find(d2 => d2 >= dateStr);
        const nearDay = near ? TideData.TIDE_TABLE[near] : null;
        const lv = TideData.approxLevel(dateStr);
        box.innerHTML = `<div class="plan-card">
          <div class="plan-kicker">你的方案</div>
          <h2 class="plan-where">这天是小潮</h2>
          <p class="plan-why">按天文规律推算，这天潮势${lv <= 2 ? '较弱' : '一般'}，
            大概率只能看到一条白线，看不到成型的潮头，本站不为此给出具体潮时。
            ${near && nearDay ? `想看大潮，建议改到 <b>${fmtDateShort(near)}（${esc(nearDay.lunisolar)}）</b>。` : ''}</p>
          <div class="plan-cta">
            ${near ? `<button class="btn btn-primary btn-lg" id="gotoPeak">改到 ${fmtDateShort(near)}</button>` : ''}
            <button class="btn ${near ? 'btn-outline' : 'btn-primary'}" id="planBackAsk">重新选日期</button>
          </div>
        </div>`;
        const gp = $('#gotoPeak');
        if (gp && near) gp.addEventListener('click', () => { setDate(near); });
      }
      const b = $('#planBackAsk'); if (b) b.addEventListener('click', () => editAnswer('date'));
      return;
    }

    const staleNow = TideData.isStaleNow();
    const rec = TideData.getTide(dateStr, point.id);
    const c = CountdownEngine.compute(dateStr, point.id, {
      now: new Date(), driveMinutes: driveMinutesOf(point.id)
    });

    const d = new Date(dateStr + 'T00:00:00');
    const week = '日一二三四五六'[d.getDay()];
    const dd = driveFor(point.id);

    /* ---- 潮时区：过期时不给数字 ---- */
    let timesHtml;
    if (staleNow && !rec) {
      timesHtml = `<div class="plan-times">
        <div class="span2" style="background:var(--warn-bg)">
          <div class="k" style="color:var(--warn)">潮时</div>
          <div class="v" style="font-size:15px;color:var(--warn-text)">数据已过期，本站不显示具体潮时</div>
          <div class="n">请用下方「官方入口」查当日权威潮时，再据此安排出发。</div>
        </div>
      </div>`;
    } else {
      const tideTxt = rec
        ? [(rec.morning && rec.morning !== '—' && rec.morning !== '...' ? `早潮 ${rec.morning}` : ''),
           (rec.evening && rec.evening !== '—' && rec.evening !== '...' ? `晚潮 ${rec.evening}` : '')
          ].filter(Boolean).join(' · ') || '当天无潮时数据'
        : '当天无潮时数据';

      const departOk = c.phase !== 'nodata' && c.phase !== 'passed';
      timesHtml = `<div class="plan-times">
        <div class="span2">
          <div class="k">潮时</div>
          <div class="v">${esc(tideTxt)}</div>
          ${rec && rec.level ? `<div class="n">潮势 ${TideData.levelText(rec.level)}（${stars(rec.level)}）${rec.overridden ? ' · 已按你的校正' : ''}</div>` : ''}
        </div>
        <div>
          <div class="k">建议出发</div>
          <div class="v">${departOk ? CountdownEngine.hhmm(c.departAt) : '—'}</div>
          <div class="n">${departOk ? departDateNote(c.departAt) : '当天潮已过或无数据'}</div>
        </div>
        <div>
          <div class="k">车程</div>
          <div class="v">约 ${dd.minutes} 分</div>
          <div class="n">${dd.source === 'amap' ? '高德实时路况' : (dd.source === 'user' ? '你手动填写' : '按直线距离估算')}
            ${state.driveMinutes != null
              ? `<button class="link-btn" id="driveReset">改回自动估算</button>`
              : `<button class="link-btn" id="driveEdit">不准？手动改</button>`}</div>
        </div>
      </div>`;
    }

    /* ---- 倒计时 ---- */
    let countHtml = '';
    if (!staleNow && c.phase !== 'nodata') {
      const ms = (c.phase === 'planned' || c.phase === 'depart') ? c.msToDepart : c.msToTide;
      const lbl = (c.phase === 'planned' || c.phase === 'depart') ? '距离出发' : '距离潮到';
      const ui = CountdownEngine.PHASE_UI[c.phase] || CountdownEngine.PHASE_UI.nodata;
      const capTxt = lbl === ui.title ? lbl : `${lbl} · ${ui.title}`;
      countHtml = `<div class="plan-count">
        <div class="big" id="heroCount" style="color:${ui.color}"></div>
        <div class="cap"><span id="heroCountLabel" style="color:${ui.color};font-weight:800">${capTxt}</span></div>
      </div>`;
    }

    /* ---- 为什么推荐它 ---- */
    /* 注意：reasons 之后整体过 esc()，所以这里只能放纯文本 —— 曾经把 stars() 的
       HTML 塞进来，结果整串 <span> 被转义成字面文本显示在页面上。
       星级本身在下方潮时格里已有，这里不再重复。 */
    const reasons = [];
    if (comp) reasons.push(`你选了「${comp.name}」，这个点位是这类人最常去、也最不容易后悔的一个。`);
    if (rec && rec.level) reasons.push(`这天这里潮势${TideData.levelText(rec.level)}（潮势强度见下方星级）。`);
    reasons.push(point.expectation);

    const isWild = point.type === 'wild';

    box.innerHTML = `
      <div class="plan-card" style="${staleNow ? 'border-top-color:var(--warn)' : ''}">
        <div class="plan-kicker">${staleNow ? '你的方案（数据已过期）' : '你的方案'}</div>
        <div class="plan-when">${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${week} · ${esc(day.lunisolar)}${day.peak ? ' · 峰值日' : ''}</div>
        <h2 class="plan-where">去 ${esc(point.name)}</h2>
        <p class="plan-why">${reasons.filter(Boolean).map(esc).join(' ')}</p>
        ${countHtml}
        ${timesHtml}
        ${isWild ? `<div class="l3-safety" style="margin:0 0 13px"><b>⚠ 这是非正规管理点位</b>${esc(point.l3Safety)}无护栏、无现场管理，风险由你自己承担。</div>` : ''}
        <div class="plan-cta">
          <button class="btn btn-primary btn-lg" id="planNav">${esc(point.transport.nav)}（复制导航词）</button>
          <button class="btn btn-outline" id="planDetail">查看交通 · 停车 · 坑点</button>
        </div>
        <div id="planDetailBox" hidden style="margin-top:13px"></div>
      </div>`;

    /* 倒计时 tick */
    if (countHtml) startHeroTick();

    /* 手动车程覆盖（P0-01 保留功能）：估算不准时用户可改 */
    const driveEditBtn = $('#driveEdit');
    if (driveEditBtn) {
      driveEditBtn.addEventListener('click', () => {
        const val = window.prompt('从出发地到这里开车大约要多久？（分钟）', String(dd.minutes));
        if (val == null) return;
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n <= 0 || n > 600) { toast('请输入 1–600 之间的分钟数'); return; }
        state.driveMinutes = n;
        saveState();
        renderAll();
        toast('已按 ' + n + ' 分钟车程重算出发时间');
      });
    }
    const driveResetBtn = $('#driveReset');
    if (driveResetBtn) {
      driveResetBtn.addEventListener('click', () => {
        state.driveMinutes = null;
        saveState();
        renderAll();
        if (state.pointId) upgradeDrive(state.pointId);
        toast('已改回自动估算');
      });
    }

    $('#planNav').addEventListener('click', () => {
      copyText(point.transport.nav, '导航关键词已复制');
    });
    $('#planDetail').addEventListener('click', () => {
      const db = $('#planDetailBox');
      if (!db.hidden) { db.hidden = true; return; }
      db.hidden = false;
      db.innerHTML = `
        <div class="kv"><span class="k">导航</span><span class="v">${esc(point.transport.nav)}</span></div>
        ${point.transport.rail ? `<div class="kv"><span class="k">铁路/地铁</span><span class="v">${esc(point.transport.rail)}</span></div>` : ''}
        ${point.transport.extra ? `<div class="kv"><span class="k">补充</span><span class="v">${esc(point.transport.extra)}</span></div>` : ''}
        ${point.transport.parking ? `<div class="kv"><span class="k">停车</span><span class="v">${esc(point.transport.parking)}</span></div>` : ''}
        ${point.needPass ? `<div class="kv"><span class="k">通行证</span><span class="v" style="color:var(--danger);font-weight:600">${esc(point.passNote)}</span></div>` : ''}
        <div class="kv"><span class="k">视野</span><span class="v">${esc(point.view)}</span></div>
        <div class="kv"><span class="k">拥挤度</span><span class="v">${esc(point.crowd)}</span></div>
        <div class="kv"><span class="k">退路</span><span class="v">${esc(point.retreat)}</span></div>
        ${point.traps && point.traps.length ? `<div class="kv" style="margin-top:10px"><span class="k" style="min-width:auto;display:block;margin-bottom:3px">坑点</span><span class="v">${point.traps.map(t => '· ' + esc(t)).join('<br>')}</span></div>` : ''}
        <div class="l3-safety" style="margin-top:11px"><b>⚠ 这个点位的风险</b>${esc(point.l3Safety)}</div>
        ${isWild ? `<div class="small" style="color:var(--danger);font-weight:600;margin-top:9px">非正规管理点位，无护栏、无现场管理。风险由你自己承担。</div>` : ''}`;
    });
  }

  function renderPlanAlt() {
    const box = $('#planAlt');
    if (!box) return;

    const staleNow = TideData.isStaleNow();
    const alts = alternativePointIds(state.pointId);
    const day = TideData.TIDE_TABLE[state.date];

    let html = '';
    if (alts.length) {
      html += `<div class="plan-alt-head">不想去这儿？同类型里还有 ${alts.length} 个备选</div>`;
      html += alts.map(id => {
        const p = TideData.getPoint(id);
        const rec = day ? day.tides[id] : null;
        const lvTxt = (!staleNow && rec) ? `潮势${TideData.levelText(rec.level)}（${stars(rec.level)}）` : '潮势数据已隐藏';
        const dd = driveFor(id);
        const wildNote = p.type === 'wild'
          ? ` · 非正规点位（切换需确认风险）` : '';
        return `<button class="alt-item" data-switch="${id}">
          <span class="body">
            <b>${esc(p.name)}</b>
            <span>${lvTxt} · 车程约 ${dd.minutes} 分${wildNote}</span>
          </span>
          <span class="go">换成它 ›</span>
        </button>`;
      }).join('');
    }

    /* 野生点位：主流程只给一个入口，点开仍走 L4 强制确认 */
    html += `<div class="plan-alt-head">预算优先 / 想人少点？</div>
      <button class="alt-item" data-open-wild="1">
        <span class="body">
          <b>看看野生观潮点（免费 · 人少 · 风险高一档）</b>
          <span>无护栏、无现场管理，风险由你自己承担。点开需先确认风险告知。</span>
        </span>
        <span class="go">去看看 ›</span>
      </button>`;

    box.innerHTML = html;

    $$('#planAlt [data-switch]').forEach(b => {
      b.addEventListener('click', () => {
        /* 必须走 App.pick：野生点位在那里会被 L4 强确认拦一道。
           直接改 state.pointId 会绕过红线（本文件曾犯过这个错，已修）。 */
        window.App.pick(b.dataset.switch);
      });
    });
    const wb = $('#planAlt [data-open-wild]');
    if (wb) wb.addEventListener('click', () => { openWildFromPlan(); });
  }

  /** 从方案页进野生点位：展开资料区并滚过去（L4 确认在资料区内部走原逻辑） */
  function openWildFromPlan() {
    const det = $('#ref-wild');
    if (det) { det.open = true; }
    const el = document.getElementById('sec-wild') || det;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast('野生点位无护栏、无管理，请先读完风险告知');
  }

  /* ============================================================
   * 底部动作条（随视图变化）
   * ============================================================ */

  function renderBottomBar() {
    const bar = $('#bottomBar');
    if (!bar) return;
    if (view === 'ask') {
      bar.innerHTML = `<button class="btn btn-ghost" id="bbSkipAll">直接看完整资料</button>`;
      $('#bbSkipAll').addEventListener('click', () => {
        if (!state.pointId) state.pointId = recommendPointId();
        if (!state.date) state.date = pickDefaultDate();
        view = 'plan';
        saveState();
        renderAll();
        const el = document.querySelector('.refs-head');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } else {
      bar.innerHTML = `
        <button class="btn btn-ghost" id="bbTop">回到顶部</button>
        <button class="btn btn-primary" id="bbPoster">生成观潮长图</button>`;
      $('#bbTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      $('#bbPoster').addEventListener('click', exportPoster);
    }
  }

  /* ============================================================
   * 总渲染
   * ============================================================ */

  function renderAll() {
    syncOverride();
    /* 过期开关必须在任何一次 TideData 读取之前刷新 —— 它现在嵌在 renderAll 里的位置
       决定所有渲染分支看到的是新值还是旧值。放在 renderDataVersion 里会让
       renderDatePicker/renderPoints 等在首次运行（值为 false）时拿到过期数据。 */
    TideData.refreshStale(todayKey());
    /* 同理：「今天」也必须最先注入 —— allDates 会据它滤掉已过去的日期，
       晚一步设置就会渲染出「今天」以前的选项（今天 9/30 却列出 9/25 的根因）。 */
    TideData.refreshToday(todayKey());
    renderDataVersion();

    /* 视图分流：未答完只渲染提问向导，答完才渲染方案页。
       注意：资料区（清单/避雷/日历/安全/野生/官方）只在方案页渲染 ——
       它们在折叠 details 里，DOM 存在即可，用户展开才看。 */
    const askView = $('#view-ask');
    const planView = $('#view-plan');

    if (view === 'ask') {
      askView.hidden = false;
      planView.hidden = true;
      renderAsk();
    } else {
      askView.hidden = true;
      planView.hidden = false;
      renderAnswersBar();
      renderPlanMain();
      renderPlanAlt();
    }
    renderBottomBar();

    renderLivePanel();

    /* 资料区（方案页内）—— 内容始终渲染，折叠由 <details> 负责 */
    renderChecklist();
    renderCalendar();
    renderWild();
    renderPitfalls();
    renderSafety();
    renderOfficial();
    renderCorrection();
    renderRefMeta();
    renderFooter();
  }

  /** 折叠区的角标（让用户不展开也知道里面有多少内容） */
  function renderRefMeta() {
    const el = $('#refChecklistMeta');
    if (!el) return;
    let total = 0, done = 0;
    TideData.CHECKLIST_GROUPS.forEach(g => g.items.forEach(it => {
      total++; if (state.checklist[it.id]) done++;
    }));
    el.textContent = `${done} / ${total} 已办`;
  }

  /* ============================================================
   * 初始化
   * ============================================================ */

  function init() {
    /* 「今天」与「过期」两个全局开关必须在 loadState 之前注入 ——
       loadState 会用 isPast() 丢弃存档里已经过去的日期，晚注入就会漏判。
       （renderAll 里也各调一次，那是为了覆盖跨零点 / 手动重渲染的路径） */
    TideData.refreshToday(todayKey());
    TideData.refreshStale(todayKey());

    loadState();
    if (!state.date) state.date = pickDefaultDate();

    /* 视图初判：答完过（有日期 + 同行人 + 安全确认）就直接进方案页，
       否则回到向导，并定位到第一条没答的题。
       注意：state.date 总会被 pickDefaultDate 填上，所以不能用它当"答过"的判据 ——
       真正的判据是 companionType + safetyAck（这两个只有用户主动选过才有值）。 */
    if (state.safetyAck && state.companionType) {
      view = 'plan';
      if (!state.pointId) state.pointId = recommendPointId();
    } else {
      view = 'ask';
      askStep = firstUnanswered();
    }

    bindPoints();
    bindChecklist();
    setupOfflineBadge();

    const btnPoster = $('#btnPoster');
    if (btnPoster) btnPoster.addEventListener('click', exportPoster);
    const btnCopy = $('#btnCopy');
    if (btnCopy) btnCopy.addEventListener('click', copyPosterText);
    const btnRestart = $('#btnRestart');
    if (btnRestart) btnRestart.addEventListener('click', doRestart);

    // L5 现场提示每分钟刷新
    setInterval(renderLivePanel, 30000);

    renderAll();
  }

  /* 暴露给内联 onclick */
  window.App = {
    setDate, navigate, scrollTo, exportPoster, copyPosterText, renderAll,
    /** 只读快照（测试与线上排查用）—— 不含内部可变引用 */
    getState() {
      return {
        date: state.date, pointId: state.pointId, originId: state.originId,
        companionType: state.companionType, safetyAck: state.safetyAck,
        driveMinutes: state.driveMinutes,
        chosen: { date: chosen.date, origin: chosen.origin },
        view, askStep
      };
    },
    /** 选点位（统一入口，含野生点位 L4 确认） */
    pick(pointId) {
      const p = TideData.getPoint(pointId);
      if (!p) return;
      if (p.type === 'wild' && !l4ConfirmedOnce) { openWildDisclaimer(pointId); return; }
      state.pointId = pointId;
      // 注意：不要在这里无条件重置 driveMinutes —— 用户手填过的车程要保留。
      // 车程现在由 DriveService 按「出发地 + 点位」动态解析（见 driveFor）。
      saveState();
      renderAll();
      upgradeDrive(pointId);   // 尽力用高德实时路况刷新
      toast('已选定 ' + p.short);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
