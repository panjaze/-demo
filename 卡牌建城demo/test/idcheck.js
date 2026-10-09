/* DOM id 引用检查 —— 防止"HTML 删了元素、JS 还在按 id 取"这类崩溃
 * 运行：node test/idcheck.js
 *
 * 为什么会需要它：ui.js 里全是 $(id) 取元素。改了 index.html 却漏改 JS，
 * 运行时就是 Cannot read properties of null —— 而且逻辑自检完全看不见。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(function (m) { return m[1]; }));

const jsFiles = ['js/ui.js', 'js/main.js', 'js/sandbox.js', 'js/menu.js'];
const jsIds = new Set();
const dynPrefix = [];      // 形如 $('res-' + k) 的动态拼接

jsFiles.forEach(function (f) {
  const t = fs.readFileSync(path.join(root, f), 'utf8');
  for (const m of t.matchAll(/\$\('([^']+)'\)/g)) jsIds.add(m[1]);
  for (const m of t.matchAll(/getElementById\('([^']+)'\)/g)) jsIds.add(m[1]);
  for (const m of t.matchAll(/\$\('([^']*?)'\s*\+/g)) dynPrefix.push(m[1]);
});

/* 动态前缀（如 'res-'）不做缺失判定，只提示 */
const missing = [...jsIds].filter(function (id) { return !htmlIds.has(id); }).sort();
const unused = [...htmlIds].filter(function (id) {
  if (jsIds.has(id)) return false;
  return !dynPrefix.some(function (p) { return id.indexOf(p) === 0; });
}).sort();

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + extra : '')); }
}

console.log('== DOM id 引用检查 ==');
console.log('  HTML 里的 id：' + htmlIds.size + ' 个　JS 引用：' + jsIds.size + ' 个');
if (dynPrefix.length) console.log('  动态前缀：' + [...new Set(dynPrefix)].join(', '));

ok('JS 引用的 id 在 HTML 里都存在', missing.length === 0, missing.join(', '));

// 关键元素存在性（防止误删）
['sandbox', 'hand-slots', 'hand-bar', 'discard-zone', 'hint', 'modal',
 'tile-actions', 'ta-title', 'ta-upgrade', 'ta-demolish', 'ta-close',
 'btn-discard', 'btn-recenter', 'corner-ui', 'pool-count', 'shop-cost'].forEach(function (id) {
  ok('关键元素 #' + id + ' 存在', htmlIds.has(id));
});

if (unused.length) console.log('  ℹ️  HTML 有但 JS 未引用（无害）：' + unused.join(', '));

/* ---------- 方法完整性：this.x() 调用必须有定义（防"交互链静默断裂"） ---------- */
console.log('');
['js/ui.js', 'js/game.js'].forEach(function (f) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const defined = new Set();
  for (const m of src.matchAll(/^  ([A-Za-z_$][\w$]*)\(([^)]*)\) \{/gm)) defined.add(m[1]);
  const called = new Set();
  for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\(/g)) called.add(m[1]);
  const missing = [...called].filter(function (x) { return !defined.has(x); });
  ok(f + ' 方法调用完整（this.x() 均有定义）', missing.length === 0, missing.join(', '));
});

/* ---------- 配置引用完整性：CFG.a.b 必须存在（防"删了配置键但代码还在引用"） ---------- */
console.log('');
{
  const cfgCtx = { window: {}, console: console };
  require('vm').createContext(cfgCtx);
  cfgCtx.window = cfgCtx;
  require('vm').runInContext(fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8'), cfgCtx);
  const CFGobj = cfgCtx.CFG;
  const srcAll = ['js/game.js', 'js/ui.js', 'js/sandbox.js', 'js/menu.js', 'js/main.js']
    .map(function (f) { return fs.readFileSync(path.join(root, f), 'utf8'); }).join('\n');
  const paths = new Set();
  for (const m of srcAll.matchAll(/CFG\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) paths.add(m[1] + '.' + m[2]);
  const miss = [];
  [...paths].forEach(function (p) {
    const parts = p.split('.');
    if (!(parts[0] in CFGobj)) { miss.push(p + ' (无顶层)'); return; }
    const v = CFGobj[parts[0]];
    if (v === null || typeof v !== 'object') { miss.push(p + ' (顶层非对象)'); return; }
    if (!(parts[1] in v)) miss.push(p);
  });
  ok('配置引用完整（CFG.a.b 均存在，共 ' + paths.size + ' 条）', miss.length === 0, miss.join(', '));
}

console.log('\n---- id 检查：' + pass + ' 通过 / ' + fail + ' 失败 ----');
process.exit(fail ? 1 : 0);
