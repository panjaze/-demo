# -*- coding: utf-8 -*-
"""
P 试点验收图 v2：手绘底板 + 六座建筑（真实游戏尺寸）+ 程序化接地 + 动态层示意
v2 修正：
- 归属表现：去掉浮夸的色环 → 改为「旗帜」（墨线旗杆 + 阵营色三角旗，桌游/SLG 惯例）
- 土色地基：去掉硬描边 → 画在独立图层上高斯模糊后合成
- 放置高亮：实心白块 → 四角括号 + 极淡填充
- 建筑落位：避开底板上的森林/山岩带（p2 只部分保留山岩城堡的合理感）
"""
import os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'buildings'))
T, COLS, ROWS = 60, 29, 15
W, H = COLS * T, ROWS * T

P1, P2 = (74, 158, 255), (255, 107, 107)
INK = (62, 52, 34)
EARTH = (176, 148, 100)
GRASS_DK = (74, 104, 52)

def tile_center(gx, gy):
    return gx * T + T // 2, gy * T + T * 0.5

def feet(gx, gy):
    return gx * T + T // 2, gy * T + T * 0.92

def jitter_poly(cx, cy, rx, ry, n, seed, amp=0.18):
    rnd = random.Random(seed) if False else __import__('random').Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rnd.uniform(-amp, amp)
        pts.append((cx + math.cos(a) * rx * k, cy + math.sin(a) * ry * k))
    return pts

def draw_road(im, dr, pts, seed=7):
    rnd = __import__('random').Random(seed)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        for i in range(int(L * 1.6)):
            t = i / max(1, int(L * 1.6))
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            jx, jy = rnd.uniform(-3, 3), rnd.uniform(-3, 3)
            r = rnd.uniform(8, 11)
            dr.ellipse([x + jx - r, y + jy - r * .62, x + jx + r, y + jy + r * .62],
                       fill=(148, 124, 84))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        for i in range(int(L * 1.2)):
            t = i / max(1, int(L * 1.2))
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            jx, jy = rnd.uniform(-2, 2), rnd.uniform(-2, 2)
            r = rnd.uniform(5, 7)
            dr.ellipse([x + jx - r, y + jy - r * .6, x + jx + r, y + jy + r * .6],
                       fill=(186, 158, 110))
        for off in (-4, 4):
            for i in range(int(L)):
                t = i / max(1, int(L))
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                nx, ny = (y1 - y0) / L, -(x1 - x0) / L
                dr.point((x + nx * off, y + ny * off), fill=(120, 100, 68))

def draw_resource(dr, gx, gy, kind, owner=None):
    cx, cy = tile_center(gx, gy)
    dr.ellipse([cx - 15, cy - 12, cx + 15, cy + 12], fill=(196, 190, 168), outline=INK, width=3)
    gem = {'energy': (218, 170, 64), 'food': (208, 178, 92), 'logistics': (142, 148, 122)}[kind]
    dr.ellipse([cx - 8, cy - 7, cx + 8, cy + 7], fill=gem, outline=(90, 76, 48), width=2)
    if owner:
        col = P1 if owner == 'p1' else P2
        dr.ellipse([cx - 19, cy - 15, cx + 19, cy + 15], outline=col, width=3)

def draw_banner(dr, cx, fy, owner, seed=0):
    """归属旗：墨线旗杆 + 阵营色三角旗（代替 UI 感的色环）"""
    col = P1 if owner == 'p1' else P2
    bx, by = cx + 16, fy - 6
    dr.line([bx, by, bx, by - 26], fill=INK, width=3)
    dr.polygon([(bx, by - 26), (bx + 17, by - 21), (bx, by - 16)], fill=col, outline=(40, 34, 22))
    dr.ellipse([bx - 2, by - 1, bx + 3, by + 3], fill=(44, 38, 22))

def draw_squad(dr, gx, gy, owner):
    cx, cy = tile_center(gx, gy)
    col = (54, 92, 140) if owner == 'p1' else (140, 54, 54)
    dr.line([cx + 10, cy + 8, cx + 10, cy - 12], fill=INK, width=2)
    dr.polygon([(cx + 10, cy - 12), (cx + 20, cy - 9), (cx + 10, cy - 6)],
               fill=P1 if owner == 'p1' else P2)
    dr.rectangle([cx - 9, cy - 11, cx + 7, cy + 9], fill=col, outline=(30, 26, 18), width=2)

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    plate = Image.open(os.path.join(HERE, '地图底板-P试点.png')).convert('RGB').resize((W, H), Image.LANCZOS)
    patch = plate.crop((W - 480, H - 90, W - 240, H)).transpose(Image.FLIP_LEFT_RIGHT)
    plate.paste(patch, (W - 240, H - 90))          # 修水印
    im = plate.convert('RGBA')
    dr = ImageDraw.Draw(im)

    BUILDINGS = [   # (key, gx, gy, size, owner) —— 落位避开森林/山岩带
        ('castle', 3, 11, 93, 'p1'), ('farm', 2, 10, 68, 'p1'), ('atelier', 4, 10, 68, 'p1'),
        ('barracks', 5, 10, 68, 'p1'), ('power', 5, 11, 68, 'p1'), ('tower', 4, 12, 93, 'p1'),
        ('castle', 25, 3, 93, 'p2'), ('farm', 26, 2, 68, 'p2'), ('atelier', 24, 2, 68, 'p2'),
        ('power', 24, 4, 68, 'p2'), ('barracks', 26, 4, 68, 'p2'), ('tower', 25, 5, 93, 'p2'),
    ]

    # —— 1) 全部土色地基先画在独立图层，模糊后合成（消除硬边）——
    ground = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(ground)
    import random
    for key, gx, gy, size, _ in BUILDINGS:
        cx, fy = feet(gx, gy)
        pts = jitter_poly(cx, fy - 4, size * 0.40, size * 0.15, 12, (hash((key, gx, gy)) % 9999))
        gd.polygon(pts, fill=EARTH + (235,))
        rnd = random.Random(hash((key, 'sp', gx, gy)) % 9999)
        for _ in range(6):
            ox, oy = rnd.uniform(-size * .24, size * .24), rnd.uniform(-size * .08, size * .08)
            r = rnd.uniform(2, 5)
            gd.ellipse([cx + ox - r, fy - 4 + oy - r * .6, cx + ox + r, fy - 4 + oy + r * .6],
                       fill=(160, 134, 90, 220))
    ground = ground.filter(ImageFilter.GaussianBlur(1.6))
    im = Image.alpha_composite(im, ground)
    dr = ImageDraw.Draw(im)

    # —— 2) 道路（动态层）——
    def path(tiles):
        return [tile_center(gx, gy) for gx, gy in tiles]
    draw_road(im, dr, path([(3, 11), (8, 11), (8, 7), (13, 7)]))
    draw_road(im, dr, path([(25, 3), (20, 3), (20, 7), (15, 7)]))

    # —— 3) 资源点 ——
    draw_resource(dr, 14, 7, 'energy')
    draw_resource(dr, 14, 4, 'food'); draw_resource(dr, 14, 10, 'food')
    draw_resource(dr, 9, 9, 'food', 'p1'); draw_resource(dr, 19, 5, 'food', 'p2')
    draw_resource(dr, 10, 5, 'logistics'); draw_resource(dr, 18, 9, 'logistics', 'p1')
    draw_resource(dr, 5, 11, 'logistics'); draw_resource(dr, 23, 3, 'logistics')

    # —— 4) 建筑：软阴影 → 贴图 → 归属旗 → 草簇 ——
    sh_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh_layer)
    for key, gx, gy, size, _ in BUILDINGS:
        cx, fy = feet(gx, gy)
        sd.ellipse([cx - size * 0.34 + 5, fy - size * 0.10 + 4,
                    cx + size * 0.34 + 5, fy + size * 0.10 + 4], fill=(44, 38, 22, 80))
    sh_layer = sh_layer.filter(ImageFilter.GaussianBlur(4))
    im = Image.alpha_composite(im, sh_layer)
    dr = ImageDraw.Draw(im)

    import random
    for key, gx, gy, size, owner in BUILDINGS:
        sp = Image.open(os.path.join(ASSETS, key + '.png')).convert('RGBA').resize((size, size), Image.LANCZOS)
        cx, fy = feet(gx, gy)
        im.paste(sp, (int(cx - size / 2), int(fy - size)), sp)
        dr = ImageDraw.Draw(im)
        draw_banner(dr, cx, fy, owner)
        rnd = random.Random(hash((key, 't', gx, gy)) % 9999)
        for _ in range(8):
            a = rnd.uniform(0, 2 * math.pi)
            d = size * rnd.uniform(0.82, 1.1)
            x, y = cx + math.cos(a) * d, fy - 2 + math.sin(a) * d * 0.4
            for k in (-2, 0, 2):
                dr.line([x + k, y, x + k + rnd.uniform(-2, 2), y - rnd.uniform(4, 7)],
                        fill=GRASS_DK, width=2)

    # —— 5) 对峙部队 + 放置高亮（四角括号式，弱化格子后的格子可读方案）——
    draw_squad(dr, 12, 7, 'p1'); draw_squad(dr, 13, 7, 'p1')
    draw_squad(dr, 16, 7, 'p2'); draw_squad(dr, 15, 7, 'p2')
    hx, hy = 10, 10
    x0, y0, x1, y1 = hx * T + 3, hy * T + 3, hx * T + T - 3, hy * T + T - 3
    hl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.rectangle([x0, y0, x1, y1], fill=(255, 250, 230, 26))
    L = 14
    for (cx1, cy1, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        hd.line([cx1, cy1, cx1 + dx * L, cy1], fill=(255, 244, 200, 190), width=3)
        hd.line([cx1, cy1, cx1, cy1 + dy * L], fill=(255, 244, 200, 190), width=3)
    im = Image.alpha_composite(im, hl)
    dr = ImageDraw.Draw(im)

    out = os.path.join(HERE, '游戏内效果合成-P试点-2026-09-26.png')
    im.convert('RGB').save(out)
    print('已生成', out, im.size)

    crop = im.convert('RGB').crop((0, 9 * T, 8 * T, 15 * T)).resize((8 * T * 2, 6 * T * 2), Image.LANCZOS)
    out2 = os.path.join(HERE, '游戏内效果合成-我方基地放大-2026-09-26.png')
    crop.save(out2)
    print('已生成', out2, crop.size)

if __name__ == '__main__':
    main()
