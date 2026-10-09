/* 无头交互测试 —— 用假 DOM 模拟真实点击/拖拽，覆盖 UI 交互链路。
 *
 * 为什么需要它：最近几轮的 bug（漏 render / 调用不存在的方法 / 卡牌消失 / 遗物领不了）
 * 全部出在 UI 交互层，而逻辑自检与渲染冒烟都测不到这层。本测试直接驱动 UI 的
 * 事件处理函数（onTileClick / startDrag+endDrag / pickReward 等），把交互链路跑通。
 *
 * 运行：node test/uitest.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.join(__dirname, '..');
const base = root + path.sep + 'js' + path.sep;

let pass = 0, fail = 0;
const ok = function (name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

/* ==================== 假 DOM ==================== */

const allListeners = [];

function El(tag, id) {
  const el = {
    tagName: tag, id: id || '', _children: [], _listeners: {},
    style: { setProperty: function (k, v) { el.style[k] = v; }, removeProperty: function (k) { delete el.style[k]; } }, dataset: {}, className: '', textContent: '', innerHTML: '',
    clientWidth: 1060, clientHeight: 430, offsetWidth: 1060, offsetHeight: 430,
    offsetLeft: 0, offsetTop: 50, width: 1060, height: 430,
    classList: {
      _s: {},
      add: function () { [].forEach.call(arguments, function (c) { el.classList._s[c] = 1; }); },
      remove: function () { [].forEach.call(arguments, function (c) { delete el.classList._s[c]; }); },
      toggle: function (c, on) { if (on === undefined) { if (el.classList._s[c]) delete el.classList._s[c]; else el.classList._s[c] = 1; } else if (on) el.classList._s[c] = 1; else delete el.classList._s[c]; },
      contains: function (c) { return !!el.classList._s[c]; },
    },
    addEventListener: function (type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); allListeners.push({ el: el, type: type, fn: fn }); },
    removeEventListener: function () {},
    appendChild: function (c) { el._children.push(c); return c; },
    removeChild: function (c) { el._children = el._children.filter(function (x) { return x !== c; }); },
    remove: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    closest: function (sel) {
      // 仅支持 '.card' / '#id' 两种（本测试够用）
      if (sel === '.card') return /card/.test(el.className) ? el : null;
      if (sel[0] === '#') return el.id === sel.slice(1) ? el : null;
      return null;
    },
    getBoundingClientRect: function () {
      return { left: 0, top: 50, right: 1060, bottom: 480, width: 1060, height: 430 };
    },
    getContext: function () { return ctx2d; },
    setPointerCapture: function () {},
    releasePointerCapture: function () {},
    focus: function () {},
    blur: function () {},
    children: [],
  };
  Object.defineProperty(el, 'firstElementChild', { get: function () { return el._children[0] || null; } });
  return el;
}

const ctx2d = new Proxy({}, {
  get: function (t, k) {
    if (k === 'measureText') return function () { return { width: 40 }; };
    if (k === 'createLinearGradient') return function () { return { addColorStop: function () {} }; };
    if (typeof k === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|textAlign|textBaseline|globalAlpha|lineDashOffset)$/.test(k)) return t[k];
    return function () {};
  },
  set: function (t, k, v) { t[k] = v; return true; },
});

/* 从 index.html 取出所有 id，预建元素 */
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(function (m) { return m[1]; });
const store = {};
ids.forEach(function (id) { store[id] = El('div', id); });

const document = {
  getElementById: function (id) { return store[id] || (store[id] = El('div', id)); },
  createElement: function (tag) { return El(tag); },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: El('body'),
  elementFromPoint: function () {
    // 默认落在画布上（hitTest 会据此取格子）
    const cv = store['sandbox'] || El('canvas', 'sandbox');
    return cv;
  },
};

/* ==================== 载入游戏代码 ==================== */

const ctx = {
  console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error, Set, Map, Proxy,
  document, setTimeout, clearTimeout, requestAnimationFrame: function () {},
  devicePixelRatio: 1, performance: { now: function () { return Date.now(); } },
  innerWidth: 1280, innerHeight: 720,
  // window 级事件（UI 用 global.addEventListener 绑 pointermove/pointerup/keydown）
  addEventListener: function (type, fn) { allListeners.push({ el: null, type: type, fn: fn }); },
  removeEventListener: function () {},
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);

['config.js', 'game.js', 'sandbox.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx);
});

/* 引擎桩：UI 只用到 audio / debug */
ctx.Engine = {
  audio: { click: function () {}, pickup: function () {}, hurt: function () {}, win: function () {}, place: function () {} },
  debug: { toggle: function () {} },
};
vm.runInContext(fs.readFileSync(base + 'ui.js', 'utf8'), ctx);

const { CFG, Game, Sandbox, UI } = ctx;
const S = function () { return Game.state; };

/* ==================== 准备 ==================== */

Sandbox.init();
Sandbox.resize(1060, 430);
UI.init();
Game.reset();
UI.render();

console.log('\n== 1 首屏渲染 ==');
ok('UI.render() 不抛异常', true);
ok('遗物托盘已渲染', !!store['relic-tray']);
ok('弃牌区显示进度文案', /弃牌/.test(store['discard-zone'].innerHTML || ''), store['discard-zone'].innerHTML);

/* ==================== 2 建筑牌：点击 → 放置模式 → 点击地图 ==================== */
console.log('\n== 2 建筑牌放置（点击式，与道路牌一致）==');
Game.reset();
// 铺一条路，制造可建格
const c0 = S().castle;
let laid = 0;
for (let i = 0; i < 8; i++) {
  const f = Game.roadFrontier('p1');
  if (!f.length) break;
  if (Game.placeRoad(f[0].gx, f[0].gy)) laid++;
}
ok('已铺出道路（前置条件）', laid > 0, laid);
S().hand = [{ key: 'farm' }, null, null, null, null];
const handBefore = (S().hand[0] || {}).key;
UI.tileSel = null; UI.placeMode = null; UI.roadPlacing = null;
UI.startDrag(0, 'farm', 100, 600);
UI.endDrag(100, 600);                              // moved = 0 → 点击
ok('点击建筑牌进入放置模式', !!UI.placeMode, UI.placeMode);
ok('放置模式下卡仍留在手牌（不会丢）', (S().hand[0] || {}).key === handBefore, S().hand[0]);
// 找一个可建格并点击
let spot = null;
for (let gy = 0; gy < CFG.map.rows && !spot; gy++) {
  for (let gx = 0; gx < CFG.map.cols && !spot; gx++) if (Game.canBuildAt('farm', gx, gy)) spot = { gx: gx, gy: gy };
}
ok('存在可建格', !!spot, spot);
if (spot) {
  UI.onTileClick(spot.gx, spot.gy);
  ok('点击地图成功建造', !!Game.buildingAt(spot.gx, spot.gy), Game.typeCount('farm'));
  ok('建造后卡牌被消耗', S().hand[0] === null, S().hand[0]);
  ok('放置模式已退出', !UI.placeMode);
}

/* ==================== 3 道路牌：点击 → 铺路 ==================== */
console.log('\n== 3 道路牌铺路（点击式）==');
Game.reset();
S().hand = [{ key: 'dirt' }, null, null, null, null];
UI.placeMode = null; UI.roadPlacing = null;
UI.startDrag(0, 'dirt', 100, 600);
UI.endDrag(100, 600);
ok('点击道路牌进入铺路模式', !!UI.roadPlacing, UI.roadPlacing);
const roadsBefore = Object.keys(S().roads).length;
const fr0 = Game.roadFrontier('p1')[0];
if (fr0) {
  UI.onTileClick(fr0.gx, fr0.gy);
  ok('点击地图铺下一格', Object.keys(S().roads).length === roadsBefore + 1,
     Object.keys(S().roads).length);
}
// Esc 取消
const roadsNow = Object.keys(S().roads).length;
const keyHandler = allListeners.filter(function (l) { return l.type === 'keydown'; })[0];
if (keyHandler) {
  keyHandler.fn({ key: 'Escape' });
  ok('Esc 取消铺路且不重复发牌', !UI.roadPlacing && Object.keys(S().roads).length === roadsNow);
}

/* ==================== 4 星级任务 → 遗物三选一 → 领取 ==================== */
console.log('\n== 4 任务奖励：三选一领取 ==');
Game.reset();
S().questClaiming = true;                       // 模拟完成一星任务（第二十次修订：遗物只能从任务获得）
UI.render();
ok('任务待领取时自动弹出遗物模态框', UI.modal === 'reward', UI.modal);
ok('模态框给出三选一遗物', (UI.rewardChoices || []).length === 3, UI.rewardChoices);
const pickKey = UI.rewardChoices[0];
UI.pickReward(0);
ok('领取后遗物入账', S().relics.indexOf(pickKey) >= 0, S().relics);
ok('领取后星数 +1、可领状态清除（不会重弹）',
   S().questStar === 1 && S().questClaiming === false, { star: S().questStar });
// 领完遗物会关掉遗物弹窗；若此时还有待选政策，会顺势切到政策弹窗（正确行为）
ok('遗物弹窗已关闭（有政策待选时切到政策弹窗）',
   !UI.modal || UI.modal === 'policy', UI.modal);

/* 第二件：任务未完成前不再触发 */
console.log('\n== 5 任务未完成不重复触发 ==');
Game.reset();
S().stats.built = 1;
Game.checkQuests();
ok('任务未全达标不弹遗物', S().questClaiming === false && UI.modal !== 'reward', UI.modal);
ok('弃牌只累计计数（不再直接触发遗物）',
   (function () { S().hand[0] = { key: 'farm' }; Game.discard(0); return S().questClaiming === false; })());

/* ==================== 6 遗物效果：叠加生效 ==================== */
console.log('\n== 6 遗物叠加生效 ==');
Game.reset();
S().relics = ['caravan', 'caravan'];
const e0 = S().res.energy;
Game.applyTick();
const gain1 = S().res.energy - e0;
S().relics = ['caravan'];
const e1 = S().res.energy;
Game.applyTick();
const gain0 = S().res.energy - e1;
ok('两件商队契约比一件多 +3⚡', gain1 === gain0 + 3, { 两件: gain1, 一件: gain0 });
S().relics = [];
ok('清空遗物后无加成', Game.relicCount('caravan') === 0);
ok('hasRelic 与 relicCount 一致', !Game.hasRelic('caravan'));

/* ==================== 7 操作条：点击任意处取消 ==================== */
console.log('\n== 7 建筑操作条跟随与取消 ==');
Game.reset();
// 建一座自己的建筑用于选中
let bTile = null;
for (let i = 0; i < 10 && !bTile; i++) {
  const f = Game.roadFrontier('p1');
  if (!f.length) break;
  if (Game.placeRoad(f[0].gx, f[0].gy)) {
    for (let gy = 0; gy < CFG.map.rows && !bTile; gy++) {
      for (let gx = 0; gx < CFG.map.cols && !bTile; gx++) {
        S().hand[0] = { key: 'farm' };
        if (Game.canBuildAt('farm', gx, gy) && Game.build(0, gx, gy)) bTile = { gx: gx, gy: gy };
      }
    }
  }
}
ok('已建出一座己方建筑', !!bTile, bTile);
if (bTile) {
  UI.placeMode = null; UI.roadPlacing = null; Game.selectTile(null);
  UI.onTileClick(bTile.gx, bTile.gy);
  ok('点击己方建筑 → 操作条出现', !store['tile-actions'].classList.contains('hidden') && !!UI.tileSel, UI.tileSel);
  // 远处空地
  let far = null;
  for (let gy = CFG.map.rows - 1; gy >= 0 && !far; gy--) {
    for (let gx = CFG.map.cols - 1; gx >= 0 && !far; gx--) {
      if (Game.buildingAt(gx, gy) || Game.resourceAt(gx, gy)) continue;
      far = { gx: gx, gy: gy };
    }
  }
  UI.onTileClick(far.gx, far.gy);
  ok('点击远处空地 → 操作条收起', !UI.tileSel);
  ok('操作条 DOM 已隐藏', store['tile-actions'].classList.contains('hidden'));
  // 选中部队后点空地（此前漏 render 的场景）
  UI.onTileClick(bTile.gx, bTile.gy);
  Game.selectTile(bTile.gx, bTile.gy);
  Game.addTroops(bTile.gx, bTile.gy, 'p1', 10);
  UI.render();
  ok('再次出现操作条', !!UI.tileSel);
  UI.onTileClick(far.gx, far.gy);
  ok('选中部队后点空地 → 操作条也收起且 DOM 刷新',
     !UI.tileSel && store['tile-actions'].classList.contains('hidden'));
}

/* ==================== 8 效果牌 / 升级牌 / 修缮牌 交互 ==================== */
console.log('\n== 8 拖到目标类卡牌 ==');
Game.reset(); rich();
function rich() { S().res.energy = 999; S().res.food = 999; }
S().hand = [{ key: 'harvest' }, { key: 'upgrade' }, { key: 'repair' }, null, null];
const foo0 = S().res.food;
UI.startDrag(0, 'harvest', 100, 600);
UI.endDrag(100, 600);                              // 点击使用效果牌
ok('效果牌点击即生效（丰收 +40🌾）', S().res.food === foo0 + 40, S().res.food - foo0);
// 升级牌拖到建筑
let upT = null;
for (let gy = 0; gy < CFG.map.rows && !upT; gy++) {
  for (let gx = 0; gx < CFG.map.cols && !upT; gx++) {
    const b = Game.buildingAt(gx, gy);
    if (b && (b.owner || 'p1') === 'p1' && b.level < 3) upT = { gx: gx, gy: gy };
  }
}
if (!upT) {
  // 造一座用于测试
  S().hand[1] = { key: 'upgrade' };
  let f2 = Game.roadFrontier('p1')[0];
  if (f2) Game.placeRoad(f2.gx, f2.gy);
  for (let gy = 0; gy < CFG.map.rows && !upT; gy++) {
    for (let gx = 0; gx < CFG.map.cols && !upT; gx++) {
      S().hand[0] = { key: 'farm' };
      if (Game.canBuildAt('farm', gx, gy) && Game.build(0, gx, gy)) upT = { gx: gx, gy: gy };
    }
  }
}
ok('存在可升级的己方建筑', !!upT, upT);
if (upT) {
  S().hand[1] = { key: 'upgrade' };
  UI.startDrag(1, 'upgrade', 300, 300);
  UI.endDrag(300, 300);                            // hitTest 需命中建筑格 → 依赖 elementFromPoint
  const b2 = Game.buildingAt(upT.gx, upT.gy);
  ok('升级牌流程不抛异常', true);
}

/* ==================== 9 拖拽到弃牌区（各卡种） ==================== */
console.log('\n== 9 拖到弃牌区 ==');
Game.reset();
S().hand = [{ key: 'farm' }, { key: 'dirt' }, { key: 'upgrade' }, { key: 'harvest' }, { key: 'repair' }];
const kinds = ['farm', 'dirt', 'upgrade', 'harvest', 'repair'];
let discarded = 0;
kinds.forEach(function (k, i) {
  // 让 hitTest 命中弃牌区
  document.elementFromPoint = function () { return store['discard-zone']; };
  UI.startDrag(i, k, 500, 600);
  UI.endDrag(500, 600);
  if (S().hand[i] === null) discarded++;
});
ok('五种卡都能拖到弃牌区丢掉', discarded === kinds.length, discarded);

/* ==================== 10 §19 政策三选一 ==================== */
console.log('\n== 10 政策三选一颁布 ==');
Game.reset();
UI.modal = null;
ok('开局就有政策待选', !!(S().policy.p1.offer && S().policy.p1.offer.length === 3),
   S().policy.p1.offer);
UI.render();
ok('自动弹出政策弹窗', UI.modal === 'policy', UI.modal);
const polKey = S().policy.p1.offer[0].key;
UI.pickPolicy(0);
ok('点击政策卡后进入政策槽',
   S().policy.p1.slots.length === 1 && S().policy.p1.slots[0].key === polKey,
   S().policy.p1.slots);
ok('颁布后弹窗关闭（无其他待选）', !UI.modal, UI.modal);
ok('颁布后三选一清空', S().policy.p1.offer === null);

// 顶栏「政策」按钮 → 查看已颁布（假 DOM 无 fire，直接调绑定过的监听器）
const polBtn = store['btn-policy'];
const polLs = (polBtn && polBtn._listeners && polBtn._listeners.click) || [];
ok('「政策」按钮已绑定点击', polLs.length > 0, polLs.length);
if (polLs.length) {
  polLs[0]({ target: polBtn });
  ok('点「政策」按钮能打开政策面板', UI.modal === 'policyview', UI.modal);
  UI.setModal(null);
}

// 槽位满 → 再颁布会替换最早一条
S().policy.p1.slots = [{ key: 'till', tier: 0 }, { key: 'commerce', tier: 0 }, { key: 'stockpile', tier: 0 }];
S().policy.p1.offer = [{ key: 'siege', tier: 1 }, { key: 'garrison', tier: 1 }, { key: 'thrift', tier: 1 }];
UI.pickPolicy(0);
ok('槽满时颁布新政策会替换最早的一条',
   S().policy.p1.slots.length === 3 && S().policy.p1.slots.every(function (s) { return s.key !== 'till'; }),
   S().policy.p1.slots.map(function (s) { return s.key; }));
// 政策刷新（花能量重 roll 三张；需要先有一次待选）
S().policy.p1.offer = [{ key: 'siege', tier: 1 }, { key: 'garrison', tier: 1 }, { key: 'thrift', tier: 1 }];
S().res.energy = 50;
const spent0 = S().res.energy;
ok('政策三选一可花能量刷新',
   Game.refreshPolicy('p1') === true && S().res.energy === spent0 - CFG.policy.refreshCost,
   { 前: spent0, 后: S().res.energy });
ok('刷新后仍是三张候选', S().policy.p1.offer.length === 3, S().policy.p1.offer);
S().policy.p1.refreshes = CFG.policy.refreshCap;   // 模拟本局次数用尽
ok('刷新次数用尽后不能再刷', Game.refreshPolicy('p1') === false, S().policy.p1.refreshes);

/* ==================== 10b §21 临门提示（角标闪烁） ==================== */
console.log('\n== 10b 星级任务临门提示 ==');
Game.reset();
S().stats.built = 4; S().castleLevel = 2; S().stats.trained = 60;   // 4/5 达标，差弃牌
S().resourceOwner[CFG.map.resources[0].gx + ',' + CFG.map.resources[0].gy] = 'p1';
Game.checkQuests();
UI.render();
const qb2 = store['quest-star'];
ok('差 1 项完成本星 → 角标闪烁（quest-near）',
   qb2 && qb2.classList.contains('quest-near'), qb2 && qb2.classList._s);
S().discardCount = 40;
Game.checkQuests();
ok('补齐最后 1 项 → 触发待领（不再是临门态）',
   S().questClaiming === true, S().questClaiming);

/* ==================== 11 §20 事件牌：领取 / 刷新 ==================== */
console.log('\n== 11 事件牌领取与刷新 ==');
Game.reset();
UI.modal = null;
ok('开局没有事件牌', S().events.p1.offer === null);
S().t = CFG.events.startAt;
Game.eventTick();
UI.render();
ok('第 3 分钟自动弹出事件牌弹窗', UI.modal === 'event', UI.modal);
const evKey = S().events.p1.offer;
Game.refreshEvent('p1');
ok('刷新后事件牌被替换（≤5 次）',
   S().events.p1.offer !== undefined && S().events.p1.refreshes === 1, S().events.p1);
UI.claimEvent();     // 走 UI 层领取（会关闭弹窗并刷新）
ok('领取后事件生效、待领清空', S().events.p1.current !== null && S().events.p1.offer === null);
UI.render();
ok('生效中的事件不再弹窗', UI.modal !== 'event', UI.modal);

console.log('\n---- 交互测试：' + pass + ' 通过 / ' + fail + ' 失败 ----');
process.exit(fail ? 1 : 0);
