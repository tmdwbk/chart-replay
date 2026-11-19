// 차트 그리기 도구 (replay.html · game.html 공통). 이 파일보다 먼저 chart·candle·agg·tfSec·cursor·meta·precision·flash·fmtKst·fmtP·fmtBig·sgn·$ 가 있어야 한다.
// ---------------------------------------------------------------- 그리기 도구 (트레이딩뷰 왼쪽 막대처럼)
// 그린 것은 시각(UTC 초)·가격으로 저장한다. 그래서 봉(1분·5분…)을 바꾸거나 리플레이를 넘기고 되돌려도 같은 자리에 남는다.
// 종목마다 따로 브라우저(localStorage)에 저장하고, 어디로도 보내지 않는다.
const DRAW_TOOLS = {
  trend: { name: '추세선', need: 2, key: 'T' }, ray: { name: '반직선 (한쪽으로 연장)', need: 2 }, ext: { name: '연장선 (양쪽으로 연장)', need: 2 },
  hline: { name: '수평선', need: 1, key: 'H' }, hray: { name: '수평 반직선', need: 1, key: 'J' }, vline: { name: '수직선', need: 1, key: 'V' },
  fib: { name: '피보나치 되돌림', need: 2, key: 'F' }, channel: { name: '평행 채널', need: 3 },
  brush: { name: '붓', need: 0 }, hl: { name: '형광펜', need: 0 }, arrow: { name: '화살표', need: 2 },
  rect: { name: '사각형', need: 2, key: 'R' }, ellipse: { name: '원', need: 2 },
  text: { name: '텍스트', need: 1 }, icon: { name: '아이콘', need: 1 },
  measure: { name: '측정 (가격 차이·기간 재기)', need: 2 }, zoom: { name: '확대 (상자로 끌어서)', need: 2 },
};
const DRAW_GROUPS = { line: ['trend', 'ray', 'ext', 'hline', 'hray', 'vline'], fib: ['fib', 'channel'], brush: ['brush', 'hl', 'arrow', 'rect', 'ellipse'], text: ['text'], icon: ['icon'] };
const EMOJIS = ['🚀', '🔥', '💰', '🎯', '📌', '⭐', '✅', '❌', '⚠️', '❓', '💡', '👍', '👎', '😀', '😎', '🤔', '😱', '😡', '😭', '😂'];
const SWATCH = ['#2962ff', '#f23645', '#089981', '#ff9800', '#e040fb', '#ffeb3b', '#d1d4dc'];
const FIB = [[0, '#787b86'], [0.236, '#f23645'], [0.382, '#ff9800'], [0.5, '#4caf50'], [0.618, '#089981'], [0.786, '#00bcd4'], [1, '#787b86'], [1.618, '#2962ff']];
const DICON = {
  trend: '<path d="M7.5 20.5l13-13"/><circle cx="6" cy="22" r="2"/><circle cx="22" cy="6" r="2"/>',
  ray: '<path d="M7.5 20.5L25 3"/><circle cx="6" cy="22" r="2"/><circle cx="15" cy="13" r="2"/>',
  ext: '<path d="M3 25L25 3"/><circle cx="10" cy="18" r="2"/><circle cx="18" cy="10" r="2"/>',
  hline: '<path d="M3 14h9M16 14h9"/><circle cx="14" cy="14" r="2"/>',
  hray: '<path d="M8 14h17"/><circle cx="6" cy="14" r="2"/>',
  vline: '<path d="M14 3v9M14 16v9"/><circle cx="14" cy="14" r="2"/>',
  fib: '<path d="M9 7h15M4 14h20M4 21h15"/><circle cx="6.5" cy="7" r="2"/><circle cx="21.5" cy="21" r="2"/>',
  channel: '<path d="M4 17L17 6M11 23l13-11"/><circle cx="4" cy="17" r="1.6"/><circle cx="17" cy="6" r="1.6"/>',
  brush: '<path d="M21.5 4.5l2 2-9 9-3 .9.9-3z"/><path d="M4.5 23.5c1.5-.5 3-1.5 3.5-3.5s2-3 4-2.5"/>',
  hl: '<path d="M17 5l6 6-8 8h-6v-6z"/><path d="M4 24h14" stroke-width="3" opacity=".55"/>',
  arrow: '<path d="M6 22L21 7M13 7h8v8"/>',
  rect: '<rect x="5" y="8" width="18" height="12" rx="1"/><circle cx="5" cy="8" r="1.6"/><circle cx="23" cy="20" r="1.6"/>',
  ellipse: '<ellipse cx="14" cy="14" rx="10" ry="7"/>',
  text: '<path d="M8 7h12M14 7v15M11 22h6"/>',
  icon: '<circle cx="14" cy="14" r="10"/><path d="M10 16.5c2 2.5 6 2.5 8 0"/><circle cx="11" cy="12" r=".9" fill="currentColor"/><circle cx="17" cy="12" r=".9" fill="currentColor"/>',
  measure: '<path d="M4 18L18 4l6 6-14 14z"/><path d="M8.5 13.5l2 2M11.5 10.5l3 3M14.5 7.5l2 2"/>',
  zoom: '<circle cx="12" cy="12" r="7"/><path d="M17 17l7 7M12 9v6M9 12h6"/>',
  magnet: '<path d="M8 5v9a6 6 0 0 0 12 0V5h-4v9a2 2 0 0 1-4 0V5z"/><path d="M8 9h4M16 9h4"/>',
  stay: '<path d="M4.5 20.5L16 9l3 3L7.5 23.5h-3z"/><rect x="17" y="18" width="7.5" height="6" rx="1"/><path d="M18.5 18v-2a2.2 2.2 0 0 1 4.4 0v2"/>',
  lock: '<rect x="7" y="13" width="14" height="11" rx="2"/><path d="M10 13V9a4 4 0 0 1 8 0"/>',
  lockOn: '<rect x="7" y="13" width="14" height="11" rx="2"/><path d="M10 13V9a4 4 0 0 1 8 0v4"/>',
  hide: '<path d="M3 14s4-7 11-7 11 7 11 7-4 7-11 7S3 14 3 14z"/><circle cx="14" cy="14" r="3"/>',
  hideOn: '<path d="M3 14s4-7 11-7 11 7 11 7-4 7-11 7S3 14 3 14z"/><circle cx="14" cy="14" r="3"/><path d="M5 23L23 5"/>',
  sync: '<path d="M12 16l4-4"/><path d="M10.5 12.5l-3 3a3.2 3.2 0 0 0 4.5 4.5l3-3M17.5 15.5l3-3a3.2 3.2 0 0 0-4.5-4.5l-3 3"/>',
  trash: '<path d="M6 8h16M11 8V5h6v3M8 8l1 15h10l1-15M12 12v7M16 12v7"/>',
};
const svgIcon = (k) => `<svg viewBox="0 0 28 28">${DICON[k]}</svg>`;
const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let drawings = [], drawSym = undefined, drawVer = 0, drawUndo = [], drawSeq = 0;
let tool = 'cursor', emoji = '🚀';
const groupPick = { line: 'trend', fib: 'fib', brush: 'brush', text: 'text', icon: 'icon' };
let dopt = { magnet: 0, magnetLast: 1, stay: false, lock: false, hide: false, sync: true };
try { Object.assign(dopt, JSON.parse(localStorage.getItem('replay-draw-opts') || '{}')); } catch (e) { /* 처음 */ }
let selId = null, creating = null, dmove = null, measure = null, zoomBox = null, zoomPrev = null, editing = null, panLocked = false;

const saveOpts = () => localStorage.setItem('replay-draw-opts', JSON.stringify(dopt));
const drawKey = () => 'replay-draw:' + (meta ? meta.symbol : '');
function loadDrawings() {
  drawSym = meta ? meta.symbol : null;
  try { drawings = meta ? JSON.parse(localStorage.getItem(drawKey()) || '[]') : []; } catch (e) { drawings = []; }
  drawings = drawings.filter((d) => d.type !== 'text' || d.text);   // 글자를 쓰다 만 빈 텍스트는 버린다
  drawUndo = []; selId = null; creating = null; measure = null;
  drawSeq = drawings.reduce((m, d) => Math.max(m, d.id || 0), 0);
  renderDrawBar(); drawVer++;
}
function saveDrawings() { if (meta) localStorage.setItem(drawKey(), JSON.stringify(drawings)); drawVer++; }
function snapshot() { drawUndo.push(JSON.stringify(drawings)); if (drawUndo.length > 80) drawUndo.shift(); }
function undoDraw() {
  if (!drawUndo.length) { flash('되돌릴 그림이 없어요.'); return; }
  drawings = JSON.parse(drawUndo.pop()); selId = null; saveDrawings(); renderDrawBar();
}

// 시각 ↔ 차트의 봉 위치(logical). 공개된 봉(agg) 사이는 비례로, 앞뒤 바깥은 봉 길이(tfSec)로 늘려서 잰다.
function tToL(t) {
  const n = agg.length; if (!n) return null;
  if (t <= agg[0].t) return (t - agg[0].t) / tfSec;
  const L = agg[n - 1]; if (t >= L.t) return n - 1 + (t - L.t) / tfSec;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (agg[m].t <= t) lo = m; else hi = m; }
  return lo + (t - agg[lo].t) / (agg[hi].t - agg[lo].t);
}
function lToT(l) {
  const n = agg.length;
  if (l <= 0) return agg[0].t + l * tfSec;
  if (l >= n - 1) return agg[n - 1].t + (l - (n - 1)) * tfSec;
  const i = Math.floor(l);
  return agg[i].t + (l - i) * (agg[i + 1].t - agg[i].t);
}
const paneW = () => chart.timeScale().width();
const paneH = () => $('chart').clientHeight - chart.timeScale().height();
// 차트 라이브러리는 정수 봉 위치만 화면 좌표로 바꿔 주므로, 봉 사이(소수) 위치는 앞뒤 봉 사이를 비례로 나눈다
function lToX(l) {
  const ts = chart.timeScale(), i = Math.floor(l), x0 = ts.logicalToCoordinate(i);
  if (l === i || x0 == null) return x0;
  const x1 = ts.logicalToCoordinate(i + 1);
  return x1 == null ? x0 : x0 + (x1 - x0) * (l - i);
}
function xToL(x) {
  const ts = chart.timeScale(), l0 = ts.coordinateToLogical(x); if (l0 == null) return null;
  const i = Math.floor(l0), x0 = ts.logicalToCoordinate(i), x1 = ts.logicalToCoordinate(i + 1);
  return x0 == null || x1 == null || x1 === x0 ? l0 : i + (x - x0) / (x1 - x0);
}
function xy(pt) {
  const l = tToL(pt.t); if (l == null) return null;
  const x = lToX(l), y = candle.priceToCoordinate(pt.p);
  return x == null || y == null ? null : [x, y];
}
function ptAt(x, y, snap = true) {          // 화면 위치 → {t, p}. snap: 봉 위치에 맞추고, 자석이 켜져 있으면 시고저종에 붙인다
  let l = xToL(x); const p0 = candle.coordinateToPrice(y);
  if (l == null || p0 == null) return null;
  let p = +p0;
  if (snap) {
    l = Math.round(l);
    if (dopt.magnet && l >= 0 && l < agg.length) {
      const a = agg[l]; let best = p, bd = Infinity;
      for (const v of [a.o, a.h, a.l, a.c]) { const d = Math.abs(candle.priceToCoordinate(v) - y); if (d < bd) { bd = d; best = v; } }
      if (dopt.magnet === 2 || bd <= 18) p = best;
    }
  }
  return { t: lToT(l), p };
}
function linePriceAt(a, b, t) {               // 두 점을 잇는 선이 시각 t 에서 지나는 가격
  const la = tToL(a.t), lb = tToL(b.t), l = tToL(t);
  return la === lb ? a.p : a.p + (b.p - a.p) * (l - la) / (lb - la);
}
let _mctx = null;
function textW(s, fs) {
  _mctx = _mctx || document.createElement('canvas').getContext('2d');
  _mctx.font = `${fs}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
  return _mctx.measureText(s).width;
}
function fmtDur(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.round(sec % 3600 / 60);
  return [d && d + '일', h && h + '시간', (m || (!d && !h)) && m + '분'].filter(Boolean).join(' ');
}

// 그림 하나의 화면 모양: svg(그릴 것), segs(선분, 클릭 판정), boxes·inside(안쪽 클릭 판정), handles(끌 수 있는 점)
function shape(d) {
  const W = paneW(), H = paneH();
  const P = d.pts.map(xy); if (!P.length || P.some((v) => !v)) return null;
  const c = d.color, w = d.width || 2;
  const s = { svg: '', segs: [], boxes: [], inside: null, handles: P };
  const line = (x1, y1, x2, y2, col = c, ww = w, extra = '') => {
    s.svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${ww}" ${extra}/>`;
    s.segs.push([x1, y1, x2, y2, ww / 2]);
  };
  const lab = (x, y, txt, bg, align = 'end') => {   // 가격·시각 꼬리표
    const tw = textW(txt, 11) + 10, x0 = align === 'end' ? x - tw : align === 'mid' ? x - tw / 2 : x;
    s.svg += `<rect x="${x0}" y="${y - 9}" width="${tw}" height="18" rx="3" fill="${bg}"/><text x="${x0 + 5}" y="${y + 4}" font-size="11" fill="#fff">${escH(txt)}</text>`;
  };
  const far = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, k = (W + H) * 3 / L; return [a[0] + dx * k, a[1] + dy * k]; };
  switch (d.type) {
    case 'trend': case 'ray': case 'ext': case 'arrow': {
      const [a, b] = P;
      const A = d.type === 'ext' ? far(b, a) : a, B = d.type === 'ray' || d.type === 'ext' ? far(a, b) : b;
      line(A[0], A[1], B[0], B[1]);
      if (d.type === 'arrow') {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), k = 9 + w * 2;
        const p1 = [b[0] - k * Math.cos(ang - 0.45), b[1] - k * Math.sin(ang - 0.45)], p2 = [b[0] - k * Math.cos(ang + 0.45), b[1] - k * Math.sin(ang + 0.45)];
        s.svg += `<polygon points="${b} ${p1} ${p2}" fill="${c}"/>`;
      }
      break;
    }
    case 'hline': line(0, P[0][1], W, P[0][1]); lab(W - 2, P[0][1], fmtP(d.pts[0].p), c); break;
    case 'hray': line(P[0][0], P[0][1], W, P[0][1]); lab(W - 2, P[0][1], fmtP(d.pts[0].p), c); break;
    case 'vline': line(P[0][0], 0, P[0][0], H); lab(P[0][0], H - 12, fmtKst(d.pts[0].t).slice(5), c, 'mid'); break;
    case 'fib': {
      const [a, b] = P, x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]);
      const p1 = d.pts[0].p, p2 = d.pts[1].p;
      let prevY = null;
      for (const [lv, col] of FIB) {
        const pr = p2 + (p1 - p2) * lv, y = candle.priceToCoordinate(pr);
        if (y == null) continue;
        if (prevY != null) s.svg += `<rect x="${x1}" y="${Math.min(prevY, y)}" width="${x2 - x1}" height="${Math.abs(y - prevY)}" fill="${col}" fill-opacity=".09"/>`;
        line(x1, y, x2, y, col, w > 2 ? w - 1 : 1);
        s.svg += `<text x="${x1 + 4}" y="${y - 4}" font-size="11" fill="${col}">${lv} (${fmtP(pr)})</text>`;
        prevY = y;
      }
      s.svg += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#787b86" stroke-width="1" stroke-dasharray="4 4"/>`;
      break;
    }
    case 'channel': {
      const [a, b] = P;
      const dp = d.pts[2] ? d.pts[2].p - linePriceAt(d.pts[0], d.pts[1], d.pts[2].t) : 0;
      const a2 = xy({ t: d.pts[0].t, p: d.pts[0].p + dp }), b2 = xy({ t: d.pts[1].t, p: d.pts[1].p + dp });
      if (!a2 || !b2) return null;
      s.svg += `<polygon points="${a} ${b} ${b2} ${a2}" fill="${c}" fill-opacity=".12"/>`;
      line(a[0], a[1], b[0], b[1]); line(a2[0], a2[1], b2[0], b2[1]);
      s.svg += `<line x1="${(a[0] + a2[0]) / 2}" y1="${(a[1] + a2[1]) / 2}" x2="${(b[0] + b2[0]) / 2}" y2="${(b[1] + b2[1]) / 2}" stroke="${c}" stroke-width="1" stroke-dasharray="4 4"/>`;
      const poly = [a, b, b2, a2];
      s.inside = (x, y) => inPoly(x, y, poly);
      break;
    }
    case 'rect': {
      const [a, b] = P, x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), rw = Math.abs(a[0] - b[0]), rh = Math.abs(a[1] - b[1]);
      s.svg += `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="${w}"/>`;
      s.boxes.push([x, y, rw, rh]);
      s.handles = [a, b, [a[0], b[1]], [b[0], a[1]]];
      break;
    }
    case 'ellipse': {
      const [a, b] = P, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(a[0] - b[0]) / 2, ry = Math.abs(a[1] - b[1]) / 2;
      s.svg += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${c}" fill-opacity=".15" stroke="${c}" stroke-width="${w}"/>`;
      s.inside = (x, y) => rx > 0 && ry > 0 && ((x - cx) / (rx + 5)) ** 2 + ((y - cy) / (ry + 5)) ** 2 <= 1;
      break;
    }
    case 'brush': case 'hl': {
      const ww = d.type === 'hl' ? w * 6 : w;
      s.svg += `<polyline points="${P.join(' ')}" fill="none" stroke="${c}" stroke-width="${ww}" stroke-linecap="round" stroke-linejoin="round"${d.type === 'hl' ? ' stroke-opacity=".38"' : ''}/>`;
      for (let i = 1; i < P.length; i++) s.segs.push([P[i - 1][0], P[i - 1][1], P[i][0], P[i][1], ww / 2]);
      s.handles = [];
      break;
    }
    case 'text': {
      const fs = 10 + w * 3, [x, y] = P[0], tw = textW(d.text || ' ', fs);
      s.svg += `<text x="${x}" y="${y}" font-size="${fs}" fill="${c}" stroke="#131722" stroke-width="3" paint-order="stroke">${escH(d.text || '')}</text>`;
      s.boxes.push([x - 3, y - fs, tw + 6, fs * 1.3]);
      s.handles = [];
      break;
    }
    case 'icon': {
      const fs = 14 + w * 7, [x, y] = P[0];
      s.svg += `<text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" dominant-baseline="central">${escH(d.text)}</text>`;
      s.boxes.push([x - fs * 0.6, y - fs * 0.6, fs * 1.2, fs * 1.2]);
      s.handles = [];
      break;
    }
  }
  return s;
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x, y, g) {
  const [x1, y1, x2, y2] = g, dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  const k = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
  return Math.hypot(x - (x1 + k * dx), y - (y1 + k * dy));
}
const visibleDrawings = () => (dopt.hide ? [] : drawings.filter((d) => dopt.sync || d.tf === tfSec));
function hitDraw(x, y) {                      // 마우스 아래 그림: { d, idx } (idx: 끌 점 번호, -1 은 몸통)
  if (cursor < 0 || !agg.length) return null;
  const list = visibleDrawings().slice().reverse();
  const sel = list.find((d) => d.id === selId);
  if (sel) {
    const s = shape(sel);
    if (s) for (let i = 0; i < s.handles.length; i++) if (Math.hypot(s.handles[i][0] - x, s.handles[i][1] - y) < 8) return { d: sel, idx: i };
  }
  for (const d of list) {
    const s = shape(d); if (!s) continue;
    if (s.segs.some((g) => segDist(x, y, g) < 5 + g[4])
      || s.boxes.some((b) => x >= b[0] - 3 && x <= b[0] + b[2] + 3 && y >= b[1] - 3 && y <= b[1] + b[3] + 3)
      || (s.inside && s.inside(x, y))) return { d, idx: -1 };
  }
  return null;
}

function renderDraw() {
  const svg = $('drawLayer');
  if (cursor < 0 || !agg.length) { svg.innerHTML = ''; return; }
  const W = Math.max(0, paneW()), H = Math.max(0, paneH());
  let h = `<defs><clipPath id="dclip"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs><g clip-path="url(#dclip)">`;
  const list = visibleDrawings();
  if (creating && creating.d) list.push(creating.d);
  for (const d of list) {
    const s = shape(d); if (!s) continue;
    h += `<g>${s.svg}</g>`;
    if (d.id === selId || (creating && creating.d === d)) {
      if (!s.handles.length) {
        const xs = [], ys = [];
        for (const g of s.segs) { xs.push(g[0], g[2]); ys.push(g[1], g[3]); }
        for (const b of s.boxes) { xs.push(b[0], b[0] + b[2]); ys.push(b[1], b[1] + b[3]); }
        if (xs.length) h += `<rect x="${Math.min(...xs) - 4}" y="${Math.min(...ys) - 4}" width="${Math.max(...xs) - Math.min(...xs) + 8}" height="${Math.max(...ys) - Math.min(...ys) + 8}" fill="none" stroke="#2962ff" stroke-dasharray="3 3"/>`;
      }
      for (const [x, y] of s.handles) h += `<circle cx="${x}" cy="${y}" r="5" fill="#131722" stroke="#2962ff" stroke-width="1.5"/>`;
    }
  }
  if (measure) h += measureSvg();
  if (zoomBox) {
    const a = xy(zoomBox.a), b = xy(zoomBox.b);
    if (a && b) h += `<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(a[0] - b[0])}" height="${Math.abs(a[1] - b[1])}" fill="rgba(41,98,255,.12)" stroke="#2962ff" stroke-dasharray="4 3"/>`;
  }
  svg.innerHTML = h + '</g>';
}
function measureSvg() {                       // 측정: 가격 차이(%), 봉 수·기간, 그동안 거래대금
  const a = xy(measure.a), b = xy(measure.b); if (!a || !b) return '';
  const up = measure.b.p >= measure.a.p, col = up ? '#2962ff' : '#f23645';
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), rw = Math.abs(a[0] - b[0]), rh = Math.abs(a[1] - b[1]);
  const la = tToL(measure.a.t), lb = tToL(measure.b.t), nb = Math.round(lb - la);
  let qv = 0;
  for (let i = Math.max(0, Math.round(Math.min(la, lb))); i <= Math.min(agg.length - 1, Math.round(Math.max(la, lb))); i++) qv += agg[i].qv;
  const dp = measure.b.p - measure.a.p, pct = (measure.b.p / measure.a.p - 1) * 100;
  const lines = [`${dp > 0 ? '+' : ''}${dp.toFixed(precision)} (${sgn(pct)}%)`, `${nb}봉 · ${nb < 0 ? '-' : ''}${fmtDur(Math.abs(nb) * tfSec)}`];
  if (qv > 0) lines.push(`거래대금 ${fmtBig(qv)}${meta.quote ? ' ' + meta.quote : ''}`);
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  let h = `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="${col}" fill-opacity=".18"/>`;
  // 트레이딩뷰처럼 시작 → 끝 방향 화살표 두 개: 세로(가격이 오른/내린 쪽), 가로(시간이 흐른 쪽)
  const arrow = (x1, y1, x2, y2) => {
    let r = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.5"/>`;
    if (Math.hypot(x2 - x1, y2 - y1) >= 12) {
      const ang = Math.atan2(y2 - y1, x2 - x1), k = 8;
      const p1 = [x2 - k * Math.cos(ang - 0.5), y2 - k * Math.sin(ang - 0.5)], p2 = [x2 - k * Math.cos(ang + 0.5), y2 - k * Math.sin(ang + 0.5)];
      r += `<polyline points="${p1} ${x2},${y2} ${p2}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
    }
    return r;
  };
  h += arrow(mx, a[1], mx, b[1]) + arrow(a[0], my, b[0], my);
  const tw = Math.max(...lines.map((t) => textW(t, 12))) + 16, th = lines.length * 17 + 8;
  const ly = up ? y - th - 6 : y + rh + 6;
  h += `<rect x="${mx - tw / 2}" y="${ly}" width="${tw}" height="${th}" rx="4" fill="${col}"/>`;
  lines.forEach((t, i) => { h += `<text x="${mx}" y="${ly + 18 + i * 17}" font-size="12" fill="#fff" text-anchor="middle">${escH(t)}</text>`; });
  return h;
}

// ---- 도구 막대
const TOOLBAR = [{ g: 'line' }, { g: 'fib' }, { g: 'brush' }, { g: 'text' }, { g: 'icon' }, '-', { t: 'measure' }, { t: 'zoom' }, '-',
  { o: 'magnet' }, { o: 'stay' }, { o: 'lock' }, { o: 'hide' }, { o: 'sync' }, '-', { a: 'trash' }];
const OPT_TIP = {
  magnet: () => (dopt.magnet === 2 ? '강한 자석: 점이 늘 가까운 봉의 시가·고가·저가·종가에 붙어요' : dopt.magnet === 1 ? '약한 자석: 시고저종 가까이 가면 붙어요' : '자석 꺼짐 (누르면 켜짐 · 오른쪽 아래 ◢ 로 약/강 고르기)'),
  stay: () => (dopt.stay ? '그리기 모드 유지: 하나 그린 뒤에도 같은 도구가 계속 선택돼요' : '그리기 모드 유지 꺼짐: 하나 그리면 화살표(선택)로 돌아가요'),
  lock: () => (dopt.lock ? '모든 그림 잠김: 클릭·이동이 안 돼요 (누르면 풀림)' : '모든 그림 잠그기'),
  hide: () => (dopt.hide ? '그림 숨김 중 (누르면 다시 보임)' : '모든 그림 숨기기'),
  sync: () => (dopt.sync ? '모든 봉에 같이 보기: 1분봉에 그린 선이 5분·1시간봉에도 보여요 (누르면 그린 봉에서만)' : '그린 봉에서만 보기: 그 봉 길이를 고를 때만 보여요 (누르면 모든 봉에)'),
};
function renderTools() {
  const el = $('tools'); let h = '';
  for (const it of TOOLBAR) {
    if (it === '-') { h += '<div class="tsep"></div>'; continue; }
    if (it.g) {
      const t = groupPick[it.g], more = DRAW_GROUPS[it.g].length > 1 || it.g === 'icon';
      const tip = it.g === 'icon' ? `아이콘 ${emoji} (◢ 로 고르기)` : DRAW_TOOLS[t].name + (DRAW_TOOLS[t].key ? ` (Alt+${DRAW_TOOLS[t].key})` : '') + (more ? ' · ◢ 로 다른 도구' : '');
      h += `<button class="tb${tool === t ? ' on' : ''}" data-g="${it.g}" title="${tip}">${svgIcon(t)}${more ? '<i class="more" data-more="' + it.g + '"></i>' : ''}</button>`;
    } else if (it.t) {
      h += `<button class="tb${tool === it.t ? ' on' : ''}" data-t="${it.t}" title="${DRAW_TOOLS[it.t].name}">${svgIcon(it.t)}</button>`;
    } else if (it.o) {
      const on = !!dopt[it.o], ic = it.o === 'lock' && on ? 'lockOn' : it.o === 'hide' && on ? 'hideOn' : it.o;
      h += `<button class="tb${on ? ' on' : ''}" data-o="${it.o}" title="${OPT_TIP[it.o]()}">${svgIcon(ic)}${it.o === 'magnet' ? '<i class="more" data-more="magnet"></i>' : ''}</button>`;
    } else h += `<button class="tb" data-a="trash" title="이 종목에 그린 것 모두 지우기">${svgIcon('trash')}</button>`;
  }
  el.innerHTML = h;
  $('chart').classList.toggle('drawing', tool !== 'cursor');
}
function setTool(t) {
  if (creating) { creating = null; measure = null; zoomBox = null; }
  if (t === tool && t !== 'cursor') t = 'cursor';              // 같은 도구를 다시 누르면 끄기
  tool = t;
  for (const g in DRAW_GROUPS) if (DRAW_GROUPS[g].includes(t)) groupPick[g] = t;
  if (t !== 'cursor' && selId) { selId = null; renderDrawBar(); }
  renderTools(); drawVer++;
}
function closeFlyout() { const f = $('flyout'); if (f) f.remove(); }
function openFlyout(kind, btn) {
  closeFlyout();
  const f = document.createElement('div'); f.id = 'flyout';
  if (kind === 'icon') {
    f.className = 'emo';
    f.innerHTML = EMOJIS.map((e) => `<span data-emo="${e}" class="${e === emoji ? 'on' : ''}">${e}</span>`).join('');
  } else if (kind === 'magnet') {
    f.innerHTML = [[0, '자석 끄기'], [1, '약한 자석 (가까우면 붙음)'], [2, '강한 자석 (늘 붙음)']]
      .map(([v, n]) => `<div class="fi${dopt.magnet === v ? ' on' : ''}" data-mag="${v}">${svgIcon('magnet')}<span>${n}</span></div>`).join('');
  } else {
    f.innerHTML = DRAW_GROUPS[kind].map((t) => `<div class="fi${tool === t ? ' on' : ''}" data-tool="${t}">${svgIcon(t)}<span>${DRAW_TOOLS[t].name}</span>${DRAW_TOOLS[t].key ? `<kbd>Alt+${DRAW_TOOLS[t].key}</kbd>` : ''}</div>`).join('');
  }
  document.body.appendChild(f);
  const r = btn.getBoundingClientRect();
  f.style.left = r.right + 4 + 'px';
  f.style.top = Math.min(r.top, window.innerHeight - f.offsetHeight - 8) + 'px';
}
$('tools').addEventListener('click', (e) => {
  const b = e.target.closest('.tb'); if (!b) return;
  b.blur();
  const more = e.target.closest('.more');
  if (more) { const f = $('flyout'); if (f && f.dataset.k === more.dataset.more) { closeFlyout(); return; } openFlyout(more.dataset.more, b); $('flyout').dataset.k = more.dataset.more; return; }
  closeFlyout();
  if (b.dataset.g) setTool(groupPick[b.dataset.g]);
  else if (b.dataset.t) setTool(b.dataset.t);
  else if (b.dataset.o) {
    const o = b.dataset.o;
    if (o === 'magnet') dopt.magnet = dopt.magnet ? 0 : (dopt.magnetLast || 1);
    else dopt[o] = !dopt[o];
    if (o === 'lock' && dopt.lock && selId) { selId = null; renderDrawBar(); }
    if (o === 'hide') renderDrawBar();
    saveOpts(); renderTools(); drawVer++;
    flash(OPT_TIP[o](), 2500);
  } else if (b.dataset.a === 'trash') {
    if (!drawings.length) { flash('지울 그림이 없어요.'); return; }
    if (!confirm(`${meta ? meta.symbol + ' 에 ' : ''}그린 것 ${drawings.length}개를 모두 지울까요? (Ctrl/⌘+Z 로 되돌릴 수 있어요)`)) return;
    snapshot(); drawings = []; selId = null; saveDrawings(); renderDrawBar();
  }
});
$('tools').addEventListener('contextmenu', (e) => {    // 오른쪽 클릭으로도 하위 도구 열기
  const b = e.target.closest('.tb'); if (!b) return;
  const k = b.dataset.g && (DRAW_GROUPS[b.dataset.g].length > 1 || b.dataset.g === 'icon') ? b.dataset.g : b.dataset.o === 'magnet' ? 'magnet' : null;
  if (k) { e.preventDefault(); openFlyout(k, b); $('flyout').dataset.k = k; }
});
document.addEventListener('click', (e) => {
  const f = $('flyout'); if (!f) return;
  const it = e.target.closest('#flyout [data-tool], #flyout [data-emo], #flyout [data-mag]');
  if (it) {
    if (it.dataset.tool) { tool = 'cursor'; setTool(it.dataset.tool); }
    else if (it.dataset.emo) { emoji = it.dataset.emo; tool = 'cursor'; setTool('icon'); }
    else { dopt.magnet = +it.dataset.mag; if (dopt.magnet) dopt.magnetLast = dopt.magnet; saveOpts(); renderTools(); }
    closeFlyout(); return;
  }
  if (!e.target.closest('#flyout, #tools .more')) closeFlyout();
});

// ---- 고른 그림 막대 (색·굵기·지우기)
function renderDrawBar() {
  const bar = $('drawBar'), d = drawings.find((x) => x.id === selId);
  if (!d || dopt.hide) { bar.style.display = 'none'; return; }
  const big = d.type === 'text' || d.type === 'icon';
  let h = `<span class="dim">${DRAW_TOOLS[d.type].name}</span>`;
  if (d.type !== 'icon' && d.type !== 'fib') h += SWATCH.map((c) => `<span class="sw${c === d.color ? ' on' : ''}" data-c="${c}" style="background:${c}"></span>`).join('');
  h += `<select id="dbW">${[1, 2, 3, 4, 5].map((v) => `<option value="${v}"${v === d.width ? ' selected' : ''}>${big ? '크기' : '굵기'} ${v}</option>`).join('')}</select>`;
  if (d.type === 'text') h += '<button data-a="edit">글자 고치기</button>';
  h += '<button data-a="del" title="Delete 키">🗑 지우기</button>';
  bar.innerHTML = h; bar.style.display = 'flex';
}
$('drawBar').addEventListener('click', (e) => {
  const d = drawings.find((x) => x.id === selId); if (!d) return;
  const sw = e.target.closest('.sw'), b = e.target.closest('button');
  if (sw) { snapshot(); d.color = sw.dataset.c; saveDrawings(); renderDrawBar(); }
  else if (b && b.dataset.a === 'del') deleteSelected();
  else if (b && b.dataset.a === 'edit') openTextEditor(d, false);
});
$('drawBar').addEventListener('change', (e) => {
  const d = drawings.find((x) => x.id === selId); if (!d || e.target.id !== 'dbW') return;
  snapshot(); d.width = +e.target.value; saveDrawings(); e.target.blur();
});
function deleteSelected() {
  if (!selId) return;
  snapshot(); drawings = drawings.filter((x) => x.id !== selId); selId = null; saveDrawings(); renderDrawBar();
}

// ---- 텍스트 입력
function openTextEditor(d, isNew) {
  const p = xy(d.pts[0]); if (!p) return;
  const inp = $('drawInput');
  inp.style.display = 'block'; inp.style.left = p[0] + 'px'; inp.style.top = (p[1] - 14) + 'px';
  inp.value = d.text || ''; editing = { d, isNew };
  inp.focus(); setTimeout(() => inp.focus(), 30);
}
function commitText(ok) {
  if (!editing) return;
  const { d, isNew } = editing; editing = null;
  const inp = $('drawInput'), v = inp.value.trim();
  inp.style.display = 'none'; inp.blur();
  if (ok && v) { if (!isNew) snapshot(); d.text = v; saveDrawings(); }
  else if (isNew) { drawings = drawings.filter((x) => x !== d); drawUndo.pop(); selId = null; saveDrawings(); }
  renderDrawBar();
}
$('drawInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') commitText(true);
  else if (e.key === 'Escape') commitText(false);
});
$('drawInput').addEventListener('blur', () => commitText(true));

// ---- 확대
function doZoom() {
  const { a, b } = zoomBox; zoomBox = null; drawVer++;
  const l1 = tToL(a.t), l2 = tToL(b.t);
  if (Math.abs(l2 - l1) < 2 || a.p === b.p) { flash('상자를 조금 더 크게 끌어 주세요.'); return; }
  if (!zoomPrev) zoomPrev = chart.timeScale().getVisibleLogicalRange();
  const lo = Math.min(a.p, b.p), hi = Math.max(a.p, b.p);
  chart.timeScale().setVisibleLogicalRange({ from: Math.min(l1, l2), to: Math.max(l1, l2) });
  candle.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: lo, maxValue: hi } }) });
  $('zoomReset').style.display = 'block';
}
function zoomOut() {
  candle.applyOptions({ autoscaleInfoProvider: (orig) => orig() });
  if (zoomPrev) chart.timeScale().setVisibleLogicalRange(zoomPrev);
  zoomPrev = null; $('zoomReset').style.display = 'none';
}
$('zoomReset').onclick = zoomOut;

// ---- 마우스
function locXY(e) { const r = $('chart').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
const inPane = (x, y) => x >= 0 && y >= 0 && x < paneW() && y < paneH();
const UI_SEL = '#drawBar, #drawInput, #zoomReset';
function drawWants(e) {                       // 이 클릭을 그리기 쪽이 쓸지 (그러면 주문선 끌기는 쉰다)
  if (e.target.closest(UI_SEL)) return true;
  if (cursor < 0) return false;
  if (tool !== 'cursor' || creating) return true;
  if (e.target.closest('.ochip') || dopt.lock) return false;
  const [x, y] = locXY(e);
  return inPane(x, y) && !!hitDraw(x, y);
}
function lockPan() { if (!panLocked) { chart.applyOptions({ handleScroll: false, handleScale: false }); panLocked = true; } }
function unlockPan() { if (panLocked) { chart.applyOptions({ handleScroll: true, handleScale: true }); panLocked = false; } }
function newDraw(type, pts) {
  const color = type === 'text' ? '#d1d4dc' : type === 'hl' ? '#ffeb3b' : type === 'brush' ? '#f23645' : '#2962ff';
  return { type, pts, color, width: 2, tf: tfSec, text: type === 'icon' ? emoji : '' };
}
function finishDraw(d) {
  snapshot(); d.id = ++drawSeq; drawings.push(d); selId = d.id; saveDrawings();
  if (d.type === 'text') openTextEditor(d, true);
  if (!dopt.stay) setTool('cursor');
  renderDrawBar();
}
function fixPoint(P) {                        // 만드는 중인 그림의 점 하나를 확정
  const c = creating;
  if (c.measure) { measure.b = P; creating = null; if (!dopt.stay) setTool('cursor'); drawVer++; return; }
  if (c.zoom) { zoomBox.b = P; creating = null; doZoom(); if (!dopt.stay) setTool('cursor'); return; }
  c.d.pts[c.fixed] = P; c.fixed++;
  if (c.fixed >= c.need) { creating = null; finishDraw(c.d); return; }
  c.d.pts.push({ ...P }); c.x0 = null; drawVer++;
}
$('chart').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest(UI_SEL)) return;
  if (tool === 'cursor' && !creating && e.target.closest('.ochip')) return;
  const [x, y] = locXY(e);
  if (!inPane(x, y)) return;
  if (cursor < 0 || !agg.length) { if (tool !== 'cursor') flash('먼저 [여기서 시작]으로 차트를 여세요.'); return; }
  if (editing) commitText(true);
  if (measure && !creating) { measure = null; drawVer++; }
  if (tool === 'cursor' && !creating) {
    const h = dopt.lock ? null : hitDraw(x, y);
    if (!h) { if (selId) { selId = null; renderDrawBar(); drawVer++; } return; }
    e.preventDefault(); e.stopPropagation(); lockPan();
    selId = h.d.id; renderDrawBar(); drawVer++;
    dmove = { d: h.d, idx: h.idx, x0: x, y0: y, start: ptAt(x, y, false), orig: JSON.parse(JSON.stringify(h.d.pts)), moved: false };
    return;
  }
  e.preventDefault(); e.stopPropagation(); lockPan();
  const free = tool === 'brush' || tool === 'hl';
  const P = ptAt(x, y, !free); if (!P) return;
  if (dopt.hide && tool !== 'measure' && tool !== 'zoom') { dopt.hide = false; saveOpts(); renderTools(); }
  if (free) { creating = { d: newDraw(tool, [P]), brush: true }; drawVer++; return; }
  if (!creating) {
    const need = DRAW_TOOLS[tool].need;
    if (tool === 'measure') { measure = { a: P, b: { ...P } }; creating = { measure: true, x0: x, y0: y }; drawVer++; return; }
    if (tool === 'zoom') { zoomBox = { a: P, b: { ...P } }; creating = { zoom: true, x0: x, y0: y }; drawVer++; return; }
    const d = newDraw(tool, need === 1 ? [P] : [P, { ...P }]);
    if (need === 1) { finishDraw(d); return; }
    creating = { d, fixed: 1, need, x0: x, y0: y }; drawVer++;
    return;
  }
  fixPoint(P);
}, true);
document.addEventListener('pointermove', (e) => {
  if (cursor < 0 || !agg.length) return;
  const [x, y] = locXY(e);
  if (creating) {
    if (creating.brush) { const P = ptAt(x, y, false); if (P) { creating.d.pts.push(P); drawVer++; } return; }
    const P = ptAt(x, y); if (!P) return;
    if (creating.measure) measure.b = P; else if (creating.zoom) zoomBox.b = P; else creating.d.pts[creating.d.pts.length - 1] = P;
    drawVer++; return;
  }
  if (dmove) {
    if (!dmove.moved && Math.hypot(x - dmove.x0, y - dmove.y0) < 3) return;
    if (!dmove.moved) { snapshot(); dmove.moved = true; $('chart').classList.add('dmov'); }
    const d = dmove.d, free = d.type === 'brush' || d.type === 'hl';
    if (dmove.idx >= 0) {
      const P = ptAt(x, y); if (!P) return;
      if (d.type === 'rect' && dmove.idx >= 2) {       // 사각형의 나머지 두 모서리
        const o = dmove.orig;
        d.pts = dmove.idx === 2 ? [{ t: P.t, p: o[0].p }, { t: o[1].t, p: P.p }] : [{ t: o[0].t, p: P.p }, { t: P.t, p: o[1].p }];
      } else d.pts[dmove.idx] = P;
    } else {
      const cur = ptAt(x, y, false); if (!cur || !dmove.start) return;
      let dl = tToL(cur.t) - tToL(dmove.start.t); if (!free) dl = Math.round(dl);
      const dp = cur.p - dmove.start.p;
      d.pts = dmove.orig.map((q) => ({ t: lToT(tToL(q.t) + dl), p: q.p + dp }));
    }
    drawVer++; return;
  }
  const inside = inPane(x, y) && e.target.closest && e.target.closest('#chart') && !e.target.closest(UI_SEL + ', .ochip');
  $('chart').classList.toggle('dhov', !!(inside && tool === 'cursor' && !dopt.lock && hitDraw(x, y)));
});
document.addEventListener('pointerup', (e) => {
  unlockPan();
  if (creating) {
    if (creating.brush) { const d = creating.d; creating = null; if (d.pts.length > 1) finishDraw(d); else drawVer++; return; }
    if (creating.x0 != null) {                // 끌어서 그린 경우: 손을 뗀 곳이 다음 점
      const [x, y] = locXY(e);
      if (Math.hypot(x - creating.x0, y - creating.y0) > 5) { const P = ptAt(x, y); if (P) fixPoint(P); }
    }
    return;
  }
  if (dmove) { const m = dmove.moved; dmove = null; $('chart').classList.remove('dmov'); if (m) saveDrawings(); }
});
$('chart').addEventListener('dblclick', (e) => {
  if (tool !== 'cursor' || dopt.lock) return;
  const [x, y] = locXY(e), h = hitDraw(x, y);
  if (h && h.d.type === 'text') openTextEditor(h.d, false);
});
const DRAW_KEYS = {};
for (const [t, v] of Object.entries(DRAW_TOOLS)) if (v.key) DRAW_KEYS['Key' + v.key] = t;
document.addEventListener('keydown', (e) => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Escape') {
    closeFlyout();
    if (creating || measure || zoomBox) { creating = null; measure = null; zoomBox = null; drawVer++; }
    else if (selId) { selId = null; renderDrawBar(); drawVer++; }
    else if (tool !== 'cursor') setTool('cursor');
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); deleteSelected(); }
  else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); undoDraw(); }
  else if (e.altKey && DRAW_KEYS[e.code]) { e.preventDefault(); tool = 'cursor'; setTool(DRAW_KEYS[e.code]); }
});

let drawSig = '';
(function drawLoop() {                         // 차트를 옮기거나 확대하면 다시 그린다 (바뀐 게 없으면 건너뜀)
  const sym = meta ? meta.symbol : null;
  if (sym !== drawSym) loadDrawings();
  let sig = String(drawVer);
  if (cursor >= 0 && agg.length) {
    const r = chart.timeScale().getVisibleLogicalRange(), lc = agg[agg.length - 1].c;
    sig += `|${r && r.from}|${r && r.to}|${candle.priceToCoordinate(lc)}|${candle.priceToCoordinate(lc * 1.01)}|${$('chart').clientWidth}|${$('chart').clientHeight}|${agg.length}|${tfSec}|${agg[0].t}`;
  }
  if (sig !== drawSig) { drawSig = sig; renderDraw(); }
  requestAnimationFrame(drawLoop);
})();
renderTools();
