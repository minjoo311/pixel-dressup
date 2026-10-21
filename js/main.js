import { Sound } from "./audio.js";

// ================================================================ constants
const STAGE_W = 160;
const STAGE_H = 192;
const AV = 128;
const AV_X = 16;
const AV_Y = 56;
const HAIR = "__hair_front";
const STORE_CUR = "pixelcloset.v1.current";
const STORE_SLOTS = "pixelcloset.v1.slots";
const SLOT_COUNT = 3;

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

// ================================================================ data
let OPT, ITEMS, ITEM_BY_ID, CAT_BY_KEY;
const images = new Map();
let sound;

const state = {
  skin: "medium",
  hairStyle: "long",
  hairColor: "brown",
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
  colorIndex: -1,
};

// ================================================================ helpers: color
const hexToInt = (h) => parseInt(h.replace("#", ""), 16);
const rgbInt = (r, g, b) => (r << 16) | (g << 8) | b;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ================================================================ helpers: images
function loadImage(src) {
  if (images.has(src)) return images.get(src).promise;
  const im = new Image();
  const rec = { im, ok: false };
  rec.promise = new Promise((res) => {
    im.onload = () => { rec.ok = true; res(im); };
    im.onerror = () => { console.warn("이미지를 찾을 수 없어요:", src); res(null); };
  });
  im.src = src;
  images.set(src, rec);
  return rec.promise;
}
const getImg = (src) => {
  const r = src && images.get(src);
  return r && r.ok ? r.im : null;
};

function toCanvas(im) {
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  c.getContext("2d").drawImage(im, 0, 0);
  return c;
}

const swapCache = new Map();
// 예약색(_source)을 선택한 램프 색으로 교체
function paletteSwap(src, fromHex, toHex) {
  const key = `${src}|${toHex.join(",")}`;
  if (swapCache.has(key)) return swapCache.get(key);
  const im = getImg(src);
  if (!im) return null;
  const c = toCanvas(im);
  const ctx = c.getContext("2d");
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

let OUTLINE_SET = new Set();
const recolorCache = new Map();
function recolor(src, hue = 0, sat = 0, light = 0) {
  const im = getImg(src);
  if (!im) return null;
  if (!hue && !sat && !light) return im;
  const key = `${src}|${hue}|${sat}|${light}`;
  if (recolorCache.has(key)) return recolorCache.get(key);
  const c = toCanvas(im);
  const ctx = c.getContext("2d");
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
  if (recolorCache.size > 300) recolorCache.clear();
  recolorCache.set(key, c);
  return c;
}

const avgCache = new Map();
// 아이템의 대표 색 (외곽선 제외 평균)
function avgHsl(src) {
  if (avgCache.has(src)) return avgCache.get(src);
  const im = getImg(src);
  if (!im) return [0, 0, 0.5];
  const d = toCanvas(im).getContext("2d").getImageData(0, 0, im.width, im.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || OUTLINE_SET.has(rgbInt(d[i], d[i + 1], d[i + 2]))) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  const v = n ? rgbToHsl(r / n, g / n, b / n) : [0, 0, 0.5];
  avgCache.set(src, v);
  return v;
}

const bboxCache = new Map();
function bbox(src) {
  if (bboxCache.has(src)) return bboxCache.get(src);
  const im = getImg(src);
  if (!im) return null;
  const d = toCanvas(im).getContext("2d").getImageData(0, 0, im.width, im.height).data;
  let x0 = im.width, y0 = im.height, x1 = -1, y1 = -1;
  for (let y = 0; y < im.height; y++) {
    for (let x = 0; x < im.width; x++) {
      if (d[(y * im.width + x) * 4 + 3]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const b = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  bboxCache.set(src, b);
  return b;
}

// 정수배 확대 썸네일
function thumb(source, box, maxPx = 52) {
  const c = document.createElement("canvas");
  c.className = "pixel";
  if (!source || !box) return c;
  c.width = box.w;
  c.height = box.h;
  c.getContext("2d").drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const big = Math.max(box.w, box.h);
  const s = big * 1 > maxPx ? maxPx / big : Math.max(1, Math.floor(maxPx / big));
  c.style.width = `${box.w * s}px`;
  c.style.height = `${box.h * s}px`;
  return c;
}

// ================================================================ avatar rendering
const avCanvas = document.createElement("canvas");
avCanvas.width = AV;
avCanvas.height = AV;
const avCtx = avCanvas.getContext("2d");

const stageCanvas = document.createElement("canvas");
stageCanvas.width = STAGE_W;
stageCanvas.height = STAGE_H;
const stageCtx = stageCanvas.getContext("2d");

const findBy = (arr, id) => arr.find((x) => x.id === id) || arr[0];

function skinLayer(src) {
  return paletteSwap(src, OPT.skinRamps._source, OPT.skinRamps[state.skin] || OPT.skinRamps._source);
}
function hairLayer(src) {
  return paletteSwap(src, OPT.hairRamps._source, OPT.hairRamps[state.hairColor] || OPT.hairRamps._source);
}

function hiddenSet(worn) {
  const s = new Set();
  for (const e of worn) {
    const it = ITEM_BY_ID[e.id];
    if (it && it.hides) it.hides.forEach((h) => s.add(h));
  }
  return s;
}

function composeAvatar(ctx, st, { blink = false } = {}) {
  ctx.clearRect(0, 0, AV, AV);
  const hair = findBy(OPT.hairStyles, st.hairStyle);
  const face = findBy(OPT.faces, st.face);
  const hidden = hiddenSet(st.worn);
  const prevSkin = state.skin, prevHair = state.hairColor;
  state.skin = st.skin; state.hairColor = st.hairColor; // 썸네일 렌더용 임시 전환
  const draw = (c) => c && ctx.drawImage(c, 0, 0);

  if (!hidden.has("hair_back")) draw(hairLayer(hair.back));
  for (const e of st.worn) {
    const it = ITEM_BY_ID[e.id];
    if (it && it.extraLayers) it.extraLayers.filter((l) => (l.z ?? 0) < 20).forEach((l) => draw(recolor(l.src, e.hue, e.sat, e.light)));
  }
  draw(skinLayer(OPT.body.body));
  draw(getImg(OPT.body.underwear));
  draw(getImg(blink && face.blink ? face.blink : face.src));
  for (const e of st.worn) {
    if (e.id === HAIR) {
      if (!hidden.has("hair_front")) draw(hairLayer(hair.front));
      continue;
    }
    const it = ITEM_BY_ID[e.id];
    if (!it || hidden.has(it.category)) continue;
    if (it.extraLayers) it.extraLayers.filter((l) => (l.z ?? 0) >= 20).forEach((l) => draw(recolor(l.src, e.hue, e.sat, e.light)));
    draw(recolor(it.src, e.hue, e.sat, e.light));
  }
  state.skin = prevSkin; state.hairColor = prevHair;
}

function renderStage(ctx, t, st = state, { motion = true } = {}) {
  ctx.clearRect(0, 0, STAGE_W, STAGE_H);
  const bg = getImg(findBy(OPT.backgrounds, st.background).src);
  if (bg) ctx.drawImage(bg, 0, 0);
  else { ctx.fillStyle = "#f6e7ee"; ctx.fillRect(0, 0, STAGE_W, STAGE_H); }

  const shadow = getImg(OPT.body.shadow);
  if (shadow) {
    ctx.globalAlpha = 0.25;
    ctx.drawImage(shadow, AV_X, AV_Y + 116);
    ctx.globalAlpha = 1;
  }

  composeAvatar(avCtx, st, { blink: motion && t < ui.blinkUntil });

  let y = AV_Y;
  if (motion) {
    const dt = t - ui.bounceAt;
    if (dt < 80) y -= 2;
    else if (dt < 160) y -= 1;
  }
  const beat = 60000 / (OPT.audio.bpm || 100);
  const breathe = motion && Math.floor(t / beat) % 2 === 1;
  if (breathe) {
    const split = OPT.body.breathSplitY || 76;
    ctx.drawImage(avCanvas, 0, split, AV, AV - split, AV_X, y + split, AV, AV - split);
    ctx.drawImage(avCanvas, 0, 0, AV, split, AV_X, y + 1, AV, split);
  } else {
    ctx.drawImage(avCanvas, AV_X, y);
  }
}

// 화면 캔버스: 기기 픽셀 기준 정수배로 확대해서 선명하게
function fitCanvas(canvas, availW, availH, cover = false) {
  const dpr = window.devicePixelRatio || 1;
  const fitW = (availW * dpr) / STAGE_W, fitH = (availH * dpr) / STAGE_H;
  let S = Math.max(1, Math.floor(Math.min(fitW, fitH)));
  // 사진 모드: 좌우를 살짝 잘라서라도 화면 폭을 꽉 채움 (정수배 유지)
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
const zOf = (e) => (e.id === HAIR ? OPT.hairFrontZ : CAT_BY_KEY[ITEM_BY_ID[e.id].category].defaultZ);
const wornIndex = (id) => state.worn.findIndex((e) => e.id === id);

function wear(id, { silent = false } = {}) {
  const it = ITEM_BY_ID[id];
  if (!it) return;
  const cat = CAT_BY_KEY[it.category];
  if (!cat.multi) {
    state.worn = state.worn.filter((e) => e.id === HAIR || ITEM_BY_ID[e.id].category !== it.category);
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
      Object.assign(e, presetShift(it, OPT.colorPresets[Math.floor(Math.random() * OPT.colorPresets.length)]));
    }
  }
  ui.bounceAt = performance.now();
  sound.play("random");
  changed();
}

function presetShift(it, hex) {
  const n = hexToInt(hex);
  const [th, ts, tl] = rgbToHsl(n >> 16, (n >> 8) & 255, n & 255);
  const [ah, as, al] = avgHsl(it.src);
  let dh = Math.round(th - ah);
  dh = ((dh + 540) % 360) - 180;
  return {
    hue: dh,
    sat: Math.round(Math.max(-100, Math.min(100, (ts - as) * 100))),
    light: Math.round(Math.max(-60, Math.min(60, (tl - al) * 100))),
  };
}

// ================================================================ persistence
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ }
  },
};

function snapshot() {
  return JSON.parse(JSON.stringify({
    skin: state.skin, hairStyle: state.hairStyle, hairColor: state.hairColor,
    face: state.face, background: state.background, worn: state.worn,
  }));
}

function applySnapshot(s) {
  if (!s) return;
  if (OPT.skinRamps[s.skin]) state.skin = s.skin;
  if (OPT.hairStyles.some((h) => h.id === s.hairStyle)) state.hairStyle = s.hairStyle;
  if (OPT.hairRamps[s.hairColor]) state.hairColor = s.hairColor;
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(STORE_CUR, snapshot()), 300);
  renderPanel({ flashId });
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
    b.innerHTML = t.name + (n ? `<span class="n">${n}</span>` : "");
    b.onclick = () => {
      ui.tab = t.key;
      sound.play("tab");
      renderPanel();
      b.scrollIntoView({ inline: "nearest", block: "nearest" });
    };
    tabs.append(b);
  }
}

function headThumb(st) {
  const c = document.createElement("canvas");
  c.width = AV; c.height = AV;
  composeAvatar(c.getContext("2d"), { ...st, worn: [{ id: HAIR }] });
  return thumb(c, { x: 38, y: 2, w: 52, h: 52 }, 56);
}

function swatch(color, on, onClick, title) {
  const b = el("button", "swatch" + (on ? " on" : ""));
  b.style.background = color;
  b.title = title || "";
  b.setAttribute("aria-label", title || color);
  b.onclick = onClick;
  return b;
}

function section(title) {
  return el("div", "section-title", title);
}

function itemTile(content, { on = false, label, onClick }) {
  const b = el("button", "item" + (on ? " on" : "") + (label ? " has-label" : ""));
  b.append(content);
  if (label) b.append(el("span", "label", label));
  b.onclick = onClick;
  return b;
}

function renderContent() {
  const box = $("#content");
  box.innerHTML = "";

  if (ui.view === "layers") return renderLayers(box);

  if (ui.tab === "body") {
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
      g.append(itemTile(headThumb({ ...state, face: f.id }), {
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
      row.append(swatch(ramp[1], state.hairColor === k, () => { state.hairColor = k; sound.play("select"); changed(); }, k));
    }
    box.append(row);
    box.append(section("헤어 스타일"));
    const g = el("div", "grid");
    for (const h of OPT.hairStyles) {
      g.append(itemTile(headThumb({ ...state, hairStyle: h.id }), {
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
        on: state.background === b.id, label: b.name,
        onClick: () => { state.background = b.id; sound.play("select"); changed(); },
      }));
    }
    box.append(g);
    return;
  }

  const list = ITEMS.filter((i) => i.category === ui.tab);
  if (!list.length) {
    box.append(el("div", "empty", "아직 아이템이 없어요<br>items.json에 추가하면 여기에 나타나요"));
    return;
  }
  const cat = CAT_BY_KEY[ui.tab];
  box.append(section(cat.multi ? "여러 개 겹쳐 입을 수 있어요" : "하나만 착용돼요"));
  const g = el("div", "grid");
  for (const it of list) {
    g.append(itemTile(thumb(getImg(it.src), bbox(it.src)), {
      on: wornIndex(it.id) >= 0, label: it.name,
      onClick: () => toggleItem(it.id),
    }));
  }
  box.append(g);
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
      const hair = findBy(OPT.hairStyles, state.hairStyle);
      const src = hair.front;
      t.append(thumb(hairLayer(src), bbox(src), 32));
      name = "앞머리";
      sub = "헤어";
    } else {
      const it = ITEM_BY_ID[e.id];
      t.append(thumb(recolor(it.src, e.hue, e.sat, e.light), bbox(it.src), 32));
      name = it.name;
      sub = CAT_BY_KEY[it.category].name + (e.hue || e.sat || e.light ? " · 색 변경" : "");
    }
    row.append(t);
    row.append(el("div", "name", `<b>${name}</b><small>${sub}</small>`));
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

function renderPanel({ flashId } = {}) {
  document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("on", b.dataset.view === ui.view));
  $("#layerCount").textContent = state.worn.length - 1;
  $("#tabs").hidden = ui.view === "layers";
  if (ui.view === "closet") renderTabs();
  const box = $("#content");
  const keep = box.scrollTop;
  if (ui.view === "layers") {
    box.innerHTML = "";
    renderLayers(box, flashId);
  } else {
    renderContent();
  }
  box.scrollTop = keep;
}

// ================================================================ UI: color sheet
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
      Object.assign(e, presetShift(it, hex));
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
  const src = recolor(it.src, e.hue, e.sat, e.light);
  const b = bbox(it.src);
  if (b && src) {
    t.width = b.w; t.height = b.h;
    const ctx = t.getContext("2d");
    ctx.clearRect(0, 0, b.w, b.h);
    ctx.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    const s = Math.max(1, Math.floor(48 / Math.max(b.w, b.h))) || 48 / Math.max(b.w, b.h);
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
function stageDataURL(scale = 1, st = state) {
  renderStage(stageCtx, 0, st, { motion: false });
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
      slots[i] = { at: Date.now(), state: snapshot(), shot: stageDataURL(1).toDataURL("image/png") };
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
        $("#saveSheet").hidden = true;
        changed();
      };
      acts.append(loadB);
    }
    row.append(acts);
    box.append(row);
  }
}

// ================================================================ UI: misc
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
}

function flash() {
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
  const c = stageDataURL(6);
  flash();
  sound.play("shutter");
  const name = `pixel-closet-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.png`;
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast("PNG를 저장했어요");
  }, "image/png");
}

function setPhoto(on) {
  document.body.classList.toggle("photo", on);
  layout();
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
  $("#saveBtn").onclick = () => { sound.play("tab"); renderSlots(); $("#saveSheet").hidden = false; };
  $("#saveClose").onclick = () => { sound.play("tab"); $("#saveSheet").hidden = true; };
  $("#saveSheet").addEventListener("click", (ev) => { if (ev.target.id === "saveSheet") $("#saveSheet").hidden = true; });
  $("#photoBtn").onclick = () => { flash(); sound.play("shutter"); setPhoto(true); };
  $("#stageWrap").addEventListener("click", (ev) => {
    if (document.body.classList.contains("photo") && !ev.target.closest(".hud")) setPhoto(false);
  });
  $("#exportBtn").onclick = exportPNG;

  const bgmBtn = $("#bgmBtn"), sfxBtn = $("#sfxBtn");
  const syncAudioBtns = () => {
    bgmBtn.textContent = `BGM ${sound.bgmOn ? "ON" : "OFF"}`;
    bgmBtn.setAttribute("aria-pressed", sound.bgmOn);
    sfxBtn.textContent = `SFX ${sound.sfxOn ? "ON" : "OFF"}`;
    sfxBtn.setAttribute("aria-pressed", sound.sfxOn);
    store.set("pixelcloset.v1.audio", { bgm: sound.bgmOn, sfx: sound.sfxOn });
  };
  bgmBtn.onclick = () => { sound.setBgm(!sound.bgmOn); sound.play("tab"); syncAudioBtns(); };
  sfxBtn.onclick = () => { sound.sfxOn = !sound.sfxOn; sound.play("tab"); syncAudioBtns(); };
  syncAudioBtns();

  bindColorSheet();

  // 탭한 위치에 반짝이 (폰 녹화에도 상호작용이 보이게)
  document.addEventListener("pointerdown", (ev) => spark(ev.clientX, ev.clientY), { passive: true });
  // 마우스 호버 효과음 (데스크톱)
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
  requestAnimationFrame(loop);
}

// ================================================================ boot
async function boot() {
  const [opt, items] = await Promise.all([
    fetch("data/options.json").then((r) => r.json()),
    fetch("data/items.json").then((r) => r.json()),
  ]);
  OPT = opt;
  ITEMS = items;
  ITEM_BY_ID = Object.fromEntries(items.map((i) => [i.id, i]));
  CAT_BY_KEY = Object.fromEntries(opt.categories.map((c) => [c.key, c]));
  OUTLINE_SET = new Set((opt.outlineColors || []).map(hexToInt));
  document.title = opt.title || document.title;
  $("#logo").textContent = opt.title || "PIXEL CLOSET";
  ui.tab = opt.tabOrder[0] || "top";

  const d = opt.defaults || {};
  state.skin = d.skin || state.skin;
  state.hairStyle = d.hairStyle || state.hairStyle;
  state.hairColor = d.hairColor || state.hairColor;
  state.face = d.face || state.face;
  state.background = d.background || state.background;

  const srcs = [
    opt.body.body, opt.body.underwear, opt.body.shadow,
    ...opt.hairStyles.flatMap((h) => [h.back, h.front]),
    ...opt.faces.flatMap((f) => [f.src, f.blink].filter(Boolean)),
    ...opt.backgrounds.map((b) => b.src),
    ...items.flatMap((i) => [i.src, ...(i.extraLayers || []).map((l) => l.src)]),
  ];
  await Promise.all(srcs.map(loadImage));

  // 저장된 코디 복원 (아이템이 삭제됐으면 자동으로 빠짐)
  applySnapshot(store.get(STORE_CUR, null));

  const audioPref = store.get("pixelcloset.v1.audio", { bgm: true, sfx: true });
  sound = new Sound({ bpm: opt.audio.bpm, bgmSrc: opt.audio.bgm });
  sound.bgmOn = audioPref.bgm !== false;
  sound.sfxOn = audioPref.sfx !== false;

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
    `<div class="toast show" style="animation:none;opacity:1">데이터를 불러오지 못했어요 (${e.message})</div>`);
});
