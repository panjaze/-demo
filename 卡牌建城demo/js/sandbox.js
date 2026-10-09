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
  reclaimImg: null,        // 官道开垦层 Image（只在官道格有像素；未加载则铺路全用带状路）
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
    this.loadSprites();
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

  /** 建筑贴图预载（CFG.assets 关闭或环境无 Image 时保持 emoji 渲染） */
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
    /* 地图底板（环境层）：按 CFG.mapVisual.activePlate 加载，缺失时回退程序化草地 */
    this.loadPlate(CFG.mapVisual && CFG.mapVisual.activePlate);
    /* 官道开垦层：铺在官道格上 = 把长草旧径开垦成清晰官道（加载失败只影响观感，不影响玩法） */
    this.loadReclaim();
  },

  /** 加载官道开垦层；无 Image / 路径缺失时保持 null → drawRoads 自动退化为带状路 */
  loadReclaim() {
    const src = CFG.mapVisual && CFG.mapVisual.road && CFG.mapVisual.road.reclaimSrc;
    this.reclaimImg = null;
    this.reclaimCells = null;
    if (!src || typeof global.Image !== 'function') return false;
    const cached = this.plateCache[src];
    if (cached && cached.complete) { this.reclaimImg = cached; this.buildReclaimCells(cached); return true; }
    const im = new global.Image();
    im.onload = () => { this.reclaimImg = im; this.buildReclaimCells(im); };
    im.onerror = () => { this.reclaimImg = null; };
    im.src = src;
    this.plateCache[src] = im;
    return true;
  },

  /**
   * 逐格测量官道开垦层里"官道路面占这格多少"。
   * ★ 存覆盖率而不是布尔值：素材是逐格从底图里剥离出来的，既可能整格没有像素
   *   （官道列表与美术走向有偏差），也可能把邻格的路溢进来一小块。
   *   覆盖率落在 [8%, 55%] 才判为"这一格能贴回真官道"：
   *     · 低于 8%  → 该格底图本来就没画路（或只剩个角），贴了等于没贴；
   *     · 高于 55% → 那是底图里的大片空地/路口广场，单独一格铺路却露出一大片土场
   *                  （实测素材 v1 版有 (8,6)=93% 这种，正是用户嫌弃的"方块"观感）。
   *   两头都退化为程序化带状路，视觉不断、不突兀。
   */
  buildReclaimCells(im) {
    try {
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      const cx = cv.getContext('2d');
      cx.drawImage(im, 0, 0);
      const d = cx.getImageData(0, 0, im.width, im.height).data;
      const st = im.width / CFG.map.cols;             // 素材每格边长
      const set = {};
      (CFG.map.officialRoads || []).forEach((r) => {
        let sum = 0, n = 0;
        const x0 = Math.floor(r.gx * st), y0 = Math.floor(r.gy * st);
        for (let y = y0; y < y0 + st; y += 3) {
          for (let x = x0; x < x0 + st; x += 3) {
            sum += d[(y * im.width + x) * 4 + 3]; n++;
          }
        }
        const cov = sum / n / 255;
        if (cov >= 0.08 && cov <= 0.55) set[r.gx + ',' + r.gy] = cov;
      });
      this.reclaimCells = set;
    } catch (e) {
      this.reclaimCells = null;   // 像素读取失败（如跨域污染）→ 全部按有像素处理
    }
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
    if ('filter' in cb) cb.filter = 'blur(18px) brightness(0.86) saturate(0.92)';
    cb.drawImage(a, 0, 0);
    if ('filter' in cb) cb.filter = 'none';

    /* ③ 中心贴回清晰原图 */
    cb.drawImage(im, P, P, W, H);

    /* ④ 地图四边向内收的暗角 → 柔化"清晰 / 模糊"的接缝，读作地图边界 */
    const EDGE = 130, dark = 0.34;
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

  clampCam() {
    const lw = CFG.map.cols * CFG.map.tile * this.scale;
    const lh = CFG.map.rows * CFG.map.tile * this.scale;
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
    this.scale = Math.min(2.2, Math.max(0.45, this.scale * f));
    const newT = CFG.map.tile * this.scale;
    this.camX = gx * newT - ax;
    this.camY = gy * newT - ay;
    this.clampCam();
  },

  /** 让某格居中（用于「视角回城」） */
  centerOn(gx, gy) {
    const T = CFG.map.tile * this.scale;
    this.camX = (gx + 0.5) * T - this.cw / 2;
    this.camY = (gy + 0.5) * T - this.ch / 2;
    this.clampCam();
  },

  /** 格子坐标 → 面板像素（DOM 城市格用它对齐 Canvas） */
  tileRect(gx, gy) {
    const t = CFG.map.tile * this.scale;
    return { x: this.offX + gx * t, y: this.offY + gy * t, w: t, h: t };
  },

  /* ==================== 绘制 ==================== */

  render() {
    const ctx = this.ctx;
    if (!ctx || !this.cw) return;
    const T = CFG.map.tile;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, this.cw, this.ch);

    // 用 try/finally 兜底：任何一处绘制异常都不会把画布变换留在脏状态
    this.drainFx();          // 先消费逻辑层的特效事件（drawBuildings 要用 pop 变形）
    ctx.save();
    try {
      ctx.translate(this.offX, this.offY);
      ctx.scale(this.scale, this.scale);

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

  /* 道路（第三十八次修订：铺路 = 开垦官道，官道格贴素材 + 其余画混合带状路） */
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
    /* 开垦层就绪 = 「官道格 + 该格素材覆盖率适中」才算能贴回真官道。
     * ★ 第三十九次修订：官道格**同样先画带状路**，素材只是叠在上面加还原感。
     *   早期版本让官道格跳过带状路、只贴素材，结果素材有缺陷的格直接变成断头路
     *   （实测 13,8/14,8/15,8 三格路心色差 Δ≈2，等于整格没画）。
     *   带状路兜底 → 任何一格都不会断；官道格再叠一层底图真路面，开垦感就在这一层。 */
    const rec = this.reclaimImg;
    const artCells = this.reclaimCells;
    const isOff = (gx, gy) => {
      if (!rec || typeof G.isOfficialRoad !== 'function' || !G.isOfficialRoad(gx, gy)) return false;
      return !artCells || artCells[gx + ',' + gy] > 0;   // 像素表缺失时按全有处理
    };

    /* ① 带状路：相邻格两两连段（圆头带）——所有路格都画，官道格也不例外。
     * ★ 桥所在的水格本身不画路面（露出底图木桥），但**两岸都要补半段接到桥边**，
     *   否则每个渡口两侧各留半格空白，路看起来到不了桥。
     *   四向都要检查：只往右/下连的话，桥"对面"那一侧永远没人接（实测踩过）。 */
    const buildSegs = function (accept) {
      const out = [];
      cells.forEach(function (c) {
        const gx = c[0], gy = c[1];
        if (accept && !accept(gx, gy)) return;
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
    const segs = buildSegs(null);            // 全部路格
    const offSegs = rec ? buildSegs(isOff) : [];   // 只有官道格（素材贴回后补路心用）
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
      pass(RB.body, RB.width);       // 色相改官道土色（明暗纹理全保留）
      if (RB.pig) pass(RB.pig, RB.pig.width);  // 薄着色：高亮农田底上不被洗掉
      pass(RB.lift, RB.liftWidth);   // 土壤提亮
      pass(RB.core, RB.coreWidth);   // 路心被踩亮的一条
      ctx.restore();

      /* ② 毛边 + 斑驳 + 草茬侵入：确定性打点，模仿手绘土路的蚀边与深浅 */
      ctx.save();
      const N = RB.pebbles || 0, M = RB.mottle || 0, TU = RB.tufts || 0;
      for (let n = 0; n < cells.length; n++) {
        const gx = cells[n][0], gy = cells[n][1];
        if (isOff(gx, gy)) continue;
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

    /* ③ 官道开垦：贴回清晰官道（盖在带状层之上，与底图旧径严丝合缝） */
    if (rec) {
      const st = rec.width / CFG.map.cols;    // 素材每格边长（底图与网格同构图）
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      for (let m = 0; m < cells.length; m++) {
        if (!isOff(cells[m][0], cells[m][1])) continue;
        const gx = cells[m][0], gy = cells[m][1];
        ctx.drawImage(rec, gx * st, gy * st, st, st, gx * T, gy * T, T, T);
      }
      ctx.restore();

      /* ④ 官道路心补提亮：素材是**盖在**带状层之上的，会把 ① 里的路心提亮整条盖掉，
       *   结果官道格比非官道格暗一截（实测均值色差 41，肉眼能看出"新路更亮"）。
       *   素材里的路条在生成时已归位到格心，所以这里沿同一条带补一道亮芯即可对齐。
       *   （第四十次修订：用户既要"看得清"，也要两种路观感一致） */
      if (RB && RB.core && offSegs.length) {
        ctx.save();
        ctx.globalCompositeOperation = RB.core.mode;
        ctx.globalAlpha = RB.core.alpha * 0.75;
        ctx.strokeStyle = RB.core.color;
        ctx.lineWidth = T * RB.coreWidth * 0.7;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < offSegs.length; i++) {
          ctx.moveTo(offSegs[i][0], offSegs[i][1]); ctx.lineTo(offSegs[i][2], offSegs[i][3]);
        }
        ctx.stroke();
        ctx.restore();
      }
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
    CFG.map.resources.forEach((r) => {
      const owner = (G && G.state) ? G.resourceOwnerOf(r) : null;
      const ring = owner === 'p1' ? COL.p1 : (owner === 'p2' ? COL.p2 : null);
      /* 资源点图标：粮点 🌾 / 能源点 ⚡ / 物流点 🛣️（第四十四次修订：
       * 这里原本判的是 'material'——那是已删除的物资体系遗留，导致物流点被画成 ⚡） */
      const ico = r.res === 'food' ? '🌾' : (r.res === 'logistics' ? '🛣️' : '⚡');
      icon(r.gx, r.gy, ico, 0.46, ring);
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
          /* 落成 / 升级：底边锚定的纵向弹跳（第四十三次修订）。
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
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const skip = {};
    (G.state.march || []).forEach(function (m) {
      const p = m.path[Math.min(m.idx, m.path.length - 1)];
      skip[p.gx + ',' + p.gy] = 1;
    });

    G.troopTiles().forEach((t) => {
      const cx = (t.gx + 0.5) * T, cy = (t.gy + 0.5) * T;
      const both = t.p1 > 0 && t.p2 > 0;
      const badge = (n, side, dx, hide) => {
        if (n <= 0 || hide) return;
        const col = side === 'p1' ? COL.p1 : COL.p2;
        const r = T * 0.3;
        ctx.beginPath(); ctx.arc(cx + dx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(8,14,22,0.92)'; ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 ' + Math.round(T * 0.27) + 'px system-ui, sans-serif';
        ctx.fillText(String(n), cx + dx, cy + T * 0.02);
      };
      badge(t.p1, 'p1', both ? -T * 0.2 : 0, !!skip[t.gx + ',' + t.gy]);
      badge(t.p2, 'p2', both ? T * 0.2 : 0, false);
    });
  },

  /** 行军中的部队：画在插值位置上 + 一层阵营光晕 */
  drawMarching(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    const list = G.marchingTroops();
    if (!list.length) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    list.forEach((m) => {
      const cx = (m.x + 0.5) * T, cy = (m.y + 0.5) * T;
      const col = m.side === 'p1' ? COL.p1 : COL.p2;

      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, T * 0.44, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.beginPath(); ctx.arc(cx, cy, T * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,14,22,0.95)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 ' + Math.round(T * 0.27) + 'px system-ui, sans-serif';
      ctx.fillText(String(m.n), cx, cy + T * 0.02);
    });
  },

  addMove(x0, y0, x1, y1, side, n) {
    this.moves.push({ x0: x0, y0: y0, x1: x1, y1: y1, side: side, n: n, t0: performance.now() });
  },

  /* ==================== 表现层特效（第四十三次修订） ====================
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
      const cx = (f.gx + 0.5) * T, cy = (f.gy + 0.5) * T;
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
        ctx.ellipse(cx, (f.gy + fp.h) * T - T * 0.06, rx * (0.5 + e * 0.9), ry * (0.5 + e * 0.9), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - p) * 0.35;
        ctx.strokeStyle = '#fff8e0';
        ctx.beginPath();
        ctx.ellipse(cx, (f.gy + fp.h) * T - T * 0.06, rx * (0.3 + e * 0.55), ry * (0.3 + e * 0.55), 0, 0, Math.PI * 2);
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
      x: this.canvas.offsetLeft + gx * T + this.offX,
      y: this.canvas.offsetTop + gy * T + this.offY,
    };
  },

  /** 地图文字标签（最后绘制 + 深色底板）：保证不被建筑/部队盖住（用户报障：遮挡） */
  drawMapLabels(ctx, T) {
    const G = global.Game;
    if (!G || !G.state) return;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 ' + Math.round(T * 0.2) + 'px "PingFang SC","Microsoft YaHei",sans-serif';
    CFG.map.resources.forEach(function (r) {
      const owner = G.resourceOwnerOf(r);
      // 未占领的资源点显示剩余守军——否则玩家不知道派兵过去为什么没效果
      const guard = G.state.resGuard[r.gx + ',' + r.gy] || 0;
      const guardTxt = !owner && guard > 0 ? ' 守军' + guard : (owner ? '' : ' 可占领');
      const txt = (owner ? (owner === 'p1' ? '★ ' : '✖ ') : '') + r.name + guardTxt;
      const x = (r.gx + 0.5) * T, y = (r.gy + 1.04) * T;
      const w = Math.max(46, ctx.measureText(txt).width + 12);
      ctx.fillStyle = 'rgba(6,10,16,0.74)';
      ctx.fillRect(x - w / 2, y - T * 0.13, w, T * 0.28);
      ctx.fillStyle = owner === 'p1' ? '#ffd23f' : (owner === 'p2' ? '#ff8a8a' : '#f2f6ff');
      ctx.fillText(txt, x, y);
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
};

global.Sandbox = Sandbox;
})(window);
