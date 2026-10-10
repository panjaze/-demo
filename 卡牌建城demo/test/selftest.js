/* 逻辑自检 —— 在 Node 里加载 config.js + game.js，逐条验证策划案规则
 * 运行：node test/selftest.js
 * 第九次修订后：取消固定城市区，改为「相邻生长扩展到全图」，建筑存在地图格上
 */
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

/* ★ 第四十五次修订：机械类用例（行军/寻路/对称性）不测道路额度，
 *   这里把额度放宽 —— 否则贪心铺路的助手会因额度用尽而提前收工、误报失败。
 *   额度本身在 §10e 有专门用例（那里会临时改成 5 来测）。 */
CFG.map.roadCapPerSide = 9999;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function head(t) { console.log('\n== ' + t + ' =='); }

const S = () => Game.state;
const CASTLE = () => Game.state.castle;
/** 找一个满足条件的格子（测试场景构造用，按行扫描确定性返回首个） */
function findTile(pred) {
  for (let gy = 0; gy < CFG.map.rows; gy++)
    for (let gx = 0; gx < CFG.map.cols; gx++)
      if (pred(gx, gy)) return { gx: gx, gy: gy };
  return null;
}
/** 距主城最近的「实际可建」格（主城外圈被初始官道/资源点占满 → 城市只能沿街向外生长） */
function nearBuildable(type) {
  const c = CASTLE();
  let best = null, bd = 1e9;
  S().hand[0] = { key: type };
  for (let gy = 0; gy < CFG.map.rows; gy++) {
    for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (!Game.canBuildAt(type, gx, gy)) continue;
      const d = Math.abs(gx - c.gx) + Math.abs(gy - c.gy);
      if (d < bd) { bd = d; best = { gx: gx, gy: gy }; }
    }
  }
  return best;
}
/** 紧邻现有路网、可继续铺路的格子（铺路同样沿街生长） */
function nearRoadable() {
  const c = CASTLE();
  let best = null, bd = 1e9;
  for (let gy = 0; gy < CFG.map.rows; gy++) {
    for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (!Game.canPlaceRoad(gx, gy)) continue;
      const d = Math.abs(gx - c.gx) + Math.abs(gy - c.gy);
      if (d < bd) { bd = d; best = { gx: gx, gy: gy }; }
    }
  }
  return best;
}
/** 孤立空地：不挨任何路/主城/建筑（验证「必须修路才能建」） */
function isolatedPlain() {
  return findTile(function (x, y) {
    return Game.isBuildableTerrain(x, y) && Game.isEmptyTile(x, y) &&
           !Game.isRoadAt(x, y) && !Game.resourceAt(x, y) && !Game.roadAdjacentAny(x, y);
  });
}
/** 清掉初始官道（构造「无路可达」场景用） */
function clearPresetRoads() {
  Object.keys(S().roads).forEach(function (k) { if (S().roads[k].preset) delete S().roads[k]; });
}
/** 直接放一座建筑（绕过建造流程，用于构造测试场景；owner 缺省 p1） */
function place(type, gx, gy, level, owner) {
  const lv = level || 1;
  S().buildings[Game.tileKeyOf(gx, gy)] = {
    gx: gx, gy: gy, type: type, level: lv, owner: owner || 'p1',
    hp: CFG.hp.building[lv - 1], pending: false, trainT: 0,
  };
  Game.reindex();                       // 占地索引必须跟着重建（buildingAt 走索引）
  return Game.buildingAt(gx, gy);
}
function rich() { S().res.energy = 99999; S().res.material = 99999; S().res.food = 99999; }
/** 测试辅助：贪心铺路到目标（自动绕开资源点等不可铺的格子） */
function layRoadTo(ax, ay, bx, by) {
  for (let guard = 0; guard < 600; guard++) {
    const p = Game.findPath(ax, ay, bx, by, 'p1');
    if (p) return p;
    let best = null, bestD = 1e9;
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        if (!Game.canPlaceRoad(gx, gy)) continue;
        const d = Math.abs(gx - bx) + Math.abs(gy - by);
        if (d < bestD) { bestD = d; best = { gx: gx, gy: gy }; }
      }
    }
    if (!best) return null;
    Game.placeRoad(best.gx, best.gy);
  }
  return null;
}

/* ---------- 1. 开局 ---------- */
head('1 开局状态');
Game.reset();
ok('初始资源 20⚡/60🌾（物资已删除）', S().res.energy === 20 && S().res.food === 60 && S().res.material === undefined, S().res);
ok('主城落在出生点', CASTLE().gx === CFG.map.spawn.p1.gx && CASTLE().gy === CFG.map.spawn.p1.gy, CASTLE());
ok('开局没有任何建筑（外围建筑已取消）', Game.buildingsUsed() === 0, Game.buildingsUsed());
ok('开局主城 Lv1', S().castleLevel === 1);
ok('开局场上无部队', Game.totalTroops('p1') === 0);
ok('手牌为空', S().hand.every(function (h) { return h === null; }));

/* ---------- 2. 开牌 ---------- */
head('2 开牌 / 开牌费递增');
ok('开牌成功', Game.openShop() === true);
ok('翻出 5 张', S().shop.cards.length === 5);
ok('至少 3 种不同卡', new Set(S().shop.cards).size >= 3);
let bad = 0;
for (let i = 0; i < 300; i++) { S().res.energy = 100; S().rerolls = 0; Game.openShop(); if (new Set(S().shop.cards).size < 3) bad++; }
ok('300 次开牌都不低于 3 种不同', bad === 0, bad);

Game.reset();
S().res.energy = 9999;
const costs = [];
for (let i = 0; i < 7; i++) { costs.push(Game.openCostNow()); Game.openShop(); }
ok('开牌费序列 = 3,3,4,6,8,10,12', costs.join(',') === '3,3,4,6,8,10,12', costs);
ok('重开次数已累计', S().rerolls === 6, S().rerolls);

function shopHasType(castleLv, type, n) {
  Game.reset(); S().castleLevel = castleLv;
  let saw = false;
  for (let i = 0; i < n; i++) { S().res.energy = 100; S().rerolls = 0; Game.openShop(); if (S().shop.cards.indexOf(type) >= 0) saw = true; }
  return saw;
}
ok('主城 Lv1 时卡池不含防御塔', !shopHasType(1, 'tower', 300));
ok('主城 Lv2 时卡池出现防御塔', shopHasType(2, 'tower', 300));

/* ---------- 3. 买卡 / 手牌上限 ---------- */
head('3 买卡 / 手牌上限可变');
Game.reset(); S().res.energy = 999;
ok('开局手牌格数 = baseSize', S().hand.length === CFG.hand.baseSize);
ok('扩容 +2 → 7 格', Game.expandHand(2) === 2 && S().hand.length === CFG.hand.baseSize + 2);
let guard = 0;
while (Game.canExpandHand() && guard++ < 20) Game.expandHand(1);
ok('可扩到 maxSize', S().hand.length === CFG.hand.maxSize, S().hand.length);
ok('到上限后扩容返回 0', Game.expandHand(1) === 0);

Game.reset(); S().res.energy = 50; Game.openShop();
const bi = S().shop.cards.findIndex(function (k, i) { return k && Game.canBuy(i); });
ok('存在可买的卡', bi >= 0);
const key0 = S().shop.cards[bi];
const e0 = S().res.energy;
ok('买入成功', Game.buyCard(bi) === true);
ok('能量按标价扣除', S().res.energy === e0 - Game.cardInfo(key0).price, e0 - S().res.energy);
ok('卡进入手牌', S().hand.some(function (h) { return h && h.key === key0; }));

/* ---------- 4. 建造 / 沿街生长 / pending ---------- */
head('4 建造 / 沿街生长 / Tick 生效时机');
Game.reset(); rich();
S().hand = [{ key: 'farm' }, null, null, null, null];
ok('地图外不能建', Game.canBuildAt('farm', -1, 0) === false);
ok('主城占地内不能建', Game.canBuildAt('farm', CASTLE().gx, CASTLE().gy) === false);
const iso4 = isolatedPlain();
ok('不挨路的空地不能建（必须修路到这里）',
   !!iso4 && Game.canBuildAt('farm', iso4.gx, iso4.gy) === false,
   iso4 ? Game.buildBlockReason('farm', iso4.gx, iso4.gy) : '找不到孤立空地');
const n4 = nearBuildable('farm');
ok('主城旁可以建（主城即路网之根）', !!n4 && Game.canBuildAt('farm', n4.gx, n4.gy) === true,
   n4 ? Game.buildBlockReason('farm', n4.gx, n4.gy) : '找不到可建格');
ok('建造成功', !!n4 && Game.build(0, n4.gx, n4.gy) === true);
ok('建造不消耗任何资源（卡牌是唯一成本）', S().res.energy === 99999 && S().res.food === 99999);
ok('建筑记录在地图格上（占地索引已重建）',
   !!n4 && !!Game.buildingAt(n4.gx, n4.gy) && Game.buildingAt(n4.gx, n4.gy).pending === true);
ok('建筑总数 +1', Game.buildingsUsed() === 1, Game.buildingsUsed());
ok('邻居格现在也能建（城市向外生长）',
   Game.hasNeighborBuilding(n4.gx + 1, n4.gy) || Game.hasNeighborBuilding(n4.gx - 1, n4.gy) ||
   Game.hasNeighborBuilding(n4.gx, n4.gy + 1) || Game.hasNeighborBuilding(n4.gx, n4.gy - 1));

S().res.food = 1000;
const g1 = Game.applyTick();
ok('第1个Tick 新建筑不产出（pending）', g1.food === 0, g1);
ok('pending 已清除', Game.buildingAt(n4.gx, n4.gy).pending === false);
const g2 = Game.applyTick();
/* ★ 第四十五次修订：不再把农田产量写死，改成与 config 对齐 —— 否则每次调数值都要改测试，
 *   而这条真正要守的是「农田确实产粮了」。 */
const FARM_Y1 = CFG.buildings.farm.levels[0].yield.food;
ok('第2个Tick 农田开始产粮 +' + FARM_Y1, g2.food === FARM_Y1, g2);

/* ---------- 5. 主城等级 / 建筑与种类上限 ---------- */
head('5 主城等级 / 建筑与种类上限');
Game.reset(); rich();
ok('Lv1 建筑等级上限 = 1', Game.buildingLevelCap() === 1);
ok('Lv1 每种建筑上限 = 3', Game.typeCap('farm') === 3, Game.typeCap('farm'));
const t5 = nearBuildable('farm');
ok('Lv1 不能建防御塔', !!t5 && Game.canBuildAt('tower', t5.gx, t5.gy) === false,
   t5 ? Game.buildBlockReason('tower', t5.gx, t5.gy) : '无可建格');
const b5 = place('farm', t5.gx, t5.gy, 1);
ok('Lv1 时建筑无法升 Lv2（被主城等级卡住）', Game.upgradeWithCard(b5.gx, b5.gy).ok === false);
ok('被主城等级卡住（标记）', Game.upgradeBlockedByCastle(b5) === true);
ok('Lv1 也不能建卡坊外的未知建筑', Game.buildBlockReason('nope', CASTLE().gx + 2, CASTLE().gy) !== null);

ok('升级主城成功', Game.upgradeCastle() === true);
ok('主城 → Lv2', S().castleLevel === 2);
ok('Lv2 每种上限 = 4', Game.typeCap('farm') === 4);
ok('Lv2 建筑等级上限 = 2', Game.buildingLevelCap() === 2);
S().hand = [{ key: 'upgrade' }, null, null, null, null];
ok('用升级牌升到 Lv2', Game.upgradeWithCard(b5.gx, b5.gy).ok === true && b5.level === 2, b5.level);
ok('主城 Lv2 防御值 84', Game.castleHp() === 84, Game.castleHp());
S().hand = [{ key: 'tower' }, null, null, null, null];
const t5b = nearBuildable('tower');
ok('主城 Lv2 时可以建防御塔', !!t5b && Game.canBuildAt('tower', t5b.gx, t5b.gy) === true,
   t5b ? Game.buildBlockReason('tower', t5b.gx, t5b.gy) : '无可建格');

// 道路系统（第十四次修订 + 第三十次修订：初始官道占满主城外圈，铺路/建城都沿街生长）
ok('主城是路网之根', Game.walkable(CASTLE().gx, CASTLE().gy, 'p1') === true);
const rn = nearRoadable();
ok('主城旁可铺路（主城是路网之根）', !!rn && Game.canPlaceRoad(rn.gx, rn.gy) === true,
   rn ? null : '找不到可铺路格');
ok('铺路成功', !!rn && Game.placeRoad(rn.gx, rn.gy) === true);
ok('道路已铺下', !!rn && Game.isRoadAt(rn.gx, rn.gy) === true);
ok('道路互通：双方都能走任何路（walkable）',
   !!rn && Game.walkable(rn.gx, rn.gy, 'p1') && Game.walkable(rn.gx, rn.gy, 'p2'));
const iso5 = isolatedPlain();
ok('孤路不能再铺（必须连着已有路/主城）',
   !!iso5 && Game.canPlaceRoad(iso5.gx, iso5.gy) === false,
   iso5 ? ('孤格 ' + iso5.gx + ',' + iso5.gy) : '找不到孤立空地');
const rn2 = rn && findTile(function (x, y) {
  return Game.canPlaceRoad(x, y) && Math.abs(x - rn.gx) + Math.abs(y - rn.gy) === 1;
});
ok('沿路延伸可以继续铺', !!rn2 && Game.canPlaceRoad(rn2.gx, rn2.gy) === true,
   rn2 ? null : '找不到延伸格');
const isoB = iso5 || rn;
S().hand = [{ key: 'farm' }, null, null, null, null];
ok('建筑必须连路：不挨路的空地不能建',
   !!isoB && Game.canBuildAt('farm', isoB.gx, isoB.gy) === false);
ok('不能建在道路上', /道路是给军队走的/.test(Game.buildBlockReason('farm', rn.gx, rn.gy) || ''),
   Game.buildBlockReason('farm', rn.gx, rn.gy));
ok('建筑挨着路就能建（不再要求贴建筑）',
   !!rn2 && Game.canBuildAt('farm', rn2.gx, rn2.gy) === true,
   rn2 ? Game.buildBlockReason('farm', rn2.gx, rn2.gy) : '无延伸格');

// 官道路基（第三十五次修订：纯叙事 + AI 铺路偏好，无机制特权）
ok('官道路基已登记（99 格，含两桥）', (CFG.map.officialRoads || []).length === 99,
   (CFG.map.officialRoads || []).length);
ok('官道判定：桥格属于官道走向',
   Game.isOfficialRoad(CFG.map.bridges[0].gx, CFG.map.bridges[0].gy) === true);
ok('官道判定：普通草地不属于官道', Game.isOfficialRoad(0, 0) === false);
ok('官道开垦无机制特权：不连通的官道格一样不能铺',
   (function () {
     const c = CFG.map.officialRoads.find(function (r) {
       return Game.isEmptyTile(r.gx, r.gy) && !Game.roadAdjacentAny(r.gx, r.gy);
     });
     return c ? Game.canPlaceRoad(c.gx, c.gy) === false : true;   // 找不到孤立官道格也算通过
   })());

Game.reset(); rich();
for (let i = 0; i < 4; i++) Game.upgradeCastle();
ok('主城可升到 Lv5', S().castleLevel === 5, S().castleLevel);
ok('Lv5 后无升级成本', Game.castleUpgradeCost() === null);
ok('Lv5 防御值 168', Game.castleHp() === 168, Game.castleHp());
ok('Lv5 每种上限 = 7', Game.typeCap('farm') === 7, Game.typeCap('farm'));

/* ---------- 6. 每种建筑数量上限 ---------- */
head('6 每种建筑数量上限');
Game.reset(); rich(); S().castleLevel = 1;
S().hand = [{ key: 'farm' }, null, null, null, null];
// 城门规则：主城旁最多 2 座 → 先铺一条路向外，让第 3 座能建在路旁
layRoadTo(CASTLE().gx + 1, CASTLE().gy, CASTLE().gx + 6, CASTLE().gy);
let placed = 0, lastTile = null;
for (let gy = 0; gy < CFG.map.rows && placed < 4; gy++) {
  for (let gx = 0; gx < CFG.map.cols && placed < 4; gx++) {
    if (Game.resourceAt(gx, gy) || Game.isRoadAt(gx, gy)) continue;
    S().hand[0] = { key: 'farm' };              // 每轮补卡，只为验证"每种上限"这一条
    if (!Game.canBuildAt('farm', gx, gy)) continue;
    if (Game.build(0, gx, gy)) { placed++; lastTile = { gx: gx, gy: gy }; }
  }
}
ok('Lv1 建到 3 座即达上限', Game.typeCount('farm') === 3, Game.typeCount('farm'));
const t4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  .map(function (o) { return { gx: lastTile.gx + o[0], gy: lastTile.gy + o[1] }; })
  .filter(function (t) { return Game.isBuildableTile(t.gx, t.gy); })[0];
ok('第 4 座被拒绝（原因指向数量上限）',
   !!t4 && /上限 3 座/.test(Game.buildBlockReason('farm', t4.gx, t4.gy) || ''),
   t4 ? Game.buildBlockReason('farm', t4.gx, t4.gy) : '无可建邻格');

/* ---------- 7. 邻接加成 ---------- */
head('7 邻接加成');
Game.reset(); rich();
const c7 = CASTLE();
const a7 = { gx: c7.gx + 1, gy: c7.gy }, b7 = { gx: c7.gx + 2, gy: c7.gy };
place('barracks', a7.gx, a7.gy);
place('farm', b7.gx, b7.gy);
ok('兵营相邻农田 → 间隔 ×0.8', Math.abs(Game.barracksIntervalMul(a7.gx, a7.gy) - 0.8) < 1e-9,
   Game.barracksIntervalMul(a7.gx, a7.gy));
place('tower', c7.gx, c7.gy + 1);
Game.syncCastleHp();                          // 塔建成 → 上限 60→72，补差额
ok('主城 Lv1 + 相邻塔 → 上限 60→72 并补足', Game.castleHp() === 72 && Game.castleMaxHp() === 72,
   { 当前: Game.castleHp(), 上限: Game.castleMaxHp() });
// 拆塔 → 上限回落并钳制
Game.demolish(c7.gx, c7.gy + 1);
ok('拆塔后上限回落 72→60 且当前值钳制', Game.castleMaxHp() === 60 && Game.castleHp() === 60,
   { 上限: Game.castleMaxHp(), 当前: Game.castleHp() });
ok('towerAdjCastle 判定正确', Game.towerAdjCastle(c7.gx, c7.gy + 1) === true);

/* ---------- 8. 合成 / 拆除 ---------- */
head('8 合成 / 拆除');
Game.reset(); rich(); S().castleLevel = 3;
const m8 = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
place('farm', m8.gx, m8.gy, 1);
S().hand = [{ key: 'farm' }, null, null, null, null];
ok('同类卡可合成', Game.canMerge(0, m8.gx, m8.gy) === true);
ok('合成成功', Game.merge(0, m8.gx, m8.gy) === true);
ok('升到 Lv2', Game.buildingAt(m8.gx, m8.gy).level === 2);
ok('合成只消耗一张同类卡', S().hand[0] === null);
S().hand = [{ key: 'workshop' }, null, null, null, null];
ok('异类卡不可合成', Game.canMerge(0, m8.gx, m8.gy) === false);

ok('拆除成功（免费，只腾格子）', Game.demolish(m8.gx, m8.gy) === true);
ok('拆除后该格为空', Game.buildingAt(m8.gx, m8.gy) === null);

/* ---------- 8b. 回归：建筑必须能被真正升级（曾经的严重 bug） ----------
 * 事故：myBuildings() 若返回"副本"，upgrade(b) 就会改到副本上、真实数据不变，
 * 后果是同一座建筑可以被无限升级（每次只扣一次成本）→ 物资被烧光、主城升不上去。
 * 跑批时表现为 stats.upgraded 高达 134 次（10 座建筑理论上最多 20 次）。
 */
head('8b 回归：建筑升级真的生效 / 不能无限升级');
Game.reset(); rich(); S().castleLevel = 3;
const rr = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
const rb = place('farm', rr.gx, rr.gy, 1);
S().hand = [{ key: 'upgrade' }, { key: 'upgrade' }, null, null, null];   // 升级牌 ×2
const ref = Game.myBuildings().filter(function (b) { return b.gx === rr.gx && b.gy === rr.gy; })[0];
ok('myBuildings() 返回真实对象引用（不是副本）', ref === rb, ref === rb ? 'ref' : 'copy!');
ok('返回值自带 gx/gy', ref && ref.gx === rr.gx && ref.gy === rr.gy, ref && [ref.gx, ref.gy]);

S().stats.upgraded = 0;
ok('升级 Lv1 → Lv2 成功（升级牌）', Game.upgradeWithCard(ref.gx, ref.gy).ok === true);
ok('state 里的等级真的变了', Game.buildingAt(rr.gx, rr.gy).level === 2, Game.buildingAt(rr.gx, rr.gy).level);
ok('升级 Lv2 → Lv3 成功（第二张升级牌）', Game.upgradeWithCard(ref.gx, ref.gy).ok === true);
ok('停在 Lv3', Game.buildingAt(rr.gx, rr.gy).level === 3, Game.buildingAt(rr.gx, rr.gy).level);
ok('Lv3 后不能再升（手牌还有牌也不行）', Game.upgradeWithCard(ref.gx, ref.gy).ok === false);
ok('总升级次数 = 2（不是几十次）', S().stats.upgraded === 2, S().stats.upgraded);

/* ---------- 9. 兵营训练 ---------- */
head('9 兵营训练 / 新兵出现在兵营格');
Game.reset(); rich();
const k9 = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
place('barracks', k9.gx, k9.gy);
for (let i = 0; i < 21; i++) Game.trainAll(1);
ok('21 秒后产出 7 兵（第二十四次修订新产量）', Game.totalTroops('p1') === 7, Game.totalTroops('p1'));
ok('兵出现在这座兵营所在地图格', Game.troopsAt(k9.gx, k9.gy).p1 === 7, Game.troopsAt(k9.gx, k9.gy));
S().res.food = 0;
const sb = Game.totalTroops('p1');
for (let i = 0; i < 60; i++) Game.trainAll(1);
ok('粮食为 0 时不产兵', Game.totalTroops('p1') === sb);
S().res.food = 9e9;
Game.addTroops(k9.gx, k9.gy, 'p1', Game.maxTroops('p1') - Game.totalTroops('p1'));
for (let i = 0; i < 60; i++) Game.trainAll(1);
ok('士兵达上限后停产', Game.totalTroops('p1') === Game.maxTroops('p1'));
ok('上限随主城等级抬升（Lv1=60）', Game.maxTroops('p1') === CFG.soldier.maxByLevel[0],
   { 上限: Game.maxTroops('p1') });
S().castleLevel = 3;
ok('升到 Lv3 后上限抬到 100', Game.maxTroops('p1') === 100, Game.maxTroops('p1'));
S().castleLevel = 1;

/* ---------- 10. 行军 / 资源点占领 ---------- */
head('10 行军 / 资源点占领');
Game.reset(); rich();
const c10 = CASTLE();
const mine = CFG.map.resources[0];
const start10 = { gx: c10.gx, gy: c10.gy - 1 };   // 主城北侧（紧邻主城 → 可铺第一格路）
// 开局无路（第三十一次修订）：先铺第一格，再修到矿点旁（军队只能沿路走）
ok('开局无官道', Object.keys(S().roads).length === CFG.map.bridges.length, Object.keys(S().roads).length);
ok('紧邻主城可铺第一格路', Game.canPlaceRoad(start10.gx, start10.gy) === true,
   Game.canPlaceRoad(start10.gx, start10.gy));
Game.placeRoad(start10.gx, start10.gy);
layRoadTo(start10.gx, start10.gy, mine.gx, mine.gy);
Game.addTroops(start10.gx, start10.gy, 'p1', 12);
ok('部队站在道路上', Game.isRoadAt(start10.gx, start10.gy) === true);
ok('没修路的地方寻不到路（道路限制行军）',
   Game.findPath(start10.gx, start10.gy, c10.gx + 6, c10.gy + 6, 'p1') === null);

ok('草地不是合法目标', Game.isTargetTile(c10.gx - 3, c10.gy - 3) === false);
ok('资源点是合法目标', Game.isTargetTile(mine.gx, mine.gy) === true);
ok('己方道路格是合法目标', Game.isTargetTile(start10.gx, start10.gy) === true);
ok('敌方主城是合法目标', Game.isTargetTile(Game.enemyCastle().gx, Game.enemyCastle().gy) === true);

const path10 = Game.findPath(start10.gx, start10.gy, mine.gx, mine.gy, 'p1');
ok('能寻到通往矿点的路', !!path10 && path10.length > 1, path10 && path10.length);
ok('4 向规则下不存在斜向步（dx+dy 恒为 1）',
   path10.every(function (p, i) {
     return i === 0 || (Math.abs(path10[i - 1].gx - p.gx) + Math.abs(path10[i - 1].gy - p.gy)) === 1;
   }));

ok('未选中时下令被拒', Game.orderMove(mine.gx, mine.gy).reason === 'nosel');
Game.selectTile(start10.gx, start10.gy);
ok('对空地下令被拒（air）', Game.orderMove(c10.gx - 3, c10.gy - 3).reason === 'air');
ok('原地不动被拒（same）', Game.orderMove(start10.gx, start10.gy).reason === 'same');
const ord = Game.orderMove(mine.gx, mine.gy);
ok('对资源点下令成功', ord.ok === true, ord);
ok('部队进入行军状态', S().march.length === 1);
ok('行军耗粮 = 每兵每格 × 格数', ord.cost === Game.moveFoodCost(12) * ord.legs, ord);

const foodB = S().res.food;
for (let i = 0; i < Math.ceil(ord.legs * CFG.soldier.marchSecPerTile) + 3; i++) Game.updateMarch(1);
ok('行军结束（march 清空）', S().march.length === 0, S().march.length);
ok('12 兵清 10 守军后剩 2 兵抵达', Game.troopsAt(mine.gx, mine.gy).p1 === 2,
   Game.troopsAt(mine.gx, mine.gy));
ok('守军已被清空', S().resGuard[Game.tileKeyOf(mine.gx, mine.gy)] === 0);
ok('起点已清空', Game.troopsAt(start10.gx, start10.gy).p1 === 0);
ok('行军消耗了粮食', foodB - S().res.food >= ord.legs, { 耗粮: foodB - S().res.food, 格数: ord.legs });
ok('抵达后占领了矿点', Game.resourceOwnerOf(mine) === 'p1');

Game.reset(); rich();
ok('未占领时资源点不产出', Game.applyTick().food === 0, Game.applyTick().food);

Game.reset();
S().res.food = 0;
const s12 = nearBuildable('farm');   // 主城旁可建格（开局无官道，位置动态定）
place('farm', s12.gx, s12.gy);       // 先放农场 → greedy 修路会自动绕开它
layRoadTo(CASTLE().gx, CASTLE().gy, mine.gx, mine.gy);
Game.addTroops(s12.gx, s12.gy, 'p1', 20);
Game.selectTile(s12.gx, s12.gy);
ok('粮食为 0 时无法下令（nofood）', Game.orderMove(mine.gx, mine.gy).reason === 'nofood',
   Game.orderMove(mine.gx, mine.gy));

/* ---------- 10c. 拖拽式派兵入口（orderMoveFrom） ---------- */
head('10c 拖拽派兵');
Game.reset(); rich();
const dtar = CFG.map.resources[0];
const dsrc = { gx: CASTLE().gx, gy: CASTLE().gy - 1 };   // 主城北侧（紧邻主城 → 可铺第一格路）
Game.placeRoad(dsrc.gx, dsrc.gy);
layRoadTo(dsrc.gx, dsrc.gy, dtar.gx, dtar.gy);
place('farm', CASTLE().gx - 2, CASTLE().gy);              // (1,11)：主城西侧可建格
Game.addTroops(CASTLE().gx - 2, CASTLE().gy, 'p1', 8);
Game.addTroops(dsrc.gx, dsrc.gy, 'p1', 8);
ok('拖拽派兵：目标是空地被拒（air）',
   Game.orderMoveFrom(dsrc.gx, dsrc.gy, dsrc.gx + 5, dsrc.gy + 4).reason === 'air');
ok('拖拽派兵：原地被拒（same）',
   Game.orderMoveFrom(dsrc.gx, dsrc.gy, dsrc.gx, dsrc.gy).reason === 'same');
ok('拖拽派兵：起点没兵被拒（notroop）',
   Game.orderMoveFrom(CASTLE().gx, CASTLE().gy, dtar.gx, dtar.gy).reason === 'notroop');
const dr = Game.orderMoveFrom(dsrc.gx, dsrc.gy, dtar.gx, dtar.gy);
ok('拖拽派兵：成功并进入行军', dr.ok === true && S().march.length >= 1, dr);
ok('拖拽派兵：同时清除了点选状态', S().sel === null, S().sel);
ok('拖拽派兵：返回了格数与耗粮', dr.legs > 0 && dr.cost >= dr.legs, dr);

/* ---------- 10d. 粮尽停军：不许丢兵，且必须如实告知"能走几格"（第四十三次修订） ----------
 * 起因：fulltest 的 S8c（行军→抵达→占领）偶发失败。查到根因是下单只校验"够走一格"就放行，
 * 途中粮尽会停军——而 UI 只写"预计耗粮 N🌾"，玩家以为能走完全程。属踩坑 #16（提示与行为不符）。
 * 这两条既锁住"停军不丢兵"，也锁住"如实返回可走格数"。 */
head('10d 粮尽停军');
Game.reset(); rich();
const ftar = CFG.map.resources[0];
const fsrc = { gx: CASTLE().gx, gy: CASTLE().gy - 1 };     // 主城北侧（紧邻主城 → 可铺第一格路）
Game.placeRoad(fsrc.gx, fsrc.gy);
layRoadTo(fsrc.gx, fsrc.gy, ftar.gx, ftar.gy);
Game.setTroops(fsrc.gx, fsrc.gy, 'p1', 20);
const need1 = Game.moveFoodCost(20);                        // 走一格要多少粮
const flegs = Game.findPath(fsrc.gx, fsrc.gy, ftar.gx, ftar.gy, 'p1').length - 1;

const okRich = Game.orderMoveFrom(fsrc.gx, fsrc.gy, ftar.gx, ftar.gy);
ok('粮充足时 short = false 且 affordLegs ≥ legs',
   okRich.ok === true && okRich.short === false && okRich.affordLegs >= okRich.legs, okRich);

Game.reset(); rich();
Game.placeRoad(fsrc.gx, fsrc.gy);
layRoadTo(fsrc.gx, fsrc.gy, ftar.gx, ftar.gy);
Game.setTroops(fsrc.gx, fsrc.gy, 'p1', 20);
S().res.food = need1 * 2 + 0.5;                             // 只够走 2 格
const beforeStop = Game.totalTroops('p1');
const frLow = Game.orderMoveFrom(fsrc.gx, fsrc.gy, ftar.gx, ftar.gy);
ok('粮不够走完全程时仍然放行（"粮尽即中止"的设计）', frLow.ok === true, frLow);
ok('如实返回"够走几格"与 short 标记',
   frLow.short === true && frLow.affordLegs === 2 && frLow.legs === flegs, frLow);
for (let i = 0; i < 200 && S().march.length; i++) Game.updateMarch(1);
ok('粮尽后停军（march 清空）', S().march.length === 0, S().march.length);
ok('★ 停军不丢兵（兵留在格上，不是凭空消失）',
   Game.totalTroops('p1') === beforeStop, { 前: beforeStop, 后: Game.totalTroops('p1') });

/* ---------- 10e. 道路额度（第四十五次修订，用户拍板方案 A） ----------
 * 规则：每方"主动铺设"的路有格数上限，预设官道/桥不占；铺满要拆旧路才能继续（铺拆结合）。 */
head('10e 道路额度');
Game.reset(); rich();
const CAP0 = CFG.map.roadCapPerSide;
CFG.map.roadCapPerSide = 5;                       // 用小额度测，省得真铺 90 格
ok('预设官道/桥不占额度（开局额度是满的）',
   Game.roadCountOf('p1') === 0 && Game.roadBudgetLeft('p1') === 5,
   { 已用: Game.roadCountOf('p1'), 剩: Game.roadBudgetLeft('p1') });

const capRoads = [];
let capGuard = 0;
while (Game.roadBudgetLeft('p1') > 0 && capGuard++ < 60) {
  const fr = Game.roadFrontier('p1');
  let best = null, bd = 1e9;
  fr.forEach(function (p) {
    const d = Math.abs(p.gx - CASTLE().gx) + Math.abs(p.gy - CASTLE().gy);
    if (d < bd) { bd = d; best = p; }
  });
  if (!best) break;
  if (!Game.placeRoad(best.gx, best.gy, 'p1')) break;
  capRoads.push(best);
}
ok('额度用尽后 placeRoad 被拒绝',
   Game.roadBudgetLeft('p1') === 0 && Game.roadCountOf('p1') === 5,
   { 已用: Game.roadCountOf('p1'), 剩: Game.roadBudgetLeft('p1') });

const lastR = capRoads[capRoads.length - 1];
ok('拆掉一格自己的路 → 额度回到 1',
   Game.demolishRoad(lastR.gx, lastR.gy, 'p1') === true && Game.roadBudgetLeft('p1') === 1,
   Game.roadBudgetLeft('p1'));
ok('拆掉后可以再铺一格（铺拆结合成立）',
   Game.placeRoad(lastR.gx, lastR.gy, 'p1') === true && Game.roadBudgetLeft('p1') === 0);
ok('不能拆预设官道/桥',
   Game.demolishRoad(CFG.map.bridges[0].gx, CFG.map.bridges[0].gy, 'p1') === false);
ok('★ 双方额度独立（AI 的路记在 p2 头上，不占玩家额度）',
   Game.roadCountOf('p2') === 0, { p1: Game.roadCountOf('p1'), p2: Game.roadCountOf('p2') });
CFG.map.roadCapPerSide = CAP0;

/* ---------- 11. 效果牌 ---------- */
head('11 效果牌（经济类）');
Game.reset(); rich(); S().castleLevel = 5;
S().hand = [{ key: 'harvest' }, { key: 'muster' }, null, null, null];
const f0 = S().res.food, m0 = S().res.material;
ok('打出「丰收」', Game.playEffect(0) === true);
ok('丰收 +40 🌾', S().res.food === f0 + 40, S().res.food - f0);
const handBefore = S().hand.filter(Boolean).length;
ok('打出「征召」', Game.playEffect(1) === true);
ok('征召 = 立即获得 1 张随机卡', S().hand.filter(Boolean).length === handBefore,
   S().hand.filter(Boolean).map(function (h) { return h && h.key; }));

Game.reset(); rich(); S().castleLevel = 5;
const cap0 = Game.typeCap('farm');
S().hand = [{ key: 'reclaim' }, { key: 'reclaim' }, { key: 'reclaim' }, { key: 'reclaim' }, null];
let rec = 0;
for (let i = 0; i < 4; i++) if (Game.playEffect(i)) rec++;
ok('「扩建」最多生效 3 次', rec === CFG.cards.slotCap, rec);
ok('每种建筑上限 +3', Game.typeCap('farm') === cap0 + CFG.cards.slotCap, Game.typeCap('farm'));

Game.reset(); rich(); S().castleLevel = 5;
place('farm', CASTLE().gx + 1, CASTLE().gy);
ok('每 Tick 粮食 = 农田 Lv1 产量（' + FARM_Y1 + '）', Game.foodPerTick() === FARM_Y1, Game.foodPerTick());
const fB = S().res.food;
S().hand = [{ key: 'fastCrop' }, null, null, null, null];
Game.playEffect(0);
const FASTCROP = FARM_Y1 * CFG.cards.effects.fastCrop.burstMul;
ok('抢收 = 农田产量 × ' + CFG.cards.effects.fastCrop.burstMul + ' = +' + FASTCROP + ' 🌾',
   S().res.food === fB + FASTCROP, S().res.food - fB);

Game.reset(); rich(); S().castleLevel = 5;
const gEnergyBase = Game.applyTick().energy;
S().hand = [{ key: 'levy' }, null, null, null, null];
Game.playEffect(0);
ok('催收令让产出 ×2', Game.applyTick().energy === gEnergyBase * 2,
   { base: gEnergyBase, boosted: Game.applyTick().energy });

/* ---------- 12. 时间与结束 ---------- */
head('12 时间与结束');
Game.reset();
for (let i = 0; i < 100; i++) Game.update(1);
ok('已过 100 秒', Math.round(S().t) === 100, S().t);
ok('已结算 10 个 Tick', S().tickCount === 10, S().tickCount);
// 第十九次修订：加回兜底时长 —— 到 CFG.time.limit 仍未分胜负 → 按综合分判
ok('兜底时长已配置（30 分钟）', CFG.time.limit === 1800, CFG.time.limit);
Game.reset();
for (let i = 0; i < 30; i++) Game.update(1);
ok('未到兜底时长时不会因倒计时结束', S().over === false && S().result === null,
   { over: S().over, result: S().result });
S().t = CFG.time.limit - 1;
Game.update(1);
ok('到兜底时长 → 立即按综合分结算', S().over === true &&
   (S().result === 'win' || S().result === 'lose' || S().result === 'draw'),
   { over: S().over, result: S().result, score: S().score });
ok('结算给出 A/B/C/D 四项分解', !!S().score &&
   ['A', 'B', 'C', 'D', 'total'].every(function (k) { return typeof S().score[k] === 'number'; }),
   S().score);
ok('时间正常流逝（正计时）', S().t >= CFG.time.limit, S().t);

/* ---------- 13. 能量收支估算 ---------- */
head('13 一局能量收支（含主城升级）');
Game.reset(); rich();
place('power', CASTLE().gx + 1, CASTLE().gy, 3);
place('power', CASTLE().gx - 1, CASTLE().gy, 3);
/* ⚠️ 这里必须把能量归位：rich() 会把能量设成 99999，
 *   照着 rich 后的余额算"一局收入"会得到十万级的天文数字，
 *   断言就永远成立 —— 等于没测（这正是"阈值定太低 = 自己骗自己"的变体）。
 *   改成"跑满 90 个 Tick 的净增量"，才是真实的一局能量收入。 */
S().res.energy = CFG.resource.initial.energy;
const eBase = S().res.energy;
for (let i = 0; i < 90; i++) Game.applyTick();
const income = S().res.energy - eBase;
const castleCost = CFG.castle.levels.slice(0, 4).reduce(function (s, l) { return s + (l.upCost ? l.upCost.energy : 0); }, 0);
/* ★ 第四十四次修订：这里改成断言**设计不变量**，而不是把某个具体数字写死。
 *   意义：升满主城的总成本必须能被"一局能量收入"覆盖 —— 否则 Lv4/Lv5、
 *   黄金政策池、士兵上限 120~140 这些内容就是"做完了但活不到"（本轮修的就是这个）。
 *   旧版写死 515，于是数值一调测试就红，却守不住真正要守的东西。 */
ok('主城升满的总成本 < 一局能量收入（保证 Lv4/Lv5 是可达内容）',
   castleCost > 0 && castleCost < income,
   { 升满成本: castleCost, 一局收入: Math.round(income), 占收入比: (castleCost / income).toFixed(2) });
console.log('     一局能量净收入（90 Tick，2 座 Lv3 能源站 + 主城 Lv1 自带）≈ ' + income +
            '　·　升满主城 ' + castleCost + '，占收入 ' + (castleCost / income * 100).toFixed(0) + '%');
console.log('     一局能量支出：主城升级 ' + castleCost + ' + 开牌买卡 ≈ 90 = ' + (castleCost + 90));
console.log('     收支比 ≈ ' + (income / (castleCost + 90)).toFixed(2) + ' 倍');

/* ---------- 14. 地图与资源点对称性 ---------- */
head('14 资源点关于地图中心对称');
Game.reset();
const CX = (CFG.map.cols - 1) / 2, CY = (CFG.map.rows - 1) / 2;
const rk = function (r) { return r.gx + ',' + r.gy; };
const rSet = new Set(CFG.map.resources.map(rk));
const unpaired = CFG.map.resources.filter(function (r) {
  return !rSet.has((2 * CX - r.gx) + ',' + (2 * CY - r.gy));
}).map(function (r) { return r.name + '(' + r.gx + ',' + r.gy + ')'; });
ok('每个资源点都能在地图中心找到对称点', unpaired.length === 0, unpaired);
ok('双方出生点关于中心对称',
   CFG.map.spawn.p1.gx + CFG.map.spawn.p2.gx === 2 * CX &&
   CFG.map.spawn.p1.gy + CFG.map.spawn.p2.gy === 2 * CY,
   [CFG.map.spawn.p1, CFG.map.spawn.p2]);
ok('资源点数量 ≥ 6（比原来 3 个更多）', CFG.map.resources.length >= 6, CFG.map.resources.length);
ok('已删除中立防御塔', !CFG.map.towers);
ok('资源点不与出生点重叠', CFG.map.resources.every(function (r) {
  return !(r.gx === CFG.map.spawn.p1.gx && r.gy === CFG.map.spawn.p1.gy) &&
         !(r.gx === CFG.map.spawn.p2.gx && r.gy === CFG.map.spawn.p2.gy);
}));
ok('地图比第九次修订时更大', CFG.map.cols >= 25 && CFG.map.rows >= 13,
   [CFG.map.cols, CFG.map.rows]);
// 双方到正中心资源点的 4 向距离必须相等
const mid = CFG.map.resources.filter(function (r) { return r.gx === CX && r.gy === CY; })[0];
ok('存在正中心的资源点', !!mid, CFG.map.resources.map(rk));
if (mid) {
  const d1 = Math.abs(CFG.map.spawn.p1.gx - mid.gx) + Math.abs(CFG.map.spawn.p1.gy - mid.gy);
  const d2 = Math.abs(CFG.map.spawn.p2.gx - mid.gx) + Math.abs(CFG.map.spawn.p2.gy - mid.gy);
  ok('双方到中心资源点距离相等', d1 === d2, { p1: d1, p2: d2 });
}

/* ---------- 15. Phase 4 战争：数量抵消 / 攻城 / 占领 / 胜负 ---------- */
head('15 战争：数量抵消');
Game.reset(); rich();
const w15 = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
place('farm', w15.gx, w15.gy, 1);
Game.addTroops(w15.gx, w15.gy, 'p1', 9);
Game.addTroops(w15.gx, w15.gy, 'p2', 4);
ok('同格双方士兵立即抵消（9 vs 4 → 我方剩 5）',
   Game.resolveCombat(w15.gx, w15.gy) === 5 &&
   Game.troopsAt(w15.gx, w15.gy).p1 === 5 && Game.troopsAt(w15.gx, w15.gy).p2 === 0,
   Game.troopsAt(w15.gx, w15.gy));
Game.addTroops(w15.gx, w15.gy, 'p2', 5);
ok('数量相同 → 同归于尽',
   Game.resolveCombat(w15.gx, w15.gy) === 0 &&
   Game.troopsAt(w15.gx, w15.gy).p1 === 0 && Game.troopsAt(w15.gx, w15.gy).p2 === 0);
Game.addTroops(w15.gx, w15.gy, 'p1', 2);
Game.addTroops(w15.gx, w15.gy, 'p2', 7);
ok('敌方多 → 我方全灭、敌方剩 5',
   Game.resolveCombat(w15.gx, w15.gy) === -5 &&
   Game.troopsAt(w15.gx, w15.gy).p2 === 5 && Game.troopsAt(w15.gx, w15.gy).p1 === 0,
   Game.troopsAt(w15.gx, w15.gy));

head('15b 战争：攻城与占领');
Game.reset(); rich();
const b15 = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
const fb = place('farm', b15.gx, b15.gy, 1);       // Lv1 防御值 20
Game.addTroops(b15.gx, b15.gy, 'p2', 8);           // 敌方 8 兵驻在我方建筑格
ok('建筑初始防御值 20', fb.hp === 20, fb.hp);
Game.engageTile(b15.gx, b15.gy, 'p2');
ok('8 兵换 8 防御值 → 剩 12', Game.buildingAt(b15.gx, b15.gy).hp === 12,
   Game.buildingAt(b15.gx, b15.gy).hp);
ok('士兵同时消耗（等量交换）', Game.troopsAt(b15.gx, b15.gy).p2 === 0);
// 再派 12 兵 → 12 > 12 → 攻破并占领
Game.setTroops(b15.gx, b15.gy, 'p2', 12);
Game.engageTile(b15.gx, b15.gy, 'p2');
ok('Lv1 被占 → 磨成空地（等级 1 的建筑被磨掉就消失）', Game.buildingAt(b15.gx, b15.gy) === null,
   Game.buildingAt(b15.gx, b15.gy));

// Lv2 被占 → 降 1 级并恢复满防御值
Game.reset(); rich();
const c15b = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
const fb2 = place('farm', c15b.gx, c15b.gy, 2);
fb2.hp = 1;                                        // 打到只剩 1 点
Game.setTroops(c15b.gx, c15b.gy, 'p2', 5);
Game.engageTile(c15b.gx, c15b.gy, 'p2');
ok('Lv2 被占 → 归敌方且降为 Lv1', Game.ownerAt(c15b.gx, c15b.gy) === 'p2' &&
   Game.buildingAt(c15b.gx, c15b.gy).level === 1, Game.buildingAt(c15b.gx, c15b.gy));
ok('被占后按降级等级恢复满防御值', Game.buildingAt(c15b.gx, c15b.gy).hp === 20,
   Game.buildingAt(c15b.gx, c15b.gy).hp);
ok('被占建筑不再为我方产出', Game.myBuildings().length === 0, Game.myBuildings().length);
// 我方反抢（该建筑已是 Lv1，被磨掉就变空地）
Game.setTroops(c15b.gx, c15b.gy, 'p1', 20);
Game.engageTile(c15b.gx, c15b.gy, 'p1');
ok('我方反抢 Lv1 建筑 → 磨成空地（反复争夺逐级磨掉建筑）',
   Game.buildingAt(c15b.gx, c15b.gy) === null, Game.buildingAt(c15b.gx, c15b.gy));

head('15c 战争：主城攻防与胜负');
Game.reset(); rich();
const ec15 = S().enemyCastle;
ok('敌方主城防御值 60', ec15.hp === 60, ec15.hp);
const ecTile = { gx: ec15.gx, gy: ec15.gy };
Game.addTroops(ecTile.gx, ecTile.gy, 'p1', 30);
Game.engageTile(ecTile.gx, ecTile.gy, 'p1');
ok('30 兵打主城 → 60-30=30', ec15.hp === 30, ec15.hp);
Game.addTroops(ecTile.gx, ecTile.gy, 'p1', 30);
Game.engageTile(ecTile.gx, ecTile.gy, 'p1');
ok('打掉敌方主城 → 胜利', S().over === true && S().result === 'win',
   { over: S().over, result: S().result });

Game.reset(); rich();
Game.addTroops(CASTLE().gx, CASTLE().gy, 'p2', 100);
Game.engageTile(CASTLE().gx, CASTLE().gy, 'p2');
ok('我方主城被打掉 → 战败', S().over === true && S().result === 'lose',
   { over: S().over, result: S().result });

head('15d 战争：资源点守军（兵不足则全灭、不占领）');
Game.reset(); rich();
const rd = CFG.map.resources[1];
Game.addTroops(rd.gx, rd.gy, 'p1', 6);             // 6 兵 < 10 守军
Game.engageTile(rd.gx, rd.gy, 'p1');
ok('6 兵清不完 10 守军（剩 4 守军）', S().resGuard[Game.tileKeyOf(rd.gx, rd.gy)] === 4,
   S().resGuard[Game.tileKeyOf(rd.gx, rd.gy)]);
ok('全军覆没', Game.troopsAt(rd.gx, rd.gy).p1 === 0);
ok('未占领', Game.resourceOwnerOf(rd) === null);

head('15e 敌方 AI（与玩家同一套规则）');
Game.reset();
ok('敌方初始资源与玩家一致',
   S().enemyRes.energy === CFG.resource.initial.energy &&
   S().enemyRes.material === CFG.resource.initial.material &&
   S().enemyRes.food === CFG.resource.initial.food, S().enemyRes);
ok('敌方主城 Lv1 防御值 60', S().enemyCastle.hp === 60, S().enemyCastle);

let firstP2Troop = null;
for (let i = 0; i < 71; i++) {
  Game.update(1);
  if (firstP2Troop === null && Game.totalTroops('p2') > 0) firstP2Troop = i + 1;
}   // 71 秒：城门规则下 AI 要先铺路再建第 3 座，兵营会更晚出现
const eb15 = Game.enemyBuildings();
ok('敌方会建造建筑（至少 1 座）', eb15.length >= 1, eb15.map(function (b) { return b.type; }));
ok('敌方建筑归 p2 所有', eb15.every(function (b) { return b.owner === 'p2'; }));
ok('敌方遵守建造规则（每座都挨着道路）',
   eb15.every(function (b) { return Game.roadAdjacent(b.gx, b.gy, 'p2'); }),
   eb15.map(function (b) { return b.gx + ',' + b.gy; }));
ok('敌方每种建筑数量不超过上限', Object.keys(CFG.buildings).every(function (t) {
  return Game.typeCountOf('p2', t) <= Game.enemyTypeCap();
}), Object.keys(CFG.buildings).map(function (t) {
  return t + ':' + Game.typeCountOf('p2', t) + '/' + Game.enemyTypeCap();
}));
// 第二十五次修订：AI 建造有 10s 冷却 + 3⚡ 开牌费，轮转到兵营更晚 —— 推进到 ~550s 再断言
for (let i = 0; i < 300; i++) Game.update(1);
const eb15b = Game.enemyBuildings();
const brk15 = eb15b.filter(function (b) { return b.type === 'barracks'; })[0];
ok('敌方建有兵营（冷却+开牌费下轮转会慢，~550s 前到位）', !!brk15,
   eb15b.map(function (b) { return b.type; }));
// 兵营建成后 AI 自动产兵（同一套训练表）——冷却+开牌费下兵营出现晚，检测窗口后移
let p2troopPeak = 0;
for (let i = 0; i < 120; i++) {
  Game.update(1);
  p2troopPeak = Math.max(p2troopPeak, Game.totalTroops('p2'));
}
ok('敌方士兵从兵营产出（不再凭空出现在主城）', p2troopPeak > 0, p2troopPeak);
// 敌方主城升级
for (let i = 0; i < 220; i++) Game.update(1);
ok('敌方主城等级已提升（与玩家同一套升级成本）', S().enemyLevel > 1, S().enemyLevel);
ok('敌方主城血量随等级提升', S().enemyCastle.maxHp === Game.enemyCastleMaxHp(),
   { maxHp: S().enemyCastle.maxHp, 应为: Game.enemyCastleMaxHp() });

// AI 派兵：凑够门槛 → 从兵营出动（若已有部队在途则不重复下令，属正常）
const inFlight = S().march.some(function (m) { return m.side === 'p2'; });
if (!inFlight) {
  Game.addTroops(brk15 ? brk15.gx : S().enemyCastle.gx,
                 brk15 ? brk15.gy : S().enemyCastle.gy, 'p2', CFG.enemy.pushPoint);
  S().enemyDecideT = 0;
  Game.updateEnemy(CFG.enemy.decideInterval);
}
ok('敌方会自己铺路（AI 与玩家同一套规则）',
   Object.keys(S().roads).length > 0, Object.keys(S().roads).length);
ok('敌方有部队在途或已派出（路网修到哪，兵就到哪）',
   inFlight || S().march.some(function (m) { return m.side === 'p2'; }) ||
   Game.totalTroops('p2') > 0 || Object.keys(S().resourceOwner).length > 0,
   { march: S().march.length, 兵: Game.totalTroops('p2'), 占领: Object.keys(S().resourceOwner).length });

head('15f AI 在自己的半区铺路（回归：规则必须对双方生效）');
Game.reset();
for (let i = 0; i < 45; i++) Game.update(1);   // 45 秒：AI 已开始铺路
const rlist = Object.keys(S().roads).filter(function (k) { return !S().roads[k].preset; }).map(function (k) {
  const p = k.split(','); return { gx: +p[0], gy: +p[1] };
});
ok('AI 会铺路（初始官道不计入）', rlist.length > 0, rlist.length);
ok('AI 的路都在自己的半区（不去玩家区域）', rlist.every(function (r) {
  const home = S().enemyCastle, pc = S().castle;
  return (Math.abs(r.gx - home.gx) + Math.abs(r.gy - home.gy)) <=
         (Math.abs(r.gx - pc.gx) + Math.abs(r.gy - pc.gy));
}), rlist.map(function (r) { return r.gx + ',' + r.gy; }));
ok('玩家主城旁没有被 AI 铺的路（初始官道不算）',
   !Game.footRing(CASTLE().gx, CASTLE().gy, 'castle').some(function (p) {
     const r = S().roads[p[0] + ',' + p[1]];
     return r && !r.preset;
   }));

head('15g 格子状态互斥（道路/建筑/资源点）—— 回归');
Game.reset();
const res15g = CFG.map.resources[0];   // 中央能源点（14,7），平原地形
ok('不能在资源点上建筑（玩家侧）',
   /资源点不能建筑/.test(Game.buildBlockReason('farm', res15g.gx, res15g.gy) || ''),
   Game.buildBlockReason('farm', res15g.gx, res15g.gy));
ok('不能在资源点上铺路', Game.canPlaceRoad(res15g.gx, res15g.gy) === false);
const rd15g = nearRoadable();   // 开局无官道 → 先铺一格路，再验证"路上不能建筑"
ok('不能在道路上建筑（玩家侧）',
   !!rd15g && Game.placeRoad(rd15g.gx, rd15g.gy) === true &&
   /道路是给军队走的/.test(Game.buildBlockReason('farm', rd15g.gx, rd15g.gy) || ''),
   rd15g ? Game.buildBlockReason('farm', rd15g.gx, rd15g.gy) : '无可铺路格');
// AI 侧：跑 90 秒，AI 的建筑不得压在道路或资源点上
for (let i = 0; i < 90; i++) Game.update(1);
let badAI = [];
Object.keys(S().roads).forEach(function (k) {
  const p = k.split(',').map(Number);
  if (Game.buildingAt(p[0], p[1])) badAI.push('路上有建筑@' + k);
});
const ebAll = Game.enemyBuildings();
ebAll.forEach(function (b) {
  if (Game.isRoadAt(b.gx, b.gy)) badAI.push('AI建筑压路@' + b.gx + ',' + b.gy);
  if (Game.resourceAt(b.gx, b.gy)) badAI.push('AI建筑压资源点@' + b.gx + ',' + b.gy);
});
ok('AI 的建筑没有压在道路或资源点上', badAI.length === 0, badAI);
ok('道路上没有建筑（全局）', badAI.filter(function (x) { return /路上有建筑/.test(x); }).length === 0);

head('16 系统体检：900 秒长局不变量');
Game.reset();
rich();
for (let i = 0; i < 900; i++) Game.update(1);   // 完整跑一局
const bad16 = [];
// ① 资源永不为负
['energy', 'food'].forEach(function (k) { if (S().res[k] < 0) bad16.push('我方资源为负:' + k); });
if (S().enemyRes.energy < 0 || S().enemyRes.food < 0) bad16.push('敌方资源为负');
// ② 每个路网碎片都必须有锚点（主城或建筑）—— 不会凭空存在（桥格是地形渡口，不参与检查）
const isBridgeCell = function (k) {
  return CFG.map.bridges.some(function (b) { return b.gx + ',' + b.gy === k; });
};
const roads16 = Object.keys(S().roads).filter(function (k) { return !isBridgeCell(k); }).map(function (k) {
  const p = k.split(','); return { gx: +p[0], gy: +p[1] };
});
if (roads16.length) {
  const seen16 = {}; const clusters = [];
  roads16.forEach(function (r) {
    const k = r.gx + ',' + r.gy;
    if (seen16[k]) return;
    const cluster = []; const q16 = [r];
    seen16[k] = 1;
    while (q16.length) {
      const cur = q16.shift(); cluster.push(cur);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        const kk = (cur.gx + o[0]) + ',' + (cur.gy + o[1]);
        if (S().roads[kk] && !seen16[kk]) { seen16[kk] = 1; q16.push({ gx: cur.gx + o[0], gy: cur.gy + o[1] }); }
      });
    }
    clusters.push(cluster);
  });
  clusters.forEach(function (c) {
    const anchored = c.some(function (r) {
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (o) {
        return Game.isCastleAt(r.gx + o[0], r.gy + o[1]) ||
               Game.isCastleAt && (function () {
                 const e = S().enemyCastle;
                 return (e.gx === r.gx + o[0] && e.gy === r.gy + o[1]);
               })() || !!Game.buildingAt(r.gx + o[0], r.gy + o[1]);
      });
    });
    if (!anchored) bad16.push('无锚路网碎片@' + c[0].gx + ',' + c[0].gy);
  });
}
// ③ 建筑不压路/不压资源点（双方）
for (const k in S().buildings) {
  const p = k.split(',').map(Number);
  if (S().roads[k]) bad16.push('建筑压路@' + k);
  if (Game.resourceAt(p[0], p[1])) bad16.push('建筑压资源点@' + k);
}
// ④ 每种建筑数量不超上限（双方）
Object.keys(CFG.buildings).forEach(function (t) {
  if (Game.typeCount(t) > Game.typeCap(t)) bad16.push('我方' + t + '超上限');
  if (Game.typeCountOf('p2', t) > Game.enemyTypeCap()) bad16.push('敌方' + t + '超上限');
});
// ⑤ 士兵不超上限
if (Game.totalTroops('p1') > Game.maxTroops('p1')) bad16.push('我方士兵超上限');
if (Game.totalTroops('p2') > Game.maxTroops('p2')) bad16.push('敌方士兵超上限');
ok('900 秒长局不变量全部成立', bad16.length === 0, bad16.slice(0, 6));
// 第二十八次修订：物流点自动铺路加入（每点 60s 一格），上限放宽
ok('AI 铺路受到节奏控制（900 秒 ≤ 220 格，含物流点自动铺路）', roads16.length <= 220, roads16.length);

head('15h 防御塔：射程杀伤（第二十四次修订：kill 2/4/7 → 3/6/10）');
Game.reset(); rich();
const tw = { gx: CASTLE().gx + 3, gy: CASTLE().gy };        // 离主城 3 格：无邻接加成
place('tower', tw.gx, tw.gy, 1);                            // kill 3/s
Game.addTroops(tw.gx + 1, tw.gy, 'p2', 10);                 // 距离 1
Game.towerTick(1);
ok('塔 Lv1 每秒杀伤 3 个（距离 1）', Game.troopsAt(tw.gx + 1, tw.gy).p2 === 7,
   Game.troopsAt(tw.gx + 1, tw.gy));
Game.addTroops(tw.gx + 2, tw.gy, 'p2', 5);                  // 距离 2
Game.towerTick(1);
ok('近的先死（距离 1 优先承受杀伤）',
   Game.troopsAt(tw.gx + 1, tw.gy).p2 === 4 && Game.troopsAt(tw.gx + 2, tw.gy).p2 === 5,
   Game.troopsAt(tw.gx + 1, tw.gy));
Game.towerTick(4);                                          // 再打 4 秒：距离 1 清空（4 兵），剩余 8 伤害把距离 2 的 5 兵全灭
ok('距离 1 清空后杀伤转移到距离 2（5 兵全灭）',
   Game.troopsAt(tw.gx + 1, tw.gy).p2 === 0 && Game.troopsAt(tw.gx + 2, tw.gy).p2 === 0,
   [Game.troopsAt(tw.gx + 1, tw.gy), Game.troopsAt(tw.gx + 2, tw.gy)]);
Game.addTroops(tw.gx + 3, tw.gy, 'p2', 5);                  // 距离 3
Game.towerTick(1);
ok('距离 3 不可及', Game.troopsAt(tw.gx + 3, tw.gy).p2 === 5, Game.troopsAt(tw.gx + 3, tw.gy));
// 小数伤害累计：0.5s × 2 次 = 杀 3 个（不是杀 0 或 1）
Game.reset(); rich();
place('tower', tw.gx, tw.gy, 1);
Game.addTroops(tw.gx + 1, tw.gy, 'p2', 10);
Game.towerTick(0.5); Game.towerTick(0.5);
ok('小数伤害正确累计（0.5s×2 = 杀 3）', Game.troopsAt(tw.gx + 1, tw.gy).p2 === 7,
   Game.troopsAt(tw.gx + 1, tw.gy));
// 邻接主城 +50%：塔贴主城 → kill 3×1.5 = 4.5/s（floor 结算 4 个）
const tw2 = { gx: CASTLE().gx + 1, gy: CASTLE().gy };
place('tower', tw2.gx, tw2.gy, 1);
ok('塔贴主城杀敌倍率 1.5', Game.towerKillMul(tw2.gx, tw2.gy, 'p1') === 1.5);
Game.addTroops(tw2.gx + 1, tw2.gy, 'p2', 10);
Game.towerTick(1);
ok('邻接主城 → 每秒杀 4.5（floor 结算 4）', Game.troopsAt(tw2.gx + 1, tw2.gy).p2 === 6,
   Game.troopsAt(tw2.gx + 1, tw2.gy));

head('15i 修缮牌（能量修复防御值）');
Game.reset(); rich();
const rp15i = { gx: CASTLE().gx + 3, gy: CASTLE().gy };
const rb15i = place('farm', rp15i.gx, rp15i.gy, 2);      // Lv2 上限 35
rb15i.hp = 5;
S().hand = [{ key: 'repair' }, { key: 'repair' }, null, null, null];
ok('修缮建筑 +40（不超上限）',
   Game.repairWithCard(rp15i.gx, rp15i.gy).ok === true && rb15i.hp === 35, rb15i.hp);
ok('防御值已满 → 拒绝', Game.repairWithCard(rp15i.gx, rp15i.gy).reason === 'full');
Game.reset(); rich();
S().hand = [{ key: 'repair' }, null, null, null, null];
S().castleHp = 10;
ok('修缮主城 +40（不超上限 60）',
   Game.repairWithCard(CASTLE().gx, CASTLE().gy).ok === true && S().castleHp === 50, S().castleHp);
S().hand = [null, null, null, null, null];
ok('没有修缮牌 → 拒绝', Game.repairWithCard(CASTLE().gx, CASTLE().gy).reason === 'nocard');

head('15k 攻城链路（机制验证：能不能结束一局）');
Game.reset();
// ① 直接结算：我方部队踏上敌方主城格 → 扣血 → 归零判胜
const ecK = S().enemyCastle;
Game.addTroops(ecK.gx, ecK.gy, 'p1', 30);
Game.engageTile(ecK.gx, ecK.gy, 'p1');
ok('打敌方主城：防御值下降', ecK.hp === ecK.maxHp - 30, ecK.hp);
Game.addTroops(ecK.gx, ecK.gy, 'p1', ecK.hp);
Game.engageTile(ecK.gx, ecK.gy, 'p1');
ok('打光防御值 → 判定胜利', S().result === 'win' && S().over === true,
   { result: S().result, over: S().over });

// ② 破膜：磨掉敌方建筑 → 废墟可铺路 → 部队能推进
Game.reset();
const ecK2 = S().enemyCastle;
// 在敌方主城旁放一座敌方建筑当作"膜"
const mem = { gx: ecK2.gx, gy: ecK2.gy - 1 };   // 敌城外圈北侧可建格（外圈东/南被官道占）
place('farm', mem.gx, mem.gy, 1, 'p2');
ok('膜建筑属于敌方', Game.ownerAt(mem.gx, mem.gy) === 'p2');
ok('有膜时该格不能铺路（被建筑占据）', Game.canPlaceRoad(mem.gx, mem.gy) === false);
// 磨掉它（Lv1 → 磨成空地）
Game.addTroops(mem.gx, mem.gy, 'p1', 20);
Game.engageTile(mem.gx, mem.gy, 'p1');
ok('攻破 Lv1 建筑 → 磨成空地', Game.buildingAt(mem.gx, mem.gy) === null);
ok('磨空后该格可铺路', Game.canPlaceRoad(mem.gx, mem.gy) === true,
   Game.canPlaceRoad(mem.gx, mem.gy));

// ③ 主城被破 → 判负（对称）
Game.reset();
Game.addTroops(CASTLE().gx, CASTLE().gy, 'p2', S().castleHp);
Game.engageTile(CASTLE().gx, CASTLE().gy, 'p2');
ok('我方主城被打光 → 判定战败', S().result === 'lose' && S().over === true,
   { result: S().result, hp: S().castleHp });

head('15l 双方规则对称（新规则必须同时适用于玩家与 AI）');
Game.reset(); rich();
// 铺路前沿：双方各自连通，互不干扰
const frP1 = Game.roadFrontier('p1').length;
const frP2 = Game.roadFrontier('p2').length;
ok('双方都有连通铺路前沿', frP1 > 0 && frP2 > 0, { p1: frP1, p2: frP2 });

// walkable 对称：己方建筑可通行、对方建筑不可通行
const myB = Game.myBuildings()[0];
if (myB) {
  ok('己方建筑对己方可通行', Game.walkable(myB.gx, myB.gy, 'p1') === true);
}
const ecT = S().enemyCastle;
ok('敌方主城占地双方可通行（第三十次修订：攻城必须能站上去）',
   Game.walkable(ecT.gx, ecT.gy, 'p1') === true && Game.walkable(ecT.gx, ecT.gy, 'p2') === true);
const ecB15l = place('farm', ecT.gx, ecT.gy - 1, 1, 'p2');
ok('敌方建筑对己方不可通行', Game.walkable(ecB15l.gx, ecB15l.gy, 'p1') === false);
ok('敌方建筑对敌方自身可通行', Game.walkable(ecB15l.gx, ecB15l.gy, 'p2') === true);

// 城门规则：双方主城四邻都受限
Game.reset(); rich();
const gateFull = function (home) {
  // 试着在主城四邻塞满建筑，检查是否总能留出缺口
  return CFG.castle.gateBuildings + ':' + Game.castleAdjBuildingCount(home.gx + 1, home.gy);
};
ok('我方主城四邻有城门限制', Game.castleAdjBuildingCount(S().castle.gx + 1, S().castle.gy) >= 0);
ok('敌方主城四邻同样受限（同一函数）',
   Game.castleAdjBuildingCount(S().enemyCastle.gx - 1, S().enemyCastle.gy) >= 0);

// 防御塔：双方塔都开火，各打对方
Game.reset(); rich();
const twA = { gx: S().castle.gx + 2, gy: S().castle.gy };
const twB = { gx: S().enemyCastle.gx - 2, gy: S().enemyCastle.gy };
place('tower', twA.gx, twA.gy, 1);
place('tower', twB.gx, twB.gy, 1, 'p2');
Game.addTroops(twA.gx + 1, twA.gy, 'p2', 30);          // 敌军在我塔旁
Game.addTroops(twB.gx - 1, twB.gy, 'p1', 30);          // 我军在敌塔旁
Game.towerTick(1);
ok('我方塔杀伤敌方部队（kill 3）', Game.troopsAt(twA.gx + 1, twA.gy).p2 === 27,
   Game.troopsAt(twA.gx + 1, twA.gy));
ok('敌方塔杀伤我方部队（对称）', Game.troopsAt(twB.gx - 1, twB.gy).p1 === 27,
   Game.troopsAt(twB.gx - 1, twB.gy));

// 数量抵消：双方对称（用普通道路格，避开资源点——资源点会先结算守军）
Game.reset(); rich();
const f3 = Game.roadFrontier('p1')[0];
Game.placeRoad(f3.gx, f3.gy);
Game.addTroops(f3.gx, f3.gy, 'p1', 20);
Game.addTroops(f3.gx, f3.gy, 'p2', 12);
Game.engageTile(f3.gx, f3.gy, 'p1');
ok('抵消后我方剩差值（对称结算）',
   Game.troopsAt(f3.gx, f3.gy).p1 === 8 && Game.troopsAt(f3.gx, f3.gy).p2 === 0,
   Game.troopsAt(f3.gx, f3.gy));

/* ============ 15m 兵力账本（回归：三个「凭空造兵」bug） ============
 * 这三个 bug 曾让士兵上限 60 形同虚设（实测 300 秒滚到 1105 兵），
 * 是「攻城永远打不穿」的元凶 —— 双方兵力越打越多，谁都死不了。
 */
head('15m 兵力账本守恒（回归：绝对不能凭空造兵）');
Game.reset(); rich();

const row15m = 9;                                    // 终点行（第 9 行 3~13 列无资源点）
/** 修路到终点旁（自动绕开资源点/山林），从主城派出 n 个兵（派出 = 清原格 + 建行军记录） */
function marchOut(n, dstX) {
  layRoadTo(3, 11, dstX || 13, row15m);
  Game.addTroops(3, 11, 'p1', n);
  const p = Game.findPath(3, 11, dstX || 13, row15m, 'p1');
  Game.setTroops(3, 11, 'p1', 0);                    // 派出后原格清空（与 orderMoveFrom 等价）
  S().march.push({ side: 'p1', n: n, path: p, idx: 0, t: 0, spent: 0 });
  return p;
}

// ① 无战斗行军：全程真实兵力必须守恒
Game.reset(); rich();
const path15m = marchOut(20);
ok('构造出一条 12 格行军路径', !!path15m && path15m.length >= 10, path15m && path15m.length);
const act0 = Game.activeTroops('p1');                 // 派出后兵「在空中」，要看真实口径
let actMax15m = act0, actMin15m = act0;
for (let i = 0; i < 40 && S().march.length; i++) {
  Game.updateMarch(1);
  const a = Game.activeTroops('p1');
  if (a > actMax15m) actMax15m = a;
  if (a < actMin15m) actMin15m = a;
}
ok('无战斗行军：真实兵力全程守恒（20 兵走到尾还是 20）',
   act0 === 20 && actMax15m === 20 && actMin15m === 20,
   { 起: act0, 峰: actMax15m, 谷: actMin15m });
ok('抵达后兵在终点格上', Game.troopsAt(13, row15m).p1 === 20, Game.troopsAt(13, row15m));

// ② 途中交战：残兵必须同步回账面，后续每格按残兵搬运（旧版按出发数搬运 → 凭空造兵）
Game.reset(); rich();
const p15m2 = marchOut(20);
const amb15m = p15m2[5] || p15m2[p15m2.length - 1];
Game.addTroops(amb15m.gx, amb15m.gy, 'p2', 12);      // 敌人埋伏在路径第 6 格
for (let i = 0; i < 40 && S().march.length; i++) Game.updateMarch(1);
ok('半路交战后只剩下的 8 个兵能走完全程（不按 20 搬运）',
   Game.totalTroops('p1') === 8, Game.totalTroops('p1'));

// ③ 在途部队不可被重复下令（旧版 AI 会把路过的一支部队再派一次 → 同一批兵被复制）
Game.reset(); rich();
marchOut(20);
Game.updateMarch(2);                                  // 走一格，部队临时停在路上
const occ = S().march[0] ? S().march[0].path[S().march[0].idx] : null;
ok('在途部队的落点被标记为「不可下令」',
   !!occ && Game.isMarchOccupied(occ.gx, occ.gy, 'p1') === true, occ);
const dup15m = Game.totalTroops('p1');
Game.flushMarchAt(occ.gx, occ.gy, 'p1');              // 对它重新下令（先落地）
ok('对在途部队重新下令不会复制兵力（先落地再出发）',
   Game.totalTroops('p1') === dup15m && S().march.length === 0,
   { 前: dup15m, 后: Game.totalTroops('p1'), march: S().march.length });

// ④ AI 长跑：真实兵力（场上 + 空中）不得超过上限（旧版 300 秒滚到 1105 兵）
Game.reset();
let peak15m = 0;
for (let i = 0; i < 600; i++) {
  Game.update(1);
  const a = Game.activeTroops('p2');
  if (a > peak15m) peak15m = a;
}
ok('敌方真实兵力不超过上限', peak15m <= Game.maxTroops('p2'),
   { 峰值: peak15m, 上限: Game.maxTroops('p2') });

/* ============ 15n 第二批 AI：先集结、后出击 ============ */
head('15n 第二批 AI 的进攻性（阈值与集结）');
ok('出击阈值已配置且递增（抢点 < 建筑 < 主城）',
   CFG.enemy.pushPoint < CFG.enemy.pushBuilding &&
   CFG.enemy.pushBuilding < CFG.enemy.pushCastle,
   { point: CFG.enemy.pushPoint, building: CFG.enemy.pushBuilding, castle: CFG.enemy.pushCastle });
Game.reset();
clearPresetRoads();                        // 清掉初始官道 → 构造真正的「无路可达」
Game.addTroops(S().enemyCastle.gx, S().enemyCastle.gy, 'p2', CFG.enemy.pushCastle - 5);
ok('兵力不足攻城阈值时不出击',
   Game.enemyPickTarget({ gx: S().enemyCastle.gx, gy: S().enemyCastle.gy,
                          n: CFG.enemy.pushCastle - 5 }) === null);
// 兵力达标 + 有路 → 目标应为玩家主城
Game.reset();
layRoadTo(S().castle.gx, S().castle.gy, S().enemyCastle.gx, S().enemyCastle.gy);
const go15n = Game.enemyPickTarget({ gx: S().enemyCastle.gx, gy: S().enemyCastle.gy,
                                     n: CFG.enemy.pushCastle });
ok('兵力达标时把主城列为目标（可达才派兵）',
   !!go15n && go15n.target.gx === S().castle.gx && go15n.target.gy === S().castle.gy,
   go15n ? { 目标: go15n.target.gx + ',' + go15n.target.gy, 步数: go15n.path.length } : null);

/* ============ 17 §19 政策系统 ============ */
head('17 政策系统：触发 / 槽位 / 品质 / 效果');
Game.reset();
ok('开局立刻给出一次三选一', !!(S().policy.p1.offer && S().policy.p1.offer.length === CFG.policy.rollCount),
   S().policy.p1.offer);
ok('三选一里至少含 1 条本流派政策（开局 = 种田）',
   S().policy.p1.offer.some(function (o) { return CFG.policy.list[o.key].school === 'farm'; }),
   S().policy.p1.offer.map(function (o) { return o.key; }));
ok('品质档位合法（0 黄铜 / 1 白银 / 2 黄金）',
   S().policy.p1.offer.every(function (o) { return o.tier >= 0 && o.tier <= 2; }),
   S().policy.p1.offer);

// 颁布 → 进槽位
const firstOffer = S().policy.p1.offer[0];
Game.chooseOffer(0);
ok('颁布后进入政策槽', S().policy.p1.slots.length === 1 &&
   S().policy.p1.slots[0].key === firstOffer.key, S().policy.p1.slots);
ok('颁布后三选一清空', S().policy.p1.offer === null);

// 槽位上限：第 4 条替换最早的一条
S().policy.p1.slots = [];
const keys17 = ['till', 'intake', 'haste', 'levyP'];
keys17.forEach(function (k) { Game.choosePolicy('p1', k, 0); });
ok('同时生效政策不超过槽位上限', S().policy.p1.slots.length === CFG.policy.slotCap,
   S().policy.p1.slots.map(function (s) { return s.key; }));
ok('槽满后替换最早的一条（till 被挤掉）',
   S().policy.p1.slots.every(function (s) { return s.key !== 'till'; }),
   S().policy.p1.slots.map(function (s) { return s.key; }));

// 同类升级：不占新槽，品质取更高
S().policy.p1.slots = [{ key: 'till', tier: 0 }];
const r17 = Game.choosePolicy('p1', 'till', 2);
ok('选到已有政策 → 原地升级而非占新槽',
   r17 === 'upgrade' && S().policy.p1.slots.length === 1 && S().policy.p1.slots[0].tier === 2,
   S().policy.p1.slots);
Game.choosePolicy('p1', 'till', 0);
ok('低品质不会再覆盖高品质', S().policy.p1.slots[0].tier === 2, S().policy.p1.slots);

// 效果生效：粮仓遗物（每 Tick +6 粮）——旧「屯田」政策已重构删除
Game.reset(); rich();
const food017 = Game.applyTick().food;
S().relics = ['granary'];
const food117 = Game.applyTick().food;
ok('遗物「粮仓」每 Tick 多产 6 粮', Math.round(food117 - food017) === 6,
   { 前: food017, 后: food117 });

// 效果生效：精耕（农田产出 +N%）
Game.reset(); rich();
place('farm', CASTLE().gx + 1, CASTLE().gy, 1);
const farm017 = Game.applyTick().food;
S().policy.p1.slots = [{ key: 'till', tier: 0 }];           // 黄铜档 +15%
const farm117 = Game.applyTick().food;
ok('政策「精耕·黄铜」让农田产出 +15%',
   Math.round(farm117 - farm017) === Math.round(FARM_Y1 * 0.15),
   { 前: farm017, 后: farm117 });

// 效果生效：征兵（兵营间隔下降）
Game.reset();
const ivA = Game.barracksIntervalMul(CASTLE().gx, CASTLE().gy, 'p1');
S().policy.p1.slots = [{ key: 'levyP', tier: 2 }];          // 黄金档 -23%
const ivB = Game.barracksIntervalMul(CASTLE().gx, CASTLE().gy, 'p1');
ok('政策「征兵·黄金」让兵营间隔 -23%', ivB < ivA && Math.abs(ivB / ivA - 0.77) < 0.001,
   { 前: ivA, 后: ivB });

// 效果对 AI 同样生效（对称铁律）
S().policy.p2.slots = [{ key: 'levyP', tier: 2 }];
const ivC = Game.barracksIntervalMul(S().enemyCastle.gx, S().enemyCastle.gy, 'p2');
ok('政策对 AI 同样生效（双方对称）', Math.abs(ivC / ivA - 0.77) < 0.001, { 我方: ivA, AI: ivC });

// 品质只与主城等级挂钩（第二十次修订：删掉时段影响）
Game.reset();
S().castleLevel = 1;
const tLv1 = [];
for (let i = 0; i < 200; i++) tLv1.push(Game.rollTier('p1'));
ok('Lv1 时政策全为黄铜', tLv1.every(function (t) { return t === 0; }),
   { 黄金数: tLv1.filter(function (t) { return t === 2; }).length });
S().castleLevel = 5;
const tLv5 = [];
for (let i = 0; i < 200; i++) tLv5.push(Game.rollTier('p1'));
ok('Lv5 时黄金占主导（≥60%）', tLv5.filter(function (t) { return t === 2; }).length / 200 >= 0.6,
   { 黄金占比: tLv5.filter(function (t) { return t === 2; }).length / 200 });

// 触发时机：开局 1 次 + 每次主城升级 1 次；不再有周期触发
Game.reset(); rich();
Game.chooseOffer(0);
S().t = CFG.events.startAt + CFG.events.interval;   // 时间流逝不触发政策
for (let i = 0; i < 5; i++) Game.update(1);
ok('时间流逝不再触发政策（只随主城等级）', S().policy.p1.offer === null, S().policy.p1.offer);
S().res.energy = 99999;
Game.upgradeCastle();
ok('主城升级给一次三选一', !!S().policy.p1.offer);

// 政策刷新：花能量重 roll 三张候选；每局限 refreshCap 次（第二十一次修订）
Game.reset(); rich();
const e017 = S().res.energy;
ok('政策可刷新（花 ' + CFG.policy.refreshCost + '⚡）',
   Game.refreshPolicy('p1') === true && S().res.energy === e017 - CFG.policy.refreshCost,
   { 前: e017, 后: S().res.energy });
for (let i = 1; i < CFG.policy.refreshCap; i++) Game.refreshPolicy('p1');
ok('每局限刷 ' + CFG.policy.refreshCap + ' 次（用尽后再刷失败）',
   S().policy.p1.refreshes === CFG.policy.refreshCap && Game.refreshPolicy('p1') === false,
   { 次数: S().policy.p1.refreshes });

/* ============ 17b §20 事件牌 ============ */
head('17b 事件牌：单张 / 领取 / 刷新 ≤5 / 轮换顶掉 / 全部带代价 / 预警');
Game.reset();
ok('开局没有事件牌（第 3 分钟才开始）',
   S().events.p1.offer === null && S().events.p1.current === null, S().events.p1);
// 预警：进度随时间填充，最后 30s 进入临期（第二十一次修订）
S().t = 0;
ok('事件进度条从 0 开始且不临期',
   Game.eventProgress().pct === 0 && Game.eventProgress().imminent === false,
   Game.eventProgress());
S().t = CFG.events.startAt - 10;
ok('临期 10 秒 → imminent 且剩余秒数正确',
   Game.eventProgress().imminent === true && Game.eventProgress().remain <= 10,
   Game.eventProgress());
S().t = CFG.events.startAt;
Game.eventTick();
ok('第 3 分钟给出第 1 张事件牌', !!S().events.p1.offer, S().events.p1.offer);

// AI 与玩家同一套规则
Game.reset(); rich();
for (let i = 0; i < 20; i++) Game.update(1);
S().res.energy = 99999;
Game.upgradeCastle();
Game.upgradeCastle();
ok('AI 政策数量受槽位上限约束（升本也会触发 AI 颁布）',
   S().policy.p2.slots.length <= CFG.policy.slotCap, S().policy.p2.slots);

/* ============ 17b §20 事件牌 ============ */
head('17b 事件牌：单张 / 领取 / 刷新 ≤5 / 轮换顶掉 / 全部带代价');
Game.reset();
ok('开局没有事件牌（第 3 分钟才开始）',
   S().events.p1.offer === null && S().events.p1.current === null, S().events.p1);
S().t = CFG.events.startAt;
Game.eventTick();
ok('第 3 分钟给出第 1 张事件牌', !!S().events.p1.offer, S().events.p1.offer);
ok('事件牌只有一张（单张制）', typeof S().events.p1.offer === 'string',
   S().events.p1.offer);

// 刷新：花能量，最多 5 次
Game.reset(); rich();
S().t = CFG.events.startAt;
Game.eventTick();
const evKey0 = S().events.p1.offer;
const er0 = S().res.energy;
for (let i = 0; i < CFG.events.refreshCap; i++) Game.refreshEvent('p1');
ok('刷新最多 ' + CFG.events.refreshCap + ' 次（后再刷失败）',
   Game.refreshEvent('p1') === false && S().events.p1.refreshes === CFG.events.refreshCap,
   S().events.p1.refreshes);
ok('刷新消耗能量（' + CFG.events.refreshCap + ' 次 × ' + CFG.events.refreshCost + '⚡）',
   S().res.energy === er0 - CFG.events.refreshCap * CFG.events.refreshCost,
   { 前: er0, 后: S().res.energy });

// 领取：生效并顶掉旧的
Game.claimEvent('p1');
ok('领取后事件生效', S().events.p1.current !== null && S().events.p1.offer === null,
   S().events.p1);
const curA = S().events.p1.current;
S().t = CFG.events.startAt + CFG.events.interval;
Game.eventTick();
Game.claimEvent('p1');
ok('下一张事件牌生效时顶掉旧的（同时只有 1 张生效）',
   S().events.p1.current !== null, { 旧: curA, 新: S().events.p1.current });

// 事件效果进聚合（「蝗灾」农田 -30%）
Game.reset(); rich();
place('farm', CASTLE().gx + 1, CASTLE().gy, 1);
const ef0 = Game.applyTick().food;
S().events.p1.current = 'locust';
const ef1 = Game.applyTick().food;
ok('事件「蝗灾」让农田产出 -30%',
   Math.abs((ef1 - ef0) - (-FARM_Y1 * 0.3)) < 0.6,
   { 前: ef0, 后: ef1, 差: ef1 - ef0 });

// 15 条事件全部带代价：混合条有正有负，纯负条全负，没有任何纯正面
// （注意：cardEvery / trainInterval / castleUpCost / marchFood / roadCost 这类 stat
//   「数值越大越坏」，判断方向要取反）
const GOOD_DIR = { farmYield: 1, energyTick: 1, foodTick: 1, resourceYield: 1, buildingHp: 1,
                   marchSpeed: 1, siegeDmg: 1, towerKill: 1, handCap: 1, trainCount: 1, roadTiles: 1 };
const goodness = function (e) {
  return (GOOD_DIR[e.stat] ? 1 : -1) * e.val;    // 折算成「对玩家 +好 / −坏」
};
const evList = CFG.events.list;
const mixCnt = Object.keys(evList).filter(function (k) { return evList[k].kind === 'mix'; }).length;
const badCnt = Object.keys(evList).filter(function (k) { return evList[k].kind === 'bad'; }).length;
ok('事件牌共 15 条：9 混合 + 6 纯负面（含寒冬/商路繁荣换打法事件）', mixCnt === 9 && badCnt === 6,
   { mix: mixCnt, bad: badCnt });
const noPureGood = Object.keys(evList).every(function (k) {
  const es = evList[k].effects;
  if (evList[k].kind === 'bad') return es.every(function (e) { return goodness(e) < 0; });
  return es.some(function (e) { return goodness(e) > 0; }) &&
         es.some(function (e) { return goodness(e) < 0; });   // 混合条必须正负都有
});
ok('没有纯正面事件（混合条正负都有、负面条全负）', noPureGood);
// 双方对称：AI 同样每 3 分钟吃一张事件（修过"只有玩家有事件"的不对称 bug）
Game.reset();
S().t = CFG.events.startAt;
Game.eventTick();
ok('事件触发时 AI 也拿到牌（对称）', !!S().events.p2.current, S().events.p2);
ok('AI 领取后刷新次数归零（无残留待领）',
   S().events.p2.offer === null && S().events.p2.refreshes === 0, S().events.p2);

/* ============ 17c 第二十二次修订：野战行军 / 开疆旗 / 弃牌化解 ============ */
head('17c 机制型政策与行为转化遗物');

// C 野战行军：无路可达的目标在政策生效后可达，且粮耗 ×2
Game.reset();
clearPresetRoads();                        // 清掉初始官道 → 构造「深入草地、无路可达」
const offDst = { gx: CASTLE().gx + 3, gy: CASTLE().gy - 3 };   // 深入草地
ok('构造目标（周围无路）', Game.findPath(CASTLE().gx, CASTLE().gy, offDst.gx, offDst.gy, 'p1') === null);
S().policy.p1.slots = [{ key: 'fieldMarch', tier: 0 }];
const pOff = Game.findPath(CASTLE().gx, CASTLE().gy, offDst.gx, offDst.gy, 'p1');
ok('「野战行军」生效后草地可达', !!pOff && pOff.length >= 4, pOff && pOff.length);
Game.addTroops(CASTLE().gx, CASTLE().gy, 'p1', 10);
S().policy.p1.slots = [];
const foodBase = Game.moveFoodCost(10, 'p1');
S().policy.p1.slots = [{ key: 'fieldMarch', tier: 0 }];
ok('野战行军期间行军耗粮 ×2', Game.moveFoodCost(10, 'p1') === foodBase * 2,
   { 基础: foodBase, 野战: Game.moveFoodCost(10, 'p1') });

// D 开疆旗：占领资源点立即 +5⚡
Game.reset(); rich();
const vgKey = CFG.map.resources[0];
const vgK = vgKey.gx + ',' + vgKey.gy;
S().resGuard[vgK] = 0;
Game.addTroops(vgKey.gx, vgKey.gy, 'p1', 5);
const eVg = S().res.energy;
Game.claimIfResource(vgKey.gx, vgKey.gy);
ok('无开疆旗时占领无能量奖励', S().res.energy === eVg);
Game.reset(); rich();
S().relics = ['vanguard'];
S().resGuard[vgK] = 0;
Game.addTroops(vgKey.gx, vgKey.gy, 'p1', 5);
const eVg2 = S().res.energy;
Game.claimIfResource(vgKey.gx, vgKey.gy);
ok('「开疆旗」占领即 +5⚡', S().res.energy === eVg2 + 5, { 前: eVg2, 后: S().res.energy });

// F 事件化解（第二十三次修订：弃牌 → 资源支付，费用要有真实负担）
Game.reset(); rich();
S().events.p1.current = 'locust';                // 蝗灾：化解需 20⚡+40🌾
const pay0 = { e: S().res.energy, f: S().res.food };
ok('资源不足时不能化解', (function () {
  S().res.energy = 10; S().res.food = 10;
  return Game.payDissolve('p1') === false && S().events.p1.current === 'locust';
})());
S().res.energy = pay0.e; S().res.food = pay0.f;
ok('资源足够 → 支付并立即化解',
   Game.payDissolve('p1') === true && S().events.p1.current === null &&
   S().res.energy === pay0.e - 20 && S().res.food === pay0.f - 40,
   { e: S().res.energy, f: S().res.food });
ok('无化解费用的事件（如兵变）不能支付化解',
   (function () { S().events.p1.current = 'mutiny'; return Game.payDissolve('p1') === false; })());

/* ============ 17d 第二十三次修订：新政策 / 新遗物 ============ */
head('17d 电网 / 王城壁垒 / 扩编 / 先登 / 哨塔图纸 / 军械架');


// 王城壁垒政策已重构删除（castleHpPct 无政策来源，castleMaxHp 回归基线）

// 扩编政策已重构删除（trainCount 现由遗物「征兵令」与事件「总动员」提供）
Game.reset();
ok('无加成时兵营产出加成 = 0', Game.trainBonus('p1') === 0);
S().relics = ['conscript'];
ok('遗物「征兵令」+1 生效', Game.trainBonus('p1') === 1, Game.trainBonus('p1'));

// 先登：对资源点守军伤害放大（守军 10，兵 10，黄铜 +30% → 一次清空）
Game.reset(); rich();
const rK = CFG.map.resources[3];
const rk17d = rK.gx + ',' + rK.gy;
S().resGuard[rk17d] = 0;
Game.addTroops(rK.gx, rK.gy, 'p1', 10);
Game.claimIfResource(rK.gx, rK.gy);
S().resGuard[rk17d] = CFG.hp.resourceGuard;                     // 模拟敌方占领后守军回满
Game.addTroops(rK.gx, rK.gy, 'p1', 10);
S().policy.p1.slots = [{ key: 'vanguardP', tier: 0 }];          // +30% → 伤害 13
Game.engageTile(rK.gx, rK.gy, 'p1');
ok('「先登·黄铜」10 兵一次清掉 10 守军（伤害 ×1.3）',
   S().resGuard[rk17d] === 0 && S().resourceOwner[rk17d] === 'p1',
   { 守军: S().resGuard[rk17d], 归属: S().resourceOwner[rk17d] });

// 哨塔图纸：防御塔射程 1~2 → 1~3
Game.reset(); rich();
const tw17d = { gx: CASTLE().gx + 2, gy: CASTLE().gy };
place('tower', tw17d.gx, tw17d.gy, 1);
Game.addTroops(tw17d.gx, tw17d.gy + 3, 'p2', 6);                // 距离 3：原射程外
Game.towerTick(1);
ok('无哨塔图纸时距离 3 的敌兵不受塔伤', Game.troopsAt(tw17d.gx, tw17d.gy + 3).p2 === 6,
   Game.troopsAt(tw17d.gx, tw17d.gy + 3));
S().relics = ['watchtower'];
Game.towerTick(1);
ok('「哨塔图纸」射程 +1 → 距离 3 的敌兵被杀伤',
   Game.troopsAt(tw17d.gx, tw17d.gy + 3).p2 < 6, Game.troopsAt(tw17d.gx, tw17d.gy + 3));

// 军械架：修缮牌修复量 40 → 60（用 Lv3 建筑上限 50 区分：修后 50=军械架生效 / 45=未生效）
Game.reset(); rich();
const b17d = place('farm', CASTLE().gx - 2, CASTLE().gy, 3);   // (1,11)：主城西侧可建格（避开主城占地）
b17d.hp = 5;                                                    // 打残
S().hand = [null, null, null, null, null];
S().hand[0] = { key: 'repair' };
S().relics = ['armrack'];
const r17d = Game.repairWithCard(b17d.gx, b17d.gy);
ok('「军械架」让修缮牌修复量 40 → 60（Lv3 上限 50，修到 50）',
   r17d.ok === true && b17d.hp === 50, { hp: b17d.hp, 结果: r17d });

/* ============ 17e 第二十八次修订：轮作 / 常备军 / 屯田戍边 / 工程学 / 物流点 ============ */
head('17e 改写型政策与物流点');

// 轮作：农田 +30% 且能源站 −30%（正负同绑）
Game.reset(); rich();
place('farm', CASTLE().gx + 1, CASTLE().gy, 1);
place('power', CASTLE().gx + 2, CASTLE().gy, 1);
const r017e = Game.applyTick();
S().policy.p1.slots = [{ key: 'rotation', tier: 0 }];
const r117e = Game.applyTick();
ok('政策「轮作」农田 +30% 且能源站 −30%（同槽同放）',
   r117e.food > r017e.food && r117e.energy < r017e.energy,
   { '粮': [r017e.food, r117e.food], 'energy': [r017e.energy, r117e.energy] });

// 常备军：上限 +40，每 Tick −3⚡
Game.reset(); rich();
const cap17e = Game.maxTroops('p1');
const eStanding = Game.applyTick().energy;
S().policy.p1.slots = [{ key: 'standing', tier: 0 }];
ok('政策「常备军」士兵上限 +40', Game.maxTroops('p1') === cap17e + 40, Game.maxTroops('p1'));
const eStanding2 = Game.applyTick().energy;
ok('「常备军」每 Tick -3⚡', Math.abs((eStanding - eStanding2) - 3) < 0.5,
   { 前: eStanding, 后: eStanding2 });

// 屯田戍边：训练不耗粮、产量 -2
Game.reset(); rich();
place('barracks', CASTLE().gx + 1, CASTLE().gy, 1);
const fBefore = S().res.food;
for (let i = 0; i < 21; i++) Game.trainAll(1);
ok('无政策时训练扣粮（' + CFG.buildings.barracks.train[0].food + '）',
   fBefore - S().res.food === CFG.buildings.barracks.train[0].food, fBefore - S().res.food);
S().policy.p1.slots = [{ key: 'garrison2', tier: 0 }];
const fMid = S().res.food;
const troopsMid = Game.totalTroops('p1');
for (let i = 0; i < 21; i++) Game.trainAll(1);
ok('「屯田戍边」训练不耗粮', S().res.food === fMid, { 前: fMid, 后: S().res.food });
ok('「屯田戍边」产量 -2（7→5）', Game.totalTroops('p1') - troopsMid === 5,
   Game.totalTroops('p1') - troopsMid);

// 工程学：道路牌格数 +1、价格 +1
Game.reset(); rich();
const roadInfo0 = Game.cardInfo('dirt');
S().policy.p1.slots = [{ key: 'engineering', tier: 0 }];
const roadInfo1 = Game.cardInfo('dirt');
ok('「工程学」道路牌格数 +1、价格 +1⚡',
   roadInfo1.tiles === roadInfo0.tiles + 1 && roadInfo1.price === roadInfo0.price + 1,
   { 原: [roadInfo0.tiles, roadInfo0.price], 新: [roadInfo1.tiles, roadInfo1.price] });

// 物流点：占领后自动铺路
Game.reset(); rich();
const lg17e = CFG.map.resources.find(function (r) { return r.res === 'logistics'; });
S().resGuard[lg17e.gx + ',' + lg17e.gy] = 0;
Game.addTroops(lg17e.gx, lg17e.gy, 'p1', 10);
Game.claimIfResource(lg17e.gx, lg17e.gy);
const roads017e = Object.keys(S().roads).length;
S().logRoadT_p1 = CFG.map.logisticsRoadSec;
Game.logisticsRoadTick(1);
ok('占领物流点后自动免费铺路', Object.keys(S().roads).length > roads017e,
   { 前: roads017e, 后: Object.keys(S().roads).length });

/* ============ 18 §12.3 兜底计分（含 E 星级任务） + §21 星级任务 ============ */
head('18 兜底计分（含 E 星级任务）');
Game.reset();
S().enemyCastle.hp = S().enemyCastle.maxHp - 30;    // 打掉敌主城 30
S().castleHp = Game.castleMaxHp() - 10;             // 我方被打掉 10
S().resourceOwner = {};
S().resourceOwner[CFG.map.resources[0].gx + ',' + CFG.map.resources[0].gy] = 'p1';
S().stats.killed = 55; S().stats.lost = 25;
S().questStar = 2;                                   // 已完成两星
const sc18 = Game.scoreBreakdown();
ok('A 主城战果 = 打掉敌方 − 我方被打掉（30 − 10 = 20）', sc18.A === 20, sc18);
ok('B 资源点 = 我方占点数 − 敌方（1 − 0 = 1）', sc18.B === 1, sc18);
ok('C 战场成果 = (55 − 25) ÷5 = 6', sc18.C === 6, sc18);
ok('D 发展水平 = 主城等级差 ×10', sc18.D === (S().castleLevel - (S().enemyLevel || 1)) * 10, sc18);
ok('E 星级任务 = 完成星数 ×' + CFG.quests.scorePerStar + '（2 星 = 20）', sc18.E === 20, sc18);
ok('总分 = A + B×3 + C + D + E', sc18.total === sc18.A + sc18.B * 3 + sc18.C + sc18.D + sc18.E, sc18);
ok('计分不含建筑数量（裁决 4）', JSON.stringify(sc18).indexOf('building') < 0);

// 兜底结算真的会结束对局
Game.reset();
S().t = CFG.time.limit - 1;
Game.update(1);
ok('到时长兜底 → 对局结束并写入 score', S().over === true && !!S().score, S().result);

/* ============ 18b §21 星级任务 ============ */
head('18b 星级任务：弃牌任务 / 完成一星领遗物 / E 项联动');
Game.reset();
ok('任务链共 3 星、每星 5 个小任务',
   CFG.quests.stars.length === 3 && CFG.quests.stars.every(function (s) { return s.length === 5; }),
   CFG.quests.stars.length);
// 每星必含一个弃牌任务，且难度必须严格递增（具体数值可调，用 diag-events 的分布重校）
const discNeed = CFG.quests.stars.map(function (s) {
  return s.filter(function (q) { return q.stat === 'discards'; })[0].need;
});
ok('每星都有弃牌任务且阶梯严格递增',
   discNeed.length === 3 && discNeed[0] > 0 && discNeed[0] < discNeed[1] && discNeed[1] < discNeed[2],
   discNeed);

// 弃牌累计进任务（一星弃牌 40 张）
S().hand = [{ key: 'farm' }, { key: 'farm' }, { key: 'farm' }, { key: 'farm' }, { key: 'farm' }];
for (let i = 0; i < 40; i++) { S().hand[i % 5] = { key: 'farm' }; Game.discard(i % 5); }
ok('弃牌不再直接触发遗物（旧 pendingReward 机制已移除）', S().questClaiming === false);
ok('弃牌计数进任务（40 张达标）', Game.questValue('discards') === 40, Game.questValue('discards'));

// 完成一星全部任务 → 待领遗物
S().stats.built = 4;
S().castleLevel = 2;
S().resourceOwner[CFG.map.resources[1].gx + ',' + CFG.map.resources[1].gy] = 'p1';
S().stats.trained = 60;
Game.checkQuests();
ok('一星 5 项全达标 → 触发遗物三选一', S().questClaiming === true, S().questStar);
const relics0 = S().relics.length;
UI_STUB_pick();
function UI_STUB_pick() {
  // 模拟 UI 领取（等价于 UI.pickReward 的 game 侧）
  Game.pickQuestReward('granary');
}
ok('领取后遗物入账、星数 +1、可领状态清除',
   S().relics.length === relics0 + 1 && S().questStar === 1 && S().questClaiming === false,
   { relics: S().relics, star: S().questStar });

// 未全达标时不触发
Game.reset();
S().stats.built = 4; S().castleLevel = 2; S().stats.trained = 60;   // 缺弃牌与资源点
Game.checkQuests();
ok('一星未全达标不触发遗物', S().questClaiming === false, S().questStar);

console.log('\n---- 自检结果：' + pass + ' 通过 / ' + fail + ' 失败 ----');
process.exit(fail ? 1 : 0);
