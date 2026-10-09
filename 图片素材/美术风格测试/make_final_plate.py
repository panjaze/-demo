# -*- coding: utf-8 -*-
"""最终底图处理：
1. 修掉两座装饰城堡 —— 用图内真实纹理块（路口/草地）做羽化捐赠补丁
   （cv2 TELEA 大区域会涂抹成色块，弃用；捐赠区都是路口，呼应"城堡建在路口"）
2. 两点对齐缩放：装饰城堡中心 → 主城 2×2 占地中心
   p1 (207,622)→(240,720)（锚点 (3,11)）；p2 (1444,230)→(1560,240)（锚点 (25,3)）
3. 裁到 1740×900 → 卡牌建城demo/assets/map/plate-final.png
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '地图底图-FINAL-用户选定-原图.jpg')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map', 'plate-final.png'))
T, COLS, ROWS = 60, 29, 15
W, H = COLS * T, ROWS * T                    # 1740 x 900

# 捐赠补丁：donor 区（图内真实纹理）→ 羽化后盖到城堡区
PATCHES = [
    # BL 城堡：上方同尺寸路口区（草+路+树+金矿点缀）垂直下移盖住城堡
    {'donor': (126, 356, 296, 536), 'dst': (126, 536)},
    # TR 城堡：西侧十字路口纹理平移盖住城堡
    {'donor': (1150, 290, 1320, 465), 'dst': (1361, 146)},
]

# 两点对齐：装饰城堡中心 → 我方/敌方主城 2×2 占地中心
P1_SRC, P1_DST = (207.0, 622.0), (240.0, 720.0)     # 锚点 (3,11)：占地像素中心
P2_SRC, P2_DST = (1444.0, 230.0), (1560.0, 240.0)   # 锚点 (25,3)


def feather_patch(im, donor_box, dst_xy, feather=18):
    """把 donor 区纹理羽化贴到 dst（同尺寸），边缘 30px 渐融进原地纹理"""
    x0, y0, x1, y1 = donor_box
    tile = im.crop((x0, y0, x1, y1)).convert('RGB')
    w, h = tile.size
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rectangle([feather, feather, w - feather, h - feather], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.7))
    im.paste(tile, dst_xy, mask)


def imread_u(path):
    """cv2/PIL 在 Windows 都可能遇非 ASCII 路径 → 统一字节读取"""
    return Image.open(path)


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    im = imread_u(SRC).convert('RGB')
    for p in PATCHES:
        feather_patch(im, p['donor'], p['dst'])

    w0, h0 = im.size
    sx = (P2_DST[0] - P1_DST[0]) / (P2_SRC[0] - P1_SRC[0])
    sy = (P2_DST[1] - P1_DST[1]) / (P2_SRC[1] - P1_SRC[1])
    big = im.resize((round(w0 * sx), round(h0 * sy)), Image.LANCZOS)
    sw, sh = big.size
    # 裁剪窗：理论位置为负时取 0（城堡残留 ≤19px 偏移，修补草地可覆盖）
    cx = max(0, round(P1_SRC[0] * sx - P1_DST[0]))
    cy = max(0, round(P1_SRC[1] * sy - P1_DST[1]))
    assert 0 <= cx and cx + W <= sw, f'x 越界 {cx},{sw}'
    assert 0 <= cy and cy + H <= sh, f'y 越界 {cy},{sh}'
    out = big.crop((cx, cy, cx + W, cy + H))
    out.save(OUT)
    print(f'原 {w0}x{h0} → 修补 → 缩放 sx={sx:.4f} sy={sy:.4f} → {sw}x{sh} → 裁({cx},{cy}) → {OUT} {W}x{H}')


if __name__ == '__main__':
    main()

