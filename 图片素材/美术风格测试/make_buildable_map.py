# -*- coding: utf-8 -*-
"""生成「建造分区图」——给用户验收地形表与官道表 monoxide 的结论：
  绿色=可建（平原/农田）  红='"不可建（森林/山地）  蓝=河流湖泊（不可建）
  橙线=图上官道（初始道路）  青框=两座桥（唯一过河通道）
输入 build_terrain.py 定稿的地形/道路数据，输出带中文图例的 PNG。
"""
import os, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map', 'plate-final.png'))
OUT = os.path.join(HERE, '建造分区图.png')
T, COLS, ROWS = 60, 29, 15

import importlib.util
spec = importlib.util.spec_from_file_location('bt', os.path.join(HERE, 'build_terrain.py'))
bt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt)

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    im = bt.imread_u(PLATE)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    grid = []
    for gy in range(ROWS):
        grid.append([bt.classify_cell(hsv[gy*T:(gy+1)*T, gx*T:(gx+1)*T])[0] for gx in range(COLS)])
    for (gx, gy) in bt.WATER:
        grid[gy][gx] = 'W'
    for lst, kind in ((bt.REFINED_F, 'F'), (bt.REFINED_M, 'M')):
        for (gx, gy) in lst:
            if grid[gy][gx] == '.':
                grid[gy][gx] = kind

    ov = im.copy()
    for gy in range(ROWS):
        for gx in range(COLS):
            c = grid[gy][gx]
            y0, x0 = gy*T, gx*T
            blk = ov[y0:y0+T, x0:x0+T]
            if c in ('.', 'f'):          # 可建：淡绿
                ov[y0:y0+T, x0:x0+T] = (0.82*blk + 0.18*np.array([60, 200, 60])).astype(np.uint8)
            elif c == 'F':                # 森林：暗红
                ov[y0:y0+T, x0:x0+T] = (0.72*blk + 0.28*np.array([40, 40, 190])).astype(np.uint8)
            elif c == 'M':                # 山地：深灰
                ov[y0:y0+T, x0:x0+T] = (0.70*blk + 0.30*np.array([70, 70, 70])).astype(np.uint8)
            else:                         # 水域：蓝
                ov[y0:y0+T, x0:x0+T] = (0.72*blk + 0.28*np.array([200, 90, 30])).astype(np.uint8)

    # 道路：相邻路格连成线（先画粗底再画细芯，模拟土路面）
    rc = [(gx*T+T//2, gy*T+T//2) for gx, gy in sorted(bt.ROADS)]
    for a in rc:
        for b in rc:
            if 0 < abs(a[0]-b[0]) + abs(a[1]-b[1]) <= T:
                cv2.line(ov, a, b, (70, 120, 200), 14)
    for a in rc:
        for b in rc:
            if 0 < abs(a[0]-b[0]) + abs(a[1]-b[1]) <= T:
                cv2.line(ov, a, b, (110, 165, 225), 8)
    for gx, gy in bt.BRIDGE:                     # 桥：青色框
        cv2.rectangle(ov, (gx*T+4, gy*T+4), (gx*T+T-4, gy*T+T-4), (255, 255, 0), 3)

    img = Image.fromarray(cv2.cvtColor(ov, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    try:
        fnt = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 22)
        fsm = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)
    except Exception:
        fnt = fsm = ImageFont.load_default()

    for gx, gy, name in bt.RESOURCES:            # 资源点：红圈
        cx, cy = gx*T+T//2, gy*T+T//2
        d.ellipse([cx-15, cy-15, cx+15, cy+15], outline=(255, 40, 40), width=3)
    for side, (gx, gy) in bt.SPAWN.items():      # 出生点：白框 + 标签
        d.rectangle([gx*T, gy*T, gx*T+2*T, gy*T+2*T], outline=(255, 255, 255), width=4)
        d.text((gx*T+6, gy*T+2*T-26), side.upper(), font=fnt, fill=(255, 255, 255))

    # 图例面板
    panel = [(30, 30), (404, 232)]
    d.rectangle([panel[0][0]-8, panel[0][1]-8, panel[1][0]+8, panel[1][1]+8], fill=(20, 22, 26))
    items = [
        ((60, 200, 60), '可建造（平原 / 农田）'),
        ((40, 40, 190), '不可建造（森林）'),
        ((70, 70, 70), '不可建造（山地）'),
        ((200, 90, 30), '不可建造（河流 / 湖泊）'),
        ((110, 165, 225), '初始官道（可沿路生长 / 行军）'),
        ((255, 255, 0), '木桥（唯一过河通道）'),
        ((255, 40, 40), '中立资源点'),
    ]
    y = 40
    for col, label in items:
        d.rectangle([30, y, 66, y+22], fill=col, outline=(255, 255, 255))
        d.text((78, y-1), label, font=fsm, fill=(245, 245, 245))
        y += 30

    img.save(OUT)
    print('→', OUT)
    flat = ''.join(''.join(r) for r in grid)
    print(f'  可建 {flat.count(".")+flat.count("f")} / 森林 {flat.count("F")} / 山地 {flat.count("M")} / 水域 {flat.count("W")}')

if __name__ == '__main__':
    main()
