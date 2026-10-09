# -*- coding: utf-8 -*-
"""官道处理 v2：纹理保留重上色（无雾方案）
原理：路面像素 = 本地地形色（归一化卷积估计，多尺度回退） × 原图高频细节（笔触/纹理）。
颜色换成地形色，纹理一点不丢 → 路变成"长草的旧径"，没有 inpainting 的雾斑。
桥格不动。
"""
import cv2
import numpy as np

SRC = "D:/工程/自研/卡牌建城demo/assets/map/plate-final.png"
OUT = "D:/工程/自研/图片素材/美术风格测试/"
BRIDGES = {(12, 8), (15, 11)}
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

img = cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR).astype(np.float32)
H, W = img.shape[:2]
hsv = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_HSV2BGR)  # placeholder no-op
hsv = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2HSV)
Hc, Sc, Vc = hsv[:, :, 0].astype(int), hsv[:, :, 1].astype(int), hsv[:, :, 2].astype(int)

roadpx = ((Hc >= 5) & (Hc <= 30) & (Sc >= 40) & (Sc <= 190) & (Vc >= 90) & (Vc <= 235))
mask = np.zeros((H, W), np.uint8)
treated = 0
for (gx, gy) in ROADS:
    if (gx, gy) in BRIDGES:
        continue
    x0, y0 = gx * TILE, gy * TILE
    cell = roadpx[y0:y0 + TILE, x0:x0 + TILE]
    if cell.mean() * 100 < 3:
        continue
    treated += 1
    m = np.zeros((TILE, TILE), np.uint8)
    m[cell] = 255
    mask[y0:y0 + TILE, x0:x0 + TILE] = m
mask = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=1)
print("处理格数:", treated, " 掩膜像素:", int((mask > 0).sum()))

valid = (mask == 0).astype(np.float32)

def norm_conv(sigma):
    """归一化卷积：只对非路面像素做高斯加权平均 → 本地地形色估计"""
    kb = cv2.GaussianBlur(img * valid[:, :, None], (0, 0), sigma)
    kv = cv2.GaussianBlur(valid, (0, 0), sigma)[:, :, None]
    return kb / np.maximum(kv, 1e-4), kv

# 多尺度地形色：小σ优先（更贴近周边），权重不足时回退大σ
terrain_s = [norm_conv(s) for s in (6, 16, 40, 90)]
terrain = np.zeros_like(img)
wsum = np.zeros((H, W, 1), np.float32)
for est, kv in terrain_s:
    w = np.clip((kv - 0.10) / 0.30, 0, 1)          # 该尺度下有效采样比例 → 置信度
    terrain += est * w
    wsum += w
terrain /= np.maximum(wsum, 1e-4)

# 高频细节 = 原图 / 低通(原图)，保留笔触与纹理
low = cv2.GaussianBlur(img, (0, 0), 3)
detail = img / np.maximum(low, 1.0)
detail = np.clip(detail, 0.62, 1.55)               # 钳住车辙等极端暗斑，防止噪点放大

retex = np.clip(terrain * detail, 0, 255)

# 羽化混合（只在路面掩膜内替换）
m_f = cv2.GaussianBlur(mask, (5, 5), 0).astype(np.float32) / 255.0
m3 = cv2.merge([m_f, m_f, m_f])
out = img * (1 - m3) + retex * m3
out = out.astype(np.uint8)

ok, buf = cv2.imencode(".png", out)
buf.tofile(OUT + "官道纹理保留.png")
print("写出 官道纹理保留.png")

# 对比图：原版 / 纹理保留 / 淡化55 / 抹除(弃用示例)
from PIL import Image, ImageDraw, ImageFont
def load(p):
    return cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)
panels = [
    ("原版（官道明显）", load(SRC)),
    ("纹理保留重上色（新方案·无雾）", load(OUT + "官道纹理保留.png")),
    ("淡化 55%（对照）", load(OUT + "官道淡化-轻55.png")),
    ("完全抹除（雾斑·弃用）", load(OUT + "官道抹除100.png")),
]
def thumb(im, w=860):
    return cv2.resize(im, (w, int(im.shape[0] * w / im.shape[1])), interpolation=cv2.INTER_AREA)
th = [thumb(p[1]) for p in panels]
tw, thh = th[0].shape[1], th[0].shape[0]
pad, cap = 16, 40
sheet = np.full((pad * 3 + (thh + cap) * 2, tw * 2 + pad * 3, 3), 245, np.uint8)
pos = [(pad, pad), (pad * 2 + tw, pad), (pad, pad * 2 + thh + cap), (pad * 2 + tw, pad * 2 + thh + cap)]
pil = Image.fromarray(sheet[:, :, ::-1])
d = ImageDraw.Draw(pil)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
except Exception:
    font = ImageFont.load_default()
for (t, im), (x, y) in zip(panels, pos):
    pil.paste(Image.fromarray(im[:, :, ::-1]).resize((tw, thh)), (x, y + cap))
    d.text((x + 4, y + 6), t, fill=(40, 34, 24), font=font)
ok, buf = cv2.imencode(".png", np.array(pil)[:, :, ::-1])
buf.tofile(OUT + "官道处理对比图.png")
print("对比图已更新")
