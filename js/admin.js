// 아이템 추가 / 관리 화면
// - 이미지를 올리면 크기·투명도를 자동 정리
// - "바디에 입힌 전체 그림"이면 기준 바디와 비교해서 옷만 자동 추출
// - 이 기기(IndexedDB)에 바로 저장 → 게임에 즉시 반영
// - GitHub 토큰을 넣으면 "온라인 저장" → 커밋 1개로 올리고 Vercel이 자동 배포 (모든 기기에서 보임)
import { $, el, esc, idb, store, toCanvas, canvasToBlob, blobToBase64, hexToInt, thumb, bbox } from "./util.js";
import { aiToken, buildMask, maskCanvas, maskOverlay, getBalance, inpaint, extractGarment } from "./ai.js";

const GH_KEY = "pixelcloset.v1.github";
// 크기는 게임 설정에서 받아와요
const S = () => game.sizes();

let game;
let drafts = [];

export function initAdmin(g) {
  game = g;
  buildDom();
}

export function openAdmin() {
  renderAll();
  $("#adminSheet").hidden = false;
  game.sound.play("tab");
}

function closeAdmin() {
  $("#adminSheet").hidden = true;
  game.sound.play("tab");
}

// ================================================================ DOM
function buildDom() {
  const back = el("div", "admin-back");
  back.id = "adminSheet";
  back.hidden = true;
  back.innerHTML = `
    <div class="admin" role="dialog" aria-label="아이템 추가">
      <header class="admin-head">
        <strong>아이템 추가 · 관리</strong>
        <button class="icon-btn" id="adminClose" aria-label="닫기"><img class="icon" src="assets/ui/icon_x.png" alt=""></button>
      </header>
      <div class="admin-body">
        <section class="card ai-card">
          <h3>✨ AI로 옷 만들기 <span class="badge">PixelLab</span></h3>
          <div class="field">
            <label for="aiToken">API 토큰</label>
            <div class="row-btn">
              <input type="password" id="aiToken" placeholder="PixelLab API token" autocomplete="off">
              <button class="btn small" id="aiBalance">확인</button>
            </div>
          </div>
          <p class="hint" id="aiTokenHint">토큰은 이 기기 브라우저에만 저장돼요. pixellab.ai → 계정 설정에서 복사해요.</p>
          <div class="ai-grid">
            <div class="ai-form">
              <div class="field">
                <label for="aiCat">종류</label>
                <select id="aiCat"></select>
              </div>
              <div class="field">
                <label for="aiFit">핏</label>
                <select id="aiFit">
                  <option value="fitted">fitted (딱 붙음)</option>
                  <option value="regular" selected>regular (보통)</option>
                  <option value="loose">loose (넉넉)</option>
                </select>
              </div>
              <div class="field">
                <label for="aiCount">한 줄당</label>
                <select id="aiCount">
                  <option value="1">1장</option><option value="2">2장 (골라 쓰기)</option><option value="3">3장</option>
                </select>
              </div>
              <label class="check"><input type="checkbox" id="aiLayer"> 지금 입은 옷 위에 그리기 (레이어드)</label>
            </div>
            <div class="ai-mask checker" id="aiMaskPv" title="분홍색 부분이 다시 그려져요"></div>
          </div>
          <div class="field col">
            <label for="aiLines">옷 설명 (영어로, <b>한 줄에 하나씩</b> → 한 번에 여러 개 생성)</label>
            <textarea id="aiLines" rows="4" placeholder="white oversized long sleeve t-shirt"></textarea>
          </div>
          <details class="gh-help">
            <summary>고급 설정 (프롬프트)</summary>
            <div class="field col">
              <label for="aiBase">기본 프롬프트 ({item} 자리에 옷 설명이 들어가요)</label>
              <textarea id="aiBase" rows="3"></textarea>
            </div>
            <div class="field col">
              <label for="aiNeg">피할 것</label>
              <input type="text" id="aiNeg">
            </div>
            <div class="field">
              <label for="aiGuide">설명 반영 강도</label>
              <input type="range" id="aiGuide" min="1" max="10" step="0.5">
            </div>
            <div class="admin-actions">
              <button class="btn small" id="aiResetPrompt">기본값으로</button>
              <button class="btn small" id="aiMaskDl">마스크 PNG 받기</button>
            </div>
          </details>
          <div class="admin-actions">
            <button class="btn small primary" id="aiGo"><img class="icon" src="assets/ui/icon_star.png" alt="">생성하기</button>
          </div>
          <p class="hint" id="aiStatus"></p>
        </section>

        <section class="card">
          <h3>직접 그린 그림 올리기</h3>
          <div class="field">
            <label for="adKind">종류</label>
            <select id="adKind"></select>
          </div>
          <div class="field" id="adUseRow">
            <label>용도</label>
            <div class="radios">
              <label><input type="radio" name="adUse" value="new" checked> 새 아이템</label>
              <label><input type="radio" name="adUse" value="variant"> 기존 아이템의 체형 전용 그림</label>
            </div>
          </div>
          <div class="field" id="adVariantRow" hidden>
            <label>대상</label>
            <div class="row2">
              <select id="adVarItem"></select>
              <select id="adVarBody"></select>
            </div>
          </div>
          <div class="field" id="adModeRow">
            <label for="adMode">그림 형태</label>
            <select id="adMode">
              <option value="auto">자동 감지</option>
              <option value="item">옷만 있는 그림 (투명 배경)</option>
              <option value="dressed">바디에 입힌 전체 그림 → 옷만 추출</option>
            </select>
          </div>
          <div class="field" id="adTolRow">
            <label for="adTol">추출 민감도</label>
            <input type="range" id="adTol" min="8" max="120" value="40">
          </div>
          <p class="hint" id="adHint"></p>
          <div class="admin-actions">
            <label class="btn small primary file-btn">
              <img class="icon" src="assets/ui/icon_plus.png" alt="">이미지 고르기
              <input type="file" id="adFile" accept="image/png,image/*" multiple hidden>
            </label>
            <button class="btn small" id="adRef">기준 바디 받기</button>
          </div>
        </section>

        <section class="card" id="adDraftCard" hidden>
          <h3>확인하고 추가하기</h3>
          <div id="adDrafts" class="drafts"></div>
          <div class="admin-actions">
            <button class="btn small" id="adClearDrafts">모두 취소</button>
            <button class="btn small primary" id="adAddAll">모두 추가</button>
          </div>
        </section>

        <section class="card">
          <h3>내가 추가한 것 <span id="adCount" class="badge">0</span></h3>
          <div id="adList" class="custom-list"></div>
        </section>

        <section class="card">
          <h3>온라인 저장 (모든 기기에서 보이게)</h3>
          <p class="hint">
            추가한 그림은 지금 <b>이 기기에만</b> 저장돼요. 폰·PC 어디서든 보이게 하려면 아래 버튼으로 GitHub에 올려요.
            올리면 1~2분 뒤 사이트가 자동으로 업데이트돼요.
          </p>
          <details class="gh-help">
            <summary>토큰 만드는 법 (처음 한 번만)</summary>
            <ol>
              <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
              <li>Repository access: <b>Only select repositories</b> → pixel-dressup</li>
              <li>Permissions → Repository permissions → <b>Contents: Read and write</b></li>
              <li>만든 토큰(github_pat_로 시작)을 아래에 붙여넣기. 이 기기 브라우저에만 저장돼요.</li>
            </ol>
          </details>
          <div class="field">
            <label for="ghRepo">저장소</label>
            <input type="text" id="ghRepo" placeholder="minjoo311/pixel-dressup" autocomplete="off">
          </div>
          <div class="field">
            <label for="ghToken">토큰</label>
            <input type="password" id="ghToken" placeholder="github_pat_..." autocomplete="off">
          </div>
          <div class="admin-actions">
            <button class="btn small" id="ghForget">토큰 지우기</button>
            <button class="btn small primary" id="ghPublish">온라인에 저장</button>
          </div>
          <p class="hint" id="ghStatus"></p>
        </section>
      </div>
    </div>`;
  document.body.append(back);

  $("#adminClose").onclick = closeAdmin;
  back.addEventListener("click", (e) => { if (e.target === back) closeAdmin(); });

  const kind = $("#adKind");
  const tabOrder = game.options().tabOrder || [];
  const tr = (k) => (tabOrder.indexOf(k) < 0 ? 99 : tabOrder.indexOf(k));
  kind.innerHTML = `<option value="bg">배경</option>` +
    game.categories().slice().sort((a, b) => tr(a.key) - tr(b.key)).map((c) => `<option value="${c.key}">${esc(c.name)}</option>`).join("");
  kind.value = "top";
  kind.onchange = syncForm;
  back.querySelectorAll("input[name=adUse]").forEach((r) => (r.onchange = syncForm));
  $("#adMode").onchange = syncForm;
  $("#adFile").onchange = onFiles;
  $("#adTol").onchange = reprocessDrafts;
  $("#adRef").onclick = downloadReference;
  $("#adClearDrafts").onclick = () => { drafts = []; renderDrafts(); };
  $("#adAddAll").onclick = addAll;

  const gh = store.get(GH_KEY, {});
  $("#ghRepo").value = gh.repo || game.defaultRepo || "";
  $("#ghToken").value = gh.token || "";
  const saveGh = () => store.set(GH_KEY, { repo: $("#ghRepo").value.trim(), token: $("#ghToken").value.trim() });
  $("#ghRepo").onchange = saveGh;
  $("#ghToken").onchange = saveGh;
  $("#ghForget").onclick = () => { $("#ghToken").value = ""; saveGh(); status("토큰을 지웠어요"); };
  $("#ghPublish").onclick = () => { saveGh(); publish(); };
  initAI();
}

const isBg = () => $("#adKind").value === "bg";
const useVariant = () => !isBg() && document.querySelector("input[name=adUse]:checked").value === "variant";

function syncForm() {
  const bg = isBg();
  $("#adUseRow").hidden = bg;
  $("#adModeRow").hidden = bg;
  $("#adVariantRow").hidden = !useVariant();
  $("#adTolRow").hidden = bg || $("#adMode").value === "item";
  if (useVariant()) {
    const cat = $("#adKind").value;
    $("#adVarItem").innerHTML = game.items().filter((i) => i.category === cat)
      .map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("") || `<option value="">(이 종류에 아이템이 없어요)</option>`;
    $("#adVarBody").innerHTML = game.bodyTypes().map((b) => `<option value="${b.id}">${esc(b.name)} 체형</option>`).join("");
  }
  const { AV_W, AV_H, STAGE_W, STAGE_H } = S();
  $("#adHint").innerHTML = bg
    ? `배경은 <b>${STAGE_W}×${STAGE_H}</b>로 맞춰져요. 크기가 다르면 비율을 유지한 채 잘라서 채워요.`
    : `옷은 <b>${AV_W}×${AV_H}</b> (기준 바디와 같은 위치)이어야 해요. 2배·4배처럼 정수배로 큰 그림은 자동으로 줄여요.<br>
       PixelLab에서 <b>기준 바디</b> 위에 인페인팅한 결과를 그대로 올리면 옷만 쏙 빼서 저장해요.`;
}

function renderAll() {
  syncAIForm();
  syncForm();
  renderDrafts();
  renderList();
}

// ================================================================ processing
function loadFile(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { res(im); URL.revokeObjectURL(url); };
    im.onerror = () => rej(new Error("이미지를 열 수 없어요"));
    im.src = url;
  });
}

function blankCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  return c;
}

// 크기 맞추기: 정수배면 깔끔하게 축소, 아니면 근사
function fitSize(im, tw, th, bg, warn) {
  const c = blankCanvas(tw, th);
  const ctx = c.getContext("2d");
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
  if (w === tw && h === th) {
    ctx.drawImage(im, 0, 0);
    return c;
  }
  const kx = w / tw, ky = h / th;
  if (Number.isInteger(kx) && kx === ky) {
    // 정수배 축소: 각 블록의 가운데 픽셀
    const src = toCanvas(im).getContext("2d").getImageData(0, 0, w, h).data;
    const out = ctx.createImageData(tw, th);
    const k = kx, off = Math.floor(k / 2);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const si = ((y * k + off) * w + (x * k + off)) * 4, di = (y * tw + x) * 4;
        out.data[di] = src[si]; out.data[di + 1] = src[si + 1]; out.data[di + 2] = src[si + 2]; out.data[di + 3] = src[si + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
    warn.push(`${w}×${h} → ${tw}×${th}로 줄였어요 (${k}배)`);
    return c;
  }
  if (bg) {
    const s = Math.max(tw / w, th / h);
    const dw = Math.round(w * s), dh = Math.round(h * s);
    ctx.drawImage(im, Math.round((tw - dw) / 2), Math.round((th - dh) / 2), dw, dh);
    warn.push(`크기가 ${w}×${h}라서 ${tw}×${th}에 맞게 잘랐어요. 픽셀이 살짝 뭉개질 수 있어요`);
  } else {
    const s = Math.min(tw / w, th / h);
    const dw = Math.round(w * s), dh = Math.round(h * s);
    ctx.drawImage(im, Math.round((tw - dw) / 2), th - dh, dw, dh);
    warn.push(`⚠️ 크기가 ${w}×${h}예요. ${tw}×${th}(또는 정수배)이 아니면 몸에 정확히 안 맞을 수 있어요`);
  }
  return c;
}

const dist = (d, i, r, j) => Math.abs(d[i] - r[j]) + Math.abs(d[i + 1] - r[j + 1]) + Math.abs(d[i + 2] - r[j + 2]);

function cleanAlpha(img) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = d[i + 3] >= 128 ? 255 : 0;
}

// 네 귀퉁이가 같은 단색이면 배경으로 보고 지움
function removeFlatBackground(img, warn) {
  const { data: d, width: w, height: h } = img;
  const corners = [0, (w - 1) * 4, ((h - 1) * w) * 4, ((h - 1) * w + w - 1) * 4];
  if (corners.some((i) => d[i + 3] === 0)) return;
  const c0 = corners[0];
  if (!corners.every((i) => dist(d, i, d, c0) < 24)) return;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let n = 0;
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (d[i + 3] === 0 || dist(d, i, d, c0) > 24) continue;
    d[i + 3] = 0;
    n++;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
  if (n) warn.push("단색 배경을 투명하게 지웠어요");
}

// 기준 바디와 비슷한 비율 → "입힌 그림"인지 판별
function dressedRatio(img, ref) {
  const d = img.data, r = ref.data;
  let refN = 0, same = 0;
  for (let i = 0; i < r.length; i += 4) {
    if (!r[i + 3]) continue;
    refN++;
    if (d[i + 3] && dist(d, i, r, i) < 30) same++;
  }
  return refN ? same / refN : 0;
}

function extract(img, ref, tol) {
  const d = img.data, r = ref.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (r[i + 3] && dist(d, i, r, i) <= tol) d[i + 3] = 0;
  }
  // 자잘한 잡티(6픽셀 미만 덩어리) 제거
  const w = img.width, h = img.height;
  const seen = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !d[p * 4 + 3]) continue;
    const comp = [];
    const stack = [p];
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const x = q % w, y = (q / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const nq = yy * w + xx;
        if (!seen[nq] && d[nq * 4 + 3]) { seen[nq] = 1; stack.push(nq); }
      }
    }
    if (comp.length < 6) comp.forEach((q) => (d[q * 4 + 3] = 0));
  }
}

// 피부/머리 예약색이 옷에 섞여 있으면 1단계만 살짝 바꿔서 충돌 방지
function nudgeReserved(img, warn) {
  const reserved = new Set(game.reservedColors().map(hexToInt));
  const d = img.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (reserved.has((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])) {
      d[i + 2] = d[i + 2] < 255 ? d[i + 2] + 1 : d[i + 2] - 1;
      n++;
    }
  }
  if (n) warn.push(`피부·머리 예약색과 같은 색 ${n}픽셀을 살짝 바꿨어요`);
}

async function processDraft(draft) {
  const bg = draft.kind === "bg";
  const warn = [];
  if (draft.ai) {
    draft.canvas = extractGarment(draft.ai, +$("#adTol").value);
    draft.warn = draft.ai.warn || [];
    let opaque = 0;
    const dd = draft.canvas.getContext("2d").getImageData(0, 0, draft.canvas.width, draft.canvas.height).data;
    for (let i = 3; i < dd.length; i += 4) if (dd[i]) opaque++;
    if (!opaque) draft.warn = [...draft.warn, "⚠️ 달라진 부분이 거의 없어요. 다시 생성하거나 민감도를 낮춰 보세요"];
    return;
  }
  const { AV_W, AV_H, STAGE_W, STAGE_H } = S();
  const c = fitSize(draft.image, bg ? STAGE_W : AV_W, bg ? STAGE_H : AV_H, bg, warn);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  if (bg) {
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  } else {
    cleanAlpha(img);
    removeFlatBackground(img, warn);
    const ref = game.referenceCanvas().getContext("2d").getImageData(0, 0, AV_W, AV_H);
    let mode = draft.mode;
    if (mode === "auto") {
      const ratio = dressedRatio(img, ref);
      mode = ratio > 0.25 ? "dressed" : "item";
      if (mode === "dressed") warn.push("바디째 그린 그림으로 보여서 옷만 뽑았어요");
    }
    if (mode === "dressed") extract(img, ref, +$("#adTol").value);
    nudgeReserved(img, warn);
    let opaque = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i]) opaque++;
    if (!opaque) warn.push("⚠️ 남은 픽셀이 없어요. 민감도를 낮춰 보세요");
  }
  ctx.putImageData(img, 0, 0);
  draft.canvas = c;
  draft.warn = warn;
}

async function onFiles(e) {
  const files = [...e.target.files];
  e.target.value = "";
  const kind = $("#adKind").value;
  for (const f of files) {
    try {
      const image = await loadFile(f);
      const name = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 24);
      const draft = {
        key: Math.random().toString(36).slice(2),
        kind, image, name,
        mode: $("#adMode").value,
        fit: "regular",
        recolor: true,
        variant: useVariant() ? { item: $("#adVarItem").value, body: $("#adVarBody").value } : null,
      };
      await processDraft(draft);
      drafts.push(draft);
    } catch (err) {
      game.toast(err.message);
    }
  }
  game.sound.play("select");
  renderDrafts();
}

async function reprocessDrafts() {
  for (const d of drafts) await processDraft(d);
  renderDrafts();
}

function renderDrafts() {
  $("#adDraftCard").hidden = !drafts.length;
  const box = $("#adDrafts");
  box.innerHTML = "";
  for (const d of drafts) {
    const card = el("div", "draft");
    const pv = el("div", "draft-previews");
    const raw = el("div", "checker");
    raw.append(thumb(d.canvas, bbox(d.canvas) || { x: 0, y: 0, w: d.canvas.width, h: d.canvas.height }, 80));
    const on = el("div", "checker");
    on.append(thumb(game.previewWith(d.canvas, d.kind, d.variant), { x: 0, y: 0, w: S().STAGE_W, h: S().STAGE_H }, 120));
    pv.append(raw, on);
    card.append(pv);

    const form = el("div", "draft-form");
    const catName = d.kind === "bg" ? "배경" : (game.categories().find((c) => c.key === d.kind) || {}).name;
    if (d.variant) {
      const it = game.items().find((i) => i.id === d.variant.item);
      const b = game.bodyTypes().find((x) => x.id === d.variant.body);
      form.append(el("p", "hint", `<b>${esc(it ? it.name : "?")}</b> 의 <b>${esc(b ? b.name : "?")}</b> 체형 전용 그림`));
    } else {
      const nameIn = el("input");
      nameIn.type = "text";
      nameIn.value = d.name;
      nameIn.placeholder = "이름";
      nameIn.oninput = () => (d.name = nameIn.value);
      form.append(labeled(`${catName} 이름`, nameIn));
      if (d.kind !== "bg") {
        const fit = el("select");
        fit.innerHTML = `<option value="fitted">fitted (딱 붙음)</option><option value="regular">regular (보통)</option><option value="loose">loose (넉넉)</option>`;
        fit.value = d.fit;
        fit.onchange = () => (d.fit = fit.value);
        form.append(labeled("핏", fit));
        const rc = el("label", "check", `<input type="checkbox" ${d.recolor ? "checked" : ""}> 색 바꾸기 허용 (무늬 옷이면 끄기)`);
        rc.querySelector("input").onchange = (e) => (d.recolor = e.target.checked);
        form.append(rc);
      }
    }
    if (d.warn.length) form.append(el("ul", "warns", d.warn.map((w) => `<li>${esc(w)}</li>`).join("")));
    const acts = el("div", "admin-actions");
    const rm = el("button", "btn small", "빼기");
    rm.onclick = () => { drafts = drafts.filter((x) => x !== d); renderDrafts(); };
    const add = el("button", "btn small primary", "추가");
    add.onclick = () => addDrafts([d]);
    acts.append(rm, add);
    form.append(acts);
    card.append(form);
    box.append(card);
  }
}

function labeled(text, input) {
  const f = el("div", "field");
  const l = el("label", null, esc(text));
  f.append(l, input);
  return f;
}

async function addDrafts(list) {
  let n = 0;
  for (const d of list) {
    if (!d.canvas) continue;
    const blob = await canvasToBlob(d.canvas);
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    let rec;
    if (d.kind === "bg") {
      rec = { id: `bg_c${stamp}`, kind: "background", data: { name: d.name || "새 배경" } };
    } else if (d.variant) {
      if (!d.variant.item) continue;
      rec = { id: `var_${d.variant.item}__${d.variant.body}`, kind: "variant", data: { item: d.variant.item, body: d.variant.body } };
    } else {
      rec = {
        id: `${d.kind}_c${stamp}`, kind: "item",
        data: { category: d.kind, name: d.name || "새 아이템", fit: d.fit, ...(d.recolor ? {} : { recolor: false }) },
      };
    }
    Object.assign(rec, { blob, published: false, createdAt: Date.now() });
    await idb.put(rec);
    n++;
  }
  drafts = drafts.filter((d) => !list.includes(d));
  await game.reloadCustoms();
  game.sound.play("equip");
  game.toast(`${n}개 추가했어요! 이 기기에 저장됐어요`);
  renderDrafts();
  renderList();
}

function addAll() {
  addDrafts([...drafts]);
}

function renderList() {
  const list = game.customList();
  $("#adCount").textContent = list.length;
  const box = $("#adList");
  box.innerHTML = "";
  if (!list.length) {
    box.append(el("p", "hint", "아직 추가한 게 없어요"));
    return;
  }
  for (const c of list) {
    const row = el("div", "custom-row");
    const t = el("div", "thumb");
    const im = c.image;
    if (im) t.append(thumb(im, bbox(im) || { x: 0, y: 0, w: im.width, h: im.height }, 32));
    row.append(t);
    const badge = c.online ? `<span class="badge on">온라인</span>` : c.pending ? `<span class="badge wait">올리는 중</span>` : `<span class="badge">이 기기</span>`;
    row.append(el("div", "name", `<b>${esc(c.name)}</b><small>${esc(c.label)} ${badge}</small>`));
    const del = el("button", "icon-btn");
    del.innerHTML = `<img class="icon" src="assets/ui/icon_x.png" alt="">`;
    del.setAttribute("aria-label", "삭제");
    del.onclick = () => removeCustom(c);
    row.append(del);
    box.append(row);
  }
}

async function removeCustom(c) {
  if (!confirm(`'${c.name}'을(를) 삭제할까요?`)) return;
  if (c.online) {
    const gh = ghConfig();
    if (!gh) {
      game.toast("온라인 항목은 토큰이 있어야 지울 수 있어요");
      return;
    }
    try {
      status("온라인에서 지우는 중…");
      const manifest = await readManifest(gh);
      const strip = (arr) => (arr || []).filter((x) => (x.id || `var_${x.item}__${x.body}`) !== c.id);
      manifest.items = strip(manifest.items);
      manifest.backgrounds = strip(manifest.backgrounds);
      manifest.variants = strip(manifest.variants);
      await commit(gh, [{ path: "data/custom.json", text: JSON.stringify(manifest, null, 2) }, { path: c.path, remove: true }], `아이템 삭제: ${c.name}`);
      status("삭제했어요. 1~2분 뒤 사이트에 반영돼요");
    } catch (e) {
      status(`실패: ${e.message}`);
      return;
    }
  }
  await idb.del(c.id);
  await game.reloadCustoms({ drop: c.id });
  game.sound.play("unequip");
  renderList();
}

// ================================================================ reference download
function downloadReference() {
  const { AV_W, AV_H } = S();
  const c = game.referenceCanvas();
  const big = blankCanvas(AV_W * 4, AV_H * 4);
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(c, 0, 0, AV_W * 4, AV_H * 4);
  for (const [canvas, name] of [[c, `body_reference_${AV_W}x${AV_H}.png`], [big, `body_reference_${AV_W * 4}x${AV_H * 4}.png`]]) {
    canvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
    });
  }
  game.toast("기준 바디 (원본, 4배) 를 저장했어요");
}

// ================================================================ GitHub
function status(msg) {
  $("#ghStatus").textContent = msg;
}

function ghConfig() {
  const repo = $("#ghRepo").value.trim();
  const token = $("#ghToken").value.trim();
  if (!repo || !token || !repo.includes("/")) return null;
  return { repo, token, branch: game.defaultBranch || "main" };
}

async function gh(cfg, path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 401) throw new Error("토큰이 올바르지 않아요");
    if (res.status === 403 || res.status === 404) throw new Error("저장소 권한이 없어요 (토큰의 Contents 쓰기 권한 확인)");
    throw new Error(`GitHub ${res.status}: ${t.slice(0, 120)}`);
  }
  return res.status === 204 ? null : res.json();
}

const utf8ToB64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
};
const b64ToUtf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

async function readManifest(cfg) {
  const f = await gh(cfg, `/contents/data/custom.json?ref=${cfg.branch}`, { allow404: true });
  const m = f ? JSON.parse(b64ToUtf8(f.content)) : {};
  return { items: m.items || [], backgrounds: m.backgrounds || [], variants: m.variants || [] };
}

// 여러 파일을 커밋 1개로 (배포도 1번만 일어남)
async function commit(cfg, files, message) {
  const ref = await gh(cfg, `/git/ref/heads/${cfg.branch}`);
  const head = ref.object.sha;
  const base = await gh(cfg, `/git/commits/${head}`);
  const tree = [];
  for (const f of files) {
    if (f.remove) {
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await gh(cfg, "/git/blobs", {
      method: "POST",
      body: JSON.stringify(f.b64 ? { content: f.b64, encoding: "base64" } : { content: utf8ToB64(f.text), encoding: "base64" }),
    });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh(cfg, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
  const c = await gh(cfg, "/git/commits", { method: "POST", body: JSON.stringify({ message, tree: newTree.sha, parents: [head] }) });
  await gh(cfg, `/git/refs/heads/${cfg.branch}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
}

async function publish() {
  const cfg = ghConfig();
  if (!cfg) {
    status("저장소와 토큰을 먼저 입력해 주세요");
    game.sound.play("error");
    return;
  }
  const locals = (await idb.all()).filter((r) => !r.published);
  if (!locals.length) {
    status("올릴 새 항목이 없어요");
    return;
  }
  const btn = $("#ghPublish");
  btn.disabled = true;
  try {
    status(`${locals.length}개 올리는 중…`);
    const manifest = await readManifest(cfg);
    const files = [];
    for (const r of locals) {
      const b64 = await blobToBase64(r.blob);
      let path;
      if (r.kind === "background") {
        path = `assets/custom/bg/${r.id}.png`;
        manifest.backgrounds = manifest.backgrounds.filter((x) => x.id !== r.id);
        manifest.backgrounds.push({ id: r.id, name: r.data.name, src: path });
      } else if (r.kind === "variant") {
        path = `assets/custom/variants/${r.data.item}__${r.data.body}.png`;
        manifest.variants = manifest.variants.filter((x) => !(x.item === r.data.item && x.body === r.data.body));
        manifest.variants.push({ item: r.data.item, body: r.data.body, src: path });
      } else {
        path = `assets/custom/${r.data.category}/${r.id}.png`;
        manifest.items = manifest.items.filter((x) => x.id !== r.id);
        manifest.items.push({ id: r.id, ...r.data, src: path });
      }
      files.push({ path, b64 });
    }
    files.push({ path: "data/custom.json", text: JSON.stringify(manifest, null, 2) + "\n" });
    await commit(cfg, files, `아이템 ${locals.length}개 추가 (웹에서)`);
    for (const r of locals) await idb.put({ ...r, published: true, publishedAt: Date.now() });
    await game.reloadCustoms();
    status(`완료! ${locals.length}개를 올렸어요. 1~2분 뒤 모든 기기에서 보여요`);
    game.sound.play("fanfare");
    renderList();
  } catch (e) {
    status(`실패: ${e.message}`);
    game.sound.play("error");
  } finally {
    btn.disabled = false;
  }
}

// ================================================================ AI 생성
const AI_PROMPT_KEY = "pixelcloset.v1.aiPrompt";
let aiBusy = false;
let aiSpent = 0;

function aiOpt() {
  const o = game.options().ai || {};
  const saved = store.get(AI_PROMPT_KEY, null) || {};
  return {
    basePrompt: saved.basePrompt || o.basePrompt || "full body pixel art character, front view, wearing {item}",
    negative: saved.negative ?? o.negative ?? "",
    guidance: saved.guidance || o.guidance || 6,
    fitWords: o.fitWords || {},
    fitGrow: o.fitGrow || { fitted: 0, regular: 1, loose: 3 },
    masks: o.masks || {},
    hints: o.hints || {},
  };
}

function initAI() {
  const o = aiOpt();
  const order = game.options().tabOrder || [];
  const rank = (k) => (order.indexOf(k) < 0 ? 99 : order.indexOf(k));
  const cats = game.categories().filter((c) => o.masks[c.key]).sort((a, b) => rank(a.key) - rank(b.key));
  $("#aiCat").innerHTML = cats.map((c) => `<option value="${c.key}">${esc(c.name)}</option>`).join("");
  $("#aiCat").value = cats[0] ? cats[0].key : "";
  $("#aiToken").value = aiToken.get();
  $("#aiToken").onchange = () => { aiToken.set($("#aiToken").value); aiStatusMsg(""); };
  $("#aiBalance").onclick = checkBalance;
  ["#aiCat", "#aiFit", "#aiLayer"].forEach((s) => ($(s).onchange = syncAIForm));
  $("#aiBase").value = o.basePrompt;
  $("#aiNeg").value = o.negative;
  $("#aiGuide").value = o.guidance;
  const savePrompt = () => store.set(AI_PROMPT_KEY, { basePrompt: $("#aiBase").value, negative: $("#aiNeg").value, guidance: +$("#aiGuide").value });
  ["#aiBase", "#aiNeg", "#aiGuide"].forEach((s) => ($(s).onchange = savePrompt));
  $("#aiResetPrompt").onclick = () => {
    store.set(AI_PROMPT_KEY, null);
    const d = aiOpt();
    $("#aiBase").value = d.basePrompt;
    $("#aiNeg").value = d.negative;
    $("#aiGuide").value = d.guidance;
  };
  $("#aiMaskDl").onclick = () => {
    const mk = currentMask();
    maskCanvas(mk).toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `mask_${$("#aiCat").value}_${$("#aiFit").value}.png`;
      document.body.append(a); a.click(); a.remove();
    });
  };
  $("#aiGo").onclick = generateAll;
  syncAIForm();
}

function aiBase() {
  return game.referenceCanvas({ withWorn: $("#aiLayer").checked });
}

function currentMask() {
  const o = aiOpt();
  const cat = $("#aiCat").value;
  return buildMask(o.masks[cat], o.fitGrow[$("#aiFit").value] || 0, game.referenceCanvas());
}

function syncAIForm() {
  if (!$("#aiCat") || !$("#aiCat").value) return;
  const o = aiOpt();
  const pv = $("#aiMaskPv");
  pv.innerHTML = "";
  const base = aiBase();
  pv.append(thumb(maskOverlay(base, currentMask()), { x: 0, y: 0, w: base.width, h: base.height }, 150));
  $("#aiLines").placeholder = (o.hints[$("#aiCat").value] || "").replace(/^예:\s*/, "") + "\n(여러 개면 줄을 바꿔서)";
}

function aiStatusMsg(msg) {
  $("#aiStatus").textContent = msg;
}

async function checkBalance() {
  aiToken.set($("#aiToken").value);
  const t = aiToken.get();
  if (!t) return aiStatusMsg("토큰을 먼저 넣어 주세요");
  aiStatusMsg("확인 중…");
  try {
    const b = await getBalance(t);
    const usd = b && (b.usd ?? (b.credits && b.credits.usd));
    const gens = b && (b.generations ?? (b.subscription && b.subscription.generations));
    const parts = [];
    if (usd != null) parts.push(`$${Number(usd).toFixed(2)}`);
    if (gens != null) parts.push(`${gens} generations`);
    aiStatusMsg(`연결됐어요! 잔액: ${parts.length ? parts.join(" · ") : JSON.stringify(b).slice(0, 120)}`);
    game.sound.play("select");
  } catch (e) {
    aiStatusMsg(`실패: ${e.message}`);
    game.sound.play("error");
  }
}

function usageText(u) {
  if (!u) return "";
  if (u.usd != null) { aiSpent += u.usd; return ` · 이번에 쓴 금액 약 $${aiSpent.toFixed(3)}`; }
  if (u.generations != null) { aiSpent += u.generations; return ` · 이번에 쓴 generation ${aiSpent}`; }
  return "";
}

async function generateAll() {
  if (aiBusy) return;
  aiToken.set($("#aiToken").value);
  const token = aiToken.get();
  if (!token) { aiStatusMsg("PixelLab API 토큰을 먼저 넣어 주세요"); game.sound.play("error"); return; }
  const lines = $("#aiLines").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { aiStatusMsg("만들 옷 설명을 적어 주세요"); game.sound.play("error"); return; }

  const o = aiOpt();
  const cat = $("#aiCat").value;
  const fit = $("#aiFit").value;
  const count = +$("#aiCount").value;
  const base = aiBase();
  const mk = currentMask();
  const mask = maskCanvas(mk);
  const jobs = [];
  for (const line of lines) for (let k = 0; k < count; k++) jobs.push({ line, k });

  aiBusy = true;
  $("#aiGo").disabled = true;
  let done = 0, failed = 0;
  aiStatusMsg(`0/${jobs.length} 생성 중… (한 장에 10~40초쯤 걸려요)`);
  game.sound.play("brushOn");

  const run = async (job) => {
    const fitWord = o.fitWords[fit] ? `${o.fitWords[fit]} ` : "";
    const item = `${fitWord}${job.line}`;
    const description = o.basePrompt.includes("{item}") ? o.basePrompt.replace("{item}", item) : `${o.basePrompt}, wearing ${item}`;
    try {
      const { image, usage } = await inpaint({
        token, description, negative: o.negative, guidance: o.guidance,
        base, mask, seed: Math.floor(Math.random() * 1e9),
      });
      done++;
      const draft = {
        key: Math.random().toString(36).slice(2),
        kind: cat, image: null,
        name: job.line.slice(0, 28) + (count > 1 ? ` ${job.k + 1}` : ""),
        mode: "ai", fit, recolor: true, variant: null,
        ai: { result: image, base, mask: mk, warn: [`AI 생성: "${item}"`] },
      };
      await processDraft(draft);
      drafts.push(draft);
      renderDrafts();
      aiStatusMsg(`${done + failed}/${jobs.length} 완료${failed ? ` (실패 ${failed})` : ""}${usageText(usage)}`);
      game.sound.play("equip");
    } catch (e) {
      failed++;
      aiStatusMsg(`${done + failed}/${jobs.length} · "${job.line}" 실패: ${e.message}`);
      game.sound.play("error");
      if (e.status === 401 || e.status === 402) throw e;
    }
  };

  try {
    const queue = jobs.slice();
    const worker = async () => { while (queue.length) await run(queue.shift()); };
    await Promise.all([worker(), worker()]);
    if (done) {
      aiStatusMsg(`끝! ${done}장 생성${failed ? `, ${failed}장 실패` : ""}. 아래에서 확인하고 "추가"를 눌러 주세요${usageText(null)}`);
      game.sound.play("fanfare");
      $("#adDraftCard").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (e) {
    aiStatusMsg(`중단: ${e.message}`);
  } finally {
    aiBusy = false;
    $("#aiGo").disabled = false;
  }
}
