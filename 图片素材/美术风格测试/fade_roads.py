# -*- coding: utf-8 -*-
"""官道淡化/抹除对比图生成：精确识别路面像素 → 淡化 or inpainting 抹除。桥格不动。"""
import cv2
import numpy as np

SRC = "D:/工程/自研/卡牌建城demo/assets/map/plate-final.png"
OUT = "D:/工程/自研/图片素材/美术风格测试/"
BRIDGES = {(12, 8), (15, 11)}

# initialRoads 99 格（config.js 同步）
ROADS = [
    (0,10),(1,10),(2,9),(2,10),(2,11),(2,12),(2,13),
    (3,4),(3,5),(3,6),(3,7),(3,8),(3,9),(3,10),(3,13),(3,14),
    (4,6),(4,10),(4,13),
    (5,6),(5,9),(5,10),(5,12),(5,13),
    (6,6),(6,10),(6,11),(6,12),(6,13),
    (7,6),(7,7),(7,8),(7,9),(7,10),(7,11),(7,12),(7,13),
    (8,5),(8,6),(8,7),(8,8),(8,9),(8,10),(8,13),
    (9,6),(9,7),(9,8),(10,8),(11,8),(12,8),(13,8),(14,8),(15,8),
    (15,10),(15,11),
    (16,8),(16,10),(17,8),(17,9),(17,10),
    (18,5),(18,6),(18,7),(18,8),(19,6),(19,8),
    (20,5),(20,6),(20,8),(21,5),
    (22,3),(22,4),(22,5),(22,6),(22,7),(22,8),(22,9),(22,10),
    (23,5),
    (24,3),(24,4),(24,5),(24,6),(24,7),(24,8),(24,9),(24,10),
    (25,5),(25,10),(26,5),(26,10),(26,11),(27,4),(27,5),(27,6),(27,10),(27,11),
    (28,4),(28,11),
]
TILE = 60
ROWS, COLS = 15, 29

img = cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR)
H, W = img.shape[:2]
print("plate:", W, "x", H)

hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
Hc, Sc, Vc = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)

# 路面色系（宽进）：浅土黄主色 + 深土色车辙/边缘（H 5~30，S 40~190，V 90~235）
roadpx = ((Hc >= 5) & (Hc <= 30) & (Sc >= 40) & (Sc <= 190) & (Vc >= 90) & (Vc <= 235))

mask = np.zeros((H, W), np.uint8)
treated = 0
for (gx, gy) in ROADS:
    if (gx, gy) in BRIDGES:
        continue
    x0, y0 = gx * TILE, gy * TILE
    cell = roadpx[y0:y0 + TILE, x0:x0 + TILE]
    cov = cell.mean() * 100
    if cov < 3:      # 该格没有可识别的路面（如 7 格逻辑补路），跳过
        continue
    treated += 1
    m = np.zeros((TILE, TILE), np.uint8)
    m[cell] = 255
    mask[y0:y0 + TILE, x0:x0 + TILE] = m

print("处理格数:", treated, "/ 97（桥 2 格除外）")

# 膨胀盖住抗锯齿边缘与车辙暗线，再羽化
mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=1)
mask_f = cv2.GaussianBlur(mask, (9, 9), 0).astype(np.float32) / 255.0
mask3 = cv2.merge([mask_f, mask_f, mask_f])

base = img.astype(np.float32)
inp = cv2.inpaint(img, mask, 5, cv2.INPAINT_TELEA).astype(np.float32)

def save(im, name):
    ok, buf = cv2.imencode(".png", im.astype(np.uint8))
    buf.tofile(OUT + name)
    print("写出", name)

save(base * (1 - 0.55 * mask3) + inp * (0.55 * mask3), "官道淡化-轻55.png")
save(base * (1 - 0.85 * mask3) + inp * (0.85 * mask3), "官道淡化-重85.png")
save(inp, "官道抹除100.png")

# 对比小图：原版 + 三版，2x2 拼图
def thumb(im, w=860):
    return cv2.resize(im, (w, int(im.shape[0] * w / im.shape[1])), interpolation=cv2.INTER_AREA)

from PIL import Image, ImageDraw, ImageFont
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
except Exception:
    font = ImageFont.load_default()

panels = [("原版（官道非常明显）", img),
          ("淡化 55%（隐约旧径）", None), ("淡化 85%", None), ("完全抹除", None)]
light = (base * (1 - 0.55 * mask3) + inp * (0.55 * mask3)).astype(np.uint8)
heavy = (base * (1 - 0.85 * mask3) + inp * (0.85 * mask3)).astype(np.uint8)
ims = [img, light, heavy, inp]
th = [thumb(i) for i in ims]
tw, thh = th[0].shape[1], th[0].shape[0]
pad, cap = 16, 40
sheet = np.full((pad + (thh + cap + pad) * 2, tw * 2 + pad * 3, 3), 245, np.uint8)
pos = [(pad, pad), (pad * 2 + tw, pad), (pad, pad * 2 + thh + cap), (pad * 2 + tw, pad * 2 + thh + cap)]
pil = Image.fromarray(sheet[:, :, ::-1])
d = ImageDraw.Draw(pil)
for (name, im), (x, y), t in zip(panels, pos, ["原版（官道非常明显）", "淡化 55%（隐约旧径）", "淡化 85%", "完全抹除（inpainting）"]):
    pil.paste(Image.fromarray(im[:, :, ::-1]).resize((tw, thh)), (x, y + cap))
    d.text((x + 4, y + 6), t, fill=(40, 34, 24), font=font)
sheet = np.array(pil)[:, :, ::-1]
ok, buf = cv2.imencode(".png", sheet)
buf.tofile(OUT + "官道处理对比图.png")
print("写出 官道处理对比图.png")
