/* 资源引用完整性：CSS/HTML/JS 里引用的本地资源是否都存在
 * 口径说明：JS 里的相对路径按「页面」解析（与 index.html 同目录），不是按 js/ 目录；
 * 另外 config.js 用的是 src:'assets/..' 单引号字符串，也要扫进来。
 * （背景图 404 不会报控制台错误，必须静态扫。） */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/工程/自研/卡牌建城demo/';
let miss = [], ok = 0, checked = [];

function add(raw, fromFile) {
  raw = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!raw || /^(data:|https?:|\/\/)/.test(raw)) return;
  // JS 内引用以页面为基准；CSS 内以 css/ 为基准；HTML 以根为基准
  const base = fromFile.endsWith('.css') ? ROOT + 'css' : ROOT;
  const p = path.resolve(base, raw).replace(/\\/g, '/');
  checked.push(path.relative(ROOT, fromFile).replace(/\\/g, '/') + ' -> ' + raw);
  if (fs.existsSync(p)) ok++;
  else miss.push(path.relative(ROOT, fromFile).replace(/\\/g, '/') + '  ->  ' + raw);
}

function scan(file, isCSS) {
  const s = fs.readFileSync(file, 'utf8');
  const re = isCSS ? /url\(\s*['"]?([^'")]+?)['"]?\s*\)/g : /(?:src\s*=\s*["']([^"']+)["'])|(?:src\s*:\s*['"]([^'"]+)['"])|(?:url\(\s*['"]?([^'")]+?)['"]?\s*\))/g;
  let m;
  while ((m = re.exec(s))) add(m[1] || m[2] || m[3], file);
}

scan(ROOT + 'css/style.css', true);
scan(ROOT + 'index.html', false);
for (const f of fs.readdirSync(ROOT + 'js')) if (f.endsWith('.js')) scan(ROOT + 'js/' + f, false);

console.log('引用 OK:', ok, '  缺失:', miss.length);
miss.forEach(x => console.log('  ✗ ' + x));
