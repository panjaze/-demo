/* =============================================================
 * main.js —— 入口装配
 * 逻辑分辨率 1280×720（横屏桌面），由引擎统一缩放到窗口
 * ============================================================= */
(function (global) {
'use strict';

const W = 1280, H = 720;

let lastTick = -1;
let lightAcc = 0;

/* ---------------- 场景：驱动游戏时钟与刷新 ---------------- */

const scene = {
  enter() {
    registerDebug();
  },

  update(rawDt) {
    Game.update(rawDt);

    const S = Game.state;
    if (!S) return;

    /* ★ 对局结束必须补一次全量渲染（第四十三次修订抓到并修掉的 bug）
     * 旧版只有 tickCount 变化时才走 UI.render()；对局一结束 tickCount 就停住了，
     * 主循环只剩轻量 UI.refresh()，而「结算卡 + 结算演出」只在 render() 里触发 ——
     * 于是破城后画面毫无反应（除非玩家恰好点了什么触发一次 render）。
     * 真实场景：AI 打掉我方主城，玩家会看到"游戏无声结束、没有结算画面"。 */
    if (S.over && !UI._resultShown) { UI.render(); return; }

    // 跨过经济 Tick → 全量重绘
    if (S.tickCount !== lastTick) {
      lastTick = S.tickCount;
      UI.render();
      return;
    }

    // 其余时间只做轻量刷新（时钟 / 资源 / 倒计时），约 8Hz
    lightAcc += rawDt;
    if (lightAcc >= 0.12) {
      lightAcc = 0;
      UI.refresh();
    }
  },

  render() {
    // 沙盘每帧重绘（Phase 3a 静态地图；Phase 3b 起在这里画士兵）
    Sandbox.render();
  },
};

/* ---------------- 调参面板（全中文） ---------------- */

function registerDebug() {
  const D = Engine.debug;

  D.group('调试操作');
  D.button('1 倍速', function () { Game.state.speed = 1; });
  D.button('2 倍速', function () { Game.state.speed = 2; });
  D.button('4 倍速', function () { Game.state.speed = 4; });
  D.button('+10 能量', function () { Game.state.res.energy += 10; UI.render(); });
  D.button('+100 粮食', function () { Game.state.res.food += 100; UI.render(); });
  D.button('立刻结算一个 Tick', function () { Game.applyTick(); UI.render(); });
  D.button('主城 +10 兵', function () {
    const c = Game.state.castle;
    Game.addTroops(c.gx, c.gy, 'p1', 10);
    UI.render();
  });
  D.button('敌方主城 +20 兵（立刻出动）', function () {
    const ec = Game.state.enemyCastle;
    Game.addTroops(ec.gx, ec.gy, 'p2', 20);
    Game.state.enemyDecideT = CFG.enemy.decideInterval;
    UI.render();
  });
  D.button('空降 12 兵到中央矿点', function () {
    const r = CFG.map.resources[0];
    Game.setTroops(r.gx, r.gy, 'p1', 12);
    Game.claimIfResource(r.gx, r.gy);
    UI.render();
  });

  D.group('时间');
  D.slider('time.tick', 1, 60, 1, '经济 Tick 周期（秒）');
  D.slider('time.limit', 0, 1800, 30, '兜底时限（秒 · 0 = 不设上限）');

  D.group('开牌与卡牌');
  D.slider('shop.openCost', 0, 10, 1, '开牌费（能量）');
  D.slider('shop.count', 1, 8, 1, '每次翻开的候选卡张数');
  D.slider('shop.minDistinct', 1, 5, 1, '翻牌至少几种不同');
  D.slider('hand.baseSize', 3, CFG.hand.maxSize, 1, '开局手牌格数（重置后生效）');
  D.button('+1 手牌格（局内扩容）', function () {
    if (Game.expandHand(1)) { Engine.audio.pickup(); UI.render(); }
    else { UI.hint('手牌已达上限 ' + CFG.hand.maxSize + ' 格'); Engine.audio.hurt(); }
  });
  D.slider('buildings.power.price', 0, 15, 1, '卡价 · 能源站');
  D.slider('buildings.barracks.price', 0, 15, 1, '卡价 · 兵营');
  D.slider('buildings.tower.price', 0, 15, 1, '卡价 · 防御塔');
  D.slider('cards.effects.harvest.price', 0, 15, 1, '卡价 · 丰收');
  D.slider('cards.effects.reclaim.price', 0, 15, 1, '卡价 · 开垦');
  D.slider('cards.effects.fastCrop.price', 0, 15, 1, '卡价 · 抢收');
  D.slider('cards.effects.levy.price', 0, 15, 1, '卡价 · 催收令');
  D.slider('cards.effects.rally.price', 0, 15, 1, '卡价 · 总动员');

  D.group('建筑产出（Lv1 / 每 Tick）');
  D.slider('buildings.farm.levels.0.yield.food', 0, 60, 1, '农田 · 粮食');
  D.slider('buildings.power.levels.0.yield.energy', 0, 30, 1, '能源站 · 能量');
  D.slider('buildings.barracks.train.0.interval', 2, 60, 1, '兵营 · 出兵间隔（秒）');
  D.slider('buildings.barracks.train.0.count', 1, 20, 1, '兵营 · 每次出几个兵');
  D.slider('buildings.barracks.train.0.food', 0, 60, 1, '兵营 · 每次耗粮');

  D.group('初始资源（重置后生效）');
  D.slider('resource.initial.energy', 0, 60, 1, '初始能量');
  D.slider('resource.initial.food', 0, 300, 10, '初始粮食');

  D.group('主城等级');
  D.slider('castle.levels.0.upCost.energy', 0, 120, 5, '升级 Lv2 · 能量');
  D.slider('castle.levels.1.upCost.energy', 0, 200, 5, '升级 Lv3 · 能量');
  D.slider('castle.levels.2.upCost.energy', 0, 400, 10, '升级 Lv4 · 能量');
  D.slider('castle.levels.3.upCost.energy', 0, 600, 10, '升级 Lv5 · 能量');
  D.slider('castle.levels.0.hp', 20, 500, 10, 'Lv1 主城防御值');
  D.slider('castle.levels.4.hp', 20, 900, 10, 'Lv5 主城防御值');

  D.group('战斗与士兵');
  D.slider('soldier.maxByLevel.0', 20, 300, 10, '士兵上限 · 主城Lv1');
  D.slider('adjacency.barracksAdjFarm', 0, 1, 0.05, '兵营相邻农田 · 加速幅度');

  D.group('效果牌数值');
  D.slider('cards.effects.harvest.gain.food', 0, 300, 10, '丰收 · 获得粮食');
  D.slider('cards.slotCap', 0, 10, 1, '开垦 · 每局最多次数');
  D.slider('cards.effects.fastCrop.burstMul', 1, 10, 1, '抢收 · 结算倍数');
  D.slider('cards.effects.levy.boostMul', 1, 6, 1, '催收令 · 产出倍数');
  D.slider('cards.effects.levy.boostTicks', 1, 10, 1, '催收令 · 持续 Tick 数');
  D.slider('cards.effects.rally.boostMul', 1, 6, 1, '总动员 · 产出倍数');
  D.slider('cards.effects.rally.boostTicks', 1, 10, 1, '总动员 · 持续 Tick 数');

  D.group('地图视觉');
  D.slider('mapVisual.grid.width', 0.2, 3, 0.1, '网格线宽（普通态）');
  D.slider('mapVisual.grid.buildWidth', 0.5, 4, 0.1, '网格线宽（建造模式）');
  D.slider('mapVisual.road.width', 0.2, 1, 0.02, '道路宽（占格比例）');
  D.button('地形 Debug 开关（也可按 T）', function () {
    CFG.mapVisual.terrainDebug = !CFG.mapVisual.terrainDebug;
    UI.hint('地形 Debug：' + (CFG.mapVisual.terrainDebug ? '开（黄=农田 绿=森林 灰=山 蓝=水）' : '关'));
  });
}

/* ---------------- 启动 ---------------- */

function boot() {
  Engine.init({
    width: W,
    height: H,
    canvas: document.getElementById('game'),
  });

  Game.reset();
  Sandbox.init();
  UI.init();
  Menu.init();          // 主界面（第四十二次修订）
  UI.render();
  Sandbox.resize();

  /* 开局先进主界面：暂停游戏时钟，实时沙盘当主界面背景（零素材） */
  Game.state.paused = true;
  Menu.show();

  Engine.run(scene);

  UI.hint('点右下角「抽卡」翻 5 张 → 挑便宜的买 → 拖手牌到城市空格建造 · 兵营出的兵会出现在城市格上，选中后点建筑即可派兵');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

})(window);
