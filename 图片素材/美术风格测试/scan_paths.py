# -*- coding: utf-8 -*-
"""对 plate-final.png 做全分辨率逐格扫描，输出两个覆盖率矩阵：
  1) 水域覆盖率（河/湖，青蓝色像素占比）
  2) 土路覆盖率（官道土路色带占比——农田也会命中，需结合连续性目测判读）
输出字符矩阵：值越大字符越"实"，供人工定稿地形表与官道格。
"""
import os, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map', 'plate-final.png'))
T, COLS, ROWS = 60, 29, 15

def imread_u(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)

def char_of(p):
    if p >= 0.40: return '#'
    if p >= 0.25: return '@'
    if p >= 0.15: return 'O'
    if p >= 0.08: return 'o'
    if p >= 0.03: return '.'
    return ' '

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    im = imread_u(PLATE)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)

    water = (H >= 75) & (H < 135) & (S > 55) & (V > 90)
    # 土路：浅土黄（比农田更淡、饱和度中低），路缘深棕不算
    road = (H >= 8) & (H < 26) & (S >= 60) & (S < 165) & (V >= 130) & (V < 225)

    print('=== 水域覆盖率矩阵（行=gy 0-14，列=gx 0-28） ===')
    print('     ' + ''.join(str(gx % 10) for gx in range(COLS)))
    for gy in range(ROWS):
        row = ''
        for gx in range(COLS):
            cell = water[gy*T:(gy+1)*T, gx*T:(gx+1)*T]
            row += char_of(float(cell.mean()))
        print(f'gy{gy:<3} {row}')

    print()
    print('=== 土路覆盖率矩阵（含农田干扰，O/＠ 多为路或田） ===')
    print('     ' + ''.join(str(gx % 10) for gx in range(COLS)))
    for gy in range(ROWS):
        row = ''
        for gx in range(COLS):
            cell = road[gy*T:(gy+1)*T, gx*T:(gx+1)*T]
            row += char_of(float(cell.mean()))
        print(f'gy{gy:<3} {row}')

if __name__ == '__main__':
    main()
