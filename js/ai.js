// AI로 옷 만들기: 마스크 생성 → PixelLab inpaint (Vercel 중계) → 옷만 추출
import { store } from "./util.js";

const TOKEN_KEY = "pixelcloset.v1.pixellab";
const ENDPOINT = "api/pixellab";

export const aiToken = {
  get: () => store.get(TOKEN_KEY, ""),
  set: (t) => store.set(TOKEN_KEY, (t || "").trim()),
};

// ---------------------------------------------------------------- masks
function silhouette(bodyCanvas) {
  const { width: W, height: H } = bodyCanvas;
  const d = bodyCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  let x0 = W, x1 = -1;
  for (let i = 0; i < W * H; i++) {
    if (d[i * 4 + 3]) {
      m[i] = 1;
      const x = i % W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return { m, W, H, cx: x1 < 0 ? W / 2 : Math.round((x0 + x1 + 1) / 2) };
}

function dilate(m, W, H, n) {
  let cur = m;
  for (let k = 0; k < n; k++) {
    const nx = cur.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < W - 1 && cur[i + 1]) || (y > 0 && cur[i - W]) || (y < H - 1 && cur[i + W])) nx[i] = 1;
      }
    }
    cur = nx;
  }
  return cur;
}

// spec 예: [{ rows:[60,114], cols:[46,83], body:true, grow:3, clip:[59,116], clipCols:[43,86] }, { flare:[y0,y1,topHalf,bottomHalf] }, { rect:[x0,y0,x1,y1] }]
export function buildMask(spec, fitGrow, bodyCanvas) {
  const { m: sil, W, H, cx } = silhouette(bodyCanvas);
  const out = new Uint8Array(W * H);
  for (const part of spec || []) {
    if (part.body) {
      const [r0, r1] = part.rows || [0, H - 1];
      const [c0, c1] = part.cols || [0, W - 1];
      let pm = new Uint8Array(W * H);
      for (let y = Math.max(0, r0); y <= Math.min(H - 1, r1); y++) {
        for (let x = Math.max(0, c0); x <= Math.min(W - 1, c1); x++) pm[y * W + x] = sil[y * W + x];
      }
      pm = dilate(pm, W, H, (part.grow || 0) + fitGrow);
      const [k0, k1] = part.clip || [0, H - 1];
      const [q0, q1] = part.clipCols || [0, W - 1];
      const cy1 = Math.min(H - 1, k1 + fitGrow * 2);
      const cq0 = Math.max(0, q0 - fitGrow), cq1 = Math.min(W - 1, q1 + fitGrow);
      for (let y = Math.max(0, k0); y <= cy1; y++) {
        for (let x = cq0; x <= cq1; x++) if (pm[y * W + x]) out[y * W + x] = 1;
      }
    } else if (part.flare) {
      const [y0, y1, t, b] = part.flare;
      for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1 + fitGrow); y++) {
        const k = (y - y0) / Math.max(1, y1 - y0);
        const h = Math.round(t + (b - t) * Math.min(1, k)) + fitGrow;
        for (let x = Math.max(0, cx - h); x <= Math.min(W - 1, cx + h); x++) out[y * W + x] = 1;
      }
    } else if (part.rect) {
      const [x0, y0, x1, y1] = part.rect;
      for (let y = Math.max(0, y0 - fitGrow); y <= Math.min(H - 1, y1 + fitGrow); y++) {
        for (let x = Math.max(0, x0 - fitGrow); x <= Math.min(W - 1, x1 + fitGrow); x++) out[y * W + x] = 1;
      }
    }
  }
  return { mask: out, W, H };
}

export function maskCanvas({ mask, W, H }) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = mask[i] ? 255 : 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// 미리보기: 바디 위에 분홍색으로 마스크 표시
export function maskOverlay(bodyCanvas, maskObj) {
  const { mask, W, H } = maskObj;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ece8ee";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bodyCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue;
    const p = i * 4;
    img.data[p] = Math.round(img.data[p] * 0.45 + 255 * 0.55);
    img.data[p + 1] = Math.round(img.data[p + 1] * 0.45 + 60 * 0.55);
    img.data[p + 2] = Math.round(img.data[p + 2] * 0.45 + 110 * 0.55);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- api
const b64 = (canvas) => canvas.toDataURL("image/png").split(",")[1];

async function call(action, payload, token) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pixellab-token": token },
    body: JSON.stringify({ action, payload }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  if (!res.ok) {
    const detail = json && (json.detail || json.error || json.message);
    const msg = {
      401: "토큰이 올바르지 않아요",
      402: "PixelLab 크레딧이 부족해요",
      422: "요청 형식 오류",
      429: "요청이 너무 많아요",
      529: "PixelLab이 바빠요",
    }[res.status] || `오류 ${res.status}`;
    const err = new Error(detail ? `${msg} (${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 160)})` : msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function getBalance(token) {
  return call("balance", null, token);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadB64(data) {
  const src = data.startsWith("data:") ? data : `data:image/png;base64,${data}`;
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("결과 이미지를 읽지 못했어요"));
    im.src = src;
  });
}

export async function inpaint({ token, description, negative, guidance, base, mask, seed }) {
  const payload = {
    description,
    negative_description: negative || "",
    image_size: { width: base.width, height: base.height },
    text_guidance_scale: guidance || 6,
    no_background: true,
    inpainting_image: { type: "base64", base64: b64(base) },
    mask_image: { type: "base64", base64: b64(mask) },
    ...(seed != null ? { seed } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const json = await call("inpaint", payload, token);
      const data = json && json.image && (json.image.base64 || json.image);
      if (!data || typeof data !== "string") throw new Error("결과에 이미지가 없어요");
      const im = await loadB64(data);
      return { image: im, usage: json.usage || null };
    } catch (e) {
      if ((e.status === 429 || e.status === 529) && attempt < 3) {
        await sleep(3000 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

// ---------------------------------------------------------------- extraction
// 마스크 안에서, 원래 그림과 달라진 픽셀만 옷으로 남김
export function extractGarment({ result, base, mask }, tol = 40) {
  const W = base.width, H = base.height;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(result, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const b = base.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const zone = dilate(mask.mask, W, H, 1);
  for (let i = 0; i < W * H; i++) {
    const p = i * 4;
    if (!zone[i] || d[p + 3] < 128) { d[p + 3] = 0; continue; }
    d[p + 3] = 255;
    if (b[p + 3]) {
      const diff = Math.abs(d[p] - b[p]) + Math.abs(d[p + 1] - b[p + 1]) + Math.abs(d[p + 2] - b[p + 2]);
      if (diff <= tol) d[p + 3] = 0;
    }
  }
  // 작은 점 제거
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (seen[s] || !d[s * 4 + 3]) continue;
    const comp = [], stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const x = q % W, y = (q / W) | 0;
      const nb = [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, y > 0 ? q - W : -1, y < H - 1 ? q + W : -1];
      for (const n of nb) if (n >= 0 && !seen[n] && d[n * 4 + 3]) { seen[n] = 1; stack.push(n); }
    }
    if (comp.length < 6) comp.forEach((q) => (d[q * 4 + 3] = 0));
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
