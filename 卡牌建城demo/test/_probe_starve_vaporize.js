/* _probe_starve_vaporize.js —— 验证：idx=0 粮尽停军时，兵是否蒸发
 * 复刻 updateEnemy 的派兵方式（清格 + push march），粮设为不够走第一格，
 * 推进 2 秒让 updateMarch 走到粮尽分支，看兵还在不在。
 * 运行：node test/_probe_starve_vaporize.js
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const base = path.join(__dirname, '..', 'js') + path.sep;
const ctx = { console, Math, Object, Array, Date, JSON, Number, String, Boolean, Error, Set };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
['config.js', 'game.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(base + f, 'utf8'), ctx); });
const { CFG, Game } = ctx;

function caseA(label, clearTileFirst, food) {
  Game.reset();
  const S = Game.state;
  const c = S.castle;
  Game.placeRoad(c.gx + 1, c.gy, 'p1');
  Game.addTroops(c.gx + 1, c.gy, 'p1', 14);
  if (clearTileFirst) Game.setTroops(c.gx + 1, c.gy, 'p1', 0);   // 模拟 updateEnemy 的清格派兵
  S.march.push({ side: 'p1', n: 14, path: [{ gx: c.gx + 1, gy: c.gy }, { gx: c.gx + 2, gy: c.gy }], idx: 0, t: 0, spent: 0 });
  if (!clearTileFirst) { /* orderMoveFrom 式：兵留格上 */ }
  S.res.food = food;
  Game.update(2);   // 1.6s 触发走第一格 → 粮尽
  const onTile = Game.troopsAt(c.gx + 1, c.gy).p1;
  const onDest = Game.troopsAt(c.gx + 2, c.gy).p1;
  const total = Game.totalTroops('p1');
  const vapor = 14 - total;
  console.log(label + ': 出发格=' + onTile + ' 目标格=' + onDest + ' 场上总=' + total
    + ' march=' + S.march.length + '  → ' + (vapor > 0 ? ('★ 蒸发 ' + vapor + ' 兵') : '未蒸发'));
}

console.log('===== idx=0 粮尽停军：兵是否蒸发 =====');
caseA('A1 派兵时清格（AI/模拟玩家式）, 粮=5（不够走1格0.6×14=8.4）', true, 5);
caseA('A2 派兵时不清格（orderMoveFrom 式）, 粮=5', false, 5);
caseA('A3 派兵时清格, 粮=100（够走）', true, 100);

console.log('\n===== 中途（idx≥1）粮尽：对照 =====');
(function () {
  Game.reset();
  const S = Game.state;
  const c = S.castle;
  for (let i = 1; i <= 3; i++) Game.placeRoad(c.gx + i, c.gy, 'p1');
  Game.setTroops(c.gx + 1, c.gy, 'p1', 0);
  S.march.push({ side: 'p1', n: 14, path: [
    { gx: c.gx + 1, gy: c.gy }, { gx: c.gx + 2, gy: c.gy }, { gx: c.gx + 3, gy: c.gy }, { gx: c.gx + 4, gy: c.gy }
  ], idx: 0, t: 0, spent: 0 });
  S.res.food = 10;   // 够走 1 格（8.4），不够走第 2 格
  Game.update(4);    // 走 1 格后粮尽
  const at1 = Game.troopsAt(c.gx + 2, c.gy).p1;
  console.log('中途粮尽: 第2格兵=' + at1 + ' 场上总=' + Game.totalTroops('p1') + ' march=' + S.march.length
    + ' → ' + (Game.totalTroops('p1') === 14 ? '未蒸发（兵停在第2格）' : '★ 兵数异常'));
})();
