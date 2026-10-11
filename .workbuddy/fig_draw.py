# -*- coding: utf-8 -*-
"""生成策划案插图：①核心循环图 ②铺路合法性判定流程图（办公蓝）"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon, FancyArrowPatch
plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei']
plt.rcParams['axes.unicode_minus'] = False

BLUE, BLUE_D, BLUE_L, TXT = '#2F5496', '#1F3864', '#DCE6F1', '#333333'
GREY, GOLD, RED, RED_L = '#8A8A8A', '#BF8F00', '#C00000', '#FBEAEA'

def box(ax, x, y, w, h, text, fc=BLUE_L, ec=BLUE, tc=BLUE_D, fs=13, bold=False, lw=1.6):
    ax.add_patch(FancyBboxPatch((x - w/2, y - h/2), w, h,
                 boxstyle='round,pad=0.4,rounding_size=1.2',
                 fc=fc, ec=ec, lw=lw, zorder=3))
    ax.text(x, y, text, ha='center', va='center', fontsize=fs, color=tc,
            fontweight='bold' if bold else 'normal', zorder=4, linespacing=1.35)

def diamond(ax, x, y, w, h, text, fs=12):
    ax.add_patch(Polygon([(x - w/2, y), (x, y + h/2), (x + w/2, y), (x, y - h/2)],
                 closed=True, fc=BLUE_L, ec=BLUE, lw=1.6, zorder=3))
    ax.text(x, y, text, ha='center', va='center', fontsize=fs, color=BLUE_D, zorder=4, linespacing=1.3)

def arrow(ax, x0, y0, x1, y1, label='', color=GREY, ls='-', lw=1.8, lx=None, ly=None, fs=10, tc=TXT):
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle='-|>',
                 mutation_scale=16, color=color, lw=lw, linestyle=ls, zorder=2,
                 shrinkA=2, shrinkB=2))
    if label:
        ax.text(lx if lx is not None else (x0 + x1) / 2, ly if ly is not None else (y0 + y1) / 2,
                label, ha='center', va='center', fontsize=fs, color=tc, zorder=5,
                bbox=dict(fc='white', ec='none', pad=1))

def badbox(ax, x, y, w, h, text):
    box(ax, x, y, w, h, text, fc=RED_L, ec=RED, tc=RED, fs=11)

# ============ 图 1：核心循环 ============
fig, ax = plt.subplots(figsize=(12.6, 7.0), dpi=150)
ax.set_xlim(0, 126); ax.set_ylim(0, 70); ax.axis('off')
R1, R2 = 52, 26
nodes1 = [(14, '抽卡 / 开牌\n(3⚡·费用递增)'), (36, '买卡进手牌\n(按标价)'), (58, '建造 · 铺路\n(城市沿路生长)'), (82, '资源产出\n(每 10s 经济 Tick)')]
nodes2 = [(82, '出兵行军\n(沿路 · 1.6s/格)'), (58, '抢点 / 攻城 / 守家'), (34, '战果\n(占领 · 任务 · 计分)')]
for x, t in nodes1: box(ax, x, R1, 19, 11, t)
for x, t in nodes2: box(ax, x, R2, 19, 11, t, fc=BLUE, ec=BLUE_D, tc='white', bold=True)
for i in range(len(nodes1) - 1):
    arrow(ax, nodes1[i][0] + 9.5, R1, nodes1[i+1][0] - 9.5, R1)
arrow(ax, 82, R1 - 5.5, 82, R2 + 5.5, '能量 / 粮食转化', lx=99, fs=10)
arrow(ax, 72.5, R2, 67.5, R2)
arrow(ax, 48.5, R2, 43.5, R2)
# 回环：战果 → 抽卡
arrow(ax, 24.5, R2, 14, R2)
arrow(ax, 14, R2 + 5.5, 14, R1 - 5.5, '资源反哺 · 构筑迭代', ls='--', lx=7.5, fs=10)
# 胜利终点
box(ax, 108, R2, 20, 11, '摧毁敌方主城\n= 胜利\n(1800s 兜底计分)', fc=BLUE_D, ec=BLUE_D, tc='white', bold=True)
arrow(ax, 91.5, R2, 98, R2)
# 侧支：任务 → 遗物
box(ax, 20, 8, 16, 8, '弃牌\n(手牌管理)', fc='white')
box(ax, 42, 8, 18, 8, '星级任务\n(3 星 × 5 项)', fc='white')
box(ax, 66, 8, 18, 8, '遗物成长\n(13 池 · 上限 3)', fc='white')
arrow(ax, 28, 8, 33, 8); arrow(ax, 51, 8, 57, 8)
arrow(ax, 66, 12, 58, R2 - 5.5, '全局 buff', ls='--', lx=66, fs=9.5)
# 侧支：政策
box(ax, 96, 8, 18, 8, '政策三选一\n(升本触发)', fc='white')
box(ax, 118, 8, 12, 8, '构筑\n路径', fc='white')
arrow(ax, 105, 8, 112, 8)
arrow(ax, 118, 12, 100, R1 - 5.5, ls='--', lx=116, fs=9.5)
arrow(ax, 82, R1 - 5.5, 82, 12, ls='--', lx=90, ly=30, fs=9.5, label='主城升级触发')
plt.tight_layout(pad=0.4)
plt.savefig('D:/工程/自研/.workbuddy/fig_core_loop.png', facecolor='white')
plt.close()

# ============ 图 2：铺路合法性判定 ============
fig, ax = plt.subplots(figsize=(9.2, 11.6), dpi=150)
ax.set_xlim(0, 92); ax.set_ylim(0, 116); ax.axis('off')
CX = 30
box(ax, CX, 110, 44, 9, '道路牌 → 铺路模式（全图可铺格高亮）', fc=BLUE_D, ec=BLUE_D, tc='white', bold=True, fs=13)
steps = [
    (92, 'a. 格位互斥？\n空地（非道路 / 建筑 / 资源点 / 水 / 山 / 林）'),
    (70, 'b. 本方前沿？\n与本方主城连通（禁止隔空铺设）'),
    (48, 'c. 额度剩余？\n已用 < 100（官道 / 桥不占额）'),
    (26, 'd. 能量 ≥ 道路牌单价？\n（土路 2⚡ / 石路 5⚡ / 大道 10⚡）'),
]
bads = [
    (92, '✗ 拒绝\n「此处无法铺路」'),
    (70, '✗ 拒绝\n「此处无法铺路」'),
    (48, '✗ 拒绝\n「额度已满，先拆旧路」'),
    (26, '✗ 手牌置灰\n「能量不足」'),
]
arrow(ax, CX, 105.5, CX, 96.5)
for (sy, st), (by, bt) in zip(steps, bads):
    diamond(ax, CX, sy, 40, 13, st, fs=11)
    arrow(ax, CX + 20, sy, 68, sy, '否', lx=52, fs=10, tc=RED)
    badbox(ax, 78.5, sy, 24, 9, bt)
    if sy != 26:
        arrow(ax, CX, sy - 6.5, CX, sy - 13.5, '是', lx=CX + 3, ly=sy - 10, fs=10, tc=BLUE)
box(ax, CX, 9, 44, 10, '✓ 铺设成功\n扣能量 · 占 1 格额度 · 城市向前生长', fc=BLUE, ec=BLUE_D, tc='white', bold=True, fs=12.5)
arrow(ax, CX, 19.5, CX, 14, '是', lx=CX + 3, ly=16.5, fs=10, tc=BLUE)
ax.text(46, 3.5, '※ 拆除己方道路可释放 1 格额度（铺拆结合）；预设官道 / 桥不占额度、不可拆除',
        ha='left', fontsize=10, color='#666666')
plt.tight_layout(pad=0.4)
plt.savefig('D:/工程/自研/.workbuddy/fig_road_flow.png', facecolor='white')
plt.close()
print('figs OK')
