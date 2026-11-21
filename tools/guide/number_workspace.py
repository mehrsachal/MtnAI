#!/usr/bin/env python3
"""Numbered callouts on the workspace screenshot (positions for the 1800 px wide image)."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

d = sys.argv[1] if len(sys.argv) > 1 else 'docs/guide/img'
im = Image.open(os.path.join(d, '02_workspace.png')).convert('L')
dr = ImageDraw.Draw(im)
font = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', 30)
CALLOUTS = {1: (1700, 150), 2: (240, 227), 3: (620, 224), 4: (1270, 610), 5: (1690, 280), 6: (900, 1012), 7: (900, 1058), 8: (1360, 24)}
for n, (x, y) in CALLOUTS.items():
    r = 22
    dr.ellipse([x - r, y - r, x + r, y + r], fill=0, outline=255, width=3)
    dr.text((x, y), str(n), font=font, fill=255, anchor='mm')
im.save(os.path.join(d, '02_workspace_numbered.png'), optimize=True)
print('numbered workspace written')
