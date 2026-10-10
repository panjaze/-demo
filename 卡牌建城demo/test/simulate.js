/* =============================================================
 * simulate.js —— 数值跑批模拟
 *
 * 直接加载 config.js + game.js 跑真实规则（不重写公式，避免与实机不一致）
 * 用一个「理性玩家」策略跑固定窗口（1800 秒）的对局，重复 N 轮，输出：
 *   · 节奏时间线（首座建筑 / 满格 / 主城各级 / 出兵）
 *   · 三资源收支 + 收支比
 *   · 曲线采样表
 *   · 死锁与卡手检测
 *
 * 运行：node test/simulate.js [轮数]
 * ============================================================= */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..', 'js') + path.sep;
const ctx = { console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(base + 'config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(base + 'game.js', 'utf8'), ctx);
const { CFG, Game } = ctx;

const ROUNDS = parseInt(process.argv[2] || '300', 10);

/* 第九次修订后：建筑在地图格上自由生长 */
const myTiles = () => Game.myBuildings();
function findBuildTile(type) {
  for (let gy = 0; gy < CFG.map.rows; gy++) {
    for (let gx = 0; gx < CFG.map.cols; gx++) if (Game.canBuildAt(type, gx, gy)) return { gx: gx, gy: gy };
  }
  return null;
}
const DURATION = 1800;   // 跑批观察窗口 = CFG.time.limit（兜底时限，到时按综合分结算）

/* ---------------- 只在模块加载时包装一次（避免逐轮套娃） ---------------- */
const ACC = { income: { energy: 0, food: 0 }, effect: { energy: 0, food: 0 } };
const _applyTick = Game.applyTick.bind(Game);
Game.applyTick = function () {
  const g = _applyTick();
  ACC.income.energy += g.energy; ACC.income.food += g.food;
  return g;
};
const _playEffect = Game.playEffect.bind(Game);
Game.playEffect = function (i) {
  const before = Object.assign({}, Game.state.res);
  const r = _playEffect(i);
  if (r) for (const k in before) ACC.effect[k] += (Game.state.res[k] - before[k]);
  return r;
};

/* ---------------- 理性玩家的建造优先级（10 座，用满建筑位） ----------------
 * 先抢能源站（能量引擎），再铺农田/工坊，最后兵营。
 * Phase 1 无战争 → 不建防御塔。
 */
const BUILD_ORDER = ['power', 'farm', 'workshop', 'workshop', 'barracks',
                     'farm', 'power', 'farm', 'workshop', 'barracks'];
const WANT = {};
BUILD_ORDER.forEach(function (t) { WANT[t] = (WANT[t] || 0) + 1; });

/* ---------------- 统计工具 ---------------- */
function pct(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  const i = Math.min(a.length - 1, Math.max(0, Math.round((p / 100) * (a.length - 1))));
  return a[i];
}
function mean(arr) { return arr.length ? arr.reduce(function (s, v) { return s + v; }, 0) / arr.length : 0; }
function r1(v) { return Math.round(v * 10) / 10; }
function r2(v) { return Math.round(v * 100) / 100; }

/* ---------------- 一局 ---------------- */

function playOne() {
  Game.reset();
  const S = Game.state;
  ACC.income.energy = 0; ACC.income.material = 0; ACC.income.food = 0;
  ACC.effect.energy = 0; ACC.effect.material = 0; ACC.effect.food = 0;

  const M = { firstBuild: null, firstPower: null, b5: null, b10: null,
              castle2: null, castle3: null, castle4: null, castle5: null,
              firstSoldier: null, soldierCap: null, firstEffect: null,
              discarded: 0, reopen: 0, stuck: 0, curve: [], energyPerTickEnd: 0,
              /* ★ 第六十九次修订：AI 健康度 */
              aiBarracks: null, aiCastle2: null, aiEnergyMin: 0, aiEnergyNeg: false };

  function mark(k, t) { if (M[k] === null) M[k] = t; }

  function energyPerTick() {
    let e = 0;
    myTiles().forEach(function (c) {
      if (c.type !== 'power') return;
      e += (CFG.buildings.power.levels[c.level - 1].yield.energy || 0);
    });
    return e;
  }

  function decide(t) {
    const res = S.res;

    // 0) 主城优先：这是最强的成长轴（解锁防御塔、放开建筑等级上限、自带能量），够钱就升
    const cu0 = Game.castleUpgradeCost();
    if (cu0 && res.energy >= cu0.energy * 1.05) {
      Game.upgradeCastle();
      return;
    }

    // 理性取舍：主城没满级前，只花能量在"还缺的建筑卡"上；效果牌留到满级后再玩
    const castleDone = !cu0;
    const spendable = res.energy;

    const wanted = function (key) {
      const info = Game.cardInfo(key);
      if (!info) return false;
      if (info.kind === 'building') return Game.typeCount(key) < (WANT[key] || 0);
      if (!castleDone) return false;
      if (info.eff === 'slot') return false;
      return spendable >= 30;
    };

    // 还有没有任何想要的东西？没有就别开牌（避免无意义地烧能量）
    const hasAnyWant = Game.availableCards().some(function (k) { return wanted(k); });

    // 1) 开牌：手牌有空位、能量够、且还有想要的东西；店里没有"买得起的需要的卡"时重开
    //    早期额外规则：还没能源站时，会主动重开去找能源站卡（否则能量永久锁死）
    const handFree = S.hand.indexOf(null) >= 0;
    // 店里是否有"需要的卡"（不管买不买得起）—— 有就等着攒钱买，没有才重开
    const wantedInShop = !!(S.shop && S.shop.cards.some(function (k) { return k && wanted(k); }));
    const needPower = Game.typeCount('power') === 0 && Game.handIndexOf('power') < 0;
    const shopHasPower = !!(S.shop && S.shop.cards.indexOf('power') >= 0);
    if (handFree && spendable >= Game.openCostNow() && (hasAnyWant || needPower) &&
        (!wantedInShop || (needPower && !shopHasPower))) {
      if (S.shop) M.reopen++;
      Game.openShop();
    }

    // 2) 买卡：优先补"优先级最高"的建筑卡
    if (S.shop) {
      let best = -1, bestScore = -1e9;
      S.shop.cards.forEach(function (k, i) {
        if (!k || !Game.canBuy(i)) return;
        const info = Game.cardInfo(k);
        let score;
        if (info.kind === 'building') {
          const idx = BUILD_ORDER.indexOf(k);
          const lack = (WANT[k] || 0) - Game.typeCount(k);
          score = lack > 0 ? 1000 - idx * 10 : -1000;
          if (k === 'power' && Game.typeCount('power') === 0) score = 5000;   // 先抢能源站
        } else if (info.eff === 'slot') {
          score = -900;
        } else {
          score = spendable >= 12 ? 300 - info.price * 10 : -700;
        }
        if (score > bestScore) { bestScore = score; best = i; }
      });
      if (best >= 0 && bestScore > 0) Game.buyCard(best);
    }

    // 3) 弃牌：手牌满且有明确用不上的
    if (S.hand.indexOf(null) < 0) {
      for (let i = 0; i < S.hand.length; i++) {
        const h = S.hand[i];
        if (!h) continue;
        const info = Game.cardInfo(h.key);
        const useless = (info.kind === 'building' && Game.typeCount(h.key) >= (WANT[h.key] || 0) && Game.typeCount(h.key) > 0)
                     || (info.eff === 'slot' && Game.slotsLeft() <= 0);
        if (useless) { Game.discard(i); M.discarded++; }
      }
    }

    // 4) 打效果牌
    for (let i = 0; i < S.hand.length; i++) {
      const h = S.hand[i];
      if (!h) continue;
      const info = Game.cardInfo(h.key);
      if (info.kind === 'effect' && Game.canPlayEffect(i)) {
        Game.playEffect(i);
        if (M.firstEffect === null) M.firstEffect = t + 1;
      }
    }

    // 5) 建造
    for (let oi = 0; oi < BUILD_ORDER.length; oi++) {
      const type = BUILD_ORDER[oi];
      if (Game.typeCount(type) >= WANT[type]) continue;
      const hi = Game.handIndexOf(type);
      if (hi < 0) continue;
      const d = CFG.buildings[type];
      if ((d.castleReq || 1) > S.castleLevel) continue;
      if (res.energy < d.price) continue;
      const cell = findBuildTile(type);
      if (cell && Game.build(hi, cell.gx, cell.gy)) return;
    }

    // 6) 合成（省一张升级牌）
    for (let i = 0; i < S.hand.length; i++) {
      const h = S.hand[i];
      if (!h) continue;
      if (Game.cardInfo(h.key).kind !== 'building') continue;
      const target = myTiles().filter(function (b) { return Game.canMerge(i, b.gx, b.gy); })[0];
      if (target && Game.merge(i, target.gx, target.gy)) return;
    }

    // 7) 升级建筑（第十四次修订：用「升级牌」，一张升一级）
    if (Game.hasUpgradeCard()) {
      let best = null, bestGain = -1e9;
      myTiles().forEach(function (c) {
        if (c.level >= 3 || c.level >= Game.buildingLevelCap()) return;
        const d = CFG.buildings[c.type];
        if (!d.levels) return;                    // 兵营没有等级
        const cur = d.levels[c.level - 1].yield || {};
        const nxt = d.levels[c.level].yield || {};
        const W = { food: 1, energy: 8, cards: 0 };   // 能量边际价值更高（它买卡）
        let gain = 0;
        for (const k in nxt) gain += ((nxt[k] || 0) - (cur[k] || 0)) * (W[k] || 0);
        if (gain > bestGain) { bestGain = gain; best = c; }
      });
      if (best) { Game.upgradeWithCard(best.gx, best.gy); return; }
    }

    // 8) 升主城：能量够、且留一点余量
    const cu = Game.castleUpgradeCost();
    if (cu && res.energy >= cu.energy * 1.1) {
      Game.upgradeCastle();
    }
  }

  let lastAct = 0;
  const sig = function () {
    const st = S.stats;
    return st.opened + st.bought + st.built + st.upgraded + st.merged + st.effects + st.castleUp;
  };

  for (let t = 0; t < DURATION; t++) {
    const sigBefore = sig();

    // 铺路（每 10 秒一格，与 AI 同一套规则）：朝最近的未占资源点扩张
    if (t % 10 === 0 && S.res.energy >= CFG.cards.roads.dirt.price) {
      const home = S.castle;
      const free = CFG.map.resources.filter(function (r) {
        return S.resourceOwner[r.gx + ',' + r.gy] !== 'p1';
      });
      const goal = free.length ? free.reduce(function (a, b) {
        return (Math.abs(a.gx - home.gx) + Math.abs(a.gy - home.gy)) <
               (Math.abs(b.gx - home.gx) + Math.abs(b.gy - home.gy)) ? a : b;
      }) : Game.enemyCastle();
      let best = null, bestD = 1e9;
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          if (!Game.canPlaceRoad(gx, gy)) continue;
          const d = Math.abs(gx - goal.gx) + Math.abs(gy - goal.gy);
          if (d < bestD) { bestD = d; best = { gx: gx, gy: gy }; }
        }
      }
      if (best) { S.res.energy -= CFG.cards.roads.dirt.price; Game.placeRoad(best.gx, best.gy); }
    }

    decide(t);
    Game.update(1);

    // 卡死检测：连续 30 秒没有任何主动动作（开牌/买卡/建造/升级/合成/打牌/升主城）
    if (sig() !== sigBefore) lastAct = t;
    if (t - lastAct >= 30) M.stuck++;

    if (M.firstBuild === null && Game.buildingsUsed() > 0) mark('firstBuild', t + 1);
    if (M.firstPower === null && Game.typeCount('power') > 0) mark('firstPower', t + 1);
    if (M.b5 === null && Game.buildingsUsed() >= 5) mark('b5', t + 1);
    if (M.b10 === null && Game.buildingsUsed() >= 10) mark('b10', t + 1);
    if (M.castle2 === null && S.castleLevel >= 2) mark('castle2', t + 1);
    if (M.castle3 === null && S.castleLevel >= 3) mark('castle3', t + 1);
    if (M.castle4 === null && S.castleLevel >= 4) mark('castle4', t + 1);
    if (M.castle5 === null && S.castleLevel >= 5) mark('castle5', t + 1);
    if (M.firstSoldier === null && Game.totalTroops('p1') > 0) mark('firstSoldier', t + 1);
    if (M.soldierCap === null && Game.totalTroops('p1') >= Game.maxTroops('p1')) mark('soldierCap', t + 1);

    /* ★ 第六十九次修订：AI 健康度 —— AI 死局 bug（抽到「常备军」后能量一路负、整局建不出兵营）
     *   就是靠这个维度暴露的（40 种子 20%）。没有它，平衡回归只能看见玩家侧。 */
    if (M.aiBarracks === null && Game.enemyBuildings().some(function (b) { return b.type === 'barracks'; })) mark('aiBarracks', t + 1);
    if (M.aiCastle2 === null && (S.enemyLevel || 1) >= 2) mark('aiCastle2', t + 1);
    if (S.enemyRes && S.enemyRes.energy < M.aiEnergyMin) M.aiEnergyMin = S.enemyRes.energy;
    if (S.enemyRes && S.enemyRes.energy < 0) M.aiEnergyNeg = true;

    if ((t + 1) % 60 === 0) {
      M.curve.push({ t: t + 1, e: S.res.energy, f: S.res.food,
                     lv: S.castleLevel, slots: Game.buildingsUsed(), sol: Game.totalTroops('p1'),
                     ept: energyPerTick() });
    }
  }

  const init = CFG.resource.initial;
  const b = myTiles();
  M.end = {
    res: { energy: S.res.energy, food: S.res.food },
    castleLevel: S.castleLevel,
    slots: Game.buildingsUsed(),
    slotMax: Game.typeCap('farm') * 5,
    soldiers: Game.totalTroops('p1'),
    energyPerTick: energyPerTick(),
    buildings: b.reduce(function (o, c) {
      const k = c.type + ' Lv' + c.level; o[k] = (o[k] || 0) + 1; return o;
    }, {}),
    income: Object.assign({}, ACC.income),
    effectGain: Object.assign({}, ACC.effect),
    spent: {
      energy: init.energy + ACC.income.energy + ACC.effect.energy - S.res.energy,
      food: init.food + ACC.income.food + ACC.effect.food - S.res.food,
    },
    stats: Object.assign({}, S.stats),
    discarded: M.discarded,
    reopen: M.reopen,
    stuck: M.stuck,
    aiBarracks: M.aiBarracks, aiCastle2: M.aiCastle2,
    aiEnergyMin: Math.round(M.aiEnergyMin), aiEnergyNeg: M.aiEnergyNeg,
  };
  return M;
}

/* ---------------- 跑批 ---------------- */

console.log('轮数 = ' + ROUNDS + '，每局 ' + DURATION + ' 秒，理性玩家策略（能源站优先）\n');
const runs = [];
for (let i = 0; i < ROUNDS; i++) runs.push(playOne());
const ends = runs.map(function (r) { return r.end; });

function timeline(key, label) {
  const arr = runs.map(function (r) { return r[key]; }).filter(function (v) { return v !== null; });
  const never = runs.length - arr.length;
  if (!arr.length) return console.log('  ' + label.padEnd(18) + ' 从未达成 ' + (never ? '(' + never + '/' + runs.length + ')' : ''));
  console.log('  ' + label.padEnd(18) +
    ' P50 ' + String(pct(arr, 50)).padStart(5) + 's  P90 ' + String(pct(arr, 90)).padStart(5) + 's' +
    '   最晚 ' + String(Math.max.apply(null, arr)).padStart(5) + 's' +
    (never ? '   ← ' + never + '/' + runs.length + ' 局未达成' : ''));
}

console.log('== 1 节奏时间线 ==');
timeline('firstBuild', '第一座建筑');
timeline('firstPower', '第一座能源站');
timeline('b5', '第 5 座建筑');
timeline('b10', '满 10 格');
timeline('castle2', '主城 Lv2');
timeline('castle3', '主城 Lv3');
timeline('castle4', '主城 Lv4');
timeline('castle5', '主城 Lv5');
timeline('firstSoldier', '第一支部队');
timeline('soldierCap', '士兵满 60');
timeline('firstEffect', '第一张效果牌');

console.log('\n== 2 终局状态（' + DURATION + ' 秒窗口）==');
function stat(label, fn, f) {
  f = f || r1;
  const arr = ends.map(fn);
  console.log('  ' + label.padEnd(20) +
    ' P50 ' + String(f(pct(arr, 50))).padStart(7) +
    '   P90 ' + String(f(pct(arr, 90))).padStart(7) +
    '   均值 ' + String(f(mean(arr))).padStart(7));
}
stat('能量余额', function (e) { return e.res.energy; });
stat('粮食余额', function (e) { return e.res.food; });
stat('主城等级', function (e) { return e.castleLevel; }, r2);
stat('建筑数', function (e) { return e.slots; }, r2);
stat('能源站产能量/Tick', function (e) { return e.energyPerTick; });
stat('驻军数', function (e) { return e.soldiers; });
stat('卡死秒数', function (e) { return e.stuck; });
stat('重开次数', function (e) { return e.reopen; });
stat('弃牌次数', function (e) { return e.discarded; });

console.log('\n  行动次数（均值）：');
const AN = { opened: '开牌', bought: '买卡', built: '建造', upgraded: '升级',
             merged: '合成', effects: '打效果牌', castleUp: '升主城', trained: '兵营产兵' };
Object.keys(AN).forEach(function (a) {
  const arr = ends.map(function (e) { return e.stats[a]; });
  console.log('    ' + AN[a].padEnd(10) + ' P50 ' + String(pct(arr, 50)).padStart(4) +
              '   P90 ' + String(pct(arr, 90)).padStart(4) + '   均值 ' + r1(mean(arr)));
});

console.log('\n== 3 曲线采样（P50）==');
console.log('    时间    能量    粮食  主城  建筑  驻军  能量/Tick');
[60, 120, 180, 300, 420, 600, 780, 900].forEach(function (t) {
  const pick = function (fn) {
    return pct(runs.map(function (r) {
      const c = r.curve.filter(function (x) { return x.t === t; })[0];
      return c ? fn(c) : 0;
    }), 50);
  };
  console.log('   ' + String(t).padStart(4) + 's' +
    String(Math.round(pick(function (c) { return c.e; }))).padStart(8) +
    String(Math.round(pick(function (c) { return c.f; }))).padStart(8) +
    String(pick(function (c) { return c.lv; })).padStart(6) +
    String(pick(function (c) { return c.slots; })).padStart(6) +
    String(pick(function (c) { return c.sol; })).padStart(6) +
    String(pick(function (c) { return c.ept; })).padStart(10));
});

console.log('\n== 4 收支比（均值）==');
[['energy', '能量'], ['food', '粮食']].forEach(function (p) {
  const k = p[0];
  const inc = mean(ends.map(function (e) { return e.income[k]; }));
  const sp = mean(ends.map(function (e) { return e.spent[k]; }));
  const left = mean(ends.map(function (e) { return e.res[k]; }));
  console.log('  ' + p[1] +
    '  产出 ' + String(Math.round(inc)).padStart(7) +
    '   消耗 ' + String(Math.round(sp)).padStart(7) +
    '   终局剩余 ' + String(Math.round(left)).padStart(7) +
    '   产出/消耗 = ' + r2(inc / Math.max(1, sp)));
});

console.log('\n== 5 终局建筑构成（样本）==');
const sample = ends.find(function (e) { return e.slots >= 5; }) || ends[0];
console.log('  主城 Lv' + sample.castleLevel + '，建筑 ' + sample.slots + '/' + sample.slotMax);
Object.keys(sample.buildings).sort().forEach(function (k) {
  console.log('    ' + k + ' × ' + sample.buildings[k]);
});

console.log('\n== 6 AI 健康度 ==');
timeline('aiBarracks', 'AI 首个兵营');
timeline('aiCastle2',  'AI 主城 Lv2');
const aiNeg = runs.filter(function (r) { return r.aiEnergyNeg; }).length;
const aiNoBrk = runs.filter(function (r) { return r.aiBarracks === null; }).length;
console.log('  AI 能量曾变负       ' + aiNeg + '/' + runs.length +
            '   AI 整局无兵营 ' + aiNoBrk + '/' + runs.length +
            (aiNoBrk || aiNeg ? '   ← ⚠️ AI 出现死局，查 aiPickPolicy / 事件' : ''));

console.log('\n== 7 死锁检测 ==');
const dead = ends.filter(function (e) { return e.castleLevel === 1 && e.slots <= 2; }).length;
const noPower = runs.filter(function (r) { return r.firstPower === null; }).length;
console.log('  从未建出能源站：' + noPower + ' / ' + runs.length +
            '（' + r1(noPower / runs.length * 100) + '%）');
console.log('  终局仍卡在「主城 Lv1 且建筑 ≤2 座」：' + dead + ' / ' + runs.length +
            '（' + r1(dead / runs.length * 100) + '%）');
const stuckArr = ends.map(function (e) { return e.stuck; });
console.log('  平均卡死秒数：' + r1(mean(stuckArr)) + ' 秒（占 ' + DURATION + ' 秒的 ' +
            r1(mean(stuckArr) / DURATION * 100) + '%）');
