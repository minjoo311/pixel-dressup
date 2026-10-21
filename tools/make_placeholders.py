"""
임시(플레이스홀더) 픽셀 에셋 생성기.
진짜 아트(PixelLab)가 준비되면 같은 파일명으로 덮어쓰면 된다.

실행:  python3 tools/make_placeholders.py
"""
import colorsys
import json
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
A = os.path.join(ROOT, "assets")
W = H = 128

OUTLINE = (0x2B, 0x1D, 0x1A)
OUTLINE2 = (0x4A, 0x30, 0x2A)

# 예약색 (options.json 의 _source 와 반드시 일치)
SKIN_SRC = ["#f5d0b6", "#e0ab8c", "#c4876b", "#8f5a47"]
HAIR_SRC = ["#5a3a2b", "#3f2618", "#28170e"]


# ---------------------------------------------------------------- helpers
def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def ramp(base, n=3):
    """base 색으로 [밝음, 기본, 어두움(, 더 어두움)] 램프 생성"""
    r, g, b = [v / 255 for v in hx(base)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    out = []
    for dl, ds in ([(0.10, -0.05), (0, 0), (-0.13, 0.05)] if n == 3 else
                   [(0.10, -0.05), (0, 0), (-0.12, 0.05), (-0.24, 0.08)]):
        rr, gg, bb = colorsys.hls_to_rgb(h, max(0, min(1, l + dl)), max(0, min(1, s + ds)))
        out.append((round(rr * 255), round(gg * 255), round(bb * 255)))
    return out


def mask():
    return np.zeros((H, W), bool)


def draw_mask(fn, size=(W, H)):
    im = Image.new("L", size, 0)
    fn(ImageDraw.Draw(im))
    return np.array(im) > 0


def ell(box):
    return draw_mask(lambda d: d.ellipse(box, fill=255))


def poly(pts):
    return draw_mask(lambda d: d.polygon(pts, fill=255))


def rect(box):
    return draw_mask(lambda d: d.rectangle(box, fill=255))


def line(pts, width=1):
    return draw_mask(lambda d: d.line(pts, fill=255, width=width))


def sym(m):
    """좌측만 그린 마스크를 좌우대칭으로"""
    return m | m[:, ::-1]


def flip(m):
    return m[:, ::-1]


def rows(m, y0, y1):
    out = m.copy()
    out[:y0, :] = False
    out[y1 + 1:, :] = False
    return out


def cols(m, x0, x1):
    out = m.copy()
    out[:, :x0] = False
    out[:, x1 + 1:] = False
    return out


def dilate(m, n=1, horiz_only=False):
    out = m.copy()
    for _ in range(n):
        o = out.copy()
        o[:, 1:] |= out[:, :-1]
        o[:, :-1] |= out[:, 1:]
        if not horiz_only:
            o[1:, :] |= out[:-1, :]
            o[:-1, :] |= out[1:, :]
        out = o
    return out


def edge(m):
    """마스크 안쪽 테두리 픽셀"""
    inner = m.copy()
    inner[1:, :] &= m[:-1, :]
    inner[:-1, :] &= m[1:, :]
    inner[:, 1:] &= m[:, :-1]
    inner[:, :-1] &= m[:, 1:]
    inner[0, :] = inner[-1, :] = False
    inner[:, 0] = inner[:, -1] = False
    return m & ~inner


def shade(m, rmp, outline=OUTLINE, light_left=True):
    """마스크 하나를 외곽선+3단 명암으로 칠한 RGBA 배열"""
    img = np.zeros((H, W, 4), np.uint8)
    hi, base, sh = rmp[0], rmp[1], rmp[2]
    img[m] = (*base, 255)
    # 오른쪽 2px 그림자
    right = m.copy()
    right[:, :-2] &= ~(m[:, 2:])
    right &= m
    img[right] = (*sh, 255)
    # 아래쪽 1px 그림자
    bottom = m.copy()
    bottom[:-1, :] &= ~m[1:, :]
    img[bottom & m] = (*sh, 255)
    # 왼쪽+위 하이라이트
    left = m.copy()
    left[:, 2:] &= ~m[:, :-2]
    left[:, :2] = m[:, :2]
    top = m.copy()
    top[2:, :] &= ~m[:-2, :]
    img[(left | top) & m & ~right] = (*hi, 255)
    img[edge(m)] = (*outline, 255)
    return img


def paint(img, m, color):
    img[m] = (*color, 255)
    return img


def comp(*layers):
    out = np.zeros((H, W, 4), np.uint8)
    for L in layers:
        a = L[..., 3] > 0
        out[a] = L[a]
    return out


def save(arr, path):
    full = os.path.join(A, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    Image.fromarray(arr, "RGBA").save(full)


# ---------------------------------------------------------------- body geometry
HEAD = ell((46, 16, 81, 51))
EARS = sym(ell((43, 32, 49, 42)))
NECK = rect((59, 48, 68, 57))
TORSO = sym(poly([(47, 57), (63, 55), (63, 92), (49, 92), (49, 88), (52, 79), (52, 72), (50, 64)]))
LEG_L = poly([(49, 88), (63, 88), (62, 104), (61, 117), (54, 117), (51, 104)])
LEG_R = flip(LEG_L)
LEGS = LEG_L | LEG_R
FOOT_L = ell((51, 114, 62, 123))
FOOT_R = flip(FOOT_L)
FEET = FOOT_L | FOOT_R
ARM_L = poly([(47, 57), (53, 59), (49, 73), (46, 87), (41, 87), (42, 72)])
ARM_R = flip(ARM_L)
ARMS = ARM_L | ARM_R
HAND_L = ell((38, 84, 46, 93))
HAND_R = flip(HAND_L)
HANDS = HAND_L | HAND_R
BODY = HEAD | EARS | NECK | TORSO | LEGS | FEET | ARMS | HANDS

skin = [hx(c) for c in SKIN_SRC]
hair = [hx(c) for c in HAIR_SRC]


def make_body():
    sk = [skin[0], skin[1], skin[2]]
    body = comp(
        shade(LEG_L | FOOT_L, sk), shade(LEG_R | FOOT_R, sk),
        shade(TORSO | NECK, sk),
        shade(ARM_L | HAND_L, sk), shade(ARM_R | HAND_R, sk),
        shade(EARS, sk), shade(HEAD, sk),
    )
    # 쇄골/목 그림자 (가장 어두운 피부색)
    paint(body, rect((60, 55, 67, 55)), skin[3])
    # 무릎 라인
    paint(body, rect((56, 104, 57, 104)) | flip(rect((56, 104, 57, 104))), skin[2])
    save(body, "base/body.png")


def make_underwear():
    rmp = ramp("#d8cdea")
    bra = rows(TORSO, 61, 68) & ~sym(rect((63, 64, 63, 68)))
    straps = sym(line([(53, 57), (55, 61)]))
    briefs = rows(TORSO, 84, 92) | rows(LEGS, 88, 92)
    uw = comp(shade(bra, rmp), shade(briefs, rmp))
    paint(uw, straps, rmp[2])
    save(uw, "base/underwear.png")


def make_shadow():
    im = Image.new("RGBA", (W, 12), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((40, 2, 87, 9), fill=(40, 26, 30, 255))
    im.save(os.path.join(A, "base/shadow.png"))


# ---------------------------------------------------------------- face
EYE_L = rect((55, 33, 57, 37))
EYE_R = flip(EYE_L)


def face(kind, blink=False):
    img = np.zeros((H, W, 4), np.uint8)
    dark = OUTLINE
    if blink or kind == "sleepy":
        paint(img, sym(rect((55, 36, 57, 36))), dark)
    elif kind == "wink":
        paint(img, EYE_L, dark)
        paint(img, rect((55, 33, 55, 33)), (255, 255, 255))
        paint(img, flip(rect((54, 36, 58, 36))) | flip(rect((55, 35, 55, 35))), dark)
    else:
        paint(img, EYE_L | EYE_R, dark)
        paint(img, rect((55, 33, 55, 34)) | rect((69, 33, 69, 34)), (255, 255, 255))
    # 볼터치
    paint(img, sym(rect((52, 40, 54, 40))), (0xF0, 0x96, 0x9A))
    # 입
    if kind in ("smile", "wink"):
        paint(img, rect((61, 43, 66, 43)) | rect((60, 42, 60, 42)) | rect((67, 42, 67, 42)), dark)
    elif kind == "neutral" or kind == "sleepy":
        paint(img, rect((62, 43, 65, 43)), dark)
    elif kind == "wow":
        paint(img, rect((62, 42, 65, 45)), dark)
        paint(img, rect((63, 43, 64, 44)), (0xC8, 0x4B, 0x5A))
    # 눈썹
    if kind == "wow":
        paint(img, sym(rect((54, 29, 57, 29))), hair[1])
    else:
        paint(img, sym(rect((54, 30, 57, 30))), hair[1])
    return img


def make_faces():
    for k in ("smile", "neutral", "wink", "wow"):
        save(face(k), f"face/{k}.png")
        save(face(k, blink=True), f"face/{k}_blink.png")


# ---------------------------------------------------------------- hair
def hair_layers(style):
    back = mask()
    cap = dilate(HEAD, 2) & ~rows(mask() | True, 30, 127)  # 정수리
    if style == "bob":
        back = dilate(HEAD, 2) & rows(mask() | True, 18, 58)
        back |= sym(rect((43, 30, 50, 58)))
        front_side = sym(poly([(44, 22), (52, 22), (50, 50), (44, 56)]))
    elif style == "long":
        back = dilate(HEAD, 2)
        back |= sym(poly([(43, 30), (60, 40), (60, 86), (52, 90), (42, 84)]))
        front_side = sym(poly([(44, 22), (52, 22), (50, 60), (46, 78), (42, 70)]))
    elif style == "bun":
        back = dilate(HEAD, 2) & rows(mask() | True, 14, 44)
        back |= ell((54, 4, 73, 21))
        front_side = sym(poly([(44, 22), (51, 22), (49, 42), (45, 44)]))
    else:  # short
        back = dilate(HEAD, 2) & rows(mask() | True, 14, 42)
        front_side = sym(poly([(44, 22), (51, 22), (49, 38), (45, 40)]))

    # 앞머리 (지그재그 끝)
    fringe = dilate(HEAD, 2) & rows(mask() | True, 13, 27)
    for x in range(48, 81):
        depth = 27 + (3 if (x // 4) % 2 == 0 else 0)
        fringe[27:depth + 1, x] = True
    fringe &= dilate(HEAD, 2)
    front = (cap | fringe | front_side) & ~rows(mask() | True, 0, 12)
    front &= ~(rows(HEAD, 31, 127) & cols(mask() | True, 50, 77))  # 얼굴은 비움

    back_img = shade(back, hair)
    front_img = shade(front, hair)
    # 하이라이트 줄
    paint(front_img, rect((52, 18, 57, 18)) & front & ~edge(front), hair[0])
    save(back_img, f"hair/{style}_back.png")
    save(front_img, f"hair/{style}_front.png")


def make_hair():
    for s in ("bob", "long", "bun", "short"):
        hair_layers(s)


# ---------------------------------------------------------------- items
ITEMS = []
ALL = mask() | True


def item(cat, iid, name, layers, fit=None, tags=(), recolor=True, extra=None):
    arr = comp(*layers)
    save(arr, f"{cat}/{iid}.png")
    d = {"id": f"{cat}_{iid}", "category": cat, "name": name, "src": f"assets/{cat}/{iid}.png"}
    if fit:
        d["fit"] = fit
    if tags:
        d["tags"] = list(tags)
    if not recolor:
        d["recolor"] = False
    if extra:
        d.update(extra)
    ITEMS.append(d)


def top_masks(y0, y1, sleeve_to, e=0, neck=(58, 51, 69, 59)):
    torso = dilate(rows(TORSO, y0, y1), e) & rows(ALL, y0 - e, y1)
    torso &= ~ell(neck)
    arms = []
    if sleeve_to:
        for arm in (ARM_L, ARM_R):
            arms.append(dilate(rows(arm, 56, sleeve_to), e) & rows(ALL, 55, sleeve_to))
    return torso, arms


def make_tops():
    # 흰 긴팔 티 (fitted)
    rmp = ramp("#f4f1ea")
    t, arms = top_masks(55, 88, 86)
    layers = [shade(a, rmp) for a in arms] + [shade(t, rmp)]
    item("top", "white_longsleeve", "흰 긴팔 티셔츠", layers, "fitted", ["white", "basic"])

    # 초록 나시 (fitted)
    rmp = ramp("#4f9a5c")
    t = rows(TORSO, 60, 86) & ~ell((53, 50, 74, 66))
    t |= sym(rect((51, 56, 54, 61)))
    item("top", "green_tank", "초록 나시", [shade(t, rmp)], "fitted", ["green", "layered"])

    # 스트라이프 크롭티 (fitted)
    rmp = ramp("#f6f3ee")
    t, arms = top_masks(55, 77, 66)
    img = comp(*[shade(a, rmp) for a in arms], shade(t, rmp))
    stripes = (t | arms[0] | arms[1]) & ~edge(t) & ~edge(arms[0]) & ~edge(arms[1])
    for y in range(57, 78, 3):
        paint(img, stripes & rows(ALL, y, y), hx("#2e4a8a"))
    item("top", "stripe_crop", "스트라이프 크롭티", [img], "fitted", ["navy", "stripe", "summer"])

    # 핑크 니트 (regular)
    rmp = ramp("#e9a3b8")
    t, arms = top_masks(55, 88, 84, e=1, neck=(57, 50, 70, 58))
    img = comp(*[shade(a, rmp) for a in arms], shade(t, rmp))
    inner = t & ~edge(t)
    for x in range(53, 76, 4):
        paint(img, inner & cols(ALL, x, x) & rows(ALL, 60, 84), rmp[2])
    paint(img, inner & rows(ALL, 86, 87), rmp[2])
    item("top", "pink_knit", "핑크 니트", [img], "regular", ["pink", "knit", "winter"])


def make_bottoms():
    # 연청 와이드 팬츠 (loose)
    rmp = ramp("#7ea6d6")
    waist = rows(dilate(TORSO, 1), 80, 92)
    leg_l = poly([(47, 86), (63, 86), (63, 121), (44, 121)])
    leg_r = flip(leg_l)
    img = comp(shade(leg_l, rmp), shade(leg_r, rmp), shade(waist, rmp))
    paint(img, waist & rows(ALL, 81, 81) & ~edge(waist), rmp[2])
    paint(img, rect((63, 84, 64, 85)), hx("#d9b45a"))
    item("bottom", "wide_denim", "연청 와이드 팬츠", [img], "loose", ["blue", "denim"])

    # 블랙 미니스커트 (regular)
    rmp = ramp("#2f2f3a")
    sk = sym(poly([(51, 78), (63, 78), (63, 97), (46, 97)]))
    img = shade(sk, rmp, outline=(0x14, 0x12, 0x18))
    for x in (52, 57, 70, 75):
        paint(img, rect((x, 84, x, 96)) & sk & ~edge(sk), rmp[0])
    item("bottom", "black_mini", "블랙 미니스커트", [img], "regular", ["black", "skirt"])


def make_onepieces():
    # 노랑 슬립 원피스
    rmp = ramp("#f2cf5b")
    body = rows(TORSO, 61, 88) & ~ell((54, 54, 73, 66))
    skirt = sym(poly([(50, 86), (63, 86), (63, 106), (44, 106)]))
    straps = sym(line([(53, 57), (55, 62)]))
    img = comp(shade(skirt, rmp), shade(body, rmp))
    paint(img, straps, rmp[2])
    item("onepiece", "yellow_slip", "노랑 슬립 원피스", [img], "fitted", ["yellow", "summer"])

    # 체크 원피스 (recolor off)
    base = ramp("#f5efe6")
    t, arms = top_masks(55, 88, 66, e=1)
    skirt = sym(poly([(49, 84), (63, 84), (63, 102), (43, 102)]))
    img = comp(*[shade(a, base) for a in arms], shade(skirt, base), shade(t, base))
    whole = (t | skirt | arms[0] | arms[1])
    inner = whole & ~edge(t) & ~edge(skirt) & ~edge(arms[0]) & ~edge(arms[1])
    red = hx("#d35454")
    for y in range(H):
        for x in range(W):
            if inner[y, x] and ((x // 3) % 2 == 0 or (y // 3) % 2 == 0):
                img[y, x] = (*red, 255) if ((x // 3) % 2 == 0 and (y // 3) % 2 == 0) else (*hx("#ec9b96"), 255)
    item("onepiece", "red_gingham", "빨강 깅엄 원피스", [img], "regular", ["red", "check"], recolor=False)


def make_outers():
    # 베이지 트렌치 (loose)
    rmp = ramp("#c9a77a")
    body = dilate(rows(TORSO, 55, 92), 2) & rows(ALL, 54, 108)
    body |= sym(poly([(46, 88), (63, 88), (63, 108), (43, 108)]))
    opening = rect((61, 62, 66, 108)) | sym(poly([(57, 55), (63, 55), (63, 66)]))
    body &= ~opening
    left, right = cols(body, 0, 63), cols(body, 64, 127)
    sl = [dilate(rows(a, 56, 88), 2) & rows(ALL, 55, 88) for a in (ARM_L, ARM_R)]
    img = comp(shade(sl[0], rmp), shade(sl[1], rmp), shade(left, rmp), shade(right, rmp))
    # 라펠, 벨트, 단추
    paint(img, sym(line([(56, 56), (60, 66)])), rmp[2])
    paint(img, (left | right) & rows(ALL, 80, 81) & ~edge(left) & ~edge(right), hx("#8a6a43"))
    paint(img, sym(rect((57, 70, 57, 70)) | rect((57, 75, 57, 75))), hx("#5a4330"))
    item("outer", "beige_trench", "베이지 트렌치코트", [img], "loose", ["beige", "fall"])

    # 데님 재킷 (regular, 크롭)
    rmp = ramp("#4f6fa8")
    body = dilate(rows(TORSO, 55, 80), 1) & rows(ALL, 54, 80) & ~rect((61, 60, 66, 80))
    body &= ~sym(poly([(58, 54), (63, 54), (63, 62)]))
    left, right = cols(body, 0, 63), cols(body, 64, 127)
    sl = [dilate(rows(a, 56, 86), 1) & rows(ALL, 55, 86) for a in (ARM_L, ARM_R)]
    img = comp(shade(sl[0], rmp), shade(sl[1], rmp), shade(left, rmp), shade(right, rmp))
    paint(img, sym(rect((53, 64, 57, 64))), rmp[2])
    paint(img, sym(rect((55, 66, 55, 66))), hx("#d9b45a"))
    item("outer", "denim_jacket", "데님 크롭 재킷", [img], "regular", ["blue", "denim"])


def make_shoes():
    rmp = ramp("#f2f2f2")
    for side, foot, leg in ((0, FOOT_L, LEG_L), (1, FOOT_R, LEG_R)):
        pass
    s = [dilate(f, 1) | dilate(rows(l, 113, 120), 1) for f, l in ((FOOT_L, LEG_L), (FOOT_R, LEG_R))]
    s = [m & rows(ALL, 112, 125) for m in s]
    img = comp(shade(s[0], rmp), shade(s[1], rmp))
    paint(img, (s[0] | s[1]) & rows(ALL, 123, 123) & ~edge(s[0] | s[1]), hx("#b9b9c4"))
    item("shoes", "white_sneakers", "흰 스니커즈", [img], tags=["white", "casual"])

    rmp = ramp("#2a2630")
    b = [dilate(f, 1) | dilate(rows(l, 96, 120), 1) for f, l in ((FOOT_L, LEG_L), (FOOT_R, LEG_R))]
    b = [m & rows(ALL, 96, 125) for m in b]
    img = comp(shade(b[0], rmp, outline=(0x12, 0x10, 0x14)), shade(b[1], rmp, outline=(0x12, 0x10, 0x14)))
    item("shoes", "black_boots", "블랙 롱부츠", [img], tags=["black", "winter"])


def make_socks():
    rmp = ramp("#fbfbf6")
    s = [(rows(l, 108, 117) | f) for f, l in ((FOOT_L, LEG_L), (FOOT_R, LEG_R))]
    img = comp(shade(s[0], rmp), shade(s[1], rmp))
    item("socks", "white_crew", "흰 크루삭스", [img], tags=["white"])

    rmp = ramp("#c94a4a")
    s = [(rows(l, 94, 117) | f) for f, l in ((FOOT_L, LEG_L), (FOOT_R, LEG_R))]
    img = comp(shade(s[0], rmp), shade(s[1], rmp))
    paint(img, (s[0] | s[1]) & rows(ALL, 95, 96) & ~edge(s[0] | s[1]), hx("#f4f1ea"))
    item("socks", "red_knee", "빨강 니삭스", [img], tags=["red"])


def make_belts():
    rmp = ramp("#7a4a2c")
    b = dilate(rows(TORSO, 80, 82), 2, horiz_only=True)
    img = shade(b, rmp)
    paint(img, rect((61, 79, 66, 83)), hx("#e3bd52"))
    paint(img, rect((63, 81, 64, 81)), OUTLINE)
    item("belt", "brown_belt", "브라운 벨트", [img], tags=["brown"])


def make_bags():
    rmp = ramp("#a0603a")
    bag = rect((77, 86, 89, 98))
    img = shade(bag, rmp)
    paint(img, line([(53, 57), (80, 86)]), hx("#5a3422"))
    paint(img, rect((78, 87, 88, 90)), rmp[2])
    paint(img, rect((82, 91, 84, 91)), hx("#e3bd52"))
    item("bag", "brown_crossbody", "브라운 크로스백", [img], tags=["brown"])

    rmp = ramp("#efe4cc")
    bag = poly([(30, 80), (46, 80), (47, 99), (29, 99)])
    img = shade(bag, rmp)
    paint(img, line([(33, 80), (48, 58)]) | line([(43, 80), (52, 60)]), hx("#8a7a5a"))
    paint(img, rect((34, 87, 41, 92)), hx("#4f9a5c"))
    item("bag", "canvas_tote", "캔버스 토트백", [img], tags=["ivory", "casual"])


def make_jewelry():
    img = np.zeros((H, W, 4), np.uint8)
    paint(img, sym(line([(58, 57), (63, 63)])), hx("#e3bd52"))
    paint(img, rect((62, 63, 65, 66)), hx("#f2d877"))
    paint(img, rect((63, 64, 64, 65)), hx("#e05a7a"))
    item("jewelry", "gold_necklace", "골드 펜던트 목걸이", [img], tags=["gold"])

    img = np.zeros((H, W, 4), np.uint8)
    paint(img, sym(rect((44, 42, 46, 44))), hx("#fbf6ee"))
    paint(img, sym(rect((44, 42, 44, 42))), (255, 255, 255))
    paint(img, sym(rect((46, 44, 46, 44))), hx("#cfc6c0"))
    item("jewelry", "pearl_earrings", "진주 귀걸이", [img], tags=["white"], recolor=False)


def make_accessories():
    rmp = ramp("#c23b4a")
    beret = ell((42, 9, 82, 25))
    img = shade(beret, rmp)
    paint(img, rect((61, 6, 63, 9)), rmp[2])
    item("accessory", "red_beret", "빨강 베레모", [img], tags=["red", "fall"])

    img = np.zeros((H, W, 4), np.uint8)
    ring = sym(ell((51, 31, 60, 40)) & ~ell((52, 32, 59, 39)))
    paint(img, ring | rect((60, 34, 67, 34)), hx("#3a2a22"))
    item("accessory", "round_glasses", "동그란 안경", [img], tags=["brown"])

    rmp = ramp("#f08fb0")
    bow = poly([(70, 18), (77, 14), (77, 24)]) | poly([(84, 18), (77, 14), (77, 24)])
    bow = poly([(70, 15), (76, 19), (70, 23)]) | poly([(82, 15), (76, 19), (82, 23)])
    img = shade(bow, rmp)
    paint(img, rect((75, 18, 77, 20)), rmp[2])
    item("accessory", "pink_ribbon", "핑크 리본핀", [img], tags=["pink", "cute"])


# ---------------------------------------------------------------- backgrounds 160x192
BW, BH = 160, 192


def bg_canvas(color):
    im = Image.new("RGBA", (BW, BH), (*hx(color), 255))
    return im, ImageDraw.Draw(im)


def dither_band(d, y0, y1, c1, c2):
    for y in range(y0, y1):
        for x in range(BW):
            if (x + y) % 2 == 0:
                d.point((x, y), fill=c2)
            else:
                d.point((x, y), fill=c1)


def make_backgrounds():
    os.makedirs(os.path.join(A, "bg"), exist_ok=True)
    # 내 방
    im, d = bg_canvas("#f3dfe3")
    for x in range(0, BW, 12):
        d.rectangle((x, 0, x + 5, 139), fill=hx("#eccfd6"))
    d.rectangle((96, 26, 145, 86), fill=hx("#6b4a52"))
    d.rectangle((99, 29, 142, 83), fill=hx("#bfe3f2"))
    d.rectangle((120, 29, 121, 83), fill=hx("#6b4a52"))
    d.rectangle((99, 55, 142, 56), fill=hx("#6b4a52"))
    d.ellipse((104, 34, 114, 44), fill=hx("#fff6d0"))
    d.rectangle((92, 22, 149, 26), fill=hx("#fbf3f4"))
    d.rectangle((12, 40, 40, 64), fill=hx("#6b4a52"))
    d.rectangle((14, 42, 38, 62), fill=hx("#fff1c9"))
    d.ellipse((20, 47, 30, 57), fill=hx("#f08fb0"))
    d.rectangle((0, 140, BW, BH), fill=hx("#c99673"))
    for y in range(146, BH, 8):
        d.line((0, y, BW, y), fill=hx("#b48262"))
    d.rectangle((0, 138, BW, 140), fill=hx("#fbf3f4"))
    d.rectangle((6, 112, 26, 140), fill=hx("#8f6a55"))
    d.ellipse((2, 92, 30, 116), fill=hx("#5c9a62"))
    d.ellipse((30, 160, 130, 186), fill=hx("#e9b7c4"))
    d.ellipse((38, 164, 122, 182), fill=hx("#f3cad5"))
    im.save(os.path.join(A, "bg/room.png"))

    # 거리
    im, d = bg_canvas("#bfe0f4")
    d.ellipse((14, 14, 46, 26), fill=hx("#ffffff"))
    d.ellipse((104, 30, 140, 42), fill=hx("#ffffff"))
    blds = [(0, 50, 40, "#e7b9a6"), (40, 34, 82, "#d9d1c4"), (82, 58, 118, "#a9c4c9"), (118, 40, 160, "#e6cf9a")]
    for x0, y0, x1, c in blds:
        d.rectangle((x0, y0, x1 - 1, 140), fill=hx(c))
        for wy in range(y0 + 8, 128, 16):
            for wx in range(x0 + 6, x1 - 8, 12):
                d.rectangle((wx, wy, wx + 5, wy + 7), fill=hx("#6f8fa8"))
                d.point((wx + 1, wy + 1), fill=hx("#e8f4fb"))
    d.rectangle((44, 112, 78, 140), fill=hx("#7a4a52"))
    d.rectangle((48, 116, 74, 140), fill=hx("#f3e2c0"))
    d.rectangle((42, 106, 80, 111), fill=hx("#d35454"))
    for x in range(42, 80, 6):
        d.rectangle((x, 106, x + 2, 111), fill=hx("#f6f3ee"))
    d.rectangle((0, 140, BW, BH), fill=hx("#a8a4a8"))
    for x in range(0, BW, 16):
        for y in range(142, BH, 10):
            d.rectangle((x + (8 if (y // 10) % 2 else 0), y, x + (8 if (y // 10) % 2 else 0), y + 9), fill=hx("#97939a"))
        d.line((0, 142, BW, 142), fill=hx("#8a868c"))
    im.save(os.path.join(A, "bg/street.png"))

    # 카페
    im, d = bg_canvas("#efe1c8")
    d.rectangle((0, 0, BW, 22), fill=hx("#5f8a6a"))
    for x in range(0, BW, 16):
        d.rectangle((x, 0, x + 7, 22), fill=hx("#f6f3ee"))
    d.polygon([(0, 22), (BW, 22), (BW, 26), (0, 26)], fill=hx("#4a6e54"))
    d.rectangle((8, 40, 64, 46), fill=hx("#8a5a3c"))
    d.rectangle((8, 70, 64, 76), fill=hx("#8a5a3c"))
    for i, c in enumerate(["#e9a3b8", "#f2cf5b", "#7ea6d6", "#f6f3ee"]):
        d.rectangle((12 + i * 13, 32, 20 + i * 13, 39), fill=hx(c))
        d.rectangle((12 + i * 13, 62, 20 + i * 13, 69), fill=hx(["#5c9a62", "#c23b4a", "#efe4cc", "#c9a77a"][i]))
    d.rectangle((96, 34, 150, 92), fill=hx("#2f3a34"))
    d.rectangle((99, 37, 147, 89), fill=hx("#3d4a42"))
    for i, y in enumerate(range(44, 86, 9)):
        d.rectangle((104, y, 104 + 18 + (i * 7) % 20, y + 2), fill=hx("#f4f1ea"))
        d.rectangle((136, y, 142, y + 2), fill=hx("#f2cf5b"))
    d.rectangle((0, 140, BW, BH), fill=hx("#6f4a3a"))
    for x in range(0, BW, 12):
        for y in range(140, BH, 12):
            if (x // 12 + y // 12) % 2 == 0:
                d.rectangle((x, y, x + 11, y + 11), fill=hx("#f1e6d4"))
    d.rectangle((0, 112, BW, 140), fill=hx("#9a6a4a"))
    d.rectangle((0, 110, BW, 113), fill=hx("#6f4a3a"))
    d.rectangle((120, 98, 128, 110), fill=hx("#ffffff"))
    d.rectangle((128, 101, 130, 106), fill=hx("#ffffff"))
    im.save(os.path.join(A, "bg/cafe.png"))

    # 공원
    im, d = bg_canvas("#cfeaf6")
    d.ellipse((120, 12, 144, 36), fill=hx("#fff1b8"))
    d.ellipse((-30, 92, 90, 152), fill=hx("#9cc98a"))
    d.ellipse((60, 100, 200, 160), fill=hx("#8abc7a"))
    for tx in (18, 136):
        d.rectangle((tx - 3, 80, tx + 3, 140), fill=hx("#7a5a40"))
        d.ellipse((tx - 22, 36, tx + 22, 94), fill=hx("#5c9a62"))
        d.ellipse((tx - 16, 42, tx + 8, 70), fill=hx("#74b47a"))
    d.rectangle((0, 140, BW, BH), fill=hx("#7fb86e"))
    for x in range(0, BW, 7):
        for y in range(146, BH, 9):
            d.point((x + (y % 3), y), fill=hx("#6aa45c"))
            d.point((x + (y % 3), y - 1), fill=hx("#6aa45c"))
    for fx, fy, c in ((12, 160, "#f08fb0"), (140, 170, "#f2cf5b"), (24, 182, "#ffffff"), (148, 150, "#e05a7a")):
        d.rectangle((fx, fy, fx + 2, fy + 2), fill=hx(c))
        d.point((fx + 1, fy + 1), fill=hx("#f2cf5b"))
    d.polygon([(52, 192), (108, 192), (92, 140), (68, 140)], fill=hx("#e3cfa4"))
    im.save(os.path.join(A, "bg/park.png"))

    # 스튜디오
    im, d = bg_canvas("#f6e7ee")
    dither_band(d, 120, 140, hx("#f6e7ee"), hx("#efd9e3"))
    d.rectangle((0, 140, BW, BH), fill=hx("#efd9e3"))
    dither_band(d, 140, 152, hx("#efd9e3"), hx("#e6cbd7"))
    d.rectangle((0, 152, BW, BH), fill=hx("#e6cbd7"))
    for sx, sy in ((20, 24), (136, 40), (30, 96), (128, 104), (80, 14)):
        d.point((sx, sy), fill=hx("#ffffff"))
        d.line((sx - 2, sy, sx + 2, sy), fill=hx("#ffffff"))
        d.line((sx, sy - 2, sx, sy + 2), fill=hx("#ffffff"))
    im.save(os.path.join(A, "bg/studio.png"))


# ---------------------------------------------------------------- cursors & ui
CURSORS = {
    "cursor": [
        "X...........",
        "XX..........",
        "XwX.........",
        "XwwX........",
        "XwwwX.......",
        "XwwwwX......",
        "XwwwwwX.....",
        "XwwwwwwX....",
        "XwwwwwwwX...",
        "XwwwwwXXXX..",
        "XwwXwwX.....",
        "XwX.XwwX....",
        "XX..XwwX....",
        "X....XwwX...",
        ".....XwwX...",
        "......XX....",
    ],
    "cursor_pointer": [
        ".....XX.........",
        "....XwwX........",
        "....XwwX........",
        "....XwwX........",
        "....XwwXXX......",
        "....XwwXwwXXX...",
        ".XX.XwwXwwXwwXX.",
        "XwwXXwwwwwXwwXwX",
        "XwwwXwwwwwwwwwwX",
        ".XwwwwwwwwwwwwwX",
        "..XwwwwwwwwwwwwX",
        "..XwwwwwwwwwwwX.",
        "...XwwwwwwwwwwX.",
        "...XwwwwwwwwwX..",
        "....XwwwwwwwwX..",
        "....XXXXXXXXXX..",
    ],
    "cursor_grab": [
        "................",
        "................",
        "................",
        "....XX.XX.XX....",
        "...XwwXwwXwwXX..",
        "...XwwwwwwwwwwX.",
        ".XXXwwwwwwwwwwX.",
        "XwwXwwwwwwwwwwX.",
        "XwwwwwwwwwwwwwX.",
        ".XwwwwwwwwwwwwX.",
        "..XwwwwwwwwwwwX.",
        "..XwwwwwwwwwwX..",
        "...XwwwwwwwwwX..",
        "...XwwwwwwwwX...",
        "....XXXXXXXX....",
        "................",
    ],
}


def make_cursors():
    pal = {"X": (*OUTLINE, 255), "w": (255, 255, 255, 255), ".": (0, 0, 0, 0)}
    os.makedirs(os.path.join(A, "ui"), exist_ok=True)
    for name, rows_ in CURSORS.items():
        h, w = len(rows_), max(len(r) for r in rows_)
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
        for y, r in enumerate(rows_):
            for x, ch in enumerate(r):
                im.putpixel((x, y), pal[ch])
        # 손가락 끝에 핑크 포인트
        if name == "cursor":
            im.putpixel((1, 2), (240, 143, 176, 255))
        im.resize((32, 32), Image.NEAREST).save(os.path.join(A, f"ui/{name}.png"))

    star = [
        "....X....",
        "....X....",
        "...XwX...",
        "XXXwwwXXX",
        "...XwX...",
        "....X....",
        "....X....",
    ]
    im = Image.new("RGBA", (9, 9), (0, 0, 0, 0))
    for y, r in enumerate(star):
        for x, ch in enumerate(r):
            if ch == "X":
                im.putpixel((x, y + 1), (255, 214, 102, 255))
            elif ch == "w":
                im.putpixel((x, y + 1), (255, 255, 255, 255))
    im.resize((27, 27), Image.NEAREST).save(os.path.join(A, "ui/sparkle.png"))


ICONS = {
    "dice": ["XXXXXXXXX", "X.......X", "X.X...X.X", "X.......X", "X...X...X",
             "X.......X", "X.X...X.X", "X.......X", "XXXXXXXXX"],
    "heart": [".XX...XX.", "XXXX.XXXX", "XXXXXXXXX", "XXXXXXXXX", ".XXXXXXX.",
              "..XXXXX..", "...XXX...", "....X....", "........."],
    "camera": [".........", "..XXX....", "XXXXXXXXX", "X..XXX..X", "X.X...X.X",
               "X.X...X.X", "X..XXX..X", "XXXXXXXXX", "........."],
    "download": ["....X....", "....X....", "....X....", "..XXXXX..", "...XXX...",
                 "....X....", "X.......X", "X.......X", "XXXXXXXXX"],
    "up": [".........", ".........", "....X....", "...XXX...", "..XXXXX..",
           ".XXXXXXX.", ".........", ".........", "........."],
    "down": [".........", ".........", ".........", ".XXXXXXX.", "..XXXXX..",
             "...XXX...", "....X....", ".........", "........."],
    "x": ["XX.....XX", ".XX...XX.", "..XX.XX..", "...XXX...", "...XXX...",
          "..XX.XX..", ".XX...XX.", "XX.....XX", "........."],
    "palette": ["..XXXXX..", ".X.....X.", "X.X.X...X", "X.......X", "X.X...XX.",
                "X.....X..", ".X...X...", "..XXX....", "........."],
    "check": [".........", ".......XX", "......XX.", "X....XX..", "XX..XX...",
              ".XXXX....", "..XX.....", ".........", "........."],
}


def make_icons():
    for name, rows_ in ICONS.items():
        im = Image.new("RGBA", (9, 9), (0, 0, 0, 0))
        for y, r in enumerate(rows_):
            for x, ch in enumerate(r):
                if ch == "X":
                    im.putpixel((x, y), (*OUTLINE, 255))
        im.save(os.path.join(A, f"ui/icon_{name}.png"))


if __name__ == "__main__":
    make_body()
    make_underwear()
    make_shadow()
    make_faces()
    make_hair()
    make_tops()
    make_bottoms()
    make_onepieces()
    make_outers()
    make_shoes()
    make_socks()
    make_belts()
    make_bags()
    make_jewelry()
    make_accessories()
    make_backgrounds()
    make_cursors()
    make_icons()
    with open(os.path.join(ROOT, "data/items.json"), "w", encoding="utf-8") as f:
        json.dump(ITEMS, f, ensure_ascii=False, indent=2)
    print(f"ok: {len(ITEMS)} items")
