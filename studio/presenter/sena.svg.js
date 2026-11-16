// SENA 캐릭터 (가상 인물) — SVG로 그린 뒤 입 모양 3종 × 눈(뜸/감음) = 6장 PNG로 저장
// 사용: node studio/presenter/sena.svg.js studio/presenter/sena   (Playwright 필요; 결과 PNG는 저장소에 포함돼 있음)
const fs = require('fs'), path = require('path');
const out = process.argv[2] || path.join(__dirname, 'sena');
fs.mkdirSync(out, { recursive: true });

const HAIR = 'url(#hair)';
const LASH = '#3b2a22';
const mouths = [
  // 0: 다문 입 (살짝 미소)
  `<path d="M238 327 Q256 338 274 327" fill="none" stroke="#c4626b" stroke-width="4.5" stroke-linecap="round"/>`,
  // 1: 반쯤
  `<path d="M240 323 Q256 319 272 323 Q268 339 256 341 Q244 339 240 323 Z" fill="#8f3a45"/>
   <path d="M244 336 Q256 342 268 336 Q262 341 256 341 Q250 341 244 336 Z" fill="#e2848c"/>`,
  // 2: 크게
  `<path d="M236 319 Q256 313 276 319 Q273 351 256 354 Q239 351 236 319 Z" fill="#7d2b38"/>
   <path d="M238 320 Q256 316 274 320 L273 325 Q256 322 239 325 Z" fill="#fff"/>
   <ellipse cx="256" cy="346" rx="11" ry="6" fill="#e2848c"/>`,
];
const eyes = [
  // 뜬 눈 (화면 기준 오른쪽 눈)
  `<path d="M270 257 Q300 232 330 255 Q300 274 270 257 Z" fill="#fff"/>
   <clipPath id="eyeclip"><path d="M270 257 Q300 232 330 255 Q300 274 270 257 Z"/></clipPath>
   <g clip-path="url(#eyeclip)">
     <circle cx="300" cy="255" r="15" fill="url(#iris)"/>
     <circle cx="300" cy="256" r="6.5" fill="#1a0f0c"/>
     <circle cx="305" cy="250" r="4" fill="#fff"/>
     <circle cx="295" cy="261" r="1.8" fill="#fff" opacity=".8"/>
   </g>
   <path d="M266 254 Q300 224 334 251" fill="none" stroke="${LASH}" stroke-width="5.5" stroke-linecap="round"/>
   <path d="M330 250 L340 244" stroke="${LASH}" stroke-width="3.5" stroke-linecap="round"/>`,
  // 감은 눈
  `<path d="M268 257 Q300 270 332 255" fill="none" stroke="${LASH}" stroke-width="5" stroke-linecap="round"/>
   <path d="M330 255 L340 251" stroke="${LASH}" stroke-width="3" stroke-linecap="round"/>`,
];

function svg(m, e) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
  <radialGradient id="bg" cx="50%" cy="38%" r="72%"><stop offset="0" stop-color="#2b3352"/><stop offset="1" stop-color="#11141f"/></radialGradient>
  <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0BE"/><stop offset=".45" stop-color="#F4D579"/><stop offset="1" stop-color="#D6A945"/></linearGradient>
  <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF8F4"/><stop offset="1" stop-color="#FCEAE2"/></linearGradient>
  <radialGradient id="iris" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#8a6250"/><stop offset="1" stop-color="#3d241b"/></radialGradient>
</defs>
<rect width="512" height="512" fill="url(#bg)"/>
<!-- 뒷머리 -->
<path d="M118 230 C104 120 178 66 256 66 C334 66 408 120 394 230 C404 330 420 420 430 512 L82 512 C92 420 108 330 118 230 Z" fill="${HAIR}"/>
<!-- 몸 -->
<path d="M92 512 C98 432 168 398 256 398 C344 398 414 432 420 512 Z" fill="#1c2131"/>
<path d="M226 348 L226 404 Q256 426 286 404 L286 348 Z" fill="#F7E0D6"/>
<path d="M226 390 Q256 410 286 390 L286 404 Q256 426 226 404 Z" fill="#ecc9bc"/>
<path d="M196 412 L256 474 L316 412" fill="none" stroke="#F0B90B" stroke-width="7" stroke-linejoin="round"/>
<!-- 얼굴 -->
<path d="M160 228 C160 318 204 372 256 372 C308 372 352 318 352 228 C352 160 310 118 256 118 C202 118 160 160 160 228 Z" fill="url(#skin)"/>
<!-- 볼 -->
<ellipse cx="204" cy="304" rx="20" ry="9" fill="#ffaeb4" opacity=".35"/>
<ellipse cx="310" cy="304" rx="20" ry="9" fill="#ffaeb4" opacity=".35"/>
<!-- 눈썹 (금발) -->
<path d="M280 221 Q303 209 327 219" fill="none" stroke="#c7953a" stroke-width="5" stroke-linecap="round"/>
<path d="M186 219 Q209 209 232 221" fill="none" stroke="#c7953a" stroke-width="5" stroke-linecap="round"/>
<!-- 눈 -->
${eyes[e]}
<!-- 안대 (화면 기준 왼쪽 눈) -->
<path d="M240 238 L346 158" stroke="#121218" stroke-width="7" stroke-linecap="round"/>
<path d="M184 246 L150 222" stroke="#121218" stroke-width="7" stroke-linecap="round"/>
<path d="M180 252 C180 228 244 226 246 252 C248 280 214 290 204 288 C188 286 180 272 180 252 Z" fill="#16161d"/>
<path d="M188 248 C194 236 230 234 238 248" fill="none" stroke="#3a3a48" stroke-width="3" stroke-linecap="round"/>
<!-- 코 -->
<path d="M257 284 Q252 298 259 301" fill="none" stroke="#e5bcae" stroke-width="3" stroke-linecap="round"/>
<!-- 입 -->
${mouths[m]}
<!-- 앞머리 -->
<path d="M156 232 C146 148 198 100 256 100 C318 100 366 148 356 234 C344 204 334 186 322 172 C316 198 302 208 284 214 C290 194 288 178 282 166 C266 196 240 208 210 214 C222 196 226 180 222 168 C204 190 180 208 156 232 Z" fill="${HAIR}"/>
<!-- 옆머리 -->
<path d="M160 214 C146 280 150 360 134 440 L176 444 C176 370 170 296 178 236 Z" fill="${HAIR}"/>
<path d="M352 214 C366 280 362 360 378 440 L336 444 C336 370 342 296 334 236 Z" fill="${HAIR}"/>
<!-- 머리 광택 -->
<path d="M196 128 Q256 100 318 130" fill="none" stroke="#fffbe8" stroke-width="7" stroke-linecap="round" opacity=".55"/>
<path d="M224 116 Q256 108 290 117" fill="none" stroke="#fffbe8" stroke-width="4" stroke-linecap="round" opacity=".5"/>
</svg>`;
}

(async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 512, height: 512 } });
  for (const e of [0, 1]) for (const m of [0, 1, 2]) {
    await p.setContent(`<html><body style="margin:0">${svg(m, e)}</body></html>`);
    const f = path.join(out, `${e ? 'blink' : 'mouth'}${m}.png`);
    await p.screenshot({ path: f, clip: { x: 0, y: 0, width: 512, height: 512 } });
    console.log(f);
  }
  await b.close();
})();
