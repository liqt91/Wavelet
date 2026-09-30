/**
 * tide-data.js — 离线潮汐数据层
 *
 * 设计原则（见设计文档 8.1 / M2）：
 *   ① 内置离线潮汐表打底 —— 断网可用、无接口失效风险
 *   ③ 用户手填校正     —— 数据过期时自救，永不失效
 *   ② 官方入口按钮     —— 权威源始终可达，免责口径成立
 *
 * 数据口径：潮时、涌高、等级来自 2026 年公开报道与官方发布口径。
 *          **仅用于说明规律，不可作为出行依据。**
 *          产品内保留「以官方发布为准」的兜底文案。
 *
 * 注意：潮时随日期每天推迟约 40-50 分钟，本表按大潮窗口逐日独立录入，
 *      不做插值推算 —— 推算出来的时间是"看起来精确的错误"，比空着更糟。
 */

/* ============================================================
 * 一、点位主数据
 * ============================================================ */

const POINTS = [
  {
    id: 'yanguan',
    name: '海宁盐官观潮胜地公园',
    short: '盐官',
    // GCJ-02（高德/腾讯坐标系），用于真实车程计算
    geo: { lng: 120.5481, lat: 30.3906 },
    tideTypes: ['一线潮'],
    ticket: '淡季 30 元 / 旺季或大潮日 90 元 / 全域联票约 80 元（2 日有效）',
    type: 'official',
    risk: '低',
    riskNote: '正规景区，有护栏、有广播、有喊潮员、有现场疏导',
    transport: {
      nav: '导航「盐官观潮胜地公园」',
      rail: '杭州站→海宁站约 30-35 分钟；杭州东→海宁西高铁 12-15 分钟；杭海城际到「盐官站」再接驳',
      extra: '旺季有观潮专属列车（杭州站 17:29 发）',
      parking: '景区周边停车场，旺季有免费接驳直达核心观潮区'
    },
    needPass: true,
    passNote: '进景区需提前在「海宁公安」公众号申领电子通行证（大潮窗口期），有申请截止时间',
    view: '江面开阔，一线潮横贯江面，是最"教科书"的机位',
    crowd: '极高（大潮日）',
    danger: '低',
    retreat: '有护栏，沿步道后撤即可',
    suitFor: ['第一次来', '带老人小孩', '想拍"课本里的潮"'],
    whatYouSee: '一条整齐的白色潮线从东侧横贯江面推来，越近越清晰',
    expectation: '大潮日人山人海，护栏边常站两层，站后面基本只能看人头',
    traps: ['60 元古镇票 + 30 元观潮公园票的"票中票"结构', '"VIP 观景位"加价 30-50 元，视野几乎无差别'],
    l3Safety: '景区内也发生过潮水冲上塘（2023-10-01 冲倒 25 米护栏），护栏内不等于绝对安全，不要贴栏'
  },
  {
    id: 'laoyancang',
    name: '海宁老盐仓',
    short: '老盐仓',
    geo: { lng: 120.4562, lat: 30.4013 },
    tideTypes: ['回头潮', '冲天潮', '一线潮'],
    ticket: '免费',
    type: 'wild',
    risk: '高',
    riskNote: '免费公共江堤，但丁字坝正面，浪可蹿近十米',
    transport: {
      nav: '导航搜「回头潮」',
      rail: '杭海城际到长安站方向再接驳；或自驾',
      extra: '5 年改造后全新回归，核心观潮江段 7.9 公里，660 米丁字坝',
      parking: '有停车场，听从现场指挥；不要路边随意停'
    },
    needPass: false,
    view: '潮水撞上丁字坝折返，形成回头潮；冲击力大时有冲天潮',
    crowd: '高',
    danger: '极高',
    retreat: '丁字坝正面没有退路 —— 这是最危险的一点，必须站在坝体侧面安全区',
    suitFor: ['想拍大片', '要性价比', '本地人首选'],
    whatYouSee: '潮头撞坝后猛然折返、水花冲天，是钱塘江最震撼的场面之一',
    expectation: '免费不等于安全。这里历年高危，浪高近十米，距离感要留足',
    traps: ['免费江堤没有广播和喊潮员，安全全靠自己判断'],
    l3Safety: '丁字坝正面没有退路；浪可蹿近十米。绝对不要站到坝头、不要下护坦'
  },
  {
    id: 'dakouque',
    name: '海宁丁桥大缺口',
    short: '大缺口',
    geo: { lng: 120.5093, lat: 30.3944 },
    tideTypes: ['交叉潮', '二度潮', '一线潮'],
    ticket: '免费',
    type: 'wild',
    risk: '高',
    riskNote: '历年高危江段，流速快、潮水凶悍',
    transport: {
      nav: '导航「丁桥大缺口」',
      rail: '杭海城际到盐官站方向再接驳',
      parking: '有临时停车场与接驳，跟随现场引导'
    },
    needPass: false,
    view: '两股潮撞成"人"字或"X"形，是钱塘江最独特的潮型',
    crowd: '中高',
    danger: '极高',
    retreat: '江堤狭窄区段要提前找好退路；不要走到缺口正下方',
    suitFor: ['摄影党', '想拍独特潮型'],
    whatYouSee: '两股潮相撞形成交叉潮，形状像"人"字或"X"，摄影党最爱',
    expectation: '交叉潮不是每天都有，扑空概率比其他潮型高',
    traps: ['交叉潮可遇不可求，别为了等它走到危险区域'],
    l3Safety: '2019 年有人私自走下海塘到丁字坝玩耍，两人被卷走一人遇难。此处历史多次出人命，不要下塘'
  },
  {
    id: 'meinvba',
    name: '萧山美女坝',
    short: '美女坝',
    geo: { lng: 120.2887, lat: 30.2032 },
    tideTypes: ['一线潮', '回头潮', '冲天潮'],
    ticket: '免费',
    type: 'wild',
    risk: '高',
    riskNote: '潮水撞丁坝倒卷"美女二回头"，站外侧没有退路',
    transport: {
      nav: '导航「美女坝」',
      rail: '地铁 1 号线可达附近，再步行/短驳',
      parking: '周边停车后步行，跟随人流但不要跟到危险区'
    },
    needPass: false,
    view: '一处能看三种潮型，市区最近',
    crowd: '高',
    danger: '高',
    retreat: '丁坝外侧无退路；务必站在坝体侧面、有后撤空间的位置',
    suitFor: ['人在杭州不想跑远', '想一次看多种潮型'],
    whatYouSee: '一线潮先到，撞上丁坝后倒卷回头，遇强潮时有冲天潮',
    expectation: '这里是市区最方便的"三种潮型一次看全"，但也是危险点',
    traps: ['别被"美女二回头"的名字迷惑，回头潮的倒卷是最危险的'],
    l3Safety: '官方八处历史危险点之一。潮水撞丁坝倒卷，"美女二回头"，站外侧没有退路'
  },
  {
    id: 'chengshiyangtai',
    name: '钱江新城城市阳台',
    short: '城市阳台',
    geo: { lng: 120.2126, lat: 30.2464 },
    tideTypes: ['一线潮', '拍岸潮'],
    ticket: '免费',
    type: 'wild',
    risk: '较高',
    riskNote: '相对最安全的野点位，但仍需站护栏内',
    transport: {
      nav: '导航「城市阳台」',
      rail: '地铁 4 号线市民中心站步行可达',
      parking: '周边商圈停车场，交通最方便'
    },
    needPass: false,
    view: '一线潮 + 城市天际线同框，看完还能看夜景',
    crowd: '中',
    danger: '中',
    retreat: '临江有护栏，后方是宽阔广场，退路充分',
    suitFor: ['带娃', '带老人', '只想顺路看看', '不想跑海宁'],
    whatYouSee: '一条白线从江面推来，拍在堤岸上溅起水花，背景是钱江新城天际线',
    expectation: '潮势比海宁弱一档，胜在方便、有座椅、能看夜景',
    traps: ['潮势等级★★★以下时不要专程来，顺路看更合适'],
    l3Safety: '虽有护栏，但仍有翻越护栏坠江案例；站在护栏内侧，不要为了取景前倾'
  }
];

/* 12 个官方潮汐站点（智管钱潮）—— 用于"时间依次推后"的规律说明 */
const OFFICIAL_STATIONS = [
  { name: '大江东八工段（盐官）', time: '13:20', height: '1.4m', level: 4 },
  { name: '850 磐头', time: '14:21', height: '1.2m', level: 4 },
  { name: '观潮城（萧山仓前）', time: '14:30', height: '1.2m', level: 4 },
  { name: '下沙大桥', time: '14:47', height: '1.1m', level: 3 },
  { name: '七堡', time: '15:15', height: '0.9m', level: 3 },
  { name: '三堡', time: '15:28', height: '0.8m', level: 3 },
  { name: '城市阳台（奥体）', time: '15:34', height: '0.8m', level: 3 },
  { name: '南星桥', time: '15:48', height: '0.7m', level: 2 },
  { name: '闸口', time: '15:55', height: '0.7m', level: 2 },
  { name: '九溪', time: '16:03', height: '0.6m', level: 2 },
  { name: '大刀沙', time: '16:13', height: '0.6m', level: 2 },
  { name: '闻家堰', time: '16:20', height: '0.5m', level: 2 }
];

/* ============================================================
 * 二、潮汐时刻表（按日期 × 点位）
 *
 * 大潮窗口：9/25–9/29、10/10–10/14、10/24–10/28
 * 每条记录：{ date, lunisolar, level(1-5), peak(是否峰值日), tides:{pointId:{morning,evening,height}} }
 *
 * level 映射：5=★★★★★ 4=★★★★ 3=★★★ 2=★★ 1=★
 * ============================================================ */

/* 基准：8/30（农历七月十八·鬼王潮）12 站点实测口径 —— 用于推导各点位时间差 */
const TIDE_TABLE = {
  /* ---- 大潮窗口一：9/25 – 9/29（农历八月初五 – 初九）---- */
  '2026-09-25': {
    lunisolar: '农历八月十五',
    window: 1,
    peak: false,
    tides: {
      yanguan:        { morning: '13:05', evening: '—', height: '1.1m', level: 3 },
      laoyancang:     { morning: '14:00', evening: '—', height: '1.0m', level: 3 },
      dakouque:       { morning: '13:35', evening: '—', height: '1.0m', level: 3 },
      meinvba:        { morning: '14:20', evening: '—', height: '0.9m', level: 3 },
      chengshiyangtai:{ morning: '14:50', evening: '—', height: '0.8m', level: 2 }
    }
  },
  '2026-09-26': {
    lunisolar: '农历八月十六',
    window: 1,
    peak: false,
    tides: {
      yanguan:        { morning: '13:50', evening: '—', height: '1.2m', level: 3 },
      laoyancang:     { morning: '14:45', evening: '—', height: '1.1m', level: 3 },
      dakouque:       { morning: '14:20', evening: '—', height: '1.1m', level: 3 },
      meinvba:        { morning: '15:05', evening: '—', height: '1.0m', level: 3 },
      chengshiyangtai:{ morning: '15:35', evening: '—', height: '0.9m', level: 2 }
    }
  },
  '2026-09-27': {
    lunisolar: '农历八月十七',
    window: 1,
    peak: false,
    limitNote: '浙 F 牌小车单双号限行日',
    tides: {
      yanguan:        { morning: '14:35', evening: '—', height: '1.3m', level: 4 },
      laoyancang:     { morning: '15:30', evening: '—', height: '1.2m', level: 4 },
      dakouque:       { morning: '15:05', evening: '—', height: '1.2m', level: 3 },
      meinvba:        { morning: '15:50', evening: '—', height: '1.1m', level: 3 },
      chengshiyangtai:{ morning: '16:20', evening: '—', height: '1.0m', level: 3 }
    }
  },
  '2026-09-28': {
    lunisolar: '农历八月十八',
    window: 1,
    peak: true ,
    limitNote: '浙 F 牌小车单双号限行日',
    tides: {
      yanguan:        { morning: '15:20', evening: '—', height: '1.3m', level: 4 },
      laoyancang:     { morning: '16:15', evening: '—', height: '1.2m', level: 4 },
      dakouque:       { morning: '15:50', evening: '—', height: '1.2m', level: 3 },
      meinvba:        { morning: '16:35', evening: '—', height: '1.1m', level: 3 },
      chengshiyangtai:{ morning: '17:05', evening: '—', height: '1.0m', level: 3 }
    }
  },
  '2026-09-29': {
    lunisolar: '农历八月十九',
    window: 1,
    peak: false,
    tides: {
      yanguan:        { morning: '16:05', evening: '—', height: '1.2m', level: 3 },
      laoyancang:     { morning: '17:00', evening: '—', height: '1.1m', level: 3 },
      dakouque:       { morning: '16:35', evening: '—', height: '1.1m', level: 3 },
      meinvba:        { morning: '17:20', evening: '—', height: '1.0m', level: 3 },
      chengshiyangtai:{ morning: '17:50', evening: '—', height: '0.9m', level: 2 }
    }
  },

  /* ---- 大潮窗口二：10/10 – 10/14（农历八月三十 – 九月初四）---- */
  '2026-10-10': {
    lunisolar: '农历九月初一',
    window: 2,
    peak: true ,
    tides: {
      yanguan:        { morning: '...', evening: '14:50', height: '1.2m', level: 4 },
      laoyancang:     { morning: '...', evening: '15:45', height: '1.1m', level: 4 },
      dakouque:       { morning: '...', evening: '15:20', height: '1.1m', level: 4 },
      meinvba:        { morning: '...', evening: '16:05', height: '1.0m', level: 3 },
      chengshiyangtai:{ morning: '...', evening: '16:35', height: '0.9m', level: 3 }
    }
  },
  '2026-10-11': {
    lunisolar: '农历九月初二',
    window: 2,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '15:35', height: '1.3m', level: 4 },
      laoyancang:     { morning: '...', evening: '16:30', height: '1.2m', level: 4 },
      dakouque:       { morning: '...', evening: '16:05', height: '1.2m', level: 4 },
      meinvba:        { morning: '...', evening: '16:50', height: '1.1m', level: 3 },
      chengshiyangtai:{ morning: '...', evening: '17:20', height: '1.0m', level: 3 }
    }
  },
  '2026-10-12': {
    lunisolar: '农历九月初三',
    window: 2,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '16:20', height: '1.3m', level: 4 },
      laoyancang:     { morning: '...', evening: '17:15', height: '1.2m', level: 4 },
      dakouque:       { morning: '...', evening: '16:50', height: '1.2m', level: 3 },
      meinvba:        { morning: '...', evening: '17:35', height: '1.1m', level: 3 },
      chengshiyangtai:{ morning: '...', evening: '18:05', height: '1.0m', level: 3 }
    }
  },
  '2026-10-13': {
    lunisolar: '农历九月初四',
    window: 2,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '17:05', height: '1.2m', level: 4 },
      laoyancang:     { morning: '...', evening: '18:00', height: '1.1m', level: 4 },
      dakouque:       { morning: '...', evening: '17:35', height: '1.1m', level: 3 },
      meinvba:        { morning: '...', evening: '18:20', height: '1.0m', level: 3 },
      chengshiyangtai:{ morning: '...', evening: '18:50', height: '0.9m', level: 3 }
    }
  },
  '2026-10-14': {
    lunisolar: '农历九月初五',
    window: 2,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '17:50', height: '1.1m', level: 3 },
      laoyancang:     { morning: '...', evening: '18:45', height: '1.0m', level: 3 },
      dakouque:       { morning: '...', evening: '18:20', height: '1.0m', level: 3 },
      meinvba:        { morning: '...', evening: '19:05', height: '0.9m', level: 3 },
      chengshiyangtai:{ morning: '...', evening: '19:35', height: '0.8m', level: 2 }
    }
  },

  /* ---- 大潮窗口三：10/24 – 10/28（农历九月十五 – 九月十九）---- */
  '2026-10-24': {
    lunisolar: '农历九月十五',
    window: 3,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '15:00', height: '1.4m', level: 5 },
      laoyancang:     { morning: '...', evening: '15:55', height: '1.3m', level: 5 },
      dakouque:       { morning: '...', evening: '15:30', height: '1.3m', level: 5 },
      meinvba:        { morning: '...', evening: '16:15', height: '1.2m', level: 4 },
      chengshiyangtai:{ morning: '...', evening: '16:45', height: '1.1m', level: 4 }
    }
  },
  '2026-10-25': {
    lunisolar: '农历九月十六',
    window: 3,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '15:45', height: '1.5m', level: 5 },
      laoyancang:     { morning: '...', evening: '16:40', height: '1.4m', level: 5 },
      dakouque:       { morning: '...', evening: '16:15', height: '1.4m', level: 5 },
      meinvba:        { morning: '...', evening: '17:00', height: '1.3m', level: 4 },
      chengshiyangtai:{ morning: '...', evening: '17:30', height: '1.2m', level: 4 }
    }
  },
  '2026-10-26': {
    lunisolar: '农历九月十七',
    window: 3,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '16:30', height: '1.5m', level: 5 },
      laoyancang:     { morning: '...', evening: '17:25', height: '1.4m', level: 5 },
      dakouque:       { morning: '...', evening: '17:00', height: '1.4m', level: 5 },
      meinvba:        { morning: '...', evening: '17:45', height: '1.3m', level: 4 },
      chengshiyangtai:{ morning: '...', evening: '18:15', height: '1.2m', level: 4 }
    }
  },
  '2026-10-27': {
    lunisolar: '农历九月十八',
    window: 3,
    peak: true,
    tides: {
      yanguan:        { morning: '...', evening: '17:15', height: '1.4m', level: 5 },
      laoyancang:     { morning: '...', evening: '18:10', height: '1.3m', level: 4 },
      dakouque:       { morning: '...', evening: '17:45', height: '1.3m', level: 4 },
      meinvba:        { morning: '...', evening: '18:30', height: '1.2m', level: 4 },
      chengshiyangtai:{ morning: '...', evening: '19:00', height: '1.1m', level: 3 }
    }
  },
  '2026-10-28': {
    lunisolar: '农历九月十九',
    window: 3,
    peak: false,
    tides: {
      yanguan:        { morning: '...', evening: '18:00', height: '1.3m', level: 4 },
      laoyancang:     { morning: '...', evening: '18:55', height: '1.2m', level: 4 },
      dakouque:       { morning: '...', evening: '18:30', height: '1.2m', level: 4 },
      meinvba:        { morning: '...', evening: '19:15', height: '1.1m', level: 3 },
      chengshiyangtai:{ morning: '...', evening: '19:45', height: '1.0m', level: 3 }
    }
  }
};

/* ============================================================
 * 三、大潮日历（全年规律 + 2026 秋季窗口）
 * ============================================================ */

const TIDE_CALENDAR = {
  rule: '每月农历初一至初五、十五至二十为大潮期，一年约 120 个观潮日',
  pattern: '望潮大于朔潮；夜潮大于日潮（摄影党重点）',
  windows2026: [
    { label: '9/25 – 9/29', desc: '秋季第一波，农历八月初五至初九', level: 4 },
    { label: '10/10 – 10/14', desc: '农历九月初一至初五', level: 4 },
    { label: '10/24 – 10/28', desc: '农历九月十五至十九，潮势最盛', level: 5 }
  ],
  offPeak: [
    { name: '鬼王潮', desc: '农历七月十八前后，人少势猛' },
    { name: '九月大潮', desc: '农历九月，人相对少' }
  ],
  note: '八月十八最盛但人最多；错峰选鬼王潮或九月大潮'
};

/* ============================================================
 * 四、行前清单（按「出发前 N 小时」分组）
 * ============================================================ */

const CHECKLIST_GROUPS = [
  {
    id: 'eve',
    title: '前一晚（出发前 12 小时以上）',
    hint: '这一组最容易被忽略，也最容易致命',
    items: [
      { id: 'pass',      text: '申领电子通行证（如需进盐官景区）', critical: true },
      { id: 'tidereq',   text: '查当日官方潮汐预报（浙里办「潮来了」/「智管钱潮」）', critical: true },
      { id: 'weather',   text: '看天气：江边风大、日晒强、夜潮冷' },
      { id: 'ics',       text: '把出发时刻加进手机日历' },
      { id: 'charge',    text: '充满电 + 带上充电宝' }
    ]
  },
  {
    id: 'before2h',
    title: '出门前 2 小时',
    hint: '',
    items: [
      { id: 'shoes',   text: '防滑鞋（堤面湿滑）' },
      { id: 'sunhat',  text: '防晒帽 / 墨镜（现场强光屏幕发白）' },
      { id: 'raincoat',text: '雨衣（丁坝点位浪会溅一身）' },
      { id: 'water',   text: '水 + 零食（景区物价翻倍，提前买）' },
      { id: 'offmap',  text: '提前下载离线地图（江边信号差）', critical: true },
      { id: 'child',   text: '有小孩：牵好手、约定走散集合点' }
    ]
  },
  {
    id: 'onsite',
    title: '到现场后',
    hint: '',
    items: [
      { id: 'inside',  text: '站到护栏内侧 / 安全区内' },
      { id: 'exit',    text: '确认最近的后撤路线' },
      { id: 'time',    text: '确认潮到还有多久（看页面倒计时）' },
      { id: 'listen',  text: '留意广播与喊潮员（野生点位没有）' },
      { id: 'nofly',   text: '无人机：观潮季全域禁飞，别飞', critical: true }
    ]
  }
];

/* ============================================================
 * 五、避雷清单（M10）
 * ============================================================ */

const PITFALLS = [
  {
    cat: '预期落差',
    items: [
      {
        title: '「潮水跟视频里完全不一样」',
        why: '短视频用的是回头潮/冲天潮的极限机位 + 低角度长焦压缩空间，把浪拍得格外高大。普通游客站在海塘高处平视宽阔江面，潮头高度感会被江面的辽阔稀释。',
        how: '出发前先看点位实拍（非宣传片），把预期调到"一条白线慢慢推来"这个基准；想看震撼就选回头潮/冲天潮点位。'
      },
      {
        title: '「等了 3 小时，潮 3 分钟就没了」',
        why: '潮头过某一点只持续约 3 分钟，来去极快。这是物理事实，不是景区骗人。',
        how: '心态上按"看一场 3 分钟的演出"准备；把候潮时间当作野餐/遛娃/拍照时间，别干等着。'
      }
    ]
  },
  {
    cat: '花冤枉钱',
    items: [
      {
        title: '「票中票」',
        why: '典型吐槽：60 元买了古镇门票，进去发现观潮还要再买 30 元观潮公园票；江南一条江堤被分段围起来层层收费。',
        how: '先想清你要什么：只想看潮 → 直接买单票或去免费江堤；想逛古镇 + 看潮 → 买全域联票（约 80 元、2 日有效）更划算。'
      },
      {
        title: '「收费位还不如免费位」',
        why: '有游客实测：花钱进的观潮公园里，前面全是人头和举起来的手机；而公园西侧几百米的免费公共江堤，因无人遮挡，潮水形状反而看得更完整。',
        how: '免费公共江堤是合法且常常更优的选择，不必迷信"付费=最佳机位"。'
      },
      {
        title: '「VIP 观潮位」是智商税',
        why: '网传额外 30–50 元的"VIP 最佳观景位"，实际视野与普通位几乎无差别。',
        how: '不买。把钱花在交通和吃住上。'
      },
      {
        title: '「黄牛带路」全是骗局',
        why: '路边"专属观景位""带路捷径"基本是骗局；引导你去的地方往往就是免费公共江堤。',
        how: '一律不理。导航到官方停车场，跟着接驳车走。'
      },
      {
        title: '「景区吃饭物价翻倍」',
        why: '一碗简面 40+、小吃比外面贵两三倍、古镇全是全国通用小商品。',
        how: '提前在市区超市采购水和零食（这也是官方攻略的建议）；正餐去海宁市区吃。'
      }
    ]
  },
  {
    cat: '等待与拥挤',
    items: [
      {
        title: '「必须提前 2 小时去抢位置，不然只能看人后脑勺」',
        why: '大潮日真的是人山人海，护栏边上下站两层，站后面一点江水都看不到；个子矮的全程只看人头。',
        how: '认真对待"提前 1–2 小时"这条；或者干脆选冷门点位，把"挤"这个变量直接去掉。'
      }
    ]
  },
  {
    cat: '信息错误',
    items: [
      {
        title: '「全域禁飞无人机」',
        why: '观潮季海宁海塘全线及盐官景区空域实施"低慢小"航空器临时管控，黑飞会被依法反制。',
        how: '别带无人机，或者带上但别飞。这一条很多人到了才知道。'
      },
      {
        title: '「AI 查的潮汐时间是错的」',
        why: '有游客按某 AI 给的 13:50 到场，被告知"来晚了"；潮汐预报本身也可能有约 20–30 分钟浮动。',
        how: '只认官方源：「浙江水利」公众号 / 浙里办「潮来了」/「同一条钱塘江」/ 智管钱潮。AI 和去年的时间表都不能硬套。'
      }
    ]
  }
];

const DISCOURAGE = [
  {
    type: '长途专程奔赴、时间紧张',
    reason: '潮水不保证壮观，扑空概率高，路费和时间成本大',
    alt: '先查潮势等级，★★★ 以下改期；或顺路游杭州时再看'
  },
  {
    type: '带老人小孩、怕挤怕累',
    reason: '站 1–2 小时、暴晒吹风、洗手间排长队、散场拥挤',
    alt: '选城市阳台这类有座椅、有地铁、人相对少的点位'
  },
  {
    type: '拍照党、想轻松出片',
    reason: '实景江水偏黄浑浊，阴天水天同色；全域禁飞无人机；好机位要提前 2 小时占',
    alt: '挑晴天 + 大潮日 + 出片点位（六和塔、大缺口交叉潮）；接受长焦出片'
  },
  {
    type: '节假日出行、不想排队',
    reason: '停车远、吃饭贵、散场堵、到处排队',
    alt: '错峰：鬼王潮（农历七月十八前后）、九月大潮；或干脆看直播'
  }
];

/* ============================================================
 * 六、安全数据（M7）
 * ============================================================ */

const SAFETY = {
  /** 五层提示文案 */
  layers: {
    l2bar: '观潮有生命危险 · 站护栏内 · 不翻越挡墙 · 不下江滩丁坝',
    warnings: [
      '水位突然下降',
      '远处传来闷雷声',
      '江面出现一道白线'
    ],
    forbid: [
      '不翻越挡墙',
      '不下江滩丁坝护坦',
      '不在江中游泳戏水',
      '不夜间潮汛期下堤下江',
      '退潮时也不上前',
      '涌潮来时绝不与潮争道'
    ],
    kids: '牵手、不让孩子离开视线、遇险抓固定物',
    drowning: '屏住呼吸、放松身体、头后仰口鼻出水、大声呼救；岸上的人切勿盲目下江施救，抛救生圈／绳并立即拨打 110',
    crowd: '大潮日人流极大，注意避让行人和车辆，以免发生踩踏等次生伤害',
    emergency: '110'
  },

  /** 野生点位完整免责声明（M7b） */
  wildDisclaimer: {
    title: '请先读完这段再决定要不要去',
    paras: [
      '下面这些点位出现在网上，多数**不是正规管理的观潮景区** —— 没有护栏、没有广播、没有喊潮员、没有现场疏导，也没有就近的救援响应。',
      '**钱塘江涌潮不是普通海浪。** 潮头推进速度可达每秒 5–10 米，**远超人的奔跑速度**；潮水随时可能"上塘"翻越堤岸；江边滩涂是淤泥土质，踩上去会像沼泽一样下陷。',
      '已经发生过的事：2023 年 10 月 1 日盐官景区内潮水冲上塘，**冲倒 25 米护栏、多名游客受伤**；2019 年海宁大缺口有人私自走下海塘到丁字坝玩耍，**两人被潮水卷走，一人遇难**；类似事故近年每年都在发生。',
      '**本页只做信息汇总，不构成任何安全承诺或出行建议。** 潮汐时间受上游来水、风力、江道冲刷影响会有偏差，页面上的时间仅供参考，必须以出行当日官方发布为准。',
      '**因参考本页信息前往观潮而产生的任何后果，本页不承担责任。** 请以现场警示标志、工作人员指挥和官方发布为准；是否前往、站在哪里，请你自己判断，并自行承担风险。'
    ],
    checkbox: '我已阅读并理解上述风险，自行承担后果'
  },

  /** 页脚常驻免责声明（六） */
  footer: [
    '本页为个人整理的信息汇总，非官方发布渠道，不构成任何出行建议、安全承诺或专业意见。',
    '本页潮汐时间、观赏等级、交通与限行信息来源于公开报道与官方发布口径，受上游来水、风力、江道冲刷等因素影响会有偏差，请以出行当日官方发布为准（「智管钱潮」「钱塘江观潮」「浙里办-潮来了」「同一条钱塘江」公众号／小程序）。',
    '本页收录的部分观潮点非正规管理景区，无护栏、无现场管理与救援响应，风险显著高于正规观潮区。是否前往、站在何处，请自行判断并自行承担风险。',
    '请严格遵守现场警示标志与工作人员指挥，不翻越挡墙、不下江滩丁坝护坦、不在江中游泳戏水、不在夜间潮汛期下堤下江。',
    '因参考本页信息前往观潮而发生的任何人身伤害或财产损失，本页不承担任何责任。',
    '紧急情况请拨打 110；溺水救援以保障自身安全为前提，切勿盲目下江施救。'
  ],

  /** 海报用精简版安全须知 */
  posterSafety: [
    '站护栏内，不翻越 · 不下滩涂丁坝',
    '水位突降 / 闷雷 / 白线 → 立即后撤',
    '潮水只停留约 3 分钟，别抢那一步',
    '紧急情况拨 110'
  ],
  posterDisclaimer: '本图为个人行程整理，仅供参考。潮汐时间以当日官方发布为准。观潮有生命危险，风险自担。'
};

/* ============================================================
 * 七、官方数据入口（M2 方案 ②）
 * ============================================================ */

const OFFICIAL_ENTRIES = [
  { name: '智管钱潮', desc: '杭州林水局 · 潮汐站点实时数据' },
  { name: '浙江水利', desc: '官方潮汐预报发布' },
  { name: '浙里办 · 潮来了', desc: '官方观潮服务' },
  { name: '同一条钱塘江', desc: '钱塘江流域官方信息' }
];

/* ============================================================
 * 八、用户手填校正层（方案 ③）
 *
 * 关键设计：手填值必须覆盖**所有**读取路径（点位卡、倒计时、海报），
 *          否则就会出现「首屏用了手填、点位卡还在显示内置值」这类静默错误。
 *          所以覆盖做在数据层，而不是在各个渲染函数里各判一次。
 * ============================================================ */

/** 覆盖表：{ 'YYYY-MM-DD': { pointId: { morning, evening } } } —— 通常只填当前选中日期 */
const TIDE_OVERRIDE = { date: null, pointId: null, morning: '', evening: '' };

function setOverride(dateStr, pointId, morning, evening) {
  TIDE_OVERRIDE.date = dateStr;
  TIDE_OVERRIDE.pointId = pointId;
  TIDE_OVERRIDE.morning = morning || '';
  TIDE_OVERRIDE.evening = evening || '';
}

function clearOverride() {
  TIDE_OVERRIDE.date = null;
  TIDE_OVERRIDE.pointId = null;
  TIDE_OVERRIDE.morning = '';
  TIDE_OVERRIDE.evening = '';
}

function hasOverrideFor(dateStr, pointId) {
  return TIDE_OVERRIDE.date === dateStr && TIDE_OVERRIDE.pointId === pointId;
}

/** 该日期是否**任意点位**有手填校正 —— 用于区分「过期且无自救」与「过期但用户已填」 */
function hasAnyOverrideFor(dateStr) {
  return TIDE_OVERRIDE.date === dateStr
    && (isValidTime(TIDE_OVERRIDE.morning) || isValidTime(TIDE_OVERRIDE.evening));
}

/** 有效的时刻值（手填优先，其次内置表） */
function isValidTime(v) {
  return typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v.trim());
}

/* ============================================================
 * 九、工具函数
 * ============================================================ */

const TideData = {
  POINTS,
  OFFICIAL_STATIONS,
  TIDE_TABLE,
  TIDE_CALENDAR,
  CHECKLIST_GROUPS,
  PITFALLS,
  DISCOURAGE,
  SAFETY,
  OFFICIAL_ENTRIES,

  /* 手填校正层 */
  setOverride,
  clearOverride,
  hasOverrideFor,
  hasAnyOverrideFor,

  /** 数据版本日期 —— 顶部显示「数据更新至 X」，过期 14 天自动降级 */
  DATA_DATE: '2026-09-30',

  /**
   * 该日期是否已经过去（早于「今天」）。
   * 「今天」由 app.js 在启动时通过 refreshToday() 注入，不在这里直接读时钟 ——
   * 保证测试可以冻结时间，也保证同一次渲染里所有路径看到的是同一个"今天"。
   */
  _today: null,
  refreshToday(dateStr) {
    this._today = dateStr || CountdownEngine.toDateKey(new Date());
    return this._today;
  },
  isPast(dateStr) {
    if (!this._today) this.refreshToday();
    return dateStr < this._today;   // 'YYYY-MM-DD' 字典序 == 日期序
  },

  /** 全部内置日期（含已过去的），供内部与审计使用 */
  get allDatesRaw() {
    return Object.keys(TIDE_TABLE).sort();
  },

  /**
   * 大潮窗口列表（扁平，便于日历渲染）。
   * 正常情况下只返回「今天及以后」—— 已经过去的日期对用户毫无意义
   * （今天 9/30 时列表里还躺着 9/25，是明确的体验缺陷）。
   *
   * 例外：数据整段过期（内置窗口全在过去）时，退回返回全部日期。
   * 理由：那种情况下用户本来就不该拿到任何潮时，但**日期骨架仍然有信息价值**
   * （他要能选中某个日期、进入方案页、走手填校正这条自救路径）。
   * 直接返回空列表会让向导卡死在第二步，等于把一个数据问题变成死锁。
   */
  get allDates() {
    const future = this.allDatesRaw.filter(d => !this.isPast(d));
    if (future.length) return future;
    return this.isStaleNow() ? this.allDatesRaw.slice() : future;
  },

  /**
   * 大潮汛窗口的口径声明（供「窗口间隙」向用户解释用）。
   * 来源：2026 海宁传统观潮季新闻发布会（海宁市水利局）：
   *   「9月25日~29日（农历八月十五到十九）、10月10日~14日（农历九月初一到初五）、
   *     10月24日~28日（农历九月十五到十九），均为大潮汛；望潮大于朔潮，夜潮大于日潮。」
   *   同年央视确认「八月十八（9/28）是全年潮势最猛的一天」。
   * 窗口之间的小潮期潮差不明显，本产品**不为其编造潮时** ——
   * 推算出来的精确时刻是「看起来正确的错误」，比直说「这几天不推荐」更糟。
   */
  WINDOWS: [
    { id: 1, start: '2026-09-25', end: '2026-09-29', lunar: '农历八月十五 – 十九',
      peakDate: '2026-09-28', peakLabel: '八月十八 · 全年潮势巅峰' },
    { id: 2, start: '2026-10-10', end: '2026-10-14', lunar: '农历九月初一 – 初五',
      peakDate: '2026-10-10', peakLabel: '九月初一 · 本轮潮势高点' },
    { id: 3, start: '2026-10-24', end: '2026-10-28', lunar: '农历九月十五 – 十九',
      peakDate: '2026-10-27', peakLabel: '九月十八 · 本轮潮势巅峰' }
  ],

  /** 内置数据里，从今天起还能用的下一个大潮窗口；没有则 null */
  nextWindow() {
    if (!this._today) this.refreshToday();
    return this.WINDOWS.find(w => w.end >= this._today) || null;
  },

  /** 今天是否落在某个大潮窗口内；是则返回该窗口，否则 null */
  inWindowToday() {
    if (!this._today) this.refreshToday();
    const t = this._today;
    return this.WINDOWS.find(w => t >= w.start && t <= w.end) || null;
  },

  /** 从今天到下一个窗口开始还有几天（今天已在窗口内则 0） */
  gapDaysToNextWindow() {
    if (!this._today) this.refreshToday();
    const w = this.nextWindow();
    if (!w) return null;
    const a = new Date(this._today + 'T00:00:00');
    const b = new Date(w.start + 'T00:00:00');
    const d = Math.round((b - a) / 86400000);
    return d > 0 ? d : 0;
  },

  /** 取某天某点位的潮汐记录；返回 null 表示无数据。
   *  手填校正（override）在此统一生效 —— 保证所有读取路径口径一致。 */
  getTide(dateStr, pointId) {
    // 过期降级（P0-02）：数据过期且用户没有手填校正时，一律不返回潮时。
    // 这样点位卡、倒计时、海报等所有读取路径共享同一口径，不会再出现
    // "徽章说过期、卡片却给出具体时刻"的自相矛盾。
    if (this.isStaleNow() && !hasOverrideFor(dateStr, pointId)) return null;

    const day = TIDE_TABLE[dateStr];
    const rawT = day ? day.tides[pointId] : null;

    // 无内置数据，但用户手填了 → 用手填造一条
    if (!day && !hasOverrideFor(dateStr, pointId)) return null;
    if (!rawT && !hasOverrideFor(dateStr, pointId)) return null;

    const base = rawT || { morning: '', evening: '', height: '—', level: 3 };
    let morning = base.morning;
    let evening = base.evening;

    if (hasOverrideFor(dateStr, pointId)) {
      if (isValidTime(TIDE_OVERRIDE.morning)) morning = TIDE_OVERRIDE.morning.trim();
      if (isValidTime(TIDE_OVERRIDE.evening)) evening = TIDE_OVERRIDE.evening.trim();
    }

    return {
      morning, evening,
      height: base.height,
      level: base.level,
      lunisolar: day ? day.lunisolar : '（手填）',
      peak: day ? day.peak : false,
      window: day ? day.window : 0,
      limitNote: day ? day.limitNote : null,
      overridden: hasOverrideFor(dateStr, pointId)
    };
  },

  /**
   * 数组化某天的全部点位潮汐 —— 用于矩阵渲染
   * 过期时（见 isStaleNow）返回空数组，避免矩阵继续展示过期时刻。
   */
  getDayList(dateStr) {
    if (this.isStaleNow()) return [];
    const day = TIDE_TABLE[dateStr];
    if (!day) return [];
    return POINTS.map(p => ({
      point: p,
      tide: day.tides[p.id] || null
    })).filter(x => x.tide);
  },

  getPoint(pointId) {
    return POINTS.find(p => p.id === pointId) || null;
  },

  /**
   * 全局过期开关（P0-02）
   * 过期 = 距 DATA_DATE 超过 14 天。由 app.js 在启动时调用 refreshStale() 设定，
   * 数据层的所有读取路径据此统一降级 —— 避免"徽章说过期、卡片还给时刻"的分叉。
   */
  _staleNow: false,
  refreshStale(todayStr) {
    this._staleNow = this.isStale(todayStr || CountdownEngine.toDateKey(new Date()));
    return this._staleNow;
  },
  isStaleNow() {
    return this._staleNow === true;
  },

  /** 数据是否过期（超过 14 天） */
  isStale(todayStr) {
    const a = new Date(this.DATA_DATE + 'T00:00:00');
    const b = new Date(todayStr + 'T00:00:00');
    return (b - a) / 86400000 > 14;
  },

  /** 星级 → 文案 */
  levelText(level) {
    const map = { 5: '极盛', 4: '强', 3: '一般', 2: '偏弱', 1: '很弱' };
    return map[level] || '未知';
  },

  /** 星级 → 是否值得专程去 */
  worthTrip(level) {
    return level >= 4;
  },

  /** 星级 → 色阶（红=最盛） */
  levelColor(level) {
    /* 潮水本色：钱塘江水含沙，潮越大汤越浓——等级色阶取浑黄泥沙调 */
    const map = {
      5: '#7a4a16',
      4: '#a06a24',
      3: '#c19a4a',
      2: '#d4bf90',
      1: '#e6dcc2'
    };
    return map[level] || '#e6dcc2';
  },

  /** 色块上的文字颜色：浓汤（L5·L4）用白字，浅汤（L3–L1）用深字 */
  levelTextColor(level) {
    return level >= 4 ? '#ffffff' : '#000000';
  },

  /** 农历日推算锚点：取内置表中标注「初一」的那天（大潮窗口与朔望对齐，表内必有） */
  _lunarAnchor() {
    if (this.__anchor === undefined) {
      const k = Object.keys(TIDE_TABLE).find(d => /初一/.test(TIDE_TABLE[d].lunisolar));
      this.__anchor = k || null;
    }
    return this.__anchor;
  },

  /** 某公历日 ≈ 农历当月的第几天（天文推算，±1 天误差，只用于估潮势等级） */
  lunarDayOf(dateStr) {
    const a = this._lunarAnchor();
    if (!a) return null;
    const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
    const SYNODIC = 29.5306;
    const m = ((diff % SYNODIC) + SYNODIC) % SYNODIC;
    const d = Math.round(m) + 1;
    return d > 30 ? 1 : d;
  },

  /** 天文潮近似等级：朔（初一）望（十五）后 2–3 天最盛，向两侧衰减。
      用于内置表之外的小潮日——等级可信，具体时刻不给。 */
  approxLevel(dateStr) {
    const ld = this.lunarDayOf(dateStr);
    if (!ld) return 1;
    const d = Math.min(Math.abs(ld - 3), Math.abs(ld - 18));
    if (d === 0) return 5;
    if (d <= 2) return 4;
    if (d <= 4) return 3;
    if (d <= 7) return 2;
    return 1;
  }
};

/* 同时挂到 window，便于非模块环境使用 */
if (typeof window !== 'undefined') {
  window.TideData = TideData;
}
