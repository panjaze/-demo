/* sandbox 冒烟测试 —— 用假 canvas 跑一遍 Sandbox.init/render，
 * 专门用来抓「渲染中途抛异常」这类在无头环境里看不出来的问题
 * 运行：node test/smoke.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const base = path.join(__dirname, '..', 'js') + path.sep;

/* ---- 假 CanvasRenderingContext2D（记录绘制调用，便于断言"真的画出来了"） ---- */
const drawn = { texts: [], fills: 0, rects: [] };
function makeCtx() {
  const noop = function () {};
  return {
    canvas: null,
    save: noop, restore: noop, translate: noop, scale: noop, setTransform: noop,
    clearRect: noop,
    fillRect: function (x, y, w, h) { drawn.fills++; drawn.rects.push({ x: x, y: y, w: w, h: h }); },
    strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
    drawImage: noop,
    fill: noop, stroke: noop, clip: noop,
    fillText: function (t, x, y) { drawn.texts.push({ t: String(t), x: x, y: y }); },
    strokeText: noop,
    setLineDash: noop, measureText: function () { return { width: 10 }; },
    createLinearGradient: function () { return { addColorStop: noop }; },
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineDashOffset: 0,
    font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
  };
}

/* ---- 假 DOM ---- */
function makeEl(tag) {
  const el = {
    tagName: tag, style: {}, dataset: {}, children: [],
    clientWidth: 1060, clientHeight: 430, offsetWidth: 1060, offsetHeight: 430,
    width: 0, height: 0, innerHTML: '', textContent: '', className: '',
    classList: {
      add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; },
    },
    addEventListener: function () {}, removeEventListener: function () {},
    appendChild: function (c) { el.children.push(c); return c; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getContext: function () { return makeEl._ctx || (makeEl._ctx = makeCtx()); },
    getBoundingClientRect: function () { return { left: 0, top: 0, right: 1060, bottom: 430, width: 1060, height: 430 }; },
    closest: function () { return null; },
  };
  return el;
}

const els = {};
const document = {
  getElementById: function (id) {
    if (!els[id]) {
      const el = makeEl('div');
      el.parentElement = { clientWidth: 1060, clientHeight: 430 };
      els[id] = el;
    }
    return els[id];
  },
  createElement: function (t) { return makeEl(t); },
  querySelector: function () { return makeEl('div'); },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: makeEl('body'),
};

const ctx = {
  console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error, Set,
  document, performance: { now: function () { return Date.now(); } },
  devicePixelRatio: 1,
  requestAnimationFrame: function () {},
  setTimeout: setTimeout,
};
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);

vm.runInContext(fs.readFileSync(base + 'config.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(base + 'game.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync(base + 'sandbox.js', 'utf8'), ctx);

const { CFG, Game, Sandbox } = ctx;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

console.log('== sandbox 冒烟 ==');
Game.reset();

try {
  Sandbox.init();
  ok('Sandbox.init() 不抛异常', true);
} catch (e) {
  ok('Sandbox.init() 不抛异常', false, e.message + '\n' + e.stack);
}

try {
  Sandbox.render();
  ok('空场景 render() 不抛异常', true);
} catch (e) {
  ok('空场景 render() 不抛异常', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join(' | '));
}

// 构造一个真实场景：主城 + 各类建筑 + 部队 + 选中 + 行军
const c = Game.state.castle;
/** 找一个贴官道、整块占地可建的位置（主城外圈已被初始官道占满） */
function findSpot(type) {
  for (let gy = 0; gy < CFG.map.rows; gy++) {
    for (let gx = 0; gx < CFG.map.cols; gx++) {
      if (Game.footRoadAdjacent(gx, gy, type, 'p1') && Game.isBuildableFoot(type, gx, gy)) {
        return { gx: gx, gy: gy };
      }
    }
  }
  return { gx: c.gx, gy: c.gy - 1 };
}
function put(type, gx, gy, level, pending) {
  Game.state.buildings[Game.tileKeyOf(gx, gy)] =
    { gx: gx, gy: gy, type: type, level: level, pending: !!pending, trainT: 0 };
  Game.reindex();                     // 占地索引必须重建，selectTile/troops 才能找到它
}
const sF = findSpot('farm');
put('farm', sF.gx, sF.gy, 2, false);
const sB = findSpot('barracks');          // 放完一座再找下一座 → 不会互相覆盖
put('barracks', sB.gx, sB.gy, 1, true);
const sT = findSpot('tower');
put('tower', sT.gx, sT.gy, 3, false);
Game.state.resourceOwner[Game.tileKeyOf(CFG_res0().gx, CFG_res0().gy)] = 'p1';
Game.addTroops(sF.gx, sF.gy, 'p1', 12);
Game.addTroops(sB.gx, sB.gy, 'p2', 7);
Game.selectTile(sF.gx, sF.gy);
Game.state.castleMovePending = true;

function CFG_res0() { return ctx.CFG.map.resources[0]; }

try {
  Sandbox.render();
  ok('完整场景 render() 不抛异常', true);
} catch (e) {
  ok('完整场景 render() 不抛异常', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
}

// 行军中的部队
try {
  Game.selectTile(c.gx + 1, c.gy);
  Game.orderMove(ctx.CFG.map.resources[0].gx, ctx.CFG.map.resources[0].gy);
  Sandbox.render();
  ok('有行军部队时 render() 不抛异常', true);
} catch (e) {
  ok('有行军部队时 render() 不抛异常', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
}

// 拖卡预览
try {
  Sandbox.dropPreview = { handIdx: 0, key: 'farm' };
  Game.state.hand[0] = { key: 'farm' };
  Sandbox.render();
  ok('拖卡预览 render() 不抛异常', true);
} catch (e) {
  ok('拖卡预览 render() 不抛异常', false, e.message + '\n' + (e.stack || '').split('\n').slice(0, 5).join(' | '));
}

// 相机
try {
  Sandbox.panBy(50, 30);
  Sandbox.zoomAt(1.3, 300, 200);
  Sandbox.centerOn(3, 6);
  ok('相机操作不抛异常', true);
} catch (e) {
  ok('相机操作不抛异常', false, e.message);
}
ok('缩放比例在合法区间', Sandbox.scale > 0.4 && Sandbox.scale < 2.3, Sandbox.scale);

// 平移与缩放"真的能改变视角"（不只是不报错）
Sandbox.centerOn(10, 4);                       // 先挪到地图中间，避免被边缘钳制
const cam0 = { x: Sandbox.camX, y: Sandbox.camY };
Sandbox.panBy(-80, -50);
ok('平移确实改变了相机', Sandbox.camX !== cam0.x && Sandbox.camY !== cam0.y,
   { before: cam0, after: { x: Sandbox.camX, y: Sandbox.camY } });
const sc0 = Sandbox.scale;
Sandbox.zoomAt(1.3, 300, 200);
ok('缩放确实改变了比例', Math.abs(Sandbox.scale - sc0) > 1e-6, { before: sc0, after: Sandbox.scale });
ok('缩放后镜头锚点保持稳定（以指针为锚点）',
   (function () {
     // 先对准主城，再以主城屏幕位置为锚点缩放，主城应仍在原处附近
     const cs = Game.state.castle;
     Sandbox.centerOn(cs.gx, cs.gy);
     const before = Sandbox.tileRect(cs.gx, cs.gy);
     const ax = before.x + before.w / 2, ay = before.y + before.h / 2;
     Sandbox.zoomAt(1.4, ax, ay);
     const after = Sandbox.tileRect(cs.gx, cs.gy);
     const moved = Math.abs(after.x + after.w / 2 - ax) + Math.abs(after.y + after.h / 2 - ay);
     return moved < 2;
   })());
ok('「回城」后主城一定在视口内',
   (function () {
     const cs = Game.state.castle;
     Sandbox.centerOn(cs.gx, cs.gy);
     const r = Sandbox.tileRect(cs.gx, cs.gy);
     return r.x >= 0 && r.y >= 0 && r.x + r.w <= Sandbox.cw && r.y + r.h <= Sandbox.ch;
   })());
Sandbox.zoomAt(1 / 1.4, 300, 200);

// 拾取
try {
  const t = Sandbox.pickTile(300, 200);
  ok('pickTile 返回格子坐标', !!t && typeof t.gx === 'number' && typeof t.gy === 'number', t);
} catch (e) {
  ok('pickTile 不抛异常', false, e.message);
}

/* ---------- 断言「真的画出来了」，而不只是"没报错" ---------- */
console.log('\n== 绘制内容断言 ==');
drawn.texts.length = 0; drawn.fills = 0;
Sandbox.render();
const texts = drawn.texts.map(function (o) { return o.t; });
ok('画出了主城 🏰', texts.indexOf('🏰') >= 0, texts.slice(0, 12));
ok('画出了主城等级文字', texts.some(function (t) { return /主城 Lv/.test(t); }), texts.filter(function (t) { return /主城/.test(t); }));
ok('画出了敌方主城', texts.some(function (t) { return /敌方主城/.test(t); }), texts.filter(function (t) { return /敌方/.test(t); }));
ok('画出了农田建筑', texts.some(function (t) { return /农田/.test(t); }), texts.filter(function (t) { return /农田/.test(t); }));
ok('画出了资源点名称', texts.some(function (t) { return /矿点|粮点|能源点/.test(t); }), texts.filter(function (t) { return /点/.test(t); }));
ok('画出了兵力数字 12 与 7', texts.indexOf('12') >= 0 && texts.indexOf('7') >= 0, texts);

// 主城格中心是否落在视口内（保证"看得见"）
const cT = Sandbox.tileRect(Game.state.castle.gx, Game.state.castle.gy);
ok('主城格在视口范围内',
   cT.x + cT.w > 0 && cT.y + cT.h > 0 && cT.x < Sandbox.cw && cT.y < Sandbox.ch,
   { 主城格: cT, 视口: [Sandbox.cw, Sandbox.ch] });

console.log('\n---- 冒烟结果：' + pass + ' 通过 / ' + fail + ' 失败 ----');
process.exit(fail ? 1 : 0);
