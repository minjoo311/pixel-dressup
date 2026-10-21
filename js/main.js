import { Sound } from "./audio.js";
import { Recorder } from "./recorder.js";
import { initAdmin, openAdmin } from "./admin.js";
import {
  $, el, esc, hexToInt, rgbInt, clamp01, rgbToHsl, hslToRgb, hexToHsl,
  loadImage, getImg, toCanvas, pixels, alphaAt, bbox, thumb, pixelText, store, idb,
} from "./util.js";

// ================================================================ constants
const STAGE_W = 160;
const STAGE_H = 192;
const AV = 128;
const AV_X = 16;
const AV_Y = 56;
const HAIR = "__hair_front";
const STORE_CUR = "pixelcloset.v1.current";
const STORE_SLOTS = "pixelcloset.v1.slots";
const STORE_RECENT = "pixelcloset.v1.recentColors";
const SLOT_COUNT = 3;
const BRUSH_BTN = { x: 138, y: 4, w: 18, h: 18 };
const REC_SCALE = 6; // 녹화 해상도 960×1152

// ================================================================ data
let OPT, BASE_ITEMS, BASE_BGS, ITEMS, ITEM_BY_ID, CAT_BY_KEY, VARIANTS;
let MANIFEST = { items: [], backgrounds: [], variants: [] };
let LOCALS = [];
const objectURLs = new Map();
let sound;
let recorder;

const state = {
  bodyType: "regular",
  skin: "medium",
  hairStyle: "long",
  hairColor: "brown",
  hairShift: null,
  face: "smile",
  background: "room",
  worn: [{ id: HAIR }], // 앞 = 안쪽, 뒤 = 바깥
};

const ui = {
  view: "closet",
  tab: "top",
  blinkUntil: 0,
  nextBlink: 0,
  bounceAt: -9999,
  jumpAt: -9999,
  colorIndex: -1,
  paint: false,
  paintColor: "#f08fb0",
  pointer: null, // { x, y, mouse }
  tapBrush: null, // { x, y, at }
  fx: [],
  happy: false,
  celebrateAt: -9999,
  flashes: [],
  lastT: 0,
};

// ================================================================ color / recolor
let OUTLINE_SET = new Set();
const recolorCache = new Map();

function recolorSource(key, source, hue = 0, sat = 0, light = 0) {
  if (!source) return null;
  if (!hue && !sat && !light) return source;
  const k = `${key}|${hue}|${sat}|${light}`;
  if (recolorCache.has(k)) return recolorCache.get(k);
  const c = toCanvas(source);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const ds = sat / 100, dl = light / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (OUTLINE_SET.has(rgbInt(d[i], d[i + 1], d[i + 2]))) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const [r, g, b] = hslToRgb(h + hue, clamp01(s + ds), clamp01(l + dl));
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(data, 0, 0);
  if (recolorCache.size > 400) recolorCache.clear();
  recolorCache.set(k, c);
  return c;
}

const swapCache = new Map();
function paletteSwap(src, fromHex, toHex) {
  const key = `${src}|${toHex.join(",")}`;
  if (swapCache.has(key)) return swapCache.get(key);
  const im = getImg(src);
  if (!im) return null;
  const c = toCanvas(im);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const map = new Map(fromHex.map((f, i) => [hexToInt(f), hexToInt(toHex[i])]));
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const to = map.get(rgbInt(d[i], d[i + 1], d[i + 2]));
    if (to !== undefined) {
      d[i] = to >> 16; d[i + 1] = (to >> 8) & 255; d[i + 2] = to & 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  swapCache.set(key, c);
  return c;
}

const avgCache = new Map();
function avgHsl(src) {
  if (avgCache.has(src)) return avgCache.get(src);
  const im = getImg(src);
  if (!im) return [0, 0, 0.5];
  const d = pixels(im).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || OUTLINE_SET.has(rgbInt(d[i], d[i + 1], d[i + 2]))) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  const v = n ? rgbToHsl(r / n, g / n, b / n) : [0, 0, 0.5];
  avgCache.set(src, v);
  return v;
}

// 대표 색(avg) → 목표 색(hex)으로 가는 색조/채도/밝기 이동량
function shiftTo(avg, hex) {
  const [th, ts, tl] = hexToHsl(hex);
  const [ah, as, al] = avg;
  let dh = Math.round(th - ah);
  dh = ((dh + 540) % 360) - 180;
  return {
    hue: dh,
    sat: Math.round(Math.max(-100, Math.min(100, (ts - as) * 100))),
    light: Math.round(Math.max(-60, Math.min(60, (tl - al) * 100))),
  };
}
const itemShift = (it, hex) => shiftTo(avgHsl(it.src), hex);

// ================================================================ body types (자동 변형)
const bodyTypes = () => OPT.bodyTypes || [{ id: "regular", name: "보통", warp: [] }];
const bodyTypeOf = (id) => bodyTypes().find((b) => b.id === id) || bodyTypes()[0];

let CORE_L = null, CORE_R = null;
// 기준 바디에서 행마다 "몸통/다리" 반폭을 측정 (팔은 몸통 밖이면 평행이동, 몸통은 늘어남)
function measureCore() {
  const im = getImg(OPT.body.body);
  CORE_L = new Int16Array(AV);
  CORE_R = new Int16Array(AV);
  if (!im) return;
  const { data: d } = pixels(im);
  const a = (x, y) => d[(y * AV + x) * 4 + 3];
  for (let y = 0; y < AV; y++) {
    let x = 63, skip = 0;
    while (x >= 0 && !a(x, y) && skip < 8) { x--; skip++; }
    if (x < 0 || !a(x, y)) { CORE_L[y] = 0; } else {
      while (x >= 0 && a(x, y)) x--;
      CORE_L[y] = 64 - (x + 1);
    }
    x = 64; skip = 0;
    while (x < AV && !a(x, y) && skip < 8) { x++; skip++; }
    if (x >= AV || !a(x, y)) { CORE_R[y] = 0; } else {
      while (x < AV && a(x, y)) x++;
      CORE_R[y] = x - 64;
    }
  }
}

function deltaAt(keys, y) {
  if (!keys || !keys.length) return 0;
  if (y <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [y1, d1] = keys[i];
    if (y <= y1) {
      const [y0, d0] = keys[i - 1];
      return d0 + ((d1 - d0) * (y - y0)) / (y1 - y0);
    }
  }
  return keys[keys.length - 1][1];
}

const warpMaps = new Map();
function warpMap(typeId) {
  if (warpMaps.has(typeId)) return warpMaps.get(typeId);
  const bt = bodyTypeOf(typeId);
  if (!bt.warp || !bt.warp.length) {
    warpMaps.set(typeId, null);
    return null;
  }
  const map = new Int16Array(AV * AV).fill(-1);
  for (let y = 0; y < AV; y++) {
    const dd = Math.round(deltaAt(bt.warp, y));
    for (let x = 0; x < AV; x++) {
      const p = x + 0.5;
      let s;
      if (!dd) s = p;
      else if (p < 64) {
        const h = CORE_L[y];
        if (h <= 0) s = p;
        else if (p < 64 - h - dd) s = p + dd;
        else s = 64 - ((64 - p) * h) / Math.max(1, h + dd);
      } else {
        const h = CORE_R[y];
        if (h <= 0) s = p;
        else if (p >= 64 + h + dd) s = p - dd;
        else s = 64 + ((p - 64) * h) / Math.max(1, h + dd);
      }
      const sx = Math.floor(s);
      map[y * AV + x] = sx >= 0 && sx < AV ? sx : -1;
    }
  }
  warpMaps.set(typeId, map);
  return map;
}

const warpCache = new WeakMap();
function warp(source, typeId) {
  if (!source) return null;
  const map = warpMap(typeId);
  if (!map || source.width !== AV || source.height !== AV) return source;
  let per = warpCache.get(source);
  if (!per) warpCache.set(source, (per = new Map()));
  if (per.has(typeId)) return per.get(typeId);
  const src = pixels(source).data;
  const c = document.createElement("canvas");
  c.width = c.height = AV;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const out = ctx.createImageData(AV, AV);
  const o = out.data;
  for (let y = 0; y < AV; y++) {
    for (let x = 0; x < AV; x++) {
      const sx = map[y * AV + x];
      if (sx < 0) continue;
      const si = (y * AV + sx) * 4, di = (y * AV + x) * 4;
      o[di] = src[si]; o[di + 1] = src[si + 1]; o[di + 2] = src[si + 2]; o[di + 3] = src[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  per.set(typeId, c);
  return c;
}

// ================================================================ layers
const findBy = (arr, id) => arr.find((x) => x.id === id) || arr[0];

function bodyLayer(st) {
  const bt = bodyTypeOf(st.bodyType);
  const ramp = OPT.skinRamps[st.skin] || OPT.skinRamps._source;
  if (bt.body) return paletteSwap(bt.body, OPT.skinRamps._source, ramp);
  return warp(paletteSwap(OPT.body.body, OPT.skinRamps._source, ramp), st.bodyType);
}

function underwearLayer(st) {
  const bt = bodyTypeOf(st.bodyType);
  if (bt.body && bt.underwear) return getImg(bt.underwear);
  return warp(getImg(bt.underwear || OPT.body.underwear), st.bodyType);
}

function hairAvg(st) {
  const ramp = OPT.hairRamps[st.hairColor] || OPT.hairRamps._source;
  return hexToHsl(ramp[1]);
}

function hairLayer(st, which) {
  const hair = findBy(OPT.hairStyles, st.hairStyle);
  const ramp = OPT.hairRamps[st.hairColor] || OPT.hairRamps._source;
  const src = which === "back" ? hair.back : hair.front;
  const swapped = paletteSwap(src, OPT.hairRamps._source, ramp);
  const sh = st.hairShift || {};
  const tinted = recolorSource(`hair|${src}|${st.hairColor}`, swapped, sh.hue, sh.sat, sh.light);
  return warp(tinted, st.bodyType);
}

function itemLayer(e, st, srcOverride) {
  const it = ITEM_BY_ID[e.id];
  if (!it) return null;
  const vsrc = !srcOverride && VARIANTS[it.id] && VARIANTS[it.id][st.bodyType];
  const src = srcOverride || vsrc || it.src;
  const colored = recolorSource(src, getImg(src), e.hue, e.sat, e.light);
  return vsrc ? colored : warp(colored, st.bodyType);
}

function hiddenSet(worn) {
  const s = new Set();
  for (const e of worn) {
    const it = ITEM_BY_ID[e.id];
    if (it && it.hides) it.hides.forEach((h) => s.add(h));
  }
  return s;
}

// 그려지는 순서대로 레이어 목록 (히트 테스트에도 사용)
function layerStack(st, { blink = false, faceOverride = null, extra = null } = {}) {
  const out = [];
  const hidden = hiddenSet(st.worn);
  const face = findBy(OPT.faces, faceOverride || st.face);
  if (!hidden.has("hair_back")) out.push({ kind: "hair", canvas: hairLayer(st, "back") });
  for (const e of st.worn) {
    const it = ITEM_BY_ID[e.id];
    if (it && it.extraLayers) {
      it.extraLayers.filter((l) => (l.z ?? 0) < 20)
        .forEach((l) => out.push({ kind: "item", entry: e, canvas: itemLayer(e, st, l.src) }));
    }
  }
  out.push({ kind: "body", canvas: bodyLayer(st) });
  out.push({ kind: "body", canvas: underwearLayer(st) });
  out.push({ kind: "face", canvas: warp(getImg(blink && face.blink ? face.blink : face.src), st.bodyType) });
  for (const e of st.worn) {
    if (e.id === HAIR) {
      if (!hidden.has("hair_front")) out.push({ kind: "hair", canvas: hairLayer(st, "front") });
      continue;
    }
    const it = ITEM_BY_ID[e.id];
    if (!it || hidden.has(it.category)) continue;
    if (it.extraLayers) {
      it.extraLayers.filter((l) => (l.z ?? 0) >= 20)
        .forEach((l) => out.push({ kind: "item", entry: e, canvas: itemLayer(e, st, l.src) }));
    }
    out.push({ kind: "item", entry: e, canvas: itemLayer(e, st) });
  }
  if (extra) out.push({ kind: "extra", canvas: extra });
  return out;
}

function composeAvatar(ctx, st, opts = {}) {
  ctx.clearRect(0, 0, AV, AV);
  for (const l of layerStack(st, opts)) if (l.canvas) ctx.drawImage(l.canvas, 0, 0);
}

// ================================================================ stage rendering
const avCanvas = document.createElement("canvas");
avCanvas.width = avCanvas.height = AV;
const avCtx = avCanvas.getContext("2d");

const stageCanvas = document.createElement("canvas");
stageCanvas.width = STAGE_W;
stageCanvas.height = STAGE_H;
const stageCtx = stageCanvas.getContext("2d");

function avatarOffset(t) {
  let y = 0;
  const dj = t - ui.jumpAt;
  if (dj >= 0 && dj < 420) y -= Math.round(9 * Math.sin((Math.PI * dj) / 420));
  else {
    const dt = t - ui.bounceAt;
    if (dt < 80) y -= 2;
    else if (dt < 160) y -= 1;
  }
  return y;
}

const brushTint = new Map();
function brushSprite(color) {
  if (brushTint.has(color)) return brushTint.get(color);
  const im = getImg("assets/ui/brush.png");
  if (!im) return null;
  const c = toCanvas(im);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const [h, s, l] = hexToHsl(color);
  const main = hslToRgb(h, s, l), hi = hslToRgb(h, s, Math.min(1, l + 0.18));
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255) [d[i], d[i + 1], d[i + 2]] = main;
    else if (d[i] === 255 && d[i + 1] === 128 && d[i + 2] === 255) [d[i], d[i + 1], d[i + 2]] = hi;
  }
  ctx.putImageData(data, 0, 0);
  brushTint.set(color, c);
  return c;
}

function drawBrushButton(ctx, t) {
  const { x, y, w, h } = BRUSH_BTN;
  const on = ui.paint;
  const off = on ? 1 : 0;
  if (!on) {
    ctx.fillStyle = "#2b1d1a";
    ctx.fillRect(x + 1, y + 1, w, h);
  }
  ctx.fillStyle = "#2b1d1a";
  ctx.fillRect(x + off, y + off, w, h);
  ctx.fillStyle = on ? "#fbd3e1" : "#fff8f0";
  ctx.fillRect(x + off + 1, y + off + 1, w - 2, h - 2);
  // 붓을 들고 있으면 버튼엔 색 방울만
  if (on) {
    ctx.fillStyle = ui.paintColor;
    ctx.fillRect(x + off + 6, y + off + 6, 6, 6);
    ctx.fillStyle = "#2b1d1a";
    ctx.fillRect(x + off + 6, y + off + 5, 6, 1);
    ctx.fillRect(x + off + 6, y + off + 12, 6, 1);
    ctx.fillRect(x + off + 5, y + off + 6, 1, 6);
    ctx.fillRect(x + off + 12, y + off + 6, 1, 6);
  } else {
    const b = brushSprite(ui.paintColor);
    const bob = Math.floor(t / 500) % 2;
    if (b) ctx.drawImage(b, x + 2, y + 2 - bob);
  }
}

function drawSparkle(ctx, x, y, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x - size, y, size * 2 + 1, 1);
  ctx.fillRect(x, y - size, 1, size * 2 + 1);
  if (size > 1) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, 1, 1);
  }
}

function updateFx(ctx, t, dt) {
  ui.fx = ui.fx.filter((p) => t - p.t0 < p.life);
  for (const p of ui.fx) {
    const age = (t - p.t0) / p.life;
    if (p.type === "spark") {
      const size = age < 0.3 ? 1 : age < 0.7 ? 2 : 1;
      drawSparkle(ctx, Math.round(p.x), Math.round(p.y), size, "#ffd666");
      continue;
    }
    p.vy += (p.g || 0) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.type === "confetti" && Math.floor((t - p.t0) / 120) % 2) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 2);
    } else {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size || 1, p.size || 1);
    }
  }
}

function addSplash(x, y, color) {
  const t = performance.now();
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
    const sp = 0.03 + Math.random() * 0.05;
    ui.fx.push({ type: "drop", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.03, g: 0.00018, color, t0: t, life: 420 + Math.random() * 200, size: Math.random() < 0.4 ? 2 : 1 });
  }
  ui.fx.push({ type: "spark", x, y: y - 3, t0: t, life: 380 });
}

function addPuff(x, y) {
  const t = performance.now();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6;
    ui.fx.push({ type: "drop", x, y, vx: Math.cos(a) * 0.025, vy: Math.sin(a) * 0.025, color: "#cfc6c6", t0: t, life: 260, size: 1 });
  }
}

function addConfetti() {
  const t = performance.now();
  const colors = ["#f08fb0", "#f6d97a", "#8fd3c6", "#c9b6e4", "#ffffff", "#e05a5a", "#7ea6d6"];
  for (let i = 0; i < 70; i++) {
    ui.fx.push({
      type: "confetti", x: Math.random() * STAGE_W, y: -10 - Math.random() * 60,
      vx: (Math.random() - 0.5) * 0.02, vy: 0.03 + Math.random() * 0.04, g: 0.00002,
      color: colors[i % colors.length], t0: t, life: 2600 + Math.random() * 900, size: 2,
    });
  }
}

function drawCelebration(ctx, t) {
  const dt = t - ui.celebrateAt;
  if (dt < 0 || dt > 3600) return;
  // 사진 촬영 프레임 (모서리 괄호)
  if (dt > 350 && dt < 1900) {
    ctx.fillStyle = "#ffffff";
    const m = 6, L = 10;
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [STAGE_W - m, m, -1, 1], [m, STAGE_H - m, 1, -1], [STAGE_W - m, STAGE_H - m, -1, -1]]) {
      ctx.fillRect(sx > 0 ? x : x - L, sy > 0 ? y : y - 2, L, 2);
      ctx.fillRect(sx > 0 ? x : x - 2, sy > 0 ? y : y - L, 2, L);
    }
    if (Math.floor(dt / 300) % 2) {
      ctx.fillStyle = "#e05a5a";
      ctx.fillRect(STAGE_W - m - 16, m + 5, 3, 3);
    }
  }
  // "완성!" 배너
  const txt = pixelText(OPT.celebrateText || "완성!", { size: 12, color: "#2b1d1a" });
  const bw = txt.width + 14, bh = 18;
  const slide = Math.min(1, dt / 240);
  const out = dt > 3200 ? (dt - 3200) / 400 : 0;
  const by = Math.round(-bh + (bh + 10) * Math.floor(slide * 4) / 4 - out * 30);
  const bx = Math.round((STAGE_W - bw) / 2);
  ctx.fillStyle = "#2b1d1a";
  ctx.fillRect(bx + 2, by + 2, bw, bh);
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = Math.floor(dt / 200) % 2 ? "#f6d97a" : "#f08fb0";
  ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
  ctx.drawImage(txt, bx + 7, by + 1);
  // 반짝이
  if (dt < 2600) {
    const k = Math.floor(dt / 160);
    drawSparkle(ctx, bx - 6, by + 6 + (k % 2) * 2, 1 + (k % 2), "#ffffff");
    drawSparkle(ctx, bx + bw + 5, by + 10 - (k % 2) * 2, 2 - (k % 2), "#ffffff");
  }
}

function drawFlashes(ctx, t) {
  for (const f of ui.flashes) {
    const dt = t - f;
    if (dt < 0 || dt > 220) continue;
    const a = dt < 60 ? 0.95 : dt < 120 ? 0.6 : dt < 170 ? 0.3 : 0.1;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
  ui.flashes = ui.flashes.filter((f) => t - f < 400 || f > t);
}

let cursorSmall = null;
function drawPointer(ctx, t) {
  const p = ui.pointer;
  if (ui.paint) {
    const b = brushSprite(ui.paintColor);
    if (p && p.mouse && b) ctx.drawImage(b, Math.round(p.x), Math.round(p.y) - 13);
    const tb = ui.tapBrush;
    if (tb && b && t - tb.at < 450) {
      const k = Math.floor((t - tb.at) / 90);
      ctx.drawImage(b, Math.round(tb.x) + (k % 2 ? 2 : 0), Math.round(tb.y) - 13 - (k % 2 ? 1 : 0));
    }
  } else if (p && p.mouse && recorder && recorder.active) {
    // 녹화 중엔 진짜 마우스 커서가 안 찍히니까 픽셀 커서를 그려줌
    if (!cursorSmall) {
      const im = getImg("assets/ui/cursor.png");
      if (im) {
        cursorSmall = document.createElement("canvas");
        cursorSmall.width = cursorSmall.height = 16;
        const c2 = cursorSmall.getContext("2d");
        c2.imageSmoothingEnabled = false;
        c2.drawImage(im, 0, 0, 16, 16);
      }
    }
    if (cursorSmall) ctx.drawImage(cursorSmall, Math.round(p.x), Math.round(p.y));
  }
}

function renderStage(ctx, t, st = state, { motion = true, overlay = true } = {}) {
  const dt = Math.min(50, t - (ui.lastT || t));
  ui.lastT = t;
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  const bg = getImg(findBy(OPT.backgrounds, st.background).src);
  if (bg) ctx.drawImage(bg, 0, 0, STAGE_W, STAGE_H);
  else { ctx.fillStyle = "#f6e7ee"; ctx.fillRect(0, 0, STAGE_W, STAGE_H); }

  const shadow = getImg(OPT.body.shadow);
  if (shadow) {
    ctx.globalAlpha = 0.25;
    ctx.drawImage(shadow, AV_X, AV_Y + 116);
    ctx.globalAlpha = 1;
  }

  composeAvatar(avCtx, st, {
    blink: motion && t < ui.blinkUntil && !ui.happy,
    faceOverride: ui.happy && st === state ? OPT.celebrateFace || "happy" : null,
  });

  const y = AV_Y + (motion ? avatarOffset(t) : 0);
  const beat = 60000 / (OPT.audio.bpm || 100);
  const breathe = motion && Math.floor(t / beat) % 2 === 1;
  if (breathe) {
    const split = OPT.body.breathSplitY || 76;
    ctx.drawImage(avCanvas, 0, split, AV, AV - split, AV_X, y + split, AV, AV - split);
    ctx.drawImage(avCanvas, 0, 0, AV, split, AV_X, y + 1, AV, split);
  } else {
    ctx.drawImage(avCanvas, AV_X, y);
  }

  if (!overlay) return;
  updateFx(ctx, t, dt);
  drawCelebration(ctx, t);
  if (!document.body.classList.contains("photo")) drawBrushButton(ctx, t);
  drawPointer(ctx, t);
  drawFlashes(ctx, t);
}

// 화면 캔버스: 기기 픽셀 기준 정수배
function fitCanvas(canvas, availW, availH, cover = false) {
  const dpr = window.devicePixelRatio || 1;
  const fitW = (availW * dpr) / STAGE_W, fitH = (availH * dpr) / STAGE_H;
  let S = Math.max(1, Math.floor(Math.min(fitW, fitH)));
  if (cover) S = Math.max(S, Math.min(Math.ceil(fitW), Math.floor(fitH)));
  if (canvas.width !== STAGE_W * S) {
    canvas.width = STAGE_W * S;
    canvas.height = STAGE_H * S;
  }
  canvas.style.width = `${(STAGE_W * S) / dpr}px`;
  canvas.style.height = `${(STAGE_H * S) / dpr}px`;
}

function blit(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(stageCanvas, 0, 0, canvas.width, canvas.height);
}

// ================================================================ state actions
const zOf = (e) => (e.id === HAIR ? OPT.hairFrontZ : (CAT_BY_KEY[ITEM_BY_ID[e.id]?.category] || { defaultZ: 70 }).defaultZ);
const wornIndex = (id) => state.worn.findIndex((e) => e.id === id);

function wear(id, { silent = false } = {}) {
  const it = ITEM_BY_ID[id];
  if (!it) return;
  const cat = CAT_BY_KEY[it.category];
  if (!cat.multi) {
    state.worn = state.worn.filter((e) => e.id === HAIR || ITEM_BY_ID[e.id]?.category !== it.category);
  }
  const z = cat.defaultZ;
  let idx = 0;
  state.worn.forEach((e, i) => { if (zOf(e) <= z) idx = i + 1; });
  state.worn.splice(idx, 0, { id, hue: 0, sat: 0, light: 0 });
  if (!silent) {
    ui.bounceAt = performance.now();
    sound.play("equip");
  }
}

function unwear(id) {
  const i = wornIndex(id);
  if (i < 0 || id === HAIR) return;
  state.worn.splice(i, 1);
  sound.play("unequip");
}

function toggleItem(id) {
  if (wornIndex(id) >= 0) unwear(id);
  else wear(id);
  changed();
}

function move(id, dir) {
  const i = wornIndex(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.worn.length) return;
  [state.worn[i], state.worn[j]] = [state.worn[j], state.worn[i]];
  sound.play(dir > 0 ? "up" : "down");
  ui.bounceAt = performance.now();
  changed({ flashId: id });
}

function randomize() {
  const pick = (cat) => {
    const list = ITEMS.filter((i) => i.category === cat);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  };
  const chance = (p) => Math.random() < p;
  state.worn = [{ id: HAIR }];
  const add = (it) => { if (it && wornIndex(it.id) < 0) wear(it.id, { silent: true }); };

  if (chance(0.35) && ITEMS.some((i) => i.category === "onepiece")) {
    add(pick("onepiece"));
    if (chance(0.3)) add(pick("bottom"));
    if (chance(0.3)) add(pick("top"));
  } else {
    add(pick("bottom"));
    add(pick("top"));
    if (chance(0.35)) add(pick("top"));
  }
  if (chance(0.45)) add(pick("outer"));
  if (chance(0.9)) add(pick("shoes"));
  if (chance(0.55)) add(pick("socks"));
  if (chance(0.25)) add(pick("belt"));
  if (chance(0.4)) add(pick("bag"));
  if (chance(0.45)) add(pick("jewelry"));
  if (chance(0.4)) add(pick("accessory"));

  for (const e of state.worn) {
    const it = ITEM_BY_ID[e.id];
    if (it && it.recolor !== false && chance(0.35)) {
      Object.assign(e, itemShift(it, OPT.colorPresets[Math.floor(Math.random() * OPT.colorPresets.length)]));
    }
  }
  ui.bounceAt = performance.now();
  sound.play("random");
  changed();
}

// ---------------------------------------------------------------- paint
function setPaint(on) {
  if (ui.paint === on) return;
  ui.paint = on;
  sound.play(on ? "brushOn" : "brushOff");
  document.body.classList.toggle("painting", on);
  if (on) ui.prevView = ui.view;
  ui.view = on ? "paint" : ui.prevView === "paint" ? "closet" : ui.prevView || "closet";
  renderPanel();
}

function pickPaintColor(hex) {
  ui.paintColor = hex;
  const recent = store.get(STORE_RECENT, []).filter((c) => c !== hex);
  recent.unshift(hex);
  store.set(STORE_RECENT, recent.slice(0, 8));
  sound.play("color");
  renderPanel();
}

// 방 안의 (sx, sy) 지점에 무엇이 있는지 (가장 바깥 레이어부터)
function hitTest(sx, sy) {
  const ax = Math.floor(sx - AV_X);
  const ay = Math.floor(sy - (AV_Y + avatarOffset(performance.now())));
  if (ax < 0 || ay < 0 || ax >= AV || ay >= AV) return null;
  const stack = layerStack(state);
  for (let i = stack.length - 1; i >= 0; i--) {
    const l = stack[i];
    if (!l.canvas) continue;
    if (alphaAt(l.canvas, ax, ay) || alphaAt(l.canvas, ax, ay + 1)) {
      if (l.kind === "item" || l.kind === "hair") return l;
      return { kind: l.kind };
    }
  }
  return null;
}

function paintAt(sx, sy) {
  const hit = hitTest(sx, sy);
  ui.tapBrush = { x: sx, y: sy, at: performance.now() };
  if (!hit || hit.kind === "body" || hit.kind === "face") {
    sound.play("puff");
    addPuff(sx, sy);
    return;
  }
  if (hit.kind === "hair") {
    state.hairShift = shiftTo(hairAvg(state), ui.paintColor);
  } else {
    const it = ITEM_BY_ID[hit.entry.id];
    if (it.recolor === false) {
      sound.play("error");
      addPuff(sx, sy);
      return;
    }
    Object.assign(hit.entry, itemShift(it, ui.paintColor));
  }
  sound.play("paint");
  addSplash(sx, sy, ui.paintColor);
  ui.bounceAt = performance.now();
  changed();
}

// ---------------------------------------------------------------- celebrate
function celebrate() {
  const t = performance.now();
  ui.happy = true;
  ui.celebrateAt = t;
  ui.jumpAt = t;
  ui.flashes = [t + 520, t + 960, t + 1380];
  sound.play("fanfare");
  setTimeout(() => sound.play("shutter"), 520);
  setTimeout(() => sound.play("shutter"), 960);
  setTimeout(() => sound.play("shutter"), 1380);
  addConfetti();
}

// ================================================================ persistence
function snapshot() {
  return JSON.parse(JSON.stringify({
    bodyType: state.bodyType, skin: state.skin, hairStyle: state.hairStyle, hairColor: state.hairColor,
    hairShift: state.hairShift, face: state.face, background: state.background, worn: state.worn,
  }));
}

function applySnapshot(s) {
  if (!s) return;
  if (bodyTypes().some((b) => b.id === s.bodyType)) state.bodyType = s.bodyType;
  if (OPT.skinRamps[s.skin]) state.skin = s.skin;
  if (OPT.hairStyles.some((h) => h.id === s.hairStyle)) state.hairStyle = s.hairStyle;
  if (OPT.hairRamps[s.hairColor]) state.hairColor = s.hairColor;
  state.hairShift = s.hairShift || null;
  if (OPT.faces.some((f) => f.id === s.face)) state.face = s.face;
  if (OPT.backgrounds.some((b) => b.id === s.background)) state.background = s.background;
  if (Array.isArray(s.worn)) {
    const worn = s.worn.filter((e) => e.id === HAIR || ITEM_BY_ID[e.id]);
    if (!worn.some((e) => e.id === HAIR)) worn.push({ id: HAIR });
    state.worn = worn;
  }
}

let saveTimer;
function changed({ flashId } = {}) {
  ui.happy = false;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(STORE_CUR, snapshot()), 300);
  renderPanel({ flashId });
}

// ================================================================ custom items (웹에서 추가한 것)
async function loadManifest() {
  try {
    const r = await fetch(`data/custom.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return { items: [], backgrounds: [], variants: [] };
    const m = await r.json();
    return { items: m.items || [], backgrounds: m.backgrounds || [], variants: m.variants || [] };
  } catch (e) {
    return { items: [], backgrounds: [], variants: [] };
  }
}

const localURL = (rec) => {
  if (!objectURLs.has(rec.id + rec.createdAt)) objectURLs.set(rec.id + rec.createdAt, URL.createObjectURL(rec.blob));
  return objectURLs.get(rec.id + rec.createdAt);
};

function buildRegistry() {
  const onlineIds = new Set([
    ...MANIFEST.items.map((i) => i.id),
    ...MANIFEST.backgrounds.map((b) => b.id),
    ...MANIFEST.variants.map((v) => `var_${v.item}__${v.body}`),
  ]);
  const localItems = LOCALS.filter((r) => r.kind === "item" && !onlineIds.has(r.id))
    .map((r) => ({ id: r.id, ...r.data, src: localURL(r), custom: true }));
  const localBgs = LOCALS.filter((r) => r.kind === "background" && !onlineIds.has(r.id))
    .map((r) => ({ id: r.id, ...r.data, src: localURL(r), custom: true }));
  ITEMS = [...BASE_ITEMS, ...MANIFEST.items.map((i) => ({ ...i, custom: true })), ...localItems];
  ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
  OPT.backgrounds = [...BASE_BGS, ...MANIFEST.backgrounds.map((b) => ({ ...b, custom: true })), ...localBgs];
  VARIANTS = {};
  const addVar = (item, body, src) => ((VARIANTS[item] ||= {})[body] = src);
  for (const it of BASE_ITEMS) for (const [b, src] of Object.entries(it.variants || {})) addVar(it.id, b, src);
  for (const v of MANIFEST.variants) addVar(v.item, v.body, v.src);
  for (const r of LOCALS) if (r.kind === "variant" && !onlineIds.has(r.id)) addVar(r.data.item, r.data.body, localURL(r));
}

async function loadAllImages() {
  const srcs = [
    ...ITEMS.flatMap((i) => [i.src, ...(i.extraLayers || []).map((l) => l.src)]),
    ...OPT.backgrounds.map((b) => b.src),
    ...Object.values(VARIANTS).flatMap((v) => Object.values(v)),
  ];
  await Promise.all(srcs.map(loadImage));
}

async function reloadCustoms({ drop } = {}) {
  LOCALS = await idb.all();
  if (drop) {
    MANIFEST.items = MANIFEST.items.filter((i) => i.id !== drop);
    MANIFEST.backgrounds = MANIFEST.backgrounds.filter((b) => b.id !== drop);
    MANIFEST.variants = MANIFEST.variants.filter((v) => `var_${v.item}__${v.body}` !== drop);
  }
  buildRegistry();
  await loadAllImages();
  state.worn = state.worn.filter((e) => e.id === HAIR || ITEM_BY_ID[e.id]);
  if (!OPT.backgrounds.some((b) => b.id === state.background)) state.background = OPT.backgrounds[0].id;
  changed();
}

function customList() {
  const out = [];
  const catName = (k) => (CAT_BY_KEY[k] || {}).name || k;
  for (const i of MANIFEST.items) out.push({ id: i.id, name: i.name, label: catName(i.category), image: getImg(i.src), online: true, path: i.src });
  for (const b of MANIFEST.backgrounds) out.push({ id: b.id, name: b.name, label: "배경", image: getImg(b.src), online: true, path: b.src });
  for (const v of MANIFEST.variants) {
    const it = ITEM_BY_ID[v.item];
    out.push({ id: `var_${v.item}__${v.body}`, name: `${it ? it.name : v.item} (${bodyTypeOf(v.body).name})`, label: "체형 전용", image: getImg(v.src), online: true, path: v.src });
  }
  const online = new Set(out.map((o) => o.id));
  for (const r of LOCALS) {
    if (online.has(r.id)) continue;
    let name = r.data.name, label;
    if (r.kind === "background") label = "배경";
    else if (r.kind === "variant") {
      const it = ITEM_BY_ID[r.data.item];
      name = `${it ? it.name : r.data.item} (${bodyTypeOf(r.data.body).name})`;
      label = "체형 전용";
    } else label = catName(r.data.category);
    out.push({ id: r.id, name, label, image: getImg(localURL(r)), online: false, pending: r.published });
  }
  return out.reverse();
}

// 인페인팅 기준 바디: 원본 피부색(예약색) + 여성 속옷 + 기본 얼굴, 머리 없음
function referenceCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = AV;
  const ctx = c.getContext("2d");
  ctx.drawImage(getImg(OPT.body.body), 0, 0);
  ctx.drawImage(getImg(OPT.body.underwear), 0, 0);
  const face = findBy(OPT.faces, "neutral");
  if (getImg(face.src)) ctx.drawImage(getImg(face.src), 0, 0);
  return c;
}

// 관리 화면 미리보기: 지금 코디 위에 새 그림을 얹어서
function previewWith(layer, kind, variant) {
  const st = { ...state, worn: [...state.worn] };
  if (kind === "bg") {
    const c = document.createElement("canvas");
    c.width = STAGE_W; c.height = STAGE_H;
    const ctx = c.getContext("2d");
    ctx.drawImage(layer, 0, 0);
    composeAvatar(avCtx, st);
    ctx.drawImage(avCanvas, AV_X, AV_Y);
    return c;
  }
  if (variant) {
    st.bodyType = variant.body;
    st.worn = st.worn.filter((e) => e.id !== variant.item);
  }
  const c = document.createElement("canvas");
  c.width = STAGE_W; c.height = STAGE_H;
  const ctx = c.getContext("2d");
  const bg = getImg(findBy(OPT.backgrounds, st.background).src);
  if (bg) ctx.drawImage(bg, 0, 0);
  composeAvatar(avCtx, st, { extra: variant ? layer : warp(layer, st.bodyType) });
  ctx.drawImage(avCanvas, AV_X, AV_Y);
  return c;
}

// ================================================================ UI: panel
function tabsList() {
  return [
    { key: "body", name: "바디" },
    { key: "hair", name: "헤어" },
    { key: "bg", name: "배경" },
    ...OPT.tabOrder.filter((k) => CAT_BY_KEY[k]).map((k) => ({ key: k, name: CAT_BY_KEY[k].name })),
  ];
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  for (const t of tabsList()) {
    const b = el("button", "tab" + (ui.tab === t.key ? " on" : ""));
    const n = CAT_BY_KEY[t.key] ? state.worn.filter((e) => ITEM_BY_ID[e.id]?.category === t.key).length : 0;
    b.innerHTML = esc(t.name) + (n ? `<span class="n">${n}</span>` : "");
    b.onclick = () => {
      ui.tab = t.key;
      sound.play("tab");
      renderPanel();
      b.scrollIntoView({ inline: "nearest", block: "nearest" });
    };
    tabs.append(b);
  }
}

function avatarThumb(st, box, max = 56) {
  const c = document.createElement("canvas");
  c.width = c.height = AV;
  composeAvatar(c.getContext("2d"), { ...st, worn: [{ id: HAIR }] });
  return thumb(c, box, max);
}

function swatch(color, on, onClick, title) {
  const b = el("button", "swatch" + (on ? " on" : ""));
  b.style.background = color;
  b.title = title || "";
  b.setAttribute("aria-label", title || color);
  b.onclick = onClick;
  return b;
}

const section = (title) => el("div", "section-title", esc(title));

function itemTile(content, { on = false, label, onClick, isNew = false }) {
  const b = el("button", "item" + (on ? " on" : "") + (label ? " has-label" : "") + (isNew ? " new" : ""));
  b.append(content);
  if (label) b.append(el("span", "label", esc(label)));
  b.onclick = onClick;
  return b;
}

function renderContent() {
  const box = $("#content");
  box.innerHTML = "";

  if (ui.tab === "body") {
    box.append(section("체형"));
    const gb = el("div", "grid");
    for (const b of bodyTypes()) {
      gb.append(itemTile(avatarThumb({ ...state, bodyType: b.id }, { x: 26, y: 4, w: 76, h: 122 }, 60), {
        on: state.bodyType === b.id, label: b.name,
        onClick: () => { state.bodyType = b.id; sound.play("select"); ui.bounceAt = performance.now(); changed(); },
      }));
    }
    box.append(gb);
    box.append(section("피부색"));
    const row = el("div", "swatch-row");
    for (const [k, ramp] of Object.entries(OPT.skinRamps)) {
      if (k.startsWith("_")) continue;
      row.append(swatch(ramp[1], state.skin === k, () => { state.skin = k; sound.play("select"); ui.bounceAt = performance.now(); changed(); }, k));
    }
    box.append(row);
    box.append(section("표정"));
    const g = el("div", "grid");
    for (const f of OPT.faces) {
      if (f.hidden) continue;
      g.append(itemTile(avatarThumb({ ...state, face: f.id }, { x: 38, y: 2, w: 52, h: 52 }), {
        on: state.face === f.id, label: f.name,
        onClick: () => { state.face = f.id; sound.play("select"); ui.bounceAt = performance.now(); changed(); },
      }));
    }
    box.append(g);
    return;
  }

  if (ui.tab === "hair") {
    box.append(section("헤어 색"));
    const row = el("div", "swatch-row");
    for (const [k, ramp] of Object.entries(OPT.hairRamps)) {
      if (k.startsWith("_")) continue;
      row.append(swatch(ramp[1], state.hairColor === k && !state.hairShift, () => {
        state.hairColor = k; state.hairShift = null; sound.play("select"); changed();
      }, k));
    }
    box.append(row);
    box.append(section("헤어 스타일"));
    const g = el("div", "grid");
    for (const h of OPT.hairStyles) {
      g.append(itemTile(avatarThumb({ ...state, hairStyle: h.id }, { x: 38, y: 2, w: 52, h: 52 }), {
        on: state.hairStyle === h.id, label: h.name,
        onClick: () => { state.hairStyle = h.id; sound.play("equip"); ui.bounceAt = performance.now(); changed(); },
      }));
    }
    box.append(g);
    return;
  }

  if (ui.tab === "bg") {
    const g = el("div", "grid");
    for (const b of OPT.backgrounds) {
      const im = getImg(b.src);
      g.append(itemTile(thumb(im, im && { x: 0, y: 0, w: im.width, h: im.height }, 56), {
        on: state.background === b.id, label: b.name, isNew: b.custom,
        onClick: () => { state.background = b.id; sound.play("select"); changed(); },
      }));
    }
    g.append(addTile());
    box.append(g);
    return;
  }

  const list = ITEMS.filter((i) => i.category === ui.tab);
  const cat = CAT_BY_KEY[ui.tab];
  box.append(section(cat.multi ? "여러 개 겹쳐 입을 수 있어요" : "하나만 착용돼요"));
  const g = el("div", "grid");
  for (const it of list) {
    const im = getImg(it.src);
    g.append(itemTile(thumb(im, bbox(im)), {
      on: wornIndex(it.id) >= 0, label: it.name, isNew: it.custom,
      onClick: () => toggleItem(it.id),
    }));
  }
  g.append(addTile());
  box.append(g);
}

function addTile() {
  const b = el("button", "item add-tile has-label");
  b.innerHTML = `<img class="icon" src="assets/ui/icon_plus.png" alt=""><span class="label">추가하기</span>`;
  b.onclick = () => openAdmin();
  return b;
}

function iconBtn(icon, label, onClick, disabled) {
  const b = el("button", "icon-btn");
  b.innerHTML = `<img class="icon" src="assets/ui/icon_${icon}.png" alt="">`;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.disabled = !!disabled;
  b.onclick = onClick;
  return b;
}

function renderLayers(box, flashId) {
  const wrap = el("div", "layers");
  wrap.append(el("div", "layer-edge", "▲ 바깥쪽 (위에 덮여요)"));
  const n = state.worn.length;
  for (let i = n - 1; i >= 0; i--) {
    const e = state.worn[i];
    const row = el("div", "layer" + (e.id === HAIR ? " fixed" : "") + (e.id === flashId ? " flash" : ""));
    const t = el("div", "thumb");
    let name, sub;
    if (e.id === HAIR) {
      const c = hairLayer({ ...state, bodyType: "regular" }, "front");
      t.append(thumb(c, bbox(c), 32));
      name = "앞머리";
      sub = "헤어";
    } else {
      const it = ITEM_BY_ID[e.id];
      const c = recolorSource(it.src, getImg(it.src), e.hue, e.sat, e.light);
      t.append(thumb(c, bbox(getImg(it.src)), 32));
      name = it.name;
      sub = CAT_BY_KEY[it.category].name + (e.hue || e.sat || e.light ? " · 색 변경" : "");
    }
    row.append(t);
    row.append(el("div", "name", `<b>${esc(name)}</b><small>${esc(sub)}</small>`));
    row.append(iconBtn("up", "바깥으로", () => move(e.id, +1), i === n - 1));
    row.append(iconBtn("down", "안쪽으로", () => move(e.id, -1), i === 0));
    if (e.id !== HAIR) {
      row.append(iconBtn("palette", "색 바꾸기", () => openColor(i)));
      row.append(iconBtn("x", "벗기", () => { unwear(e.id); changed(); }));
    }
    wrap.append(row);
    if (e.id === flashId) setTimeout(() => row.classList.remove("flash"), 260);
  }
  wrap.append(el("div", "layer-edge", "▼ 안쪽 (몸에 가까워요)"));
  if (n === 1) wrap.append(el("div", "empty", "아직 입은 옷이 없어요<br>옷장에서 골라보세요"));
  box.append(wrap);
}

function renderPaint(box) {
  const head = el("div", "paint-head");
  const cur = el("div", "paint-current");
  cur.style.background = ui.paintColor;
  head.append(cur);
  head.append(el("div", "paint-title", `<b>붓 색 고르기</b><small>방 안의 옷이나 머리를 톡 누르면 염색돼요</small>`));
  const done = el("button", "btn small primary", "붓 내려놓기");
  done.onclick = () => setPaint(false);
  head.append(done);
  box.append(head);

  const recent = store.get(STORE_RECENT, []);
  if (recent.length) {
    box.append(section("최근 쓴 색"));
    const r = el("div", "swatch-row");
    recent.forEach((c) => r.append(swatch(c, c === ui.paintColor, () => pickPaintColor(c), c)));
    box.append(r);
  }
  box.append(section("팔레트"));
  const g = el("div", "swatches paint-swatches");
  const palette = OPT.paintPalette || OPT.colorPresets;
  palette.forEach((c) => g.append(swatch(c, c === ui.paintColor, () => pickPaintColor(c), c)));
  box.append(g);

  box.append(section("직접 고르기 (모든 색)"));
  const pick = el("label", "color-pick");
  pick.innerHTML = `<input type="color" value="${ui.paintColor}"><span>색상표 열기</span>`;
  pick.querySelector("input").onchange = (e) => pickPaintColor(e.target.value);
  box.append(pick);
}

function renderPanel({ flashId } = {}) {
  const painting = ui.view === "paint";
  $("#seg").hidden = painting;
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("on", b.dataset.view === ui.view));
  $("#layerCount").textContent = state.worn.length - 1;
  $("#tabs").hidden = ui.view !== "closet";
  if (ui.view === "closet") renderTabs();
  const box = $("#content");
  const keep = box.scrollTop;
  box.innerHTML = "";
  if (ui.view === "layers") renderLayers(box, flashId);
  else if (painting) renderPaint(box);
  else renderContent();
  box.scrollTop = keep;
}

// ================================================================ UI: color sheet (레이어에서 세밀 조정)
function openColor(index) {
  ui.colorIndex = index;
  const e = state.worn[index];
  const it = ITEM_BY_ID[e.id];
  $("#colorName").textContent = it.name;
  const off = it.recolor === false;
  $("#colorBody").hidden = off;
  $("#colorOff").hidden = !off;
  $("#colorReset").hidden = off;
  const pres = $("#colorPresets");
  pres.innerHTML = "";
  for (const hex of OPT.colorPresets) {
    pres.append(swatch(hex, false, () => {
      Object.assign(e, itemShift(it, hex));
      sound.play("color");
      syncColor();
    }, hex));
  }
  syncColor();
  $("#colorSheet").hidden = false;
}

function syncColor() {
  const e = state.worn[ui.colorIndex];
  if (!e) return;
  const it = ITEM_BY_ID[e.id];
  $("#hueIn").value = e.hue || 0;
  $("#satIn").value = e.sat || 0;
  $("#lightIn").value = e.light || 0;
  const t = $("#colorThumb");
  const base = getImg(it.src);
  const src = recolorSource(it.src, base, e.hue, e.sat, e.light);
  const b = bbox(base);
  if (b && src) {
    t.width = b.w; t.height = b.h;
    const ctx = t.getContext("2d");
    ctx.clearRect(0, 0, b.w, b.h);
    ctx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    const s = Math.max(1, Math.floor(48 / Math.max(b.w, b.h)));
    t.style.width = `${b.w * s}px`;
    t.style.height = `${b.h * s}px`;
  }
}

function bindColorSheet() {
  const onInput = () => {
    const e = state.worn[ui.colorIndex];
    if (!e) return;
    e.hue = +$("#hueIn").value;
    e.sat = +$("#satIn").value;
    e.light = +$("#lightIn").value;
    syncColor();
  };
  ["#hueIn", "#satIn", "#lightIn"].forEach((s) => {
    $(s).addEventListener("input", onInput);
    $(s).addEventListener("change", () => sound.play("color"));
  });
  $("#colorReset").onclick = () => {
    const e = state.worn[ui.colorIndex];
    if (e) Object.assign(e, { hue: 0, sat: 0, light: 0 });
    sound.play("unequip");
    syncColor();
  };
  const close = () => {
    $("#colorSheet").hidden = true;
    ui.colorIndex = -1;
    changed();
  };
  $("#colorDone").onclick = () => { sound.play("select"); close(); };
  $("#colorSheet").addEventListener("click", (ev) => { if (ev.target.id === "colorSheet") close(); });
}

// ================================================================ UI: save slots
function stageSnapshotCanvas(scale = 1, st = state) {
  renderStage(stageCtx, performance.now(), st, { motion: false, overlay: false });
  const c = document.createElement("canvas");
  c.width = STAGE_W * scale;
  c.height = STAGE_H * scale;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(stageCanvas, 0, 0, c.width, c.height);
  return c;
}

function renderSlots() {
  const slots = store.get(STORE_SLOTS, []);
  const box = $("#slots");
  box.innerHTML = "";
  for (let i = 0; i < SLOT_COUNT; i++) {
    const s = slots[i];
    const row = el("div", "slot");
    const img = el("img", "shot");
    if (s && s.shot) img.src = s.shot;
    img.alt = "";
    row.append(img);
    const date = s ? new Date(s.at) : null;
    row.append(el("div", "meta", s
      ? `<b>코디 ${i + 1}</b><small>${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · 아이템 ${s.state.worn.length - 1}개</small>`
      : `<b>코디 ${i + 1}</b><small>비어 있어요</small>`));
    const acts = el("div", "acts");
    const saveB = el("button", "btn small primary", "저장");
    saveB.onclick = () => {
      slots[i] = { at: Date.now(), state: snapshot(), shot: stageSnapshotCanvas(1).toDataURL("image/png") };
      store.set(STORE_SLOTS, slots);
      sound.play("shutter");
      toast(`코디 ${i + 1}에 저장했어요`);
      renderSlots();
    };
    acts.append(saveB);
    if (s) {
      const loadB = el("button", "btn small", "불러오기");
      loadB.onclick = () => {
        applySnapshot(s.state);
        sound.play("equip");
        ui.bounceAt = performance.now();
        closeSheets();
        changed();
      };
      acts.append(loadB);
    }
    row.append(acts);
    box.append(row);
  }
}

// ================================================================ recording
let countdownTimer = null;
async function toggleRecord() {
  if (recorder && recorder.active) return stopRecord();
  if (countdownTimer) return;
  if (!Recorder.supported()) {
    toast("이 브라우저는 녹화를 지원하지 않아요");
    sound.play("error");
    return;
  }
  setPaint(false);
  const cd = $("#countdown");
  let n = 3;
  cd.hidden = false;
  cd.textContent = n;
  sound.play("count");
  $("#recBtn").classList.add("arming");
  countdownTimer = setInterval(() => {
    n--;
    if (n > 0) {
      cd.textContent = n;
      sound.play("count");
      return;
    }
    clearInterval(countdownTimer);
    countdownTimer = null;
    cd.hidden = true;
    startRecord();
  }, 700);
}

function startRecord() {
  recorder = recorder || new Recorder({ width: STAGE_W * REC_SCALE, height: STAGE_H * REC_SCALE });
  try {
    recorder.start(sound.streamDest());
  } catch (e) {
    console.error(e);
    toast("녹화를 시작하지 못했어요");
    $("#recBtn").classList.remove("arming");
    return;
  }
  sound.play("recStart");
  document.body.classList.add("recording");
  $("#recBtn").classList.remove("arming");
  $("#recLabel").textContent = "녹화 끝";
  $("#recIcon").src = "assets/ui/icon_stop.png";
  $("#recBadge").hidden = false;
}

async function stopRecord() {
  const res = await recorder.stop();
  sound.play("recStop");
  document.body.classList.remove("recording");
  $("#recLabel").textContent = "녹화";
  $("#recIcon").src = "assets/ui/icon_rec.png";
  $("#recBadge").hidden = true;
  if (!res || !res.blob.size) {
    toast("녹화된 내용이 없어요");
    return;
  }
  showVideo(res);
}

let lastVideoURL = null;
function showVideo({ blob, ext }) {
  if (lastVideoURL) URL.revokeObjectURL(lastVideoURL);
  lastVideoURL = URL.createObjectURL(blob);
  const name = `pixel-closet-${stamp()}.${ext}`;
  const v = $("#videoPreview");
  v.src = lastVideoURL;
  $("#videoInfo").textContent = `${(blob.size / 1024 / 1024).toFixed(1)}MB · ${ext.toUpperCase()}${ext === "webm" ? " (인스타에 올리려면 mp4 변환이 필요할 수 있어요)" : ""}`;
  $("#videoSave").onclick = () => download(blob, name);
  const file = new File([blob], name, { type: blob.type });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  $("#videoShare").hidden = !canShare;
  $("#videoShare").onclick = async () => {
    try {
      await navigator.share({ files: [file], title: "PIXEL CLOSET" });
    } catch (e) { /* 취소 */ }
  };
  openSheet("#videoSheet");
}

// ================================================================ UI: misc
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
}

function flashScreen() {
  const f = $("#flash");
  f.classList.remove("go");
  void f.offsetWidth;
  f.classList.add("go");
}

function spark(x, y) {
  const s = el("div", "spark");
  s.style.left = `${x}px`;
  s.style.top = `${y}px`;
  document.body.append(s);
  setTimeout(() => s.remove(), 450);
}

function exportPNG() {
  const c = stageSnapshotCanvas(6);
  flashScreen();
  sound.play("shutter");
  c.toBlob((blob) => {
    if (!blob) return;
    download(blob, `pixel-closet-${stamp()}.png`);
    toast("PNG를 저장했어요");
  }, "image/png");
}

function setPhoto(on) {
  if (on) setPaint(false);
  document.body.classList.toggle("photo", on);
  layout();
}

function openSheet(sel) {
  closeSheets();
  $(sel).hidden = false;
}
function closeSheets() {
  document.querySelectorAll(".sheet-back").forEach((s) => (s.hidden = true));
}

function syncAudioBtns() {
  $("#bgmToggle").textContent = `배경음악 ${sound.bgmOn ? "ON" : "OFF"}`;
  $("#sfxToggle").textContent = `효과음 ${sound.sfxOn ? "ON" : "OFF"}`;
  $("#bgmToggle").classList.toggle("off", !sound.bgmOn);
  $("#sfxToggle").classList.toggle("off", !sound.sfxOn);
  store.set("pixelcloset.v1.audio", { bgm: sound.bgmOn, sfx: sound.sfxOn });
}

function stagePoint(ev) {
  const r = $("#stage").getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * STAGE_W,
    y: ((ev.clientY - r.top) / r.height) * STAGE_H,
  };
}

function bindStage() {
  const cv = $("#stage");
  cv.addEventListener("pointermove", (ev) => {
    const p = stagePoint(ev);
    ui.pointer = { ...p, mouse: ev.pointerType === "mouse" };
    const overBtn = p.x >= BRUSH_BTN.x && p.x < BRUSH_BTN.x + BRUSH_BTN.w + 1 && p.y >= BRUSH_BTN.y && p.y < BRUSH_BTN.y + BRUSH_BTN.h + 1;
    cv.classList.toggle("over-btn", overBtn);
  });
  cv.addEventListener("pointerleave", () => (ui.pointer = null));
  cv.addEventListener("pointerdown", (ev) => {
    if (document.body.classList.contains("photo")) return;
    const p = stagePoint(ev);
    const t = performance.now();
    if (p.x >= BRUSH_BTN.x - 2 && p.x < BRUSH_BTN.x + BRUSH_BTN.w + 3 && p.y >= BRUSH_BTN.y - 2 && p.y < BRUSH_BTN.y + BRUSH_BTN.h + 3) {
      setPaint(!ui.paint);
      ui.fx.push({ type: "spark", x: BRUSH_BTN.x + 9, y: BRUSH_BTN.y + 9, t0: t, life: 300 });
      return;
    }
    if (ui.paint) {
      paintAt(p.x, p.y);
      return;
    }
    ui.fx.push({ type: "spark", x: p.x, y: p.y, t0: t, life: 360 });
    const hit = hitTest(p.x, p.y);
    if (hit) {
      ui.bounceAt = t;
      sound.play("tab");
    }
  });
}

function bindUI() {
  document.querySelectorAll(".seg-btn").forEach((b) => {
    b.onclick = () => {
      ui.view = b.dataset.view;
      sound.play("tab");
      renderPanel();
    };
  });
  $("#randomBtn").onclick = randomize;
  $("#doneBtn").onclick = celebrate;
  $("#recBtn").onclick = toggleRecord;
  $("#menuBtn").onclick = () => { sound.play("tab"); openSheet("#menuSheet"); };

  $("#mSave").onclick = () => { sound.play("tab"); renderSlots(); openSheet("#saveSheet"); };
  $("#mPhoto").onclick = () => { closeSheets(); flashScreen(); sound.play("shutter"); setPhoto(true); };
  $("#mPng").onclick = () => { closeSheets(); exportPNG(); };
  $("#mAdmin").onclick = () => { closeSheets(); openAdmin(); };
  $("#bgmToggle").onclick = () => { sound.setBgm(!sound.bgmOn); sound.play("tab"); syncAudioBtns(); };
  $("#sfxToggle").onclick = () => { sound.sfxOn = !sound.sfxOn; sound.play("tab"); syncAudioBtns(); };
  syncAudioBtns();

  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => { sound.play("tab"); closeSheets(); }));
  document.querySelectorAll(".sheet-back").forEach((s) => s.addEventListener("click", (ev) => {
    if (ev.target === s && s.id !== "colorSheet") closeSheets();
  }));

  $("#stageWrap").addEventListener("click", (ev) => {
    if (document.body.classList.contains("photo")) setPhoto(false);
  });

  bindColorSheet();
  bindStage();

  document.addEventListener("pointerdown", (ev) => {
    if (ev.target.id === "stage") return; // 방 안에서는 캔버스에 직접 그림
    spark(ev.clientX, ev.clientY);
  }, { passive: true });
  document.addEventListener("pointerover", (ev) => {
    if (ev.pointerType !== "mouse") return;
    const b = ev.target.closest("button");
    if (b && !b.contains(ev.relatedTarget)) sound.play("hover");
  });
}

// ================================================================ layout & loop
function layout() {
  const wrap = $("#stageWrap");
  const r = wrap.getBoundingClientRect();
  const photo = document.body.classList.contains("photo");
  const pad = photo ? 0 : 16;
  fitCanvas($("#stage"), r.width - pad, r.height - pad, photo);
}

function startLayout() {
  const pv = $("#startPreview");
  const maxH = Math.min(window.innerHeight * 0.48, 420);
  fitCanvas(pv, Math.min(window.innerWidth - 40, 340), maxH);
}

let started = false;
function loop(t) {
  if (t > ui.nextBlink) {
    ui.blinkUntil = t + 140;
    ui.nextBlink = t + 2400 + Math.random() * 2800;
  }
  renderStage(stageCtx, t);
  if (started) blit($("#stage"));
  else blit($("#startPreview"));
  if (recorder && recorder.active) {
    recorder.draw(stageCanvas);
    const s = Math.floor(recorder.elapsed() / 1000);
    $("#recTime").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  requestAnimationFrame(loop);
}

// ================================================================ boot
async function boot() {
  const [opt, items, manifest, locals] = await Promise.all([
    fetch("data/options.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/items.json", { cache: "no-cache" }).then((r) => r.json()),
    loadManifest(),
    idb.all(),
  ]);
  OPT = opt;
  BASE_ITEMS = items;
  BASE_BGS = [...opt.backgrounds];
  MANIFEST = manifest;
  CAT_BY_KEY = Object.fromEntries(opt.categories.map((c) => [c.key, c]));
  OUTLINE_SET = new Set((opt.outlineColors || []).map(hexToInt));
  document.title = opt.title || document.title;
  $("#logo").textContent = opt.title || "PIXEL CLOSET";
  ui.tab = opt.tabOrder[0] || "top";

  // 온라인에 반영된 로컬 사본은 정리
  const onlineIds = new Set([
    ...manifest.items.map((i) => i.id), ...manifest.backgrounds.map((b) => b.id),
    ...manifest.variants.map((v) => `var_${v.item}__${v.body}`),
  ]);
  for (const r of locals) if (r.published && onlineIds.has(r.id)) await idb.del(r.id);
  LOCALS = locals.filter((r) => !(r.published && onlineIds.has(r.id)));
  buildRegistry();

  const d = opt.defaults || {};
  Object.assign(state, {
    bodyType: d.bodyType || state.bodyType,
    skin: d.skin || state.skin,
    hairStyle: d.hairStyle || state.hairStyle,
    hairColor: d.hairColor || state.hairColor,
    face: d.face || state.face,
    background: d.background || state.background,
  });

  const srcs = [
    opt.body.body, opt.body.underwear, opt.body.shadow,
    "assets/ui/brush.png", "assets/ui/cursor.png",
    ...bodyTypes().flatMap((b) => [b.body, b.underwear]).filter(Boolean),
    ...opt.hairStyles.flatMap((h) => [h.back, h.front]),
    ...opt.faces.flatMap((f) => [f.src, f.blink].filter(Boolean)),
  ];
  await Promise.all([...srcs.map(loadImage), loadAllImages(), document.fonts && document.fonts.load("700 12px Galmuri11")]);
  measureCore();

  applySnapshot(store.get(STORE_CUR, null));

  const audioPref = store.get("pixelcloset.v1.audio", { bgm: true, sfx: true });
  sound = new Sound({ bpm: opt.audio.bpm, bgmSrc: opt.audio.bgm });
  sound.bgmOn = audioPref.bgm !== false;
  sound.sfxOn = audioPref.sfx !== false;

  initAdmin({
    sound, toast,
    categories: () => opt.categories,
    items: () => ITEMS,
    bodyTypes,
    reservedColors: () => [...OPT.skinRamps._source, ...OPT.hairRamps._source],
    referenceCanvas, previewWith, reloadCustoms, customList,
    defaultRepo: opt.github && opt.github.repo,
    defaultBranch: (opt.github && opt.github.branch) || "main",
  });
  bindUI();
  renderPanel();
  startLayout();
  window.addEventListener("resize", () => (started ? layout() : startLayout()));
  new ResizeObserver(() => started && layout()).observe($("#stageWrap"));
  requestAnimationFrame(loop);

  $("#startBtn").onclick = async () => {
    await sound.init();
    sound.play("start");
    sound.startBgm();
    started = true;
    layout();
    $("#start").classList.add("leaving");
    setTimeout(() => $("#start").remove(), 500);
  };
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend",
    `<div class="toast show" style="animation:none;opacity:1">데이터를 불러오지 못했어요 (${esc(e.message)})</div>`);
});
