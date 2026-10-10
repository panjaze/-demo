/* 铺路形状诊断（第四十七次修订）：只反复推 AI 铺路，打印 ASCII 道路图。
 * 直接调 Game.enemyRoad()（新旧两版都有这个方法），所以**改前 / 改后都能跑**，可做对照。
 *
 * 用法：node test/_roadshape.js [最多铺几格=200]
 * 图例：  C 主城　o 资源点　# AI 的路　+ 玩家的路　= 预设官道/桥
 *        . 平原　f 农田　t 森林　^ 山地　~ 水面　B 建筑
 *
 * 本次靠它定位了 planRoadPath 的「终点漂移」bug（理论最优格 (15,8) 被漏掉、给出 (22,4)，
 * 路径每周期换方向 → 路铺成一片）。修好后 AI 从铺满 100 格变成 22 格。
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const base = path.join(__dirname, '..', 'js') + path.sep;
const ctx = { console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error, Set };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
['config.js', 'game.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx);
});
const { CFG, Game } = ctx;

const STEPS = parseInt(process.argv[2] || '200', 10);

Game.reset();
const S = Game.state;

let ok = 0, stopped = null;
for (let i = 0; i < STEPS; i++) {
  S.enemyRes.energy = 1e9;          // 只看形状，不看钱
  if (!Game.enemyRoad()) { stopped = i; break; }
  ok++;
}

console.log('AI 实际铺出 ' + ok + ' 格' + (stopped === null ? '' : '（第 ' + stopped + ' 次调用时停下）'));
console.log('道路合计 ' + Object.keys(S.roads).length +
            '　AI:' + Game.roadCountOf('p2') + '　玩家:' + Game.roadCountOf('p1'));
console.log('');

for (let y = 0; y < CFG.map.rows; y++) {
  let line = '';
  for (let x = 0; x < CFG.map.cols; x++) {
    const t = Game.terrainAt(x, y);
    let ch = (t === 'W') ? '~' : (t === 'M') ? '^' : (t === 'F') ? 't' : '.';
    const r = S.roads[x + ',' + y];
    if (r) ch = r.preset ? '=' : (r.side === 'p2' ? '#' : '+');
    if (Game.isCastleAt(x, y)) ch = 'C';
    if (Game.resourceAt(x, y)) ch = 'o';
    if (Game.buildingAt(x, y)) ch = 'B';
    line += ch;
  }
  console.log('  ' + line);
}
