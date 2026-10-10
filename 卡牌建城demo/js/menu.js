/* =============================================================
 * menu.js —— 游戏主界面（第四十二次修订）
 *
 * 覆盖层：开始游戏 / 设置 / 玩法说明 / 制作信息。
 * 背景两种来源：CFG.menu.bg 指定的图片，或「实时沙盘 + 暗色蒙版」（默认，零素材）。
 * 与 #ui 解耦：Menu.show() 只做「暂停 + 盖住」，不碰游戏规则。
 * ============================================================= */
(function (global) {
'use strict';

function $(id) { return document.getElementById(id); }
function mcfg() { return (global.CFG && CFG.menu) || {}; }

const PANEL_TITLE = { settings: '设置', help: '玩法说明', about: '制作信息' };

const Menu = {
  inited: false,
  open: false,
  panel: null,        // 当前打开的面板 key（null = 只显示一级菜单）

  /* ---------------- 初始化（main.js 的 boot 调用） ---------------- */

  init() {
    if (this.inited) return false;
    const root = $('menu');
    if (!root) return false;
    this.inited = true;

    const c = mcfg();
    if ($('menu-title')) $('menu-title').textContent = c.title || '卡牌建城';
    if ($('menu-sub')) $('menu-sub').textContent = c.sub || '';
    this.applyBg();

    /* 「重新开始」只在"有进行中的对局"时出现 */
    const rb = document.createElement('button');
    rb.className = 'menu-btn menu-btn-sub hidden';
    rb.setAttribute('data-act', 'restart');
    rb.textContent = '重新开始';
    $('menu-btns').appendChild(rb);
    this._restartBtn = rb;

    $('menu-btns').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
      if (!btn) return;
      if (global.Engine && Engine.audio) Engine.audio.click();
      this.act(btn.getAttribute('data-act'));
    });

    if ($('mp-close')) $('mp-close').addEventListener('click', () => this.closePanel());
    root.addEventListener('contextmenu', (e) => {
      if (this.panel) { e.preventDefault(); this.closePanel(); }
    });
    global.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open && this.panel) { e.preventDefault(); this.closePanel(); }
    });

    /* 顶栏「主界面」+ 结算卡「回到主界面」 */
    if ($('btn-menu')) $('btn-menu').addEventListener('click', () => this.show());
    if ($('result-menu')) $('result-menu').addEventListener('click', () => this.show());

    return true;
  },

  /* ---------------- 显隐 ---------------- */

  show() {
    const root = $('menu');
    if (!root) return false;
    const S = global.Game && Game.state;
    if (S && !S.over) S.paused = true;         // 从顶栏进来 = 暂停；菜单里不跑时钟
    /* 对局内的弹窗（政策三选一 / 事件牌 / 遗物奖励）不该出现在主界面上。
     * 只关不删：点「继续游戏」时 UI.render() 会自然重开，玩家的选择不会丢。 */
    if (global.UI && UI.setModal) UI.setModal(null);
    this.open = true;
    this.closePanel();
    this.syncButtons();
    root.classList.remove('hidden');
    return true;
  },

  hide() {
    const root = $('menu');
    if (root) root.classList.add('hidden');
    this.open = false;
    return true;
  },

  /** 主按钮文案随「有没有进行中的对局」变化；有对局时补出「重新开始」 */
  syncButtons() {
    const S = global.Game && Game.state;
    const mid = !!(S && !S.over && S.t > 0);
    const start = $('menu-btns') && $('menu-btns').querySelector('button[data-act="start"]');
    if (start) start.textContent = mid ? '继续游戏' : '开始游戏';
    if (this._restartBtn) this._restartBtn.classList.toggle('hidden', !mid);
  },

  /* ---------------- 一级按钮 ---------------- */

  act(kind) {
    if (kind === 'start') return this.start(false);
    if (kind === 'restart') return this.start(true);
    if (PANEL_TITLE[kind]) return this.openPanel(kind);
    return false;
  },

  /** fresh = true 强制开新局；否则"有对局就继续、没有就新开" */
  start(fresh) {
    this.hide();
    const S = global.Game && Game.state;
    if (!S || S.over || fresh || S.t <= 0) {
      global.Game.reset();                     // reset 会重建 state 对象
      global.Game.state.paused = false;
      /* ★ 第四十八次修订：新局弹「新手引导选择界面」（查看引导 / 跳过）——
       *   Tutorial.ask 内部会先暂停，玩家选择后要么进引导、要么恢复运行。 */
      if (global.Tutorial) global.Tutorial.ask();
    } else {
      S.paused = false;
    }
    if (global.UI && UI.render) UI.render();
    return true;
  },

  /* ---------------- 面板 ---------------- */

  openPanel(kind) {
    if (!PANEL_TITLE[kind]) return false;
    if ($('mp-title')) $('mp-title').textContent = PANEL_TITLE[kind];
    const body = $('mp-body');
    if (!body) return false;
    body.innerHTML = '';
    if (kind === 'settings') this.buildSettings(body);
    else if (kind === 'help') this.buildHelp(body);
    else this.buildAbout(body);
    $('menu-panel').classList.remove('hidden');
    this.panel = kind;
    return true;
  },

  closePanel() {
    if ($('menu-panel')) $('menu-panel').classList.add('hidden');
    this.panel = null;
    return true;
  },

  /* ---------------- 背景 ---------------- */

  applyBg() {
    const c = mcfg(), bg = $('menu-bg'), root = $('menu');
    if (!root || !bg) return false;
    /* #menu-bg 始终显示：有图时它是图 + 蒙版；没图时它就是一层蒙版（露实时沙盘）。
     * ⚠️ 别在这里 display:none —— 那样没图时蒙版也没了，沙盘会亮得刺眼。 */
    if (c.bg) {
      bg.style.backgroundImage = 'url("' + c.bg + '")';
      root.classList.add('menu-has-bg');
    } else {
      bg.style.backgroundImage = '';
      root.classList.remove('menu-has-bg');
    }

    /* 无底图：均匀蒙版（压实时沙盘） */
    root.style.setProperty('--menu-scrim', String(c.scrim == null ? 0.72 : c.scrim));

    /* 有底图：上下双向暗渐变（上压标题 / 下压按钮 / 中段留亮让美术透出） */
    const stops = (Array.isArray(c.scrimStops) && c.scrimStops.length)
      ? c.scrimStops
      : [[0, 0.40], [16, 0.22], [34, 0.09], [58, 0.11], [82, 0.30], [100, 0.44]];
    root.style.setProperty('--menu-scrim-grad', 'linear-gradient(180deg, ' +
      stops.map(function (s) { return 'rgba(8,11,16,' + s[1] + ') ' + s[0] + '%'; }).join(', ') + ')');

    /* 文字区柔光暗斑：只压标题+按钮那一块，其余美术保持明亮 */
    const halo = (c.halo == null) ? 0.8 : Number(c.halo);
    root.style.setProperty('--menu-halo', String(halo));
    root.style.setProperty('--menu-halo-mid', String(Math.round(halo * 0.65 * 100) / 100));

    root.style.setProperty('--menu-blur', (c.blur || 0) + 'px');
    return true;
  },

  /* ---------------- 设置面板 ---------------- */

  row(label, node) {
    const r = document.createElement('div');
    r.className = 'mp-row';
    const l = document.createElement('span');
    l.className = 'mp-label';
    l.textContent = label;
    r.appendChild(l);
    r.appendChild(node);
    return r;
  },

  buildSettings(body) {
    const A = global.Engine && Engine.audio;

    /* 音量 */
    const vwrap = document.createElement('div');
    vwrap.className = 'mp-ctl';
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = 0; vol.max = 100; vol.step = 5;
    vol.className = 'mp-range';
    vol.value = String(Math.round((A ? A.volume : 0.6) * 100));
    const vval = document.createElement('b');
    vval.className = 'mp-val';
    vval.textContent = vol.value + '%';
    vol.addEventListener('input', () => {
      const v = Number(vol.value);
      if (A) A.setVolume(v / 100);
      vval.textContent = v + '%';
    });
    vwrap.appendChild(vol); vwrap.appendChild(vval);
    body.appendChild(this.row('音量', vwrap));

    /* 静音 */
    const mute = document.createElement('label');
    mute.className = 'mp-check';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(A && A.muted);
    cb.addEventListener('change', () => { if (A) A.muted = cb.checked; });
    mute.appendChild(cb);
    mute.appendChild(document.createTextNode('静音'));
    body.appendChild(this.row('音效', mute));

    /* 倍速 */
    const seg = document.createElement('div');
    seg.className = 'mp-seg';
    const S = global.Game && Game.state;
    [1, 2, 4].forEach((v) => {
      const b = document.createElement('button');
      b.className = 'mp-seg-btn' + ((S && S.speed === v) ? ' on' : '');
      b.textContent = v + '×';
      b.addEventListener('click', () => {
        if (global.Game && Game.state) Game.state.speed = v;
        seg.querySelectorAll('.mp-seg-btn').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      seg.appendChild(b);
    });
    body.appendChild(this.row('游戏倍速', seg));

    /* 地图底图 */
    const pwrap = document.createElement('div');
    pwrap.className = 'mp-ctl';
    const pname = document.createElement('b');
    pname.className = 'mp-val mp-val-wide';
    const refreshPlate = () => {
      const V = global.CFG && CFG.mapVisual;
      const id = global.Sandbox && Sandbox.plateId;
      pname.textContent = (V && V.plates && V.plates[id] && V.plates[id].name) || '—';
    };
    refreshPlate();
    const pnext = document.createElement('button');
    pnext.className = 'mp-btn';
    pnext.textContent = '切换';
    pnext.addEventListener('click', () => {
      const V = global.CFG && CFG.mapVisual;
      if (!V || !V.plates || !global.Sandbox) return;
      const ids = Object.keys(V.plates);
      const i = ids.indexOf(Sandbox.plateId);
      const nx = ids[(i + 1) % ids.length];
      Sandbox.loadPlate(nx);
      refreshPlate();
      if (global.UI && UI.hint) UI.hint('地图底图：' + ((V.plates[nx] && V.plates[nx].name) || nx));
    });
    pwrap.appendChild(pname); pwrap.appendChild(pnext);
    body.appendChild(this.row('地图底图', pwrap));

    /* 提示 + 返回 */
    const tip = document.createElement('p');
    tip.className = 'mp-tip';
    tip.textContent = '提示：底图也能在游戏里用数字键 0~9 直接切换；按 ` 唤出调参面板。';
    body.appendChild(tip);

    const back = document.createElement('button');
    back.className = 'mp-btn mp-btn-wide';
    back.textContent = '返回主界面';
    back.addEventListener('click', () => this.closePanel());
    body.appendChild(back);
  },

  /* ---------------- 玩法说明 ---------------- */

  buildHelp(body) {
    const ul = document.createElement('ul');
    ul.className = 'mp-list';
    [
      '目标：摧毁敌方主城获胜；30 分钟兜底（到时按综合分判胜负）。',
      '三步循环：抽卡 → 建城 → 出兵 → 抢资源点/占敌方建筑 → 再经营。',
      '抽卡：右下角「🎴 抽卡」花 1⚡ 翻 5 张候选，按标价买进手牌（可反复重开，费用递增）。',
      '建城：把手牌拖到地图空地；新建筑必须挨着自己的道路或建筑（城市沿路生长）。',
      '修路：道路牌铺路，军队只能沿自己的路网行军；抢资源点先修路。',
      '抢点：清掉资源点守军即可占领，之后每 10 秒产出一次，不需要驻守。',
      '战争：数量抵消（同格立即结算，少者全灭）；攻城 1 兵换 1 点防御值，防御值归零即占领。',
      '建筑等级上限 = 主城等级（最高 Lv3）；升级要花「升级牌」，或把同类卡拖到已有建筑上合成。',
      '开局与每次主城升级触发一次「政策三选一」；每 3 分钟一张「事件牌」（全部带代价）；',
      '右下角「📋 任务」是星级任务，每完成一星给一件遗物（永久 buff）。',
      '操作：拖动沙盘平移 / 滚轮缩放 / 点我方部队再点建筑派兵 / Esc 取消当前操作。',
    ].forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
    body.appendChild(ul);
  },

  /* ---------------- 制作信息 ---------------- */

  buildAbout(body) {
    const c = mcfg();
    const wrap = document.createElement('div');
    wrap.className = 'mp-about';
    [
      c.credit || '',
      '版本：V0.4（卡驱动 + 道路系统）',
      '技术：原生 JavaScript + Canvas/DOM，零依赖、零构建，双击 index.html 即可运行。',
      '验证：五层自动化测试（逻辑 / 渲染 / 交互 / DOM 引用 / 调参路径）+ 真实浏览器全流程回归。',
    ].forEach((t) => {
      if (!t) return;
      const p = document.createElement('p');
      p.textContent = t;
      wrap.appendChild(p);
    });
    body.appendChild(wrap);
  },
};

global.Menu = Menu;
})(window);
