/* =============================================================
 * game.js —— 游戏状态与规则（纯逻辑，不碰 DOM）
 *
 * Phase 1 范围：开牌 → 建城 → 资源 Tick → 升级
 * 对应《策划案3.1-修订版》§9 经济 / §10 卡牌 / §11 时间
 *
 * 规则要点（务必与策划案一致）：
 *   · 经济 Tick 每 10 秒一次，按 §11.2 的 8 步顺序结算
 *   · 刚建成 / 刚升级 / 刚易主的建筑带 pending 标记，本 Tick 不产出
 *   · 兵营不走 Tick，由实时计时器推进（到点扣粮产兵）
 *   · 邻接加成只算同阵营相邻，同建筑最多吃 2 个来源
 * ============================================================= */
(function (global) {
'use strict';

function def(type) { return CFG.buildings[type]; }

const RES_ICON = { energy: '⚡', food: '🌾' };

/** 效果牌的一句话说明（用于卡面） */
function effectDesc(e) {
  const R = { energy: '⚡', food: '🌾' };
  if (e.type === 'gain') {
    return '立刻 ' + Object.keys(e.gain).map(function (k) {
      return '+' + e.gain[k] + R[k];
    }).join(' ');
  }
  if (e.type === 'slot') return '建筑位上限 +1';
  if (e.type === 'repair') return '拖到己方建筑/主城 → 防御值 +' + e.repair;
  if (e.type === 'burst') return '立刻结算 ' + e.burstMul + ' 次粮食产出';
  if (e.type === 'boost') {
    return '接下来 ' + e.boostTicks + ' 个 Tick 产出 ×' + e.boostMul;
  }
  return '';
}

const Game = {

  state: null,

  /* ==================== 表现层事件队列（第四十三次修订） ====================
   * 「刚刚发生了什么」的纯表现层事件，交给渲染层消费（沙盘画特效、引擎震屏/顿帧）。
   * ⚠️ 故意**不放进 state**：
   *   ① 它是渲染的附属品，不该参与存档、也不该影响任何逻辑断言（selftest 直接用它测不到）；
   *   ② 无头环境里没人消费，所以**必须限长**，否则长跑（simulate 几千局）会无限增长。
   * game.js 仍然保持"纯逻辑、不碰 DOM/渲染"：这里只是往数组里放数据。 */
  fx: [],
  FX_MAX: 64,
  pushFx(o) {
    if (this.fx.length >= this.FX_MAX) this.fx.shift();
    this.fx.push(o);
    return o;
  },

  /* ==================== 初始化 ==================== */

  reset() {
    const S = {
      t: 0,                       // 已过秒数
      tickCount: 0,               // 已结算 Tick 数
      nextTickAt: CFG.time.tick,  // 下一次 Tick 的触发时刻
      paused: false,
      over: false,
      speed: 1,

      res: Object.assign({}, CFG.resource.initial),
      lastGain: { energy: 0, food: 0 },

      city: [],
      outer: [],
      hand: new Array(CFG.hand.baseSize).fill(null),   // 每项形如 { key }；长度可在局内扩容

      troops: {},          // 地图上的部队："gx,gy" → { p1: n, p2: n }（只存非零格）
      march: [],           // 正在行军的部队：[{ side, n, path, idx, t }]
      resourceOwner: {},   // 资源点归属："gx,gy" → 'p1' | 'p2'
      sel: null,           // 当前选中的格子 { gx, gy }
      shop: null,                                  // { cards: [key|null, ...] }

      castle: { gx: 0, gy: 0 },   // 主城所在地图格（2×2 占地的锚点格；迁城已取消）
      buildings: {},              // 地图上的建筑："gx,gy" → { gx,gy,type,level,owner,pending,trainT,hp }

      castleHp: 0,                // 我方主城当前防御值（归零 = 判负）
      enemyCastle: null,          // 敌方主城 { gx, gy, hp, maxHp }（打掉 = 胜利）
      resGuard: {},               // 中立资源点守军："gx,gy" → 剩余守军（清空才可占领）
      roads: {},                  // 道路："gx,gy" → { side: 'p1'|'p2' }（军队只能沿己方道路行军）
      result: null,               // 'win' | 'lose' | null
      relics: [],                 // 遗物（弃牌奖励：永久 buff，键见 CFG.relics）
      discardCount: 0,            // 弃牌计数（星级任务的弃牌任务用）
      pendingReward: false,       // （已废弃，保留字段避免旧存档/测试引用报错；由 questClaiming 接管）

      castleLevel: 1,      // 主城等级：决定建筑等级上限、每种数量上限、防御塔门槛、效果牌解锁
      extraPerType: 0,     // 「扩建」效果牌带来的每种建筑数量上限加成
      boost: null,         // { mul, ticksLeft } —— 催收令 / 总动员
      rerolls: 0,          // 本局已重开次数（决定开牌费递增）

      stats: {
        opened: 0, bought: 0, built: 0, upgraded: 0, merged: 0,
        demolished: 0, trained: 0, effects: 0, castleUp: 0,
      },
      log: [],
    };

    // 主城落在己方出生点；建筑由玩家在空地上自由生长（第九次修订：取消固定城市区）
    S.castle = { gx: CFG.map.spawn.p1.gx, gy: CFG.map.spawn.p1.gy };
    S.castleHp = CFG.castle.levels[0].hp;
    S.castleHpMaxSeen = CFG.castle.levels[0].hp;
    // 敌方主城：Phase 4 的进攻目标（敌方没有建筑与经济，只有主城与部队）
    const ep = CFG.map.spawn.p2;
    S.enemyCastle = {
      gx: ep.gx, gy: ep.gy, level: 1,
      hp: CFG.castle.levels[0].hp, maxHp: CFG.castle.levels[0].hp,
    };
    // 敌方经济（与玩家同一套：初始资源相同、建筑产出相同、兵营耗粮相同）
    S.enemyRes = { energy: CFG.resource.initial.energy, food: CFG.resource.initial.food };
    S.enemyLevel = 1;
    S.enemyDecideT = 0;
    S.buildings = {};
    S.occ = {};                 // 占地索引："gx,gy" → 建筑 anchor key（由 reindex() 重建）
    S.resGuard = {};
    // 中立资源点自带守军，清空才能占领
    CFG.map.resources.forEach(function (r) { S.resGuard[r.gx + ',' + r.gy] = CFG.hp.resourceGuard; });
    /* 初始官道（第三十次修订）：底图里实际画出来的主干道，开局就是路网的一部分 */
    (CFG.map.initialRoads || []).forEach(function (r) {
      S.roads[r.gx + ',' + r.gy] = { side: 'p1', preset: true };
    });
    S.result = null;

    /* §19 政策：双方各有一套（school = 流派，slots = 生效中的政策，offer = 待选的三选一） */
    S.policy = {
      p1: { school: 'farm', slots: [], offer: null, refreshes: 0 },   // 玩家开局默认种田流
      p2: { school: 'war',  slots: [], offer: null, refreshes: 0 },   // AI 固定战争流（进攻型）
    };
    /* §20 事件牌：单张轮换 —— current = 生效中，offer = 待领取（只能领取或刷新） */
    S.events = {
      p1: { current: null, offer: null, refreshes: 0 },
      p2: { current: null, offer: null, refreshes: 0 },
    };
    S.nextEventAt = CFG.events.startAt;   // 第一次事件牌在第 startAt 秒
    /* §21 星级任务：questStar = 已完成星数（0~3），questClaiming = 待领遗物 */
    S.questStar = 0;
    S.questClaiming = false;
    S.stats.killed = 0;        // 我方累计消灭的敌兵
    S.stats.lost = 0;          // 我方累计损失的士兵（兜底计分用）

    this.state = S;
    // 开局立刻给一次政策三选一（事件牌要从第 3 分钟才开始）
    if (CFG.policy.startPick) this.offerPolicy('p1');
    return S;
  },

  /* ==================== 查询工具 ==================== */

  tileKeyOf(gx, gy) { return gx + ',' + gy; },

  /* ---------------- 占地（第三十次修订：主城/兵营 2×2，其余 1×1） ----------------
   * 建筑的 gx,gy = **占地左上角（anchor）**，不是中心。
   * 2×2 建筑在 S.buildings 里只存一条（anchor），但它覆盖的 4 格全部登记进 S.occ 索引，
   * 因此 buildingAt(任一覆盖格) 都能拿到同一个真实对象引用（不再返回副本）。
   */

  /** 建筑类型的逻辑占地 {w,h} */
  footOf(type) {
    if (type === 'castle') return CFG.castle.foot || { w: 2, h: 2 };
    const d = CFG.buildings[type];
    return (d && d.foot) || { w: 1, h: 1 };
  },

  /** 遍历某建筑占地的每一格 */
  eachFootCell(gx, gy, type, fn) {
    const f = this.footOf(type);
    for (let dy = 0; dy < f.h; dy++) {
      for (let dx = 0; dx < f.w; dx++) fn(gx + dx, gy + dy, dx, dy);
    }
  },

  /** 占地外圈（四向相邻的那一圈格子），用于「沿路生长」与邻接判定 */
  footRing(gx, gy, type) {
    const f = this.footOf(type);
    const out = [];
    for (let x = gx - 1; x <= gx + f.w; x++) {
      for (let y = gy - 1; y <= gy + f.h; y++) {
        const inside = x >= gx && x < gx + f.w && y >= gy && y < gy + f.h;
        if (inside) continue;
        const dx = x < gx ? gx - x : (x >= gx + f.w ? x - (gx + f.w - 1) : 0);
        const dy = y < gy ? gy - y : (y >= gy + f.h ? y - (gy + f.h - 1) : 0);
        if (dx + dy === 1) out.push([x, y]);
      }
    }
    return out;
  },

  /** 重建占地索引：任何建筑增删改之后都必须调用一次 */
  reindex() {
    const S = this.state;
    S.occ = {};
    const self = this;
    for (const k in S.buildings) {
      const b = S.buildings[k];
      if (!b) continue;
      self.eachFootCell(b.gx, b.gy, b.type, function (x, y) { S.occ[x + ',' + y] = k; });
    }
  },

  /** 该格的建筑（走占地索引，返回真实引用；无则 null） */
  buildingAt(gx, gy) {
    const S = this.state;
    const k = S.occ && S.occ[this.tileKeyOf(gx, gy)];
    return k ? (S.buildings[k] || null) : null;
  },

  /** 该格是否落在某座主城的占地内 */
  inCastleFoot(gx, gy, c) {
    if (!c) return false;
    const f = CFG.castle.foot || { w: 2, h: 2 };
    return gx >= c.gx && gx < c.gx + f.w && gy >= c.gy && gy < c.gy + f.h;
  },

  /** 该格是否被主城占据（主城 2×2 占地） */
  isCastleAt(gx, gy) {
    const S = this.state;
    return this.inCastleFoot(gx, gy, S.castle) || this.inCastleFoot(gx, gy, S.enemyCastle);
  },

  /* ---------------- 地形（第三十次修订：底图地形正式进规则） ---------------- */

  /** 格子的地形字符：. 平原 / f 农田 / F 森林 / M 山地 / W 水域 */
  terrainAt(gx, gy) {
    const T = CFG.map.terrain;
    if (!T || gy < 0 || gy >= CFG.map.rows || gx < 0 || gx >= CFG.map.cols) return '.';
    const row = T[gy];
    return (row && row[gx]) || '.';
  },

  /** 该地形是否可建造（平原/农田可建；森林/山地/水域不可建） */
  isBuildableTerrain(gx, gy) {
    const c = this.terrainAt(gx, gy);
    return c === '.' || c === 'f';
  },

  /** 不可建地形的人话提示（给玩家解释"为什么这里不能建"） */
  terrainBlockName(gx, gy) {
    const c = this.terrainAt(gx, gy);
    if (c === 'W') return '河流/湖泊';
    if (c === 'M') return '山地';
    if (c === 'F') return '森林';
    return null;
  },

  /** 该格是否为空地（无主城、无建筑、在地图内） */
  isEmptyTile(gx, gy) {
    return this.inMap(gx, gy) && !this.buildingAt(gx, gy) && !this.isCastleAt(gx, gy);
  },

  /**
   * 城门规则（方案 C）：主城四邻最多 CFG.castle.gateBuildings 座建筑，
   * 永远留出缺口让道路铺到主城旁——否则主城被建筑围死，进攻方永远打不进来。
   * 返回该格所属主城的四邻建筑数；若该格不在任何主城旁，返回 0。
   */
  castleAdjBuildingCount(gx, gy) {
    const S = this.state;
    const self = this;
    let n = 0;
    [S.castle, S.enemyCastle].forEach(function (c) {
      if (!c) return;
      const ring = self.footRing(c.gx, c.gy, 'castle');
      // 只有落在这座主城外圈上的格子，才受"城门缺口"限制
      if (!ring.some(function (p) { return p[0] === gx && p[1] === gy; })) return;
      ring.forEach(function (p) { if (self.buildingAt(p[0], p[1])) n++; });
    });
    return n;
  },

  /** 可建造格：空地 + 不是道路 + 不是资源点 + 地形可建（森林/山地/水域一律不可建） */
  isBuildableTile(gx, gy) {
    return this.isEmptyTile(gx, gy) && !this.isRoadAt(gx, gy) && !this.resourceAt(gx, gy)
        && this.isBuildableTerrain(gx, gy);
  },

  /** 整块占地是否都可建造（AI 与建造预览用；不含手牌/数量上限等软条件） */
  isBuildableFoot(type, gx, gy) {
    const self = this;
    let ok = true;
    this.eachFootCell(gx, gy, type, function (x, y) {
      if (!ok) return;
      if (!self.inMap(x, y)) { ok = false; return; }
      if (!self.isBuildableTerrain(x, y)) { ok = false; return; }
      if (self.isCastleAt(x, y) || self.buildingAt(x, y)) { ok = false; return; }
      if (self.isRoadAt(x, y) || self.resourceAt(x, y)) { ok = false; return; }
      if (self.castleAdjBuildingCount(x, y) >= CFG.castle.gateBuildings) { ok = false; }
    });
    return ok;
  },

  /** 四向相邻是否已有「主城或己方建筑」——邻接加成的判定基础（建造条件已改用道路） */
  hasNeighborBuilding(gx, gy) {
    const self = this;
    return [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].some(function (p) {
      return self.isCastleAt(p[0], p[1]) || !!self.buildingAt(p[0], p[1]);
    });
  },

  /* ==================== 道路（第十四次修订） ====================
   * · 主城是路网之根（主城格视为己方道路）
   * · 建筑必须与己方道路四向相邻才能建造
   * · 军队只能沿己方道路行军（最后一步可踏上目标格）
   */

  isRoadAt(gx, gy) {
    const r = this.state.roads[this.tileKeyOf(gx, gy)];
    return !!r;
  },

  /**
   * 己方可通行格：己方道路 / 己方建筑 / 双方主城占地。
   * ★ 第三十次修订：主城占地**双方都可通行**（用户拍板）——
   *   己方要回防收兵、敌方要攻城，都必须能站上主城格。
   */
  walkable(gx, gy, side) {
    if (this.isCastleAt(gx, gy)) return true;
    const b = this.buildingAt(gx, gy);
    if (b && (b.owner || 'p1') === side) return true;
    return this.isRoadAt(gx, gy);            // 道路互通：双方都能走任何路
  },

  /** 某方路网（含主城根）的四向邻接判定 */
  roadAdjacent(gx, gy, side) {
    const c = side === 'p1' ? this.state.castle : this.state.enemyCastle;
    const self = this;
    return [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].some(function (p) {
      return self.isRoadAt(p[0], p[1]) || self.inCastleFoot(p[0], p[1], c);
    });
  },

  /** 占地版沿路判定：外圈任意一格是道路，或属于己方主城占地 → 可以建 */
  footRoadAdjacent(gx, gy, type, side) {
    const c = side === 'p1' ? this.state.castle : this.state.enemyCastle;
    const self = this;
    return this.footRing(gx, gy, type).some(function (p) {
      return self.isRoadAt(p[0], p[1]) || self.inCastleFoot(p[0], p[1], c);
    });
  },

  /**
   * 可铺路：空地 + 与己方道路/主城/建筑四向相邻 + **只有水面不能铺**（第三十一次修订）。
   * 山/林可以修路（逢山开路）——否则北桥东岸（森林）接不上、中央能源点（四面环山）
   * 永远无法占领；过河只能走两座现成的木桥（遇水搭桥）。
   */
  canPlaceRoad(gx, gy) {
    if (!this.isEmptyTile(gx, gy)) return false;
    if (this.resourceAt(gx, gy)) return false;
    if (this.isRoadAt(gx, gy)) return false;
    if (this.terrainAt(gx, gy) === 'W') return false;    // 水面不能铺路（桥是唯一过河通道）
    return this.roadAdjacentAny(gx, gy);
  },

  /**
   * 铺路是否**对本方合法** = 普通合法性 + 该格确实在本方路网的连通前沿上。
   * ★ 第四十次修订：AI 一直通过 roadFrontier('p2') 保证"路沿自己路网生长"，
   *   玩家点击却只看 canPlaceRoad()，于是能在**敌方主城旁边隔空铺路**
   *   （实测 canPlaceRoad(25,2)=true，那格紧贴敌方主城）。
   *   玩家路径改用这个，双方规则就对称了。
   */
  canPlaceRoadFor(side, gx, gy) {
    if (!this.canPlaceRoad(gx, gy)) return false;
    const f = this.roadFrontier(side);
    for (let i = 0; i < f.length; i++) {
      if (f[i].gx === gx && f[i].gy === gy) return true;
    }
    return false;
  },

  /**
   * 与己方道路、己方主城（2×2 占地内任意格）、或己方建筑四向相邻。
   * 建筑也算路的种子：否则主城四周被建筑围死时，路永远铺不出去（死锁）。
   * ★ 第三十六次修订：主城判定从"锚点格"改为整个 2×2 占地——
   *   否则贴着自己主城边缘（不贴锚点格）铺不了第一格路，2×2 化后漏改的死角。
   * ⚠️ 这里的主城判定**故意不限阵营**（isCastleAt = 己方+敌方）。
   *   第四十次修订试过改成只认己方，结果敌方 AI 铺路前沿直接归 0 —— 道路数据是
   *   **双方共用一套** state.roads（设计上"最后一段走玩家自己的路，道路互通"），
   *   敌方 AI 起步就得挨着自己的主城铺。真正的不对称不在这里：AI 铺路走
   *   roadFrontier('p2') 前沿限制，而玩家点击铺路**根本没有前沿限制**，
   *   于是能在敌方主城旁隔空铺路。修法见 canPlaceRoadFor()。
   */
  roadAdjacentAny(gx, gy) {
    const self = this;
    return [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].some(function (p) {
      if (self.isRoadAt(p[0], p[1])) return true;
      if (self.buildingAt(p[0], p[1])) return true;
      return self.isCastleAt(p[0], p[1]);
    });
  },

  placeRoad(gx, gy) {
    if (!this.canPlaceRoad(gx, gy)) return false;
    this.state.roads[this.tileKeyOf(gx, gy)] = { tier: 1 };
    return true;
  },

  /** 建造条件：与己方道路四向相邻（主城格 = 路网之根） */
  hasRoadNeighbor(gx, gy, side) {
    return this.roadAdjacent(gx, gy, side);
  },

  /** 建筑是否「贴着」某类建筑（邻接加成用，与建造无关） */
  adjacencyCount(gx, gy, wantType) { return this.adjCount(gx, gy, wantType); },

  /** 己方全部建筑 [{ gx, gy, type, level, pending }] */
  /**
   * 己方全部建筑。
   * ⚠️ 必须返回 state.buildings 里的**真实对象引用**（建筑自带 gx/gy）——
   * 返回副本会让 upgrade/merge/demolish 改到副本上，真实数据不变，
   * 后果是「同一座建筑可以被无限升级」且只扣一次成本。
   */
  myBuildings() {
    const B = this.state.buildings;
    const out = [];
    for (const k in B) {
      const b = B[k];
      if (b.owner && b.owner !== 'p1') continue;
      if (b.gx === undefined || b.gy === undefined) {
        const p = k.split(',');
        b.gx = +p[0]; b.gy = +p[1];
      }
      out.push(b);
    }
    return out;
  },

  /** 敌方占领的建筑（Phase 4：建筑可易手） */
  enemyBuildings() {
    const B = this.state.buildings;
    const out = [];
    for (const k in B) if (B[k].owner === 'p2') out.push(B[k]);
    return out;
  },

  /** 某格建筑的归属（'p1' | 'p2' | null） */
  ownerAt(gx, gy) {
    const b = this.buildingAt(gx, gy);
    return b ? (b.owner || 'p1') : null;
  },

  /** 建筑满防御值（随等级）；政策「坚壁」按百分比提高（含 AI，双方对称） */
  buildingMaxHp(level, side) {
    const base = CFG.hp.building[(level || 1) - 1];
    return Math.round(base * this.statMul(side || 'p1', 'buildingHp'));
  },

  /** 我方建筑总数（顶栏口径：不含被敌方占领/敌方建造的） */
  buildingsUsed() { return this.myBuildings().length; },
  /** 我方某类型建筑数量（玩家的"每种上限"口径，不含敌方建筑） */
  typeCount(type) {
    const B = this.state.buildings;
    let n = 0;
    for (const k in B) {
      const b = B[k];
      if (b.type === type && (b.owner || 'p1') === 'p1') n++;
    }
    return n;
  },
  /** 该类型在当前主城等级下的数量上限 */
  typeCap(type) {
    const lv = this.state.castleLevel;
    const base = CFG.castle.levels[lv - 1].perTypeCap || 3;
    return base + this.state.extraPerType;
  },

  /* ==================== 卡牌总表（§10） ==================== */

  /** 统一的卡牌信息：建筑卡读 buildings，效果牌读 cards.effects */
  cardInfo(key) {
    if (!key) return null;
    const b = CFG.buildings[key];
    if (b) {
      return {
        key: key, kind: 'building', name: b.name, icon: b.icon,
        price: b.price, castleReq: b.castleReq || 1, desc: b.desc,
      };
    }
    const e = CFG.cards.effects[key];
    if (e) {
      return {
        key: key, kind: 'effect', name: e.name, icon: e.icon,
        price: e.price, castleReq: e.castleReq || 1,
        eff: e.type, gain: e.gain, burstMul: e.burstMul,
        boostMul: e.boostMul, boostTicks: e.boostTicks,
        desc: effectDesc(e),
      };
    }
    const r = CFG.cards.roads[key];
    if (r) {
      // 政策「工程学」/「开疆」：道路牌价格与格数动态化（下限 1⚡ / 1 格）
      const price = Math.max(1, r.price + this.statAdd('p1', 'roadCost'));
      const tiles = Math.max(1, r.tiles + this.statAdd('p1', 'roadTiles'));
      return {
        key: key, kind: 'road', name: r.name, icon: r.icon,
        price: price, castleReq: r.castleReq || 1,
        tiles: tiles, desc: '铺设 ' + tiles + ' 格道路（军队只能沿己方道路行军）',
      };
    }
    const u = key === 'upgrade' ? CFG.cards.upgrade : null;
    if (u) {
      return {
        key: key, kind: 'upgrade', name: u.name, icon: u.icon,
        price: u.price, castleReq: u.castleReq || 1,
        desc: '任意己方建筑 +1 级（不能超过主城等级允许的上限）',
      };
    }
    return null;
  },

  /** 当前主城等级下可出现的卡（卡池） */
  availableCards() {
    const lv = this.state.castleLevel;
    const out = [];
    CFG.cards.buildings.forEach(function (k) {
      if ((CFG.buildings[k].castleReq || 1) <= lv) out.push(k);
    });
    Object.keys(CFG.cards.roads).forEach(function (k) {
      if (CFG.cards.roads[k].castleReq <= lv) out.push(k);
    });
    if (CFG.cards.upgrade.castleReq <= lv) out.push('upgrade');
    Object.keys(CFG.cards.effects).forEach(function (k) {
      if (CFG.cards.effects[k].castleReq <= lv) out.push(k);
    });
    return out;
  },

  /** 建筑等级上限 = min(主城等级, 建筑自身最高等级) */
  buildingLevelCap() {
    return Math.min(this.state.castleLevel, 3);
  },

  /* ==================== 主城等级（§5.5） ==================== */

  castleUpgradeCost() {
    const lv = this.state.castleLevel;
    if (lv >= CFG.castle.maxLevel) return null;
    const base = CFG.castle.levels[lv - 1].upCost;
    if (!base) return null;
    // 政策「提速」：升级费按百分比下降（取 1 倍率下限保护）
    const mul = this.statMul('p1', 'castleUpCost', 0.5);
    const cost = {};
    for (const k in base) cost[k] = Math.max(1, Math.round(base[k] * mul));
    return cost;
  },

  canUpgradeCastle() {
    const cost = this.castleUpgradeCost();
    return !!cost && this.canAfford(cost);
  },

  upgradeCastle() {
    const cost = this.castleUpgradeCost();
    if (!cost || !this.canAfford(cost)) return false;
    this.pay(cost);
    this.state.castleLevel++;
    this.state.castleHp = this.castleMaxHp();
    this.state.castleHpMaxSeen = this.castleMaxHp();
    this.state.stats.castleUp++;
    this.log('主城升级 → Lv' + this.state.castleLevel +
             '（建筑等级上限 ' + this.buildingLevelCap() +
             '，每种建筑上限 ' + this.typeCap('farm') +
             '，主城防御值 ' + this.castleHp() + '）');
    // §19：每次主城升级额外触发一次政策三选一（抢先升本 = 更早吃到黄金政策）
    if (CFG.policy.onCastleUp) this.offerPolicy('p1');
    return true;
  },

  /* ==================== 资源与成本 ==================== */

  canAfford(cost) {
    const r = this.state.res;
    for (const k in cost) if ((r[k] || 0) < cost[k]) return false;
    return true;
  },

  pay(cost) {
    const r = this.state.res;
    for (const k in cost) r[k] -= cost[k];
  },

  /** 升级成本；已封顶 / 主城等级不够 / 不可升级 → null */
  /* ==================== 邻接加成（§9.5） ==================== */

  /** 目标格四向相邻里，有多少座指定类型的建筑 */
  adjCount(gx, gy, wantType) {
    const self = this;
    return [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].filter(function (p) {
      const b = self.buildingAt(p[0], p[1]);
      return b && b.type === wantType;
    }).length;
  },

  /**
   * 兵营训练间隔倍率（1 = 无加成）。三路加成**相乘**，彼此不打架：
   * ① 邻接农田 −20%/块（最多 2 个来源）② 政策「征兵」③ 遗物「征兵令」（现为 +1 兵，不减间隔）
   */
  barracksIntervalMul(gx, gy, side) {
    const s = side || 'p1';
    const n = Math.min(this.adjCount(gx, gy, 'farm'), CFG.adjacency.maxSources);
    return (1 - n * CFG.adjacency.barracksAdjFarm) * this.statMul(s, 'trainInterval');
  },

  /** 兵营每次产出的额外兵数（遗物「征兵令」+1/件） */
  trainBonus(side) { return this.statAdd(side || 'p1', 'trainCount'); },

  /** 该格（防御塔）是否四向相邻主城 */
  towerAdjCastle(gx, gy) {
    const c = this.state.castle;
    return Math.abs(c.gx - gx) + Math.abs(c.gy - gy) === 1;
  },

  /** 主城当前防御值（受击会下降；上限见 castleMaxHp） */
  castleHp() { return this.state.castleHp; },

  /* ==================== 开牌与买卡（§10.3） ==================== */

  /** 当前这一次开牌要花多少能量
   *  首次开牌 = openCost；第 n 次重开 = n × rerollGrowth（下限 openCost）
   *  费用序列：1, 1, 2, 3, 4, 5 …  —— 首次便宜，狂刷就痛
   */
  openCostNow() {
    const S = this.state;
    const n = S.shop ? S.rerolls + 1 : 0;      // 已经有候选卡 → 这次是重开
    const base = Math.max(CFG.shop.openCost, n * CFG.shop.rerollGrowth);
    return Math.max(1, base + this.statAdd('p1', 'openCost'));   // 政策「节流」
  },

  canOpen() {
    return !this.state.over && this.state.res.energy >= this.openCostNow();
  },

  openShop() {
    const S = this.state;
    if (!this.canOpen()) return false;

    const cost = this.openCostNow();
    if (S.shop) S.rerolls++;                    // 计一次重开
    S.res.energy -= cost;
    S.stats.opened++;

    const pool = this.availableCards();
    const n = CFG.shop.count;
    const k = Math.min(CFG.shop.minDistinct, pool.length, n);

    // 先取 k 张互不相同（翻牌多样性保护，见 §10.3）
    const picked = [];
    while (picked.length < k) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      if (picked.indexOf(t) < 0) picked.push(t);
    }
    // 再随机补满
    while (picked.length < n) picked.push(pool[Math.floor(Math.random() * pool.length)]);
    // 打乱展示顺序
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = picked[i]; picked[i] = picked[j]; picked[j] = tmp;
    }

    const self = this;
    S.shop = { cards: picked };
    this.log('开牌（−' + cost + ' ⚡）：' +
             picked.map(function (t) { return self.cardInfo(t).name; }).join(' / '));
    return true;
  },

  canBuy(i) {
    const S = this.state;
    if (!S.shop || S.shop.cards[i] == null) return false;
    if (S.res.energy < this.cardInfo(S.shop.cards[i]).price) return false;
    if (S.hand.indexOf(null) < 0) return false;      // 手牌满
    return true;
  },

  buyCard(i) {
    const S = this.state;
    if (!this.canBuy(i)) return false;
    const key = S.shop.cards[i];
    const info = this.cardInfo(key);
    S.res.energy -= info.price;
    S.hand[S.hand.indexOf(null)] = { key: key };
    S.shop.cards[i] = null;
    S.stats.bought++;
    this.log('买入 ' + info.name + '（−' + info.price + ' ⚡）');
    return true;
  },

  /* ==================== 建造 / 升级 / 合成 / 拆除 ==================== */

  handIndexOf(key) {
    return this.state.hand.findIndex(function (h) { return h && h.key === key; });
  },

  /** 返回不能在此建造的原因（null = 可以建），供 UI 提示用 */
  /**
   * 返回不能在此建造的原因（null = 可以建）。
   * 第三十次修订：改为**逐格检查整块占地**——2×2 建筑只要有一格压在
   * 森林/山地/河流/道路/资源点/已有建筑/主城上，整座就建不了。
   */
  buildBlockReason(type, gx, gy) {
    const S = this.state;
    const d = def(type);
    if (!d) return '未知建筑';
    const self = this;
    let why = null;
    this.eachFootCell(gx, gy, type, function (x, y) {
      if (why) return;
      if (!self.inMap(x, y)) { why = '建筑占地超出地图边界'; return; }
      const tn = self.terrainBlockName(x, y);
      if (tn) { why = tn + '上不能建造'; return; }
      if (self.isCastleAt(x, y)) { why = '这里属于主城占地'; return; }
      if (self.buildingAt(x, y)) { why = '这里已有建筑'; return; }
      if (self.isRoadAt(x, y)) { why = '道路是给军队走的，不能建筑'; return; }
      if (self.resourceAt(x, y)) { why = '中立资源点不能建筑（派兵占领它）'; return; }
      if (self.castleAdjBuildingCount(x, y) >= CFG.castle.gateBuildings)
        why = '主城旁最多留 ' + CFG.castle.gateBuildings + ' 座建筑（必须留出城门缺口）';
    });
    if (why) return why;
    if ((d.castleReq || 1) > S.castleLevel)
      return d.name + ' 需要主城 Lv' + d.castleReq + ' 才能建造';
    const cap = this.typeCap(type);
    if (this.typeCount(type) >= cap)
      return d.name + ' 已达上限 ' + cap + ' 座（提升主城等级可扩容）';
    if (!this.footRoadAdjacent(gx, gy, type, 'p1')) return '必须修路到这里（建筑要连着你的道路）';
    if (this.handIndexOf(type) < 0) return '手牌里没有 ' + d.name;
    return null;
  },

  canBuildAt(type, gx, gy) {
    return this.buildBlockReason(type, gx, gy) === null;
  },

  /**
   * 「这张卡现在全图都放不下」的原因；还放得下就返回 null。
   * ★ 第四十次修订：以前点建筑卡**无条件**进入放置模式，主城 Lv1 拿防御塔
   *   （castleReq=2）时全图 0 格可建，玩家点哪都只报错、还退不出去 —— 就是那个"卡死"。
   *   现在进入放置模式前先问这一句，放不下就直接说原因，不进模式。
   */
  buildBlockGlobal(type) {
    const d = def(type);
    if (!d) return '未知建筑';
    const S = this.state;
    if ((d.castleReq || 1) > S.castleLevel)
      return d.name + ' 需要主城 Lv' + d.castleReq + ' 才能建造';
    const cap = this.typeCap(type);
    if (this.typeCount(type) >= cap)
      return d.name + ' 已达上限 ' + cap + ' 座';
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        if (this.canBuildAt(type, gx, gy)) return null;
      }
    }
    return '没有可建的空地了（新建筑要贴着己方主城或已有建筑）';
  },

  build(handIdx, gx, gy) {
    const S = this.state;
    const card = S.hand[handIdx];
    if (!card) return false;
    const info = this.cardInfo(card.key);
    if (!info || info.kind !== 'building') return false;            // 只有建筑牌能建造
    if (!this.canBuildAt(card.key, gx, gy)) return false;
    const type = card.key;
    S.buildings[this.tileKeyOf(gx, gy)] = {
      gx: gx, gy: gy, type: type, level: 1, owner: 'p1',
      hp: CFG.hp.building[0], pending: true, trainT: 0,
    };
    this.reindex();                      // 占地索引必须跟着更新
    S.hand[handIdx] = null;
    S.stats.built++;
    this.syncCastleHp();
    this.pushFx({ kind: 'pop', gx: gx, gy: gy, side: 'p1' });   // 落成动画（第四十三次修订）
    this.log('建成 Lv1 ' + def(type).name + '　(' + gx + ',' + gy + ')');
    return true;
  },

  /** 该建筑升级是否被主城等级卡住 */
  upgradeBlockedByCastle(b) {
    if (!b || !b.type || b.level >= 3) return false;
    return b.level >= this.buildingLevelCap();
  },

  /** 是否拥有某件遗物 */
  hasRelic(k) { return this.relicCount(k) > 0; },

  /** 拥有某件遗物的数量（第十九次修订：持有上限 CFG.discard.relicCap，效果为固定值不叠乘） */
  relicCount(k) {
    let n = 0;
    for (const r of this.state.relics) if (r === k) n++;
    return n;
  },

  /* ==================== §19 政策系统（第十九次修订） ====================
   * 政策 = 大额、可切换、流派导向的构筑主轴；遗物 = 小额固定基底。
   * 两者**共用同一套 stat**，统一由 statPct / statAdd 聚合 —— 避免各处硬编码后互相打架。
   */

  /** 某方生效中的政策 [{ key, tier, def }]（tier 0/1/2 = 黄铜/白银/黄金） */
  activePolicies(side) {
    const P = this.state.policy && this.state.policy[side];
    if (!P) return [];
    const out = [];
    P.slots.forEach(function (s) {
      const d = CFG.policy.list[s.key];
      if (d) out.push({ key: s.key, tier: s.tier, def: d });
    });
    return out;
  },

  /** 某方当前生效中的事件牌 def（无则 null；同一时刻最多 1 张，新事件顶掉旧的） */
  activeEvent(side) {
    const E = this.state.events && this.state.events[side];
    return (E && E.current) ? CFG.events.list[E.current] : null;
  },

  /** 政策 + 事件 + 遗物 对某 stat 的百分比聚合（15 = +15%）—— 同类相加，不做乘法叠加 */
  statPct(side, stat) {
    const self = this;
    let sum = 0;
    this.activePolicies(side).forEach(function (p) {
      p.def.effects.forEach(function (e) {
        if (e.stat === stat && e.kind === 'pct') sum += e.vals[p.tier];
      });
    });
    const ev = this.activeEvent(side);
    if (ev) {
      ev.effects.forEach(function (e) {
        if (e.stat === stat && e.kind === 'pct') sum += e.val;
      });
    }
    if (side === 'p1') {
      for (const k in CFG.relics) {
        const r = CFG.relics[k];
        if (r.stat === stat && r.kind === 'pct') sum += r.val * self.relicCount(k);
      }
    }
    return sum;
  },

  /** 政策 + 事件 + 遗物 对某 stat 的固定数值聚合 */
  statAdd(side, stat) {
    const self = this;
    let sum = 0;
    this.activePolicies(side).forEach(function (p) {
      p.def.effects.forEach(function (e) {
        if (e.stat === stat && e.kind === 'add') sum += e.vals[p.tier];
      });
    });
    const ev = this.activeEvent(side);
    if (ev) {
      ev.effects.forEach(function (e) {
        if (e.stat === stat && e.kind === 'add') sum += e.val;
      });
    }
    if (side === 'p1') {
      for (const k in CFG.relics) {
        const r = CFG.relics[k];
        if (r.stat === stat && r.kind === 'add') sum += r.val * self.relicCount(k);
      }
    }
    return sum;
  },

  /** 士兵上限（第二十四次修订：随主城等级 60/80/100/120/140，双方同一套） */
  maxTroops(side) {
    const lv = side === 'p1' ? this.state.castleLevel : (this.state.enemyLevel || 1);
    const base = CFG.soldier.maxByLevel[Math.min(lv, CFG.soldier.maxByLevel.length) - 1];
    return base + this.statAdd(side, 'troopCap');
  },

  /** 百分比 → 倍率（+15% → 1.15），带下限保护（减益类叠过头会变负数） */
  statMul(side, stat, min) {
    return Math.max(min === undefined ? 0.25 : min, 1 + this.statPct(side, stat) / 100);
  },

  /** 政策/事件中的「机制开关」型效果（flag 类）：存在即生效，不参与数值聚合 */
  policyFlag(side, stat) {
    let on = false;
    this.activePolicies(side).forEach(function (p) {
      p.def.effects.forEach(function (e) {
        if (e.stat === stat && e.kind === 'flag') on = true;
      });
    });
    const ev = this.activeEvent(side);
    if (ev) {
      ev.effects.forEach(function (e) {
        if (e.stat === stat && e.kind === 'flag') on = true;
      });
    }
    return on;
  },

  /** 按主城等级掷品质（0 黄铜 / 1 白银 / 2 黄金）—— 品质只与主城等级挂钩，与时间无关 */
  rollTier(side) {
    const lv = side === 'p1' ? this.state.castleLevel : (this.state.enemyLevel || 1);
    const odds = CFG.policy.tierByLevel[lv] || CFG.policy.tierByLevel[1];
    const r = Math.random();
    if (r < odds[2]) return 2;
    if (r < odds[2] + odds[1]) return 1;
    return 0;
  },

  /** 生成一次三选一（本流派为主 + 少量其他流派） */
  rollPolicy(side) {
    const self = this;
    const P = this.state.policy[side];
    const keys = Object.keys(CFG.policy.list);
    const mine = keys.filter(function (k) { return CFG.policy.list[k].school === P.school; });
    const other = keys.filter(function (k) { return CFG.policy.list[k].school !== P.school; });
    const out = [];
    const take = function (pool, n) {
      for (let i = 0; i < n && pool.length; i++) {
        out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
    };
    take(other.slice(), Math.min(CFG.policy.poolOther, CFG.policy.rollCount));
    take(mine.slice(), CFG.policy.rollCount - out.length);
    return out.map(function (k) { return { key: k, tier: self.rollTier(side) }; });
  },

  /** 给某方发一次政策三选一（玩家弹窗，AI 自动选） */
  offerPolicy(side) {
    const P = this.state.policy[side];
    const offer = this.rollPolicy(side);
    if (side === 'p1') { P.offer = offer; return offer; }
    this.aiPickPolicy();
    return offer;
  },

  /** 政策三选一刷新（花能量，每局限 refreshCap 次；只重 roll 三张候选） */
  refreshPolicy(side) {
    const P = this.state.policy[side];
    if (!P.offer) return false;
    if (P.refreshes >= CFG.policy.refreshCap) return false;    // 第二十一次修订：限量
    if (side === 'p1') {
      if (this.state.res.energy < CFG.policy.refreshCost) return false;
      this.state.res.energy -= CFG.policy.refreshCost;
    }
    P.refreshes++;
    P.offer = this.rollPolicy(side);
    return true;
  },

  /** §20 事件预警：距下一张事件牌的进度（0~1）、剩余秒数、是否临期（≤30s） */
  eventProgress() {
    const S = this.state;
    if (!S.nextEventAt) {
      return { pct: 0, remain: CFG.events.startAt, imminent: false };
    }
    const span = S.nextEventAt <= CFG.events.startAt ? CFG.events.startAt : CFG.events.interval;
    const remain = Math.max(0, S.nextEventAt - S.t);
    return {
      pct: Math.min(1, 1 - remain / span),
      remain: Math.ceil(remain),
      imminent: remain <= 30,
    };
  },

  /** 玩家选定第 idx 条政策：已被占用则升品质，否则占槽（槽满替换最早的一条） */
  chooseOffer(idx) {
    const P = this.state.policy.p1;
    if (!P.offer || !P.offer[idx]) return false;
    const o = P.offer[idx];
    const r = this.choosePolicy('p1', o.key, o.tier);
    P.offer = null;
    this.syncHandCap();                    // 「广纳」等影响手牌的政策立即补齐格数
    const d = CFG.policy.list[o.key];
    this.log('颁布政策「' + d.name + '·' + CFG.policy.tierNames[o.tier] + '」');
    return r;
  },

  /** 应用一条政策到槽位，返回 'upgrade' | 'new' | false */
  choosePolicy(side, key, tier) {
    const P = this.state.policy[side];
    if (!CFG.policy.list[key]) return false;
    const hit = P.slots.filter(function (s) { return s.key === key; })[0];
    if (hit) { hit.tier = Math.max(hit.tier, tier); return 'upgrade'; }
    if (P.slots.length >= CFG.policy.slotCap) P.slots.shift();   // 槽满：替换最早的一条
    P.slots.push({ key: key, tier: tier });
    return 'new';
  },

  /** AI 自动选政策：优先补当前最缺的方向（兵少 → 战争，建筑少 → 种田） */
  aiPickPolicy() {
    const P = this.state.policy.p2;
    const offer = this.rollPolicy('p2');
    // 简单打分：己方兵少 → 战争流更值钱；兵已足 → 种田流
    const troops = this.totalTroops('p2');
    const want = troops < 25 ? 'war' : 'farm';
    let best = offer[0], bestScore = -1e9;
    offer.forEach(function (o) {
      const d = CFG.policy.list[o.key];
      let sc = o.tier * 10 + Math.random() * 5;
      if (d.school === want) sc += 20;
      else if (d.school === 'balance') sc += 8;
      if (sc > bestScore) { bestScore = sc; best = o; }
    });
    return this.choosePolicy('p2', best.key, best.tier);
  },

  /* ==================== §20 事件牌（第二十次修订） ====================
   * 从第 3 分钟起每 180 秒一张；只能「领取」或「刷新（≤5 次）」；必须领取才关闭；
   * 领取后生效到下一张事件牌生效时被顶掉（同一时刻只有 1 张）。
   */

  /**
   * §4 物流点（第二十八次修订）：每个已占领物流点，每 24 秒为该方免费铺 1 格道路。
   * 铺设方向：沿己方前沿，选离「最近的未占领资源点或敌方主城」最近的格子。双方同一套规则。
   */
  logisticsRoadTick(dt) {
    const S = this.state;
    if (S.over || !S.policy) return;
    const self = this;
    ['p1', 'p2'].forEach(function (side) {
      let cnt = 0;
      for (const k in S.resourceOwner) {
        if (S.resourceOwner[k] !== side) continue;
        const pp = k.split(',');
        const rr = self.resourceAt(+pp[0], +pp[1]);
        if (rr && rr.res === 'logistics') cnt++;
      }
      if (!cnt) return;
      const key = 'logRoadT_' + side;
      S[key] = (S[key] || 0) + dt * cnt;
      if (S[key] < CFG.map.logisticsRoadSec) return;
      S[key] = 0;
      const foeHome = side === 'p1' ? S.enemyCastle : S.castle;
      const targets = CFG.map.resources.filter(function (r) {
        return S.resourceOwner[r.gx + ',' + r.gy] !== side;
      }).map(function (r) { return { gx: r.gx, gy: r.gy }; });
      targets.push({ gx: foeHome.gx, gy: foeHome.gy });
      let best = null, bestD = 1e9;
      self.roadFrontier(side).forEach(function (c) {
        // 官道偏好：同距离下优先沿旧官道开垦（第三十五次修订）
        const d = Math.min.apply(null, targets.map(function (t) {
          return Math.abs(c.gx - t.gx) + Math.abs(c.gy - t.gy);
        })) - (self.isOfficialRoad(c.gx, c.gy) ? 0.5 : 0);
        if (d < bestD) { bestD = d; best = c; }
      });
      if (best && self.placeRoad(best.gx, best.gy)) {
        if (side === 'p1') self.log('物流点：自动铺设道路 1 格（' + best.gx + ',' + best.gy + '）');
      }
    });
  },

  /** 事件牌周期检查（每帧调用）：双方同一套节奏，AI 在 offerEvent 内自动领取 */
  eventTick() {
    const S = this.state;
    if (S.over || !S.events) return;
    if (S.t >= S.nextEventAt) {
      // 一次性补齐到当前时刻（高倍速下可能跳过多个周期），但只给最后一张
      S.nextEventAt = Math.max(S.nextEventAt + CFG.events.interval, Math.floor(S.t) + 1);
      this.offerEvent('p1');
      this.offerEvent('p2');   // ★ 双方对称：AI 同样每 3 分钟吃一张事件（自动领取）
    }
  },

  /** 发一张事件牌（玩家挂 offer 待领取；AI 直接自动领取最划算的一张） */
  offerEvent(side) {
    const E = this.state.events[side];
    E.offer = this.rollEventKey();
    E.refreshes = 0;
    if (side !== 'p1') this.claimEvent(side);
    return E.offer;
  },

  rollEventKey() {
    const keys = Object.keys(CFG.events.list);
    return keys[Math.floor(Math.random() * keys.length)];
  },

  /** 领取当前事件牌 → 生效（顶掉旧的） */
  claimEvent(side) {
    const E = this.state.events[side];
    if (!E.offer) return false;
    const old = E.current;
    E.current = E.offer;
    E.offer = null;
    E.refreshes = 0;
    if (side === 'p1') {
      const d = CFG.events.list[E.current];
      this.log('事件「' + d.name + '」生效：' + d.desc + (old ? '（顶掉「' + CFG.events.list[old].name + '」）' : ''));
    }
    return true;
  },

  /** 刷新当前待领取的事件牌（花能量，最多 refreshCap 次） */
  refreshEvent(side) {
    const E = this.state.events[side];
    if (!E.offer) return false;
    if (E.refreshes >= CFG.events.refreshCap) return false;
    if (side === 'p1') {
      if (this.state.res.energy < CFG.events.refreshCost) return false;
      this.state.res.energy -= CFG.events.refreshCost;
    }
    E.refreshes++;
    const keys = Object.keys(CFG.events.list);
    let k = E.offer;
    while (k === E.offer && keys.length > 1) k = keys[Math.floor(Math.random() * keys.length)];
    E.offer = k;
    return true;
  },

  /* ==================== §21 星级任务（遗物的唯一获取途径） ==================== */

  /** 任务指标的当前值 */
  questValue(stat) {
    const S = this.state;
    switch (stat) {
      case 'built': return S.stats.built || 0;
      case 'castleLevel': return S.castleLevel;
      case 'discards': return S.discardCount || 0;
      case 'captures': return S.stats.resourceCaptures || 0;
      case 'resources': {
        let n = 0;
        for (const k in S.resourceOwner) if (S.resourceOwner[k] === 'p1') n++;
        return n;
      }
      case 'trained': return S.stats.trained || 0;
      case 'killed': return S.stats.killed || 0;
      default: return 0;
    }
  },

  /** 检查当前星任务是否全部达标（每帧调用；达标 → 待领遗物） */
  checkQuests() {
    const S = this.state;
    const self = this;
    if (S.over || S.questClaiming || S.questStar >= CFG.quests.stars.length) return false;
    const star = CFG.quests.stars[S.questStar];
    const allDone = star.every(function (q) { return self.questValue(q.stat) >= q.need; });
    if (!allDone) return false;
    S.questClaiming = true;      // 弹遗物三选一；领取后 questStar++
    this.log('⭐ 完成第 ' + (S.questStar + 1) + ' 星任务！可领取遗物');
    return true;
  },

  /** 领取任务奖励（遗物三选一中的一件） */
  pickQuestReward(key) {
    const S = this.state;
    if (!S.questClaiming || !CFG.relics[key]) return false;
    S.relics.push(key);
    S.questClaiming = false;
    S.questStar++;
    this.log('任务奖励：获得遗物「' + CFG.relics[key].name + '」（' + CFG.relics[key].desc + '）');
    return true;
  },

  /** 行军速度（秒/格）：政策「急行军」+ 遗物「行军旗」 */
  marchSpeed(side) {
    const base = CFG.soldier.marchSecPerTile;
    return base / this.statMul(side, 'marchSpeed');
  },

  /** 用「修缮牌」恢复己方建筑/主城防御值（拖拽目标式） */
  repairWithCard(gx, gy) {
    const S = this.state;
    const i = this.handIndexOf('repair');
    if (i < 0) return { ok: false, reason: 'nocard' };
    // 遗物「军械架」：修缮量 +50%（40 → 60）
    const amt = Math.round(CFG.cards.effects.repair.repair * this.statMul('p1', 'repairBonus'));
    if (this.isCastleAt(gx, gy)) {
      if (S.castleHp >= this.castleMaxHp()) return { ok: false, reason: 'full' };
      S.hand[i] = null;
      S.castleHp = Math.min(this.castleMaxHp(), S.castleHp + amt);
      this.log('修缮主城 → 防御值 ' + S.castleHp);
      return { ok: true };
    }
    const b = this.buildingAt(gx, gy);
    if (!b || (b.owner || 'p1') !== 'p1') return { ok: false, reason: 'nob' };
    const max = this.buildingMaxHp(b.level);
    if (b.hp >= max) return { ok: false, reason: 'full' };
    S.hand[i] = null;
    b.hp = Math.min(max, b.hp + amt);
    this.log('修缮 ' + def(b.type).name + ' → 防御值 ' + b.hp);
    return { ok: true };
  },

  /** 是否手中有「升级牌」 */
  hasUpgradeCard() { return this.handIndexOf('upgrade') >= 0; },

  /** 用手牌中的「升级牌」升级一座己方建筑（第十四次修订：升级改由卡牌驱动） */
  upgradeWithCard(gx, gy) {
    const b = this.buildingAt(gx, gy);
    if (!b) return { ok: false, reason: 'nob' };
    if (b.level >= 3) return { ok: false, reason: 'max' };
    if (b.level >= this.buildingLevelCap()) return { ok: false, reason: 'castle' };
    const i = this.handIndexOf('upgrade');
    if (i < 0) return { ok: false, reason: 'nocard' };
    this.state.hand[i] = null;
    b.level++;
    b.pending = true;
    this.state.stats.upgraded++;
    this.pushFx({ kind: 'pop', gx: b.gx, gy: b.gy, side: 'p1', levelUp: true });
    this.log('升级牌：' + def(b.type).name + ' → Lv' + b.level);
    return { ok: true };
  },

  /** 合成：把一张同类建筑卡拖到已有同类建筑上 → 免掉一张「升级牌」，直接升一级 */
  canMerge(handIdx, gx, gy) {
    const card = this.state.hand[handIdx];
    const b = this.buildingAt(gx, gy);
    if (!card || !b) return false;
    if (card.key !== b.type) return false;
    if (b.level >= 3) return false;
    if (b.level >= this.buildingLevelCap()) return false;   // 主城等级不够
    return true;
  },

  merge(handIdx, gx, gy) {
    if (!this.canMerge(handIdx, gx, gy)) return false;
    const b = this.buildingAt(gx, gy);
    this.state.hand[handIdx] = null;
    b.level++;
    b.pending = true;
    this.state.stats.merged++;
    this.pushFx({ kind: 'pop', gx: b.gx, gy: b.gy, side: 'p1', levelUp: true, merge: true });
    this.log('合成：' + def(b.type).name + ' → Lv' + b.level + '（免一张升级牌）');
    return true;
  },

  demolish(gx, gy) {
    const b = this.buildingAt(gx, gy);
    if (!b) return false;
    this.log('拆除 ' + def(b.type).name + '（第十四次修订：拆除免费，只腾格子）');
    // ★ 按 anchor 删除：点 2×2 建筑的任一格都能拆掉整座
    delete this.state.buildings[this.tileKeyOf(b.gx, b.gy)];
    this.reindex();
    this.syncCastleHp();
    this.state.stats.demolished++;
    return true;
  },

  /* -------- 迁城：第十四次修订后取消（扩张方式 = 修路） -------- */

  discard(handIdx) {
    if (this.state.hand[handIdx] == null) return false;
    this.state.hand[handIdx] = null;
    this.state.discardCount++;        // 第二十次修订：弃牌只作任务进度（不再直接触发遗物）
    return true;
  },

  /** §20 事件化解（第二十三次修订：弃牌化解 → 一次性资源支付，费用要有真实负担） */
  payDissolve(side) {
    const S = this.state;
    const E = S.events && S.events[side];
    if (!E || !E.current) return false;
    const d = CFG.events.list[E.current];
    if (!d.cost) return false;
    if (side === 'p1') {
      if (S.res.energy < d.cost.energy || S.res.food < d.cost.food) return false;
      S.res.energy -= d.cost.energy;
      S.res.food -= d.cost.food;
      this.log('支付 ' + d.cost.energy + '⚡+' + d.cost.food + '🌾：「' + d.name + '」已化解');
    }
    E.current = null;
    return true;
  },

  /* ==================== 部队与行军（Phase 3b） ==================== */

  tileKey(gx, gy) { return gx + ',' + gy; },

  /** 该格的双方兵力，形如 { p1: n, p2: n }（无部队时全 0） */
  troopsAt(gx, gy) {
    const t = this.state.troops[this.tileKey(gx, gy)];
    return t ? { p1: t.p1 || 0, p2: t.p2 || 0 } : { p1: 0, p2: 0 };
  },

  setTroops(gx, gy, side, n) {
    const key = this.tileKey(gx, gy);
    const S = this.state;
    if (!S.troops[key]) S.troops[key] = { p1: 0, p2: 0 };
    S.troops[key][side] = Math.max(0, n);
    if (S.troops[key].p1 === 0 && S.troops[key].p2 === 0) delete S.troops[key];
  },

  addTroops(gx, gy, side, n) {
    const cur = this.troopsAt(gx, gy)[side];
    this.setTroops(gx, gy, side, cur + n);
  },

  /** 某方在场总兵力（只算站在格子上的） */
  totalTroops(side) {
    const T = this.state.troops;
    let sum = 0;
    for (const k in T) sum += (T[k][side] || 0);
    return sum;
  },

  /**
   * 尚未落地的在途兵力：刚下令、还没走完第一格的部队。
   * 它们暂时不在任何格子上（派出时已清空原格，要等 1.6 秒后才落到下一格）。
   */
  inAirTroops(side) {
    let sum = 0;
    this.state.march.forEach(function (m) {
      if (m.side === side && m.idx === 0) sum += (m.n || 0);
    });
    return sum;
  },

  /**
   * ★ 真实总兵力 = 场上 + 空中。上限必须用这个口径，两个反例都踩过：
   *   ① 只算场上：部队一派出就从账上消失 → 兵营立刻补产 → 落地后总数冲到 80（上限 60）
   *   ② 场上 + 全部 march.n：行军部队每走一格就落在格子上，再加一遍就是双计
   *   正确口径只有「场上 + 还没落地的那一段」。
   */
  activeTroops(side) { return this.totalTroops(side) + this.inAirTroops(side); },

  /** 全部有兵的格子：[{ gx, gy, p1, p2 }] */
  troopTiles() {
    const T = this.state.troops;
    const out = [];
    for (const k in T) {
      const p = k.split(',');
      out.push({ gx: +p[0], gy: +p[1], p1: T[k].p1 || 0, p2: T[k].p2 || 0 });
    }
    return out;
  },

  /* -------- 选中 / 目标 / 寻路 / 行军 -------- */

  selectTile(gx, gy) {
    this.state.sel = (gx === null || gx === undefined) ? null : { gx: gx, gy: gy };
    return true;
  },

  inMap(gx, gy) {
    return gx >= 0 && gy >= 0 && gx < CFG.map.cols && gy < CFG.map.rows;
  },

  isAdjacent(ax, ay, bx, by) {
    const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
    if (dx === 0 && dy === 0) return false;
    if (CFG.map.moveDirs === 8) return dx <= 1 && dy <= 1;
    return dx + dy === 1;
  },

  /** 敌方主城位置（Phase 4 前只是一个空壳标记） */
  enemyCastle() { return { gx: CFG.map.spawn.p2.gx, gy: CFG.map.spawn.p2.gy }; },

  /** 该格是不是「具体建筑」——部队只能朝这些格子派（不能朝草地空地派） */
  isTargetTile(gx, gy) {
    if (!this.inMap(gx, gy)) return false;
    if (this.resourceAt(gx, gy)) return true;
    if (this.buildingAt(gx, gy)) return true;                 // 我方已建成的建筑
    if (this.isRoadAt(gx, gy)) return true;                  // 道路（可集结/行军途经）
    if (this.isCastleAt(gx, gy)) return true;                 // 我方主城
    const e = this.enemyCastle();
    if (e.gx === gx && e.gy === gy) return true;              // 敌方主城
    return false;
  },

  /** 全部可派兵的目标格（UI 高亮用） */
  targetTiles() {
    const out = [];
    CFG.map.resources.forEach(function (r) { out.push({ gx: r.gx, gy: r.gy }); });
    this.myBuildings().forEach(function (b) { out.push({ gx: b.gx, gy: b.gy }); });
    this.enemyBuildings().forEach(function (b) { out.push({ gx: b.gx, gy: b.gy }); });
    out.push({ gx: this.state.castle.gx, gy: this.state.castle.gy });
    out.push(this.enemyCastle());
    return out;
  },

  /**
   * 道路行军寻路（第十四次修订）：**只能沿己方可通行格走**（己方道路/主城/建筑）。
   * 目标格若不可通行（资源点/敌方建筑/敌方主城），必须与某个己方可通行格四向相邻——
   * 路径 = 依次走可通行格，最后一步踏上目标。
   * 返回含起点的路径数组；找不到返回 null。
   */
  findPath(ax, ay, bx, by, side) {
    if (ax === bx && ay === by) return null;
    const W = CFG.map.cols, H = CFG.map.rows;
    const self = this;
    // 政策「野战行军」：可离开道路走草地（空地），但行军耗粮 ×2（见 moveFoodCost）
    const offroad = this.policyFlag(side, 'offroadMarch');
    const walk = function (x, y) {
      if (self.walkable(x, y, side)) return true;
      return offroad && self.isEmptyTile(x, y);
    };
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const key = function (x, y) { return x + ',' + y; };
    const targetWalkable = walk(bx, by);
    const prev = {}, seen = {};
    const q = [[ax, ay]];
    seen[key(ax, ay)] = 1;
    let hit = null;
    while (q.length && !hit) {
      const cur = q.shift();
      if ((targetWalkable && cur[0] === bx && cur[1] === by) ||
          (!targetWalkable && Math.abs(cur[0] - bx) + Math.abs(cur[1] - by) === 1)) {
        hit = cur;
        break;
      }
      for (let i = 0; i < D.length; i++) {
        const nx = cur[0] + D[i][0], ny = cur[1] + D[i][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const k = key(nx, ny);
        if (seen[k]) continue;
        if (!walk(nx, ny)) continue;
        seen[k] = 1; prev[k] = key(cur[0], cur[1]);
        q.push([nx, ny]);
      }
    }
    if (!hit) return null;
    const path = [];
    let k = key(hit[0], hit[1]);
    while (k) {
      const p = k.split(',');
      path.unshift({ gx: +p[0], gy: +p[1] });
      k = prev[k];
    }
    if (!targetWalkable) path.push({ gx: bx, gy: by });   // 最后一步踏上目标
    return path;
  },

  /** n 个兵走 1 格要多少粮 */
  moveFoodCost(n, side) {
    const s = side || 'p1';
    let cost = n * CFG.soldier.moveFoodPerTile * this.statMul(s, 'marchFood');
    if (this.policyFlag(s, 'offroadMarch')) cost *= 2;   // 政策「野战行军」：走草地的自由以双倍粮耗为代价
    return Math.ceil(cost);
  },

  /**
   * 给选中部队下达移动指令（点选式入口，内部转发到 orderMoveFrom）
   */
  orderMove(gx, gy) {
    const sel = this.state.sel;
    if (!sel) return { ok: false, reason: 'nosel' };
    return this.orderMoveFrom(sel.gx, sel.gy, gx, gy);
  },

  /**
   * 从指定格派兵到目标建筑格（拖拽式入口）。
   * 返回 { ok, reason?, path?, n?, cost?, legs? }
   *   reason: notroop / same / air（目标是空地）/ nopath / nofood
   */
  orderMoveFrom(ax, ay, gx, gy) {
    const S = this.state;
    // 该格上若停着行军中的部队 → 先让它落地，再对这支部队重新下令
    // （否则原行军条目仍认为兵在自己手里，下一格会再搬一次 → 同一批兵被复制）
    this.flushMarchAt(ax, ay, 'p1');
    const n = this.troopsAt(ax, ay).p1;
    if (n <= 0) return { ok: false, reason: 'notroop' };
    if (ax === gx && ay === gy) return { ok: false, reason: 'same' };
    if (!this.isTargetTile(gx, gy)) return { ok: false, reason: 'air' };
    const path = this.findPath(ax, ay, gx, gy, 'p1');
    if (!path) return { ok: false, reason: 'nopath' };
    const legs = path.length - 1;
    const cost = this.moveFoodCost(n) * legs;
    const perTile = this.moveFoodCost(n);
    if (S.res.food < perTile) return { ok: false, reason: 'nofood' };
    /* 粮够走几格（向下取整）。第四十三次修订：下单只要求"够走一格"就放行，
     * 走的途中粮尽会停在半路 —— 所以必须把真实可走格数交给 UI，
     * 否则提示写着"预计耗粮 84🌾"、实际只走了 3 格就停，属于提示说谎（踩坑 #16）。 */
    const affordLegs = Math.floor(S.res.food / Math.max(0.0001, perTile));

    S.march.push({ side: 'p1', n: n, path: path, idx: 0, t: 0, spent: 0 });
    S.sel = null;
    this.log('部队出发 → ' + this.tileName(gx, gy) +
             '（' + legs + ' 格，约 ' + Math.round(legs * CFG.soldier.marchSecPerTile) + 's）');
    return { ok: true, path: path, n: n, cost: cost, legs: legs,
             affordLegs: affordLegs, short: affordLegs < legs };
  },

  tileName(gx, gy) {
    const r = this.resourceAt(gx, gy);
    if (r) return r.name;
    const b = this.buildingAt(gx, gy);
    if (b) return def(b.type).name + ' Lv' + b.level;
    if (this.isCastleAt(gx, gy)) return '我方主城';
    const e = this.enemyCastle();
    if (e.gx === gx && e.gy === gy) return '敌方主城';
    return '(' + gx + ',' + gy + ')';
  },

  /** 每秒推进一次行军：到点就走一格；我方扣粮，敌方不扣（简化） */
  updateMarch(dt) {
    const S = this.state;
    for (let i = S.march.length - 1; i >= 0; i--) {
      const m = S.march[i];
      if (!m) continue;
      const secPer = this.marchSpeed(m.side);
      m.t += dt;
      let alive = true;
      while (m.t >= secPer && m.idx < m.path.length - 1) {
        const from = m.path[m.idx], to = m.path[m.idx + 1];

        // 第二十七次修订：行军粮耗对双方结算（修复 AI 行军不耗粮的不对称残留）
        const res = m.side === 'p1' ? S.res : S.enemyRes;
        const cost = this.moveFoodCost(m.n, m.side);
        if (res.food < cost) {
          if (m.side === 'p1') this.log('粮食不足，部队在 ' + this.tileName(from.gx, from.gy) + ' 停止行军');
          alive = false;
          break;
        }
        res.food -= cost;
        m.spent = (m.spent || 0) + cost;

        // 离开 from：只带走「本波」的兵 —— 直接清零会误杀同格的其他部队
        const curFrom = this.troopsAt(from.gx, from.gy)[m.side];
        this.setTroops(from.gx, from.gy, m.side, Math.max(0, curFrom - m.n));
        this.addTroops(to.gx, to.gy, m.side, m.n);
        m.idx++;
        m.t -= secPer;

        // 到达即结算：同格敌兵抵消 → 攻建筑/清守军 → 打主城
        const before = this.troopsAt(to.gx, to.gy)[m.side];
        this.engageTile(to.gx, to.gy, m.side);
        const after = this.troopsAt(to.gx, to.gy)[m.side];
        // ★ 同步本波真实残兵：不同步的话，下一格仍按「出发时的兵力」搬运 → 凭空造兵。
        //   实测（test/diag-wave.js）300 秒内 updateMarch 虚增 8420 兵，士兵上限形同虚设。
        //   同格有多波时损耗会被各波重复扣一次，宁少勿多 —— 绝不能再凭空造兵。
        m.n = Math.max(0, m.n - Math.min(before - after, m.n));
        if (S.over) { alive = false; break; }
        if (m.n <= 0) { alive = false; break; }   // 全军覆没
      }
      if (!alive) { S.march.splice(i, 1); continue; }
      if (m.idx >= m.path.length - 1) {
        this.log((m.side === 'p1' ? '我方部队' : '敌方部队') + '抵达 ' +
                 this.tileName(m.path[m.idx].gx, m.path[m.idx].gy) +
                 '（' + this.troopsAt(m.path[m.idx].gx, m.path[m.idx].gy)[m.side] + ' 兵）');
        S.march.splice(i, 1);
      }
    }
  },

  /**
   * 某格是否是「行军中部队的当前落点」。
   * 这些兵只是路过，格子上看得到、但**不能对它再次下令** ——
   * 旧版 AI 就栽在这里：把路过的一支部队当成新兵堆再派一次，同一批兵被复制成两份，
   * 300 秒能滚出 1105 兵（上限 60 形同虚设）。
   */
  isMarchOccupied(gx, gy, side) {
    return this.state.march.some(function (m) {
      if (side && m.side !== side) return false;
      const c = m.path[m.idx];
      return !!c && c.gx === gx && c.gy === gy;
    });
  },

  /** 把停在某格的行军部队「落地」：从行军队列移除，兵留在格上（便于对它重新下令） */
  flushMarchAt(gx, gy, side) {
    const S = this.state;
    let n = 0;
    for (let i = S.march.length - 1; i >= 0; i--) {
      const m = S.march[i];
      if (m.side !== side) continue;
      const c = m.path[m.idx];
      if (!c || c.gx !== gx || c.gy !== gy) continue;
      n += m.n;
      S.march.splice(i, 1);
    }
    return n;
  },

  /** 行进中的部队（渲染用）：{ side, n, x, y }（x/y 为插值后的格子坐标） */
  marchingTroops() {
    const out = [];
    const secPer = CFG.soldier.marchSecPerTile;
    const self = this;
    this.state.march.forEach(function (m) {
      const i = Math.min(m.idx, m.path.length - 2);
      if (i < 0) return;
      const k = Math.min(1, m.t / self.marchSpeed(m.side));
      const a = m.path[i], b = m.path[i + 1];
      out.push({
        side: m.side, n: m.n,
        x: a.gx + (b.gx - a.gx) * k,
        y: a.gy + (b.gy - a.gy) * k,
      });
    });
    return out;
  },

  /* -------- 资源点争夺 -------- */

  resourceAt(gx, gy) {
    return CFG.map.resources.filter(function (r) { return r.gx === gx && r.gy === gy; })[0] || null;
  },

  /** 站上资源点且无敌方、且守军已清空 → 归该方（归属持久，不需驻守） */
  claimIfResource(gx, gy) {
    const r = this.resourceAt(gx, gy);
    if (!r) return null;
    const t = this.troopsAt(gx, gy);
    const key = this.tileKey(gx, gy);
    const S = this.state;
    if ((S.resGuard[key] || 0) > 0) return null;      // 守军未清空，不能占领
    if (t.p1 > 0 && t.p2 === 0 && S.resourceOwner[key] !== 'p1') {
      S.resourceOwner[key] = 'p1';
      S.stats.resourceCaptures = (S.stats.resourceCaptures || 0) + 1;   // §21 任务：累计占领次数
      // 遗物「开疆旗」（行为转化型）：每占领一次资源点立即 +5⚡
      const vanguard = this.relicCount('vanguard') * CFG.relics.vanguard.val;
      if (vanguard > 0) {
        S.res.energy += vanguard;
        this.log('开疆旗：占领得 +⚡' + vanguard);
      }
      this.log('占领「' + r.name + '」→ 每 Tick +' + r.yield + ' ' + RES_ICON[r.res]);
      this.pushFx({ kind: 'flash', gx: gx, gy: gy, side: 'p1', capture: true, resource: true });
      return 'p1';
    }
    if (t.p2 > 0 && t.p1 === 0 && S.resourceOwner[key] !== 'p2') {
      S.resourceOwner[key] = 'p2';
      S.resGuard[key] = CFG.hp.resourceGuard;   // 敌方占领后守军恢复满值（防反复易手）
      this.log('敌方占领「' + r.name + '」');
      this.pushFx({ kind: 'flash', gx: gx, gy: gy, side: 'p2', capture: true, resource: true });
      return 'p2';
    }
    return null;
  },

  resourceOwnerOf(r) {
    return this.state.resourceOwner[this.tileKey(r.gx, r.gy)] || null;
  },

  /* ==================== Phase 4：战争 ==================== */

  /**
   * 数量抵消（事件驱动，§7.2）：同一格同时存在双方士兵 → 立即结算一次。
   * 少的一方全灭，多的保留差值；相等则同归于尽。
   */
  resolveCombat(gx, gy) {
    const t = this.troopsAt(gx, gy);
    if (t.p1 <= 0 || t.p2 <= 0) return null;
    const d = t.p1 - t.p2;
    // 战损统计（兜底计分的 C 项用）：双方各损失 min(双方) 个兵
    const loss = Math.min(t.p1, t.p2);
    this.state.stats.killed = (this.state.stats.killed || 0) + loss;
    this.state.stats.lost = (this.state.stats.lost || 0) + loss;
    /* 表现层：让「数量抵消」看得见（第四十三次修订）。
     * 旧版这里只是把兵数改掉，画面上两队兵"啪"地一起消失，玩家感知不到战斗过程。 */
    this.pushFx({
      kind: 'burst', gx: gx, gy: gy, loss: loss,
      win: d > 0 ? 'p1' : (d < 0 ? 'p2' : null),
      left: Math.abs(d), p1: t.p1, p2: t.p2,
    });
    if (d > 0) {
      this.setTroops(gx, gy, 'p1', d);
      this.setTroops(gx, gy, 'p2', 0);
    } else if (d < 0) {
      this.setTroops(gx, gy, 'p1', 0);
      this.setTroops(gx, gy, 'p2', -d);
    } else {
      this.setTroops(gx, gy, 'p1', 0);
      this.setTroops(gx, gy, 'p2', 0);   // 数量相同 → 同归于尽（setTroops 会清掉空记录）
    }
    return d;
  },

  /** 我方主城满防御值（随等级） */
  /** 主城血量上限 = 等级基础值 ×（1 + 0.2 × 相邻己方防御塔）× 政策「王城壁垒」（双方对称） */
  castleMaxHp() {
    const base = CFG.castle.levels[this.state.castleLevel - 1].hp;
    return Math.round(base * (1 + CFG.adjacency.towerAdjCastleHp * this.adjCastleTowers()) *
                      this.statMul('p1', 'castleHpPct'));
  },

  /** 与主城四向相邻的己方（非施工）防御塔数 */
  adjCastleTowers() {
    const S = this.state;
    const c = S.castle;
    return this.myBuildings().filter(function (b) {
      return b.type === 'tower' && !b.pending &&
             Math.abs(b.gx - c.gx) + Math.abs(b.gy - c.gy) === 1;
    }).length;
  },

  /** 城门规则/塔变化后同步主城当前血量：上限提高→补差额，上限降低→钳制 */
  syncCastleHp() {
    const S = this.state;
    const max = this.castleMaxHp();
    if (max > (S.castleHpMaxSeen || 0)) S.castleHp += max - (S.castleHpMaxSeen || 0);
    S.castleHp = Math.max(0, Math.min(S.castleHp, max));
    S.castleHpMaxSeen = max;
  },

  /**
   * 士兵到达某格后的结算（行军每走完一格都会调用）：
   * ① 同格有敌兵 → 数量抵消
   * ② 还活着 → 攻击敌方建筑（1 兵换 1 防御值）
   * ③ 还活着且是中立资源点 → 清守军，清空即占领
   * ④ 还活着且是敌方主城 → 打主城，归零判胜负
   */
  engageTile(gx, gy, side) {
    const S = this.state;
    if (S.over) return;

    // ① 数量抵消
    this.resolveCombat(gx, gy);
    let n = this.troopsAt(gx, gy)[side];
    if (n <= 0) return;

    // ② 敌方建筑（含被我占领后又被反抢的）
    const b = this.buildingAt(gx, gy);
    const owner = b ? (b.owner || 'p1') : null;
    if (b && owner !== side) {
      // 等量交换：1 兵换 1 防御值；政策「攻城」+ 遗物「攻城锤」按百分比放大伤害
      const dmg = Math.ceil(n * this.statMul(side, 'siegeDmg'));
      b.hp -= dmg;
      this.setTroops(gx, gy, side, 0);                 // 士兵同时消耗
      if (b.hp <= 0) this.captureBuilding(gx, gy, side);
      return;
    }

    // ③ 中立资源点守军（政策「先登」：对守军伤害 ×mul，等效兵耗下降；mul=1 时与基线等量交换完全一致）
    const r = this.resourceAt(gx, gy);
    if (r) {
      const k = this.tileKey(gx, gy);
      const guard = S.resGuard[k] || 0;
      if (guard > 0) {
        const mul = this.statMul(side, 'guardDmg');
        const dmg = n * mul;                              // 对守军的总伤害
        if (dmg >= guard) {
          // 守军清空：士兵按等效消耗 ceil(guard / mul)
          const spent = Math.min(n, Math.ceil(guard / mul));
          S.resGuard[k] = 0;
          this.setTroops(gx, gy, side, n - spent);
          n = n - spent;
        } else {
          // 没打穿：守军按伤害扣减（四舍五入），这波兵全填
          S.resGuard[k] = guard - Math.round(dmg);
          this.setTroops(gx, gy, side, 0);
          n = 0;
        }
        if (n <= 0) return;
      }
      // 守军已清空 → 占领（归属持久）
      this.claimIfResource(gx, gy);
      return;
    }

    // ④ 敌方主城（2×2 占地内任意一格都算攻城）
    const ec = S.enemyCastle;
    if (side === 'p1' && ec && this.inCastleFoot(gx, gy, ec)) {
      ec.hp -= n;
      this.setTroops(gx, gy, side, 0);
      this.pushFx({ kind: 'burst', gx: gx, gy: gy, loss: n, win: 'p1',
                    left: Math.max(0, ec.hp), castle: true, target: 'p2' });
      this.log('进攻敌方主城：-' + n + '，敌方主城剩 ' + Math.max(0, ec.hp));
      if (ec.hp <= 0) this.finish('win');
      return;
    }

    // ⑤ 我方主城被敌军攻击（2×2 占地内任意一格都算攻城）
    if (side === 'p2' && this.inCastleFoot(gx, gy, S.castle)) {
      S.castleHp -= n;
      this.setTroops(gx, gy, side, 0);
      this.pushFx({ kind: 'burst', gx: gx, gy: gy, loss: n, win: 'p2',
                    left: Math.max(0, S.castleHp), castle: true, target: 'p1' });
      this.log('我方主城受击：-' + n + '，剩 ' + Math.max(0, S.castleHp));
      if (S.castleHp <= 0) this.finish('lose');
    }
  },

  /**
   * 占领建筑（§6.5）：防御值归零即归攻击方，不判定攻击方士兵是否存活。
   * 城市建筑降 1 级（Lv3→2、Lv2→1、Lv1→变空地）；占领后按降级后等级的满值恢复防御值。
   */
  captureBuilding(gx, gy, side) {
    const b = this.buildingAt(gx, gy);
    if (!b) return null;
    const name = def(b.type).name;
    // 占领统计（供"士兵够不够用"的数据分析）
    if (side === 'p1') this.state.stats.capturedP1 = (this.state.stats.capturedP1 || 0) + 1;
    else this.state.stats.capturedP2 = (this.state.stats.capturedP2 || 0) + 1;
    if (b.level <= 1) {
      // ★ 按 anchor 删除：2×2 建筑被打成空地时整块腾空
      delete this.state.buildings[this.tileKeyOf(b.gx, b.gy)];
      this.reindex();
      this.log((side === 'p1' ? '我方' : '敌方') + '攻占 ' + name + '（Lv1 已被磨成空地）');
      return 'cleared';
    }
    b.level -= 1;
    b.owner = side;
    b.hp = this.buildingMaxHp(b.level);
    b.pending = true;                 // 本 Tick 不产出，下 Tick 起为新主人产出
    this.syncCastleHp();
    this.pushFx({ kind: 'flash', gx: b.gx, gy: b.gy, side: side, capture: true });
    this.log((side === 'p1' ? '我方占领' : '敌方占领') + ' ' + name + ' → Lv' + b.level);
    return 'captured';
  },

  /** 对局结束 */
  finish(result) {
    const S = this.state;
    S.result = result;
    S.over = true;
    S.paused = true;
    S.castleHp = Math.max(0, S.castleHp);
    S.enemyCastle.hp = Math.max(0, S.enemyCastle.hp);
    /* 表现层：被摧毁的那座主城来一次大爆炸（结算演出的开场） */
    const ruined = result === 'win' ? S.enemyCastle : (result === 'lose' ? S.castle : null);
    if (ruined) this.pushFx({ kind: 'blast', gx: ruined.gx, gy: ruined.gy, result: result });
    this.log(result === 'win' ? '🏆 敌方主城被摧毁 —— 胜利！'
           : result === 'lose' ? '💀 我方主城被摧毁 —— 战败'
           : '⏱ 时间到 —— 按综合分判定' + (S.score ? '（' + S.score.total + ' 分）' : ''));
  },

  /* -------- 敌方 AI（与玩家同一套规则：建筑产资源、兵营出兵、相邻生长建造、主城升级） -------- */

  /** 敌方某类型建筑的数量上限（同玩家：随敌方主城等级） */
  enemyTypeCap() { return CFG.castle.levels[(this.state.enemyLevel || 1) - 1].perTypeCap; },

  /** 敌方主城满防御值（随敌方主城等级；同样吃 AI 的「王城壁垒」政策，对称） */
  enemyCastleMaxHp() {
    const base = CFG.castle.levels[(this.state.enemyLevel || 1) - 1].hp;
    return Math.round(base * this.statMul('p2', 'castleHpPct'));
  },

  /** 敌方每 Tick 的资源结算（与玩家 applyTick 步骤 1+2.5 同一套产出表） */
  enemyTick() {
    const S = this.state;
    const er = S.enemyRes;
    this.enemyBuildings().forEach(function (b) {
      if (b.pending || b.type === 'barracks') return;
      const d = def(b.type);
      if (!d.levels) return;
      const y = d.levels[b.level - 1].yield || {};
      for (const k in y) er[k] += y[k];
    });
    const ecd = CFG.castle.levels[(S.enemyLevel || 1) - 1];
    if (ecd && ecd.energy) er.energy += ecd.energy;
  },

  /** 敌方兵营产兵（与玩家 trainAll 同一套表：从兵营格出兵、耗粮、受相邻农田加成） */
  enemyTrain(dt) {
    const S = this.state;
    const self = this;
    this.enemyBuildings().forEach(function (b) {
      if (b.type !== 'barracks' || b.pending) return;
      const t = def('barracks').train[b.level - 1];
      if (!t) return;
      b.trainT = (b.trainT || 0) + dt;
      const iv = t.interval * self.barracksIntervalMul(b.gx, b.gy, 'p2');   // 政策「征兵」对 AI 同样生效
      if (b.trainT < iv) return;
      if (S.enemyRes.food < t.food) return;                        // 粮不够不产兵
      // 上限按「场上 + 空中」计，并按剩余名额裁剪（整批产出会把总数顶穿上限）
      const room2 = self.maxTroops('p2') - self.activeTroops('p2');
      if (room2 <= 0) return;
      S.enemyRes.food -= t.food;
      self.addTroops(b.gx, b.gy, 'p2', Math.min(t.count + self.trainBonus('p2'), room2));
      b.trainT -= iv;
    });
  },

  /** 敌方建造（与玩家同一套规则：相邻生长 / 同样造价 / 每种上限随主城等级） */
  enemyBuild() {
    const S = this.state;
    const home = S.enemyCastle;
    // 建造优先级：**轮转**（农场→卡坊→能源站→兵营），按当前建筑数决定从哪个开始。
    // 建造条件与玩家一致：必须与己方道路四向相邻。
    const cycle = ['farm', 'atelier', 'power', 'barracks'];
    const start = this.enemyBuildings().length;
    for (let i = start; i < start + cycle.length; i++) {
      const type = cycle[i % cycle.length];
      if (this.typeCountOf('p2', type) >= this.enemyTypeCap()) continue;
      const d = def(type);
      // 第二十五次修订：AI 每建一座补 3⚡ 开牌费（对齐玩家的卡牌摩擦）
      if (S.enemyRes.energy < d.price + CFG.enemy.buildOpenCost) continue;
      // 找一块与己方道路四向相邻的空地（取离敌方主城最近的）
      let best = null, bestD = 1e9;
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          // ★ 整块占地都要可建（2×2 兵营不会因为"锚点是空地"就建下去）
          if (!this.isBuildableFoot(type, gx, gy)) continue;
          // 建筑与铺路同样限制在自己的半区：不越权到玩家区域，也不把玩家封死
          if (Math.abs(gx - home.gx) + Math.abs(gy - home.gy) >
              Math.abs(gx - S.castle.gx) + Math.abs(gy - S.castle.gy)) continue;
          if (!this.footRoadAdjacent(gx, gy, type, 'p2')) continue;
          const dd = Math.abs(gx - home.gx) + Math.abs(gy - home.gy);
          if (dd < bestD) { bestD = dd; best = { gx: gx, gy: gy }; }
        }
      }
      if (!best) continue;
      S.enemyRes.energy -= d.price + CFG.enemy.buildOpenCost;
      S.buildings[this.tileKeyOf(best.gx, best.gy)] = {
        gx: best.gx, gy: best.gy, type: type, level: 1, owner: 'p2',
        hp: CFG.hp.building[0], pending: true, trainT: 0,
      };
      this.reindex();
      this.pushFx({ kind: 'pop', gx: best.gx, gy: best.gy, side: 'p2' });   // AI 落成也给反馈
      this.log('敌方建成 Lv1 ' + d.name + '　(' + best.gx + ',' + best.gy + ')');
      return true;
    }
    return false;
  },

  /** 官道路基判定（第三十五次修订）：底图画出的旧官道走向。
   *  纯叙事 + AI 铺路偏好——机制上与普通铺路完全一致（用户拍板：开垦只是一种说法）。 */
  isOfficialRoad(gx, gy) {
    if (!this._officialSet) {
      const m = {};
      (CFG.map.officialRoads || []).forEach(function (r) { m[r.gx + ',' + r.gy] = 1; });
      this._officialSet = m;
    }
    return !!this._officialSet[gx + ',' + gy];
  },

  /**
   * 己方连通路网的「铺路前沿」：从主城 BFS 沿可通行格（道路/己方建筑/主城）蔓延，
   * 收集紧邻前沿的可铺路格。**铺路必须沿前沿生长** —— 否则贪心会在目标附近铺出
   * 与本方路网不连通的孤立碎片，路永远修不到敌人门口（实测踩过）。
   */
  roadFrontier(side) {
    const S = this.state;
    const home = side === 'p1' ? S.castle : S.enemyCastle;
    const self = this;
    const seen = {}; const q = [{ gx: home.gx, gy: home.gy }];
    seen[home.gx + ',' + home.gy] = 1;
    const frontier = [];
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const cur = q.shift();
      D.forEach(function (o) {
        const nx = cur.gx + o[0], ny = cur.gy + o[1], k = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= CFG.map.cols || ny >= CFG.map.rows) return;
        if (seen[k]) return;
        if (self.walkable(nx, ny, side)) { seen[k] = 1; q.push({ gx: nx, gy: ny }); return; }
        if (self.canPlaceRoad(nx, ny)) { seen[k] = 1; frontier.push({ gx: nx, gy: ny }); }
      });
    }
    return frontier;
  },

  /** AI 铺一格路（朝最近的未占资源点方向扩张），消耗 1 能量 —— 与玩家同一套铺路规则 */
  enemyRoad() {
    const S = this.state;
    if (S.enemyRes.energy < CFG.cards.roads.dirt.price) return false;
    const home = S.enemyCastle;
    const free = CFG.map.resources.filter(function (r) {
      return S.resourceOwner[r.gx + ',' + r.gy] !== 'p2';
    });
    // 第二批 AI：早期朝最近未占资源点修路；经济铺开后转为朝玩家主城修「进攻走廊」
    // （半区限制仍然生效 —— 走廊只修到中线，最后一段走玩家自己的路，道路互通）
    let goal;
    if (free.length && this.enemyBuildings().length < CFG.enemy.corridorMinBuildings) {
      goal = free.reduce(function (a, b) {
        return (Math.abs(a.gx - home.gx) + Math.abs(a.gy - home.gy)) <
               (Math.abs(b.gx - home.gx) + Math.abs(b.gy - home.gy)) ? a : b;
      });
    } else {
      goal = { gx: S.castle.gx, gy: S.castle.gy };
    }
    // 只沿「连通前沿」铺：保证新格子一定接在己方路网上（不会出现孤立碎片）
    const frontier = this.roadFrontier('p2');
    const self = this;
    let best = null, bestD = 1e9;
    frontier.forEach(function (p) {
      // 只在自己的半区铺路：离自己主城不能比离玩家主城更远（AI 管自己的区域）
      if (Math.abs(p.gx - home.gx) + Math.abs(p.gy - home.gy) >
          Math.abs(p.gx - S.castle.gx) + Math.abs(p.gy - S.castle.gy)) return;
      // 官道偏好（第三十五次修订）：同距离下优先沿旧官道「开垦」，误差容忍 0.5 格
      const d = Math.abs(p.gx - goal.gx) + Math.abs(p.gy - goal.gy) -
                (self.isOfficialRoad(p.gx, p.gy) ? 0.5 : 0);
      if (d < bestD) { bestD = d; best = { gx: p.gx, gy: p.gy }; }
    });
    if (!best) return false;
    S.enemyRes.energy -= CFG.cards.roads.dirt.price;
    S.roads[this.tileKeyOf(best.gx, best.gy)] = { tier: 1 };
    return true;
  },

  /** 敌方主城升级（与玩家同一套成本，血量随等级涨） */
  enemyUpgrade() {
    const S = this.state;
    const lv = S.enemyLevel || 1;
    if (lv >= CFG.castle.maxLevel) return false;
    const cost = CFG.castle.levels[lv - 1].upCost;
    if (!cost) return false;
    // 先把经济铺起来（至少 3 座建筑），再投资主城 —— 否则 AI 会攒钱攒到什么都不建
    if (this.enemyBuildings().length < 3) return false;
    if (S.enemyRes.energy < cost.energy) return false;
    S.enemyRes.energy -= cost.energy;
    S.enemyLevel = lv + 1;
    S.enemyCastle.level = S.enemyLevel;
    S.enemyCastle.maxHp = this.enemyCastleMaxHp();
    S.enemyCastle.hp = S.enemyCastle.maxHp;      // 升级后回满
    this.log('敌方主城升级 → Lv' + S.enemyLevel);
    if (CFG.policy.onCastleUp) this.aiPickPolicy();   // 与玩家对称：升本也给一次政策
    return true;
  },

  updateEnemy(dt) {
    const S = this.state;
    if (S.over) return;
    const E = CFG.enemy;

    // ① 兵营产兵（实时，同玩家）
    this.enemyTrain(dt);

    // ② 决策周期
    S.enemyDecideT = (S.enemyDecideT || 0) + dt;
    if (S.enemyDecideT < E.decideInterval) return;
    S.enemyDecideT = 0;

    // ③ 建造（第二十五次修订：每 buildCooldown 秒最多一座——对齐玩家建造节奏，治"围基地铺满几圈"）；
    //    铺路走独立计时（每 10 秒最多一格，且受能量约束）
    S.enemyBuildT = (S.enemyBuildT || 0) + E.decideInterval;
    if (S.enemyBuildT >= E.buildCooldown) {
      S.enemyBuildT = 0;
      this.enemyBuild();
    }
    S.enemyRoadT = (S.enemyRoadT || 0) + E.decideInterval;
    if (S.enemyRoadT >= CFG.enemy.roadInterval) {
      S.enemyRoadT = 0;
      this.enemyRoad();
    }
    // ④ 升级主城（经济铺起来之后才投资）
    this.enemyUpgrade();

    // ⑥ 派兵：第二批 AI —— **先集结、后出击**
    //    诊断（test/diag-wave.js）：零散小队会在中场路网与对方对撞、全部同归于尽，
    //    1000+ 波零抵达。因此：散兵先汇聚到最大堆，达标才一次性投入，且同一时刻只开一路。
    const self = this;
    const stacks = [];
    for (const k in S.troops) {
      const n = S.troops[k].p2;
      if (n <= 0) continue;
      const p = k.split(',');
      // ★ 跳过「行军中部队的临时落点」：那些兵已经在路上，不能再下一次令（会复制）
      if (this.isMarchOccupied(+p[0], +p[1], 'p2')) continue;
      stacks.push({ gx: +p[0], gy: +p[1], n: n });
    }
    if (!stacks.length) return;
    stacks.sort(function (a, b) { return b.n - a.n; });
    const muster = stacks[0];                       // 集结点 = 当前最大的兵堆

    // 已有「出击波」在途 → 不再开第二路（分兵是打不穿的头号原因）
    const pushing = S.march.some(function (m) { return m.side === 'p2' && m.push; });

    // ① 出击：集结点兵力达标 + 目标可达（不可达就不浪费这一波）
    if (!pushing) {
      const go = this.enemyPickTarget(muster);
      if (go) {
        this.setTroops(muster.gx, muster.gy, 'p2', 0);
        S.march.push({ side: 'p2', n: muster.n, path: go.path, idx: 0, t: 0, spent: 0, push: true });
        this.log('敌方 ' + muster.n + ' 兵出击 → ' + this.tileName(go.target.gx, go.target.gy));
        return;
      }
    }

    // ② 集结：其余兵堆向集结点靠拢（太小的堆原地待命，不单独长途行军）
    stacks.slice(1).forEach(function (x) {
      if (x.n < E.musterMin) return;
      const p = self.findPath(x.gx, x.gy, muster.gx, muster.gy, 'p2');
      if (!p || p.length < 2) return;
      self.setTroops(x.gx, x.gy, 'p2', 0);
      S.march.push({ side: 'p2', n: x.n, path: p, idx: 0, t: 0, spent: 0, muster: true });
    });
  },

  /**
   * 第二批 AI 的目标选择：按「价值/距离」排序，**且必须真的能走到**。
   * 旧版用「离主城最近的兵堆 + 直线最近目标」，导致派出去的兵常常没有路、或半路粮尽。
   * 返回 { target, path } 或 null（null = 这次不动，继续攒兵）。
   */
  enemyPickTarget(muster) {
    const E = CFG.enemy, S = this.state, self = this;
    const nearest = function (list, minN) {
      if (!list || !list.length) return null;
      if (muster.n < minN) return null;
      const sorted = list.slice().sort(function (a, b) {
        return (Math.abs(a.gx - muster.gx) + Math.abs(a.gy - muster.gy)) -
               (Math.abs(b.gx - muster.gx) + Math.abs(b.gy - muster.gy));
      });
      for (let i = 0; i < sorted.length; i++) {
        const p = self.findPath(muster.gx, muster.gy, sorted[i].gx, sorted[i].gy, 'p2');
        if (p && p.length >= 2) return { target: sorted[i], path: p };
      }
      return null;
    };
    // ① 主城 —— 唯一胜利条件，兵够就压
    const c = nearest([S.castle], E.pushCastle);
    if (c) return c;
    // ② 玩家建筑 —— 削经济，顺带为推进清场
    const b = nearest(this.myBuildings(), E.pushBuilding);
    if (b) return b;
    // ③ 资源点 —— 没有更好目标时才去抢
    const free = CFG.map.resources.filter(function (r) {
      return S.resourceOwner[r.gx + ',' + r.gy] !== 'p2';
    });
    return nearest(free, E.pushPoint);
  },

  /** 某方「有兵的己方格」里离指定点最近的那个（AI 出兵用） */
  nearestOwnTile(side, ax, ay) {
    let best = null, bestD = 1e9;
    for (const k in this.state.troops) {
      const t = this.state.troops[k];
      if (!t[side]) continue;
      const p = k.split(',');
      const gx = +p[0], gy = +p[1];
      const d = Math.abs(gx - ax) + Math.abs(gy - ay);
      if (d < bestD) { bestD = d; best = { gx: gx, gy: gy }; }
    }
    return best;
  },

  /** 某类型建筑在某方的数量 */
  typeCountOf(side, type) {
    const B = this.state.buildings;
    let n = 0;
    for (const k in B) if (B[k].type === type && (B[k].owner || 'p1') === side) n++;
    return n;
  },

  /** 某格四向相邻是否有某方的建筑或主城 */
  hasNeighborOf(gx, gy, side) {
    const S = this.state;
    const self = this;
    return [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].some(function (p) {
      if (side === 'p1') {
        return self.isCastleAt(p[0], p[1]) || (function () {
          const b = self.buildingAt(p[0], p[1]);
          return b && (b.owner || 'p1') === 'p1';
        })();
      }
      if (S.enemyCastle.gx === p[0] && S.enemyCastle.gy === p[1]) return true;
      const b = self.buildingAt(p[0], p[1]);
      return b && b.owner === 'p2';
    });
  },

  /** 卡坊：每 cardEvery 秒往手牌里塞一张随机卡（第十四次修订：工坊 → 卡坊） */
  atelierTick(dt) {
    const S = this.state;
    const self = this;
    this.myBuildings().forEach(function (b) {
      if (b.type !== 'atelier' || b.pending) return;
      const lv = def('atelier').levels[b.level - 1];
      const every = lv.cardEvery * self.statMul('p1', 'cardEvery');   // 政策「卡坊」
      b.trainT = (b.trainT || 0) + dt;
      if (b.trainT < every) return;
      b.trainT -= every;
      if (S.hand.indexOf(null) < 0) return;          // 手牌满则不产
      const key = self.addRandomCard();
      if (key) self.log('卡坊产出「' + self.cardInfo(key).name + '」');
    });
  },

  /** 随机抽一张（按主城等级解锁的卡池）放进手牌空位 */
  addRandomCard() {
    const pool = this.availableCards();
    if (!pool.length) return null;
    const key = pool[Math.floor(Math.random() * pool.length)];
    const i = this.state.hand.indexOf(null);
    if (i < 0) return null;
    this.state.hand[i] = { key: key };
    return key;
  },

  /** 防御塔杀敌倍率：相邻己方主城 → +50%（§9.5 邻接加成） */
  towerKillMul(gx, gy, side) {
    const c = side === 'p1' ? this.state.castle : this.state.enemyCastle;
    const adj = [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]].some(function (p) {
      return c.gx === p[0] && c.gy === p[1];
    });
    return adj ? 1 + CFG.adjacency.towerAdjCastleKill : 1;
  },

  /** 防御塔：对射程内（曼哈顿距离 1~2）的敌军每秒造成 kill 点杀伤（小数伤害累计） */
  towerTick(dt) {
    const S = this.state;
    const self = this;
    for (const k in S.buildings) {
      const b = S.buildings[k];
      if (b.type !== 'tower' || b.pending) continue;
      const side = b.owner || 'p1';
      const other = side === 'p1' ? 'p2' : 'p1';
      // 基础杀伤 = 等级值 ×（邻接主城 +50%）+ 政策「戍卫」/遗物「军械库」固定加成；
      // 事件倍率（如「总动员」-100% 停火）作用在总和上，钳制下限 0
      const baseKill = def('tower').levels[b.level - 1].kill * self.towerKillMul(b.gx, b.gy, side) +
                       self.statAdd(side, 'towerKill');
      const kill = Math.max(0, baseKill * self.statMul(side, 'towerKill', 0));
      b.killAcc = (b.killAcc || 0) + kill * dt;
      if (b.killAcc < 1) continue;
      // 射程内的敌军，近的先死
      const targets = [];
      for (const tk in S.troops) {
        const t = S.troops[tk];
        if (!t[other]) continue;
        const p = tk.split(',');
        const gx = +p[0], gy = +p[1];
        const d = Math.abs(gx - b.gx) + Math.abs(gy - b.gy);
        // 遗物「哨塔图纸」：射程 1~2 格 → 1~3 格
        const range = 2 + (side === 'p1' && self.relicCount('watchtower') > 0 ? 1 : 0);
        if (d >= 1 && d <= range) targets.push({ gx: gx, gy: gy, d: d });
      }
      if (!targets.length) continue;                 // 无目标：杀伤留存
      targets.sort(function (a, c) { return a.d - c.d; });
      let dmg = Math.floor(b.killAcc);
      b.killAcc -= dmg;
      for (const t of targets) {
        if (dmg <= 0) break;
        const cur = self.troopsAt(t.gx, t.gy)[other];
        const use = Math.min(dmg, cur);
        self.setTroops(t.gx, t.gy, other, cur - use);
        dmg -= use;
        if (side === 'p1') S.stats.killed = (S.stats.killed || 0) + use;
      }
    }
  },

  /* ==================== 手牌（上限可变） ==================== */

  /** 当前手牌格数（局内可被「扩容」效果牌增加） */
  handSize() { return this.state.hand.length; },

  /** 手牌格数上限（含政策「广纳」的加成） */
  maxHand() { return CFG.hand.maxSize + this.statAdd('p1', 'handCap'); },

  canExpandHand() { return this.state.hand.length < this.maxHand(); },

  /** 增加手牌格数，返回实际增加的格数（0 = 已到上限） */
  expandHand(n) {
    const room = this.maxHand() - this.state.hand.length;
    const add = Math.min(n || 1, room);
    if (add <= 0) return 0;
    for (let i = 0; i < add; i++) this.state.hand.push(null);
    this.log('手牌上限 +' + add + '（当前 ' + this.state.hand.length + ' 格）');
    return add;
  },

  /** 政策「广纳」生效后立即补齐手牌格数（只增不减，避免顶掉手上的牌） */
  syncHandCap() {
    const want = CFG.hand.baseSize + this.statAdd('p1', 'handCap');
    while (this.state.hand.length < want && this.state.hand.length < this.maxHand()) {
      this.state.hand.push(null);
    }
    return this.state.hand.length;
  },

  /* ==================== 效果牌（§10.7） ==================== */

  /** 当前每 Tick 的粮食产出（用于「抢收」结算） */
  foodPerTick() {
    let sum = 0;
    this.myBuildings().forEach(function (b) {
      const d = def(b.type);
      if (!d.levels) return;
      const y = d.levels[b.level - 1].yield;
      if (y && y.food) sum += y.food;
    });
    return sum;
  },

  /** 「扩建」还能用几次 */
  slotsLeft() {
    return Math.max(0, CFG.cards.slotCap - this.state.extraPerType);
  },

  /** 扩建：每种建筑的数量上限 +1 */
  reclaimOneSlot() {
    if (this.slotsLeft() <= 0) return null;
    this.state.extraPerType++;
    return true;
  },

  canPlayEffect(handIdx) {
    const card = this.state.hand[handIdx];
    if (!card) return false;
    const info = this.cardInfo(card.key);
    if (!info || info.kind !== 'effect') return false;
    if (info.eff === 'slot' && this.slotsLeft() <= 0) return false;
    return true;
  },

  /** 打出效果牌：立刻生效，不进城市区 */
  playEffect(handIdx) {
    const S = this.state;
    const card = S.hand[handIdx];
    if (!card) return false;
    const info = this.cardInfo(card.key);
    if (!info || info.kind !== 'effect') return false;

    if (info.eff === 'gain') {
      for (const k in info.gain) S.res[k] += info.gain[k];
      this.log('打出「' + info.name + '」：' +
               Object.keys(info.gain).map(function (k) {
                 return '+' + info.gain[k] + { energy: '⚡', food: '🌾' }[k];
               }).join(' '));

    } else if (info.eff === 'draw') {
      const key = this.addRandomCard();
      if (!key) return false;
      this.log('打出「' + info.name + '」：获得「' + this.cardInfo(key).name + '」');

    } else if (info.eff === 'slot') {
      if (!this.reclaimOneSlot()) return false;
      this.log('打出「' + info.name + '」：每种建筑上限 +1（当前 ' + this.typeCap('farm') +
               ' 座/种），剩余 ' + this.slotsLeft() + ' 次');

    } else if (info.eff === 'burst') {
      const per = this.foodPerTick();
      const gain = per * info.burstMul;
      S.res.food += gain;
      this.log('打出「' + info.name + '」：' + per + '/Tick × ' + info.burstMul + ' = +' + gain + ' 🌾');

    } else if (info.eff === 'boost') {
      S.boost = { mul: info.boostMul, ticksLeft: info.boostTicks };
      this.log('打出「' + info.name + '」：接下来 ' + info.boostTicks +
               ' 个 Tick 产出 ×' + info.boostMul);

    } else {
      return false;
    }

    S.hand[handIdx] = null;
    S.stats.effects++;
    return true;
  },

  /* ==================== 经济 Tick（§11.2） ==================== */

  applyTick() {
    const S = this.state;
    const gain = { energy: 0, food: 0 };

    // 步骤 1+2：我方建筑——跳过 pending，兵营走实时训练不在此结算
    //   政策「精耕」只加农田；遗物「效率蓝图」加全部建筑（stat 分离，互不挤占）
    const farmMul = this.statMul('p1', 'farmYield');
    const powerMul = this.statMul('p1', 'powerYield');   // 政策「电网」
    const allMul = this.statMul('p1', 'allYield');
    this.myBuildings().forEach(function (b) {
      if (b.pending) return;
      if (b.type === 'barracks') return;
      const d = def(b.type);
      if (!d.levels) return;
      const y = d.levels[b.level - 1].yield || {};
      const mul = (b.type === 'farm' ? farmMul : (b.type === 'power' ? powerMul : 1)) * allMul;
      for (const k in y) gain[k] += y[k] * mul;
    });

    // 步骤 2.5：主城自带的基础能量产出（保证能量永不归零，避免死锁）
    const castleDef = CFG.castle.levels[S.castleLevel - 1];
    if (castleDef && castleDef.energy) gain.energy += castleDef.energy * allMul;

    // 步骤 2.8：敌方建筑的资源产出（与玩家同一套产出表 —— 双方规则一致）
    this.enemyTick();

    // 步骤 4：资源点产出（Phase 3b：谁占下就归谁，归属持久、不需驻守）
    const self = this;
    const resMul = this.statMul('p1', 'resourceYield');
    CFG.map.resources.forEach(function (r) {
      if (self.resourceOwnerOf(r) === 'p1') gain[r.res] += r.yield * resMul;
    });

    // 步骤 4.5：政策「兴商」「屯田」+ 遗物「商队契约」「粮仓」（固定值相加）
    gain.energy += this.statAdd('p1', 'energyTick');
    gain.food += this.statAdd('p1', 'foodTick');

    // 步骤 5：入账（先套用 boost，再一次性加到账上；无上限，不截断）
    if (S.boost && S.boost.ticksLeft > 0) {
      for (const k in gain) gain[k] *= S.boost.mul;
      S.boost.ticksLeft--;
      if (S.boost.ticksLeft <= 0) S.boost = null;
    }
    for (const k in gain) S.res[k] += gain[k];
    // 资源永不为负（selftest 不变量）：负面事件「苛捐」等持续扣减必须钳在 0，
    // 否则玩家会看到 -56⚡ 这种账目（实机长跑 2026-09-26 真实复现）
    S.res.energy = Math.max(0, S.res.energy);
    S.res.food = Math.max(0, S.res.food);

    // 步骤 7：清除「本 Tick 新变化」标记
    S.buildings && Object.keys(S.buildings).forEach(function (k) { S.buildings[k].pending = false; });

    S.tickCount++;
    S.lastGain = gain;
    return gain;
  },

  /* ==================== 兵营训练（实时，不在 Tick 内） ==================== */

  trainStep(obj, table, dt) {
    const S = this.state;
    const side = table.side || 'p1';
    obj.trainT += dt;
    if (obj.trainT < table.interval) return;

    // 士兵达上限 → 暂停（不训练、不扣粮）。按剩余名额裁剪，避免整批产出顶穿上限
    const room = this.maxTroops(side) - this.activeTroops(side);
    if (room <= 0) { obj.trainT = table.interval; return; }
    // 粮食闸：政策「屯田戍边」生效期间训练不耗粮
    const foodNeed = this.policyFlag(side, 'trainFoodFree') ? 0 : table.food;
    if (S.res.food < foodNeed) { obj.trainT = table.interval; return; }

    S.res.food -= foodNeed;
    // 新兵直接出现在这座兵营所在地图格（Phase 3b：取消城门概念）
    // 每次产出额外 +N（遗物「征兵令」），并按剩余名额裁剪
    const n = Math.min(table.count + this.trainBonus(side), room);
    this.addTroops(table.gx, table.gy, side, n);
    obj.trainT -= table.interval;
    if (obj.trainT > table.interval) obj.trainT = 0;   // 防积压
    S.stats.trained++;
  },

  trainAll(dt) {
    const self = this;
    this.myBuildings().forEach(function (b) {
      if (b.type !== 'barracks' || b.pending) return;
      const t = def('barracks').train[b.level - 1];
      if (!t) return;
      const raw = self.buildingAt(b.gx, b.gy);
      if (!raw) return;
      self.trainStep(raw, {
        interval: t.interval * self.barracksIntervalMul(b.gx, b.gy, 'p1'),
        count: t.count, food: t.food,
        gx: b.gx, gy: b.gy, side: 'p1',
      }, dt);
    });
  },

  /* ==================== 主循环驱动 ==================== */

  update(rawDt) {
    const S = this.state;
    if (!S || S.paused || S.over) return;

    const dt = rawDt * S.speed;
    S.t += dt;

    // 实时推进：兵营训练 + 双方行军 + 敌方 AI + 卡坊产卡 + 防御塔杀伤 + 事件牌/任务
    this.trainAll(dt);
    this.updateMarch(dt);
    this.updateEnemy(dt);
    this.atelierTick(dt);
    this.towerTick(dt);
    this.eventTick();
    this.logisticsRoadTick(dt);
    this.checkQuests();

    // 离散推进：经济 Tick（高倍速下可能一帧跨多个 Tick）
    let guard = 0;
    while (S.t >= S.nextTickAt && guard++ < 30) {
      this.applyTick();
      S.nextTickAt += CFG.time.tick;
    }

    // 第十九次修订：主城存亡仍是首要结束条件；到 time.limit 仍未分出 → 按综合分判
    if (CFG.time.limit > 0 && S.t >= CFG.time.limit) this.finishByScore();
  },

  /**
   * 兜底结算（§12.3 重制版）：A 主城战果 ×1 + B 资源点 ×3 + C 战场成果 ÷5 ×1 +
   * D 发展水平（主城等级差）×1 + E 星级任务 ×1（第二十次修订）
   * ★ 遵守裁决 4：建筑数量完全不计分（D 用主城等级差，不是建筑数）
   */
  scoreBreakdown() {
    const S = this.state, W = CFG.scoring;
    const aCastle = (S.enemyCastle.maxHp - Math.max(0, S.enemyCastle.hp)) -
                    (this.castleMaxHp() - Math.max(0, S.castleHp));
    let mine = 0, theirs = 0;
    for (const k in S.resourceOwner) {
      if (S.resourceOwner[k] === 'p1') mine++;
      else if (S.resourceOwner[k] === 'p2') theirs++;
    }
    const aRes = mine - theirs;
    const aBattle = Math.floor((S.stats.killed || 0) / W.battleDivisor) -
                    Math.floor((S.stats.lost || 0) / W.battleDivisor);
    const aDev = (S.castleLevel - (S.enemyLevel || 1)) * W.devPerLevel;
    const aQuest = (S.questStar || 0) * CFG.quests.scorePerStar;
    return {
      A: aCastle, B: aRes, C: aBattle, D: aDev, E: aQuest,
      total: aCastle * W.weightCastle + aRes * W.weightResource +
             aBattle * W.weightBattle + aDev * W.weightDev + aQuest,
    };
  },

  finishByScore() {
    const S = this.state;
    if (S.over) return;
    const b = this.scoreBreakdown();
    S.score = b;
    const r = b.total > 0 ? 'win' : (b.total < 0 ? 'lose' : 'draw');
    this.log('时间到 —— 综合分 ' + b.total + '（A' + b.A + ' B' + b.B + ' C' + b.C + ' D' + b.D + '）');
    this.finish(r);
  },

  /* ==================== 杂项 ==================== */

  log(msg) {
    const S = this.state;
    S.log.unshift({ t: S.t, msg: msg });
    if (S.log.length > 60) S.log.pop();
  },

  /** 已进行秒数（用于时钟显示，正计时） */
  elapsed() {
    return Math.floor(this.state.t);
  },
};

global.Game = Game;
})(window);
