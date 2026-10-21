// 공용 도우미: DOM, 색 변환, 이미지 캐시, 저장소, 픽셀 텍스트

export const $ = (s, root = document) => root.querySelector(s);
export const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- color
export const hexToInt = (h) => parseInt(h.replace("#", ""), 16);
export const rgbInt = (r, g, b) => (r << 16) | (g << 8) | b;
export const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function rgbToHsl(r, g, b) {
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

export function hslToRgb(h, s, l) {
  h = ((((h % 360) + 360) % 360) / 360);
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

export const hexToHsl = (hex) => {
  const n = hexToInt(hex);
  return rgbToHsl(n >> 16, (n >> 8) & 255, n & 255);
};

// ---------------------------------------------------------------- images
const images = new Map();

export function loadImage(src) {
  if (!src) return Promise.resolve(null);
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

export const getImg = (src) => {
  const r = src && images.get(src);
  return r && r.ok ? r.im : null;
};

export function toCanvas(im, w = im.width, h = im.height) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, 0, 0);
  return c;
}

export const pixels = (source) => {
  const c = source instanceof HTMLCanvasElement ? source : toCanvas(source);
  return c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
};

const probe = document.createElement("canvas");
probe.width = probe.height = 1;
const probeCtx = probe.getContext("2d", { willReadFrequently: true });
// 이미지의 (x, y) 픽셀이 불투명한지
export function alphaAt(source, x, y) {
  if (!source || x < 0 || y < 0 || x >= source.width || y >= source.height) return 0;
  probeCtx.clearRect(0, 0, 1, 1);
  probeCtx.drawImage(source, -Math.floor(x), -Math.floor(y));
  return probeCtx.getImageData(0, 0, 1, 1).data[3];
}

// 불투명 픽셀의 범위
const bboxCache = new WeakMap();
export function bbox(source) {
  if (!source) return null;
  if (bboxCache.has(source)) return bboxCache.get(source);
  const { data: d, width: w, height: h } = pixels(source);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const b = x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  bboxCache.set(source, b);
  return b;
}

// 썸네일 (작으면 정수배 확대)
export function thumb(source, box, maxPx = 52) {
  const c = document.createElement("canvas");
  c.className = "pixel";
  if (!source || !box) return c;
  c.width = box.w;
  c.height = box.h;
  c.getContext("2d").drawImage(source, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const big = Math.max(box.w, box.h);
  const s = big > maxPx ? maxPx / big : Math.max(1, Math.floor(maxPx / big));
  c.style.width = `${box.w * s}px`;
  c.style.height = `${box.h * s}px`;
  return c;
}

// ---------------------------------------------------------------- pixel text
// 캔버스 글자를 알파 임계값으로 잘라서 픽셀 폰트처럼 또렷하게
const textCache = new Map();
export function pixelText(text, { size = 12, color = "#2b1d1a", outline = null, bold = true } = {}) {
  const key = `${text}|${size}|${color}|${outline}|${bold}`;
  if (textCache.has(key)) return textCache.get(key);
  const font = `${bold ? "700 " : ""}${size}px Galmuri11`;
  const m = document.createElement("canvas").getContext("2d");
  m.font = font;
  const w = Math.ceil(m.measureText(text).width) + 4;
  const h = size + 6;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.fillText(text, 2, 2);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = hexToInt(color);
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const on = d[i * 4 + 3] >= 110;
    solid[i] = on ? 1 : 0;
    d[i * 4] = n >> 16; d[i * 4 + 1] = (n >> 8) & 255; d[i * 4 + 2] = n & 255;
    d[i * 4 + 3] = on ? 255 : 0;
  }
  if (outline) {
    const o = hexToInt(outline);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        const near = (dx, dy) => {
          const xx = x + dx, yy = y + dy;
          return xx >= 0 && yy >= 0 && xx < w && yy < h && solid[yy * w + xx];
        };
        if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) {
          d[i * 4] = o >> 16; d[i * 4 + 1] = (o >> 8) & 255; d[i * 4 + 2] = o & 255; d[i * 4 + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  textCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- storage
export const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ }
  },
};

// IndexedDB (내가 추가한 이미지 보관)
const DB_NAME = "pixelcloset";
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("custom", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export const idb = {
  async all() {
    try {
      const db = await openDB();
      return await new Promise((res, rej) => {
        const q = db.transaction("custom").objectStore("custom").getAll();
        q.onsuccess = () => res(q.result || []);
        q.onerror = () => rej(q.error);
      });
    } catch (e) {
      console.warn("IndexedDB를 쓸 수 없어요", e);
      return [];
    }
  },
  async put(rec) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction("custom", "readwrite");
      tx.objectStore("custom").put(rec);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
  async del(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction("custom", "readwrite");
      tx.objectStore("custom").delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  },
};

export const blobToBase64 = (blob) => new Promise((res) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.readAsDataURL(blob);
});

export const canvasToBlob = (c) => new Promise((res) => c.toBlob(res, "image/png"));
