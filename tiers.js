// 차트게임 티어: 잔고(실현 손익까지 반영된 현금) 기준 9단계. 기준을 넘으면 승급전(5판 3승)을 거쳐 오른다 (2026-11-24 기준값 조정).
// 엠블럼은 이 사이트에서 직접 그린 SVG (게임 회사 그림을 가져오지 않음). 색만 흔히 쓰는 티어 색 느낌으로.
const TIERS = [
  { key: 'iron',        name: '아이언',       en: 'IRON',         min: 0,        c1: '#8a817c', c2: '#3d3836', gem: '#b9b0aa' },
  { key: 'bronze',      name: '브론즈',       en: 'BRONZE',       min: 4000,     c1: '#cd8f5c', c2: '#5e3b22', gem: '#f0b483' },
  { key: 'silver',      name: '실버',         en: 'SILVER',       min: 6000,    c1: '#dfe6ee', c2: '#6f7c8a', gem: '#ffffff' },
  { key: 'gold',        name: '골드',         en: 'GOLD',         min: 10000,    c1: '#ffd966', c2: '#9a6a12', gem: '#fff1b8' },
  { key: 'platinum',    name: '플래티넘',     en: 'PLATINUM',     min: 15000,   c1: '#5fe0d2', c2: '#1b6e68', gem: '#c8fff8' },
  { key: 'diamond',     name: '다이아',       en: 'DIAMOND',      min: 30000,   c1: '#8fb4ff', c2: '#3442b8', gem: '#e3ecff' },
  { key: 'master',      name: '마스터',       en: 'MASTER',       min: 40000,  c1: '#d29bff', c2: '#5b1a96', gem: '#f3e1ff' },
  { key: 'grandmaster', name: '그랜드마스터', en: 'GRANDMASTER',  min: 50000,  c1: '#ff8a8a', c2: '#8f1515', gem: '#ffe0e0' },
  { key: 'challenger',  name: '챌린저',       en: 'CHALLENGER',   min: 100000, c1: '#ffe9a3', c2: '#2a8fd6', gem: '#e9fbff' },
];
function tierIndex(bal) { let i = 0; for (let k = 0; k < TIERS.length; k++) if (bal >= TIERS[k].min) i = k; return i; }

// 엠블럼 그림: "Ranks Coins and More" by Sinestesia (OpenGameArt, CC0) — img/tiers/CREDITS.txt (2026-11-24 직접 그린 것에서 바꿈)
// 원본에 없는 단계(아이언·마스터·그랜드마스터·챌린저)는 원본 그림의 색을 바꾸고 빛을 더해 만든다.
const TIER_IMG = [
  { f: 'rank-silver-2.png', css: 'filter:grayscale(1) brightness(.62) contrast(1.15)' },                        // 아이언
  { f: 'rank-bronze-1.png', css: '' },                                                                          // 브론즈
  { f: 'rank-silver-1.png', css: '' },                                                                          // 실버
  { f: 'rank-gold-1.png', css: '' },                                                                            // 골드
  { f: 'rank-plat-1.png', css: '' },                                                                            // 플래티넘
  { f: 'rank-diamond-1.png', css: '' },                                                                         // 다이아
  { f: 'rank-diamond-0.png', css: 'filter:hue-rotate(65deg) saturate(1.2) drop-shadow(0 0 6px rgba(200,120,255,.55))' },   // 마스터 (보라)
  { f: 'rank-diamond-0.png', css: 'filter:hue-rotate(150deg) saturate(1.35) drop-shadow(0 0 8px rgba(255,80,80,.6))' },    // 그랜드마스터 (빨강)
  { f: 'rank-gold-0.png', css: 'filter:saturate(1.2) drop-shadow(0 0 10px rgba(255,220,120,.85)) drop-shadow(0 0 22px rgba(120,200,255,.45))', cls: 'tchal' }, // 챌린저
];
// 내 그림으로 바꾸기: data/tiers/<key>.png (iron·bronze·silver·gold·platinum·diamond·master·grandmaster·challenger) 가 있으면 그걸 먼저 쓴다.
// data/ 는 GitHub 에 올라가지 않으니 이 컴퓨터에서만 보인다. 처음에 한 번 있는지 확인하고, 있으면 화면을 다시 그리게 알린다.
const TIER_LOCAL = {};
(async () => {
  if (location.protocol === 'file:') return;
  let found = false;
  await Promise.all(TIERS.map(async (t) => {
    try { const r = await fetch(`data/tiers/${t.key}.png`, { method: 'HEAD', cache: 'no-store' }); if (r.ok) { TIER_LOCAL[t.key] = true; found = true; } } catch (e) {}
  }));
  if (found) window.dispatchEvent(new Event('tiers-local'));
})();
function tierSvg(i, size = 64) {   // 이름은 예전 그대로(여러 곳에서 씀). 이제 그림 파일을 쓴다
  const t = TIERS[i], m = TIER_IMG[i];
  if (TIER_LOCAL[t.key]) return `<img class="temb" src="data/tiers/${t.key}.png" width="${size}" height="${size}" alt="${t.name}" style="object-fit:contain" draggable="false">`;
  return `<img class="temb ${m.cls || ''}" src="img/tiers/${m.f}" width="${size}" height="${size}" alt="${t.name}" style="${m.css}; object-fit:contain" draggable="false">`;
}
