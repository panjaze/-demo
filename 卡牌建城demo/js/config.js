/* =============================================================
 * config.js —— 卡牌建城 · 轻策略战争 Demo 全部数值
 *
 * 对应《策划案3.1-修订版》§9 / §10 / §11 / §12
 * ★ 所有数值均为【待验证参数】，可用调参面板（按 ` 或 D 唤出）实时修改
 * ★ 数据与逻辑分离：本文件只放数值，规则全部在 game.js
 * ============================================================= */
var CFG = {

  /* ---------------- §11 时间系统 ---------------- */
  time: {
    // 第十四次修订：取消单局时长上限；第十九次修订：**加回 1800 秒兜底**
    // （主城存亡仍是随时可触发的首要结束条件，兜底只用于打破僵局）
    tick: 10,            // 经济 Tick 周期（秒）
    limit: 1800,         // 兜底时长（秒）；到时按 §12.3 综合分判胜负。0 = 不设上限
  },

  /* ---------------- §4 地图（网格制沙盘） ----------------
   * 正交网格，Canvas 以相机模式铺满面板
   * 第十次修订：取消固定「城市区」，改为「相邻生长扩展到全图」
   * 第十一次修订：地图放大到 25×13；**中立资源点改为关于地图中心对称**；删除中立防御塔
   */
  map: {
    cols: 29, rows: 15, tile: 60,
    moveDirs: 4,          // 部队可走方向：4 = 上下左右（不允许斜向）；8 = 含对角
    // 双方主城出生点（关于地图中心 (14,7) 严格对称）
    spawn: { p1: { gx: 3, gy: 11 }, p2: { gx: 25, gy: 3 } },
    /**
     * 中立资源点：**全部关于地图中心 (14,7) 成对对称**，保证双方到任意一点的距离完全相等。
     * 1 个正中心（自身对称）+ 4 对。
     * 第三十次修订：底图实装后，原 (10,5)/(18,9)/(14,4)/(14,10) 四格「四周没有官道」，
     *   沿路行军规则下部队到不了 —— 已挪至临路位置，且**仍严格成对对称**
     *   （对称规则 (gx,gy) ↔ (28-gx,14-gy)，故 p1 到某点的曼哈顿距离 ≡ p2 到其对称点的距离）。
     */
    resources: [
      { gx: 14, gy: 7, res: 'energy',   yield: 12, name: '中央能源点' },

      // 物流点（第二十八次修订：原矿点产出 material 已在二资源体系中无效——NaN bug）
      // 效果：每个已占领物流点，每 24 秒为该方自动免费铺设 1 格道路（地图控制型资源）
      { gx: 9,  gy: 5, res: 'logistics', yield: 0, name: '物流点·西北' },
      { gx: 19, gy: 9, res: 'logistics', yield: 0, name: '物流点·东南' },

      { gx: 5,  gy: 11, res: 'logistics', yield: 0, name: '物流点·西南' },
      { gx: 23, gy: 3, res: 'logistics', yield: 0, name: '物流点·东北' },

      { gx: 5,  gy: 5, res: 'food',     yield: 50, name: '粮点·西北' },
      { gx: 23, gy: 9, res: 'food',     yield: 50, name: '粮点·东南' },

      { gx: 9,  gy: 9, res: 'food',     yield: 50, name: '粮点·内' },
      { gx: 19, gy: 5, res: 'food',     yield: 50, name: '粮点·内' },
    ],
    logisticsRoadSec: 60,   // 物流点：每个占领的物流点每 60 秒自动免费铺 1 格路（§4.3）

    /**
     * ★ 地形表（第三十次修订：底图地形正式进规则，不再全图可建）
     * terrain[gy][gx]：'.' 平原 / 'f' 农田 / 'F' 森林 / 'M' 山地 / 'W' 水域
     * 提取自 plate-final.png：① 每格 HSV 采样分类 → ② 窄河与树影河段改用整分辨率
     *   青蓝像素覆盖率扫描描出 → ③ 灰度 mean/std 方差校正漏判的暗粗糙格
     *   （标定：明确平原 mean156/std18、森林 89/34、岩石山 113~132/52；
     *    只补 mean≤120 且已连通山林核心的格，120~140 的草树混合边缘保持可建）
     * ★ 可建造 = '.' / 'f'（248 格）；不可建造 = 'F' / 'M' / 'W'（187 格）
     */
    terrain: [
      'MMMMMMMFFFF....WWFFF.FMWW.FFM',
      'MMMMMMFFFFFF....WFF.FMWWWW.FF',
      'MMMMM...FFFF....W.......W...M',
      'MMMMM....FFFF..WW.F..ff..f..F',
      'MMFFFF.....F...W..FM.......f.',
      'MM.FF.M.ff.....W..M........ff',
      'FF..FFFfff....W......f...FFf.',
      'FFF.FFFF....WW.MWW......FFFFM',
      '.F..........WFMMF.......FFFFM',
      '....F.......WFMMM.........F.M',
      'f...ff......WWM.......fff..MM',
      '.....Ff.f....WWW.........FM.M',
      '.......f.FFM...W..F......FFMM',
      'FF....fffFFMF..W.FFFF.....MMM',
      'MFMF..F...MM..WW.FFFFFFF.MMMM',
    ],

    /**
     * 初始官道：**已撤销（用户拍板：开局不该有路，更不能铺满）**。
     * 开局只保留两座木桥作为「地形渡口」——桥是路格（可通行），但两岸的路要玩家自己修，
     * 桥从"官道的一部分"变成双方争夺的咽喉点。军队沿路行军 → 开局先修路才能去抢资源点。
     * 旧 99 格官道方案废弃（曾导致：主城外圈被路占死、7 分钟道路 177、修路无开局意义）。
     * 改官道后必跑 `node test/roadnet-check.js` 检查连通性。
     */
    initialRoads: [
      {gx:12,gy:8}, {gx:15,gy:11},
    ],
    /** 两座木桥：地形是水域但是道路，渲染时不画程序化路面（露出底图的木桥） */
    bridges: [{ gx: 12, gy: 8 }, { gx: 15, gy: 11 }],
    /**
     * 官道路基（第三十五次修订）：底图画出的旧官道走向，共 99 格（含两桥与 7 格官道补段）。
     * ★ 纯叙事设定：玩家沿旧官道铺路 =「开垦官道」，机制上就是正常铺路——
     *   无折扣、无免连通、无特殊标识（用户拍板）。唯一机制影响：AI 铺路时优先选官道格。
     * 桥格本身已是路，列在这里只为官道走向完整。
     */
    officialRoads: [
      {gx:0,gy:10}, {gx:1,gy:10}, {gx:2,gy:9}, {gx:2,gy:10}, {gx:2,gy:11}, {gx:2,gy:12}, {gx:2,gy:13},
      {gx:3,gy:4}, {gx:3,gy:5}, {gx:3,gy:6}, {gx:3,gy:7}, {gx:3,gy:8}, {gx:3,gy:9}, {gx:3,gy:10}, {gx:3,gy:13}, {gx:3,gy:14},
      {gx:4,gy:6}, {gx:4,gy:10}, {gx:4,gy:13},
      {gx:5,gy:6}, {gx:5,gy:9}, {gx:5,gy:10}, {gx:5,gy:12}, {gx:5,gy:13},
      {gx:6,gy:6}, {gx:6,gy:10}, {gx:6,gy:11}, {gx:6,gy:12}, {gx:6,gy:13},
      {gx:7,gy:6}, {gx:7,gy:7}, {gx:7,gy:8}, {gx:7,gy:9}, {gx:7,gy:10}, {gx:7,gy:11}, {gx:7,gy:12}, {gx:7,gy:13},
      {gx:8,gy:5}, {gx:8,gy:6}, {gx:8,gy:7}, {gx:8,gy:8}, {gx:8,gy:9}, {gx:8,gy:10}, {gx:8,gy:13},
      {gx:9,gy:6}, {gx:9,gy:7}, {gx:9,gy:8}, {gx:10,gy:8}, {gx:11,gy:8}, {gx:12,gy:8}, {gx:13,gy:8}, {gx:14,gy:8}, {gx:15,gy:8},
      {gx:15,gy:10}, {gx:15,gy:11},
      {gx:16,gy:8}, {gx:16,gy:10}, {gx:17,gy:8}, {gx:17,gy:9}, {gx:17,gy:10},
      {gx:18,gy:5}, {gx:18,gy:6}, {gx:18,gy:7}, {gx:18,gy:8}, {gx:19,gy:6}, {gx:19,gy:8},
      {gx:20,gy:5}, {gx:20,gy:6}, {gx:20,gy:8}, {gx:21,gy:5},
      {gx:22,gy:3}, {gx:22,gy:4}, {gx:22,gy:5}, {gx:22,gy:6}, {gx:22,gy:7}, {gx:22,gy:8}, {gx:22,gy:9}, {gx:22,gy:10},
      {gx:23,gy:5},
      {gx:24,gy:3}, {gx:24,gy:4}, {gx:24,gy:5}, {gx:24,gy:6}, {gx:24,gy:7}, {gx:24,gy:8}, {gx:24,gy:9}, {gx:24,gy:10},
      {gx:25,gy:5}, {gx:25,gy:10}, {gx:26,gy:5}, {gx:26,gy:10}, {gx:26,gy:11}, {gx:27,gy:4}, {gx:27,gy:5}, {gx:27,gy:6}, {gx:27,gy:10}, {gx:27,gy:11},
      {gx:28,gy:4}, {gx:28,gy:11},
    ],
  },

  /* ---------------- §9.1 资源（第十四次修订：删除物资，二资源） ---------------- */
  resource: {
    initial: { energy: 20, food: 60 },
    cap: 0,               // 0 = 无上限
  },

  /* ---------------- §9.2 建筑（第十四次修订：建造只消耗卡牌，不再花物资） ----------------
   * price      卡牌能量标价（§10.2）
   * max        每种建筑数量上限（随主城等级）
   * levels[i]  第 i 级：yield 每 Tick 产出。升级改用「升级牌」，不再花物资
   * 兵营不走 levels，走 train[]
   * 卡坊（原工坊）：每 Tick 产出 1 张随机卡 —— 资源建筑变成卡牌引擎
   */
  buildings: {
    farm: {
      name: '农田', icon: '🌾', price: 1, max: 3,
      foot: { w: 1, h: 1 },            // 逻辑占地：默认 1×1
      desc: '每 Tick 产出粮食',
      levels: [
        { yield: { food: 10 } },
        { yield: { food: 16 } },
        { yield: { food: 24 } },
      ],
    },
    atelier: {
      name: '卡坊', icon: '🎴', price: 2, max: 3,
      foot: { w: 1, h: 1 },
      desc: '每 Tick 产出 1 张随机卡',
      levels: [
        { yield: { cards: 1 }, cardEvery: 20 },
        { yield: { cards: 1 }, cardEvery: 14 },
        { yield: { cards: 1 }, cardEvery: 10 },
      ],
    },
    power: {
      name: '能源站', icon: '🔌', price: 3, max: 3,
      foot: { w: 1, h: 1 },
      desc: '每 Tick 产出能量',
      levels: [
        { yield: { energy: 1 } },
        { yield: { energy: 2 } },
        { yield: { energy: 3 } },
      ],
    },
    barracks: {
      name: '兵营', icon: '⚔️', price: 4, max: 3,
      foot: { w: 2, h: 2 },            // ★ 兵营 2×2（用户拍板）
      desc: '自动训练士兵',
      // 第二十四次修订：产量 +60%、粮耗同步上调（节奏提速）
      train: [
        { interval: 20, count: 7,  food: 12 },
        { interval: 16, count: 9,  food: 15 },
        { interval: 12, count: 11, food: 19 },
      ],
    },
    tower: {
      name: '防御塔', icon: '🗼', price: 5, max: 3,
      foot: { w: 1, h: 1 },
      castleReq: 2,                    // 丙方案：防御塔需要主城 Lv2
      desc: '守卫道路要冲',
      // 第二十四次修订：士兵产量提升后塔杀伤同步 +50%，否则兵海无解（防守端补偿）
      levels: [
        { yield: {}, kill: 3 },
        { yield: {}, kill: 6 },
        { yield: {}, kill: 10 },
      ],
    },
  },

  /* ---------------- 主城等级（§5.5） ----------------
   * 主城可升级；第十四次修订后升级只消耗能量（物资已删除）
   * 建筑等级上限 = min(主城等级, 建筑自身最高等级)
   * 效果牌按 castleReq 逐级解锁
   */
  castle: {
    name: '主城', icon: '🏰', maxLevel: 5,
    foot: { w: 2, h: 2 },             // ★ 主城 2×2（用户拍板）
    gateBuildings: 2,    // 城门缺口：主城四邻最多允许 2 座建筑（保证主城永远可达，方案 C）
    // energy = 主城每 Tick 自带的能量产出（保证基础能量收入，避免"建不出能源站就死锁"）
    // perTypeCap = 该等级下「每种建筑」的数量上限（由主城等级决定城市规模）
    levels: [
      { upCost: { energy: 35 },  hp: 60,  energy: 2, perTypeCap: 3 },  // Lv1 开局自带
      { upCost: { energy: 80 },  hp: 84,  energy: 3, perTypeCap: 4 },  // Lv2 → 解锁防御塔/石路牌 + 建筑可升 Lv2
      { upCost: { energy: 150 }, hp: 108, energy: 4, perTypeCap: 5 },  // Lv3 → 解锁大道牌 + 建筑可升 Lv3
      { upCost: { energy: 250 }, hp: 134, energy: 5, perTypeCap: 6 },  // Lv4
      { upCost: null,            hp: 168, energy: 6, perTypeCap: 7 },  // Lv5 封顶
    ],
  },

  /* ---------------- 卡牌总表（§10） ----------------
   * 建筑卡：数据在 buildings 里，这里只列 key（castleReq 见各建筑）
   * 效果牌：打出即生效、不进城市区；主城达到 castleReq 才会进卡池
   *   type: gain  → 立刻获得 gain 里的资源
   *         slot  → 建筑位上限 +1（每局最多 cards.slotCap 次）
   *         burst → 立刻按「当前每 Tick 粮食产出 × burstMul」结算粮食
   *         boost → 接下来 boostTicks 个经济 Tick，我方全部产出 × boostMul
   */
  cards: {
    /* 建筑牌：打出 = 建造（第十四次修订：不再消耗物资，卡牌是建筑唯一入口） */
    buildings: ['farm', 'power', 'barracks', 'tower', 'atelier'],
    /* 道路牌（三档，主城等级解锁）：tiles = 一张牌可铺的格数 */
    roads: {
      dirt:  { name: '土路牌', icon: '🛤️', price: 2, castleReq: 1, tiles: 1 },
      stone: { name: '石路牌', icon: '🧱', price: 5, castleReq: 2, tiles: 3 },
      avenue:{ name: '大道牌', icon: '🛣️', price: 10, castleReq: 3, tiles: 5 },
    },
    /* 升级牌：通用，对任意己方建筑 +1 级（仍受主城等级上限约束） */
    upgrade: { name: '升级牌', icon: '⬆️', price: 3, castleReq: 2 },
    slotCap: 3,
    effects: {
      harvest:  { name: '丰收',   icon: '🌾', price: 1, castleReq: 1, type: 'gain',  gain: { food: 40 } },
      muster:   { name: '征召',   icon: '🎲', price: 2, castleReq: 1, type: 'draw' },
      repair:   { name: '修缮',   icon: '🛠️', price: 3, castleReq: 2, type: 'repair', repair: 40 },
      reclaim:  { name: '扩建',   icon: '🔨', price: 2, castleReq: 2, type: 'slot' },
      fastCrop: { name: '抢收',   icon: '🌟', price: 3, castleReq: 3, type: 'burst', burstMul: 3 },
      levy:     { name: '催收令', icon: '📜', price: 4, castleReq: 4, type: 'boost', boostMul: 2, boostTicks: 2 },
      rally:    { name: '总动员', icon: '🔥', price: 5, castleReq: 5, type: 'boost', boostMul: 3, boostTicks: 3 },
    },
  },

  /* 注：行军速度唯一来源 = CFG.soldier.marchSecPerTile（原 CFG.road 死配置已删） */

  /* ---------------- 弃牌（第二十次修订：弃牌不再直接触发遗物，改为星级任务条件） ----------------
   * 原 rewardEvery / rewardStep（每弃 N 张触发遗物）机制已删 → 死配置，只保留 relicCap
   */
  discard: { relicCap: 3 },

  /* ---------------- 遗物（弃牌奖励：永久 buff，固定值不叠乘） ----------------
   * val 为固定值；kind: pct = 百分比加成 / add = 固定数值 / flag = 开关
   */
  relics: {
    blueprint: { name: '效率蓝图', icon: '📐', stat: 'allYield',    kind: 'pct', val: 8,  desc: '所有建筑产出 +8%' },
    conscript: { name: '征兵令',   icon: '📜', stat: 'trainCount',  kind: 'add', val: 1,  desc: '兵营每次多产 1 兵' },
    banner:    { name: '行军旗',   icon: '🚩', stat: 'marchSpeed',  kind: 'pct', val: 10, desc: '行军速度 +10%' },
    baggage:   { name: '辎重队',   icon: '🛒', stat: 'marchFood',   kind: 'pct', val: -12, desc: '行军耗粮 -12%' },
    armory:    { name: '军械库',   icon: '⚔️', stat: 'towerKill',   kind: 'add', val: 1,  desc: '防御塔杀伤 +1' },
    caravan:   { name: '商队契约', icon: '🐪', stat: 'energyTick',  kind: 'add', val: 3,  desc: '每 Tick 额外 +3⚡' },
    granary:   { name: '粮仓',     icon: '🏚️', stat: 'foodTick',    kind: 'add', val: 6,  desc: '每 Tick 额外 +6🌾' },
    ram:       { name: '攻城锤',   icon: '🔨', stat: 'siegeDmg',    kind: 'pct', val: 15, desc: '攻击建筑伤害 +15%' },
    /* 行为转化型（第二十二次修订，借鉴杀戮尖塔）：把"占领"动作变成经济收益 */
    vanguard:  { name: '开疆旗',   icon: '⛳', stat: 'captureEnergy', kind: 'add', val: 5, desc: '每占领一次资源点，立即 +5⚡' },
    /* 第二十三次修订 +4：含 1 条机制型（哨塔图纸射程+1）与 1 条联动修缮牌（军械架） */
    watchtower:{ name: '哨塔图纸', icon: '🔭', stat: 'towerRange', kind: 'flag', val: 1, desc: '防御塔射程 +1 格' },
    drum:      { name: '行军鼓',   icon: '🥁', stat: 'marchSpeed', kind: 'pct', val: 8, desc: '行军速度 +8%' },
    taxseal:   { name: '税吏印',   icon: '💰', stat: 'energyTick', kind: 'add', val: 2, desc: '每 Tick 额外 +2⚡' },
    armrack:   { name: '军械架',   icon: '🛠️', stat: 'repairBonus', kind: 'pct', val: 50, desc: '修缮牌修复量 +50%（40 → 60）' },
  },

  /* ---------------- §19 政策系统（第二十次修订：只与主城等级挂钩） ----------------
   * 触发：**开局 1 次 + 每次主城升级 1 次**（不再有周期触发、与时间/弃牌/资源无关）。
   * 品质：**只由主城等级决定**（删掉"随时段上升"）。
   * 三选一可用能量刷新（refreshCost，不限次数）。
   * 槽位制：同时生效 slotCap 条；选新替换最早；选到已有政策且品质更高 → 原地升级。
   * 效果统一走 stat 聚合（与遗物、事件牌同一套 stat）。
   */
  policy: {
    slotCap: 3,               // 同时生效的政策数
    startPick: true,          // 开局先选一次
    onCastleUp: true,         // 主城升级时额外触发一次
    rollCount: 3,             // 三选一
    poolOther: 1,             // 三选一里「非本流派」的张数（其余取本流派）
    refreshCost: 4,           // 刷新费用（能量）
    refreshCap: 3,            // 第二十一次修订：每局限刷次数（对齐万象棋"刷新是稀缺资源"）
    // 品质概率只看主城等级 [黄铜, 白银, 黄金]
    tierByLevel: {
      1: [1.00, 0.00, 0.00],
      2: [0.60, 0.40, 0.00],
      3: [0.30, 0.55, 0.15],
      4: [0.10, 0.45, 0.45],
      5: [0.00, 0.30, 0.70],
    },
    tierNames: ['黄铜', '白银', '黄金'],
    tierIcons: ['🟤', '⚪', '🟡'],
    schools: {
      farm:    { name: '种田', icon: '🌾', desc: '经济与产能' },
      war:     { name: '战争', icon: '⚔️', desc: '军事与推进' },
      balance: { name: '中和', icon: '⚖️', desc: '节奏与扩张' },
    },
    /**
     * 政策池。effects[].kind：pct = 百分比加成（同类相加）/ add = 固定数值（相加）
     * vals 依次为 黄铜 / 白银 / 黄金 三档
     */
    list: {
      /* ---- 种田 ---- */
      till:      { school: 'farm', name: '精耕',   icon: '🌾', desc: '农田产出 +{v}%',
                   effects: [{ stat: 'farmYield', kind: 'pct', vals: [15, 24, 35] }] },
      haste:     { school: 'farm', name: '提速',   icon: '⏩', desc: '主城升级费 -{v}%',
                   effects: [{ stat: 'castleUpCost', kind: 'pct', vals: [-10, -16, -23] }] },
      intake:    { school: 'farm', name: '广纳',   icon: '🎴', desc: '手牌上限 +{v}',
                   effects: [{ stat: 'handCap', kind: 'add', vals: [1, 2, 3] }] },
      /* ---- 第二十八次修订：GPT 思路——政策改写规则/带代价，而非纯数值 ---- */
      rotation:  { school: 'farm', name: '轮作',   icon: '🌾', desc: '农田产出 +{v}%，能源站产出 -{v}%',
                   effects: [{ stat: 'farmYield', kind: 'pct', vals: [30, 40, 50] },
                             { stat: 'powerYield', kind: 'pct', vals: [-30, -40, -50] }] },
      garrison2: { school: 'war',  name: '屯田戍边', icon: '⚔️', desc: '兵营训练不耗粮，每次产量 -{v} 兵',
                   effects: [{ stat: 'trainFoodFree', kind: 'flag', val: 1 },
                             { stat: 'trainCount', kind: 'add', vals: [-2, -2, -1] }] },
      standing:  { school: 'war',  name: '常备军', icon: '🏰', desc: '士兵上限 +{v}，每 Tick -3⚡',
                   effects: [{ stat: 'troopCap', kind: 'add', vals: [40, 40, 40] },
                             { stat: 'energyTick', kind: 'add', vals: [-3, -3, -3] }] },
      engineering:{school: 'balance', name: '工程学', icon: '🛤️', desc: '道路牌格数 +1，价格 +1⚡',
                   effects: [{ stat: 'roadTiles', kind: 'add', vals: [1, 1, 1] },
                             { stat: 'roadCost', kind: 'add', vals: [1, 1, 1] }] },
      /* ---- 战争 ---- */
      levyP:     { school: 'war', name: '征兵',   icon: '⚔️', desc: '兵营训练间隔 -{v}%',
                   effects: [{ stat: 'trainInterval', kind: 'pct', vals: [-10, -16, -23] }] },
      forced:    { school: 'war', name: '急行军', icon: '🚩', desc: '行军速度 +{v}%',
                   effects: [{ stat: 'marchSpeed', kind: 'pct', vals: [15, 24, 35] }] },
      supply:    { school: 'war', name: '辎重',   icon: '🛒', desc: '行军耗粮 -{v}%',
                   effects: [{ stat: 'marchFood', kind: 'pct', vals: [-20, -32, -45] }] },
      siege:     { school: 'war', name: '攻城',   icon: '🔨', desc: '攻击建筑伤害 +{v}%',
                   effects: [{ stat: 'siegeDmg', kind: 'pct', vals: [20, 32, 45] }] },
      bulwark:   { school: 'war', name: '坚壁',   icon: '🛡️', desc: '建筑防御值 +{v}%',
                   effects: [{ stat: 'buildingHp', kind: 'pct', vals: [20, 32, 45] }] },
      /* 机制改写型（第二十二次修订，借鉴王者万象棋"特殊天赋锚定构筑"）：
         flag 类效果不参与数值聚合，由 policyFlag() 查询后改变规则本身 */
      fieldMarch:{ school: 'war', name: '野战行军', icon: '🏕️', desc: '部队可离开道路走草地，行军耗粮 ×2',
                   effects: [{ stat: 'offroadMarch', kind: 'flag', val: 1 }] },
      /* 第二十三次修订：补齐缺失维度（能源站 / 主城生存 / 训练数量 / 抢点） */
      vanguardP: { school: 'balance', name: '先登', icon: '🚩', desc: '对资源点守军伤害 +{v}%',
                   effects: [{ stat: 'guardDmg', kind: 'pct', vals: [30, 45, 60] }] },
      /* ---- 中和 ---- */
      pioneer:   { school: 'balance', name: '开疆', icon: '🛤️', desc: '道路牌 -1⚡ / 铺路 +{v} 格',
                   effects: [{ stat: 'roadCost', kind: 'add', vals: [-1, -1, -1] },
                             { stat: 'roadTiles', kind: 'add', vals: [0, 1, 1] }] },
      thrift:    { school: 'balance', name: '节流', icon: '🎴', desc: '开牌费 -{v}⚡',
                   effects: [{ stat: 'openCost', kind: 'add', vals: [-1, -2, -3] }] },
      workshop:  { school: 'balance', name: '卡坊', icon: '🎴', desc: '卡坊产卡间隔 -{v}%',
                   effects: [{ stat: 'cardEvery', kind: 'pct', vals: [-15, -24, -35] }] },
      reaping:   { school: 'balance', name: '抢收', icon: '🌟', desc: '资源点产出 +{v}%',
                   effects: [{ stat: 'resourceYield', kind: 'pct', vals: [15, 24, 35] }] },
      garrison:  { school: 'balance', name: '戍卫', icon: '🗼', desc: '防御塔杀伤 +{v}',
                   effects: [{ stat: 'towerKill', kind: 'add', vals: [1, 2, 3] }] },
    },
  },

  /* ---------------- §20 事件牌（第二十次修订：全部带代价） ----------------
   * 触发：**从第 3 分钟起每 180 秒一次**。每次只给 **1 张**，只能「领取」或「刷新」。
   * 刷新：最多 refreshCap 次，每次 refreshCost 能量。必须领取才关闭弹窗。
   * 生效：领取后生效，**到下一张事件牌生效时被顶掉**（同一时刻只有 1 张生效）。
   * 无品质，效果固定；**15 条全部带代价**（7 条正负混合 + 8 条纯负面，没有纯正面）。
   * 效果与政策/遗物共用同一套 stat 聚合。
   */
  events: {
    startAt: 180,        // 第一次触发时刻（秒）
    interval: 180,       // 之后每 180 秒一张
    refreshCost: 4,      // 刷新费用（能量）
    refreshCap: 5,       // 每张事件牌最多刷新次数
    list: {
      /* ---- 7 条正负混合 ---- */
      warEconomy: { name: '战时经济', icon: '🏭', kind: 'mix',
                    desc: '农田产出 +35%，每 Tick -3⚡',
                    effects: [{ stat: 'farmYield', kind: 'pct', val: 35 },
                              { stat: 'energyTick', kind: 'add', val: -3 }] },
      mobilize:   { name: '总动员',   icon: '🔥', kind: 'mix',
                    desc: '兵营每次多产 3 兵，防御塔停火',
                    effects: [{ stat: 'trainCount', kind: 'add', val: 3 },
                              { stat: 'towerKill', kind: 'pct', val: -100 }] },
      rampart:    { name: '壁垒',     icon: '🛡️', kind: 'mix',
                    desc: '建筑防御值 +40%，行军速度 -15%',
                    effects: [{ stat: 'buildingHp', kind: 'pct', val: 40 },
                              { stat: 'marchSpeed', kind: 'pct', val: -15 }] },
      blitz:      { name: '突袭',     icon: '⚡', kind: 'mix',
                    desc: '行军速度 +25%，建筑防御值 -25%',
                    effects: [{ stat: 'marchSpeed', kind: 'pct', val: 25 },
                              { stat: 'buildingHp', kind: 'pct', val: -25 }] },
      tradeRoute: { name: '商路',     icon: '🐪', kind: 'mix',
                    desc: '每 Tick +4⚡，资源点产出 -20%',
                    effects: [{ stat: 'energyTick', kind: 'add', val: 4 },
                              { stat: 'resourceYield', kind: 'pct', val: -20 }] },
      draft:      { name: '募兵',     icon: '⚔️', kind: 'mix',
                    desc: '兵营训练间隔 -20%，每 Tick -2⚡',
                    effects: [{ stat: 'trainInterval', kind: 'pct', val: -20 },
                              { stat: 'energyTick', kind: 'add', val: -2 }] },
      granaryPush:{ name: '征粮',     icon: '🌾', kind: 'mix',
                    desc: '每 Tick +6🌾，卡坊产卡间隔 +30%',
                    effects: [{ stat: 'foodTick', kind: 'add', val: 6 },
                              { stat: 'cardEvery', kind: 'pct', val: 30 }] },
      /* ---- 8 条纯负面 ---- */
      locust:     { name: '蝗灾',     icon: '🦗', kind: 'bad',
                    cost: { energy: 20, food: 40 },
                    desc: '农田产出 -30%；支付 20⚡+40🌾 可立即化解',
                    effects: [{ stat: 'farmYield', kind: 'pct', val: -30 }] },
      taxBurden:  { name: '苛捐',     icon: '💸', kind: 'bad',
                    cost: { energy: 30, food: 30 },
                    desc: '每 Tick -4⚡；支付 30⚡+30🌾 可立即化解',
                    effects: [{ stat: 'energyTick', kind: 'add', val: -4 }] },
      corvee:     { name: '劳役',     icon: '⛓️', kind: 'bad',
                    desc: '主城升级费 +25%',
                    effects: [{ stat: 'castleUpCost', kind: 'pct', val: 25 }] },
      fog:        { name: '迷雾',     icon: '🌫️', kind: 'bad',
                    cost: { energy: 25, food: 35 },
                    desc: '行军速度 -20%；支付 25⚡+35🌾 可立即化解',
                    effects: [{ stat: 'marchSpeed', kind: 'pct', val: -20 }] },
      stagnation: { name: '停摆',     icon: '🚏', kind: 'bad',
                    cost: { energy: 20, food: 45 },
                    desc: '卡坊产卡间隔 +40%；支付 20⚡+45🌾 可立即化解',
                    effects: [{ stat: 'cardEvery', kind: 'pct', val: 40 }] },
      mutiny:     { name: '兵变',     icon: '😤', kind: 'bad',
                    desc: '兵营训练间隔 +25%',
                    effects: [{ stat: 'trainInterval', kind: 'pct', val: 25 }] },
      winter:     { name: '寒冬',     icon: '❄️', kind: 'mix',
                    desc: '农田产出 -40%，兵营训练间隔 -30%（赶紧把粮食换成军队）',
                    effects: [{ stat: 'farmYield', kind: 'pct', val: -40 },
                              { stat: 'trainInterval', kind: 'pct', val: -30 }] },
      tradeboom:  { name: '商路繁荣', icon: '🛒', kind: 'mix',
                    desc: '卡坊产卡间隔 -30%，资源点产出 -20%（这一阶段疯狂抽卡）',
                    effects: [{ stat: 'cardEvery', kind: 'pct', val: -30 },
                              { stat: 'resourceYield', kind: 'pct', val: -20 }] },
    },
  },

  /* ---------------- §21 星级任务（第二十次修订：遗物的唯一获取途径） ----------------
   * 三星任务链，每星 5 个小任务（每星必含 1 个弃牌任务）；
   * 完成一星 → 遗物三选一（共 3 次，正好对上遗物持有上限 3 件）。
   * 结算加 E 项 = 完成星数 × scorePerStar。
   * ★ 弃牌门槛按实测校准：正常游玩一局弃牌量很大（P90 校三星，目标 20~25 分钟全完成）。
   */
  quests: {
    scorePerStar: 10,
    stars: [
      [   // ⭐ 一星（目标 ~7 分钟完成；弃牌速率实测约 5.5 张/分钟）
        { stat: 'built',       need: 4,   name: '建成 4 座建筑' },
        { stat: 'castleLevel', need: 2,  name: '主城升到 Lv2' },
        { stat: 'discards',    need: 40, name: '累计弃牌 40 张' },
        { stat: 'resources',   need: 1,  name: '控制 1 个资源点' },
        { stat: 'trained',     need: 60, name: '累计训练 60 个士兵' },
      ],
      [   // ⭐⭐ 二星（目标 ~15 分钟完成）
        { stat: 'built',       need: 9,   name: '建成 9 座建筑' },
        { stat: 'castleLevel', need: 3,  name: '主城升到 Lv3' },
        { stat: 'discards',    need: 80, name: '累计弃牌 80 张' },
        { stat: 'captures',    need: 4,  name: '累计占领 4 次资源点' },
        { stat: 'killed',      need: 40, name: '消灭 40 个敌兵' },
      ],
      [   // ⭐⭐⭐ 三星（目标 ~24 分钟完成，校准到弃牌 P50 速率）
        { stat: 'built',       need: 14,  name: '建成 14 座建筑' },
        { stat: 'castleLevel', need: 4,   name: '主城升到 Lv4' },
        { stat: 'discards',    need: 130, name: '累计弃牌 130 张' },
        { stat: 'captures',    need: 8,   name: '累计占领 8 次资源点' },
        { stat: 'killed',      need: 90,  name: '消灭 90 个敌兵' },
      ],
    ],
  },

  /* ---------------- §10.3 开牌 ---------------- */
  shop: {
    openCost: 3,        // 首次开牌费（能量）
    rerollGrowth: 2,    // 重开费递增系数：第 n 次重开 = n × 此值（下限为 openCost）
                        // → 费用序列 1, 1, 2, 3, 4, 5 …（首次便宜，刷多了就痛）
    count: 5,           // 每次翻开的候选卡张数
    minDistinct: 3,     // 5 张里至少包含几种不同的卡（体验保护）
  },

  /* ---------------- 手牌（上限可变：后续会有「扩容」效果牌） ---------------- */
  hand: {
    baseSize: 5,      // 开局手牌格数
    maxSize: 8,       // 手牌格数上限（扩容卡最多加到这个数）
  },

  /* ---------------- §7.1 士兵 ----------------
   * 第二十四次修订：上限随主城等级抬升（双方同一套），给"升本"新增兵力收益
   */
  soldier: {
    maxByLevel: [60, 80, 100, 120, 140],   // 主城 Lv1~Lv5 的士兵上限
    marchSecPerTile: 1.6,    // 行军速度：每走 1 格耗时（秒）
    moveFoodPerTile: 0.6,    // 行军粮耗：每个士兵每走 1 格消耗的粮食
  },

  /* ---------------- §9.3 外围战略建筑 ----------------
  /* ---------------- §5.4 防御值（Phase 4 战争实装） ----------------
   * 量纲与士兵统一为「个」：1 个士兵换 1 点防御值（等量交换，磨血与一次打掉总成本相同）
   * 防御值归零 = 被占领（不是摧毁）；被占领后按降级后等级的满值恢复 → 反复争夺会逐级磨掉建筑
   */
  hp: {
    building: [20, 35, 50],       // 城市建筑 Lv1/2/3
    resourceGuard: 10,            // 中立资源点守军（易手时恢复满值，防反复易手）
  },

  /* ---------------- Phase 4 敌方 AI ----------------
   * 第二批 AI（进攻性深化）：**先集结、后出击**。
   * 诊断证据（test/diag-wave.js）：旧版 AI 兵 ≥6 就出发抢点，平均出发兵 12，
   * 双方小股在中场路网对撞全部同归于尽 —— 1000+ 波零抵达，永远打不穿。
   * 因此改为：散兵先汇聚到最大堆，达标才一次性投入，且同一时刻只开一路。
   */
  enemy: {
    decideInterval: 2.0,          // AI 决策周期（秒）
    roadInterval: 10,             // AI 铺路节奏：每 10 秒最多一格（与经济 Tick 同频）
    // 第二十五次修订：AI 建造摩擦补课（玩家要花开牌费+挑卡，AI 原本直达通道太快）
    buildCooldown: 15,            // AI 每 12 秒最多建一座（校准值：行军耗粮对称修复后回调，脚本胜率约 55%）
    buildOpenCost: 3,             // AI 每建一座额外支付 3⚡（校准值：与 cooldown 15 组合 → 脚本胜率 63%）
    musterMin: 8,                 // 散兵堆 ≥ 此数才出发去集结（更小的原地待命，不单独送菜）
    pushPoint: 20,                // 集结点兵力 ≥ 此值 → 抢资源点
    pushBuilding: 30,             // 集结点兵力 ≥ 此值 → 进攻玩家建筑（削经济 / 清场）
    pushCastle: 75,               // 集结点兵力 ≥ 此值 → 进攻玩家主城（行军耗粮对称后 AI 攒大波再出征）
    corridorMinBuildings: 3,      // 己方建筑 ≥ 此数后，铺路方向转向玩家主城（修进攻走廊）
  },

  /* ---------------- §9.5 邻接加成（保留 2 条） ---------------- */
  adjacency: {
    maxSources: 2,              // 同一建筑最多吃 2 个邻接来源
    barracksAdjFarm: 0.20,      // 兵营 相邻 农田 → 训练间隔 −20% / 块
    towerAdjCastleKill: 0.50,   // 防御塔 相邻 主城 → 杀敌数 +50%
    towerAdjCastleHp: 0.20,     // 防御塔 相邻 主城 → 主城防御值 +20%
    powerAdjAtelier: 0.20,      // 第二十八次修订：能源站 相邻 卡坊 → 产卡间隔 −20% / 块（能源链）
  },

  /* ---------------- §12 结算（第十九次修订：重制为兜底判胜负） ----------------
   * 主城存亡 = 首要结束条件；到 time.limit 仍未分出 → 按本表综合分判胜负。
   * A 主城战果 ×1 + B 资源点 ×3 + C 战场成果 ÷5 ×1 + D 发展水平（主城等级差 ×10） ×1
   * ★ 遵守裁决 4：建筑数量完全不计分（D 用主城等级，不是建筑数）
   */
  scoring: {
    weightCastle: 1,
    weightResource: 3,
    weightBattle: 1,
    weightDev: 1,
    battleDivisor: 5,           // 消灭士兵数 ÷5 换算为得分
    devPerLevel: 10,            // 每级主城差的得分
  },

  /* ---------------- 美术资产（第一阶段：建筑 Lv1 贴图） ----------------
   * enabled=false 时沙盘完全回到 emoji 占位渲染；单个贴图加载失败也会自动降级
   * 贴图来源与处理流水线见 图片素材/美术风格测试/（process_assets.py）
   */
  assets: {
    enabled: true,
    dir: 'assets/buildings/',
    files: {
      farm: 'farm.png',
      atelier: 'atelier.png',
      power: 'power.png',
      barracks: 'barracks.png',
      tower: 'tower.png',
      castle: 'castle.png',
    },
  },

  /* ---------------- 地图视觉（手绘 SLG 战略棋盘） ----------------
   * 视觉层级：① 网格与可建造空间 ② 建筑/道路/资源点/部队 ③ 山水林田等环境美术
   * 底板图负责氛围（已降饱和处理），网格负责玩法 —— 网格常驻可见，但必须是低对比、手绘质感
   */
  mapVisual: {
    enabled: true,
    /**
     * ★ 当前生效底图 = 'vivid'（retex + 饱和度 +18% / 对比度 ×1.05，第三十七次修订）。
     *   画面优化管线：plate-retex（官道旧径）→ vivid_plate.py（饱和度/对比度，参数可调）→ plate-vivid。
     *   布局逐像素同构，地形/资源点/占地数据完全通用。按 9 切回未增饱和的 retex 对比。
     *   KR（王国保卫战）风格化讨论已存档（图片素材/美术风格测试/KR风格对比图.png），
     *   用户拍板：先走 C 路线（保持现状 + 吸收优点），核心功能跑通后再议美术二期。
     */
    activePlate: 'vivid',
    plates: {
      none:   { name: '程序化草地',     src: '',                              bakedGrid: false },
      final:  { name: '终版手绘图(原)', src: 'assets/map/plate-final.png',    bakedGrid: false },
      retex:  { name: '终版·官道变旧径', src: 'assets/map/plate-retex.png',   bakedGrid: false },
      vivid:  { name: '终版·画面优化',   src: 'assets/map/plate-vivid.png',   bakedGrid: false },
      a:      { name: 'A 欧陆棋盘',     src: 'assets/map/plate-a.png',        bakedGrid: true },
      b:      { name: 'B 率土土地',     src: 'assets/map/plate-b.png',        bakedGrid: true },
      c:      { name: 'C 综合版',       src: 'assets/map/plate-c.png',        bakedGrid: true },
      pilot:  { name: 'P 试点(旧)',     src: 'assets/map/plate.png',          bakedGrid: false },
    },
    plateKeys: { 0: 'none', 1: 'final', 2: 'a', 3: 'b', 4: 'c', 5: 'pilot', 9: 'retex', 10: 'vivid' },
    /**
     * 网格（第三十次修订：网格是第三视觉层，普通态必须"看得清但不抢眼"）
     * colorByTerrain：线条按所在格的地形取色 —— 草地暖棕 / 森林暗绿 / 山地灰 / 水面蓝灰，
     *   逐格取色后一条线的颜色会随下方地形自然过渡，与手绘材质融合，避免"黑线盖全图"。
     * 建造模式（持有建筑卡）时整体增强，让玩家看清格子边界与当前占地。
     */
    grid: {
      colorByTerrain: {
        '.': 'rgba(102,84,52,0.17)',   // 平原
        'f': 'rgba(110,88,48,0.17)',   // 农田
        'F': 'rgba(44,66,38,0.20)',    // 森林
        'M': 'rgba(64,62,58,0.21)',    // 山地
        'W': 'rgba(74,116,146,0.23)',  // 水域
      },
      color: 'rgba(102,84,52,0.17)',  // 无地形表时的回退色
      width: 1.0,
      jitter: 0.7,                    // 手绘抖动幅度（像素，hash 确定性，逐帧稳定不闪烁）
      checker: 'rgba(255,250,232,0.028)',  // 极淡棋盘，给格子"空间感"
      checkerAlt: 'rgba(64,48,26,0.028)',
      /** 建造模式增强：网格加亮加粗，但仍不压过建筑与地形 */
      buildWidth: 1.8,
      buildColor: 'rgba(255,240,196,0.30)',
      buildChecker: 'rgba(255,248,220,0.05)',
      buildCheckerAlt: 'rgba(70,52,28,0.05)',
    },
    /**
     * 道路（第三十八次修订：铺路表现 =「开垦官道」，方案 D = A+B 混合）
     * ★ 起因：用户指出"铺路的实际表现应该是开垦原先官道，但画出来还是正方形方格"
     *   ——原因是旧画法是不透明 fillRect 方块盖在底图上，与底图官道纹理毫无关系。
     * 新画法（两条规则，材质与底图官道同色系）：
     *   ① 官道格（CFG.map.officialRoads）→ 贴回 road-reclaim.png 的对应格，
     *      把底图上"长草的旧官道"开垦成清晰官道，与底图严丝合缝（A）。
     *   ② 非官道格 → 圆头带状路 + 混合模式上色（multiply/color/soft-light/lighten），
     *      不用不透明覆盖，底图草纹从路面里透出来，路"长在地里"而不是贴在地上（B）。
     * 素材未加载 / assets 关闭时：所有格子退化为 ②，不会白屏也不会缺路。
     * 桥格一律不画路面 —— 露出底图里已有的木桥。
     */
    road: {
      width: 0.56,                    // 保留：入口小路等旧引用
      fill: '#8a7355', edge: '#6b5840', core: '#9d8466', rut: '#6d5941',
      /** 官道开垦素材（底图同尺寸透明层，只在官道格有像素），生成脚本见
       *  图片素材/美术风格测试/make_road_reclaim.py */
      reclaimSrc: 'assets/map/road-reclaim.png',
      /** 建筑入口小路（与官道同色系，压淡后融进地图） */
      stub: '#b09a68',
      /**
       * 带状路混合栈（参数经无头浏览器像素实验标定：目标色 = 官道素材均值 rgb(166,150,90)，
       * 实测落点 rgb(163,143,91)）。改色请重跑 图片素材/美术风格测试/road-preview.html 对比。
       */
      /**
       * ★ 第四十次修订：用户反馈"铺的路面淡到根本看不清"——实测非官道格
       *   （玩家自己新开的、没有底图素材可贴的那些格）路心 vs 同格草地色差只有
       *   Δ16~21，而官道格有 Δ64~104，两者差了一大截。
       *   经实机像素标定（`test/_calib_road.js` 扫 3 轮）：
       *     · 单纯加深着料/压暗路缘**没用** —— 底图本来就偏土色的格子反而更糊（Δ 反降）；
       *     · **提亮路心**才是对的那一下：Δ 最小 21 → 55、中位 55 → 112。
       *   同时把路面加宽（0.40→0.50）让路更成立。路肩（垂直方向 ±0.42 格）实测 Δ=0，
       *   路面仍是条带、没有退回铺满整格的方块。
       */
      ribbon: {
        edgeWidth: 0.48,              // 路缘压暗宽（让路"陷进地里"）
        width: 0.50,                  // 主路面宽（0.40 → 0.50，路更宽更成立）
        liftWidth: 0.24,              // 提亮层宽
        coreWidth: 0.30,              // 路心被踩亮的一条（0.13 → 0.30）
        edge:  { color: '#6b5840', alpha: 0.11, mode: 'multiply' },
        body:  { color: '#cdb388', alpha: 0.92, mode: 'color' },
        pig:   { color: '#ab9060', alpha: 0.45, mode: 'source-over', width: 0.48 },
        lift:  { color: '#e0cc9c', alpha: 0.30, mode: 'soft-light' },
        core:  { color: '#ecd9ab', alpha: 0.55, mode: 'lighten' },
        pebbles: 6,                   // 每格毛边碎石/草茬点数（破掉干净直边）
        mottle: 4,                    // 每格路面深浅斑驳点数（模仿手绘土路的蚀斑）
        tufts: 3,                     // 每格从路两侧侵入的草茬数（草长回路上）
      },
    },
    /** 地形 Debug 覆盖：默认关闭（调参面板开关 / 按 T 切换）。正式视觉禁止使用。 */
    terrainDebug: false,
    terrainDebugColors: {
      '.': null,                       // 平原不打底（正式视觉就是可建）
      'f': 'rgba(238,196,86,0.26)',    // 农田
      'F': 'rgba(46,150,64,0.30)',     // 森林
      'M': 'rgba(126,126,126,0.32)',   // 山地
      'W': 'rgba(58,138,220,0.34)',    // 水域
    },
    /* 建筑地基（每种的地表材质，让玩家一眼看出"这座占了哪一格"） */
    footprint: {
      farm:     { fill: '#b8a163', edge: '#7d6a34' },
      atelier:  { fill: '#b9b09b', edge: '#7a7361' },
      power:    { fill: '#a9a094', edge: '#736d61' },
      barracks: { fill: '#b09263', edge: '#7a6134' },
      tower:    { fill: '#a7a396', edge: '#6f6b5e' },
      castle:   { fill: '#c0bdaa', edge: '#7c7967' },
    },
    place: {
      veil: 'rgba(46,34,20,0.16)',          // 持有卡牌时全图轻压暗 → 注意力聚焦（不染色）
      okFill: 'rgba(255,242,206,0.30)', okEdge: '#ffe6a0',
      mergeFill: 'rgba(158,232,120,0.26)', mergeEdge: '#a8e078',
      badFill: 'rgba(214,80,60,0.30)', badEdge: '#e06a50',   // 非法落点：警示红（只圈当前占地，不染色全图）
    },
  },

  /* ---------------- 主界面（第四十二次修订；第四十三次修订接入底图） ----------------
   * bg 留空 = 用「实时沙盘 + 均匀蒙版」当背景（零素材）；
   * bg 指定图片时：用「上下双向暗渐变 + 文字区柔光暗斑」压字，比全局压暗更能保住美术。 */
  menu: {
    title: '卡牌建城',
    sub: '轻策略战争 · 1v1 抽卡建城 Demo',
    /* 底图：1536×864 = 标准 16:9，与 1280×720 逻辑分辨率同比例，cover 无额外裁切。
     * 已预先裁掉原图底部（连带右下角水印）。用户选定的「A 原图」。 */
    bg: 'assets/menu/menu-bg.png',
    scrim: 0.72,          // 仅"无底图"时使用：均匀蒙版的浓度
    /* 有底图时的蒙版曲线：每项 = [位置%, 不透明度]
     * 形状 = 上压下压、中段留亮（让河流农田透出来）—— 即用户选定的"档 2"。
     * 整条改这里就能调"底图露出多少"。 */
    scrimStops: [[0, 0.40], [16, 0.22], [34, 0.09], [58, 0.11], [82, 0.30], [100, 0.44]],
    halo: 0.80,           // 文字区柔光暗斑的中心浓度（0 = 关）；只压文字那块，不压美术
    blur: 0,              // 底图模糊（px）
    credit: '策划 / 程序：本人　·　美术：AI 生成（手绘策略绘本风）',
  },

  /* 注：倍速档位写在 js/main.js 的调参面板按钮里（1/2/4），
   * 原 CFG.debug.speedSteps 无人引用 → 死配置已删 */

};
