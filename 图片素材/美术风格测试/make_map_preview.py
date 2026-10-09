# -*- coding: utf-8 -*-
"""
风格统一性验证图：
1) 按游戏真实地图参数（29×15 网格 / tile 60 / sandbox.js 的草地-道路调色板）
   把六座建筑 sprite 拼成一张「游戏地图效果图」
2) 每座建筑 128px 与 256px 两档缩小清晰度测试条（草地底色上）
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'buildings'))
T = 60
COLS, ROWS = 29, 15
M = 36
W, H = COLS * T + M * 2, ROWS * T + M * 2

GRASS_A = (84, 127, 60)    # sandbox COL.grassA
GRASS_B = (77, 118, 54)    # grassB
ROAD = (194, 168, 120)
ROAD_EDGE = (156, 132, 87)

def hash2(x, y):
    h = (x * 374761393 + y * 668265263) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffffffff) / 4294967296

def draw_map():
    im = Image.new('RGB', (W, H), (68, 105, 47))
    dr = ImageDraw.Draw(im)
    for gy in range(ROWS):
        for gx in range(COLS):
            c = GRASS_A if (gx + gy) % 2 == 0 else GRASS_B
            x0, y0 = M + gx * T, M + gy * T
            dr.rectangle([x0, y0, x0 + T, y0 + T], fill=c)
            if hash2(gx, gy) > 0.82:      # 草地噪点
                cx, cy = x0 + int(hash2(gy, gx) * T), y0 + int(hash2(gx + 7, gy + 3) * T)
                dr.ellipse([cx - 3, cy - 2, cx + 3, cy + 2], fill=(53, 84, 31))
    # 道路：一条横贯中路 + 两条纵向支路（示意路网）
    for gx in range(3, 26):
        x0, y0 = M + gx * T, M + 7 * T
        dr.rectangle([x0 + 6, y0 + 8, x0 + T - 6, y0 + T - 8], fill=ROAD, outline=ROAD_EDGE)
    for gy in range(8, 12):
        x0, y0 = M + 4 * T, M + gy * T
        dr.rectangle([x0 + 8, y0 + 6, x0 + T - 8, y0 + T - 6], fill=ROAD, outline=ROAD_EDGE)
    for gy in range(3, 7):
        x0, y0 = M + 24 * T, M + gy * T
        dr.rectangle([x0 + 8, y0 + 6, x0 + T - 8, y0 + T - 6], fill=ROAD, outline=ROAD_EDGE)
    # 资源点（9 个示意，非精确坐标）
    pts = [(14, 7, 'energy'), (8, 4, 'food'), (20, 10, 'food'), (8, 10, 'food'), (20, 4, 'food'),
           (5, 7, 'logi'), (23, 7, 'logi'), (14, 3, 'logi'), (14, 11, 'logi')]
    for gx, gy, kind in pts:
        cx, cy = M + gx * T + T // 2, M + gy * T + T // 2
        col = {'energy': (255, 210, 63), 'food': (228, 180, 70), 'logi': (150, 150, 140)}[kind]
        dr.ellipse([cx - 16, cy - 12, cx + 16, cy + 12], fill=col, outline=(60, 48, 12), width=3)
    return im, dr

def paste_building(im, key, gx, gy, ring, size):
    sp = Image.open(os.path.join(ASSETS, key + '.png')).convert('RGBA')
    sp = sp.resize((size, size), Image.LANCZOS)
    cx = M + gx * T + T // 2
    feet = M + gy * T + T * 0.92
    dr = ImageDraw.Draw(im)
    dr.ellipse([cx - size * 0.32, feet - size * 0.12, cx + size * 0.32, feet + size * 0.10],
               fill=ring)
    im.paste(sp, (int(cx - size / 2), int(feet - size)), sp)

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    im, dr = draw_map()
    # 我方基地群（左下）
    paste_building(im, 'castle', 3, 11, (74, 158, 255, 255), 108)
    paste_building(im, 'farm', 2, 12, (74, 158, 255, 255), 72)
    paste_building(im, 'atelier', 4, 12, (74, 158, 255, 255), 72)
    paste_building(im, 'power', 2, 10, (74, 158, 255, 255), 72)
    paste_building(im, 'barracks', 4, 10, (74, 158, 255, 255), 72)
    paste_building(im, 'tower', 5, 11, (74, 158, 255, 255), 100)
    # 敌方基地群（右上，镜像）
    paste_building(im, 'castle', 25, 3, (255, 107, 107, 255), 108)
    paste_building(im, 'farm', 24, 2, (255, 107, 107, 255), 72)
    paste_building(im, 'atelier', 26, 2, (255, 107, 107, 255), 72)
    paste_building(im, 'power', 24, 4, (255, 107, 107, 255), 72)
    paste_building(im, 'barracks', 26, 4, (255, 107, 107, 255), 72)
    paste_building(im, 'tower', 23, 3, (255, 107, 107, 255), 100)
    # 中路对峙兵力示意（小方块即可）
    for gx, gy, col in ((12, 7, (36, 72, 120)), (16, 7, (120, 36, 36)), (13, 7, (36, 72, 120)), (15, 7, (120, 36, 36))):
        cx, cy = M + gx * T + T // 2, M + gy * T + T // 2
        dr.rectangle([cx - 12, cy - 16, cx + 12, cy + 16], fill=col, outline=(20, 20, 20), width=2)
    out1 = os.path.join(HERE, '地图效果图-2026-09-26.png')
    im.save(out1)
    print('已生成', out1, im.size)

    # 缩小清晰度测试条：草地底上每座建筑 128px / 256px 各一张
    names = [('farm', '农田'), ('atelier', '卡坊'), ('power', '能源站'), ('barracks', '兵营'), ('tower', '防御塔'), ('castle', '主城')]
    cell_w, cell_h = 300, 300
    strip = Image.new('RGB', (cell_w * len(names), cell_h * 2 + 60), GRASS_B)
    sd = ImageDraw.Draw(strip)
    for row, px in enumerate((128, 256)):
        for i, (key, cn) in enumerate(names):
            x0, y0 = i * cell_w, 30 + row * cell_h
            for yy in range(y0, y0 + cell_h, 30):
                for xx in range(x0, x0 + cell_w, 30):
                    sd.rectangle([xx, yy, xx + 30, yy + 30],
                                 fill=GRASS_A if (xx // 30 + yy // 30) % 2 == 0 else GRASS_B)
            sp = Image.open(os.path.join(ASSETS, key + '.png')).convert('RGBA').resize((px, px), Image.LANCZOS)
            strip.paste(sp, (x0 + (cell_w - px) // 2, y0 + (cell_h - px) - 12), sp)
    for i, (key, cn) in enumerate(names):
        sd.text((i * cell_w + 130, 6), cn, fill=(255, 255, 255))
    out2 = os.path.join(HERE, '缩小清晰度测试-2026-09-26.png')
    strip.save(out2)
    print('已生成', out2, strip.size)
