# -*- coding: utf-8 -*-
"""把「铺路前 / 铺路后」两张实机截图拼成一张带标注的对照图"""
from PIL import Image, ImageDraw, ImageFont

HERE = 'D:/工程/自研/图片素材/美术风格测试/'
before = Image.open(HERE + '_对比_铺路前.png').convert('RGB')
after = Image.open(HERE + '_对比_铺路后.png').convert('RGB')
W = min(before.width, after.width)
H = min(before.height, after.height)
before = before.crop((0, 0, W, H))
after = after.crop((0, 0, W, H))

FONT = 'C:/Windows/Fonts/msyh.ttc'
f_t = ImageFont.truetype(FONT, 34)
f_l = ImageFont.truetype(FONT, 28)
f_s = ImageFont.truetype(FONT, 22)

PAD, BAR, GAP = 24, 96, 44
sub = ImageFont.truetype(FONT, 24)
out_w = W + PAD * 2
out_h = BAR + H + 30 + GAP + H + 30 + 70
out = Image.new('RGB', (out_w, out_h), (32, 30, 26))
d = ImageDraw.Draw(out)

d.text((PAD, 26), '铺路表现 · 实机对照（第三十九次修订：铺路 = 开垦旧官道）', font=f_t, fill=(240, 232, 210))
d.text((PAD, 66), '同一相机同一区域：上=未铺路，下=沿旧官道 + 新建支路', font=f_s, fill=(168, 160, 140))

y = BAR
d.text((PAD, y - 30), '① 未铺路（只有两座木桥）', font=f_l, fill=(226, 214, 186))
out.paste(before, (PAD, y))
y += H + 30 + GAP
d.text((PAD, y - 30), '② 已铺路', font=f_l, fill=(226, 214, 186))
out.paste(after, (PAD, y))

ty = out_h - 52
d.text((PAD, ty), '说明：官道格会多叠一层从底图剥出的真实旧官道路面（bx=3 纵线 / y=8 横线）；'
                  '没有底图官道的格（x=15 往北）走程序化带状路。两者路心色差仅 10/255，观感一致。',
       font=f_s, fill=(150, 144, 128))

p = HERE + '铺路实机对照-2026-10-01.png'
out.save(p)
print('输出', p, out.size)
