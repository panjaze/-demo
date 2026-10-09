# -*- coding: utf-8 -*-
"""量测三张 A/B/C 底图烘进去的网格：间距（px）+ 行列数 + 相位（第一条线位置）。
方法：按列/行求"暗度均值"信号 → 去基线 → 自相关找主周期（30~110px 搜索窗）。"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PLATES = {
    'A': '地图底图-A-欧陆棋盘-原图.png',
    'B': '地图底图-B-率土土地-原图.png',
    'C': '地图底图-C-综合版-原图.png',
}

def pitch_of(img_gray, axis):
    """axis=0 沿列方向（找竖线间距）；axis=1 沿行方向（找横线间距）"""
    a = 255.0 - np.asarray(img_gray, dtype=np.float64)      # 暗度
    sig = a.mean(axis=1 if axis == 0 else 0)                 # 每列/每行平均暗度
    n = len(sig)
    # 去基线（滑动均值窗 120px）
    k = 121
    pad = np.pad(sig, k // 2, mode='edge')
    base = np.convolve(pad, np.ones(k) / k, mode='valid')[:n]
    s = sig - base
    s -= s.mean()
    # 自相关
    ac = np.correlate(s, s, mode='full')[n - 1:]
    ac /= (ac[0] + 1e-9)
    lo, hi = 30, 110
    seg = ac[lo:hi]
    p = int(np.argmax(seg)) + lo
    # 抛物线细化到亚像素
    if 1 <= p < len(ac) - 1:
        y0, y1, y2 = ac[p - 1], ac[p], ac[p + 1]
        denom = (y0 - 2 * y1 + y2)
        d = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-9 else 0.0
        p = p + max(-1.0, min(1.0, d))
    return p, ac

def phase_of(img_gray, axis, pitch):
    """第一条网格线出现的位置（0~pitch）。取信号与"冲激串"互相关拟合相位。"""
    a = 255.0 - np.asarray(img_gray, dtype=np.float64)
    sig = a.mean(axis=1 if axis == 0 else 0)
    n = len(sig)
    k = 121
    pad = np.pad(sig, k // 2, mode='edge')
    base = np.convolve(pad, np.ones(k) / k, mode='valid')[:n]
    s = sig - base
    idx = np.arange(n)
    best, bestv = 0.0, -1e18
    for ph in np.arange(0, pitch, 0.5):
        comb = ((idx - ph) % pitch < 2.0).astype(np.float64)
        v = float((s * comb).sum())
        if v > bestv:
            bestv, best = v, ph
    return best

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    for tag, name in PLATES.items():
        im = Image.open(os.path.join(HERE, name)).convert('L')
        px, _ = pitch_of(im, 0)
        py, _ = pitch_of(im, 1)
        phx = phase_of(im, 0, px)
        phy = phase_of(im, 1, py)
        w, h = im.size
        cols = w / px
        rows = h / py
        # 缩放到 60px/格后能否盖住 1740×900
        s = 60.0 / px
        sw, sh = w * s, h * s
        print(f"[{tag}] {w}x{h}  竖线间距 {px:.1f}px（{cols:.1f} 列）  横线间距 {py:.1f}px（{rows:.1f} 行）")
        print(f"     相位 x={phx:.1f} y={phy:.1f}  → 缩放 s={s:.3f} 得 {sw:.0f}x{sh:.0f}"
              f"  （需 ≥1740x900：{'够' if sw >= 1740 and sh >= 900 else '不够，需镜像补边'}）")

if __name__ == '__main__':
    main()
