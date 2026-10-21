# PIXEL CLOSET

픽셀 아바타 코디 게임 (개인용). 순수 HTML/CSS/JS, 빌드 과정 없음. GitHub에 push하면 Vercel이 자동 배포.

## 로컬에서 실행
```
python3 -m http.server 8000   # 또는 npx serve
```
→ http://localhost:8000 (파일을 더블클릭해서 열면 JSON을 못 불러와요)

## 아이템 추가하기
1. 128×128 투명 PNG를 `assets/<카테고리>/` 에 넣기
2. `data/items.json` 에 한 블록 추가
```json
{ "id": "top_black_hoodie", "category": "top", "name": "검정 후드티",
  "src": "assets/top/black_hoodie.png", "fit": "loose", "tags": ["black"] }
```
- `category`: socks · shoes · bottom · onepiece · top · belt · outer · bag · jewelry · accessory
- `recolor: false` → 무늬 있는 옷처럼 색 바꾸기를 끌 때
- `hides: ["hair_front"]` → 모자처럼 앞머리를 가려야 할 때 (카테고리 키도 가능)
- `extraLayers: [{ "src": "...", "z": 12 }]` → 백팩 끈처럼 몸 뒤에 그려질 부분 (z < 20 이면 몸 뒤)

## 배경 · 헤어 · 표정 · 피부색 추가
`data/options.json` 에서 `backgrounds`, `hairStyles`, `faces`, `skinRamps`, `hairRamps` 에 항목 추가.

## BGM 바꾸기
`assets/audio/` 에 mp3/ogg를 넣고 `options.json` → `"audio": { "bpm": 100, "bgm": "assets/audio/bgm.mp3" }`.
`bgm`이 `null`이면 내장 칩튠이 나와요. `bpm`은 아바타 숨쉬기 박자에도 쓰여요.

## 에셋 규칙 (중요)
- 아바타 레이어 전부 **128×128**, 발바닥 y=124, 몸 중심 x=64. 배경은 **160×192**
- 반투명 픽셀 금지 (완전 불투명 or 완전 투명)
- 예약색은 옷에 쓰지 않기 — 피부 `#f5d0b6 #e0ab8c #c4876b #8f5a47`, 헤어 `#5a3a2b #3f2618 #28170e`
- 외곽선 `#2b1d1a`, `#4a302a` 는 색 바꾸기에서 제외돼요

## 임시 그림
지금 들어 있는 그림은 `tools/make_placeholders.py` 로 만든 임시 그림이에요. 같은 파일명으로 덮어쓰면 교체돼요.
