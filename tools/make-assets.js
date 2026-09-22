// 앱 아이콘 / 스플래시 / 스토어 이미지 생성.  node tools/make-assets.js
// 결과: assets/ (capacitor-assets 입력), store/ (Play 스토어 등록용). 이후 `npm run assets` 로 안드로이드 리소스에 반영.
// 디자인: 초록(브랜드색) 배경 + 큰 노란 로또볼(숫자) + 오른쪽 위 흰 알림 뱃지(종). (2026-09-23, "D" 시안 채택)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BRAND = '#0f766e';

function ballShape(cx, cy, r, color) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
    <ellipse cx="${cx - r * 0.32}" cy="${cy - r * 0.35}" rx="${r * 0.32}" ry="${r * 0.2}" fill="#fff" opacity=".5" transform="rotate(-30 ${cx - r * 0.32} ${cy - r * 0.35})"/>`;
}

// 1024 기준 로또볼+뱃지 마크. 원래 도안(공 중심 500,560 + 뱃지 중심 770,270)의 무게중심을 (512,512)로
// 맞추기 위해 안쪽 <g>에서 (-43,17)만큼 먼저 보정한 뒤, 바깥쪽에서 scale(s)만으로 확대/축소한다.
function mark(s, color = '#ffffff') {
  return `<g transform="translate(512 512) scale(${s}) translate(-512 -512)"><g transform="translate(-43 17)">
    ${ballShape(500, 560, 310, '#f5b800')}
    <text x="500" y="605" font-family="Arial, sans-serif" font-size="270" font-weight="800" fill="#7a5200" text-anchor="middle">45</text>
    <circle cx="770" cy="270" r="150" fill="${color}"/>
    <g transform="translate(651.5 160) scale(0.23)">
      <path d="M512 250 C 640 250 706 360 706 500 C 706 620 730 670 776 715 C 800 738 792 772 758 772
        L 266 772 C 232 772 224 738 248 715 C 294 670 318 620 318 500 C 318 360 384 250 512 250 Z" fill="${BRAND}"/>
      <circle cx="512" cy="230" r="46" fill="${BRAND}"/>
    </g>
  </g></g>`;
}

const bg = (a = '#14968b', b = '#0b5f58') => `<defs><radialGradient id="g" cx="50%" cy="28%" r="85%">
  <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs>
  <rect width="1024" height="1024" fill="url(#g)"/>`;

const svg = (w, h, body, vb = '0 0 1024 1024') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`);

// opaque: Play 스토어 그래픽(피처 그래픽/스크린샷)은 알파 채널이 있으면 업로드가 거부되므로 흰 배경에 합쳐 알파를 제거한다.
async function out(file, buf, w, h, opaque = false) {
  const p = path.join(ROOT, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let img = sharp(buf, { density: 144 }).resize(w, h);
  if (opaque) img = img.flatten({ background: BRAND });
  await img.png().toFile(p);
  console.log('wrote', file, w + 'x' + h, opaque ? '(알파 없음)' : '');
}

(async () => {
  // --- 앱 아이콘 (capacitor-assets 입력) ---
  await out('assets/icon-only.png', svg(1024, 1024, bg() + mark(0.78)), 1024, 1024);
  await out('assets/icon-foreground.png', svg(1024, 1024, mark(1.1)), 1024, 1024);
  await out('assets/icon-background.png', svg(1024, 1024, bg()), 1024, 1024);

  // --- 스플래시 (2732 정사각, 마크는 가운데 작게) ---
  await out('assets/splash.png', svg(2732, 2732, bg('#14968b', BRAND) + mark(0.36)), 2732, 2732);
  await out('assets/splash-dark.png', svg(2732, 2732, bg('#0e5d57', '#093f3b') + mark(0.36)), 2732, 2732);

  // --- Play 스토어 등록용 ---
  await out('store/icon-512.png', svg(512, 512, bg() + mark(0.78)), 512, 512, true);

  // 피처 그래픽 1024x500: 왼쪽 마크, 오른쪽 문구 (한글 글꼴이 없는 환경이면 문구가 깨질 수 있어 결과를 눈으로 확인할 것)
  const feature = `<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14968b"/><stop offset="1" stop-color="#0b5f58"/></linearGradient></defs>
    <rect width="1024" height="500" fill="url(#f)"/>
    <g transform="translate(-292 -262)">${mark(0.55)}</g>
    <text x="440" y="222" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="88" font-weight="700" fill="#ffffff">복권 알림이</text>
    <text x="444" y="292" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="34" fill="#d7f3ef">사진만 등록하면</text>
    <text x="444" y="340" font-family="Malgun Gothic, Noto Sans KR, sans-serif" font-size="34" fill="#d7f3ef">당첨 결과를 알림으로 알려드려요</text>`;
  await out('store/feature-graphic-1024x500.png', svg(1024, 500, feature, '0 0 1024 500'), 1024, 500, true);
})().catch((e) => { console.error(e); process.exit(1); });
