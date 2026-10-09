# -*- coding: utf-8 -*-
"""⚠️ 已废弃（2026-10-01），保留作查考：请改用 make_road_reclaim2.py。

废因：final 与 retex 两张底图的差异**不只是路面**——整片草地也被重做过纹理，
      差值掩膜在 (3,9) 等格里是一整块 ~80% 的斑块（打印形状已确认），逐格再取
      最大连通域就把这块斑当成了路。横截面采样证实真实官道在格里只有 ~15px 宽。

原：铺路表现方案 A 的素材：从 plate-final 抠出「清晰官道路面」透明层。

原理：官道路面是偏暖的土棕色，用 HSV 阈值在官道格内取路面像素 → 掩膜 →
      以掩膜为 alpha 从 plate-final 裁出 RGBA 透明层。
产物：
  road-reclaim.png   1740x900  只在 99 个官道格有清晰路面像素，其余全透明
                              （铺在官道格上 = 把长草旧径"开垦"回清晰官道，严丝合缝）
  road-stamp-h.png    60x60    横向直行路面材质（非官道格复用，保证画风一致）
  road-stamp-v.png    60x60    纵向直行路面材质
"""
import cv2
import numpy as np

SRC = "D:/工程/自研/卡牌建城demo/assets/map/plate-final.png"
OUT = "D:/工程/自研/图片素材/美术风格测试/"
TILE = 60
COLS, ROWS = 29, 15

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

img = cv2.imdecode(np.fromfile(SRC, dtype=np.uint8), cv2.IMREAD_COLOR)
H, W = img.shape[:2]
RET = "D:/工程/自研/卡牌建城demo/assets/map/plate-retex.png"
ret = cv2.imdecode(np.fromfile(RET, dtype=np.uint8), cv2.IMREAD_COLOR)

# 路面定位：final 与 retex 逐像素同构、只在路面掩膜内改色 → 差值即真实路面
diff = np.abs(img.astype(np.int16) - ret.astype(np.int16)).max(axis=2)
roadpx = diff > 18

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
    # 逐格取最大连通域 → 剔掉归一化卷积渗到旁边草地上的零散误判
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        m = (lab == keep).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    mask[y0:y0 + TILE, x0:x0 + TILE] = m

# 2px 羽化，让贴回底图时边缘不生硬
feather = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.1)
feather = np.clip(feather * 1.06, 0, 255).astype(np.uint8)

def write(path, arr):
    """中文路径下 cv2.imwrite 会失败 → imencode + tofile"""
    ext = "." + path.rsplit(".", 1)[1]
    ok, buf = cv2.imencode(ext, arr)
    if ok:
        buf.tofile(path)
    return ok


b, g, r = cv2.split(img)
rgba = cv2.merge([b, g, r, feather])
ok = write(OUT + "road-reclaim.png", rgba)
print("官道格处理数:", treated, " 路面像素:", int((feather > 40).sum()), " 写入:", ok)


def stamp(gx, gy, name):
    """裁单个官道格做成可复用的路面材质 stamp（透明背景）"""
    x0, y0 = gx * TILE, gy * TILE
    sub = rgba[y0:y0 + TILE, x0:x0 + TILE].copy()
    ok2 = write(OUT + name, sub)
    print(name, "像素:", int((sub[:, :, 3] > 40).sum()), " 写入:", ok2)


stamp(13, 8, "road-stamp-h.png")   # 横向直行（左右都是官道）
stamp(7, 7, "road-stamp-v.png")    # 纵向直行（上下都是官道）
