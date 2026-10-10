/* =============================================================
 * ui.js —— DOM 渲染与交互
 * 只负责「把 Game.state 画出来」和「把玩家操作转给 Game」
 * 不包含任何游戏规则
 * ============================================================= */
(function (global) {
'use strict';

const $ = function (id) { return document.getElementById(id); };

const RES_META = {
  energy:    { icon: '⚡',  name: '能量' },
  food:      { icon: '🌾', name: '粮食' },
  /* ★ 物流点（第四十五次修订补）：
   *   `CFG.map.resources` 里有 4 个 `res: 'logistics'` 的物流点（第二十八次修订把矿点改过来的），
   *   但这里一直没登记 → 任何 `RES_META[r.res].icon` 都抛 TypeError。
   *   破坏力在于：它发生在**点击处理器里**，异常会杀死处理器 → 玩家点击物流点"点了没反应"
   *   （正是踩坑 #1 描述的形态）。由真人模拟测试随机点地图抓到。 */
  logistics: { icon: '🛣️', name: '物流' },
};

/** 资源类型的安全取图标：万一将来又加了新资源种类，也不会再把点击处理器炸掉 */
function resIcon(res) { return (RES_META[res] && RES_META[res].icon) || '📍'; }

function resText(cost) {
  return Object.keys(cost).map(function (k) {
    return cost[k] + ' ' + RES_META[k].icon;
  }).join(' ') || '—';
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}

/* 顶栏时钟副行：正计时 + 兜底时限进度。
 * CFG.time.limit > 0 时游戏会在该时刻按综合分结算（主城存亡仍是首要结束条件），
 * 必须让玩家看得见，否则会在时限到达时被"突然结算"。
 * limit = 0 表示不设上限，只显示 Tick 数。 */
function fmtTickLine(S) {
  const lim = CFG.time.limit;
  if (!(lim > 0)) return 'Tick ' + S.tickCount;
  const left = Math.max(0, lim - S.t);
  return 'Tick ' + S.tickCount + ' / ' + Math.ceil(lim / CFG.time.tick) +
         '　剩 ' + fmtTime(left);
}

/* 派兵提示文案 —— 「点击派兵」与「拖拽派兵」共用同一份，避免两处口径不一致
 * （第四十三次修订：此前拖拽派兵**不提示守军数量**、只有点击派兵提示；
 *   且两处都没提"粮不够会中途停军"。坑对照：踩坑 #16「提示文案必须和代码实际行为对齐」。） */
function marchHint(r, tgtRes, guard) {
  let tip = '（' + r.legs + ' 格 · 预计耗粮 ' + r.cost + ' 🌾';
  if (r.short) tip += ' · ⚠ 粮只够走 ' + r.affordLegs + ' 格，中途会停下';
  tip += '）';
  let warn = '';
  if (tgtRes) {
    if (guard >= r.n) warn = ' ⚠ 守军 ' + guard + ' ≥ 兵力 ' + r.n + '，会被全歼！';
    else if (guard > 0) warn = '（守军 ' + guard + '）';
  }
  return tip + warn;
}

const UI = {

  drag: null,        // { handIdx, ghost, type }

  /* ==================== 初始化 ==================== */

  init() {
    this.modal = null;               // 'shop' | 'pool' | null
    this.discardMode = false;
    this._resultShown = false;       // 结算演出只触发一次（第四十四次修订）
    this.tileSel = null;             // 选中的己方建筑格 { gx, gy, isCastle }
    this.roadPlacing = null;         // 铺路模式 { key, handIdx, left, card }
    this.bindTopbar();
    this.bindShop();
    this.buildTileActions();
    this.bindModal();
    this.bindSandbox();
    this.bindCornerExtras();
    this.bindDrag();
    this.render();
  },

  /* ==================== 角标扩展：弃牌 / 回城 / 资源明细 ==================== */

  bindCornerExtras() {
    const self = this;
    $('btn-discard').addEventListener('click', function () {
      Engine.audio.click();
      self.setDiscardMode(!self.discardMode);
    });
    $('btn-recenter').addEventListener('click', function () {
      Engine.audio.click();
      Sandbox.centerOn(CFG.map.spawn.p1.gx, CFG.map.spawn.p1.gy);
      UI.hint('视角已回到我方城市（拖动沙盘可平移地图）');
    });

    ['energy', 'food'].forEach(function (k) {
      const chip = document.querySelector('.res-' + k);
      if (!chip) return;
      chip.style.pointerEvents = 'auto';
      chip.addEventListener('mouseenter', function () { self.showResTip(k, chip); });
      chip.addEventListener('mouseleave', function () { $('res-tip').classList.add('hidden'); });
    });
  },

  showResTip(k, chip) {
    const el = $('res-tip');
    el.innerHTML = UI.resTipHTML(k);
    el.classList.remove('hidden');
    const r = chip.getBoundingClientRect();
    const uiR = $('ui').getBoundingClientRect();
    /* ★ 第四十八次修订：逻辑尺寸已动态化（scale 恒为 1），#ui 的真实 px = 逻辑 px，
     *   直接用相对偏移定位，不再除以旧的缩放系数。 */
    el.style.left = Math.max(8, Math.round(r.left - uiR.left) - 10) + 'px';
    el.style.top = Math.round(r.bottom - uiR.top + 8) + 'px';
  },

  /** 某种资源的「所有产出来源 + 速率」与「消耗途径」 */
  resTipHTML(k) {
    const S = Game.state;
    const src = [];
    let base = 0;
    const push = function (label, v) { if (v) { src.push([label, v]); base += v; } };

    if (k === 'energy') {
      push('主城 Lv' + S.castleLevel, CFG.castle.levels[S.castleLevel - 1].energy || 0);
    }

    const byType = {};
    Game.myBuildings().forEach(function (b) {
      const d = CFG.buildings[b.type];
      const y = d.levels && d.levels[b.level - 1] ? d.levels[b.level - 1].yield : null;
      if (!y || !y[k]) return;
      const key = d.name + ' Lv' + b.level;
      byType[key] = (byType[key] || 0) + y[k];
    });
    Object.keys(byType).forEach(function (kk) { push('城市 · ' + kk, byType[kk]); });

    let resSum = 0;
    CFG.map.resources.forEach(function (r) {
      if (r.res === k && Game.resourceOwnerOf(r) === 'p1') resSum += r.yield;
    });
    push('已占资源点 ×' + CFG.map.resources.filter(function (r) {
      return r.res === k && Game.resourceOwnerOf(r) === 'p1';
    }).length, resSum);

    const mul = (S.boost && S.boost.ticksLeft > 0) ? S.boost.mul : 1;

    let html = '<div class="rt-head">' + RES_META[k].icon + ' ' + RES_META[k].name +
               '<b>+' + (base * mul) + ' / Tick</b></div>';
    html += '<ul class="rt-list">';
    if (!src.length) html += '<li class="rt-none"><span>暂无产出来源</span></li>';
    src.forEach(function (s) { html += '<li><span>' + s[0] + '</span><b>+' + s[1] + '</b></li>'; });
    if (mul > 1) {
      html += '<li class="rt-boost"><span>效果牌 ×' + mul + '（剩 ' + S.boost.ticksLeft + ' Tick）</span><b>×' +
              mul + '</b></li>';
    }
    html += '</ul>';

    const cu = Game.castleUpgradeCost();
    const uses = {
      energy: [
        ['开牌 / 抽取', CFG.shop.openCost + ' 起（第 n 次抽取 = n × ' + CFG.shop.rerollGrowth + '）'],
        ['买卡', '建筑 1~5 / 道路 1~6 / 升级 3'],
        ['主城升级', cu ? cu.energy + ' ⚡（下一级）' : '已满级'],
      ],
      food: [
        ['训练士兵', '每 12~20 秒扣一次'],
        ['部队行军', '每兵每格 ' + CFG.soldier.moveFoodPerTile + ' 🌾'],
      ],
    };
    html += '<div class="rt-head rt-cost">消耗途径</div><ul class="rt-list">';
    (uses[k] || []).forEach(function (u) { html += '<li><span>' + u[0] + '</span><b>' + u[1] + '</b></li>'; });
    html += '</ul>';
    return html;
  },

  /* ==================== 沙盘点选与派兵 ==================== */

  bindSandbox() {
    const self = this;
    const cv = $('sandbox');
    if (!cv) return;
    let down = null, panned = false;

    const scaleOf = function () {
      const rect = cv.getBoundingClientRect();
      return rect.width / (cv.offsetWidth || rect.width);
    };
    const toLocal = function (e) {
      const rect = cv.getBoundingClientRect();
      const k = rect.width / (cv.offsetWidth || rect.width);
      return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
    };

    cv.addEventListener('pointerdown', function (e) {
      // 按住有我方士兵的格子 → 进入「拖兵」模式（优先于平移地图）
      const p0 = toLocal(e);
      const t0 = Sandbox.pickTile(p0.x, p0.y);
      const mine = t0 ? Game.troopsAt(t0.gx, t0.gy).p1 : 0;
      if (mine > 0) {
        self.troopDrag = { from: { gx: t0.gx, gy: t0.gy }, n: mine, sx: e.clientX, sy: e.clientY, active: false };
        Sandbox.dragFrom = { gx: t0.gx, gy: t0.gy };
        if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
        return;
      }
      down = { x: e.clientX, y: e.clientY };
      panned = false;
      cv.classList.add('grabbing');
      // 捕获指针：拖到画布外面也能继续平移
      if (cv.setPointerCapture) { try { cv.setPointerCapture(e.pointerId); } catch (err) {} }
    });

    cv.addEventListener('pointermove', function (e) {
      if (self.troopDrag) {
        const d = self.troopDrag;
        if (!d.active && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 6) {
          d.active = true;
          UI.makeTroopGhost(d.n);
        }
        if (d.active) UI.moveTroopGhost(e.clientX, e.clientY);
        return;
      }
      // 光标下的格子（建造模式的跟随预览用）—— 不按住也要更新
      const hp = toLocal(e);
      Sandbox.hoverTile = Sandbox.pickTile(hp.x, hp.y);
      if (!down) return;
      if (!panned && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 6) return;
      panned = true;
      const k = scaleOf();
      Sandbox.panBy(-(e.clientX - down.x) / k, -(e.clientY - down.y) / k);
      down.x = e.clientX; down.y = e.clientY;
    });

    cv.addEventListener('pointerleave', function () {
      Sandbox.hoverTile = null;      // 光标离开沙盘 → 收起跟随预览
    });

    cv.addEventListener('pointerup', function (e) {
      if (self.troopDrag) {
        const d = self.troopDrag;
        UI.removeTroopGhost();
        Sandbox.dragFrom = null;
        self.troopDrag = null;
        const p = toLocal(e);
        const t = Sandbox.pickTile(p.x, p.y);
        if (d.active && t && Game.isTargetTile(t.gx, t.gy)) {
          const r = Game.orderMoveFrom(d.from.gx, d.from.gy, t.gx, t.gy);
          if (r.ok) {
            Engine.audio.pickup();
            const tgtRes = Game.resourceAt(t.gx, t.gy);
            const guard = tgtRes ? (Game.state.resGuard[Game.tileKeyOf(t.gx, t.gy)] || 0) : 0;
            UI.hint('部队出发 → ' + Game.tileName(t.gx, t.gy) + marchHint(r, tgtRes, guard));
          } else {
            Engine.audio.hurt();
            UI.hint(r.reason === 'air' ? '部队只能派往具体建筑：资源点 / 建筑 / 敌方主城'
                  : r.reason === 'nofood' ? '粮食不足以支撑行军'
                  : r.reason === 'nopath' ? '找不到通往目标的路' : '无法派兵');
          }
        } else if (d.active) {
          Engine.audio.hurt();
          UI.hint('这里不能落兵 · 拖到有 ★ 蓝点的建筑上');
        } else {
          // 只是点了一下 → 走原来的点选逻辑
          UI.onTileClick(d.from.gx, d.from.gy);
          return;
        }
        UI.render();
        return;
      }

      cv.classList.remove('grabbing');
      const wasPan = panned;
      down = null;
      if (wasPan) return;                      // 拖动地图 ≠ 点击
      const p = toLocal(e);
      const t = Sandbox.pickTile(p.x, p.y);
      if (t) self.onTileClick(t.gx, t.gy);
    });

    cv.addEventListener('pointercancel', function () {
      down = null; cv.classList.remove('grabbing');
    });

    // 滚轮缩放（以指针为锚点）
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      const p = toLocal(e);
      Sandbox.zoomAt(e.deltaY < 0 ? 1.14 : 1 / 1.14, p.x, p.y);
    }, { passive: false });
  },

  isCastleClick(gx, gy) {
    const c = Game.state.castle;
    return c.gx === gx && c.gy === gy;
  },

  isMyBuildingClick(gx, gy) {
    if (this.isCastleClick(gx, gy)) return true;
    const b = Game.buildingAt(gx, gy);
    return !!b && (b.owner || 'p1') === 'p1';       // 被敌方占领的建筑不归我操作
  },

  onTileClick(gx, gy) {
    const S = Game.state;
    if (this.discardMode) this.setDiscardMode(false);

    // ⓪ 建筑放置模式：点击蓝格直接建造（与道路牌一致的放置方式）
    if (this.placeMode) {
      if (Game.canBuildAt(this.placeMode.key, gx, gy)) {
        const idx = this.placeMode.handIdx;
        if (Game.build(idx, gx, gy)) { Engine.audio.pickup(); this.placeMode = null; }
        else UI.hint(Game.buildBlockReason(this.placeMode.key, gx, gy) || '建造失败');
      } else {
        // ★ 第四十次修订：点了不能建的地方就**退出**放置模式。
        //   旧行为是只报错、模式留着，玩家又找不到退出方式 → 感觉"卡死"。
        Engine.audio.hurt();
        UI.hint((Game.buildBlockReason(this.placeMode.key, gx, gy) || '这里不能建造') + '（已退出放置）');
        this.placeMode = null;
      }
      UI.render();
      return;
    }

    // ⓪② 操作条取消：点同一个建筑=取消；点其他区域=收起（派兵/铺路等逻辑继续）
    if (this.tileSel) {
      const same = (this.tileSel.gx === gx && this.tileSel.gy === gy);
      if (same) { this.tileSel = null; Engine.audio.click(); UI.render(); return; }
      if (!this.isMyBuildingClick(gx, gy) && !this.isMyRoadClick(gx, gy)) this.tileSel = null;
    }

    const sel = S.sel;

    // ① 铺路模式：点地图铺一格
    if (this.roadPlacing) {
      // ★ 用 canPlaceRoadFor('p1')：除了"空地挨着路"还要求接在自己的路网前沿上，
      //   否则能贴着敌方主城隔空铺路（AI 一直有这个限制，玩家以前没有）
      if (Game.canPlaceRoadFor('p1', gx, gy)) {
        Game.placeRoad(gx, gy, 'p1');
        Engine.audio.click();
        this.roadPlacing.left -= 1;
        if (this.roadPlacing.left <= 0) {
          this.roadPlacing = null;
          UI.hint('这张道路牌铺完了');
        } else {
          const left = Game.roadBudgetLeft('p1');
          UI.hint('继续点击铺路，剩余 ' + this.roadPlacing.left + ' 格' +
                  (left <= 0 ? '　⚠ 道路额度已满，先拆掉旧路才能继续铺' : '（道路额度 ' + left + '）'));
        }
        UI.render();
      } else {
        Engine.audio.hurt();
        UI.hint('这里不能铺路：必须是空地，且挨着你的道路或主城');
      }
      UI.render();
      return;
    }

    // ② 没有派兵意图时，点自己的建筑/主城 = 选中它（弹出操作条）
    if (!sel && (this.isMyBuildingClick(gx, gy))) {
      this.tileSel = this.isCastleClick(gx, gy)
        ? { gx: gx, gy: gy, isCastle: true }
        : { gx: gx, gy: gy, isCastle: false };
      Engine.audio.click();
      UI.render();
      return;
    }

    /* ②b 点自己主动铺的路 → 弹操作条（可拆除）。
     * 第四十六次修订：道路有了每方额度上限，"铺拆结合"就必须能拆 —— 否则额度满了就死路一条。 */
    if (!sel && this.isMyRoadClick(gx, gy)) {
      this.tileSel = { gx: gx, gy: gy, isRoad: true };
      Engine.audio.click();
      UI.render();
      return;
    }

    if (sel) {
      if (sel.gx === gx && sel.gy === gy) {   // 再点同格 → 取消
        Game.selectTile(null);
        UI.render();
        return;
      }
      const mineHere = Game.troopsAt(gx, gy).p1;
      // 点我方另一支有兵的、且是合法目标的格 → 直接派兵过去（顺带合并）
      if (!(mineHere > 0 && !Game.isTargetTile(gx, gy))) {
        const r = Game.orderMove(gx, gy);
        if (r.ok) {
          Engine.audio.pickup();
          const tgtRes = Game.resourceAt(gx, gy);
          const guard = tgtRes ? (S.resGuard[Game.tileKeyOf(gx, gy)] || 0) : 0;
          UI.hint('部队出发 → ' + Game.tileName(gx, gy) + marchHint(r, tgtRes, guard));
          UI.render();
          return;
        }
        if (r.reason === 'air') {
          UI.hint('部队只能派往具体建筑：资源点 / 己方建筑 / 敌方主城');
          Engine.audio.hurt();
          UI.render();
          return;
        }
        if (r.reason === 'nofood') {
          UI.hint('粮食不足以支撑行军（每兵每格 ' + CFG.soldier.moveFoodPerTile + ' 🌾）');
          Engine.audio.hurt();
          UI.render();
          return;
        }
        if (r.reason === 'nopath') {
          UI.hint('找不到通往目标的路');
          Engine.audio.hurt();
          UI.render();
          return;
        }
      }
    }

    const mine = Game.troopsAt(gx, gy).p1;
    if (mine > 0) {
      Game.selectTile(gx, gy);
      Engine.audio.click();
      UI.hint('已选中 ' + mine + ' 个士兵 · 点地图上有 ★ 蓝点的建筑派他们过去');
      UI.render();
      return;
    }

    if (sel) { Game.selectTile(null); UI.render(); return; }

    const r = Game.resourceAt(gx, gy);
    if (r) {
      const owner = Game.resourceOwnerOf(r);
      const g2 = S.resGuard[Game.tileKeyOf(gx, gy)] || 0;
      UI.hint(owner === 'p1'
        ? '「' + r.name + '」已归我方，' + (r.yield > 0 ? '每 Tick +' + r.yield + ' ' + resIcon(r.res)
                                                     : '每 24 秒自动免费铺 1 格路')
        : '「' + r.name + '」剩余守军 ' + g2 + '：派 ≥' + (g2 + 1) + ' 兵清掉守军即可占领（' +
          (r.yield > 0 ? '每 Tick +' + r.yield + ' ' + resIcon(r.res) : '占领后自动铺路') + '）');
    } else if (Game.isTargetTile(gx, gy)) {
      UI.hint('这是「' + Game.tileName(gx, gy) + '」· 先点我方有兵的格子选中部队，再点这里派兵');
    } else {
      UI.hint('这里没有可派兵的目标 · 部队只能朝建筑 / 资源点 / 城市区移动');
      UI.render();
    }
    Engine.audio.hurt();
  },

  /* ==================== 弃牌模式 ==================== */

  setDiscardMode(on) {
    this.discardMode = !!on;
    const bar = $('hand-bar');
    if (bar) bar.classList.toggle('discard-mode', this.discardMode);
    const btn = $('btn-discard');
    if (btn) btn.classList.toggle('active', this.discardMode);
    if (this.discardMode) UI.hint('弃牌模式：点一张手牌把它弃掉（再点 🗑️ 退出）');
    UI.render();
  },

  /* ==================== 弹出层（抽卡 / 牌库） ==================== */

  bindModal() {
    const self = this;
    document.querySelectorAll('#corner-ui .corner-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Engine.audio.click();
        self.setModal(self.modal === btn.dataset.modal ? null : btn.dataset.modal);
      });
    });
    $('modal-close').addEventListener('click', function () {
      if (self.modal === 'event') return;          // §20 事件牌必须领取，不允许关
      Engine.audio.click();
      self.setModal(null);
    });
    $('modal').addEventListener('click', function (e) {
      if (e.target === $('modal') && self.modal !== 'event') self.setModal(null);
    });
  },

  setModal(mode) {
    this.modal = mode;
    $('modal').classList.toggle('hidden', !mode);
    $('pane-shop').classList.toggle('hidden', mode !== 'shop');
    $('pane-pool').classList.toggle('hidden', mode !== 'pool');
    $('pane-reward').classList.toggle('hidden', mode !== 'reward');
    $('pane-policy').classList.toggle('hidden', mode !== 'policy' && mode !== 'policyview' && mode !== 'event');
    $('pane-quest').classList.toggle('hidden', mode !== 'quest');
    document.querySelectorAll('#corner-ui .corner-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.modal === mode);
    });
    if (mode === 'shop') {
      $('modal-title').textContent = '抽卡';
      $('modal-sub').textContent = '翻开 5 张候选卡 · 按标价买进手牌 · 再次抽取费用会越来越贵';
    } else if (mode === 'policy' || mode === 'policyview') {
      $('modal-title').textContent = mode === 'policy' ? '政策三选一' : '已颁布的政策';
      $('modal-sub').textContent = '品质：🟤黄铜 < ⚪白银 < 🟡黄金 · 只与主城等级挂钩';
      this.renderPolicyPane();
    } else if (mode === 'event') {
      $('modal-title').textContent = '事件牌';
      $('modal-sub').textContent = '必须领取才能继续 · 领取后生效到下一张事件牌为止';
      this.renderEventPane();
    } else if (mode === 'eventview') {
      $('modal-title').textContent = '生效中的事件';
      $('modal-sub').textContent = '负面事件可支付资源提前化解 · 也可以等它被下一张顶掉';
      this.renderEventViewPane();
    } else if (mode === 'quest') {
      $('modal-title').textContent = '星级任务';
      $('modal-sub').textContent = '完成一星全部 5 项 → 领取 1 件遗物（共 3 星）';
      this.renderQuestPane();
    } else if (mode === 'reward') {
      $('modal-title').textContent = '任务奖励 · 遗物三选一';
      $('modal-sub').textContent = '选 1 件遗物（永久生效 · 固定值）· 最多持有 ' + CFG.discard.relicCap + ' 件';
      const host = $('reward-cards');
      host.innerHTML = '';
      const poolR = Object.keys(CFG.relics);   // 遗物可重复获取（叠加生效）
      for (let i = poolR.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t3 = poolR[i]; poolR[i] = poolR[j]; poolR[j] = t3;
      }
      this.rewardChoices = poolR.slice(0, 3);
      const self3 = this;
      this.rewardChoices.forEach(function (k, i) {
        const rc = CFG.relics[k];
        const el = document.createElement('div');
        el.className = 'card card-relic';
        el.dataset.reward = i;
        el.innerHTML = '<div class="card-icon">' + rc.icon + '</div>' +
          '<div class="card-main"><div class="card-name">' + rc.name + '</div>' +
          '<div class="card-cost card-kind">遗物 · 永久生效</div>' +
          '<div class="card-desc">' + rc.desc + '</div></div>';
        host.appendChild(el);
      });
    } else if (mode === 'pool') {
      $('modal-title').textContent = '牌库';
      $('modal-sub').textContent = '当前主城等级下，你能抽到的所有卡';
    }
    this.render();
  },

  /* ==================== 格子操作条（选中建筑/主城时出现） ==================== */

  /** 点的是不是我方主动铺的路（预设官道/桥不可拆，故不算） */
  isMyRoadClick(gx, gy) {
    const r = Game.state.roads[Game.tileKeyOf(gx, gy)];
    return !!(r && r.side === 'p1');
  },

  buildTileActions() {
    const bar = $('tile-actions');
    if (!bar || bar.dataset.bound) return;
    bar.dataset.bound = '1';

    $('ta-upgrade').addEventListener('click', function () {
      const t = UI.tileSel;
      if (!t) return;
      if (t.isCastle) {
        if (Game.upgradeCastle()) { Engine.audio.win(); UI.hint('主城升级成功 · 建筑等级上限 Lv' + Game.buildingLevelCap() + ' · 每种建筑上限 ' + Game.typeCap('farm') + ' 座'); UI.render(); }
        else { UI.hint('主城升级失败：能量不足或主城已满级'); Engine.audio.hurt(); }
        return;
      }
      const b = Game.buildingAt(t.gx, t.gy);
      if (b && b.owner === 'p2') { UI.hint('这座建筑被敌方占领了'); Engine.audio.hurt(); return; }
      const r2 = Game.upgradeWithCard(t.gx, t.gy);
      if (r2.ok) { Engine.audio.pickup(); UI.render(); }
      else {
        UI.hint(r2.reason === 'nocard' ? '手牌里没有「升级牌」'
              : r2.reason === 'castle' ? '需要先把主城升到 Lv' + (b.level + 1)
              : r2.reason === 'max' ? '已到 Lv3' : '无法升级');
        Engine.audio.hurt();
      }
    });

    $('ta-demolish').addEventListener('click', function () {
      const t = UI.tileSel;
      if (!t || t.isCastle) return;
      if (t.isRoad) {                                   // 第四十六次修订：拆路释放额度
        if (Game.demolishRoad(t.gx, t.gy, 'p1')) {
          Engine.audio.hit();
          UI.tileSel = null;
          UI.render();
        }
        return;
      }
      if (Game.demolish(t.gx, t.gy)) {
        Engine.audio.hit();
        UI.tileSel = null;
        UI.render();
      }
    });

    $('ta-close').addEventListener('click', function () {
      UI.tileSel = null;
      Engine.audio.click();
      UI.render();
    });
  },

  /* ==================== 拖兵（按住有兵的格子拖到目标建筑） ==================== */

  makeTroopGhost(n) {
    const g = document.createElement('div');
    g.className = 'troop-ghost';
    g.textContent = '⚔ ' + n;
    document.body.appendChild(g);
    this._ghost = g;
  },

  moveTroopGhost(x, y) {
    if (!this._ghost) return;
    this._ghost.style.left = (x + 12) + 'px';
    this._ghost.style.top = (y - 30) + 'px';
  },

  removeTroopGhost() {
    if (this._ghost) { this._ghost.remove(); this._ghost = null; }
  },

  /* ==================== 事件绑定 ==================== */

  bindTopbar() {
    $('btn-pause').addEventListener('click', function () {
      const S = Game.state;
      if (S.over) return;
      S.paused = !S.paused;
      Engine.audio.click();
      UI.render();
    });

    $('btn-reset').addEventListener('click', function () {
      Engine.audio.click();
      Game.reset();
      UI.render();
    });

    $('result-restart').addEventListener('click', function () {
      Engine.audio.click();
      Game.reset();
      UI.tileSel = null;
      UI.render();
    });

    $('btn-debug').addEventListener('click', function () {
      Engine.debug.toggle();
    });
  },

  bindShop() {
    $('btn-open').addEventListener('click', function () {
      if (Game.openShop()) {
        Engine.audio.pickup();
        UI.render();
      } else {
        UI.hint(Game.state.res.energy < CFG.shop.openCost ? '能量不足，无法开牌（需要 1 ⚡）' : '当前无法开牌');
        Engine.audio.hurt();
      }
    });

    $('shop-cards').addEventListener('click', function (e) {
      const card = e.target.closest('[data-shop]');
      if (!card) return;
      const i = parseInt(card.dataset.shop, 10);
      const key = Game.state.shop && Game.state.shop.cards[i];
      if (Game.buyCard(i)) {
        Engine.audio.click();
        if (key) {
          UI.hint('已买入「' + Game.cardInfo(key).name + '」→ 拖下方手牌到城市格建造');
        }
        UI.render();
      } else {
        const S = Game.state;
        const type = S.shop && S.shop.cards[i];
        if (!type) return;
        if (S.hand.indexOf(null) < 0) UI.hint('手牌已满，先弃牌或把牌打进城市区');
        else {
          /* ⚠️ 必须用 cardInfo，不能写死 CFG.buildings[type]：
           * 商店里除了建筑牌还有**道路牌 / 效果牌**，它们的 key 不在 CFG.buildings 里。
           * 旧版在"买不起一张道路/效果牌"时直接 `undefined.name` 抛异常，
           * 而异常会**杀掉当前点击处理器**——玩家的感受就是"点了没反应"（踩坑 #1 的典型形态）。
           * 第四十五次修订：由真人模拟测试（test/_humanplay.js 随机点商店卡）抓到。 */
          const info = Game.cardInfo(type);
          UI.hint('能量不足，买不起「' + ((info && info.name) || type) + '」（需 ' +
                  ((info && info.price) || 0) + ' ⚡）');
        }
        Engine.audio.hurt();
      }
    });
  },

  /* ==================== 拖拽（指针事件，鼠标/触摸通用） ==================== */

  bindDrag() {
    const self = this;

    $('hand-slots').addEventListener('pointerdown', function (e) {
      const card = e.target.closest('[data-hand]');
      if (!card) return;
      const handIdx = parseInt(card.dataset.hand, 10);
      const item = Game.state.hand[handIdx];
      if (!item) return;
      // 弃牌模式：点一下就弃掉
      if (self.discardMode) {
        e.preventDefault();
        const nm = Game.cardInfo(item.key).name;
        Game.discard(handIdx);
        Engine.audio.hurt();
        self.setDiscardMode(false);
        UI.hint('已弃掉「' + nm + '」（不返还资源）');
        return;
      }
      e.preventDefault();
      self.startDrag(handIdx, item.key, e.clientX, e.clientY);
    });

    global.addEventListener('pointermove', function (e) {
      if (!self.drag) return;
      e.preventDefault();
      self.moveDrag(e.clientX, e.clientY);
    });

    global.addEventListener('pointerup', function (e) {
      if (!self.drag) return;
      self.endDrag(e.clientX, e.clientY);
    });

    global.addEventListener('pointercancel', function () {
      if (self.drag) self.cancelDrag();
    });

    /* ---- 取消放置：Esc / 右键 / 点界面别处，三条路都要通 ----
     * ★ 第四十次修订：以前提示写"按 Esc 或点击其他区域取消"，实际只有 Esc 有效，
     *   点别处一动不动 —— 玩家被困在放置模式里出不来，就是用户报的"卡死"。 */
    self.cancelPlace = function (msg) {
      self.placeMode = null;                   // 卡从未离手，直接取消即可
      UI.hint(msg || '已取消放置');
      UI.render();
    };

    self.cancelRoadPlacing = function () {
      const rp = self.roadPlacing;
      if (!rp) return;
      const i = Game.state.hand.indexOf(null);
      if (i >= 0) Game.state.hand[i] = { key: rp.key };   // 道路牌已离手，取消要退回
      self.roadPlacing = null;
      UI.hint('已取消铺路，道路牌退回手牌');
      UI.render();
    };

    global.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (self.placeMode) { self.cancelPlace(); return; }
      self.cancelRoadPlacing();
    });

    // 右键取消
    global.addEventListener('contextmenu', function (e) {
      if (self.placeMode) { e.preventDefault(); self.cancelPlace(); return; }
      if (self.roadPlacing) { e.preventDefault(); self.cancelRoadPlacing(); }
    });

    // 点手牌栏/沙盘以外的任何地方 = 取消放置（沙盘点击交给 onTileClick 处理建造）
    global.addEventListener('pointerdown', function (e) {
      if (!self.placeMode) return;
      const t = e.target;
      if (t && t.closest && (t.closest('#sandbox') || t.closest('#hand-slots'))) return;
      self.cancelPlace();
    });

    // 弃牌奖励三选一：点击卡牌领取
    $('pane-reward').addEventListener('click', function (e) {
      const card = e.target.closest('.card');
      if (!card || card.dataset.reward === undefined) return;
      UI.pickReward(parseInt(card.dataset.reward, 10));
    });

    // §19 政策三选一：点击卡牌颁布；§20 事件牌：领取/刷新按钮
    $('pane-policy').addEventListener('click', function (e) {
      const act = e.target.closest('[data-action]');
      if (act) {
        if (act.dataset.action === 'event-claim') UI.claimEvent();
        else if (act.dataset.action === 'event-refresh') UI.refreshEvent();
        else if (act.dataset.action === 'event-dissolve') UI.dissolveEvent();
        else if (act.dataset.action === 'policy-refresh') UI.refreshPolicy();
        return;
      }
      const card = e.target.closest('.card');
      if (!card) return;
      if (card.dataset.policy !== undefined && UI.modal === 'policy') {
        UI.pickPolicy(parseInt(card.dataset.policy, 10));
      }
    });

    // 顶栏「政策」按钮：查看当前政策 / 有待选时打开三选一
    $('btn-policy').addEventListener('click', function () {
      if (Game.state.events.p1.offer) { UI.setModal('event'); return; }
      UI.setModal(Game.state.policy.p1.offer ? 'policy' : 'policyview');
    });

    // §20 顶栏事件 chip 点击 → 查看生效中的事件 / 支付化解
    $('policy-tray').addEventListener('click', function (e) {
      const chip = e.target.closest('[data-eventchip]');
      if (chip && Game.state.events.p1.current) UI.setModal('eventview');
    });

    // 弃牌区高亮
    const dz = $('discard-zone');
    dz.addEventListener('dragover', function (e) { e.preventDefault(); });
  },

  /** 领取任务奖励遗物（第二十次修订：遗物只能从星级任务获得） */
  pickReward(i) {
    const key = this.rewardChoices && this.rewardChoices[i];
    if (!key) return;
    if (!Game.pickQuestReward(key)) return;    // 校验 + 入账 + questStar++
    this.rewardChoices = null;
    this.setModal(null);
    Engine.audio.pickup();
    UI.hint('获得遗物「' + CFG.relics[key].name + '」');
    this.render();
  },

  /** §19 颁布第 i 条政策 */
  pickPolicy(i) {
    const P = Game.state.policy.p1;
    const o = P.offer && P.offer[i];
    if (!o) return;
    const r = Game.chooseOffer(i);
    const d = CFG.policy.list[o.key];
    UI.hint((r === 'upgrade' ? '政策升级「' : '颁布政策「') + d.name + '·' +
            CFG.policy.tierNames[o.tier] + '」');
    Engine.audio.win();
    this.setModal(null);
    this.render();
  },

  /** §19 政策弹窗内容：待选三选一 / 或查看已颁布 */
  renderPolicyPane() {
    const host = $('policy-cards');
    const hint = $('policy-hint');
    host.innerHTML = '';
    const P = Game.state.policy.p1;
    const self = this;
    // 注意：用 createElement + innerHTML 构建（无头交互测试的假 DOM 不支持 insertAdjacentHTML）
    const makeCard = function (k, tier, pickable, idx) {
      const d = CFG.policy.list[k];
      const e0 = d.effects[0];
      // flag 型效果（机制改写，如「野战行军」）没有 vals 数值档，直接用整句 desc
      const desc = e0.kind === 'flag' ? d.desc
        : d.desc.replace('{v}', String(Math.abs(e0.vals[tier])));
      const school = CFG.policy.schools[d.school];
      const el = document.createElement('div');
      el.className = 'card card-relic' + (pickable ? '' : ' card-dim');
      if (pickable) el.dataset.policy = String(idx);
      el.innerHTML =
        '<div class="card-icon">' + d.icon + '</div>' +
        '<div class="card-main"><div class="card-name">' + d.name +
        ' <span class="tier tier-' + tier + '">' + CFG.policy.tierIcons[tier] +
        CFG.policy.tierNames[tier] + '</span></div>' +
        '<div class="card-cost card-kind">' + school.icon + ' ' + school.name + '流</div>' +
        '<div class="card-desc">' + desc + '</div></div>';
      return el;
    };

    if (P.offer) {
      P.offer.forEach(function (o, i) {
        host.appendChild(makeCard(o.key, o.tier, true, i));
      });
      const full = P.slots.length >= CFG.policy.slotCap;
      const left = CFG.policy.refreshCap - P.refreshes;
      hint.innerHTML = (full
        ? '政策槽已满（' + CFG.policy.slotCap + '）：选择新政策会替换最早颁布的「' +
          CFG.policy.list[P.slots[0].key].name + '」'
        : '颁布后占 1 个政策槽（' + P.slots.length + '/' + CFG.policy.slotCap + '）· 选到已有政策会升级品质') +
        '　' + (left > 0
          ? '<button class="bh-btn" data-action="policy-refresh">🔄 刷新 · ' +
            CFG.policy.refreshCost + '⚡（剩 ' + left + ' 次 · 现有 ' +
            Math.floor(Game.state.res.energy) + '⚡）</button>'
          : '<span class="muted small">本局刷新已用尽（' + CFG.policy.refreshCap + ' 次）</span>');
      return;
    }
    if (!P.slots.length) hint.textContent = '尚未颁布任何政策';
    P.slots.forEach(function (s) { host.appendChild(makeCard(s.key, s.tier, false)); });
    hint.textContent = '当前流派：' + CFG.policy.schools[P.school].name +
      '流 · 政策只在开局与主城升级时提供';
  },

  /** §20 事件牌面板：单张 + 领取/刷新（必须领取才能关） */
  renderEventPane() {
    const host = $('policy-cards');
    const hint = $('policy-hint');
    host.innerHTML = '';
    const E = Game.state.events.p1;
    if (!E.offer) { hint.textContent = ''; return; }
    const d = CFG.events.list[E.offer];
    const el = document.createElement('div');
    el.className = 'card card-relic card-event';
    el.innerHTML =
      '<div class="card-icon">' + d.icon + '</div>' +
      '<div class="card-main"><div class="card-name">' + d.name +
      '<span class="tier tier-bad">' + (d.kind === 'bad' ? '灾祸' : '抉择') + '</span></div>' +
      '<div class="card-desc">' + d.desc + '</div></div>';
    host.appendChild(el);
    const left = CFG.events.refreshCap - E.refreshes;
    hint.innerHTML =
      '<button class="btn btn-primary" data-action="event-claim">✔ 领取生效</button>' +
      (E.refreshes >= CFG.events.refreshCap
        ? ' <span class="muted small">刷新已用尽（' + E.refreshes + '/' + CFG.events.refreshCap + '）</span>'
        : ' <button class="bh-btn" data-action="event-refresh">🔄 刷新 · ' +
          CFG.events.refreshCost + '⚡（剩 ' + left + ' 次 · 现有 ' +
          Math.floor(Game.state.res.energy) + '⚡）</button>');
  },

  /** §19 政策三选一刷新（≤refreshCap 次，每次花能量）——此前只绑了按钮没定义函数，一点就 TypeError 卡死 */
  refreshPolicy() {
    if (!Game.refreshPolicy('p1')) {
      UI.hint('刷新失败：能量不足或次数用尽（' + CFG.policy.refreshCost + '⚡/次）');
      Engine.audio.hurt();
      return;
    }
    Engine.audio.pickup();
    this.renderPolicyPane();
    this.render();
  },

  /** §20 领取当前事件牌 */
  claimEvent() {
    if (!Game.claimEvent('p1')) return;
    Engine.audio.win();
    this.setModal(null);
    this.render();
  },

  /** §23 支付资源化解当前事件 */
  dissolveEvent() {
    if (!Game.payDissolve('p1')) {
      UI.hint('化解失败：资源不足');
      Engine.audio.hurt();
      return;
    }
    Engine.audio.win();
    this.setModal(null);
    this.render();
  },

  /** §20 刷新当前事件牌（≤5 次，每次花能量）——必须重绘事件面板；
   *  此前误调 renderPolicyPane()，刷新后事件卡和领取按钮被政策内容顶掉，
   *  而事件弹窗"必须领取才能关" → 玩家被永久困在弹窗里（实机卡死元凶之二） */
  refreshEvent() {
    if (!Game.refreshEvent('p1')) { UI.hint('刷新失败：能量不足或次数用尽'); Engine.audio.hurt(); return; }
    Engine.audio.pickup();
    this.renderEventPane();
    this.render();
  },

  /** §21 星级任务面板 */
  renderQuestPane() {
    const host = $('quest-list');
    if (!host) return;
    host.innerHTML = '';
    const S = Game.state;
    const self = this;
    CFG.quests.stars.forEach(function (star, si) {
      const done = si < S.questStar;
      const active = si === S.questStar;
      const box = document.createElement('div');
      box.className = 'quest-star' + (done ? ' quest-done' : (active ? ' quest-active' : ' quest-locked'));
      const title = document.createElement('div');
      title.className = 'quest-star-title';
      title.textContent = '⭐'.repeat(si + 1) + (done ? ' 已完成' : (active ? ' 进行中' : ' 未解锁'));
      box.appendChild(title);
      star.forEach(function (q) {
        const cur = self.questValueSafe(q.stat);
        const row = document.createElement('div');
        row.className = 'quest-row' + (cur >= q.need ? ' quest-ok' : '');
        row.innerHTML = '<span>' + (cur >= q.need ? '✔' : '·') + ' ' + q.name + '</span>' +
                        '<b>' + Math.min(cur, q.need) + ' / ' + q.need + '</b>';
        box.appendChild(row);
      });
      host.appendChild(box);
    });
    const foot = document.createElement('div');
    foot.className = 'muted small';
    foot.textContent = '结算加分：完成星数 × ' + CFG.quests.scorePerStar +
                       '（当前 +' + (S.questStar * CFG.quests.scorePerStar) + ' 分）';
    host.appendChild(foot);
  },

  /** 任务指标当前值（转发 game，测试环境兜底） */
  questValueSafe(stat) { return Game.questValue(stat); },

  /** §20 查看生效中的事件 + 支付化解（第二十三次修订：弃牌化解 → 资源支付） */
  renderEventViewPane() {
    const host = $('policy-cards');
    const hint = $('policy-hint');
    host.innerHTML = '';
    const S = Game.state;
    const E = S.events.p1;
    if (!E.current) { hint.textContent = '当前没有生效中的事件'; return; }
    const d = CFG.events.list[E.current];
    const el = document.createElement('div');
    el.className = 'card card-relic card-event';
    el.innerHTML = '<div class="card-icon">' + d.icon + '</div>' +
      '<div class="card-main"><div class="card-name">' + d.name +
      '<span class="tier tier-bad">生效中</span></div>' +
      '<div class="card-desc">' + d.desc + '</div></div>';
    host.appendChild(el);
    if (!d.cost) { hint.textContent = '该事件没有化解手段，等它被下一张顶掉'; return; }
    const ok = S.res.energy >= d.cost.energy && S.res.food >= d.cost.food;
    hint.innerHTML = '<button class="btn ' + (ok ? 'btn-primary' : '') + '" data-action="event-dissolve"' +
      (ok ? '' : ' style="opacity:.45;cursor:not-allowed"') + '>' +
      '支付 ' + d.cost.energy + '⚡+' + d.cost.food + '🌾 立即化解' +
      '（现有 ' + Math.floor(S.res.energy) + '⚡ / ' + Math.floor(S.res.food) + '🌾）</button>';
  },

  startDrag(handIdx, key, x, y) {
    this.tileSel = null;                          // 点击任何区域 → 收起操作条
    this.placeMode = null;                        // 拖卡会取消放置模式（卡仍在手牌，不会丢）
    const info = Game.cardInfo(key);
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost' + (info.kind === 'effect' ? ' ghost-effect' : '');
    const costLine = (info.kind === 'building')
      ? '<div class="card-cost">松手后点击地图放置（也支持直接拖到格子）</div>'
      : (info.kind === 'road' ? '<div class="card-cost">松手进入铺路模式</div>'
      : (info.kind === 'upgrade' ? '<div class="card-cost">拖到己方建筑升级</div>'
      : '<div class="card-cost">松手即使用</div>'));
    ghost.innerHTML = '<div class="card-icon">' + info.icon + '</div>' +
                      '<div class="card-name">' + info.name + '</div>' +
                      '<div class="card-price">' + info.price + ' ⚡</div>' +
                      costLine;
    document.body.appendChild(ghost);

    this.drag = {
      handIdx: handIdx, key: key, kind: info.kind,
      ghost: ghost, startX: x, startY: y,
    };
    // 拖拽时手牌栏右侧浮出弃牌目标（平时不占空间，把整条让给手牌）
    const bar = $('hand-bar');
    if (bar) bar.classList.add('dragging-now');
    this.moveDrag(x, y);

    const src = document.querySelector('[data-hand="' + handIdx + '"]');
    if (src) src.classList.add('dragging');
  },

  moveDrag(x, y) {
    const g = this.drag.ghost;
    g.style.left = x + 'px';
    g.style.top = y + 'px';

    // 高亮落点：交给沙盘在地图上整体绘制（Sandbox.drawDropPreview）
    const hit = this.hitTest(x, y);
    const dz = $('discard-zone');
    dz.classList.toggle('dz-hover', !!(hit && hit.zone === 'discard'));

    if (this.drag && this.drag.kind === 'building') {
      // 拿起建筑卡 = 建造模式（网格增强）；光标在地图上就显示占地幽灵框（合法与否都画，非法标红）
      const t = this.mapTileAt(x, y);
      Sandbox.dropPreview = t
        ? { handIdx: this.drag.handIdx, key: this.drag.key, gx: t.gx, gy: t.gy }
        : { handIdx: this.drag.handIdx, key: this.drag.key };
    }
  },

  /** 页面坐标 → 地图格（不判定合法性；建造模式的跟随预览用） */
  mapTileAt(x, y) {
    const cv = $('sandbox');
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const k = r.width / (cv.offsetWidth || r.width);
    return Sandbox.pickTile((x - r.left) / k, (y - r.top) / k);
  },

  /** 拖拽落点判定：弃牌区 / 地图格（建筑牌·升级牌） */
  hitTest(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest('#discard-zone')) return { zone: 'discard' };
    if (!this.drag) return null;
    const dragInfo = Game.cardInfo(this.drag.key);
    const dragRepair = this.drag.kind === 'effect' && dragInfo.eff === 'repair';
    if (this.drag.kind !== 'building' && this.drag.kind !== 'upgrade' && !dragRepair) return null;

    const cv = $('sandbox');
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const k = r.width / (cv.offsetWidth || r.width);
    const t = Sandbox.pickTile((x - r.left) / k, (y - r.top) / k);
    if (!t) return null;

    if (this.drag.kind === 'upgrade') {
      const b = Game.buildingAt(t.gx, t.gy);
      const okTile = !!b && (b.owner || 'p1') === 'p1';
      return { zone: 'tile', gx: t.gx, gy: t.gy, upgradeOk: okTile };
    }
    if (dragRepair) {
      const okTile = Game.isCastleAt(t.gx, t.gy) ||
        (function () { const b = Game.buildingAt(t.gx, t.gy); return !!b && (b.owner || 'p1') === 'p1'; })();
      return { zone: 'tile', gx: t.gx, gy: t.gy, repairOk: okTile };
    }

    const merge = Game.canMerge(this.drag.handIdx, t.gx, t.gy);
    const emptyOk = Game.canBuildAt(this.drag.key, t.gx, t.gy);
    if (!merge && !emptyOk) return null;
    return { zone: 'tile', gx: t.gx, gy: t.gy, merge: merge };
  },

  endDrag(x, y) {
    const d = this.drag;
    if (!d) return;
    const moved = Math.sqrt((x - d.startX) * (x - d.startX) + (y - d.startY) * (y - d.startY));
    const hit = this.hitTest(x, y);
    const handIdx = d.handIdx;
    let ok = false;

    if (d.kind === 'effect') {
      // 效果牌：拖到弃牌区 = 弃掉；原地松手（位移很小）= 使用；修缮牌可拖到建筑
      if (hit && hit.zone === 'discard') {
        ok = Game.discard(handIdx);
        if (ok) UI.hint('已弃牌（不返还资源）');
      } else if (d.key === 'repair' && hit && hit.zone === 'tile' && hit.repairOk) {
        const r = Game.repairWithCard(hit.gx, hit.gy);
        ok = r.ok;
        if (ok) UI.hint('修缮完成，防御值 +40');
        else UI.hint(r.reason === 'full' ? '防御值已满，不用修' : '手牌里没有修缮牌');
      } else if (moved < 12) {
        ok = Game.playEffect(handIdx);
        if (!ok) UI.hint('这张效果牌当前用不了（「扩建」每局最多 ' + CFG.cards.slotCap + ' 次）');
      }
    } else if (d.kind === 'road') {
      // 道路牌：拖到弃牌区 = 弃掉；原地松手 = 进入铺路模式（点击地图逐格铺）
      if (hit && hit.zone === 'discard') {
        ok = Game.discard(handIdx);
        if (ok) UI.hint('已弃牌');
      } else if (moved < 12) {
        const info = Game.cardInfo(d.key);
        this.roadPlacing = { key: d.key, handIdx: handIdx, left: info.tiles };
        Game.state.hand[handIdx] = null;      // 牌离手（取消时退还）
        this.roadPlacing.card = { handIdx: handIdx, key: d.key };
        UI.hint('铺路模式：点击地图铺路，共 ' + info.tiles + ' 格（再点这张牌位置或按 Esc 取消）');
        ok = true;
      }
    } else if (d.kind === 'upgrade') {
      // 升级牌：拖到己方建筑上 = 升级
      if (hit && hit.zone === 'tile' && hit.upgradeOk) {
        const r = Game.upgradeWithCard(hit.gx, hit.gy);
        ok = r.ok;
        if (!ok) UI.hint(r.reason === 'nocard' ? '手牌里没有升级牌' : '无法升级');
        else UI.hint('升级成功');
      } else if (hit && hit.zone === 'discard') {
        ok = Game.discard(handIdx);
        if (ok) UI.hint('已弃牌（不返还资源）');
      } else if (moved < 12) {
        UI.hint('把升级牌拖到己方建筑上使用');
      }
    } else if (hit && hit.zone === 'discard') {
      ok = Game.discard(handIdx);
      if (ok) UI.hint('已弃牌（不返还资源）');
    } else if (hit && hit.zone === 'tile') {
      ok = hit.merge
        ? Game.merge(handIdx, hit.gx, hit.gy)
        : Game.build(handIdx, hit.gx, hit.gy);
    } else if (moved < 12) {
      // 与道路牌一致的放置方式：点击卡牌 → 高亮可建格 → 点击地图放置
      // 卡保留在手牌（build 从手牌取卡消耗；失败/取消都不会丢卡）
      // ★ 第四十次修订：先确认"这张卡现在真的放得下"。主城 Lv1 拿防御塔这类情况
      //   全图 0 格可建，以前照样进模式 → 玩家点哪都只报错还退不出（用户报的"卡死"）。
      //   现在放不下就直接说原因（"防御塔 需要主城 Lv2 才能建造"），不进模式。
      const why = Game.buildBlockGlobal(d.key);
      if (why) {
        UI.hint(why);
      } else {
        this.roadPlacing = null;
        this.tileSel = null;
        this.placeMode = { key: d.key, handIdx: handIdx };
        UI.hint('放置模式：点击地图空地建造（Esc / 右键 / 点其他地方取消）');
        ok = true;
      }
    } else if (hit && hit.zone === 'tile') {
      // 拖到地图格但建造失败（保留拖拽放置路径的错误提示）
      UI.hint(Game.buildBlockReason(d.key, hit.gx, hit.gy) || '建造失败');
    }

    if (ok) Engine.audio.pickup(); else if (hit) Engine.audio.hurt();
    this.cancelDrag();
    UI.render();
  },

  cancelDrag() {
    Sandbox.dropPreview = null;
    if (!this.drag) return;
    this.drag.ghost.remove();
    document.querySelectorAll('.dragging').forEach(function (el) { el.classList.remove('dragging'); });
    $('discard-zone').classList.remove('dz-hover');
    const bar = $('hand-bar');
    if (bar) bar.classList.remove('dragging-now');
    this.drag = null;
  },

  /* ==================== 轻量刷新（约 8Hz，只动会跳动的数字） ==================== */

  refresh() {
    const S = Game.state;
    if (!S) return;

    $('clock').textContent = fmtTime(Game.elapsed());          // 正计时（兜底时限见 tickinfo）
    $('tickinfo').textContent = fmtTickLine(S);

    ['energy', 'food'].forEach(function (k) {
      $('res-' + k).textContent = Math.floor(S.res[k]);
    });

    $('tag-slots').textContent = '建筑 ' + Game.buildingsUsed() +
      ' · 每种上限 ' + Game.typeCap('farm');
    $('tag-soldiers').textContent = '士兵 ' + Game.totalTroops('p1') + ' / ' + Game.maxTroops('p1');
    $('tag-castle').textContent = '主城 Lv' + S.castleLevel +
      (S.boost ? '　产出×' + S.boost.mul + '（' + S.boost.ticksLeft + '）' : '');
    $('btn-pause').textContent = S.over ? '已结束' : (S.paused ? '继续' : '暂停');

    // 开牌按钮的可用性会随能量变化
    const canOpen = Game.canOpen();
    const btn = $('btn-open');
    if (btn.disabled === canOpen) btn.disabled = !canOpen;

    UI.updateCorner();
  },

  /* ==================== 渲染 ==================== */

  hint(msg) {
    const el = $('hint');
    el.textContent = msg;
    el.classList.add('hint-flash');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(function () {
      el.classList.remove('hint-flash');
      el.textContent = '拖动手牌里的建筑卡到城市空格即可建造';
    }, 2600);
  },

  render() {
    const S = Game.state;
    if (!S) return;

    /* ---- 顶栏 ---- */
    $('clock').textContent = fmtTime(Game.elapsed());          // 正计时（兜底时限见 tickinfo）
    $('tickinfo').textContent = fmtTickLine(S);

    ['energy', 'food'].forEach(function (k) {
      $('res-' + k).textContent = Math.floor(S.res[k]);
    });

    $('tag-slots').textContent = '建筑 ' + Game.buildingsUsed() +
      ' · 每种上限 ' + Game.typeCap('farm');
    $('tag-soldiers').textContent = '士兵 ' + Game.totalTroops('p1') + ' / ' + Game.maxTroops('p1');
    $('tag-castle').textContent = '主城 Lv' + S.castleLevel +
      (S.boost ? '　产出×' + S.boost.mul + '（' + S.boost.ticksLeft + '）' : '');

    $('btn-pause').textContent = S.over ? '已结束' : (S.paused ? '继续' : '暂停');
    $('slot-count').textContent = Game.buildingsUsed();
    $('slot-max').textContent = Game.typeCap('farm') * 5;
    /* 道路额度（第四十六次修订）：铺满就得拆旧路，必须让玩家看得见 */
    const rc = Game.roadCountOf('p1'), rcap = CFG.map.roadCapPerSide || 0;
    $('road-count').textContent = rc;
    $('road-cap').textContent = rcap;
    /* ★ 第四十七次修订（经济约束）：把「下一格多少钱」摆在脸上 —— 单价随已铺格数递增 */
    const rnext = $('road-price');
    if (rnext) rnext.textContent = Game.roadUnitPrice('p1') + '⚡/格';
    const rb = $('road-budget');
    if (rb) rb.style.color = (rcap && rc >= rcap) ? '#ff9b3d' : '';

    /* ---- 格子操作条 ---- */
    UI.renderTileActions();

    /* ---- 操作条跟随建筑 ---- */
    if (this.tileSel && typeof Sandbox.tileToUI === 'function') {
      const p2 = Sandbox.tileToUI(this.tileSel.gx, this.tileSel.gy);
      const bar2 = $('tile-actions');
      if (bar2 && !bar2.classList.contains('hidden')) {
        bar2.style.left = Math.max(150, Math.min(p2.x, 1120)) + 'px';
        bar2.style.top = Math.max(58, p2.y - 64) + 'px';
        bar2.style.transform = 'translateX(-50%)';
      }
    }

    /* ---- §21 任务奖励三选一（优先级最高） ----
     * ⚠️ 主界面（#menu）打开时不弹任何对局内弹窗：菜单是最外层界面，
     *    它的 z-index 虽高于 #modal，但弹窗漏在旁边依然难看（第四十二次修订）。
     *    只"不弹"不"清数据"——点「继续游戏」时下一帧会自然重开。 */
    const menuOpen = !!(global.Menu && global.Menu.open);
    if (menuOpen) {
      if (this.modal) this.setModal(null);
    } else {
      if (S.questClaiming && this.modal !== 'reward') this.setModal('reward');

      /* ---- §20 事件牌（必须领取，优先级次之，会顶掉政策三选一） ---- */
      if (S.events && S.events.p1.offer && !S.questClaiming && this.modal !== 'event') {
        this.setModal('event');
      }

      /* ---- §19 政策三选一（有 offer 就弹，优先级最低） ---- */
      if (S.policy && S.policy.p1.offer && !S.questClaiming && !(S.events && S.events.p1.offer) && !this.modal) {
        this.setModal('policy');
      }
    }

    /* ---- §19 顶栏政策托盘 + §20 当前生效事件 ---- */
    {
      const tray = $('policy-tray');
      if (tray && S.policy) {
        tray.innerHTML = '';
        S.policy.p1.slots.forEach(function (s) {
          const d = CFG.policy.list[s.key];
          if (!d) return;
          const chip = document.createElement('div');
          chip.className = 'policy-chip tier-' + s.tier;
          chip.textContent = d.icon;
          const e0 = d.effects[0];
          // flag 型效果（如「野战行军」「屯田戍边」）没有 vals 数值档，直接用整句 desc
          const val = e0.kind === 'flag' ? null : Math.abs(e0.vals[s.tier]);
          chip.title = d.name + '·' + CFG.policy.tierNames[s.tier] + '：' +
                       (e0.kind === 'flag' ? d.desc : d.desc.replace('{v}', String(val)));
          tray.appendChild(chip);
        });
        for (let i = S.policy.p1.slots.length; i < CFG.policy.slotCap; i++) {
          const empty = document.createElement('div');
          empty.className = 'policy-chip policy-empty';
          empty.textContent = '·';
          tray.appendChild(empty);
        }
        // 当前生效的事件牌（单张轮换；点击可查看/化解）
        const ev = Game.activeEvent('p1');
        if (ev) {
          const chip = document.createElement('div');
          chip.className = 'policy-chip tier-bad';
          chip.textContent = ev.icon;
          chip.dataset.eventchip = '1';
          chip.title = '事件「' + ev.name + '」生效中：' + ev.desc +
            (ev.cost ? '　（点击可支付资源化解）' : '');
          tray.appendChild(chip);
        }
      }
      // §20 事件预警条：进度填充 + 临期 30s 转红显示秒数（卡牌城镇式可视化预期）
      {
        const meter = $('event-meter');
        if (meter && S.events) {
          const p = Game.eventProgress();
          const fill = $('event-bar-fill');
          const label = $('event-bar-label');
          const waiting = !!S.events.p1.offer;      // 已有事件待领取：进度停住
          if (fill) fill.style.width = Math.round(p.pct * 100) + '%';
          if (label) label.textContent = waiting ? '!' : (p.imminent ? p.remain + 's' : '?');
          meter.classList.toggle('event-soon', p.imminent && !waiting);
          meter.title = waiting ? '事件牌待领取'
            : (p.imminent ? '事件牌 ' + p.remain + ' 秒后触发！可先留好刷新能量'
                          : '下一张事件牌还有 ' + p.remain + ' 秒');
        }
      }
      // 任务角标（第二十二次修订：临门提示——当前星差 1 项完成时闪烁）
      const qb = $('quest-star');
      if (qb) {
        qb.textContent = '★' + (S.questStar || 0) + '/3';
        let near = false;
        if (!S.questClaiming && S.questStar < CFG.quests.stars.length) {
          const star = CFG.quests.stars[S.questStar];
          const done = star.filter(function (q) { return Game.questValue(q.stat) >= q.need; }).length;
          near = done === star.length - 1;
        }
        qb.classList.toggle('quest-near', near);
        qb.title = near ? '当前星还差 1 项完成！' : '星级任务进度';
      }
    }

    /* ---- 遗物托盘（横放，悬停查看效果） ---- */
    {
      const tray = $('relic-tray');
      if (tray) {
        tray.innerHTML = '';
        const cnt = {};
        S.relics.forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; });
        Object.keys(cnt).forEach(function (k) {
          const rc = CFG.relics[k];
          if (!rc) return;
          const chip = document.createElement('div');
          chip.className = 'relic-chip';
          chip.textContent = rc.icon;
          chip.title = rc.name + (cnt[k] > 1 ? ' ×' + cnt[k] : '') + '：' + rc.desc;
          tray.appendChild(chip);
          if (cnt[k] > 1) {
            const badge = document.createElement('div');
            badge.className = 'relic-badge';
            badge.textContent = '×' + cnt[k];
            chip.appendChild(badge);
          }
        });
      }
    }

    /* ---- 弃牌角标：显示任务进度口径的弃牌数 ---- */
    {
      const dz2 = $('discard-zone');
      if (dz2) dz2.innerHTML = '<span>🗑️</span>弃牌 ' + S.discardCount;
    }

    /* ---- 胜负结算（第四十四次修订：加演出）
     * 先让沙盘把「主城爆炸」演完，再拉幕出结算卡；卡片本身分 5 段登场（见 CSS 的 wb-result-*）。 */
    const ro = $('result-overlay');
    if (S.result) {
      if (!UI._resultShown) {
        UI._resultShown = true;
        const delay = (CFG.ui && CFG.ui.resultDelay) || 0;
        const reveal = function () {
          if (!Game.state || !Game.state.result) return;   // 期间已重开
          ro.classList.remove('hidden');
          ro.classList.add('result-in');
        };
        if (delay > 0) setTimeout(reveal, delay); else reveal();
      }
      const win = S.result === 'win';
      const draw = S.result === 'draw';
      $('result-icon').textContent = draw ? '⏱' : (win ? '🏆' : '💀');
      $('result-title').textContent = draw ? '平 局' : (win ? '胜 利' : '战 败');
      $('result-title').style.color = draw ? '#ffd166' : (win ? '#7ed957' : '#ff6b6b');
      let sub = draw ? '30 分钟到时 · 综合分持平'
        : (win ? '敌方主城被摧毁 · 用时 ' : '我方主城被摧毁 · 坚持了 ') + Math.floor(S.t) + ' 秒';
      if (S.score) {
        const b = S.score;
        sub += '<br><span class="small">A 主城战果 ' + b.A + ' ×1　B 资源点 ' + b.B +
               ' ×3　C 战场成果 ' + b.C + ' ×1　D 发展水平 ' + b.D + ' ×1　E 星级任务 +' + b.E +
               '　=　<b>' + b.total + '</b></span>';
      }
      $('result-sub').innerHTML = sub;
    } else {
      UI._resultShown = false;
      ro.classList.add('hidden');
      ro.classList.remove('result-in');
    }

    /* ---- 开牌区 ---- */
    const shopHost = $('shop-cards');
    shopHost.innerHTML = '';
    const cards = S.shop ? S.shop.cards : [null, null, null, null, null];
    cards.forEach(function (type, i) {
      shopHost.appendChild(UI.makeCard(type, 'shop', i, true));
    });

    const canOpen = Game.canOpen();
    const cost = Game.openCostNow();
    $('btn-open').disabled = !canOpen;
    $('btn-open').textContent = (S.shop ? '抽取 · ' : '开牌 · ') + cost + ' ⚡';
    $('shop-cur-cost').textContent = '本次开牌 ' + cost + ' ⚡（已抽取 ' + S.rerolls + ' 次）';
    if (!S.shop) $('shop-hint').textContent = '开局先开一次牌，从 5 张里挑便宜的买';
    else if (S.res.energy < CFG.shop.openCost) $('shop-hint').textContent = '能量不足，无法抽取';
    else $('shop-hint').textContent = '点击候选卡按标价买入 · 买完把手牌拖到地图空地上建造';

    /* ---- 手牌（格数可变，扇形微倾 + 密度分级） ---- */
    const handHost = $('hand-slots');
    handHost.innerHTML = '';
    const n = S.hand.length;
    // 密度分级：卡越窄，显示的信息越少（避免文字竖排挤爆）
    const dens = n <= 6 ? 1 : (n === 7 ? 2 : 3);
    handHost.classList.remove('dens-1', 'dens-2', 'dens-3');
    handHost.classList.add('dens-' + dens);
    const step = n > 1 ? Math.min(2, 10 / (n - 1)) : 0;    // 扇形总跨度约 ±5°，牌多也不叠
    S.hand.forEach(function (item, i) {
      const el = UI.makeCard(item ? item.key : null, 'hand', i, false);
      const tilt = (i - (n - 1) / 2) * step;
      el.style.setProperty('--tilt', tilt.toFixed(2) + 'deg');
      handHost.appendChild(el);
    });

    /* ---- 右下角功能角标 ---- */
    UI.updateCorner();
  },

  updateCorner() {
    const S = Game.state;
    if (!S) return;
    const handUsed = S.hand.filter(Boolean).length;

    $('pool-count').textContent = Game.availableCards().length;
    $('shop-cost').textContent = Game.openCostNow() + '⚡';
    const hc = $('hand-count');
    if (hc) hc.textContent = handUsed + ' / ' + Game.handSize();

    // 牌库面板：列出当前能抽到的所有卡
    const poolHost = $('pool-cards');
    if (poolHost && UI.modal === 'pool') {
      poolHost.innerHTML = '';
      Game.availableCards().forEach(function (key) {
        poolHost.appendChild(UI.makeCard(key, 'pool', -1, false));
      });
    }

    // 开局还没开过牌 → 抽卡按钮轻微提示
    const shopBtn = document.querySelector('#corner-ui .corner-btn[data-modal="shop"]');
    if (shopBtn) shopBtn.classList.toggle('pulse', S.stats.opened === 0);
  },

  /** 选中己方建筑/主城时，在右下角上方显示操作条 */
  renderTileActions() {
    const bar = $('tile-actions');
    const t = this.tileSel;
    const S = Game.state;

    if (!t) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('ta-demolish').classList.remove('hidden');

    /* 道路选中：只能拆（第四十六次修订）。拆掉会释放 1 格道路额度。 */
    if (t.isRoad) {
      $('ta-upgrade').classList.add('hidden');
      $('ta-demolish').classList.remove('hidden');
      $('ta-demolish').textContent = '拆除道路（释放 1 格额度）';
      $('ta-title').textContent = '🛤️ 我方道路　额度 ' + Game.roadCountOf('p1') + '/' +
        (CFG.map.roadCapPerSide || '-') + '　(' + t.gx + ',' + t.gy + ')';
      return;
    }
    $('ta-upgrade').classList.remove('hidden');

    if (t.isCastle) {
      const cost = Game.castleUpgradeCost();
      $('ta-title').textContent = '🏰 主城 Lv' + S.castleLevel + ' · 防御 ' + Game.castleHp() +
        ' · 每种建筑上限 ' + Game.typeCap('farm');
      $('ta-upgrade').textContent = cost ? ('升级 ' + cost.energy + ' ⚡') : '已满级';
      $('ta-upgrade').disabled = !cost || !Game.canUpgradeCastle();
      $('ta-demolish').classList.add('hidden');
      return;
    }

    const b = Game.buildingAt(t.gx, t.gy);
    if (!b) { bar.classList.add('hidden'); return; }
    const d = CFG.buildings[b.type];
    let sub = '';
    if (b.type === 'barracks') {
      const tr = d.train[b.level - 1];
      sub = '　' + Math.round(tr.interval * Game.barracksIntervalMul(t.gx, t.gy) * 10) / 10 + 's/' + tr.count + '兵';
    } else if (b.type === 'atelier') {
      sub = '　每 ' + d.levels[b.level - 1].cardEvery + 's 产 1 卡';
    } else {
      const y = d.levels[b.level - 1].yield;
      sub = '　' + Object.keys(y).map(function (k) { return '+' + y[k] + RES_META[k].icon; }).join(' ');
    }
    $('ta-title').textContent = d.icon + ' ' + d.name + ' Lv' + b.level + sub + '　(' + t.gx + ',' + t.gy + ')';

    const blocked = Game.upgradeBlockedByCastle(b);
    const hasCard = Game.hasUpgradeCard();
    $('ta-upgrade').textContent = blocked ? ('需主城 Lv' + (b.level + 1))
                       : (hasCard ? '用升级牌升到 Lv' + (b.level + 1) : '升级（需升级牌）');
    $('ta-upgrade').disabled = blocked || !hasCard;
    $('ta-demolish').textContent = '拆除（免费）';
  },

  makeCard(key, zone, index, isShop) {
    const wrap = document.createElement('div');
    if (!key) {
      wrap.className = 'card card-empty';
      wrap.innerHTML = '<div class="card-empty-text">' + (isShop ? '−' : '空') + '</div>';
      return wrap;
    }

    const info = Game.cardInfo(key);
    if (!info) { wrap.className = 'card card-empty'; return wrap; }
    const S = Game.state;

    let state = 'ok';
    if (isShop) {
      if (!Game.canBuy(index)) {
        state = (S.hand.indexOf(null) < 0) ? 'full' : (S.res.energy < info.price ? 'poor' : 'no');
      }
      wrap.dataset.shop = index;
    } else if (zone === 'hand') {
      wrap.dataset.hand = index;
    }

    wrap.className = 'card card-' + state +
                     (isShop ? ' card-shop' : (zone === 'pool' ? ' card-pool' : ' card-hand')) +
                     (info.kind === 'effect' ? ' card-effect' : '');

    const kindLabel = { building: '建筑牌', road: '道路牌', upgrade: '升级牌', effect: '效果牌' }[info.kind];
    const costLine = (info.kind === 'building')
      ? '<div class="card-cost card-kind">建筑牌</div>'
      : (info.kind === 'road' ? '<div class="card-cost card-kind">道路牌 · ' + info.tiles + ' 格</div>'
      : '<div class="card-cost card-kind">' + kindLabel + '</div>');

    wrap.innerHTML =
      '<div class="card-icon">' + info.icon + '</div>' +
      '<div class="card-main">' +
        '<div class="card-name">' + info.name + '</div>' +
        costLine +
        '<div class="card-desc">' + (info.desc || '') + '</div>' +
      '</div>' +
      '<div class="card-price">' + info.price + ' ⚡</div>' +
      (info.kind === 'effect' && !isShop ? '<div class="card-tag">点击使用</div>' : '');
    return wrap;
  },
};

global.UI = UI;
})(window);
