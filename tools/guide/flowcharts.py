#!/usr/bin/env python3
"""Black-and-white flowcharts for the MtnAI user guide (PIL only).

    python3 tools/guide/flowcharts.py <out-dir>

A chart is a list of nodes drawn top to bottom:
  ('start', text)            rounded box (start / end)
  ('step', text)             box
  ('dec', question, no_text) diamond; "Yes" goes down, "No" goes right to a box
  ('io', text)               slanted box (data in / out)
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
W = 1300          # px; placed 6 in wide -> 12 pt text = ~36 px
FS = 34
f = ImageFont.truetype(FONT, FS)
fb = ImageFont.truetype(BOLD, FS)
BLACK, WHITE = (0, 0, 0), (255, 255, 255)
MAIN_X, MAIN_W = 60, 760          # main column
SIDE_X, SIDE_W = 900, 360         # "No" column
GAP = 48


def wrap(d, text, font, width):
    lines = []
    for para in text.split('\n'):
        words, cur = para.split(), ''
        for w in words:
            t = (cur + ' ' + w).strip()
            if d.textlength(t, font=font) <= width:
                cur = t
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def text_block(d, x, y, w, h, text, font=f):
    lines = wrap(d, text, font, w - 36)
    lh = FS + 8
    ty = y + (h - lh * len(lines)) / 2
    for ln in lines:
        d.text((x + w / 2, ty + lh / 2), ln, font=font, fill=BLACK, anchor='mm')
        ty += lh


def box_h(d, text, w, pad=26):
    return max(84, len(wrap(d, text, f, w - 36)) * (FS + 8) + 2 * pad)


def arrow(d, x0, y0, x1, y1, label=None):
    d.line([(x0, y0), (x1, y1)], fill=BLACK, width=4)
    if x0 == x1:
        s = 1 if y1 > y0 else -1
        d.polygon([(x1, y1), (x1 - 13, y1 - 22 * s), (x1 + 13, y1 - 22 * s)], fill=BLACK)
    else:
        s = 1 if x1 > x0 else -1
        d.polygon([(x1, y1), (x1 - 22 * s, y1 - 13), (x1 - 22 * s, y1 + 13)], fill=BLACK)
    if label:
        if x0 == x1:
            d.text((x0 + 14, (y0 + y1) / 2), label, font=fb, fill=BLACK, anchor='lm')
        else:
            d.text(((x0 + x1) / 2, y0 - 10), label, font=fb, fill=BLACK, anchor='md')


def render(nodes, path):
    tmp = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    # layout pass
    lay, y = [], 30
    for n in nodes:
        kind = n[0]
        if kind == 'dec':
            h = max(170, len(wrap(tmp, n[1], f, MAIN_W * 0.62)) * (FS + 8) + 80)
            sh = box_h(tmp, n[2], SIDE_W)
            lay.append((n, y, h, sh))
            y += max(h, sh) + GAP + 20
        else:
            h = box_h(tmp, n[1], MAIN_W)
            lay.append((n, y, h, 0))
            y += h + GAP + 20
    H = y
    img = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(img)
    cx = MAIN_X + MAIN_W / 2
    prev_bottom = None
    for n, y0, h, sh in lay:
        kind = n[0]
        if prev_bottom is not None:
            arrow(d, cx, prev_bottom, cx, y0, 'Yes' if prev_kind == 'dec' else None)
        if kind == 'start':
            d.rounded_rectangle([MAIN_X, y0, MAIN_X + MAIN_W, y0 + h], radius=h / 2, outline=BLACK, width=4)
            text_block(d, MAIN_X, y0, MAIN_W, h, n[1], fb)
        elif kind == 'step':
            d.rectangle([MAIN_X, y0, MAIN_X + MAIN_W, y0 + h], outline=BLACK, width=4)
            text_block(d, MAIN_X, y0, MAIN_W, h, n[1])
        elif kind == 'io':
            k = 30
            d.polygon([(MAIN_X + k, y0), (MAIN_X + MAIN_W, y0), (MAIN_X + MAIN_W - k, y0 + h), (MAIN_X, y0 + h)], outline=BLACK, width=4)
            text_block(d, MAIN_X + k, y0, MAIN_W - 2 * k, h, n[1])
        elif kind == 'dec':
            top, mid, bot = (cx, y0), y0 + h / 2, (cx, y0 + h)
            d.polygon([top, (MAIN_X, mid), bot, (MAIN_X + MAIN_W, mid)], outline=BLACK, width=4)
            text_block(d, MAIN_X + MAIN_W * 0.19, y0, MAIN_W * 0.62, h, n[1])
            sy = mid - sh / 2
            d.rectangle([SIDE_X, sy, SIDE_X + SIDE_W, sy + sh], outline=BLACK, width=4)
            text_block(d, SIDE_X, sy, SIDE_W, sh, n[2])
            arrow(d, MAIN_X + MAIN_W, mid, SIDE_X, mid, 'No')
        prev_bottom, prev_kind = y0 + h, kind
    img.save(path, optimize=True)


CHARTS = {
    'workflow': [
        ('start', 'Start MtnAI (double-click MtnAI.html)'),
        ('dec', 'Do you have an elevation file (DEM)?', 'Download DEM, or use the demo terrain'),
        ('io', 'Add Data: the map turns into a grid of squares, each with a height'),
        ('step', 'MtnAI works out slope, aspect, landforms, contours and grids'),
        ('step', 'Place own position, enemy, target, start A and end B'),
        ('step', 'Draw No-Go areas (rivers, cliffs) and tracks if you know them'),
        ('step', 'Run tools: Go / No-Go, Key Terrain, Enemy Observation, Avenues'),
        ('step', 'Run siting tools: Posts / OPs, Weapon Sites, Minefields, Helipads'),
        ('step', 'Plan movement: Route A→B, Route Card, Picquets'),
        ('io', 'Check on the map, in 3D and in the attribute table'),
        ('start', 'Save the plan, export and print the report'),
    ],
    'download': [
        ('start', 'Download DEM tool'),
        ('step', 'Choose the source: Terrain Tiles (no key) or OpenTopography (key)'),
        ('step', 'Choose the area: centre and size, box, current view or DEM extent'),
        ('dec', 'Is the area 40,000 km² or less?', 'Stop: make the area smaller'),
        ('dec', 'Can the computer reach the internet?', 'Stop: use Add Data with a saved file'),
        ('step', 'Fetch the tiles and stitch them into one height picture'),
        ('io', 'Save a GeoTIFF copy (to use offline later)'),
        ('start', 'Load it as the working DEM'),
    ],
    'mobility': [
        ('start', 'For every square on the map'),
        ('step', 'Compare the slope with the limits:\nup to the GO limit = GO\nup to the SLOW-GO limit = SLOW-GO\nsteeper = NO-GO'),
        ('dec', 'Below the snow line (if one is set)?', 'Vehicles: NO-GO. Foot and mule: one class worse'),
        ('step', 'Optional: smooth out single odd squares (generalise)'),
        ('dec', 'Outside every drawn No-Go area?', 'NO-GO'),
        ('dec', 'Off the drawn tracks?', 'On a track: GO'),
        ('start', 'Colour the square: GO / SLOW-GO / NO-GO'),
    ],
    'keyterrain': [
        ('start', 'Look at every square'),
        ('dec', 'Highest point within the summit radius?', 'Not a height'),
        ('dec', 'Stands well above the area around it (dominance)?', 'Not a height'),
        ('io', 'Mark as a dominating height (keep the best ones)'),
        ('step', 'Walk a ring around each square: up, down, up, down?'),
        ('dec', 'Is there enough rise on both sides?', 'Not a pass'),
        ('start', 'Mark as a pass / col'),
    ],
    'visibility': [
        ('start', 'Pick the observer (and target for Line of Sight)'),
        ('step', 'Add observer and target heights above ground'),
        ('step', 'Look out along straight lines, like rays from a torch'),
        ('step', 'Bend for the earth\'s curve and the air (refraction)'),
        ('dec', 'Is the ground ahead hidden by something higher in between?', 'Visible: shade it'),
        ('step', 'Hidden: leave it clear (dead ground)'),
        ('start', 'LOS also gives the angle of sight and sight setting (slant range ÷ factor)'),
    ],
    'hostile': [
        ('start', 'Enemy position placed'),
        ('step', 'Search the high ground near the enemy for likely enemy OPs'),
        ('step', 'Keep the best few, spread apart'),
        ('step', 'Work out what each OP can see'),
        ('start', 'Shaded = enemy can see it; clear = hidden (defilade)'),
    ],
    'avenues': [
        ('start', 'Own and enemy positions placed'),
        ('step', 'Pick the enemy movement class (foot, wheels, tracks, mule)'),
        ('step', 'Find the quickest way from enemy to own position'),
        ('step', 'Make that path costly, find the next quickest (repeat)'),
        ('start', 'Draw the avenues and their corridors'),
    ],
    'posts': [
        ('start', 'Own and enemy positions placed'),
        ('step', 'Give each square a value: ground the enemy is likely to move on'),
        ('dec', 'Candidate site: slope, landform, distance and access OK?', 'Skip it'),
        ('step', 'Work out what each candidate can see (viewshed)'),
        ('step', 'Pick the site that sees the most new valuable ground'),
        ('step', 'Bonus if it is at a new height band (OPs at varying heights)'),
        ('dec', 'Enough posts?', 'Pick the next site'),
        ('step', 'Mark the most dominating post as the STRONG POINT'),
        ('step', 'Label each post: ridge line, mid slope or valley / foothill'),
        ('start', 'Show coverage, dead ground and which posts see each other'),
    ],
    'direct': [
        ('start', 'Choose a direct-fire weapon (MG, RPG, RR, ATGM)'),
        ('dec', 'Candidate site: slope, landform, defended area and access OK?', 'Skip it'),
        ('step', 'Look out to the weapon\'s range band'),
        ('dec', 'Target within the mount\'s up / down limits?', 'Dead to this weapon (plunging fire)'),
        ('step', 'Score: valuable ground, enfilade, nearer is better'),
        ('step', 'Pick the best sites, spread apart'),
        ('start', 'Show arcs of fire and the sight setting (slant range ÷ factor)'),
    ],
    'indirect': [
        ('start', 'Choose a mortar or gun; target area or enemy placed'),
        ('dec', 'Candidate: slope, access, behind own troops, in range?', 'Skip it'),
        ('dec', 'Can the shell clear the crests to the target?', 'Skip it (crest clearance)'),
        ('step', 'Score: hidden from enemy OPs, good range, flat, easy access'),
        ('start', 'Pick the best positions; show range, bearing and elevation'),
    ],
    'mfd': [
        ('start', 'Find enemy avenues of approach'),
        ('step', 'Walk along each avenue'),
        ('dec', 'Is the passable gap narrow (both sides blocked by No-Go)?', 'Not a defile'),
        ('step', 'Score: narrower is better; observed is better; in reach of own troops'),
        ('step', 'Valleys and foothills: extra value (GSP)'),
        ('dec', 'Ground below the steep-slope limit and the snow line?', 'Lower score: use wire'),
        ('step', 'Block every avenue at least once, then the next best'),
        ('start', 'Draw the minefield, tie it into No-Go ground, count mines'),
    ],
    'route': [
        ('start', 'Place start A and end B'),
        ('step', 'Cost of each step = time to walk or drive it (uphill / downhill aware)'),
        ('step', 'Add penalties: enemy can see it, skyline, nullah beds'),
        ('step', 'Find the cheapest path (A* search)'),
        ('step', 'Find alternatives that keep apart from the first route'),
        ('step', 'GSP time: 3 km/h day (0.5–1 night) + 30–60 min per 300 m up / 600 m down'),
        ('start', 'Show routes, checkpoints, profile and the route card'),
    ],
    'picquets': [
        ('start', 'A route has been found'),
        ('dec', 'Candidate height near the route, high enough and climbable in time?', 'Skip it'),
        ('step', 'Work out how much of the route each candidate can see'),
        ('step', 'Pick the heights that watch the most route, spread along it'),
        ('start', 'Show the picquets and the share of route watched'),
    ],
    'helipads': [
        ('start', 'Choose the use: regular (4°), light (10°) or cargo (20°)'),
        ('dec', 'Whole pad within the slope limit?', 'Skip it'),
        ('dec', 'Hidden from enemy observation (if required)?', 'Skip it'),
        ('dec', 'Not on a crest and reachable from own position?', 'Skip it'),
        ('step', 'Score: flatter, hidden, closer to own position'),
        ('start', 'Pick the best sites, spread apart'),
    ],
}

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'docs/guide/img'
    os.makedirs(out, exist_ok=True)
    for name, nodes in CHARTS.items():
        render(nodes, os.path.join(out, f'fc_{name}.png'))
    print(len(CHARTS), 'flowcharts written to', out)
