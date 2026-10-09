# -*- coding: utf-8 -*-
"""A/B/C 底图 → 游戏资产（1740×900，网格对齐 60px 逻辑格）。
流程：去水印 → 分轴缩放（竖 53.2→60，横 51.1→60；C: 47/45.1→60）
  → 量缩放后相位 → 裁剪窗口边缘压在网格线上 → 不足处按"关于最后一条整线的镜像"补边（网格连续）。
输出：卡牌建城demo/assets/map/plate-{a,b,c}.png
"""
import os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO_MAP = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'map'))
T, COLS, ROWS = 60, 29, 15
W, H = COLS * T, ROWS * T          # 1740 x 900

PLATES = {
    'a': ('地图底图-A-欧陆棋盘-原图.png', 53.2, 51.1),
    'b': ('地图底图-B-率土土地-原图.png', 53.2, 51.1),
    'c': ('地图底图-C-综合版-原图.png', 47.0, 45.1),
}

def phase_of(img_gray, axis, pitch):
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

def kill_watermark(im):
    """右下角 AI 水印：取左侧相邻块水平翻转盖上（P 试点同款手法）"""
    w, h = im.size
    patch = im.crop((w - 480, h - 90, w - 240, h)).transpose(Image.FLIP_LEFT_RIGHT)
    im.paste(patch, (w - 240, h - 90))
    return im

def mirror_about_line(im, axis_last_line, need, axis):
    """关于"最后一条整网格线"镜像补 need 像素 → 网格线间隔在补边区继续成立"""
    if need <= 0:
        return im
    w, h = im.size
    if axis == 0:   # 向右补
        src = im.crop((axis_last_line - need, 0, axis_last_line, h)).transpose(Image.FLIP_LEFT_RIGHT)
        out = Image.new('RGB', (w + need, h))
        out.paste(im, (0, 0))
        out.paste(src, (w, 0))
    else:           # 向下补
        src = im.crop((0, axis_last_line - need, w, axis_last_line)).transpose(Image.FLIP_TOP_BOTTOM)
        out = Image.new('RGB', (w, h + need))
        out.paste(im, (0, 0))
        out.paste(src, (0, h))
    return out

def process(tag, name, px_pitch, py_pitch):
    im = Image.open(os.path.join(HERE, name)).convert('RGB')
    im = kill_watermark(im)
    w0, h0 = im.size
    sx, sy = T / px_pitch, T / py_pitch
    im = im.resize((round(w0 * sx), round(h0 * sy)), Image.LANCZOS)
    sw, sh = im.size

    gray = im.convert('L')
    phx = phase_of(gray, 0, T)          # 缩放后第一条竖线位置（0~60）
    phy = phase_of(gray, 1, T)

    # --- 水平：裁剪左缘压在竖线上；不够 1740 就关于最后整线镜像补 ---
    Lx = phx % T
    need_x = max(0, Lx + W - sw)
    if need_x > 0:
        last_line = Lx + T * ((sw - Lx) // T)          # ≤ sw 的最后一条整线
        im = mirror_about_line(im, int(last_line), int(need_x) + 1, 0)
    # --- 垂直：同理 ---
    Ly = phy % T
    need_y = max(0, Ly + H - sh)
    if need_y > 0:
        last_line = Ly + T * ((sh - Ly) // T)
        im = mirror_about_line(im, int(last_line), int(need_y) + 1, 1)
    sw, sh = im.size

    # C 富余 → 两侧均衡裁（保住四角山体量感）：在可行范围内取最接近居中的整线
    def balanced(phase, total, need):
        lo, hi = 0, int(total - need)
        kmax = (hi - phase) // T
        if kmax < 0:
            return int(phase)
        target = (hi - lo) / 2
        k = round((target - phase) / T)
        k = max(0, min(kmax, k))
        return int(phase + k * T)

    Lx2 = balanced(Lx, sw, W)
    Ly2 = balanced(Ly, sh, H)
    im = im.crop((Lx2, Ly2, Lx2 + W, Ly2 + H))

    out = os.path.join(DEMO_MAP, f'plate-{tag}.png')
    im.save(out)
    print(f'[{tag}] 原 {w0}x{h0} → 缩放 {sw}x{sh}(sx={sx:.3f},sy={sy:.3f}) 相位({phx:.0f},{phy:.0f}) '
          f'裁剪原点({Lx2},{Ly2}) → {out} {im.size}')
    return out

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    os.makedirs(DEMO_MAP, exist_ok=True)
    for tag, (name, px, py) in PLATES.items():
        process(tag, name, px, py)

if __name__ == '__main__':
    main()
