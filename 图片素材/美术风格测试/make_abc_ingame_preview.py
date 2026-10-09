# -*- coding: utf-8 -*-
"""A/B/C 三张底图的「建筑落位合成」+ 并排对比总表。
建筑/道路/资源/部队的落位在三个版本上完全一致（同一份 BUILDINGS/路网/资源坐标），
保证比的是"底图语言"，不是"摆得好不好"。
复用 make_ingame_preview.py 的绘制函数，不生成任何新美术素材。
"""
import os, sys, math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_ingame_preview as base          # 复用 tile_center / feet / draw_road / draw_resource ...

T, COLS, ROWS = base.T, base.COLS, base.ROWS
W, H = base.W, base.H
ASSETS = base.ASSETS
MAPDIR = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map'))

# —— 三个版本完全一致的落位 ——
BUILDINGS = [
    ('castle', 3, 11, 93, 'p1'), ('farm', 2, 10, 68, 'p1'), ('atelier', 4, 10, 68, 'p1'),
    ('barracks', 5, 10, 68, 'p1'), ('power', 5, 11, 68, 'p1'), ('tower', 4, 12, 93, 'p1'),
    ('castle', 25, 3, 93, 'p2'), ('farm', 26, 2, 68, 'p2'), ('atelier', 24, 2, 68, 'p2'),
    ('power', 24, 4, 68, 'p2'), ('barracks', 26, 4, 68, 'p2'), ('tower', 25, 5, 93, 'p2'),
]
ROADS = ([(3, 11), (8, 11), (8, 7), (13, 7)], [(25, 3), (20, 3), (20, 7), (15, 7)])
RESOURCES = [(14, 7, 'energy', None), (14, 4, 'food', None), (14, 10, 'food', None),
             (9, 9, 'food', 'p1'), (19, 5, 'food', 'p2'), (10, 5, 'logistics', None),
             (18, 9, 'logistics', 'p1'), (5, 11, 'logistics', None), (23, 3, 'logistics', None)]
SQUADS = [(12, 7, 'p1'), (13, 7, 'p1'), (16, 7, 'p2'), (15, 7, 'p2')]
HIGHLIGHT = (10, 10)


def composite(plate_path):
    plate = Image.open(plate_path).convert('RGB').resize((W, H), Image.LANCZOS)
    im = plate.convert('RGBA')
    dr = ImageDraw.Draw(im)

    # 1) 土色地基（独立图层 → 模糊 → 合成）
    ground = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(ground)
    for key, gx, gy, size, _ in BUILDINGS:
        cx, fy = base.feet(gx, gy)
        pts = base.jitter_poly(cx, fy - 4, size * 0.40, size * 0.15, 12, hash((key, gx, gy)) % 9999)
        gd.polygon(pts, fill=base.EARTH + (235,))
        rnd = random.Random(hash((key, 'sp', gx, gy)) % 9999)
        for _ in range(6):
            ox, oy = rnd.uniform(-size * .24, size * .24), rnd.uniform(-size * .08, size * .08)
            r = rnd.uniform(2, 5)
            gd.ellipse([cx + ox - r, fy - 4 + oy - r * .6, cx + ox + r, fy - 4 + oy + r * .6],
                       fill=(160, 134, 90, 220))
    im = Image.alpha_composite(im, ground.filter(ImageFilter.GaussianBlur(1.6)))
    dr = ImageDraw.Draw(im)

    # 2) 道路（程序层，三版一致）
    for tiles in ROADS:
        base.draw_road(im, dr, [base.tile_center(gx, gy) for gx, gy in tiles])

    # 3) 资源点
    for gx, gy, kind, owner in RESOURCES:
        base.draw_resource(dr, gx, gy, kind, owner)

    # 4) 建筑：阴影 → 贴图 → 归属旗 → 草簇
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for key, gx, gy, size, _ in BUILDINGS:
        cx, fy = base.feet(gx, gy)
        sd.ellipse([cx - size * .34 + 5, fy - size * .10 + 4,
                    cx + size * .34 + 5, fy + size * .10 + 4], fill=(44, 38, 22, 80))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(4)))
    dr = ImageDraw.Draw(im)

    for key, gx, gy, size, owner in BUILDINGS:
        sp = Image.open(os.path.join(ASSETS, key + '.png')).convert('RGBA').resize((size, size), Image.LANCZOS)
        cx, fy = base.feet(gx, gy)
        im.paste(sp, (int(cx - size / 2), int(fy - size)), sp)
        dr = ImageDraw.Draw(im)
        base.draw_banner(dr, cx, fy, owner)
        rnd = random.Random(hash((key, 't', gx, gy)) % 9999)
        for _ in range(8):
            a = rnd.uniform(0, 2 * math.pi)
            d = size * rnd.uniform(0.82, 1.1)
            x, y = cx + math.cos(a) * d, fy - 2 + math.sin(a) * d * 0.4
            for k in (-2, 0, 2):
                dr.line([x + k, y, x + k + rnd.uniform(-2, 2), y - rnd.uniform(4, 7)],
                        fill=base.GRASS_DK, width=2)

    # 5) 部队 + 放置高亮（四角括号）
    for gx, gy, owner in SQUADS:
        base.draw_squad(dr, gx, gy, owner)
    hx, hy = HIGHLIGHT
    x0, y0, x1, y1 = hx * T + 3, hy * T + 3, hx * T + T - 3, hy * T + T - 3
    hl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.rectangle([x0, y0, x1, y1], fill=(255, 250, 230, 26))
    for (ax, ay, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        hd.line([ax, ay, ax + dx * 14, ay], fill=(255, 244, 200, 190), width=3)
        hd.line([ax, ay, ax, ay + dy * 14], fill=(255, 244, 200, 190), width=3)
    im = Image.alpha_composite(im, hl)
    return im.convert('RGB')


def label_font(size):
    for p in ('C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/msyhbd.ttc',
              'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/simsun.ttc'):
        if os.path.exists(p):
            from PIL import ImageFont
            return ImageFont.truetype(p, size)
    from PIL import ImageFont
    return ImageFont.load_default()


def make_sheet(imgs, titles):
    """并排总表：每行 = 一个版本，左=全图、右=我方基地放大"""
    full_w, full_h = 1160, int(1160 * H / W)
    zoom_w, zoom_h = 470, int(470 * (6 * T) / (8 * T))
    pad, lab = 24, 34
    row_h = full_h + lab + pad
    sheet = Image.new('RGB', (pad * 4 + full_w + zoom_w, pad + row_h * len(imgs)), (32, 30, 28))
    dr = ImageDraw.Draw(sheet)
    f = label_font(24)
    for i, (im, title) in enumerate(zip(imgs, titles)):
        y = pad + i * row_h
        dr.text((pad, y), title, font=f, fill=(238, 231, 214))
        sheet.paste(im.resize((full_w, full_h), Image.LANCZOS), (pad, y + lab))
        crop = im.crop((0, 9 * T, 8 * T, 15 * T)).resize((zoom_w, zoom_h), Image.LANCZOS)
        sheet.paste(crop, (pad * 3 + full_w, y + lab))
    return sheet


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    tags = [('a', 'A 欧陆棋盘'), ('b', 'B 率土土地'), ('c', 'C 综合版（重点）')]
    imgs, titles = [], []
    for tag, name in tags:
        src = os.path.join(MAPDIR, f'plate-{tag}.png')
        im = composite(src)
        out = os.path.join(HERE, f'落位合成-{tag.upper()}版.png')
        im.save(out)
        print('已生成', out, im.size)
        imgs.append(im)
        titles.append(f'{name}   左：全图落位   右：我方基地放大（同坐标同比例）')
    sheet = make_sheet(imgs, titles)
    out = os.path.join(HERE, '底图三选一对比总表-2026-09-26.png')
    sheet.save(out)
    print('已生成', out, sheet.size)


if __name__ == '__main__':
    main()
