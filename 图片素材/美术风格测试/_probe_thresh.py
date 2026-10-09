# -*- coding: utf-8 -*-
"""走廊内路面判别：几种打分 + Otsu 自动阈值，挑出能把路认成「条」的那一个。"""
import numpy as np
from PIL import Image
import cv2

SRC = "D:/工程/自研/卡牌建城demo/assets/map/plate-final.png"
T = 60
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
arr = np.array(Image.open(SRC).convert('RGB')).astype(np.float32)
R, G, B = arr[..., 0], arr[..., 1], arr[..., 2]
H, W = R.shape
cor = np.zeros((H, W), np.uint8)
S = set(ROADS)
for (gx, gy) in ROADS:
    cv2.circle(cor, (gx * T + 30, gy * T + 30), 17, 255, -1)
    for dx, dy in [(1, 0), (0, 1)]:
        if (gx + dx, gy + dy) in S:
            cv2.line(cor, (gx * T + 30, gy * T + 30), ((gx + dx) * T + 30, (gy + dy) * T + 30), 255, 34)
inn = cor > 0

print('走廊 %.1f%%' % (inn.mean() * 100))
print('走廊内平均色 R%.0f G%.0f B%.0f' % (R[inn].mean(), G[inn].mean(), B[inn].mean()))


def otsu(score, mask):
    v = score[mask]
    v = np.clip(v, 0, 255).astype(np.uint8)
    th, _ = cv2.threshold(v, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return th


SCORES = {
    'R-G': R - G,
    '(R-G)*0.6+L*0.4': (R - G) * 0.6 + (0.3 * R + 0.59 * G + 0.11 * B) * 0.4,
    'R-(G+B)/2': R - (G + B) / 2,
    '饱和度倒数倾向': (R - G) - 0.35 * (G - B),
}
for name, sc in SCORES.items():
    th = otsu(sc, inn)
    m = inn & (sc >= th)
    print('%-18s Otsu阈值=%.1f  走廊内覆盖 %5.1f%%' % (name, th, m[inn].mean() * 100))
