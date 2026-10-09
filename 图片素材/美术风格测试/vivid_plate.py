# -*- coding: utf-8 -*-
"""地图画面优化：饱和度 + 轻微对比度提升（不改布局、不改风格，逐像素处理）
输入 plate-retex.png（官道旧径版），输出 plate-vivid.png
参数可调：SAT（饱和度增益）、CON（对比度增益）
"""
import cv2
import numpy as np

SRC = "D:/工程/自研/卡牌建城demo/assets/map/plate-retex.png"
OUT = "D:/工程/自研/卡牌建城demo/assets/map/plate-vivid.png"
CMP = "D:/工程/自研/图片素材/美术风格测试/画面优化对比.png"
SAT = 0.18   # 饱和度 +18%
CON = 1.05   # 对比度 ×1.05

img = cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR).astype(np.float32)
gray = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_BGR2GRAY).astype(np.float32)[:, :, None]
vivid = gray + (img - gray) * (1 + SAT)          # 经典饱和度公式：灰度 + (原图-灰度)×增益
vivid = (vivid - 128.0) * CON + 128.0            # 轻微对比度
vivid = np.clip(vivid, 0, 255).astype(np.uint8)

ok, buf = cv2.imencode('.png', vivid)
buf.tofile(OUT)
print('写出 plate-vivid.png')

# 上下对比图
from PIL import Image, ImageDraw, ImageFont
def thumb(im, w=880):
    return cv2.resize(im, (w, int(im.shape[0] * w / im.shape[1])), interpolation=cv2.INTER_AREA)
a, b = thumb(cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR)), thumb(vivid)
tw, thh = a.shape[1], a.shape[0]
pad, cap = 16, 40
sheet = np.full((pad * 3 + (thh + cap) * 2, tw + pad * 2, 3), 245, np.uint8)
pil = Image.fromarray(sheet[:, :, ::-1])
d = ImageDraw.Draw(pil)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
except Exception:
    font = ImageFont.load_default()
d.text((pad + 4, pad + 4), '优化前（retex）', fill=(40, 34, 24), font=font)
pil.paste(Image.fromarray(a[:, :, ::-1]), (pad, pad + cap))
y2 = pad * 2 + cap + thh
d.text((pad + 4, y2 + 4), '优化后（饱和度 +18% · 对比度 ×1.05）', fill=(40, 34, 24), font=font)
pil.paste(Image.fromarray(b[:, :, ::-1]), (pad, y2 + cap))
ok, buf = cv2.imencode('.png', np.array(pil)[:, :, ::-1])
buf.tofile(CMP)
print('对比图完成')
