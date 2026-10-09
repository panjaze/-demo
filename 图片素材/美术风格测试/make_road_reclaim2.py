# -*- coding: utf-8 -*-
"""官道提取 v2 —— 取代整套「final 减 retex 差值」办法。

v1 为什么废（已实证）：
    plate-final 与 plate-retex 之间除了路面，还有整片草地在重做纹理时被改动，
    差值掩膜在诸如 (3,9) 这样的格子里是**一整块 ~80% 的斑块**（打印形状已确认），
    逐格再取「最大连通域」就把这块斑当成路 → 贴回去只是把用户嫌弃的方块换了软边版本。
    横截面采样证实：真实官道在格里只有 ~15px 宽（≈25% 格宽），且不一定居中。

v2 做法：
    1) 用官道坐标表画 34px 宽的走廊 → 路面必在走廊内（排除全野russet干草的误判）；
    2) 走廊内以 R-G 打分 + Otsu 自动阈值认路面 → 得到沿路径的窄带；
    3) 逐格取最大连通域 → 清掉零散误判；覆盖率过低的格判定「该格底图本就没画路」→ 不产出；
    4) ★ 归位：按该格路条的质心把内容平移到格心。否则 15px 的路条偏在格子一侧，
       与相邻格的带状路对不齐，交界处会拧出错位。
    5) 输出 RGBA：只在官道格有像素，其余全透明。

产物：卡牌建城demo/assets/map/road-reclaim.png  1740x900
"""
import numpy as np
import cv2
from PIL import Image

SRC = "D:/工程/自研/卡牌建城demo/assets/map/plate-final.png"
OUTDIR = "D:/工程/自研/卡牌建城demo/assets/map/"
OUTNAME = "road-reclaim.png"
T, COLS, ROWS = 60, 29, 15
BRIDGES = {(12, 8), (15, 11)}
MIN_COV = 8.0      # 低于该覆盖率判定「这格底图没画路」→ 不产出，交给程序化带状路
MAX_COV = 50.0     # 高于则是底图里本就有的大片空地/路口广场（实测 (8,6)=93%、(27,5)=82%），
                   # 单独一格铺路却露出一大片土场 → 同样判废
MAX_SHIFT = 20     # 质心偏移超过该值说明不是穿越型路条 → 同样不产出

ROADS = [
    (0, 10), (1, 10), (2, 9), (2, 10), (2, 11), (2, 12), (2, 13),
    (3, 4), (3, 5), (3, 6), (3, 7), (3, 8), (3, 9), (3, 10), (3, 13), (3, 14),
    (4, 6), (4, 10), (4, 13), (5, 6), (5, 9), (5, 10), (5, 12), (5, 13),
    (6, 6), (6, 10), (6, 11), (6, 12), (6, 13),
    (7, 6), (7, 7), (7, 8), (7, 9), (7, 10), (7, 11), (7, 12), (7, 13),
    (8, 5), (8, 6), (8, 7), (8, 8), (8, 9), (8, 10), (8, 13),
    (9, 6), (9, 7), (9, 8), (10, 8), (11, 8), (12, 8), (13, 8), (14, 8), (15, 8),
    (15, 10), (15, 11), (16, 8), (16, 10), (17, 8), (17, 9), (17, 10),
    (18, 5), (18, 6), (18, 7), (18, 8), (19, 6), (19, 8),
    (20, 5), (20, 6), (20, 8), (21, 5),
    (22, 3), (22, 4), (22, 5), (22, 6), (22, 7), (22, 8), (22, 9), (22, 10),
    (23, 5),
    (24, 3), (24, 4), (24, 5), (24, 6), (24, 7), (24, 8), (24, 9), (24, 10),
    (25, 5), (25, 10), (26, 5), (26, 10), (26, 11), (27, 4), (27, 5), (27, 6), (27, 10), (27, 11),
    (28, 4), (28, 11),
]


def load(path):
    return cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)


def save(path, arr):
    ext = "." + path.rsplit(".", 1)[1]
    ok, buf = cv2.imencode(ext, arr)
    if ok:
        buf.tofile(path)
    return ok


def main():
    img = load(SRC)
    H, W = img.shape[:2]
    arr = img.astype(np.float32)
    R, G = arr[..., 2], arr[..., 1]          # cv2 读进来是 BGR

    # ---- 走廊 ----
    cor = np.zeros((H, W), np.uint8)
    S = set(ROADS)
    for (gx, gy) in ROADS:
        cv2.circle(cor, (gx * T + 30, gy * T + 30), 17, 255, -1)
        for dx, dy in [(1, 0), (0, 1)]:
            if (gx + dx, gy + dy) in S:
                cv2.line(cor, (gx * T + 30, gy * T + 30),
                         ((gx + dx) * T + 30, (gy + dy) * T + 30), 255, 34)
    inn = cor > 0

    # ---- 走廊内 R-G 打分 + Otsu ----
    sc = R - G
    th, _ = cv2.threshold(np.clip(sc[inn], 0, 255).astype(np.uint8), 0, 255,
                          cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    m = (inn & (sc >= float(th))).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    # ---- 全图剔小连通域（路面必是长条，零散误判都是小斑）----
    nlab, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(nlab, np.uint8)
    for i in range(1, nlab):
        if stats[i, cv2.CC_STAT_AREA] >= 600:
            keep[i] = 1
    m = (keep[lab] > 0).astype(np.uint8) * 255

    # ---- 逐格处理：最大连通域 → 覆盖率 → 质心归位 ----
    outA = np.zeros((H, W), np.uint8)
    rows = []
    for (gx, gy) in ROADS:
        if (gx, gy) in BRIDGES:
            continue
        x0, y0 = gx * T, gy * T
        # 取窗口：本格外扩 14px，便于把跨界路条完整收进来
        ex0, ey0 = max(0, x0 - 14), max(0, y0 - 14)
        ex1, ey1 = min(W, x0 + T + 14), min(H, y0 + T + 14)
        win = m[ey0:ey1, ex0:ex1]
        nw, lw, sw, _ = cv2.connectedComponentsWithStats(win, 8)
        if nw <= 1:
            rows.append((gx, gy, 0, 0, 0, 'no-comp'))
            continue
        # 只保留与本格中心矩形相交的分量，选最大的那个
        cx_in, cy_in = x0 - ex0, y0 - ey0
        best_i, best_area = 0, 0
        for i in range(1, nw):
            bx, by, bw, bh, area = sw[i]
            if bx <= cx_in + T and by <= cy_in + T and bx + bw >= cx_in and by + bh >= cy_in:
                inter = (min(bx + bw, cx_in + T) - max(bx, cx_in)) * (min(by + bh, cy_in + T) - max(by, cy_in))
                if inter > best_area:
                    best_area, best_i = inter, i
        if not best_i:
            rows.append((gx, gy, 0, 0, 0, 'no-overlap'))
            continue
        comp = (lw == best_i).astype(np.uint8)
        tilecrop = comp[cy_in:cy_in + T, cx_in:cx_in + T]
        cov = tilecrop.mean() * 100
        if cov < MIN_COV:
            rows.append((gx, gy, round(cov, 1), 0, 0, 'too-thin'))
            continue
        if cov > MAX_COV:
            rows.append((gx, gy, round(cov, 1), 0, 0, 'too-wide'))
            continue
        ys, xs = np.nonzero(tilecrop)
        cxp, cyp = xs.mean(), ys.mean()
        dx, dy = cxp - T / 2.0, cyp - T / 2.0
        if abs(dx) > MAX_SHIFT or abs(dy) > MAX_SHIFT:
            rows.append((gx, gy, round(cov, 1), round(dx), round(dy), 'shift-too-big'))
            continue
        # 归位：把窗口内的完整路条平移 (-dx,-dy) 写回本格
        ys2, xs2 = np.nonzero(comp)
        px = xs2 + ex0 - int(round(dx))
        py = ys2 + ey0 - int(round(dy))
        ok = (px >= 0) & (px < W) & (py >= 0) & (py < H)
        outA[py[ok], px[ok]] = 255
        rows.append((gx, gy, round(cov, 1), round(dx), round(dy), 'ok'))

    # ---- 边缘羽化（3px），贴回底图时不生硬 ----
    alpha = cv2.GaussianBlur(outA.astype(np.float32), (0, 0), 1.0)
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    rgba = cv2.merge([img[..., 0], img[..., 1], img[..., 2], alpha])
    okw = save(OUTDIR + OUTNAME, rgba)

    okc = sum(1 for r in rows if r[5] == 'ok')
    print('官道格 %d → 产出 %d 格；路面像素 %d；写入 %s' %
          (len(rows), okc, int((alpha > 40).sum()), okw))
    bad = [r for r in rows if r[5] != 'ok']
    if bad:
        print('未产出的格（这些格在游戏里自动退化为程序化带状路）:')
        for r in bad:
            print('   (%d,%d) cov=%s dx=%s dy=%s  %s' % r)


if __name__ == '__main__':
    main()
