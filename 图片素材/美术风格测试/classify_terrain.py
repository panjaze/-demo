# -*- coding: utf-8 -*-
"""对最终底图做 29×15 格地形分类（平原/农田/森林/山地/水域）。
方法：每格中心区 5×5 采样点 HSV 规则分类 + 多数投票；产出：
  - 地形分类覆盖图.png（人工核对用）
  - 终端打印矩阵（'.'平原 'f'农田 'F'森林 'M'山地 'W'水域）
    → 人工修正后写进 config.js 的 map.terrain
"""
import os, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map', 'plate-final.png'))
T, COLS, ROWS = 60, 29, 15

# 人工修正表（分类器没把握的格子在此覆盖）：'.'平原 'f'农田 'F'森林 'M'山地 'W'水域
OVERRIDES = {}

def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def classify_cell(hsv):
    """cell 中心 70% 区域 5×5 采样，返回 (类, 票数)"""
    h, w = hsv.shape[:2]
    pts = []
    for fy in (0.15, 0.325, 0.5, 0.675, 0.85):
        for fx in (0.15, 0.325, 0.5, 0.675, 0.85):
            y, x = int(fy * h), int(fx * w)
            pts.append(hsv[y, x])
    votes = {'W': 0, 'F': 0, 'M': 0, 'f': 0, '.': 0}
    for (H, S, V) in pts:
        if 75 <= H < 135 and S > 60:
            c = 'W'                                  # 水（河/湖，含青~蓝）
        elif S < 70 and V < 200:
            c = 'M'                                  # 山地（低饱和灰岩）
        elif V < 110 and 25 <= H < 80 and S > 45:
            c = 'F'                                  # 森林（深绿、暗）
        elif 8 <= H < 26 and S > 125 and V > 135:
            c = 'f'                                  # 农田（橙黄高饱和）
        else:
            c = '.'                                  # 平原（黄绿草，S≈117 与农田规则相同）
        votes[c] += 1
    best = max(votes, key=votes.get)
    return best, votes[best]

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    im = imread_u(PLATE)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    grid = []
    for gy in range(ROWS):
        row = []
        for gx in range(COLS):
            cell = hsv[gy * T:(gy + 1) * T, gx * T:(gx + 1) * T]
            c, n = classify_cell(cell)
            row.append(c)
        grid.append(row)
    # 覆盖人工修正
    for (gx, gy), c in OVERRIDES.items():
        grid[gy][gx] = c

    for row in grid:
        print(''.join(row))

    # 覆盖图：半透明上色
    COLORS = {'.': None, 'f': (60, 200, 255), 'F': (0, 120, 0), 'M': (120, 120, 120), 'W': (255, 80, 0)}
    ov = im.copy()
    for gy in range(ROWS):
        for gx in range(COLS):
            c = COLORS[grid[gy][gx]]
            if c:
                y0, x0 = gy * T, gx * T
                ov[y0:y0 + T, x0:x0 + T] = (0.55 * ov[y0:y0 + T, x0:x0 + T] + 0.45 * np.array(c)).astype(np.uint8)
    # 画网格线
    for gx in range(COLS + 1):
        cv2.line(ov, (gx * T, 0), (gx * T, ROWS * T), (0, 0, 0), 1)
    for gy in range(ROWS + 1):
        cv2.line(ov, (0, gy * T), (COLS * T, gy * T), (0, 0, 0), 1)
    out = os.path.join(HERE, '地形分类覆盖图.png')
    ok, buf = cv2.imencode('.png', ov)
    buf.tofile(out)
    print('→', out)

    # 统计
    flat = ''.join(''.join(r) for r in grid)
    for c, name in [('.', '平原'), ('f', '农田'), ('F', '森林'), ('M', '山地'), ('W', '水域')]:
        print(f'{name}: {flat.count(c)}')

if __name__ == '__main__':
    main()
