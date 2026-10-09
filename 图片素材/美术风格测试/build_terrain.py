# -*- coding: utf-8 -*-
"""地形表定稿脚本。

输入： plate-final.png（1740×900，29×15 格 @60px）
方法：
  1) 自动分类：每格中心区 5×5 采样 HSV 规则分类（平原/农田/森林/山地/水域）
  2) 人工覆盖 WATER（自动分类器抓不到窄河与树影下的河段，按覆盖率+目测逐格描出）
  3) 官道表 ROADS：按底图实际画出的主干道逐格登记
输出：
  - 地形矩阵（字符）
  - 关键点诊断（9 个资源点 / 双方出生点 2×2 占地）
  - 地形标注预览图.png（叠色 + 网格 + 资源点/出生点/桥/路标记）
  - terrain_rows.js 数据片段，供写入 config.js
"""
import os, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map', 'plate-final.png'))
T, COLS, ROWS = 60, 29, 15

# ==== ① 人工描出的水域（河 + 湖）=================================================
# 依据：整分辨率青蓝像素覆盖率 ≥8% 或目测确认河道经过格心；两座桥单独登记为「桥格」
RIVER = [
    # 北段：自北缘进入，绕中央山东侧南下
    (15, 0), (16, 0), (16, 1), (16, 2), (15, 3), (16, 3), (15, 4), (15, 5),
    # 中段：转浅滩向西南，经北桥，再沿山西侧南下
    (14, 6), (13, 7), (12, 7), (12, 8), (12, 9), (12, 10), (13, 10),
    # 南段：东折经南桥，转向南流出南缘
    (13, 11), (14, 11), (15, 11), (15, 12), (15, 13), (14, 14), (15, 14),
    # 中央山东侧窄溪
    (16, 7), (17, 7),
]
LAKE = [(23, 0), (24, 0), (22, 1), (23, 1), (24, 1), (25, 1), (24, 2)]   # 东北湖
WATER = set(RIVER + LAKE)

# ==== ①b 分类器漏判的「暗且粗糙」格 ============================================
# 判据（对底图取样标定）：明确平原 mean≈156 / std≈18；森林 mean≈89 / std≈34；
# 岩石山 mean≈113~132 / std≈52。此处只补「mean≤120 且已与山/林核心相邻」的格，
# 介于 120~140 的草树混合边缘保持可建，避免把可建造区吃得过狠。
REFINED_F = [   # 偏绿 → 森林
    (10, 0), (26, 0), (11, 1), (12, 3), (18, 3), (28, 3), (4, 4), (11, 4),
    (1, 6), (2, 7), (4, 7), (7, 7), (1, 8), (24, 8), (13, 9), (26, 9),
    (18, 12), (12, 13), (3, 14), (17, 14), (21, 14),
]
REFINED_M = [   # 低绿高粗糙 → 岩石山地/裸坡
    (19, 4), (18, 5), (15, 7), (16, 9), (28, 9), (14, 10), (27, 10),
    (26, 11), (27, 12), (10, 14),
]

# ==== ② 官道（底图实际画出的主干道）===============================================
BRIDGE = [(12, 8), (15, 11)]        # 两座木桥：既是水域格，也是道路格（唯一过河通道）
WEST_ROADS = [
    # 西纵干线（过主城两侧；主城占地 (3,11)(4,11)(3,12)(4,12) 内不注册）
    (3, 4), (3, 5), (3, 6), (3, 7), (3, 8), (3, 9), (3, 10), (3, 13), (3, 14),
    # 中西纵线
    (8, 5), (8, 6), (8, 7), (8, 8), (8, 9), (8, 10),
    # p1 东南纵线
    (7, 7), (7, 8), (7, 9), (7, 10), (7, 11), (7, 12), (7, 13),
    # 西南纵线
    (2, 9), (2, 10), (2, 11), (2, 12), (2, 13),
    # 主城东纵线（(5,11) 是物流点，纵线在此断开：北侧 (5,9)(5,10)，南侧走 gx6）
    (5, 9), (5, 10), (5, 12),
    (6, 11), (6, 12),
    # gy10 横线（西缘→中西纵线）
    (0, 10), (1, 10), (2, 10), (4, 10), (5, 10), (6, 10), (7, 10), (8, 10),
    # gy6 横线 + 东端南连
    (3, 6), (4, 6), (5, 6), (6, 6), (7, 6), (8, 6), (9, 6), (9, 7),
    # gy13 横线
    (2, 13), (3, 13), (4, 13), (5, 13), (6, 13), (7, 13), (8, 13),
]
CENTER_ROADS = [
    # 山北横线（跨北桥，接西部 gy8）
    (9, 8), (10, 8), (11, 8), (13, 8), (14, 8),
    # 山东横线（出桥向东）
    (15, 8), (16, 8), (17, 8), (18, 8), (19, 8), (20, 8),
]
EAST_ROADS = [
    # 东一纵线 / 东二纵线（后者贴 p2 出生点西缘）
    (22, 3), (22, 4), (22, 5), (22, 6), (22, 7), (22, 8), (22, 9), (22, 10),
    (24, 3), (24, 4), (24, 5), (24, 6), (24, 7), (24, 8), (24, 9), (24, 10),
    # gy5 横线（(19,5) 是粮点，此处下沉一格经 gy6 绕过：18,5→18,6→19,6→20,6→20,5）
    (18, 5), (18, 6), (19, 6), (20, 6), (20, 5), (21, 5), (22, 5), (23, 5), (24, 5),
    # 东南弯出东缘
    (25, 10), (26, 10), (27, 10), (26, 11), (27, 11), (28, 11),
    # p2 东南路
    (27, 4), (27, 5), (27, 6), (28, 4),
]
ROADS = set(BRIDGE) | set(WEST_ROADS) | set(CENTER_ROADS) | set(EAST_ROADS)

# 资源点：第三十次修订后——三个「不临路」的点已挪位（保持关于中心 (14,7) 成对对称）
# 对称规则 (gx,gy) ↔ (28-gx,14-gy)，因此 p1 到某点的距离恒等于 p2 到其对称点的距离
RESOURCES = [
    (14, 7, '中央能源点'),
    (9, 5, '物流点·西北'), (19, 9, '物流点·东南'),     # 原 (10,5)/(18,9)，挪后临路
    (5, 11, '物流点·西南'), (23, 3, '物流点·东北'),
    (5, 5, '粮点·西北'), (23, 9, '粮点·东南'),         # 原 (14,4)/(14,10) 中轴点挪出；新位临路且对称
    (9, 9, '粮点·内'), (19, 5, '粮点·内'),
]
SPAWN = {'p1': (3, 11), 'p2': (25, 3)}

def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def classify_cell(hsv):
    votes = {'W': 0, 'F': 0, 'M': 0, 'f': 0, '.': 0}
    h, w = hsv.shape[:2]
    for fy in (0.15, 0.325, 0.5, 0.675, 0.85):
        for fx in (0.15, 0.325, 0.5, 0.675, 0.85):
            H, S, V = hsv[int(fy * h), int(fx * w)]
            if 75 <= H < 135 and S > 60:
                c = 'W'
            elif S < 70 and V < 200:
                c = 'M'
            elif V < 110 and 25 <= H < 80 and S > 45:
                c = 'F'
            elif 8 <= H < 26 and S > 125 and V > 135:
                c = 'f'
            else:
                c = '.'
            votes[c] += 1
    best = max(votes, key=votes.get)
    return best, votes

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    im = imread_u(PLATE)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)

    grid = []
    for gy in range(ROWS):
        row = []
        for gx in range(COLS):
            c, _ = classify_cell(hsv[gy*T:(gy+1)*T, gx*T:(gx+1)*T])
            row.append(c)
        grid.append(row)
    for (gx, gy) in WATER:
        grid[gy][gx] = 'W'
    for leftovers, kind in ((REFINED_F, 'F'), (REFINED_M, 'M')):
        for (gx, gy) in leftovers:
            if grid[gy][gx] == '.':
                grid[gy][gx] = kind

    print('=== 最终地形矩阵（. 平原 f 农田 F 森林 M 山地 W 水域） ===')
    print('     ' + ''.join(str(gx % 10) for gx in range(COLS)))
    for gy in range(ROWS):
        print(f'gy{gy:<3} ' + ''.join(grid[gy]))
    print()
    flat = ''.join(''.join(r) for r in grid)
    for c, name in [('.', '平原'), ('f', '农田'), ('F', '森林'), ('M', '山地'), ('W', '水域')]:
        print(f'  {name}: {flat.count(c)}')

    print()
    print('=== 关键点诊断（资源点 / 出生点占地的实际地形） ===')
    bad = []
    for gx, gy, name in RESOURCES:
        t = grid[gy][gx]
        nb = [(gx+1, gy), (gx-1, gy), (gx, gy+1), (gx, gy-1)]
        nearRoad = any((x, y) in ROADS for x, y in nb if 0 <= x < COLS and 0 <= y < ROWS)
        flag = '⚠不可建地形' if t in ('W', 'M') else ('·林地' if t == 'F' else 'ok')
        print(f'  {name:<12} ({gx:>2},{gy:>2}) 地形={t} {flag}  {"临路 ok" if nearRoad else "⚠不临路"}')
        if t in ('W', 'M'):
            bad.append((name, gx, gy, t))
    for side, (gx, gy) in SPAWN.items():
        cells = [(gx, gy), (gx+1, gy), (gx, gy+1), (gx+1, gy+1)]
        ts = [grid[y][x] for x, y in cells]
        flag = '⚠冲突' if any(t in ('W', 'M', 'F') for t in ts) else 'ok'
        print(f'  出生点 {side}   2×2 ({gx},{gy})-[{gx+1},{gy+1}] 地形={ts} {flag}')
        if any(t in ('W', 'M') for t in ts):
            bad.append((side + ' 出生区', gx, gy, 'W/M'))
    print()
    print('=== 道路格统计 ===')
    print(f'  官道 {len(ROADS)} 格（其中桥 {len(BRIDGE)} 格 Bridges={BRIDGE}）')
    conflicts = sorted(set(ROADS) & set(RESOURCES_XY))
    print(f'  道路与资源点重叠：{conflicts if conflicts else "无"}')

    # 预览图
    COLORS = {'.': None, 'f': (60, 200, 255), 'F': (0, 110, 0), 'M': (130, 130, 130), 'W': (255, 80, 0)}
    ov = im.copy()
    for gy in range(ROWS):
        for gx in range(COLS):
            c = COLORS[grid[gy][gx]]
            if c:
                blk = ov[gy*T:(gy+1)*T, gx*T:(gx+1)*T]
                ov[gy*T:(gy+1)*T, gx*T:(gx+1)*T] = (0.6*blk + 0.4*np.array(c)).astype(np.uint8)
    for gx, gy in sorted(ROADS):
        cv2.rectangle(ov, (gx*T+14, gy*T+14), (gx*T+T-14, gy*T+T-14), (200, 90, 30), 2)
    for gx, gy in BRIDGE:
        cv2.rectangle(ov, (gx*T+6, gy*T+6), (gx*T+T-6, gy*T+T-6), (0, 255, 255), 2)
    for gx, gy, _ in RESOURCES:
        cv2.circle(ov, (gx*T+T//2, gy*T+T//2), 16, (0, 0, 255), 2)
    for side, (gx, gy) in SPAWN.items():
        cv2.rectangle(ov, (gx*T, gy*T), (gx*T+2*T, gy*T+2*T), (255, 0, 0), 3)
    for gx in range(COLS+1):
        cv2.line(ov, (gx*T, 0), (gx*T, ROWS*T), (0, 0, 0), 1)
    for gy in range(ROWS+1):
        cv2.line(ov, (0, gy*T), (COLS*T, gy*T), (0, 0, 0), 1)
    ok, buf = cv2.imencode('.png', ov)
    buf.tofile(os.path.join(HERE, '地形标注预览图.png'))
    print()
    print('→ 地形标注预览图.png')

    # 数据片段：每行一个字符串，terrain[gy][gx] 直接取值
    lines = ["      '" + ''.join(grid[gy]) + "'," for gy in range(ROWS)]
    js = ('/** terrain[gy][gx]：. 平原 / f 农田 / F 森林 / M 山地 / W 水域\n'
          "     * 不可建造 = F / M / W；可建造 = . / f\n     */\n    terrain: [\n"
          + '\n'.join(lines) + '\n    ],')
    with open(os.path.join(HERE, 'terrain_rows.txt'), 'w', encoding='utf-8') as f:
        f.write(js)
    with open(os.path.join(HERE, 'roads_rows.txt'), 'w', encoding='utf-8') as f:
        f.write('initialRoads: [' + ', '.join(f'{{gx:{x},gy:{y}}}' for x, y in sorted(ROADS)) + '],')
    print('→ terrain_rows.txt / roads_rows.txt')
    if bad:
        print()
        print('⚠ 待确认冲突点：', bad)

RESOURCES_XY = [(gx, gy) for gx, gy, _ in RESOURCES]

if __name__ == '__main__':
    main()
