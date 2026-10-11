# -*- coding: utf-8 -*-
"""md 策划案 → xlsx（办公蓝美化 v3：显式行高 + 大单元格 + 富文本 + 嵌图）
行高策略：合并单元格不会自动扩高（Excel 行为），因此每行按「文本显示宽 ÷ 合并区宽」
显式计算行数与行高；短行给足呼吸感（21），长行按需增高。
"""
import sys, io, re, os, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC = sys.argv[1]; DST = sys.argv[2]
BASE = os.path.dirname(os.path.abspath(SRC))

# ---------- 办公蓝色板 ----------
C_BANNER, C_BANNER_T = '2F5496', 'FFFFFF'
C_SEC, C_SEC_T = 'DCE6F1', '1F3864'
C_BODY, C_EDGE, C_NOTE, C_GOLD = '333333', 'B8CCE4', '808080', 'BF8F00'
F_TITLE = Font(bold=True, size=15, color=C_BANNER_T)
F_H2    = Font(bold=True, size=12.5, color=C_BANNER_T)
F_H3    = Font(bold=True, size=12.5, color=C_SEC_T)
F_H4    = Font(bold=True, size=11.5, color=C_BANNER)
F_HEAD  = Font(bold=True, size=11, color=C_SEC_T)
F_BODY  = Font(size=11, color=C_BODY)
F_NOTE  = Font(size=10, italic=True, color=C_NOTE)
FILL_BANNER = PatternFill('solid', fgColor=C_BANNER)
FILL_SEC    = PatternFill('solid', fgColor=C_SEC)
THIN = Side(style='thin', color=C_EDGE)
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP  = Alignment(wrap_text=True, vertical='top')
WRAPC = Alignment(wrap_text=True, vertical='center')
SPAN = 6
FS = 11                       # 正文字号
LINE_H = 16.5                 # 每行文本行高
H_SINGLE = 22                 # 单行呼吸高度
H_GAP = 9                     # 空行
CW = 2 if (ord('中') > 255) else 2   # 中文按 2 个半角宽

def dispw(s):
    return sum(2 if ord(ch) > 255 else 1 for ch in re.sub(r'\*\*', '', s or ''))

# ---------- 解析 ----------
lines = open(SRC, encoding='utf-8').read().split('\n')
sheets, cur, in_code, code_buf, table_buf = [], None, False, [], []

def flush_table():
    global table_buf
    if table_buf and cur is not None:
        rows = []
        for ln in table_buf:
            cells = [c.strip() for c in ln.strip().strip('|').split('|')]
            if all(re.fullmatch(r':?-{3,}:?', c) for c in cells if c):
                continue
            rows.append(cells)
        if rows:
            cur['blocks'].append({'type': 'table', 'rows': rows})
    table_buf = []

for ln in lines:
    if ln.strip().startswith('```'):
        if in_code:
            cur['blocks'].append({'type': 'code', 'lines': code_buf}); code_buf = []
        else:
            flush_table(); code_buf = []
        in_code = not in_code
        continue
    if in_code:
        code_buf.append(ln); continue
    if ln.strip().startswith('|'):
        table_buf.append(ln); continue
    flush_table()
    m_img = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)\s*$', ln.strip())
    if ln.startswith('# '):
        cur = {'title': ln[2:].strip(), 'blocks': []}; sheets.append(cur); continue
    if ln.startswith('## '):
        name = re.sub(r'^[一二三四五六七八九十]+、', '', ln[3:].strip())
        name = re.sub(r'[\\/:*?\[\]]', '', name)[:28] or 'Sheet'
        cur = {'title': name, 'blocks': []}; sheets.append(cur); continue
    if not cur:
        continue
    if m_img:
        cur['blocks'].append({'type': 'image', 'title': m_img.group(1),
                              'path': m_img.group(2) if os.path.isabs(m_img.group(2)) else os.path.join(BASE, m_img.group(2))})
        continue
    if ln.startswith('### '):
        cur['blocks'].append({'type': 'h3', 'text': ln[4:].strip()}); continue
    if ln.startswith('#### '):
        cur['blocks'].append({'type': 'h4', 'text': ln[5:].strip()}); continue
    if ln.strip().startswith('>'):
        cur['blocks'].append({'type': 'quote', 'text': ln.strip().lstrip('>').strip()}); continue
    if ln.strip():
        cur['blocks'].append({'type': 'text', 'text': ln.rstrip()})
    elif cur['blocks'] and cur['blocks'][-1]['type'] != 'blank':
        cur['blocks'].append({'type': 'blank'})
flush_table()

# ---------- 富文本 ----------
def rich(text, size=FS, color=C_BODY):
    try:
        from openpyxl.cell.rich_text import CellRichText, TextBlock
        from openpyxl.cell.text import InlineFont
        parts = []
        for i, seg in enumerate(re.split(r'\*\*(.+?)\*\*', text)):
            if not seg: continue
            if i % 2:
                parts.append(TextBlock(InlineFont(sz=size, b=True, color=color), seg))
            else:
                parts.append(seg)
        if any(isinstance(p, TextBlock) for p in parts):
            return CellRichText(*parts)
    except Exception:
        pass
    return re.sub(r'\*\*(.+?)\*\*', r'\1', text)

# ---------- 写 xlsx ----------
wb = openpyxl.Workbook(); wb.remove(wb.active)
NCOLS = 7

for sh in sheets:
    ws = wb.create_sheet(sh['title'][:28])
    colw = {1: 24}
    for c in range(2, NCOLS + 1):
        colw[c] = 36
    for b in sh['blocks']:
        if b['type'] != 'table':
            continue
        for row in b['rows']:
            for ci, v in enumerate(row[:NCOLS]):
                colw[ci + 1] = max(colw.get(ci + 1, 14), min(dispw(v) + 3, 58))
    for c in range(1, NCOLS + 1):
        ws.column_dimensions[get_column_letter(c)].width = colw.get(c, 36)
    body_w = sum(colw[c] for c in range(2, NCOLS + 1))   # 正文合并区可用宽（列宽单位≈半角字符）

    r = 1
    img_jobs = []
    def H(text, width):
        """按文本显示宽与可用宽估算合并单元格所需行高"""
        n = max(1, math.ceil(dispw(text) / max(8, width - 3)))
        return max(H_SINGLE, n * LINE_H + 6)

    for b in sh['blocks']:
        if b['type'] == 'h1':
            ws.cell(r, 1, '● ' + b['text']).font = F_TITLE
            for c in range(1, NCOLS + 1): ws.cell(r, c).fill = FILL_BANNER
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NCOLS)
            ws.cell(r, 1).alignment = Alignment(vertical='center')
            ws.row_dimensions[r].height = 30; r += 2
        elif b['type'] == 'h2':
            ws.cell(r, 1, '● ' + b['text']).font = F_H2
            for c in range(1, NCOLS + 1): ws.cell(r, c).fill = FILL_BANNER
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NCOLS)
            ws.cell(r, 1).alignment = Alignment(vertical='center')
            ws.row_dimensions[r].height = 26; r += 2
        elif b['type'] == 'h3':
            ws.cell(r, 1, b['text']).font = F_H3
            for c in range(1, NCOLS + 1): ws.cell(r, c).fill = FILL_SEC
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NCOLS)
            ws.cell(r, 1).alignment = Alignment(vertical='center')
            ws.row_dimensions[r].height = 24; r += 1
        elif b['type'] == 'h4':
            c = ws.cell(r, 1, b['text']); c.font = F_H4
            c.border = Border(bottom=Side(style='medium', color=C_BANNER))
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NCOLS)
            ws.row_dimensions[r].height = 22; r += 1
        elif b['type'] == 'quote':
            c = ws.cell(r, 2, b['text']); c.font = F_NOTE; c.alignment = WRAP
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=NCOLS)
            ws.row_dimensions[r].height = H(b['text'], body_w) - 6; r += 1
        elif b['type'] == 'text':
            txt = re.sub(r'^\s*-\s+', '', b['text'])
            is_star = txt.strip().startswith('★') or txt.strip().startswith('**★')
            color = C_GOLD if is_star else C_BODY
            c = ws.cell(r, 2, rich(txt, color=color))
            c.font = Font(size=FS, color=color, bold=is_star); c.alignment = WRAP
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=NCOLS)
            ws.row_dimensions[r].height = H(txt, body_w); r += 1
        elif b['type'] == 'blank':
            ws.row_dimensions[r].height = H_GAP; r += 1
        elif b['type'] == 'code':
            for cl in b['lines']:
                c = ws.cell(r, 2, cl)
                c.font = Font(name='Consolas', size=10, color=C_BODY); c.alignment = WRAP
                ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=NCOLS)
                ws.row_dimensions[r].height = H(cl, body_w) - 4; r += 1
            r += 1
        elif b['type'] == 'table':
            rows = b['rows']
            ncol = max(len(x) for x in rows)
            for ri, row in enumerate(rows):
                mx = 1
                for ci in range(ncol):
                    v = row[ci] if ci < len(row) else ''
                    c = ws.cell(r, 1 + ci, rich(v, color=C_SEC_T if ri == 0 else C_BODY))
                    c.font = F_HEAD if ri == 0 else F_BODY
                    c.alignment = WRAPC; c.border = BORDER
                    if ri == 0: c.fill = FILL_SEC
                    mx = max(mx, math.ceil(dispw(v) / max(6, colw.get(ci + 1, 30) - 2)))
                ws.row_dimensions[r].height = max(H_SINGLE, mx * (LINE_H - 1) + 6)
                r += 1
            ws.row_dimensions[r].height = H_GAP; r += 1
        elif b['type'] == 'image':
            if os.path.exists(b['path']):
                c = ws.cell(r, 2, ('▲ ' + b['title']) if b['title'] else '')
                c.font = Font(bold=True, size=11, color=C_BANNER)
                ws.row_dimensions[r].height = 20; r += 1
                img_jobs.append((b['path'], r + 1))
                try:
                    from PIL import Image as PILImage
                    w, h = PILImage.open(b['path']).size
                    disp_h = h * 0.55
                    rows_n = int(disp_h / 19) + 2
                    for i in range(rows_n):
                        ws.row_dimensions[r + i].height = 19
                    r += rows_n
                except Exception:
                    r += 26
            else:
                c = ws.cell(r, 2, '[缺图] ' + b['path']); c.font = F_NOTE
                ws.row_dimensions[r].height = 18; r += 1
    for path, anchor in img_jobs:
        try:
            from openpyxl.drawing.image import Image as XLImage
            xi = XLImage(path)
            xi.width = int(xi.width * 0.55); xi.height = int(xi.height * 0.55)
            ws.add_image(xi, f'B{anchor}')
        except Exception as e:
            print('嵌图失败(不影响表格):', e)
wb.save(DST)
print('OK', DST, '| sheets:', ', '.join(s['title'][:12] for s in sheets))
