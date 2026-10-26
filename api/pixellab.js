// PixelLab API 중계 (Vercel 서버리스 함수)
// - 토큰은 저장하지 않아요. 브라우저가 요청마다 x-pixellab-token 헤더로 보내고, 여기서 그대로 전달만 해요.
// - 정해진 기능(inpaint, balance)만 통과시켜요.
const BASE = "https://api.pixellab.ai";
const ACTIONS = {
  inpaint: { method: "POST", path: "/v1/inpaint" },
  balance: { method: "GET", path: "/v1/balance" },
};

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    // 연결 확인용: ?probe=1 이면 PixelLab 서버에 닿는지만 확인 (토큰 없이 → 401이 정상)
    if (req.query && req.query.probe) {
      try {
        const r = await fetch(BASE + "/v1/balance");
        return res.status(200).json({ ok: true, upstream: r.status });
      } catch (e) {
        return res.status(200).json({ ok: false, error: String(e) });
      }
    }
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "POST만 돼요" });

  const token = req.headers["x-pixellab-token"];
  if (!token) return res.status(400).json({ error: "PixelLab 토큰이 없어요" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { action, payload } = body || {};
  const a = ACTIONS[action];
  if (!a) return res.status(400).json({ error: "알 수 없는 요청이에요" });

  try {
    const r = await fetch(BASE + a.path, {
      method: a.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(a.method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: a.method === "POST" ? JSON.stringify(payload || {}) : undefined,
    });
    const text = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: "PixelLab 서버에 연결하지 못했어요", detail: String(e) });
  }
};
