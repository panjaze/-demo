# -*- coding: utf-8 -*-
"""
美术资产流水线：原图（1024 手绘绘本）→ 游戏用 sprite（512 RGBA 透明底）
流程：边缘洪泛抠底 → 只保留最大连通域（顺带去掉右下角水印/拆解组件）→
     裁切内容 + 底部锚定补成正方形 → 缩到 512 → 输出到 demo/assets/buildings/
用法：process_assets.py   （在本目录运行；生成 Lv2/Lv3 时往 TARGETS 里加行即可）
"""
import os, sys
from collections import deque
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '卡牌建城demo', 'assets', 'buildings'))
SIZE = 512          # 输出边长
MARGIN = 12         # 裁切后四周留白（输出像素）

# (源文件, 输出文件, 是否先裁左侧主体)  —— 主城原图是组件分解图，主体在左侧
TARGETS = [
    ('兵营Lv1-A-手绘策略绘本风.png', 'barracks.png', False),
    ('农田Lv1-A-原图.png',           'farm.png',     False),
    ('卡坊Lv1-A-原图.png',           'atelier.png',  False),
    ('能源站Lv1-A-原图.png',         'power.png',    False),
    ('防御塔Lv1-A-原图.png',         'tower.png',    False),
    ('主城Lv1-A-原图.png',           'castle.png',   True),
]

def flood_bg(rgb):
    """从边缘洪泛：与邻像素颜色相近（梯度平滑）或与边缘均值相近 → 背景"""
    h, w = rgb.shape[:2]
    border = np.zeros((h, w), bool)
    border[0, :] = border[-1, :] = True
    border[:, 0] = border[:, -1] = True
    vals = rgb[border].astype(np.float32)
    bg_mean = vals.mean(axis=0)
    dist_mean = np.sqrt(((rgb - bg_mean) ** 2).sum(axis=2))
    flat = rgb.reshape(-1, 3)

    def d_nb(ny, nx, y, x):
        return np.abs(rgb[ny, nx] - rgb[y, x]).sum()
    visited = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x]:
                visited[y, x] = True; q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if not visited[y, x]:
                visited[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                # 主判定：像背景 → 收；辅判定：与邻像素平滑且仍"大致像背景"才允许扩散
                # （防止顺着水彩晕染渗进建筑内部——兵营原图踩过）
                if dist_mean[ny, nx] <= 60 or (d_nb(ny, nx, y, x) <= 20 and dist_mean[ny, nx] <= 78):
                    visited[ny, nx] = True
                    q.append((ny, nx))
    return visited

def process(src_path, out_path, crop_left):
    im = Image.open(src_path).convert('RGB')
    if crop_left:                       # 主城：只留左侧主体（约左 2/3）
        im = im.crop((0, 0, int(im.width * 0.66), im.height))
    rgb = np.asarray(im).astype(np.float32)
    bg = flood_bg(rgb)
    fg = ~bg
    # 只保留最大连通域（去掉水印、拆解组件、飘散杂点）
    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        fg = lab == (int(np.argmax(sizes)) + 1)
    # 补洞（建筑内部与背景同色的小孔）
    fg = ndimage.binary_fill_holes(ndimage.binary_closing(fg, iterations=2))
    ys, xs = np.where(fg)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    # 底部锚定补正方形
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    side = max(bw, bh) + MARGIN * 2 * (SIZE / max(bw, bh))
    side = int(side)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    crop = Image.fromarray(np.dstack([rgb.astype(np.uint8), (fg * 255).astype(np.uint8)]))
    crop = crop.crop((int(x0), int(y0), int(x0) + bw, int(y0) + bh))
    px = (side - bw) // 2
    py = side - bh - MARGIN            # 底部对齐，脚下留少量边
    canvas.paste(crop, (px, py))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.save(out_path)
    op = (np.asarray(canvas)[..., 3] > 10).mean() * 100
    print(f'{os.path.basename(out_path):14s} 内容框 {bw}x{bh} 不透明 {op:.1f}%')

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    for src, out, cl in TARGETS:
        process(os.path.join(HERE, src), os.path.join(OUT, out), cl)
    print('输出目录：', OUT)
