# -*- coding: utf-8 -*-
"""在最终底图上叠 29×15 网格标尺（列号/行号 + 资源点/出生点标记），
供人工核对地形分类、绘制官道线路。产出 标尺底图.png"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
PLATE = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map', 'plate-final.png'))
T, COLS, ROWS = 60, 29, 15

RESOURCES = [  # 与 config.js map.resources 相同（gx,gy）
    (14, 7), (14, 4), (14, 10), (9, 9), (19, 5),
    (10, 5), (18, 9), (5, 11), (23, 3),
]
SPAWN = {'p1': (3, 11), 'p2': (25, 3)}

def font(size):
    for p in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    im = Image.open(PLATE).convert('RGB')
    dr = ImageDraw.Draw(im, 'RGBA')
    f = font(13)
    for gx in range(COLS + 1):
        dr.line([gx * T, 0, gx * T, ROWS * T], fill=(0, 0, 0, 70), width=1)
        if gx < COLS:
            dr.text((gx * T + 3, 2), str(gx), font=f, fill=(120, 30, 30, 230))
    for gy in range(ROWS + 1):
        dr.line([0, gy * T, COLS * T, gy * T], fill=(0, 0, 0, 70), width=1)
        if gy < ROWS:
            dr.text((2, gy * T + 3), str(gy), font=f, fill=(120, 30, 30, 230))
    for (gx, gy) in RESOURCES:
        cx, cy = gx * T + T // 2, gy * T + T // 2
        dr.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], outline=(220, 40, 40, 255), width=3)
    for k, (gx, gy) in SPAWN.items():
        cx, cy = gx * T + T, gy * T + T          # 2×2 占地中心
        dr.rectangle([gx * T + 2, gy * T + 2, gx * T + 2 * T - 2, gy * T + 2 * T - 2],
                     outline=(30, 80, 220, 255), width=3)
        dr.text((gx * T + 6, gy * T + 6), k, font=f, fill=(30, 80, 220, 255))
    im.save(os.path.join(HERE, '标尺底图.png'))
    print('ok →', os.path.join(HERE, '标尺底图.png'))

if __name__ == '__main__':
    main()
