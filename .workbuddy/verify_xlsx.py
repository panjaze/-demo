# -*- coding: utf-8 -*-
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import openpyxl
wb = openpyxl.load_workbook('系统策划案-道路系统.xlsx')
ws = wb['系统说明']
hs = [(r, ws.row_dimensions[r].height) for r in range(1, 46) if ws.row_dimensions[r].height]
print('前 45 行行高:', hs[:14])
print('高行示例(>30):', [(r, round(h, 1)) for r, h in hs if h and h > 30][:6])
print('嵌图数:', len(ws._images))
print('列宽 A/B/C:', ws.column_dimensions['A'].width, ws.column_dimensions['B'].width, ws.column_dimensions['C'].width)
