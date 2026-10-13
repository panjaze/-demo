/* =============================================================
 * sandbox.js —— 网格制沙盘渲染（Phase 3a）
 *
 * 正交网格地图（对齐《率土之滨》式 SLG），Canvas 以 cover 模式铺满面板 → 无黑边
 * 视觉参考《卡牌城镇》(Cardboard Town)：草地棋盘格 + 石板城市底座 + 土路
 *
 * 城市区的 20 个格子由 Canvas 画出石板底座，DOM 网格逐格对齐叠在上面（不再是"两层皮"）
 * ============================================================= */
(function (global) {
'use strict';

const COL = {
  /* 画布最底层兜底色。只在「底图外扩也不可用」时才会被看到（第四十二次修订前是
   * 一坨草绿 #44692f，缩小时露出大片"绿幕"）。这里改成近黑的暗橄榄，
   * 即便兜底也读作"地图之外"，不是穿帮。 */
  bg: '#1b2417',
  grassA: '#547f3c', grassB: '#4d7636',
  grassDark: '#42692c', grassLight: '#5d8b43',
  bush: '#35541f',
  road: '#c2a878', roadEdge: '#9c8457',
  cityBase: '#93938a', cityBaseAlt: '#8b8b82', cityEdge: '#6d6d64',
  cityEnemy: '#8d6b60', cityEnemyAlt: '#85635a', cityEnemyEdge: '#6d5049',
  p1: '#4a9eff', p2: '#ff6b6b', p1Dark: '#1c3a5e', p2Dark: '#5e1c1c',
  res: '#ffd23f', resRing: '#6d5410',
  tower: '#d3dae2', towerRing: '#5a636e',
};

function hash2(gx, gy) {
  let h = (gx * 374761393 + gy * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

/* 底图外扩（第四十二次修订 · 绿幕修复方案 2）
 * 相机缩到比视口小时，地图之外不再露平涂底色，而是用「底图边缘的模糊镜像延伸」铺满，
 * 视觉上读作"地图延绵到画外"。外扩宽度（地图像素）。 */
const PLATE_PAD = 340;

const Sandbox = {

  canvas: null, ctx: null, cw: 0, ch: 0, dpr: 1,
  scale: 1, offX: 0, offY: 0,
  camX: 0, camY: 0,        // 相机（地图左上角相对视口的偏移）
  moves: [],               // 移动轨迹动画 { x0,y0,x1,y1,side,t0 }
  fx: [],                  // 表现层特效（消费 Game.fx 而来）：pop 落成 / burst 战斗 / flash 占领 / blast 攻城
  _fxAudioT: 0,            // 战斗音效节流（同帧多场战斗只响一次）
  dropPreview: null,       // 拖卡时的落点预览 { handIdx, key, gx?, gy? }（gx/gy = 光标下的锚点格）
  hoverTile: null,         // 光标下的格子（建造模式的跟随预览用，pointermove 维护）
  plateImg: null,          // 当前底图 Image（mapVisual 底板层）
  plateId: null,           // 当前底图 id（CFG.mapVisual.plates 的键）
  plateBaked: false,       // 该底图是否自带烘焙网格（自带则代码网格关闭）
  plateCache: {},          // 底图缓存 { src: Image }
  plateExt: null,          // 外扩底图（镜像+模糊+压暗，见 buildPlateExt）；null 时退回平涂底色
  _extCache: null,         // 外扩图缓存（同一张底图只构建一次）
  _extSrc: null,

  init() {
    this.canvas = document.getElementById('sandbox');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.sprites = {};            // 已加载的建筑贴图 { farm: Image, ... }
    this.terrainSprites = { mountain: [], tree: [] };   // 立体地形素材（第七十八次修订补充）
    this.isoPaintedImg = null;    // 等轴手绘沙盘底图（AI 生成，第七十八次修订补充）
    this.loadSprites();
    this.loadTerrainPropsImgs();
    this.loadIsoPainted();
    this.resize();
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('resize', () => { this.resize(); });
      global.addEventListener('keydown', (e) => {
        if (e.key === 't' || e.key === 'T') {          // T：地形 Debug 覆盖开关（默认关）
          CFG.mapVisual.terrainDebug = !CFG.mapVisual.terrainDebug;
          if (global.UI && typeof global.UI.hint === 'function') {
            global.UI.hint('地形 Debug：' + (CFG.mapVisual.terrainDebug ? '开（黄=农田 绿=森林 灰=山 蓝=水）' : '关'));
          }
          return;
        }
        const name = this.cyclePlate(e.key);
        if (name && global.UI && typeof global.UI.hint === 'function') {
          global.UI.hint('底图切换：' + name);
        }
      });
    }
  },

  /** 是否处于「建造模式」（拿起建筑卡：点选放置中 或 拖卡中）→ 网格增强 */
  buildModeActive() {
    const UIg = global.UI;
    if (UIg && UIg.placeMode) return true;
    return !!this.dropPreview;
  },

  /** 等轴手绘沙盘底图加载（第七十八次修订补充；2026-10-12 扩展双版）：
   *  A = iso-painted2.jpg（木框沙盘）常驻；B = iso-painted3.jpg（延展铺满）按开关切换 */
  loadIsoPainted() {
    const load = (cfg, slot) => {
      if (!cfg || typeof Image === 'undefined') return;
      const im = new Image();
      im.onload = () => { this[slot] = im; };
      im.src = cfg.src;
    };
    load(CFG.mapVisual.isoPainted, 'isoPaintedImg');
    load(CFG.mapVisual.isoPaintedB, 'isoPaintedBImg');
  },

  /** 当前生效的等轴成图（B 开关优先，未加载/未启用回退 A）；null = 无成图走回退链 */
  isoPaintedActive() {
    if (CFG.mapVisual.isoPaintedBOn && this.isoPaintedBImg && CFG.mapVisual.isoPaintedB)
      return { img: this.isoPaintedBImg, cfg: CFG.mapVisual.isoPaintedB };
    if (this.isoPaintedImg && CFG.mapVisual.isoPainted)
      return { img: this.isoPaintedImg, cfg: CFG.mapVisual.isoPainted };
    return null;
  },

  /** 立体地形素材加载（第七十八次修订补充）：assets/map/props/ 下的山/树透明 PNG */
  loadTerrainPropsImgs() {
    const files = { mountain: ['mountain-1.png'], tree: ['tree-1.png'] };
    Object.keys(files).forEach((kind) => {
      files[kind].forEach((f) => {
        if (typeof Image === 'undefined') return;
        const img = new Image();
        img.onload = () => {
          if (this.terrainSprites && this.terrainSprites[kind]) this.terrainSprites[kind].push(img);
        };
        img.src = 'assets/map/props/' + f;
      });
    });
  },

  loadSprites() {
    this.sprites = {};
    if (!CFG.assets || !CFG.assets.enabled) return;
    if (typeof global.Image !== 'function') return;   // 无头测试环境降级
    Object.keys(CFG.assets.files).forEach((k) => {
      const img = new global.Image();
      img.onload = () => { this.sprites[k] = img; };
      img.onerror = () => { /* 加载失败 → 该建筑永久降级为 emoji，不重试 */ };
      img.src = CFG.assets.dir + CFG.assets.files[k];
    });
    /* ★ 第七十二次修订：木纹贴图 —— 地图信息牌与顶栏同源（createPattern 平铺） */
    this.woodImg = null;
    {
      const wi = new global.Image();
      wi.onload = () => { this.woodImg = wi; };
      wi.src = 'assets/ui/topbar/topbar-wood-tile.png';
    }
    /* ★ 第七十一次修订：资源点据点素材（透明底 PNG，缺失时降级 emoji） */
    this.resSprites = {};
    const RC = CFG.resourceCamps;
    if (RC && RC.enabled && typeof global.Image === 'function') {
      Object.keys(RC.files).forEach((k) => {
        const img = new global.Image();
        img.onload = () => { this.resSprites[k] = img; };
        img.onerror = () => { /* 缺失 → 资源点降级为 emoji 图标 */ };
        img.src = RC.dir + RC.files[k];
      });
    }
    /* 地图底板（环境层）：按 CFG.mapVisual.activePlate 加载，缺失时回退程序化草地 */
    this.loadPlate(CFG.mapVisual && CFG.mapVisual.activePlate);
  },

  /** 加载指定 id 的底图（带缓存）；bakedGrid 底图会关闭代码网格 */
  loadPlate(id) {
    const V = CFG.mapVisual;
    if (!V || !V.plates || !V.plates[id]) return false;
    const def = V.plates[id];
    V.activePlate = id;
    this.plateId = id;
    this.plateBaked = !!def.bakedGrid;
    this.plateImg = null;
    this.plateExt = null;
    if (!def.src || typeof global.Image !== 'function') return true;   // 程序化草地 / 无头测试
    const cached = this.plateCache[def.src];
    if (cached) { this.plateImg = cached; this.buildPlateExt(); return true; }
    const bg = new global.Image();
    bg.onload = () => {
      if (V.activePlate === id) { this.plateImg = bg; this.buildPlateExt(); }
    };
    bg.onerror = () => { /* 加载失败 → 回退程序化草地 */ };
    bg.src = def.src;
    this.plateCache[def.src] = bg;
    return true;
  },

  /** 构建「外扩底图」：中心 = 原底图，四周 = 镜像平铺 + 模糊压暗 + 边缘暗角。
   *  相机缩到比视口小时用它铺满画布 → 看到的是"地图延绵到画外"，而不是一块绿幕。
   *  ⚠️ 纯观感层：构建失败（无 document / 无 canvas 2d）就返回 false，
   *     drawTiles 自动退回平涂底色，绝不抛异常（冒烟测试用的是假 canvas）。 */
  buildPlateExt() {
    this.plateExt = null;
    const im = this.plateImg;
    if (!im) return false;
    if (this._extCache && this._extSrc === im.src) { this.plateExt = this._extCache; return true; }
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false;

    const W = CFG.map.cols * CFG.map.tile, H = CFG.map.rows * CFG.map.tile;
    const P = PLATE_PAD, FW = W + P * 2, FH = H + P * 2;
    let a, b;
    try { a = document.createElement('canvas'); b = document.createElement('canvas'); } catch (e) { return false; }
    if (!a || !b || !a.getContext || !b.getContext) return false;
    a.width = FW; a.height = FH;
    b.width = FW; b.height = FH;
    const ca = a.getContext('2d'), cb = b.getContext('2d');
    if (!ca || !cb || typeof ca.drawImage !== 'function' || typeof cb.drawImage !== 'function') return false;

    /* ① 镜像平铺：中心原图 + 四边 + 四角各一份镜像（一张图足以铺满 P 宽的外圈） */
    const put = (c, x, y, flipX, flipY) => {
      c.save();
      c.translate(x + (flipX ? W : 0), y + (flipY ? H : 0));
      c.scale(flipX ? -1 : 1, flipY ? -1 : 1);
      c.drawImage(im, 0, 0, W, H);
      c.restore();
    };
    put(ca, P, P, false, false);
    put(ca, P - W, P, true, false);          put(ca, P + W, P, true, false);
    put(ca, P, P - H, false, true);          put(ca, P, P + H, false, true);
    put(ca, P - W, P - H, true, true);       put(ca, P + W, P - H, true, true);
    put(ca, P - W, P + H, true, true);       put(ca, P + W, P + H, true, true);

    /* ② 整张模糊 + 轻微压暗 → 外圈"退到远处" */
    if ('filter' in cb) cb.filter = 'blur(8px) brightness(0.92) saturate(0.95)';
    cb.drawImage(a, 0, 0);
    if ('filter' in cb) cb.filter = 'none';

    /* ③ 中心贴回清晰原图 */
    cb.drawImage(im, P, P, W, H);

    /* ④ 地图四边向内收的暗角 → 柔化"清晰 / 模糊"的接缝，读作地图边界 */
    const EDGE = 180, dark = 0.46;
    const shade = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const g = cb.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(12,16,10,' + dark + ')');
      g.addColorStop(1, 'rgba(12,16,10,0)');
      cb.fillStyle = g;
      cb.fillRect(rx, ry, rw, rh);
    };
    shade(P, P, P, P - EDGE, P, 0, W, EDGE);              // 上
    shade(P, P + H, P, P + H + EDGE, P, P + H, W, EDGE);  // 下
    shade(P, P, P - EDGE, P, 0, P, EDGE, H);              // 左
    shade(P + W, P, P + W + EDGE, P, P + W, P, EDGE, H);  // 右

    this._extCache = b; this._extSrc = im.src; this.plateExt = b;
    return true;
  },

  /** 实机切换底图（键盘 0~4）；成功返回名称，无效按键返回 null */
  cyclePlate(k) {
    const V = CFG.mapVisual;
    if (!V || !V.plateKeys) return null;
    const id = V.plateKeys[String(k)];
    if (!id || !V.plates[id]) return null;
    this.loadPlate(id);
    return V.plates[id].name;
  },

  /** 屏幕空间角标：当前底图名 + 切换键提示（三选一试验期的视觉辅助） */
  drawPlateTag(ctx) {
    const V = CFG.mapVisual;
    if (!V || !V.plates || !V.plates[this.plateId]) return;
    if (typeof ctx.measureText !== 'function' || typeof ctx.fillText !== 'function') return;
    const txt = '底图 [' + V.plates[this.plateId].name + ']  按 0~5/9/10 切换（9 旧径 · 10 画面优化）';
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(20,16,10,0.55)';
    ctx.fillRect(8, this.ch - 26, w + 16, 20);
    ctx.fillStyle = 'rgba(240,232,210,0.92)';
    ctx.fillText(txt, 16, this.ch - 10);
    ctx.restore();
  },

  /** 相机化：地图比视口大就铺满并允许拖动；比视口小就居中 */
  resize() {
    const host = this.canvas && this.canvas.parentElement;
    if (!host) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.cw = w; this.ch = h;
    this.dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    if (!this._placed) {
      this.scale = 1;
      this.centerOn(CFG.map.spawn.p1.gx, CFG.map.spawn.p1.gy);
      this._placed = true;
    }
    this.clampCam();
  },

  /* ==================== 等轴测投影（第七十四次修订 MVP） ====================
   * isoMode=true 时所有"格心"统一经 tileCX/tileCY 取值（双模式：iso 返回菱形中心，
   * 正交返回原 (gx+0.5)*T），各绘制函数只换格心取值即可双模式兼容；回退 = 关 isoMode。
   * 菱形尺寸 HW:HH 由 CFG.mapVisual.iso 的 hw/hh 决定（当前 60:15 = 4:1 缓倾斜，非 2:1 标准）；台基（带侧壁）由 drawIsoWorld 绘制。 */

  isoOn() {
    const V = CFG.mapVisual;
    return !!(V && V.isoMode);
  },
  isoHW() { return (CFG.mapVisual.iso && CFG.mapVisual.iso.hw) || CFG.map.tile; },
  isoHH() { return (CFG.mapVisual.iso && CFG.mapVisual.iso.hh) || CFG.map.tile / 2; },
  isoOX() { return CFG.map.rows * this.isoHW(); },        // 最左列格心 x ≥ 半宽
  isoOY() { return this.isoHH() * 1.5; },                 // 顶格顶点 y = OY - HH

  /** 格 (gx,gy) 菱形中心 X（世界逻辑坐标；正交模式 = 原格心） */
  tileCX(gx, gy) {
    if (!this.isoOn()) return (gx + 0.5) * CFG.map.tile;
    return this.isoOX() + (gx - gy) * this.isoHW();
  },
  /** 格 (gx,gy) 菱形中心 Y */
  tileCY(gx, gy) {
    if (!this.isoOn()) return (gy + 0.5) * CFG.map.tile;
    return this.isoOY() + (gx + gy) * this.isoHH();
  },
  /** 把一个菱形（或正交退化方块）加入 path —— 供草地/高亮/幽灵复用 */
  diamondPath(ctx, gx, gy) {
    const T = CFG.map.tile;
    ctx.beginPath();
    if (!this.isoOn()) { ctx.rect(gx * T, gy * T, T, T); return; }
    const cx = this.tileCX(gx, gy), cy = this.tileCY(gx, gy);
    const hw = this.isoHW(), hh = this.isoHH();
    ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy); ctx.closePath();
  },

  clampCam() {
    let lw, lh;
    if (this.isoOn()) {
      lw = (CFG.map.cols + CFG.map.rows + 2) * this.isoHW() * this.scale;
      lh = (CFG.map.cols + CFG.map.rows + 4) * this.isoHH() * this.scale;
    } else {
      lw = CFG.map.cols * CFG.map.tile * this.scale;
      lh = CFG.map.rows * CFG.map.tile * this.scale;
    }
    if (lw <= this.cw) this.camX = (lw - this.cw) / 2;
    else this.camX = Math.min(Math.max(this.camX, 0), lw - this.cw);
    if (lh <= this.ch) this.camY = (lh - this.ch) / 2;
    else this.camY = Math.min(Math.max(this.camY, 0), lh - this.ch);
    this.offX = -this.camX;
    this.offY = -this.camY;
  },

  panBy(dx, dy) { this.camX += dx; this.camY += dy; this.clampCam(); },

  /** 以视口内某点为锚点缩放（滚轮），锚点下的地图位置保持不动 */
  zoomAt(f, ax, ay) {
    const oldT = CFG.map.tile * this.scale;
    const gx = (ax + this.camX) / oldT;
    const gy = (ay + this.camY) / oldT;
    /* 缩放下限动态化：地图至少覆盖视口 92% —— 消除缩太小时的"清晰地图浮在模糊背景上"画中画 */
    /* 缩放下限动态化（画中画修复）：地图至少覆盖视口 92%。
     * ⚠️ 世界尺寸随视角不同：等轴菱形 = (cols+rows)×HW / ×HH（2640×1320），
     *    正交 = cols×T / rows×T（1740×900）——2:1 等轴下沿用正交尺寸会缩不出全图。 */
    const isoNow = this.isoOn();
    const mw = isoNow ? (CFG.map.cols + CFG.map.rows) * this.isoHW() : CFG.map.cols * CFG.map.tile;
    const mh = isoNow ? (CFG.map.cols + CFG.map.rows) * this.isoHH() : CFG.map.rows * CFG.map.tile;
    const minS = Math.max(0.45, Math.min(this.cw / mw, this.ch / mh) * 0.92);
    this.scale = Math.min(2.2, Math.max(minS, this.scale * f));
    const newT = CFG.map.tile * this.scale;
    this.camX = gx * newT - ax;
    this.camY = gy * newT - ay;
    this.clampCam();
  },

  /** 让某格居中（用于「视角回城」） */
  centerOn(gx, gy) {
    if (this.isoOn()) {
      const hw = this.isoHW() * this.scale, hh = this.isoHH() * this.scale;
      this.camX = this.isoOX() * this.scale + (gx - gy) * hw - this.cw / 2;
      this.camY = this.isoOY() * this.scale + (gx + gy) * hh - this.ch / 2;
      this.clampCam();
      return;
    }
    const T = CFG.map.tile * this.scale;
    this.camX = (gx + 0.5) * T - this.cw / 2;
    this.camY = (gy + 0.5) * T - this.ch / 2;
    this.clampCam();
  },

  /** 格子坐标 → 面板像素（DOM 城市格用它对齐 Canvas） */
  tileRect(gx, gy) {
    const t = CFG.map.tile * this.scale;
    if (this.isoOn()) {
      const cx = this.isoOX() * this.scale + this.offX + (gx - gy) * this.isoHW() * this.scale;
      const cy = this.isoOY() * this.scale + this.offY + (gx + gy) * this.isoHH() * this.scale;
      const w = this.isoHW() * 2 * this.scale, h = this.isoHH() * 2 * this.scale;
      return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
    }
    return { x: this.offX + gx * t, y: this.offY + gy * t, w: t, h: t };
  },

  /* ==================== 绘制 ==================== */

  render() {
    const ctx = this.ctx;
    if (!ctx || !this.cw) return;
    const T = CFG.map.tile;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    /* 等轴模式 = 作战沙盘：背景是作战室的深木色桌面（横纹+暖光暗角），
     * 沙盘木框由 drawIsoWorld 绘制（框外桌面、框内沙盘本体） */
    if (this.isoOn()) {
      /* 手绘沙盘成图（A 木框版 / B 延展铺满版）自带桌面与光效 → 程序化桌面只在无成图时兜底 */
      if (!this.isoPaintedActive()) {
        ctx.fillStyle = '#3a2d1e';
        ctx.fillRect(0, 0, this.cw, this.ch);
        ctx.fillStyle = '#453622';
        for (let y = 36; y < this.ch; y += 72) ctx.fillRect(0, y, this.cw, 36);
        const lamp = ctx.createRadialGradient(this.cw / 2, this.ch * 0.4, this.ch * 0.2, this.cw / 2, this.ch * 0.4, Math.max(this.cw, this.ch) * 0.85);
        lamp.addColorStop(0, 'rgba(255,214,150,0.14)');
        lamp.addColorStop(0.6, 'rgba(0,0,0,0.05)');
        lamp.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = lamp;
        ctx.fillRect(0, 0, this.cw, this.ch);
      }
    } else {
      ctx.fillStyle = COL.bg;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }

    // 用 try/finally 兜底：任何一处绘制异常都不会把画布变换留在脏状态
    this.drainFx();          // 先消费逻辑层的特效事件（drawBuildings 要用 pop 变形）
    ctx.save();
    try {
      ctx.translate(this.offX, this.offY);
      ctx.scale(this.scale, this.scale);

      if (this.isoOn()) {
        /* ★ 等轴测世界（第七十四次修订 MVP）：草地/地形/路/物体/信息牌全部走 iso 绘制 */
        this.drawIsoWorld(ctx, T);
      } else {
        this.drawTiles(ctx, T);
        this.drawRoads(ctx, T);
        this.drawObjects(ctx, T);
        this.drawBuildings(ctx, T);
        this.drawMapLabels(ctx, T);
        this.drawSelection(ctx, T);
        this.drawDropPreview(ctx, T);
        this.drawRoadPreview(ctx, T);
        this.drawTowerRange(ctx, T);
        this.drawPlaceMode(ctx, T);
        this.drawTroops(ctx, T);
        this.drawMarching(ctx, T);
        this.drawMoves(ctx, T);
      }
      this.drawFx(ctx, T);   // 特效在最上层（爆炸/飘字/光环）
    } catch (e) {
      if (!this._errShown) { this._errShown = true; console.error('[Sandbox] 绘制异常：', e); }
    } finally {
      ctx.restore();
    }
    this.drawPlateTag(ctx);
  },

  /* 草地棋盘格 + 随机装饰 */
  drawTiles(ctx, T) {
    const V = CFG.mapVisual;
    /* 第三层：手绘底板（负责氛围；缺失时回退到程序化草地） */
    if (V && V.enabled && this.plateImg) {
      const mw = CFG.map.cols * T, mh = CFG.map.rows * T, P = PLATE_PAD;
      /* 地图比视口小 → 四周会露底：改用外扩底图铺满（绿幕修复，第四十二次修订·方案 2） */
      const exposed = mw * this.scale < this.cw || mh * this.scale < this.ch;
      if (exposed && this.plateExt) ctx.drawImage(this.plateExt, -P, -P, mw + P * 2, mh + P * 2);
      else ctx.drawImage(this.plateImg, 0, 0, mw, mh);
      /* 光照立体层（第七十七次修订补充）：全局西北亮→东南暗，给平面地图加体积感 */
      const lg = ctx.createLinearGradient(0, 0, mw, mh);
      lg.addColorStop(0, 'rgba(255,244,214,0.10)');
      lg.addColorStop(0.55, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(8,14,8,0.17)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, mw, mh);
      /* 地形光照层（第七十八次修订·样板）：逐格上受光/下投影 + 水域岸线 */
      if (CFG.mapVisual.terrainLight && CFG.mapVisual.terrainLight.on) {
        this.drawTerrainLighting(ctx, T, CFG.mapVisual.terrainLight.bbox);
      }
      /* 立体地形覆盖层（第七十八次修订补充）：俯视符号 → 立体模型（山棱面+雪顶 / 立体树）
       * 攻城掠地式立体感来源：素材本身画成立体模型，而非空间投影 */
      if (CFG.mapVisual.terrainProps !== false) {
        this.drawTerrainProps(ctx, T);
      }
    } else {
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          const r = hash2(gx, gy);
          let c = (gx + gy) % 2 === 0 ? COL.grassA : COL.grassB;
          if (r < 0.10) c = COL.grassDark;
          else if (r > 0.92) c = COL.grassLight;
          ctx.fillStyle = c;
          ctx.fillRect(gx * T, gy * T, T, T);
        }
      }
    }
    if (!V || !V.enabled) {
      /* 旧式网格线保留作为 mapVisual 关闭时的回退路径 */
      this.drawGridClassic(ctx, T);
      return;
    }
    /* 底图自带烘焙网格（A/B/C 三选一试验）→ 代码网格与棋盘全部让位，避免两层错位网格 */
    if (this.plateBaked) return;
    const build = this.buildModeActive();
    /* 极淡棋盘：给每一格"空间感"，但不喧宾夺主（建造模式略微增强） */
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        ctx.fillStyle = ((gx + gy) % 2 === 0)
          ? (build ? V.grid.buildChecker : V.grid.checker)
          : (build ? V.grid.buildCheckerAlt : V.grid.checkerAlt);
        ctx.fillRect(gx * T, gy * T, T, T);
      }
    }
    /* 地形 Debug 覆盖（调参面板 / T 键，默认关；正式视觉禁止使用） */
    if (V.terrainDebug && CFG.map.terrain) {
      const DC = V.terrainDebugColors;
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          const col = DC[CFG.map.terrain[gy][gx] || '.'];
          if (col) { ctx.fillStyle = col; ctx.fillRect(gx * T, gy * T, T, T); }
        }
      }
    }
    this.drawGrid(ctx, T);
  },

  /**
   * 手绘质感网格（第三十次修订：第三视觉层）
   * · 普通态：按所在格地形取色（草地暖棕/森林暗绿/山灰/水蓝灰），低对比细线，
   *   "能看出方格但不会第一眼注意到"，与手绘材质融合
   * · 建造模式：整体增强（加亮加粗），配合占地高亮让玩家看清格子边界
   * 抖动是 hash 确定性的，逐帧稳定不闪烁
   */
  /**
   * 立体地形覆盖层（第七十八次修订补充）：把底图上的俯视山/树符号替换为立体模型插画。
   * 山 = 主峰棱面（左亮右暗）+ 雪顶 + 接触阴影，可超格向上；树 = 树干 + 双层树冠，每格 2~3 棵。
   * 位置由地形码决定（P2.6 底图按地形数据绘制，格对齐有保证）；hash 决定格内偏移与变体。
   */
  drawTerrainProps(ctx, T) {
    const G = global.Game;
    const ter = CFG.map.terrain;
    if (!ter) return;
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        const t = ter[gy] && ter[gy][gx];
        if (t !== 'M' && t !== 'F' && t !== 'f') continue;
        const r1 = hash2(gx * 3 + 1, gy * 7 + 2), r2 = hash2(gx * 5 + 3, gy * 11 + 4);
        const cx = (gx + 0.5) * T + (r1 - 0.5) * T * 0.24;
        const cy = (gy + 0.5) * T + (r2 - 0.5) * T * 0.18;
        if (t === 'M') {
          /* 接触阴影 */
          ctx.fillStyle = 'rgba(20,26,16,0.30)';
          ctx.beginPath(); ctx.ellipse(cx + T * 0.06, cy + T * 0.30, T * 0.46, T * 0.13, 0, 0, Math.PI * 2); ctx.fill();
          /* 素材优先：手绘水彩立体山（hy image 生成 → 白底键出） */
          const msp = this.terrainSprites && this.terrainSprites.mountain && this.terrainSprites.mountain[r2 > 0.5 ? 0 : 0];
          if (msp) {
            const w = T * 1.5, h = w * (msp.height / msp.width);
            ctx.drawImage(msp, cx - w / 2, cy + T * 0.30 - h, w, h);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.font = '700 ' + Math.round(T * 0.2) + 'px system-ui, sans-serif';
            return;
          }
          /* 山体：左棱亮面 + 右棱暗面（统一西北光） */
          const h = T * (1.05 + r2 * 0.35);
          ctx.fillStyle = '#9aa48f';
          ctx.beginPath();
          ctx.moveTo(cx - T * 0.46, cy + T * 0.26);
          ctx.lineTo(cx - T * 0.10, cy + T * 0.26 - h);
          ctx.lineTo(cx + T * 0.06, cy + T * 0.26 - h * 0.82);
          ctx.lineTo(cx + T * 0.30, cy + T * 0.26);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#71796c';
          ctx.beginPath();
          ctx.moveTo(cx - T * 0.10, cy + T * 0.26 - h);
          ctx.lineTo(cx + T * 0.06, cy + T * 0.26 - h * 0.82);
          ctx.lineTo(cx + T * 0.30, cy + T * 0.26);
          ctx.lineTo(cx + T * 0.02, cy + T * 0.26 - h * 0.55);
          ctx.closePath(); ctx.fill();
          /* 雪顶 */
          ctx.fillStyle = '#eef2f4';
          ctx.beginPath();
          ctx.moveTo(cx - T * 0.10, cy + T * 0.26 - h);
          ctx.lineTo(cx + T * 0.02, cy + T * 0.26 - h * 0.80);
          ctx.lineTo(cx - T * 0.02, cy + T * 0.26 - h * 0.72);
          ctx.lineTo(cx - T * 0.06, cy + T * 0.26 - h * 0.78);
          ctx.closePath(); ctx.fill();
        } else {
          /* 树 ×2~3：树干 + 深色底层树冠 + 亮色顶层树冠 + 高光 */
          const n = 2 + (r1 > 0.5 ? 1 : 0);
          const tsp = this.terrainSprites && this.terrainSprites.tree && this.terrainSprites.tree[0];
          for (let i = 0; i < n; i++) {
            const rr = hash2(gx * 13 + i * 7, gy * 17 + i * 3);
            const tx = cx + (rr - 0.5) * T * 0.62;
            const ty = cy + (hash2(gx + i, gy * 3 + i) - 0.5) * T * 0.4;
            const s = T * (0.16 + rr * 0.08);
            /* 素材优先：手绘水彩树 */
            if (tsp) {
              const tw = s * 2.6, th = tw * (tsp.height / tsp.width);
              ctx.save();
              if (rr > 0.5) { ctx.translate(tx, ty); ctx.scale(-1, 1); ctx.translate(-tx, -ty); }
              ctx.drawImage(tsp, tx - tw / 2, ty + T * 0.18 - th, tw, th);
              ctx.restore();
              continue;
            }
            ctx.fillStyle = 'rgba(20,26,16,0.25)';
            ctx.beginPath(); ctx.ellipse(tx + s * 0.2, ty + s * 0.9, s * 0.9, s * 0.32, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#6b4f30';
            ctx.fillRect(tx - s * 0.09, ty, s * 0.18, s * 0.85);
            ctx.fillStyle = '#3e5c33';
            ctx.beginPath(); ctx.arc(tx, ty - s * 0.35, s * 0.62, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4e7240';
            ctx.beginPath(); ctx.arc(tx - s * 0.12, ty - s * 0.5, s * 0.46, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#5f8a4d';
            ctx.beginPath(); ctx.arc(tx - s * 0.18, ty - s * 0.6, s * 0.28, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
  },

  /**
   * 地形光照层（第七十八次修订·样板）：逐格"上受光 / 下投影" + 水域岸线。
   * 统一光照方向 = 西北受光 / 东南投影；山体加强、森林投影、水陆岸线。
   * bbox 限定样板区；验收后放开为全图。纯叠加，不改玩法与判定。
   */
  drawTerrainLighting(ctx, T, bbox) {
    const G = global.Game;
    const ter = CFG.map.terrain;
    if (!ter || !bbox) return;
    const isLand = function (gx, gy) {
      if (gx < 0 || gy < 0 || gx >= CFG.map.cols || gy >= CFG.map.rows) return false;
      const t = ter[gy] && ter[gy][gx];
      return t !== 'W';
    };
    for (let gy = bbox.y0; gy <= bbox.y1; gy++) {
      for (let gx = bbox.x0; gx <= bbox.x1; gx++) {
        if (gx < 0 || gy < 0 || gx >= CFG.map.cols || gy >= CFG.map.rows) continue;
        const t = ter[gy] && ter[gy][gx];
        if (!t || t === '.') continue;
        const x = gx * T, y = gy * T;
        if (t === 'M') {
          /* 山体：上 42% 受光亮带 / 下 42% 投影暗带（山顶亮、山脚沉） */
          ctx.fillStyle = 'rgba(255,244,214,0.11)';
          ctx.fillRect(x, y, T, T * 0.42);
          ctx.fillStyle = 'rgba(10,14,8,0.20)';
          ctx.fillRect(x, y + T * 0.58, T, T * 0.42);
        } else if (t === 'F' || t === 'f') {
          /* 森林：南缘投影带（树冠投下的林影） */
          ctx.fillStyle = 'rgba(10,14,8,0.13)';
          ctx.fillRect(x, y + T * 0.66, T, T * 0.34);
        } else if (t === 'W') {
          /* 水域岸线：与陆地相邻的边 → 陆侧投影 + 水内缘高光 */
          const banks = [];
          if (isLand(gx, gy - 1)) banks.push([x, y, x + T, y, 0, -1]);
          if (isLand(gx, gy + 1)) banks.push([x, y + T, x + T, y + T, 0, 1]);
          if (isLand(gx - 1, gy)) banks.push([x, y, x, y + T, -1, 0]);
          if (isLand(gx + 1, gy)) banks.push([x + T, y, x + T, y + T, 1, 0]);
          banks.forEach(function (b) {
            ctx.strokeStyle = 'rgba(10,14,8,0.18)'; ctx.lineWidth = Math.max(2, T * 0.05);
            ctx.beginPath(); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[2], b[3]); ctx.stroke();
            ctx.strokeStyle = 'rgba(214,232,244,0.14)'; ctx.lineWidth = Math.max(1.5, T * 0.035);
            ctx.beginPath(); ctx.moveTo(b[0] + b[4] * T * 0.10, b[1] + b[5] * T * 0.10);
            ctx.lineTo(b[2] + b[4] * T * 0.10, b[3] + b[5] * T * 0.10); ctx.stroke();
          });
        }
      }
    }
  },

  drawGrid(ctx, T) {
    const G = CFG.mapVisual.grid;
    const j = G.jitter;
    const terrain = CFG.map.terrain;
    const build = this.buildModeActive();
    const colOf = (gx, gy) => {
      if (build) return G.buildColor;
      const c = (terrain && terrain[gy] && terrain[gy][gx]) || '.';
      return (G.colorByTerrain && G.colorByTerrain[c]) || G.color;
    };
    ctx.save();
    ctx.lineWidth = build ? G.buildWidth : G.width;
    /* 每格画自己的上边与左边（颜色跟随本格地形），外缘由相邻格补齐 */
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        const c = colOf(gx, gy);
        const x0 = gx * T, y0 = gy * T;
        ctx.strokeStyle = c;
        ctx.beginPath();
        // 上边
        let o0 = (hash2(gx, gy * 3) - 0.5) * 2 * j;
        let o1 = (hash2(gx + 1, gy * 3) - 0.5) * 2 * j;
        ctx.moveTo(x0, y0 + o0); ctx.lineTo(x0 + T, y0 + o1);
        // 左边
        o0 = (hash2(gx, gy) - 0.5) * 2 * j;
        o1 = (hash2(gx, gy + 1) - 0.5) * 2 * j;
        ctx.moveTo(x0 + o0, y0); ctx.lineTo(x0 + o1, y0 + T);
        ctx.stroke();
      }
    }
    /* 地图右缘与下缘（跟随最边上一格的地形色） */
    ctx.beginPath();
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      const o0 = (hash2(CFG.map.cols, gy * 3) - 0.5) * 2 * j;
      const o1 = (hash2(CFG.map.cols, (gy + 1) * 3) - 0.5) * 2 * j;
      ctx.strokeStyle = colOf(CFG.map.cols - 1, gy);
      ctx.moveTo(CFG.map.cols * T, gy * T + o0);
      ctx.lineTo(CFG.map.cols * T, (gy + 1) * T + o1);
    }
    for (let gx = 0; gx < CFG.map.cols; gx++) {
      const o0 = (hash2(gx, CFG.map.rows) - 0.5) * 2 * j;
      const o1 = (hash2(gx + 1, CFG.map.rows) - 0.5) * 2 * j;
      ctx.strokeStyle = colOf(gx, CFG.map.rows - 1);
      ctx.moveTo(gx * T + o0, CFG.map.rows * T);
      ctx.lineTo((gx + 1) * T + o1, CFG.map.rows * T);
    }
    ctx.stroke();
    ctx.restore();
  },

  drawGridClassic(ctx, T) {
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= CFG.map.cols; gx++) {
      ctx.beginPath(); ctx.moveTo(gx * T, 0); ctx.lineTo(gx * T, CFG.map.rows * T); ctx.stroke();
    }
    for (let gy = 0; gy <= CFG.map.rows; gy++) {
      ctx.beginPath(); ctx.moveTo(0, gy * T); ctx.lineTo(CFG.map.cols * T, gy * T); ctx.stroke();
    }
  },

  /* 道路（第八十二次修订收敛：带状路是路的唯一渲染，开垦层已随官道设定移除） */
  drawRoads(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const roads = G.state.roads || {};
    const V = CFG.mapVisual;
    const has = (gx, gy) => !!roads[gx + ',' + gy];
    if (!V || !V.enabled) {
      /* 旧式：灰白石板 */
      for (const k in roads) {
        const p = k.split(',');
        const gx = +p[0], gy = +p[1];
        const pad = T * 0.16;
        ctx.save();
        ctx.fillStyle = 'rgba(232,232,224,0.92)';
        ctx.fillRect(gx * T + pad, gy * T + pad, T - pad * 2, T - pad * 2);
        ctx.strokeStyle = 'rgba(150,150,140,0.95)';
        ctx.lineWidth = 2;
        ctx.strokeRect(gx * T + pad, gy * T + pad, T - pad * 2, T - pad * 2);
        ctx.restore();
      }
      return;
    }
    const R = V.road;
    const ter = CFG.map.terrain;
    /* 桥格（水域 + 道路）不画路面 → 露出底图里画好的木桥，路在两岸自然衔接 */
    const isWater = (gx, gy) => !!(ter && ter[gy] && ter[gy][gx] === 'W');
    const cells = [];
    for (const k in roads) {
      const p = k.split(',');
      const gx = +p[0], gy = +p[1];
      if (!isWater(gx, gy)) cells.push([gx, gy]);
    }
    /* ① 带状路：相邻格两两连段（圆头带）。
     * ★ 桥所在的水格本身不画路面（露出底图木桥），但**两岸都要补半段接到桥边**，
     *   否则每个渡口两侧各留半格空白，路看起来到不了桥。
     *   四向都要检查：只往右/下连的话，桥"对面"那一侧永远没人接（实测踩过）。 */
    const buildSegs = function () {
      const out = [];
      cells.forEach(function (c) {
        const gx = c[0], gy = c[1];
        const cx = (gx + 0.5) * T, cy = (gy + 0.5) * T;
        const link = function (nx, ny, dx, dy) {
          if (!has(nx, ny)) return;
          if (!isWater(nx, ny)) {
            if (dx > 0 || dy > 0) out.push([cx, cy, cx + dx * T, cy + dy * T]);  // 陆-陆：只画一次
          } else {
            out.push([cx, cy, cx + dx * T / 2, cy + dy * T / 2]);                // 陆-水：接到岸边
          }
        };
        link(gx + 1, gy, 1, 0); link(gx - 1, gy, -1, 0);
        link(gx, gy + 1, 0, 1); link(gx, gy - 1, 0, -1);
      });
      return out;
    };
    const segs = buildSegs();                // 全部路格
    const RB = R.ribbon;
    if (RB && segs.length) {
      const pass = function (L, w) {
        ctx.globalCompositeOperation = L.mode;
        ctx.globalAlpha = L.alpha;
        ctx.strokeStyle = L.color;
        ctx.lineWidth = T * w;
        ctx.beginPath();
        for (let i = 0; i < segs.length; i++) {
          ctx.moveTo(segs[i][0], segs[i][1]); ctx.lineTo(segs[i][2], segs[i][3]);
        }
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      pass(RB.edge, RB.edgeWidth);   // 路缘压暗：路"陷进地里"
      pass(RB.body, RB.width);       // 色相统一为土色（明暗纹理全保留）
      if (RB.pig) pass(RB.pig, RB.pig.width);  // 薄着色：高亮农田底上不被洗掉
      pass(RB.lift, RB.liftWidth);   // 土壤提亮
      pass(RB.core, RB.coreWidth);   // 路心被踩亮的一条
      ctx.restore();

      /* ② 毛边 + 斑驳 + 草茬侵入：确定性打点，模仿手绘土路的蚀边与深浅 */
      ctx.save();
      const N = RB.pebbles || 0, M = RB.mottle || 0, TU = RB.tufts || 0;
      for (let n = 0; n < cells.length; n++) {
        const gx = cells[n][0], gy = cells[n][1];
        const horiz = has(gx - 1, gy) || has(gx + 1, gy);
        const cx = (gx + 0.5) * T, cy = (gy + 0.5) * T;
        const dab = function (px, py, r1, r2, color, alpha) {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.ellipse(px, py, r1, r2, horiz ? 0 : Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
        };
        for (let q = 0; q < N; q++) {          // 毛边：碎石/土粒跨在路缘上
          const rx = hash2(gx * 31 + q, gy * 17);
          const ry = hash2(gy * 47 + q, gx * 13);
          const side = hash2(gx + q, gy - q);
          const px = horiz ? (gx + rx) * T : cx + (side - 0.5) * T * 0.52;
          const py = horiz ? cy + (side - 0.5) * T * 0.52 : (gy + ry) * T;
          dab(px, py, 1.2 + rx * 2.2, 1.0 + ry * 1.6, q % 2 ? RB.edge.color : '#a89268', 0.10 + ry * 0.10);
        }
        for (let q = 0; q < M; q++) {          // 斑驳：路面里的深浅土斑
          const rx = hash2(gx * 13 + q * 7, gy * 29 + q);
          const ry = hash2(gy * 7 + q * 11, gx * 31 + q);
          const px = horiz ? (gx + 0.15 + rx * 0.7) * T : cx + (ry - 0.5) * T * 0.24;
          const py = horiz ? cy + (ry - 0.5) * T * 0.24 : (gy + 0.15 + rx * 0.7) * T;
          dab(px, py, 2.0 + rx * 3.5, 1.6 + ry * 2.6, q % 2 ? '#8a7355' : '#b39b6f', 0.12 + ry * 0.12);
        }
        for (let q = 0; q < TU; q++) {         // 草茬：草从路两侧长回路上（绿色侵入）
          const rx = hash2(gx * 53 + q * 3, gy * 11 + q * 5);
          const ry = hash2(gy * 23 + q * 13, gx * 3 + q * 17);
          const inward = q % 2 ? 1 : -1;
          const off = (0.13 + ry * 0.07) * T * inward;
          const px = horiz ? (gx + 0.2 + rx * 0.6) * T : cx + off;
          const py = horiz ? cy + off : (gy + 0.2 + rx * 0.6) * T;
          dab(px, py, 1.4 + rx * 2.6, 1.1 + ry * 2.0, q % 2 ? '#7d9a4e' : '#94ad5c', 0.22 + ry * 0.16);
        }
      }
      ctx.restore();
    }
  },

  /* 资源点 / 中立塔 / 城门 / 外围建筑 */
  drawObjects(ctx, T) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    /* 第三十三次修订：去掉深棕大圆盘（压在手绘地图上像色块），改为
     * 小接地阴影 + 细归属环（只圈已占领的）+ 图标本体 */
    const icon = (gx, gy, txt, size, ring) => {
      const cx = (gx + 0.5) * T, cy = (gy + 0.5) * T;
      ctx.save();
      ctx.fillStyle = 'rgba(30,24,14,0.28)';
      ctx.beginPath(); ctx.ellipse(cx + 2, cy + T * 0.22, T * 0.26, T * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (ring) {
        ctx.beginPath(); ctx.arc(cx, cy, T * 0.34, 0, Math.PI * 2);
        ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.font = Math.round(T * (size || 0.5)) + 'px serif';
      ctx.fillText(txt, cx, cy + T * 0.02);
    };
    const label = (gx, gy, txt, color) => {
      ctx.font = '700 ' + Math.round(T * 0.24) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
      ctx.strokeText(txt, (gx + 0.5) * T, (gy + 1.1) * T);
      ctx.fillText(txt, (gx + 0.5) * T, (gy + 1.1) * T);
    };

    const G = global.Game;
    const RC = CFG.resourceCamps;
    const CW = (RC && RC.width) || 1.5;
    const FLAG = { p1: '#2f6fb8', p2: '#c0392b' };
    CFG.map.resources.forEach((r) => {
      const owner = (G && G.state) ? G.resourceOwnerOf(r) : null;
      const cx = (r.gx + 0.5) * T, cy = (r.gy + 0.5) * T;

      /* ① 接地阴影（据点比原来的 emoji 大，阴影同步放大）
       * 2026-10-13 v2：同步等轴修复——硬边椭圆 → 柔边径向渐变（边缘羽化贴地） */
      ctx.save();
      ctx.translate(cx + 2, cy + T * 0.32);
      ctx.scale(1, 0.30);
      const shgO = ctx.createRadialGradient(0, 0, 0, 0, 0, T * 0.46);
      shgO.addColorStop(0, 'rgba(30,24,14,0.30)');
      shgO.addColorStop(0.62, 'rgba(30,24,14,0.20)');
      shgO.addColorStop(1, 'rgba(30,24,14,0)');
      ctx.fillStyle = shgO;
      ctx.beginPath(); ctx.arc(0, 0, T * 0.46, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      /* ② 未占领：淡金色呼吸光 —— 唤起"这里是个目标"的注意（方案A） */
      if (!owner) {
        /* performance 在无头冒烟环境的假 global 里可能不存在 */
        const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const ph = (nowMs / 1000) % 2.8 / 2.8;
        const a = 0.09 + 0.12 * (1 - Math.abs(ph * 2 - 1));
        const gr = ctx.createRadialGradient(cx, cy - T * 0.08, T * 0.12, cx, cy - T * 0.08, T * 0.92);
        gr.addColorStop(0, 'rgba(255,224,138,' + a.toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(255,224,138,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(cx, cy - T * 0.08, T * 0.92, 0, Math.PI * 2); ctx.fill();
      }

      /* ③ 据点实体（素材缺失 → 降级回 emoji 图标） */
      const sp = this.resSprites && this.resSprites[r.res];
      if (sp) {
        const w = T * CW, h = w * (sp.height / sp.width);
        ctx.drawImage(sp, cx - w / 2, cy + T * 0.32 - h, w, h);
      } else {
        const ico = r.res === 'food' ? '🌾' : (r.res === 'logistics' ? '🛣️' : '⚡');
        ctx.font = Math.round(T * 0.5) + 'px serif';
        ctx.fillText(ico, cx, cy);
      }

      /* ④ 占领旗（率土式插旗）：中立不插旗 —— 旗只在有归属后出现 */
      if (owner && FLAG[owner]) {
        const px = cx + T * 0.46, top = cy - T * 0.66, base = cy + T * 0.30;
        ctx.strokeStyle = '#4a3520'; ctx.lineWidth = Math.max(2, T * 0.05);
        ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, top); ctx.stroke();
        const fw = T * 0.36, fh = T * 0.21;
        ctx.fillStyle = FLAG[owner];
        ctx.beginPath(); ctx.moveTo(px, top);
        ctx.lineTo(px + fw, top + fh * 0.5); ctx.lineTo(px, top + fh);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      }
    });
  },

  /* 建筑：主城 + 玩家建造的建筑 —— 逻辑占格 N×N + 视觉溢出（第三十次修订）
   * 地基 / 归属框 / 入口小路 / 阴影都按整块占地画；贴图横向略溢出、竖直向上长，
   * 屋顶塔尖可以超出逻辑格 —— 建筑是"建在土地上"的，不是钉死在格子里的棋子 */
  drawBuildings(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* gx/gy = 占地左上角（anchor）；尺寸由 footOf 决定（1×1 / 2×2） */
    const tile = (gx, gy, icon, size, ring, fill, label, level, key, side) => {
      const V = CFG.mapVisual;
      const mine = (side || 'p1') !== 'p2';
      const sp = this.sprites && this.sprites[key || ''];
      const fp = G.footOf(key);
      const fw = fp.w * T, fh = fp.h * T;
      const x0 = gx * T, y0 = gy * T;
      const cx = x0 + fw / 2;
      if (V && V.enabled) {
        /* ① 地基平涂已废除（第三十三次修订）：素材自带草地底座且为透明 PNG，
         *    平涂矩形压在手绘地图上像"没抠干净的背景色块"。建筑直接落地。
         * ② 归属标识 = 占地外沿一圈细线（低透明度），不再画粗框 */
        ctx.strokeStyle = mine ? 'rgba(90,160,235,0.40)' : 'rgba(240,110,110,0.45)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 0.5, y0 + 0.5, fw - 1, fh - 1);
        /* ③ 入口小路：占地外圈哪一格贴路，就从那一侧接一小段（调淡，融进地图） */
        const rds = (G.state && G.state.roads) || {};
        ctx.save();
        ctx.globalAlpha = 0.55;
        G.footRing(gx, gy, key).forEach((p) => {
          if (!rds[p[0] + ',' + p[1]]) return;
          const w = T * 0.20;
          ctx.fillStyle = V.road.stub || V.road.fill;
          if (p[0] < gx) ctx.fillRect(x0 - T * 0.10, (p[1] + 0.5) * T - w / 2, T * 0.20, w);
          else if (p[0] >= gx + fp.w) ctx.fillRect(x0 + fw - T * 0.10, (p[1] + 0.5) * T - w / 2, T * 0.20, w);
          else if (p[1] < gy) ctx.fillRect((p[0] + 0.5) * T - w / 2, y0 - T * 0.10, w, T * 0.20);
          else ctx.fillRect((p[0] + 0.5) * T - w / 2, y0 + fh - T * 0.10, w, T * 0.20);
        });
        ctx.restore();
        /* ④ 接地阴影（光从左上 → 影子落右下），随占地放大 */
        ctx.save();
        ctx.fillStyle = 'rgba(52,42,24,0.30)';
        ctx.beginPath();
        ctx.ellipse(cx + fw * 0.04, y0 + fh - T * 0.08, fw * 0.46, T * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        /* ⑤ 建筑本体（横向略溢出，竖直向上长出格） */
        if (sp) {
          const tall = (key === 'tower' || key === 'castle');
          let w = Math.round(fw * 1.02);
          let h = Math.round(tall ? fh * 0.50 + T * 1.05 : fh * 0.60 + T * 0.52);
          let px = cx - w / 2, py = y0 + fh - T * 0.06 - h, ga = 1;
          /* 落成 / 升级：底边锚定的纵向弹跳（第四十四次修订）。
           * 旧版建筑是"凭空出现"，这是"demo 感"的主要来源之一。 */
          const pop = this.popOf(gx, gy, performance.now());
          if (pop) {
            h = Math.max(1, Math.round(h * pop.ky));
            w = Math.max(1, Math.round(w * pop.kx));
            px = cx - w / 2;
            py = y0 + fh - T * 0.06 - h;    // 底边不动 → 读起来像从地面长出来
            ga = pop.alpha;
          }
          if (ga < 1) { ctx.save(); ctx.globalAlpha = ga; }
          ctx.drawImage(sp, px, py, w, h);
          if (ga < 1) ctx.restore();
        } else {
          /* 贴图未就绪（无头 / assets 关闭）→ 退回"名称 + 等级"文字，信息不丢 */
          const icy = y0 + fh * 0.42;
          ctx.font = Math.round(T * (size || 0.5)) + 'px serif';
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
          ctx.strokeText(icon, cx, icy - T * 0.14);
          ctx.fillText(icon, cx, icy - T * 0.14);
          ctx.font = '700 ' + Math.round(T * 0.2) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
          const t0 = level ? label + ' Lv' + level : label;
          ctx.strokeText(t0, cx, icy + T * 0.24);
          ctx.fillText(t0, cx, icy + T * 0.24);
          return;
        }
        if (level) {
          const txt = 'Lv' + level;
          ctx.font = '700 ' + Math.round(T * 0.2) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
          const bw = ctx.measureText(txt).width + T * 0.16;
          const bx = x0 + fw - bw - 2, by = y0 + fh - T * 0.26 - 2;
          ctx.fillStyle = 'rgba(30,24,14,0.66)';
          ctx.fillRect(bx, by, bw, T * 0.26);
          ctx.fillStyle = '#ffe9a8';
          ctx.textAlign = 'center';
          ctx.fillText(txt, bx + bw / 2, by + T * 0.14);
        }
        return;
      }
      /* mapVisual 关闭时的旧贴图路径（保留兼容） */
      if (spOld) {
        const hh = Math.round(T * ((key === 'tower' || key === 'castle') ? 1.55 : 1.14));
        ctx.drawImage(spOld, cx - hh / 2, y0 + fh / 2 + T * 0.42 - hh, hh, hh);
        if (level) {
          const txt = 'Lv' + level;
          ctx.font = '700 ' + Math.round(T * 0.2) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
          const w = ctx.measureText(txt).width + T * 0.16;
          const bx = x0 + fw - w - 2, by = y0 + fh - T * 0.26 - 2;
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.fillRect(bx, by, w, T * 0.26);
          ctx.fillStyle = '#ffe9a8';
          ctx.textAlign = 'center';
          ctx.fillText(txt, bx + w / 2, by + T * 0.14);
        }
        return;
      }
      /* emoji 占位路径（无头环境 / 贴图未加载 / assets 关闭） */
      ctx.save();
      ctx.fillStyle = fill;
      ctx.fillRect(x0 + 2, y0 + 2, fw - 4, fh - 4);
      ctx.strokeStyle = ring;
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 + 2, y0 + 2, fw - 4, fh - 4);
      ctx.restore();
      ctx.font = Math.round(T * size) + 'px serif';
      ctx.fillText(icon, cx, y0 + fh / 2 - T * 0.04);
      ctx.font = '700 ' + Math.round(T * 0.23) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3;
      const txt = level ? label + ' Lv' + level : label;
      ctx.strokeText(txt, cx, y0 + fh / 2 + T * 0.36);
      ctx.fillText(txt, cx, y0 + fh / 2 + T * 0.36);
    };

    // 建筑（按归属配色：我方蓝 / 敌方红）+ 防御值血条（血条横跨整块占地）
    const all = [];
    for (const k in G.state.buildings) all.push(G.state.buildings[k]);
    all.forEach((b) => {
      const mine = (b.owner || 'p1') === 'p1';
      const d = CFG.buildings[b.type];
      tile(b.gx, b.gy, d.icon, 0.5,
           mine ? COL.p1 : COL.p2,
           mine ? 'rgba(28,58,94,0.82)' : 'rgba(94,28,28,0.85)',
           d.name, b.level, b.type, b.owner);
      const fpb = G.footOf(b.type);
      const maxHp = G.buildingMaxHp(b.level);
      if (b.hp < maxHp) {
        const w = fpb.w * T - 10, h = 5, x = b.gx * T + 5, y = b.gy * T + 4;
        const k2 = Math.max(0, b.hp / maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = k2 > 0.5 ? '#7ed957' : (k2 > 0.25 ? '#ffc23f' : '#ff5f5f');
        ctx.fillRect(x, y, w * k2, h);
      }
    });

    // 我方主城（带血条）
    const c = G.state.castle;
    tile(c.gx, c.gy, '🏰', 0.62, COL.p1, 'rgba(60,50,10,0.9)', '主城', G.state.castleLevel, 'castle', 'p1');
    const cMax = G.castleMaxHp();
    if (G.state.castleHp < cMax) {
      const w = G.footOf('castle').w * T - 10, x = c.gx * T + 5, y = c.gy * T + 4;
      const k2 = Math.max(0, G.state.castleHp / cMax);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = k2 > 0.5 ? '#7ed957' : (k2 > 0.25 ? '#ffc23f' : '#ff5f5f');
      ctx.fillRect(x, y, w * k2, 5);
    }

    // 敌方主城（带血条）
    const e = G.enemyCastle();
    tile(e.gx, e.gy, '🏰', 0.62, COL.p2, 'rgba(94,28,28,0.85)', '敌方主城', 1, 'castle', 'p2');
    const eMax = e.maxHp || 100;
    {
      const w = G.footOf('castle').w * T - 10, x = e.gx * T + 5, y = e.gy * T + 4;
      const k2 = Math.max(0, (e.hp || 0) / eMax);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, 5);
      ctx.fillStyle = k2 > 0.5 ? '#7ed957' : (k2 > 0.25 ? '#ffc23f' : '#ff5f5f');
      ctx.fillRect(x, y, w * k2, 5);
    }
  },

  /* ==================== 部队 / 选中 / 移动（Phase 3b） ==================== */

  /** 选中格高亮；若选中部队（或正在拖兵），把所有「可派兵的目标格」用淡蓝点标出来 */
  drawSelection(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const sel = G.state.sel;
    const dragging = this.dragFrom;

    // 选中了部队（或正在拖兵）→ 标记所有可派兵的建筑格
    if ((sel && G.troopsAt(sel.gx, sel.gy).p1 > 0) || dragging) {
      G.targetTiles().forEach((t) => {
        if (sel && t.gx === sel.gx && t.gy === sel.gy) return;
        if (dragging && t.gx === dragging.gx && t.gy === dragging.gy) return;
        const cx = (t.gx + 0.5) * T, cy = (t.gy + 0.5) * T;
        ctx.save();
        ctx.fillStyle = 'rgba(74,158,255,0.95)';
        ctx.beginPath(); ctx.arc(cx, cy - T * 0.34, T * 0.075, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(8,14,22,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      });
    }

    // 正在拖兵 → 起点格加高亮框
    if (dragging) {
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 3;
      ctx.strokeRect(dragging.gx * T + 2, dragging.gy * T + 2, T - 4, T - 4);
      ctx.restore();
    }

    if (!sel) return;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 3;
    ctx.strokeRect(sel.gx * T + 2, sel.gy * T + 2, T - 4, T - 4);
    ctx.restore();
  },

  /** 每格上的双方兵力数字（行军中的那支部队交给 drawMarching 画，避免重影） */
  drawTroops(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const skip = {};
    (G.state.march || []).forEach(function (m) {
      const p = m.path[Math.min(m.idx, m.path.length - 1)];
      skip[p.gx + ',' + p.gy] = 1;
    });
    G.troopTiles().forEach((t) => {
      const both = t.p1 > 0 && t.p2 > 0;
      const stranded1 = t.p1 > 0 && G.isStrandedTroops(t.gx, t.gy, 'p1');
      const stranded2 = t.p2 > 0 && G.isStrandedTroops(t.gx, t.gy, 'p2');
      const dx = both ? -T * 0.22 : 0;
      /* ★ 第八十一次修订：部队标识改回圆形徽章（用户反馈旗杆+三角旗+方块牌不好）——
       *   深色圆底 + 阵营色描边 + 白字，滞留虚线+待命小字保留；行军箭头不受影响。 */
      const badge = (n, side, ddx, stranded) => {
        if (n <= 0) return;
        const col = side === 'p1' ? '#2f6fb8' : '#c0392b';
        const cx2 = (t.gx + 0.5) * T + ddx, cy2 = (t.gy + 0.5) * T;
        const r = T * 0.3;
        ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(8,14,22,0.92)'; ctx.fill();
        if (stranded) ctx.setLineDash([5, 4]);
        ctx.strokeStyle = col; ctx.lineWidth = stranded ? 2 : 3; ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fff';
        ctx.font = '700 ' + Math.round(T * 0.27) + 'px system-ui, sans-serif';
        ctx.fillText(String(n), cx2, cy2 + T * 0.02);
        if (stranded) {
          ctx.fillStyle = 'rgba(255,255,255,0.72)';
          ctx.font = '600 ' + Math.round(T * 0.15) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
          ctx.fillText('待命', cx2, cy2 + T * 0.42);
        }
      };
      badge(t.p1, 'p1', dx, stranded1);
      badge(t.p2, 'p2', both ? T * 0.24 : 0, stranded2);
    });
  },

  /** 部队兵力旗标（作战沙盘式，正交版）：旗杆 + 三角旗 + 兵力牌；滞留时旗面灰色 */
  /** 行军部队（作战沙盘式，正交版）：剩余路径作战箭头 + 行军兵力牌 */
  drawMarching(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const self = this;
    const secPerBase = CFG.soldier.marchSecPerTile;
    G.state.march.forEach(function (m) {
      const i = Math.min(m.idx, m.path.length - 2);
      if (i < 0) return;
      const k = Math.max(0, Math.min(1, (m.t || 0) / self.marchSpeedOf(m.side)));
      const a = m.path[i], b = m.path[i + 1];
      const hx = (a.gx + (b.gx - a.gx) * k + 0.5) * T;
      const hy = (a.gy + (b.gy - a.gy) * k + 0.5) * T;
      const col = m.side === 'p1' ? '#2f6fb8' : '#c0392b';
      const lite = m.side === 'p1' ? '#9cc4ee' : '#f0a898';
      /* 作战箭头：当前位置 → 目标（沿剩余路径），军事地图式 */
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      for (let pi = i + 1; pi < m.path.length; pi++) {
        ctx.lineTo((m.path[pi].gx + 0.5) * T, (m.path[pi].gy + 0.5) * T);
      }
      ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.stroke();
      ctx.strokeStyle = lite; ctx.lineWidth = 3.5; ctx.stroke();
      /* 箭头头部（沿末段方向的后掠三角） */
      const pe = m.path[m.path.length - 1], pp = m.path[m.path.length - 2] || a;
      const ex = (pe.gx + 0.5) * T, ey = (pe.gy + 0.5) * T;
      const px = (pp.gx + 0.5) * T, py = (pp.gy + 0.5) * T;
      const ang = Math.atan2(ey - py, ex - px);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(ang) * 14, ey + Math.sin(ang) * 14);
      ctx.lineTo(ex + Math.cos(ang + 2.6) * 16, ey + Math.sin(ang + 2.6) * 16);
      ctx.lineTo(ex + Math.cos(ang - 2.6) * 16, ey + Math.sin(ang - 2.6) * 16);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      /* 兵力小牌（行军中兵力） */
      const bw = T * 0.44, bx = hx - bw / 2, by = hy + T * 0.18;
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(8,14,22,0.92)';
      ctx.beginPath();
      ctx.moveTo(bx + 4, by); ctx.lineTo(bx + bw - 4, by); ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + 4);
      ctx.lineTo(bx + bw, by + T * 0.5 - 4); ctx.quadraticCurveTo(bx + bw, by + T * 0.5, bx + bw - 4, by + T * 0.5);
      ctx.lineTo(bx + 4, by + T * 0.5); ctx.quadraticCurveTo(bx, by + T * 0.5, bx, by + T * 0.5 - 4);
      ctx.lineTo(bx, by + 4); ctx.quadraticCurveTo(bx, by, bx + 4, by);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 ' + Math.round(T * 0.22) + 'px system-ui, sans-serif';
      ctx.fillText(String(m.n), hx, by + T * 0.38);
      ctx.restore();
    });
  },

  /** 行军速度（供沙盘箭头插值使用；转调 Game） */
  marchSpeedOf(side) { return global.Game.marchSpeed(side); },

  addMove(x0, y0, x1, y1, side, n) {
    this.moves.push({ x0: x0, y0: y0, x1: x1, y1: y1, side: side, n: n, t0: performance.now() });
  },

  /* ==================== 表现层特效（第四十四次修订） ====================
   * 逻辑层（Game）只往 Game.fx 里放"刚刚发生了什么"，这里消费并画出来，
   * 顺便触发引擎的震屏/顿帧与音效 —— 分层仍然是干净的：Game 不碰渲染。
   * 时长（ms）：pop 480 / burst 620 / flash 560 / blast 1200。 */
  FX_MS: { pop: 620, burst: 620, flash: 560, blast: 1200 },

  /** 把 Game.fx 里的事件搬到本层的特效列表（带 t0 时间戳） */
  drainFx() {
    const G = global.Game;
    if (!G || !G.fx || !G.fx.length) return 0;
    const now = performance.now();
    const n = G.fx.length;
    for (let i = 0; i < n; i++) {
      const e = G.fx[i];
      const dur = this.FX_MS[e.kind] || 500;
      this.fx.push(Object.assign({ t0: now, dur: dur }, e));
      if (e.kind === 'burst' || e.kind === 'blast') this._punch(e);
      else if (e.kind === 'pop' && global.Engine && Engine.shake) Engine.shake(1.6, 0.10);
    }
    G.fx.length = 0;
    if (this.fx.length > 120) this.fx.splice(0, this.fx.length - 120);
    return n;
  },

  /** 冲击反馈：震屏 + 顿帧 + 音效（带节流，避免同帧十场战斗把画面抖散） */
  _punch(e) {
    const E = global.Engine;
    if (!E) return;
    const now = performance.now();
    const heavy = !!e.castle || e.kind === 'blast';
    if (!heavy && now - this._fxAudioT < 110) return;
    this._fxAudioT = now;
    if (e.kind === 'blast') {
      if (E.shake) E.shake(16, 0.85);
      if (E.hitStop) E.hitStop(0.10);
      if (E.audio && E.audio.win) (e.result === 'lose' ? (E.audio.lose || E.audio.win) : E.audio.win).call(E.audio);
    } else if (heavy) {
      if (E.shake) E.shake(9, 0.42);
      if (E.hitStop) E.hitStop(0.07);
      if (E.audio && E.audio.hurt) E.audio.hurt();
    } else {
      if (E.shake) E.shake(3.2, 0.14);
      if (E.audio && E.audio.hit) E.audio.hit();
    }
  },

  /** 某格建筑当前的"落成变形"（供 drawBuildings 用）；没有则返回 null */
  popOf(gx, gy, now) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      if (f.kind !== 'pop' || f.gx !== gx || f.gy !== gy) continue;
      const p = (now - f.t0) / f.dur;
      if (p < 0 || p >= 1) return null;
      /* 先"从地里弹出来"再回弹。
       * ⚠️ 长起阶段用 easeIn（慢起）而不是 easeOut —— easeOut 会在 ~30ms 内就冲到满高，
       * "被压扁"那一瞬根本看不见（第一版就是这么写的，放大截图才发现）。 */
      let ky, kx;
      if (p < 0.45) {
        const q = p / 0.45, e2 = q * q;                  // easeInQuad：压扁状态停留得久
        ky = 0.08 + (1.18 - 0.08) * e2;
      } else {
        const q = (p - 0.45) / 0.55, e2 = 1 - Math.pow(1 - q, 3);
        ky = 1.18 + (1 - 1.18) * e2;                     // easeOutCubic：回弹到 1
      }
      kx = 1 + (1 - ky) * 0.34;
      return { ky: ky, kx: kx, alpha: Math.min(1, p / 0.10), p: p };
    }
    return null;
  },

  /** 特效绘制：统一在建筑/部队之上、坐标牌之下 */
  drawFx(ctx, T) {
    const now = performance.now();
    this.fx = this.fx.filter(function (f) { return now - f.t0 < f.dur; });
    const G = global.Game;
    if (!G || !G.state) return;

    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i];
      const p = (now - f.t0) / f.dur;
      const e = 1 - Math.pow(1 - p, 2);                       // easeOutQuad
      /* 等轴模式下特效定位走投影（正交 = 原格心）—— 尺寸量仍用 T（逻辑） */
      const cx = this.tileCX(f.gx, f.gy), cy = this.tileCY(f.gx, f.gy);
      const P1 = '#4a9eff', P2 = '#ff6b6b';

      if (f.kind === 'pop') {
        /* 落成：扬尘环 + 一圈金光（建筑本体的变形由 drawBuildings 负责） */
        const b = G.buildingAt ? G.buildingAt(f.gx, f.gy) : null;
        const fp = b ? G.footOf(b.type) : { w: 1, h: 1 };
        const rx = fp.w * T * 0.52, ry = fp.h * T * 0.26;
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.75;
        ctx.strokeStyle = f.levelUp ? '#ffd23f' : '#e8dcc0';
        ctx.lineWidth = 3 * (1 - p) + 1;
        ctx.beginPath();
        ctx.ellipse(this.tileCX(f.gx, f.gy), this.tileCY(f.gx, f.gy + fp.h) - T * 0.06, rx * (0.5 + e * 0.9), ry * (0.5 + e * 0.9), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - p) * 0.35;
        ctx.strokeStyle = '#fff8e0';
        ctx.beginPath();
        ctx.ellipse(this.tileCX(f.gx, f.gy), this.tileCY(f.gx, f.gy + fp.h) - T * 0.06, rx * (0.3 + e * 0.55), ry * (0.3 + e * 0.55), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (f.kind === 'burst' || f.kind === 'flash' || f.kind === 'blast') {
        const big = f.kind === 'blast';
        const isFlash = f.kind === 'flash';
        /* 圈色：占领=金；战斗=被全歼那一方的颜色；爆炸=橙红 */
        let col = '#ffd23f';
        if (big) col = '#ff9b3d';
        else if (!isFlash) {
          const dead = (f.win === 'p1') ? 'p2' : (f.win === 'p2' ? 'p1' : null);
          col = dead === 'p1' ? P1 : (dead === 'p2' ? P2 : '#e8dcc0');
        }
        const rings = big ? 3 : (isFlash ? 2 : 2);
        ctx.save();
        for (let r = 0; r < rings; r++) {
          const pp = Math.max(0, p - r * 0.16) / (1 - r * 0.16);
          if (pp <= 0) continue;
          const ee = 1 - Math.pow(1 - pp, 2);
          ctx.globalAlpha = Math.max(0, (1 - pp) * (big ? 0.9 : 0.8));
          ctx.strokeStyle = r % 2 ? '#fff' : col;
          ctx.lineWidth = (big ? 6 : 4) * (1 - pp) + 1;
          ctx.beginPath();
          const R0 = big ? T * 0.5 : T * 0.22;
          const R1 = big ? T * 2.6 : (isFlash ? T * 1.15 : T * 0.95);
          ctx.arc(cx, cy, R0 + (R1 - R0) * ee, 0, Math.PI * 2);
          ctx.stroke();
        }
        /* 中心闪光 */
        if (big || !isFlash) {
          ctx.globalAlpha = Math.max(0, (1 - p * 1.6)) * (big ? 0.85 : 0.5);
          ctx.fillStyle = big ? '#fff3d0' : col;
          ctx.beginPath();
          ctx.arc(cx, cy, (big ? T * 0.9 : T * 0.35) * (1 - p * 0.7), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        /* 飘字 */
        const label = big ? (f.result === 'lose' ? '主城陷落' : '主城摧毁')
                          : (isFlash ? (f.resource ? '占领' : '夺得') : '-' + f.loss);
        if (label) {
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - p * 1.1);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '800 ' + Math.round(T * (big ? 0.46 : 0.32)) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
          const ty = cy - T * (big ? 0.6 + e * 1.5 : (isFlash ? 0.5 + e * 0.9 : 0.66 + e * 1.05));
          /* 深色底衬：飘字经常压在资源点标签/建筑名上，没有底衬就看不出来 */
          if (!big) {
            const tw = ctx.measureText(label).width, pad = T * 0.11;
            ctx.globalAlpha = Math.max(0, 1 - p * 1.1) * 0.72;
            ctx.fillStyle = 'rgba(10,8,4,0.9)';
            ctx.fillRect(cx - tw / 2 - pad, ty - T * 0.21, tw + pad * 2, T * 0.42);
            ctx.globalAlpha = Math.max(0, 1 - p * 1.1);
          }
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(10,8,4,0.85)';
          ctx.fillStyle = big ? '#ffd9a0' : col;
          ctx.strokeText(label, cx, ty);
          ctx.fillText(label, cx, ty);
          ctx.restore();
        }
        continue;
      }
    }
  },

  /** 移动轨迹：流动虚线 + 目的地脉冲，约 0.6s 淡出 */
  drawMoves(ctx, T) {
    const now = performance.now();
    const DUR = 620;
    this.moves = this.moves.filter(function (m) { return now - m.t0 < DUR; });

    this.moves.forEach((m) => {
      const k = (now - m.t0) / DUR;
      const col = m.side === 'p1' ? COL.p1 : COL.p2;

      ctx.save();
      ctx.globalAlpha = 0.9 - k * 0.6;
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = -k * 30;
      ctx.beginPath();
      ctx.moveTo((m.x0 + 0.5) * T, (m.y0 + 0.5) * T);
      ctx.lineTo((m.x1 + 0.5) * T, (m.y1 + 0.5) * T);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = col;
      ctx.lineWidth = 4 * (1 - k) + 1.5;
      ctx.beginPath();
      ctx.arc((m.x1 + 0.5) * T, (m.y1 + 0.5) * T, T * 0.3 + k * T * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  },

  /** 画布像素 → 格子坐标（点不到地图内返回 null） */
  pickTile(px, py) {
    const T = CFG.map.tile * this.scale;
    if (this.isoOn()) {
      const hw = this.isoHW() * this.scale, hh = this.isoHH() * this.scale;
      const ox = this.isoOX() * this.scale + this.offX, oy = this.isoOY() * this.scale + this.offY;
      const u = (px - ox) / hw, v = (py - oy) / hh;
      const gx = Math.round((u + v) / 2), gy = Math.round((v - u) / 2);
      if (gx < 0 || gy < 0 || gx >= CFG.map.cols || gy >= CFG.map.rows) return null;
      const dx = px - (ox + (gx - gy) * hw), dy = py - (oy + (gx + gy) * hh);
      if (Math.abs(dx) / hw + Math.abs(dy) / hh > 1.18) return null;   // 菱形内命中（1.18 容差）
      return { gx: gx, gy: gy };
    }
    const gx = Math.floor((px - this.offX) / T);
    const gy = Math.floor((py - this.offY) / T);
    if (gx < 0 || gy < 0 || gx >= CFG.map.cols || gy >= CFG.map.rows) return null;
    return { gx: gx, gy: gy };
  },

  /* ==================== 建造预览（拖卡到地图格时高亮） ==================== */

  /**
   * 拖拽建筑卡时（第三十次修订）：
   * · 全图只做轻压暗（聚焦注意力，不染色）
   * · 网格增强交给 drawGrid（buildModeActive）
   * · 只高亮光标下的「当前建筑整块占地」：合法=暖奶油 / 合并=绿 / 非法=警示红
   */
  drawDropPreview(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const d = Sandbox.dropPreview;
    if (!d) return;
    const V = CFG.mapVisual;
    if (V && V.enabled) {
      ctx.fillStyle = V.place.veil;
      ctx.fillRect(0, 0, CFG.map.cols * T, CFG.map.rows * T);
    }
    if (d.gx === undefined || d.gy === undefined) return;
    const fp = G.footOf(d.key);
    const merge = G.canMerge(d.handIdx, d.gx, d.gy);
    const ok = !merge && G.canBuildAt(d.key, d.gx, d.gy);
    this.drawFootGhost(ctx, T, d.gx, d.gy, fp, merge ? 'merge' : (ok ? 'ok' : 'bad'));
  },

  /** 建造模式的占地幽灵框：整块占地高亮 + 角刻度（state: ok / merge / bad） */
  drawFootGhost(ctx, T, gx, gy, fp, state) {
    const V = CFG.mapVisual;
    const P = V && V.place ? V.place : {};
    const fill = state === 'merge' ? P.mergeFill : state === 'bad' ? P.badFill : P.okFill;
    const edge = state === 'merge' ? P.mergeEdge : state === 'bad' ? P.badEdge : P.okEdge;
    const w = fp.w * T, h = fp.h * T;
    const x0 = gx * T, y0 = gy * T;
    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(x0 + 1, y0 + 1, w - 2, h - 2);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x0 + 1.5, y0 + 1.5, w - 3, h - 3);
    /* 四角刻度：明确"这一块"的占地边界 */
    const L = Math.round(T * 0.22);
    const cs = [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0, y0 + h, 1, -1], [x0 + w, y0 + h, -1, -1]];
    ctx.lineWidth = 2;
    cs.forEach((p) => {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + p[2] * L, p[1]);
      ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] + p[3] * L);
      ctx.stroke();
    });
    ctx.restore();
  },

  /** 选中己方防御塔 → 显示射程（曼哈顿距离 1~2） */
  drawTowerRange(ctx, T) {
    const G = global.Game; const UIg = global.UI;
    if (!G || !G.state || !UIg || !UIg.tileSel) return;
    const sel = UIg.tileSel;
    if (sel.isCastle) return;
    const b = G.buildingAt(sel.gx, sel.gy);
    if (!b || b.type !== 'tower' || (b.owner || 'p1') !== 'p1') return;
    ctx.save();
    ctx.fillStyle = 'rgba(255,210,63,0.16)';
    ctx.strokeStyle = 'rgba(255,210,63,0.55)';
    ctx.lineWidth = 1.5;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < 1 || d > 2) continue;
        const gx = sel.gx + dx, gy = sel.gy + dy;
        if (gx < 0 || gy < 0 || gx >= CFG.map.cols || gy >= CFG.map.rows) continue;
        ctx.fillRect(gx * T + 3, gy * T + 3, T - 6, T - 6);
        ctx.strokeRect(gx * T + 3, gy * T + 3, T - 6, T - 6);
      }
    }
    ctx.restore();
  },

  /** 格子 → #ui 逻辑坐标（用于把操作条等 DOM 定位到建筑上方） */
  tileToUI(gx, gy) {
    const T = CFG.map.tile * this.scale;
    return {
      x: this.canvas.offsetLeft + this.tileCX(gx, gy) * this.scale + this.offX,
      y: this.canvas.offsetTop + this.tileCY(gx, gy) * this.scale + this.offY,
    };
  },

  /** 地图文字标签（最后绘制 + 深色底板）：保证不被建筑/部队盖住（用户报障：遮挡） */
  /**
   * ★ 第七十二次修订：地图信息牌（参考率土/三战的"深色薄片+归属色+等级数字"，
   *   但材质用我们自己的木纹 + 金色内线，与顶栏/按钮同一套视觉语言）。
   * 形状：两端缎带切口；归属 = 金色(我方)/红色(敌方)/米白(中立) 内线 + 文字色。
   */
  drawBannerPlate(ctx, cx, topY, w, h, owner) {
    const notch = Math.min(h * 0.42, 9);
    const x = cx - w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + notch, topY);
    ctx.lineTo(x + w - notch, topY);
    ctx.lineTo(x + w, topY + h * 0.5);
    ctx.lineTo(x + w - notch, topY + h);
    ctx.lineTo(x + notch, topY + h);
    ctx.lineTo(x, topY + h * 0.5);
    ctx.closePath();
    if (this.woodImg) {
      ctx.fillStyle = ctx.createPattern(this.woodImg, 'repeat');
      ctx.fill();
    } else {
      ctx.fillStyle = '#6b5230';
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(12,8,3,0.38)';       // 轻压木纹：纹理可见，文字仍清晰
    ctx.fill();
    ctx.strokeStyle = 'rgba(22,13,4,0.95)'; ctx.lineWidth = Math.max(1.5, h * 0.10);
    ctx.stroke();                              // 深色外框
    ctx.strokeStyle = owner === 'p1' ? 'rgba(255,214,90,.95)'
                    : owner === 'p2' ? 'rgba(255,150,140,.9)'
                    : 'rgba(236,212,158,.8)';
    ctx.lineWidth = 1.1;
    ctx.stroke();                              // 归属色内线
    /* 两端缎带切口尖上各一颗金铆钉 —— 精致度的小细节 */
    ctx.fillStyle = '#ffd98a';
    [[x + notch, topY + h / 2], [x + w - notch, topY + h / 2]].forEach(function (p) {
      ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.2, h * 0.07), 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  },

  drawMapLabels(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const self = this;                            // forEach 回调里要用 this.drawBannerPlate
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(T * 0.2) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    /* ★ 第七十二次修订：建筑/主城也补上名牌（此前贴图路径只有 Lv 角标没有名称，
     *   率土/三战的地图上每个对象都标名称 + 等级） */
    const bFont = '"PingFang SC","Microsoft YaHei",sans-serif';
    const drawBuildPlate = function (b, name, level, owner, topOverride) {
      const fp = G.footOf(b.type);
      const cx = (b.gx + fp.w / 2) * T;
      /* ★ 第八十一次修订：主城 2×2 信息牌移到占地正上方（用户拍板：牌在底部会压到邻格牌/建筑） */
      const topY = topOverride !== undefined ? topOverride : (b.gy + fp.h) * T + T * 0.06;
      const txt = level ? name + ' Lv' + level : name;
      ctx.font = '700 ' + Math.round(T * 0.21) + 'px ' + bFont;
      const w = Math.max(70, ctx.measureText(txt).width) + T * 0.34;
      const h = T * 0.36;
      this.drawBannerPlate(ctx, cx, topY, w, h, owner);
      ctx.fillStyle = owner === 'p1' ? '#ffd76a' : (owner === 'p2' ? '#ff9c9c' : '#f4f1e4');
      ctx.fillText(txt, cx, topY + h * 0.62);
    };
    for (const k in G.state.buildings) {
      const b = G.state.buildings[k];
      /* ★ 第八十一次修订：建筑牌改 hover 显示（建筑多了信息牌过密，用户拍板改回靠近才显示）——
       *   光标在建筑占地（footOf w×h）内才画；主城/资源点牌保留常显。 */
      const fp = G.footOf(b.type);
      const hv = this.hoverTile;
      if (!(hv && hv.gx >= b.gx && hv.gx < b.gx + fp.w && hv.gy >= b.gy && hv.gy < b.gy + fp.h)) continue;
      drawBuildPlate.call(this, b, CFG.buildings[b.type].name, b.level, (b.owner || 'p1') === 'p1' ? 'p1' : 'p2');
    }
    /* ★ 牌在 2×2 占地内部、主城贴图正上方的留白区（用户拍板：不占用格外空间） */
    drawBuildPlate.call(this, G.state.castle, '主城', G.state.castleLevel, 'p1', G.state.castle.gy * T + T * 0.08);
    drawBuildPlate.call(this, G.enemyCastle(), '敌方主城', 1, 'p2', G.enemyCastle().gy * T + T * 0.08);

    CFG.map.resources.forEach(function (r) {
      const owner = G.resourceOwnerOf(r);
      // 未占领的资源点显示剩余守军——否则玩家不知道派兵过去为什么没效果
      const guard = G.state.resGuard[r.gx + ',' + r.gy] || 0;
      /* ★ 第七十一次修订（方案A）：底牌升级为「收益牌」—— 名称 / 产出 / 守军 三件事一眼看全。
       *   新玩家不知道"占了有什么好处"正是资源点无吸引力的原因之一。
       * ★ 第七十三次修订（排查 2026-10-11 后用户拍板收窄）：产出去掉「/Tick」（速览牌，
       *   Tick 概念在玩法说明与引导步里讲过）、守军简写「守10」—— 旧版
       *   「+50 粮/Tick · 守军10」把牌撑到 ~2.5 格宽、横跨邻格压住邻格地界
       *   （实锤：中央能源点的牌盖住 (15.5,8.0)，_roadvisual_verify 两项格缝断言被误伤）。
       *   同时修掉 measureText(l2) 误用 l1 大字号的既有问题（牌宽被高估）。 */
      const yieldTxt = r.res === 'logistics' ? '修路 -1⚡'
        : ('+' + r.yield + (r.res === 'food' ? '粮' : '⚡'));
      const l1 = (owner ? (owner === 'p1' ? '★ ' : '✖ ') : '') + r.name;
      const l2 = yieldTxt + (!owner && guard > 0 ? ' · 守' + guard : '');
      const x = (r.gx + 0.5) * T, y = (r.gy + 1.00) * T;
      const font1 = '700 ' + Math.round(T * 0.20) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      const font2 = Math.round(T * 0.18) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.font = font1;
      const w1 = ctx.measureText(l1).width;
      ctx.font = font2;
      const w2 = ctx.measureText(l2).width;
      const w = Math.min(T * 1.8, Math.max(76, w1, w2) + T * 0.30);
      const h = T * 0.54;
      self.drawBannerPlate(ctx, x, y - T * 0.17, w, h, owner);
      ctx.fillStyle = owner === 'p1' ? '#ffd76a' : (owner === 'p2' ? '#ff9c9c' : '#f4f1e4');
      ctx.font = font1;
      ctx.fillText(l1, x, y + T * 0.03);
      ctx.font = font2;
      ctx.fillStyle = '#e8dcc0';
      ctx.fillText(l2, x, y + T * 0.24);
    });
    ctx.restore();
  },

  /**
   * 建筑放置模式（点选卡牌后逐格点击建造，第三十次修订）：
   * 网格已由 drawGrid 增强；这里只跟随光标高亮「当前建筑的整块占地」，
   * 合法=暖奶油 / 非法=警示红 —— 不再把整个可建区染成大面积色块。
   */
  drawPlaceMode(ctx, T) {
    const G = global.Game; const UIg = global.UI;
    if (!G || !G.state || !UIg || !UIg.placeMode) return;
    const t = this.hoverTile;
    if (!t) return;
    const fp = G.footOf(UIg.placeMode.key);
    const ok = G.canBuildAt(UIg.placeMode.key, t.gx, t.gy);
    this.drawFootGhost(ctx, T, t.gx, t.gy, fp, ok ? 'ok' : 'bad');
  },

  /** 铺路模式：把当前道路牌可铺的格子高亮出来 */
  drawRoadPreview(ctx, T) {
    const G = global.Game;
    if (!G || !G.state || !global.UI || !UI.roadPlacing) return;
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        // 与点击判定必须用同一套（canPlaceRoadFor），否则会出现"高亮说能铺、点了不行"
        if (!G.canPlaceRoadFor('p1', gx, gy)) continue;
        ctx.save();
        ctx.fillStyle = 'rgba(180,150,90,0.30)';
        ctx.strokeStyle = 'rgba(230,200,140,0.95)';
        ctx.lineWidth = 2.5;
        ctx.fillRect(gx * T + 3, gy * T + 3, T - 6, T - 6);
        ctx.strokeRect(gx * T + 3, gy * T + 3, T - 6, T - 6);
        ctx.restore();
      }
    }
  },

  /* ==================== 等轴测世界绘制（第七十四次修订 MVP，isoMode=true 时由 render 调用） ==================== */

  /** 菱形台基：顶面 + 两侧壁（攻城掠地式落地感），depth 为侧壁厚度 */
  isoPedestal(ctx, gx, gy, hw, hh, depth, topFill, sideFill) {
    const cx = this.tileCX(gx, gy), cy = this.tileCY(gx, gy);
    ctx.beginPath();
    ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx, cy + hh + depth);
    ctx.lineTo(cx - hw, cy + depth); ctx.closePath();
    ctx.fillStyle = sideFill; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx, cy + hh + depth);
    ctx.lineTo(cx + hw, cy + depth); ctx.closePath();
    ctx.fillStyle = sideFill; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh); ctx.lineTo(cx - hw, cy);
    ctx.closePath();
    ctx.fillStyle = topFill; ctx.fill();
  },

  drawIsoWorld(ctx, T) {
    const G = global.Game;
    const S = G.state;
    const self = this;
    const HW = this.isoHW(), HH = this.isoHH();
    const ter = CFG.map.terrain;
    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    /* ---- ⓪ 沙盘木框：围住可玩区的木质托盘（框外=作战室桌面，由 render 背景承担）
     *      手绘沙盘成图（A 木框版自带木框 / B 延展版无需框）→ 程序化框只在无成图时兜底 ---- */
    const painted = this.isoPaintedActive();
    const paintedOn = !!painted;
    if (!paintedOn) {
      const C = CFG.map.cols - 1, R = CFG.map.rows - 1;
      const inner = {
        top: [this.tileCX(0, 0), this.tileCY(0, 0) - HH],
        right: [this.tileCX(C, 0) + HW, this.tileCY(C, 0)],
        bottom: [this.tileCX(C, R), this.tileCY(C, R) + HH],
        left: [this.tileCX(0, R) - HW, this.tileCY(0, R)],
      };
      const mx = (inner.top[0] + inner.bottom[0]) / 2, my = (inner.top[1] + inner.bottom[1]) / 2;
      const K = 1.15;
      const outer = {
        top: [mx + (inner.top[0] - mx) * K, my + (inner.top[1] - my) * K],
        right: [mx + (inner.right[0] - mx) * K, my + (inner.right[1] - my) * K],
        bottom: [mx + (inner.bottom[0] - mx) * K, my + (inner.bottom[1] - my) * K],
        left: [mx + (inner.left[0] - mx) * K, my + (inner.left[1] - my) * K],
      };
      const poly = o => `${o.top[0]},${o.top[1]} ${o.right[0]},${o.right[1]} ${o.bottom[0]},${o.bottom[1]} ${o.left[0]},${o.left[1]}`;
      /* 底座投影（方向 2 打磨）：沙盘下方桌面上的落影，越靠近沙盘越暗，四角不再突兀 */
      for (let i = 3; i >= 1; i--) {
        const kk = K + i * 0.05;
        ctx.beginPath();
        poly(outer).split(' ').forEach(function (pt, j) {
          const p = pt.split(',');
          const px = mx + (+p[0] - mx) * kk, py = my + (+p[1] - my) * kk;
          j ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(10,6,2,' + (0.20 - i * 0.045) + ')'; ctx.fill();
      }
      /* 底座侧壁（沙盘是有厚度的实体托盘） */
      ctx.save();
      ctx.translate(0, 30);
      ctx.beginPath();
      const op = poly(outer).split(' ');
      op.forEach(function (pt, i) { const p = pt.split(','); i ? ctx.lineTo(+p[0], +p[1]) : ctx.moveTo(+p[0], +p[1]); });
      ctx.closePath();
      ctx.fillStyle = '#3e2f1f'; ctx.fill();
      ctx.restore();
      /* 框顶面（木色）+ 木纹线 + 内缘铜线（草地随后覆盖内区，框即内缘之外的部分） */
      ctx.beginPath();
      poly(outer).split(' ').forEach(function (pt, i) { const p = pt.split(','); i ? ctx.lineTo(+p[0], +p[1]) : ctx.moveTo(+p[0], +p[1]); });
      ctx.closePath();
      ctx.fillStyle = '#5a4632'; ctx.fill();
      ctx.strokeStyle = '#6a543a'; ctx.lineWidth = 2;
      for (let f = 1; f <= 3; f++) {
        const k = 1 + (K - 1) * (f / 4);
        ctx.beginPath();
        [[inner.top, 0], [inner.right, 0], [inner.bottom, 0], [inner.left, 0]].forEach(function (cor, i) {
          const px = mx + (cor[0] - mx) * k, py = my + (cor[1] - my) * k;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath(); ctx.stroke();
      }
      /* 沙色过渡带（方向 2 打磨）：木框内缘与草地格之间的沙沿，消除生硬拼缝 */
      ctx.save();
      const sk = 1 + (K - 1) * 0.35;
      ctx.beginPath();
      [[inner.top], [inner.right], [inner.bottom], [inner.left]].forEach(function (cor, i) {
        const px = mx + (cor[0][0] - mx) * sk, py = my + (cor[0][1] - my) * sk;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(216,199,154,0.9)'; ctx.fill();
      ctx.restore();
    }

    /* ---- ①-a 手绘沙盘成图（方案A，2026-10-12）：i2i 生成的 2:1 手绘沙盘插画整幅铺底。
     *      映射：成图菱形中心像素 (pc.cx,pc.cy) = 地图中心格格心，统一缩放 s = HW/pc.hw
     *      （与 HH/pc.hh 严格相等，2:1 下均为 1.875）；成图已含立体山树/木框/桌面。 ---- */
    if (paintedOn) {
      const pc = painted.cfg;
      const s = HW / pc.hw;
      const imgP = painted.img;
      const wxC = this.tileCX((CFG.map.cols - 1) / 2, (CFG.map.rows - 1) / 2);
      const wyC = this.tileCY((CFG.map.cols - 1) / 2, (CFG.map.rows - 1) / 2);
      ctx.drawImage(imgP, wxC - pc.cx * s, wyC - pc.cy * s, imgP.width * s, imgP.height * s);
    /* ---- ①-b 手绘底图（等轴仿射，第七十六次修订补充）：正交手绘图经仿射直接变身为等轴底图。
     *      变换矩阵：X = OX + (px-py)，Y = OY - HH + (px+py)·(HH/T) —— 线性映射格心精确对齐；
     *      ⚠️ 纵向系数 kY = HH/T 随菱形比例联动（2:1→0.5 / 4:1→0.25），改 iso.hh 必须同步——
     *      曾因硬编码 0.5 在 4:1 下底图与格网整体错位（用户实机抓出）。 ---- */
    } else if (this.plateImg) {
      const kY = this.isoHH() / CFG.map.tile;
      ctx.save();
      ctx.transform(1, kY, -1, kY, this.isoOX(), this.isoOY() - HH);
      ctx.drawImage(this.plateImg, 0, 0);
      ctx.restore();
    } else {
      /* 回退：程序化菱形草地 + 地形剪影（无手绘底图时） */
      for (let gy = 0; gy < CFG.map.rows; gy++) {
        for (let gx = 0; gx < CFG.map.cols; gx++) {
          const r = hash2(gx, gy);
          let c = (gx + gy) % 2 === 0 ? '#8fae66' : '#97b56d';
          if (r < 0.10) c = '#84a25c';
          else if (r > 0.92) c = '#a0bb76';
          const t = ter && ter[gy] && ter[gy][gx];
          if (t === 'W') c = '#7f9db4';
          else if (t === 'M') c = '#9a9a92';
          else if (t === 'F' || t === 'f') c = '#5f7f47';
          ctx.beginPath();
          this.diamondPath(ctx, gx, gy);
          ctx.fillStyle = c; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1; ctx.stroke();
          /* 山 / 林剪影：平涂色块读作"露底的灰"，画出地形剪影才可读 */
          const mcx = this.tileCX(gx, gy), mcy = this.tileCY(gx, gy);
          if (t === 'M') {
            ctx.fillStyle = '#6e746c';
            ctx.beginPath();
            ctx.moveTo(mcx - HW * 0.34, mcy + HH * 0.12); ctx.lineTo(mcx - HW * 0.10, mcy - HH * 0.5); ctx.lineTo(mcx + HW * 0.14, mcy + HH * 0.12);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#5c625b';
            ctx.beginPath();
            ctx.moveTo(mcx - HW * 0.06, mcy + HH * 0.3); ctx.lineTo(mcx + HW * 0.22, mcy - HH * 0.28); ctx.lineTo(mcx + HW * 0.46, mcy + HH * 0.3);
            ctx.closePath(); ctx.fill();
          } else if (t === 'F' || t === 'f') {
            const trees = [[-0.3, 0.05, 0.30], [0.12, -0.18, 0.24], [0.30, 0.22, 0.27]];
            trees.forEach(function (tr, ti) {
              ctx.fillStyle = ti % 2 ? '#42603a' : '#4c6f42';
              ctx.beginPath();
              ctx.arc(mcx + HW * tr[0], mcy + HH * tr[1], HW * tr[2] * 0.42, 0, Math.PI * 2);
              ctx.fill();
            });
          }
        }
      }
    }

    /* ---- ①-c 放置模式网格：已改「单格高亮」形态（2026-10-13 用户拍板）。
     *  原「全图蓝网格」删除 —— 底图格线是 AI 手绘的（局部抖动、非几何精确），
     *  引擎全网格是数学精确的，两者"处处对照"必然显出"不重合"（用户实机反馈）。
     *  可放置反馈全部由「光标下的整块占地高亮」承担（合法=奶油 / 合并=绿 / 非法=红，
     *  见 drawDropPreview 与 hover 高亮路径），不再铺满图网格。 ---- */

    /* ---- ② 道路：带状路沿菱形格心连线（与正交同一套遍历/去重） ---- */
    const roads = S.roads || {};
    const has = function (gx, gy) { return !!roads[gx + ',' + gy]; };
    const segs = [];
    for (const k in roads) {
      const p = k.split(',');
      const gx = +p[0], gy = +p[1];
      if (ter && ter[gy] && ter[gy][gx] === 'W') continue;   // 桥格不画路面
      if (has(gx + 1, gy)) segs.push([gx, gy, gx + 1, gy]);
      if (has(gx, gy + 1)) segs.push([gx, gy, gx, gy + 1]);
    }
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    /* 2026-10-13（28 底图适配）：等轴路三层色降亮降白（原为旧底图标定，在 28 上"翻白"成贴纸感）。
     *   ⚠️ 等轴路的颜色目前是这套硬编码色（正交路走 CFG.mapVisual.road.ribbon，两条绘制路径尚未统一）。 */
    [[26, '#8f7752'], [17, '#b19a6d'], [9, '#c2ad82']].forEach(function (L) {
      ctx.strokeStyle = L[1]; ctx.lineWidth = L[0];
      ctx.beginPath();
      segs.forEach(function (sg) {
        ctx.moveTo(self.tileCX(sg[0], sg[1]), self.tileCY(sg[0], sg[1]));
        ctx.lineTo(self.tileCX(sg[2], sg[3]), self.tileCY(sg[2], sg[3]));
      });
      ctx.stroke();
    });
    ctx.restore();

    /* ---- ③ 深度排序物体层：建筑 / 资源据点 / 部队徽章 / 行军（z = gx+gy） ---- */
    const items = [];
    Object.keys(S.buildings || {}).forEach(function (k) {
      const b = S.buildings[k];
      items.push({ z: b.gx + b.gy, kind: 'building', o: b });
    });
    if (S.castle) items.push({ z: S.castle.gx + S.castle.gy, kind: 'castle', o: S.castle, lv: S.castleLevel, own: 'p1' });
    if (S.enemyCastle) items.push({ z: S.enemyCastle.gx + S.enemyCastle.gy, kind: 'castle', o: S.enemyCastle, lv: S.enemyLevel || 1, own: 'p2' });
    CFG.map.resources.forEach(function (r) {
      items.push({ z: r.gx + r.gy, kind: 'resource', o: r });
    });
    for (const k in S.troops) {
      const p = k.split(',');
      const gx = +p[0], gy = +p[1];
      const t = S.troops[k];
      if ((t.p1 || 0) > 0) items.push({ z: gx + gy, kind: 'troop', o: { gx: gx, gy: gy, side: 'p1', n: t.p1 } });
      if ((t.p2 || 0) > 0) items.push({ z: gx + gy + 0.01, kind: 'troop', o: { gx: gx, gy: gy, side: 'p2', n: t.p2 } });
    }
    (S.march || []).forEach(function (m) {
      const c0 = m.path[Math.min(m.idx, m.path.length - 1)];
      items.push({ z: c0.gx + c0.gy + 0.5, kind: 'march', o: m });
    });
    items.sort(function (a, b) { return a.z - b.z; });
    const marchSec = function (m) { return G.marchSpeed(m.side); };   // marchSpeed 在 Game 上
    const FLAG = { p1: '#2f6fb8', p2: '#c0392b' };

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'building') {
        const b = it.o;
        const fp = G.footOf(b.type);
        const acx = b.gx + (fp.w - 1) / 2, acy = b.gy + (fp.h - 1) / 2;
        const cx = this.tileCX(acx, acy), cy = this.tileCY(acx, acy);
        const isEnemyCastle = (!G.isCastleAt(b.gx, b.gy)) && S.enemyCastle && S.enemyCastle.gx === b.gx && S.enemyCastle.gy === b.gy;
        const own = b.owner || (isEnemyCastle ? 'p2' : 'p1');
        /* 2026-10-13 用户拍板：程序化菱形台基已删，且**不画程序化软影**——
         * 接地感全部由素材自带（重画素材含草地边缘自然收尾），"留素材草圈、撤引擎影子"。 */
        ctx.save();
        if (b.pending) ctx.globalAlpha = 0.55;
        const sp = this.sprites && this.sprites[b.type];
        /* ★ 第八十四次修订：绘制尺寸按占地等比（旧版固定 1.5HW —— 2×2 主城/兵营只画出
         *   约 0.75 格宽，玩家看到"旁边有空地却建不了"的直接原因）；底缘从 cy+0.5HH
         *   下移到"菱形下顶点略下"（草圈包住底尖）—— 悬空感的引擎侧根因之二。 */
        const w = HW * 1.75 * fp.w, h = w * (sp ? sp.height / sp.width : 1);
        const baseY = cy + HH * (fp.h + 0.22);
        const pop = this.popOf(b.gx, b.gy, nowMs);
        if (pop) { ctx.translate(cx, cy); ctx.scale(pop.kx, pop.ky); ctx.translate(-cx, -cy); }
        if (sp) {
          ctx.drawImage(sp, cx - w / 2, baseY - h, w, h);
        } else {
          const d2 = CFG.buildings[b.type];
          ctx.font = Math.round(T * 0.62) + 'px serif';
          ctx.fillText((d2 && d2.icon) || '🏠', cx, cy - HH * 0.35);
        }
        /* ★ 第八十四次修订：Lv 数字文字删除 —— 信息牌横幅已含等级（"主城 Lv1"），
         *   底部再画一个金色 Lv 是重复信息，用户实机指出"像上版本的 Lv1 没删干净"。
         *   等级信息：主城/建筑 = 信息牌（建筑 hover 显示）+ 点击建筑的面板。 */
        if (b.hp !== undefined && b.maxHp && b.hp < b.maxHp) {
          const bw = HW * 1.1 * fp.w, bx = cx - bw / 2, by = baseY - h - 10;
          ctx.fillStyle = 'rgba(10,8,4,0.8)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
          ctx.fillStyle = '#d9604a'; ctx.fillRect(bx, by, bw * Math.max(0, b.hp) / b.maxHp, 4);
        }
        ctx.restore();
        continue;
      }
      if (it.kind === 'resource') {
        const r = it.o;
        const cx = this.tileCX(r.gx, r.gy), cy = this.tileCY(r.gx, r.gy);
        const owner = G.resourceOwnerOf(r);
        const guard = S.resGuard[r.gx + ',' + r.gy] || 0;
        ctx.save();
        /* 2026-10-13 深夜 v2："浮空感"三连修复之引擎侧——硬边椭圆 → 柔边径向渐变。
         * 旧版硬边椭圆与素材底缘分离、"像悬空物投下的影子"；渐变影边缘羽化贴地，
         * 位置贴合新锚定（素材紧裁后尖端=cy+0.55HH 画面底），光自西北 → 影略偏东南。 */
        ctx.save();
        ctx.translate(cx + HW * 0.05, cy + HH * 0.55);
        ctx.scale(1, 0.44);
        const shg = ctx.createRadialGradient(0, 0, 0, 0, 0, HW * 0.82);
        shg.addColorStop(0, 'rgba(28,22,12,0.34)');
        shg.addColorStop(0.62, 'rgba(28,22,12,0.23)');
        shg.addColorStop(1, 'rgba(28,22,12,0)');
        ctx.fillStyle = shg;
        ctx.beginPath(); ctx.arc(0, 0, HW * 0.82, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        if (!owner) {
          const ph = (nowMs / 1000) % 2.8 / 2.8;
          const a = 0.09 + 0.12 * (1 - Math.abs(ph * 2 - 1));
          const gr = ctx.createRadialGradient(cx, cy - HH * 0.2, T * 0.12, cx, cy - HH * 0.2, T * 0.95);
          gr.addColorStop(0, 'rgba(255,224,138,' + a.toFixed(3) + ')');
          gr.addColorStop(1, 'rgba(255,224,138,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(cx, cy - HH * 0.2, T * 0.95, 0, Math.PI * 2); ctx.fill();
        }
        /* 2026-10-13 用户拍板：资源点的程序化台基一并删除（"其他资源点怎么还是全都有砖"）——
         * 与建筑/主城统一"留素材草圈、撤引擎影子"：落地感由素材自带 + 上方的小接地阴影承担。 */
        const sp = this.resSprites && this.resSprites[r.res];
        if (sp) {
          /* ★ 第八十四次修订：底缘从 0.55HH 下移到菱形下顶点略下（1.12HH）——
           *   资源点"悬空感"的引擎侧根因（此前只柔化了影子，没动锚定）；宽度 1.5 → 1.75HW。 */
          const w = HW * ((CFG.resourceCamps && CFG.resourceCamps.width) || 1.5), h = w * (sp.height / sp.width);
          ctx.drawImage(sp, cx - w / 2, cy + HH * 1.12 - h, w, h);
        } else {
          const ico = r.res === 'food' ? '🌾' : (r.res === 'logistics' ? '🛣️' : '⚡');
          ctx.font = Math.round(T * 0.5) + 'px serif';
          ctx.fillText(ico, cx, cy - HH * 0.2);
        }
        if (owner && FLAG[owner]) {
          const px = cx + HW * 0.5, top = cy - T * 0.72, base = cy + HH * 0.1;
          ctx.strokeStyle = '#4a3520'; ctx.lineWidth = Math.max(2, T * 0.05);
          ctx.beginPath(); ctx.moveTo(px, base); ctx.lineTo(px, top); ctx.stroke();
          const fw = T * 0.36, fh = T * 0.21;
          ctx.fillStyle = FLAG[owner];
          ctx.beginPath(); ctx.moveTo(px, top);
          ctx.lineTo(px + fw, top + fh * 0.5); ctx.lineTo(px, top + fh);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
        continue;
      }
      if (it.kind === 'castle') {
        const c = it.o, own = it.own;
        const fp = G.footOf('castle');
        const acx = c.gx + (fp.w - 1) / 2, acy = c.gy + (fp.h - 1) / 2;
        const cx = this.tileCX(acx, acy), cy = this.tileCY(acx, acy);
        /* 2026-10-13：主城台基与程序化软影均已撤（同上，"留素材草圈、撤引擎影子"）。 */
        ctx.save();
        const sp = this.sprites && this.sprites.castle;
        const w = HW * 1.75 * fp.w, h = w * (sp ? sp.height / sp.width : 1);
        const baseC = cy + HH * (fp.h + 0.22);
        if (sp) {
          ctx.drawImage(sp, cx - w / 2, baseC - h, w, h);
        } else {
          ctx.font = Math.round(T * 0.8) + 'px serif';
          ctx.fillText('🏰', cx, cy - HH * 0.4);
        }
        /* ★ 第八十四次修订：同上 —— 主城信息牌横幅已含等级，删底部重复 Lv 文字 */
        const hp = own === 'p1' ? Math.max(0, S.castleHp) : Math.max(0, S.enemyCastle.hp);
        const mx = own === 'p1' ? G.castleMaxHp() : (S.enemyCastle.maxHp || 1);
        if (hp < mx) {
          const bw = HW * 2.4, bx = cx - bw / 2, by = baseC - h - 10;
          ctx.fillStyle = 'rgba(10,8,4,0.8)'; ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
          ctx.fillStyle = '#d9604a'; ctx.fillRect(bx, by, bw * hp / mx, 4);
        }
        ctx.restore();
        continue;
      }
      if (it.kind === 'troop') {
        const t = it.o;
        const stranded = G.isStrandedTroops(t.gx, t.gy, t.side);
        this.isoTroopBadge(ctx, t.gx, t.gy, t.side, t.n, stranded);
        continue;
      }
      if (it.kind === 'march') {
        const m = it.o;
        const c0 = m.path[Math.min(m.idx, m.path.length - 1)];
        const c1 = m.path[Math.min(m.idx + 1, m.path.length - 1)];
        const k = Math.max(0, Math.min(1, (m.t || 0) / marchSec(m)));
        const hx = this.tileCX(c0.gx, c0.gy) + (this.tileCX(c1.gx, c1.gy) - this.tileCX(c0.gx, c0.gy)) * k;
        const hy = this.tileCY(c0.gx, c0.gy) + (this.tileCY(c1.gx, c1.gy) - this.tileCY(c0.gx, c0.gy)) * k;
        const col = m.side === 'p1' ? '#2f6fb8' : '#c0392b';
        const lite = m.side === 'p1' ? '#9cc4ee' : '#f0a898';
        /* 作战沙盘箭头：当前位置 → 目标（沿剩余路径投影），军事地图式粗箭头 */
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        for (let pi = m.idx + 1; pi < m.path.length; pi++) {
          ctx.lineTo(this.tileCX(m.path[pi].gx, m.path[pi].gy), this.tileCY(m.path[pi].gx, m.path[pi].gy));
        }
        ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.stroke();
        ctx.strokeStyle = lite; ctx.lineWidth = 3.5; ctx.stroke();
        /* 箭头头部（沿末段方向的后掠三角） */
        const pe = m.path[m.path.length - 1], pp = m.path[m.path.length - 2] || c0;
        const ex = this.tileCX(pe.gx, pe.gy), ey = this.tileCY(pe.gx, pe.gy);
        const px = this.tileCX(pp.gx, pp.gy), py = this.tileCY(pp.gx, pp.gy);
        const ang = Math.atan2(ey - py, ex - px);
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(ang) * 14, ey + Math.sin(ang) * 14);
        ctx.lineTo(ex + Math.cos(ang + 2.6) * 16, ey + Math.sin(ang + 2.6) * 16);
        ctx.lineTo(ex + Math.cos(ang - 2.6) * 16, ey + Math.sin(ang - 2.6) * 16);
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        /* 兵力小牌（行军中兵力） */
        const bw2 = HW * 0.44, bx2 = hx - bw2 / 2, by2 = hy + HH * 0.18;
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(8,14,22,0.92)';
        ctx.beginPath();
        ctx.moveTo(bx2 + 4, by2); ctx.lineTo(bx2 + bw2 - 4, by2); ctx.quadraticCurveTo(bx2 + bw2, by2, bx2 + bw2, by2 + 4);
        ctx.lineTo(bx2 + bw2, by2 + HH * 0.5 - 4); ctx.quadraticCurveTo(bx2 + bw2, by2 + HH * 0.5, bx2 + bw2 - 4, by2 + HH * 0.5);
        ctx.lineTo(bx2 + 4, by2 + HH * 0.5); ctx.quadraticCurveTo(bx2, by2 + HH * 0.5, bx2, by2 + HH * 0.5 - 4);
        ctx.lineTo(bx2, by2 + 4); ctx.quadraticCurveTo(bx2, by2, bx2 + 4, by2);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 ' + Math.round(T * 0.22) + 'px system-ui, sans-serif';
        ctx.fillText(String(m.n), hx, by2 + HH * 0.38);
        ctx.restore();
        continue;
      }
    }

    /* ---- ④ 选中 / 放置幽灵 / 铺路预览 / 塔射程（菱形化） ---- */
    this.drawSelectionIso(ctx, T);
    this.drawDropPreviewIso(ctx, T);
    this.drawRoadPreviewIso(ctx, T);
    this.drawTowerRangeIso(ctx, T);
    if (global.UI && global.UI.placeMode) this.drawPlaceModeIso(ctx, T);

    /* ---- ⑤ 信息牌（收益牌 / 建筑名牌，复用 drawBannerPlate） ---- */
    this.drawMapLabelsIso(ctx, T);

    /* ---- ⑥ 部队移动轨迹涟漪 ---- */
    this.drawMovesIso(ctx, T);
  },

  /** 部队兵力旗标（作战沙盘式）：旗杆 + 三角旗 + 兵力牌；滞留时旗面灰色 */
  isoTroopBadge(ctx, gx, gy, side, n, stranded) {
    const T = CFG.map.tile, HW = this.isoHW(), HH = this.isoHH();
    const cx = this.tileCX(gx, gy), cy = this.tileCY(gx, gy);
    /* ★ 第八十一次修订：等轴部队改回圆形徽章（与正交一致；旗杆+方块牌弃用） */
    const col = side === 'p1' ? '#2f6fb8' : '#c0392b';
    const r = HW * 0.34;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,14,22,0.92)'; ctx.fill();
    if (stranded) ctx.setLineDash([5, 4]);
    ctx.strokeStyle = col; ctx.lineWidth = stranded ? 2 : 3; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = '700 ' + Math.round(T * 0.27) + 'px system-ui, sans-serif';
    ctx.fillText(String(n), cx, cy + T * 0.02);
    if (stranded) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '600 ' + Math.round(T * 0.15) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillText('待命', cx, cy + T * 0.42);
    }
  },

  /** 选中格 / 拖拽目标格（等轴） */
  drawSelectionIso(ctx, T) {
    const S = this.state;
    if (S && S.sel) {
      ctx.save();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3;
      this.diamondPath(ctx, S.sel.gx, S.sel.gy); ctx.stroke();
      ctx.restore();
    }
    if (this.dragging && this.dragging.gx !== undefined) {
      ctx.save();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5;
      this.diamondPath(ctx, this.dragging.gx, this.dragging.gy); ctx.stroke();
      ctx.restore();
    }
  },

  /** 建造占地幽灵（等轴）：整块占地菱形组 + 状态色 */
  drawFootGhostIso(ctx, T, gx, gy, fp, state) {
    const V = CFG.mapVisual;
    const P = V && V.place ? V.place : {};
    const fill = state === 'merge' ? P.mergeFill : state === 'bad' ? P.badFill : P.okFill;
    const edge = state === 'merge' ? P.mergeEdge : state === 'bad' ? P.badEdge : P.okEdge;
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        ctx.save();
        this.diamondPath(ctx, gx + dx, gy + dy);
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = edge; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.restore();
      }
    }
  },

  drawDropPreviewIso(ctx, T) {
    const d = this.dropPreview;
    if (!d) return;
    const G = global.Game;
    if (d.gx === undefined || d.gy === undefined) return;
    const fp = G.footOf(d.key);
    const merge = G.canMerge(d.handIdx, d.gx, d.gy);
    const ok = !merge && G.canBuildAt(d.key, d.gx, d.gy);
    this.drawFootGhostIso(ctx, T, d.gx, d.gy, fp, merge ? 'merge' : (ok ? 'ok' : 'bad'));
  },

  drawRoadPreviewIso(ctx, T) {
    const G = global.Game;
    if (!G || !global.UI || !UI.roadPlacing) return;
    for (let gy = 0; gy < CFG.map.rows; gy++) {
      for (let gx = 0; gx < CFG.map.cols; gx++) {
        if (!G.canPlaceRoadFor('p1', gx, gy)) continue;
        ctx.save();
        this.diamondPath(ctx, gx, gy);
        ctx.fillStyle = 'rgba(180,150,90,0.30)'; ctx.fill();
        ctx.strokeStyle = 'rgba(230,200,140,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.restore();
      }
    }
  },

  drawTowerRangeIso(ctx, T) {
    const G = global.Game;
    const sel = this.state && this.state.sel;
    if (!G || !sel) return;
    const t = G.buildingAt(sel.gx, sel.gy);
    if (!t || t.type !== 'tower') return;
    const range = 2 + (G.relicCount('p1', 'watchtower') || 0);
    const cx = this.tileCX(t.gx, t.gy), cy = this.tileCY(t.gx, t.gy);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#4a9eff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, range * this.isoHW(), range * this.isoHH(), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  },

  /** 放置模式：跟随光标的占地幽灵（等轴） */
  drawPlaceModeIso(ctx, T) {
    const G = global.Game; const UIg = global.UI;
    if (!G || !G.state || !UIg || !UIg.placeMode) return;
    const t = this.hoverTile;
    if (!t) return;
    const fp = G.footOf(UIg.placeMode.key);
    const ok = G.canBuildAt(UIg.placeMode.key, t.gx, t.gy);
    this.drawFootGhostIso(ctx, T, t.gx, t.gy, fp, ok ? 'ok' : 'bad');
  },

  /** 信息牌（等轴）：收益牌 / 建筑名牌（复用 drawBannerPlate，格心投影） */
  drawMapLabelsIso(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const self = this;
    const HH = this.isoHH();
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bFont = '"PingFang SC","Microsoft YaHei",sans-serif';
    const drawBuildPlate = function (b, name, level, owner, anchorCx, anchorCy) {
      const txt = level ? name + ' Lv' + level : name;
      ctx.font = '700 ' + Math.round(T * 0.21) + 'px ' + bFont;
      const w = Math.max(70, ctx.measureText(txt).width) + T * 0.34;
      const h = T * 0.36;
      const topY = anchorCy + HH * 0.9;
      self.drawBannerPlate(ctx, anchorCx, topY, w, h, owner);
      ctx.fillStyle = owner === 'p1' ? '#ffd76a' : (owner === 'p2' ? '#ff9c9c' : '#f4f1e4');
      ctx.fillText(txt, anchorCx, topY + h * 0.62);
    };
    for (const k in G.state.buildings) {
      const b = G.state.buildings[k];
      /* ★ 第八十一次修订：等轴同正交——建筑牌 hover 显示（hoverTile 为逻辑格，pickTile 双模式兼容） */
      const fp = G.footOf(b.type);
      const hv = this.hoverTile;
      if (!(hv && hv.gx >= b.gx && hv.gx < b.gx + fp.w && hv.gy >= b.gy && hv.gy < b.gy + fp.h)) continue;
      const cx = this.tileCX(b.gx + (fp.w - 1) / 2, b.gy + (fp.h - 1) / 2);
      const cy = this.tileCY(b.gx + (fp.w - 1) / 2, b.gy + (fp.h - 1) / 2);
      drawBuildPlate(b, CFG.buildings[b.type].name, b.level, (b.owner || 'p1') === 'p1' ? 'p1' : 'p2', cx, cy);
    }
    /* ★ 主城牌移到 2×2 占地视觉中心正上方（与正交一致） */
    const mcx = this.tileCX(G.state.castle.gx + 0.5, G.state.castle.gy + 0.5);
    const mcy = this.tileCY(G.state.castle.gx + 0.5, G.state.castle.gy + 0.5);
    drawBuildPlate(G.state.castle, '主城', G.state.castleLevel, 'p1', mcx, mcy - HH * 0.95);
    const ec = G.enemyCastle();
    const ecx = this.tileCX(ec.gx + 0.5, ec.gy + 0.5), ecy = this.tileCY(ec.gx + 0.5, ec.gy + 0.5);
    drawBuildPlate(ec, '敌方主城', 1, 'p2', ecx, ecy - HH * 0.95);

    CFG.map.resources.forEach(function (r) {
      const owner = G.resourceOwnerOf(r);
      const guard = G.state.resGuard[r.gx + ',' + r.gy] || 0;
      const yieldTxt = r.res === 'logistics' ? '修路 -1⚡'
        : ('+' + r.yield + (r.res === 'food' ? '粮' : '⚡'));
      const l1 = (owner ? (owner === 'p1' ? '★ ' : '✖ ') : '') + r.name;
      const l2 = yieldTxt + (!owner && guard > 0 ? ' · 守' + guard : '');
      const x = self.tileCX(r.gx, r.gy), y = self.tileCY(r.gx, r.gy) + HH * 1.05;
      ctx.font = '700 ' + Math.round(T * 0.20) + 'px ' + bFont;
      const w1 = ctx.measureText(l1).width;
      ctx.font = Math.round(T * 0.18) + 'px ' + bFont;
      const w2 = ctx.measureText(l2).width;
      const w = Math.min(T * 1.8, Math.max(76, w1, w2) + T * 0.30);
      const h = T * 0.54;
      self.drawBannerPlate(ctx, x, y - T * 0.17, w, h, owner);
      ctx.fillStyle = owner === 'p1' ? '#ffd76a' : (owner === 'p2' ? '#ff9c9c' : '#f4f1e4');
      ctx.font = '700 ' + Math.round(T * 0.20) + 'px ' + bFont;
      ctx.fillText(l1, x, y + T * 0.03);
      ctx.font = Math.round(T * 0.18) + 'px ' + bFont;
      ctx.fillStyle = '#e8dcc0';
      ctx.fillText(l2, x, y + T * 0.24);
    });
    ctx.restore();
  },

  /** 部队移动涟漪（等轴） */
  drawMovesIso(ctx, T) {
    const now = performance.now();
    this.moves = (this.moves || []).filter(function (m) { return now - m.t0 < 700; });
    if (!this.moves.length) return;
    const self = this;
    this.moves.forEach(function (m) {
      const k = Math.min(1, (now - m.t0) / 700);
      const cx = self.tileCX(m.x1, m.y1), cy = self.tileCY(m.x1, m.y1);
      ctx.save();
      ctx.globalAlpha = 0.5 * (1 - k);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.ellipse(cx, cy, self.isoHW() * 0.3 + k * self.isoHW() * 0.5, self.isoHH() * 0.3 + k * self.isoHH() * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  },
};

global.Sandbox = Sandbox;
})(window);
