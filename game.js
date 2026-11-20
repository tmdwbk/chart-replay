// 차트게임 모드 (replay.html?game). 리플레이 화면의 주문·포지션·기록 기능을 그대로 쓰고, 그 위에 게임 규칙만 얹는다.
// - 거래량이 많았던 때의 주요 알트코인 30개 5분봉에서 랜덤으로 한 구간 (data/game/, fetch_game.py 로 받음)
// - 시드 3,000 USDT 고정 · 잔고 초기화 없음 · 레버리지 3배 고정 · 격리 고정 · 수수료 지정가(메이커) 0.02%
// - 종목 하나에 50턴(1턴 = 시작 화면, 다음 봉 하나 = 1턴), 새 종목은 5초 뒤에 넘길 수 있음
// - 턴 동안 종목 이름·날짜는 가리고, 종목이 끝나면 공개
// 가상 연습용. 실제 주문·API 키 없음.
(function () {
  if (!GAME_MODE) return;

  const SEED = 3000, TURNS = 50, PRE = 200, LOCK_MS = 5000, FEE_PCT = 0.02, LEV = 3, DEF_MARGIN = 1000;
  const STORE = 'chart-game-v3';          // v3: 리플레이 화면 기반(2026-11-19). 리플레이 연습 계좌와 따로
  let G = null;                           // 저장되는 게임 상태
  let index = null, starting = false, lockTimer = null;

  // ------------------------------------------------------------ 저장
  function loadG() {
    try { G = JSON.parse(localStorage.getItem(STORE)); } catch (e) { G = null; }
    if (!G || !G.acct) {
      G = { acct: { start: SEED, balance: SEED }, trades: [], orders: [], rounds: [], n: 0, round: null, open: null, pendEntry: null, reduces: [] };
      try {                               // 예전 차트게임(v2) 잔고·종목 기록을 이어받는다
        const v2 = JSON.parse(localStorage.getItem('chart-game-v2'));
        if (v2 && typeof v2.cash === 'number') {
          const m = v2.pos ? ['long', 'short'].reduce((s, k) => s + (v2.pos[k] ? v2.pos[k].margin : 0), 0) : 0;
          G.acct.balance = v2.cash + m;
          G.rounds = (v2.history || []).map((h) => ({ ...h }));
          G.n = v2.n || G.rounds.length;
        }
      } catch (e) {}
    }
    acct = G.acct;
    trades = G.trades || [];
    orders = G.orders || [];
    orderSeq = orders.reduce((m, x) => Math.max(m, x.id || 0), 0);
    open = G.open; pendEntry = G.pendEntry; reduces = G.reduces || [];
    reduceId = reduces.reduce((m, x) => Math.max(m, x.id || 0), 0);
  }
  function saveG() {
    G.acct = acct; G.trades = trades; G.orders = orders.slice(-1000); G.open = open; G.pendEntry = pendEntry; G.reduces = reduces;
    try { localStorage.setItem(STORE, JSON.stringify(G)); } catch (e) {}
  }

  // ------------------------------------------------------------ 리플레이 함수 바꿔 끼우기
  const hidden = () => !!(G && G.round && !G.round.done);
  const inWindow = (ts) => bars.length && ts >= bars[0].t - 86400 && ts <= bars[bars.length - 1].t + 86400;
  const origFmt = fmtKst;
  fmtKst = function (ts) { const s = origFmt(ts); return hidden() && inWindow(ts) ? '····-··-·· ' + s.slice(11) : s; };
  saveAcct = saveG;
  saveTrades = saveG;
  saveOrders = function () { ordVer++; saveG(); };
  dispSym = function () { return !G || !G.round ? '' : hidden() ? '???' : G.round.symbol; };
  symOfRec = function (r) { return hidden() && r.round === G.round.id ? '???' : (r.symbol || ''); };
  tradeHook = function (r) { r.round = G.round ? G.round.id : null; };
  stepBack = function () { flash('차트게임에서는 뒤로 갈 수 없어요.'); };
  const turnNow = () => (G.round ? cursor - G.round.firstTurn + 1 : 0);
  const origStep = step;
  step = function (n) {
    if (!G.round || G.round.done || starting) { stopPlay(); return; }
    n = Math.min(n, TURNS - turnNow());
    if (n <= 0) { stopPlay(); return; }
    origStep(n);
    G.round.turn = turnNow();
    if (G.round.turn >= TURNS) endRound('50턴 끝');
    else { saveG(); renderTurn(); }
  };
  const origMarkers = renderMarkers;
  renderMarkers = function () {           // 이번 종목 기록만 차트에 표시
    const all = trades;
    trades = G && G.round ? all.filter((t) => t.round === G.round.id) : [];
    try { origMarkers(); } finally { trades = all; }
  };
  renderInfo = function () {
    renderLegend(null);
    if (cursor < 0 || !G.round) return;
    const a = agg[agg.length - 1], ch = (a.c / a.o - 1) * 100, r = G.round;
    $('info').innerHTML =
      `<span><b>${dispSym()}</b> <span class="dim">${hidden() ? '종목·날짜는 종목이 끝나면 공개' : r.name + ' · ' + (r.sources || []).map((x) => (x === 'bybit' ? '바이비트' : '바이낸스') + ' 선물').join('·')}</span></span>` +
      `<span>턴 <b>${r.turn}/${TURNS}</b></span><span>지금 <b>${fmtKst(nowT())}</b> KST</span>` +
      `<span>5분 봉 시 ${fmtP(a.o)} 고 ${fmtP(a.h)} 저 ${fmtP(a.l)} 종 <b class="${cls(ch)}">${fmtP(a.c)}</b> <span class="${cls(ch)}">${sgn(ch)}%</span></span>` +
      `<span class="dim">거래대금 ${fmtBig(a.qv)} USDT</span>`;
  };
  const origBottom = renderBottom;
  renderBottom = function () {
    if (btab === 'review' || btab === 'ach') {
      renderBottomCounts(); $('histFilter').style.display = 'none';
      return btab === 'review' ? renderReviewTab($('bbody')) : renderAchTab($('bbody'));
    }
    if (btab !== 'rounds') return origBottom();
    renderBottomCounts();
    $('histFilter').style.display = 'none';
    const el = $('bbody'), h = G.rounds;
    if (!h.length) { el.innerHTML = '<div class="empty">아직 끝난 종목이 없어요.</div>'; return; }
    const tot = h.reduce((s, x) => s + x.pnl, 0), wins = h.filter((x) => x.pnl > 0).length;
    const play = G.playMs ? ` · 플레이타임 ${fmtDur(G.playMs)}` : '';
    el.innerHTML = `<div class="dim" style="padding:6px 12px">${h.length}종목 · 손익 <b class="${cls(tot)}">${usdS(tot)}</b> · 이긴 종목 ${wins}/${h.length}${play}</div>` +
      '<table><thead><tr><th>#</th><th>종목</th><th>기간 (KST)</th><th>턴</th><th>진입</th><th>손익</th><th>수익률</th><th>끝 잔고</th><th>티어</th><th>플레이</th><th>끝난 이유</th></tr></thead><tbody>' +
      h.slice().reverse().map((x) => `<tr><td class="dim">${x.n}</td><td>${x.daily ? '📅 ' : ''}<b>${x.name}</b> <span class="dim">${x.short}</span></td>` +
        `<td class="dim">${origFmt(x.from)} ~ ${origFmt(x.to).slice(11)}</td><td>${x.turns}</td><td>${x.entries}회${x.liq ? ' <span class="down">강제청산</span>' : ''}</td>` +
        `<td class="${cls(x.pnl)}">${usdS(x.pnl)}</td><td class="${cls(x.pnl)}">${sgn(x.pnl / x.startCash * 100)}%</td><td>${usd(x.endCash)}</td><td style="color:${TIERS[tierIndex(x.endCash)].c1}">${TIERS[tierIndex(x.endCash)].name}</td><td class="dim">${x.playMs != null ? fmtDur(x.playMs) : '-'}</td><td class="dim">${x.why || ''}</td></tr>`).join('') +
      '</tbody></table>';
  };
  const origRenderPos = renderPos;
  renderPos = function () { origRenderPos(); if (G) saveG(); };

  // ------------------------------------------------------------ 화면 바꾸기
  const css = document.createElement('style');
  css.textContent = `
    #gHome { position:fixed; inset:0; z-index:100; background:#131722; display:flex; overflow-y:auto; padding:24px 0; }
    #gHome .card { margin:auto; }
    #gHome .card { width:390px; background:linear-gradient(180deg, #1b2a24 0%, #1a1f2b 55%); border:1px solid #2b3a33; border-radius:28px; padding:34px 26px 26px; text-align:center; box-shadow:0 18px 40px rgba(0,0,0,.45); }
    #gHome .ico { width:140px; height:140px; margin:0 auto 14px; border-radius:50%; background:radial-gradient(circle, #23493a 0%, #1b2f28 70%, transparent 72%); display:flex; align-items:center; justify-content:center; }
    #gHome .ico svg { width:118px; height:118px; filter:drop-shadow(0 8px 16px rgba(0,0,0,.45)); }
    #gHome .kick { color:#4caf85; letter-spacing:.22em; font-weight:700; font-size:12px; }
    #gHome h1 { color:#fff; font-size:22px; margin:8px 0 10px; }
    #gHome p { color:#a3a8b5; line-height:1.6; margin:0 0 20px; font-size:13.5px; }
    #gHome .row { display:flex; justify-content:space-between; align-items:center; background:#232838; border-radius:14px; padding:16px 20px; margin-bottom:10px; }
    #gHome .row .l { color:#868b98; } #gHome .row .r { color:#fff; font-size:18px; font-weight:700; }
    #gHome .go { width:100%; background:#2e7d5b; border:none; border-radius:16px; padding:17px 0; color:#fff; font-size:16px; font-weight:700; margin-top:6px; }
    #gHome .go:hover { background:#348c66; } #gHome .go:disabled { opacity:.5; }
    #gHome .note { margin-top:14px; font-size:12px; color:#868b98; line-height:1.5; }
    #gHome .back { position:absolute; top:14px; left:16px; color:#5b8def; text-decoration:none; }
    #gTurn { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:#1e222d; }
    #gTurn .prog { flex:1; height:6px; background:#2a2e39; border-radius:3px; overflow:hidden; }
    #gTurn .prog i { display:block; height:100%; width:0; background:#5b8def; transition:width .15s; }
    #gNext { background:#1e2a4a; border-color:#2f4a8a; color:#8fb0ff; white-space:nowrap; min-width:92px; }
    #chartRow { position:relative; }
    #gResult { position:absolute; inset:0; z-index:9; display:none; align-items:center; justify-content:center; background:rgba(10,12,18,.55); }
    #gResult .rc { background:#1e222d; border:1px solid #363c4e; border-radius:14px; padding:22px 26px; min-width:340px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,.5); }
    #gResult h2 { margin:0 0 4px; color:#fff; font-size:20px; }
    #gResult .bigp { font-size:24px; font-weight:700; margin:12px 0 4px; }
    #gResult button { margin-top:16px; background:#2e7d5b; border:none; color:#fff; font-weight:700; padding:10px 28px; border-radius:10px; font-size:14px; }

    #side { gap:10px; }
    :root { --botH:153px; }   /* 아래 기록 칸: 리플레이(230px)의 2/3 */
    .gcard { background:#1e222d; border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:6px; }
    #gTurn.gcard { flex-direction:row; }
    .gtier { display:flex; align-items:center; gap:10px; }
    .gtier .tn { color:#fff; font-weight:700; font-size:15px; letter-spacing:.02em; }
    .gtier .tbar { height:5px; background:#2a2e39; border-radius:3px; overflow:hidden; margin-top:5px; }
    .gtier .tbar i { display:block; height:100%; width:0; border-radius:3px; }
    #gToast { position:fixed; left:50%; top:22%; transform:translateX(-50%); z-index:200; display:none; flex-direction:column; align-items:center; gap:6px;
      background:rgba(20,24,33,.96); border:1px solid #3a4054; border-radius:18px; padding:22px 40px; box-shadow:0 18px 50px rgba(0,0,0,.6); text-align:center; }
    #gToast .k { letter-spacing:.2em; font-size:12px; font-weight:700; } #gToast .n { color:#fff; font-size:22px; font-weight:800; }
    #gHome .tname { color:#fff; font-size:17px; font-weight:800; margin:-8px 0 2px; } #gHome .ten { font-size:11px; letter-spacing:.25em; margin-bottom:14px; }
    #gHome details { text-align:left; margin-top:10px; font-size:12.5px; color:#a3a8b5; }
    #gHome details summary { cursor:pointer; color:#868b98; text-align:center; }
    .tlist { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px; }
    .tlist div { display:flex; flex-direction:column; align-items:center; background:#232838; border-radius:10px; padding:6px 2px; font-size:11.5px; }
    .tlist div.me { outline:1px solid #5b8def; }
    .grv { display:grid; grid-template-columns:repeat(4, auto); gap:4px 14px; justify-content:center; margin:12px 0 4px; }
    .grv div { display:flex; flex-direction:column; align-items:center; font-size:12px; } .grv b { font-size:15px; }
    .gresach { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:10px; }
    .gresach span { background:#2b3445; border:1px solid #f0b90b66; color:#ffe08a; border-radius:12px; padding:3px 10px; font-size:12px; }
    #gAchToast { position:fixed; right:18px; bottom:18px; z-index:210; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
    .gach { display:flex; gap:10px; align-items:center; background:#1e222d; border:1px solid #f0b90b88; border-radius:12px; padding:10px 14px; min-width:250px; max-width:330px; box-shadow:0 10px 30px rgba(0,0,0,.5); animation:gachIn .25s ease-out; }
    @keyframes gachIn { from { transform:translateY(20px); opacity:0; } to { transform:none; opacity:1; } }
    .ai { font-size:24px; width:32px; text-align:center; }
    .glist { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:6px; padding:4px 12px 12px; }
    .glist > div { display:flex; gap:8px; align-items:center; background:#1e222d; border:1px solid var(--line); border-radius:8px; padding:7px 10px; font-size:12px; opacity:.45; filter:grayscale(1); }
    .glist > div.on { opacity:1; filter:none; border-color:#f0b90b66; }
    #gHome .go2 { width:100%; background:#2b3f6b; border:none; border-radius:16px; padding:13px 0; color:#fff; font-size:14.5px; font-weight:700; margin-top:8px; }
    #gHome .go2:hover { background:#34508a; }
    .gmodal { position:fixed; inset:0; z-index:150; display:none; align-items:center; justify-content:center; background:rgba(8,10,15,.6); }
    .gm { background:#1e222d; border:1px solid #363c4e; border-radius:14px; padding:16px 20px; max-height:90vh; overflow:auto; box-shadow:0 18px 50px rgba(0,0,0,.6); max-width:94vw; }
    .gmh { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:15px; }
    .gkt td { padding:5px 10px; font-size:13px; } .gkt td:first-child { white-space:nowrap; text-align:right; }
    .gkt kbd { font-size:12px; padding:1px 6px; }
    .gtopb { background:#262b3c; border:1px solid #363c4e; border-radius:12px; padding:3px 10px; }
    .gscs { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; }
    .gsc { background:#262b3c; border-radius:8px; padding:7px 10px; font-size:11.5px; } .gsc b { font-size:16px; color:#fff; display:block; margin-top:2px; } .gsc b.up { color:var(--up); } .gsc b.down { color:var(--down); }
    .gm h4 { margin:14px 0 6px; font-size:13px; }
    .gchart { width:100%; height:auto; background:#161a25; border-radius:8px; }
    .g2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .gst { width:100%; font-size:12px; border-collapse:collapse; } .gst th { color:var(--dim); font-weight:400; text-align:left; padding:3px 6px; } .gst td { padding:4px 6px; border-top:1px solid var(--line); }
    .gwhy div { display:grid; grid-template-columns:80px 1fr 30px; align-items:center; gap:6px; font-size:12px; margin:3px 0; }
    .gwhy i { display:block; height:8px; background:#5b8def; border-radius:4px; min-width:2px; } .gwhy b { text-align:right; }
    .ga-top { display:flex; justify-content:space-between; align-items:flex-end; }
    .ga-roi { font-size:26px; font-weight:700; } .ga-eq { font-size:20px; font-weight:700; color:#fff; }
    .ga-line { border-top:1px solid var(--line); margin:6px 0 2px; }
    .gacts { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    .gacts button { height:50px; font-size:14px; font-weight:700; border-radius:8px; border:none; color:#fff; padding:0 4px; flex:none; }
    .gacts #btnLong { background:#1f7a4d; } .gacts #btnShort { background:#c2454f; } .gacts #gHoldBtn { background:#2f3546; border:1px solid #3a4054; }
    .gacts button:hover { filter:brightness(1.1); }
    .gacts button:disabled { opacity:.45; }
    .gpcts { display:flex; gap:6px; align-items:center; }
    .gpcts button { flex:1; padding:6px 0; background:#262b3c; border:1px solid #363c4e; border-radius:6px; }
    .gpcts button.on { background:#e8eaed; color:#131722; border-color:#e8eaed; font-weight:700; }
    .gavail { font-size:12px; }
    .gseg { border:none !important; background:#262b3c; border-radius:8px; padding:3px; gap:3px !important; }
    .gseg .tab { flex:1; border:none !important; border-radius:6px !important; padding:6px 0 !important; font-size:13px !important; }
    .gseg .tab.on { background:#3a4054; color:#fff; }
    .gkeys { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; color:var(--dim); font-size:12px; margin-top:4px; }
    .gfixed { font-size:11px; text-align:center; }
    .ghelp summary { cursor:pointer; color:var(--dim); font-size:12px; }
    .gHide { display:none !important; }`;
  document.head.appendChild(css);
  document.title = '차트게임';

  // 위 막대: 데이터 고르기·시작 시각·봉·넘기는 단위·뒤로 가기는 숨긴다
  const bar = document.querySelector('.bar');
  const gameLink = bar.querySelector('a[href="replay.html?game"]');
  if (gameLink) { gameLink.href = 'replay.html'; gameLink.textContent = '← 차트 리플레이'; gameLink.style.background = '#262b3c'; }
  ['symbol', 'month', 'btnDir', 'fileInput', 'startAt', 'btnStart', 'tf', 'unit', 'btnBack'].forEach((id) => {
    const el = $(id); if (!el) return;
    const lab = el.closest('label'); (lab || el).classList.add('gHide');
  });
  [...bar.querySelectorAll('label')].forEach((l) => { if (['종목', '달', '시작 시각(KST)', '봉', '넘기는 단위'].includes(l.textContent.trim())) l.classList.add('gHide'); });
  [...bar.querySelectorAll('.sep')].slice(0, 2).forEach((x) => x.classList.add('gHide'));
  const title = document.createElement('b'); title.textContent = '🎮 차트게임'; title.style.cssText = 'color:#fff;font-size:14px;margin:0 6px';
  bar.insertBefore(title, bar.children[1]);
  const rule = document.createElement('span'); rule.className = 'dim';
  rule.textContent = '5분봉 · 시드 3,000 USDT · 레버리지 3배 · 격리 · 지정가 수수료 0.02% · 종목당 50턴';
  bar.appendChild(rule);
  const playTop = document.createElement('span'); playTop.id = 'gPlayTop';          // 맨 오른쪽 위: 전체 플레이타임 n.n시간
  playTop.title = '전체 플레이타임 (게임 화면을 보고 움직일 때만 셈)';
  playTop.style.cssText = 'margin-left:auto; color:#fff; font-weight:700; font-variant-numeric:tabular-nums; background:#262b3c; border:1px solid #363c4e; border-radius:12px; padding:3px 12px';
  bar.appendChild(playTop);
  $('btnStep').textContent = '▶ 다음 봉'; $('btnStep').title = 'H 또는 →';
  $('tf').value = '5'; tfSec = 300;
  $('unit').value = 'tf';
  // 레버리지·수수료 고정, 잔고 초기화 없음
  $('lev').value = LEV; $('lev').disabled = true; $('lev').title = '차트게임은 3배 고정';
  $('fee').value = FEE_PCT; $('fee').disabled = true;
  $('margin').value = DEF_MARGIN;                       // 증거금 기본 1,000 USDT
  ['startBal', 'btnResetBal', 'hideOther', 'btnClear'].forEach((id) => { const el = $(id); if (el) (el.closest('label') || el).classList.add('gHide'); });
  [...document.querySelectorAll('#side label.dim')].forEach((l) => { if (l.textContent.includes('시작 잔고')) l.classList.add('gHide'); });
  $('fee').previousElementSibling && ($('fee').previousElementSibling.textContent = '수수료 % (지정가, 고정)');
  // 아래 탭: 종목 기록 추가
  const tabs = document.querySelector('.btabs');
  const tb = document.createElement('button'); tb.className = 'bt'; tb.dataset.b = 'rounds'; tb.textContent = '종목 기록';
  tabs.insertBefore(tb, $('hideOther').closest('label'));
  const openTab = (k) => { btab = k; document.querySelectorAll('.btabs .bt').forEach((x) => x.classList.toggle('on', x.dataset.b === k)); renderBottom(); };
  tb.onclick = () => openTab('rounds');
  for (const [k, label] of [['review', '복기'], ['ach', '업적']]) {
    const b = document.createElement('button'); b.className = 'bt'; b.dataset.b = k; b.textContent = label;
    tabs.insertBefore(b, $('hideOther').closest('label')); b.onclick = () => openTab(k);
  }
  // 턴 칸 (오른쪽 맨 위)
  const turnBox = document.createElement('div'); turnBox.id = 'gTurn';
  turnBox.innerHTML = '<span class="dim">턴</span><div class="prog"><i id="gProg"></i></div><b id="gTurnTxt" class="num">-/50</b><button id="gNext">⏩ 다음종목</button>';
  $('side').insertBefore(turnBox, $('side').firstChild);
  $('gNext').onclick = () => nextCoin();
  // 결과 칸
  const res = document.createElement('div'); res.id = 'gResult'; res.innerHTML = '<div class="rc" id="gResBody"></div>';
  $('chartRow').appendChild(res);
  // ---- 오른쪽 칸을 차트게임 사진처럼: [자산] [턴] [주문: 매수(B) 다음(H) 매도(S) · 비중] [포지션] 순서
  const side = $('side');
  const mk = (tag, cls, html) => { const d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; };
  const hideEl = (el) => el && el.classList.add('gHide');
  const assetCard = mk('div', 'gcard', `<div class="gtier" id="gTier"></div><div class="ga-line"></div><div class="ga-top"><div><div class="dim">수익률 <small>(시드 3,000 대비)</small></div><div id="gRoi" class="ga-roi num">+0.00%</div></div>` +
    `<div style="text-align:right"><div class="dim">평가자산</div><div id="gEq" class="ga-eq num">-</div></div></div><div class="ga-line"></div>` +
    `<div class="row2"><span class="dim">현금 (주문 가능)</span><span id="gCash" class="num">-</span></div>` +
    `<div class="row2"><span class="dim">보유 포지션</span><span id="gHold" class="num">없음</span></div>` +
    `<div class="row2"><span class="dim">이번 종목 손익</span><span id="gRpnl" class="num">-</span></div>` +
    `<div class="row2"><span class="dim">플레이타임</span><span id="gPlay" class="num">-</span></div>`);
  turnBox.classList.add('gcard');
  const orderCard = mk('div', 'gcard gorder');
  const acts = mk('div', 'gacts');
  const holdBtn = mk('button', '', '다음 (H)'); holdBtn.id = 'gHoldBtn'; holdBtn.onclick = () => step(1);
  const longParent = $('btnLong').parentElement;
  acts.append($('btnLong'), holdBtn, $('btnShort'));
  const pcts = mk('div', 'gpcts', '<span class="dim">비중</span>' + [10, 25, 50, 100].map((p) => `<button data-gp="${p}">${p}%</button>`).join('') + '<button data-gp="me" title="증거금 칸에 직접 적기">직접</button>');
  const avail = mk('div', 'gavail dim num'); avail.id = 'gAvail';
  const typeSeg = document.querySelector('#side .tabs'); typeSeg.classList.add('gseg');
  const pxWrap = $('pxBox').parentElement, mWrap = $('margin').closest('.inbox').parentElement, sliderWrap = $('mSlider').parentElement;
  const keys = mk('div', 'gkeys', '<span><kbd>B</kbd> 매수</span><span><kbd>H</kbd> 다음</span><span><kbd>S</kbd> 매도</span><span><kbd>X</kbd> 청산</span><span><kbd>N</kbd> 다음종목</span>');
  const fixed = mk('div', 'dim gfixed', '격리 · 레버리지 3배 고정 · 수수료 지정가 0.02% · 가상 연습');
  orderCard.append(acts, pcts, avail, typeSeg, pxWrap, mWrap, $('tpslChk').closest('label'), $('roChk').closest('label'), $('tpslBox'), keys, fixed);
  const posCard = mk('div', 'gcard', '<div class="dim" style="margin-bottom:4px">포지션</div>');
  posCard.append($('pos'), $('posBtns'), $('pcBox'));
  const helpBox = mk('details', 'ghelp', '<summary>도움말</summary>');
  [...side.querySelectorAll('.help')].forEach((h) => helpBox.appendChild(h));
  helpBox.querySelector('.help').insertAdjacentHTML('afterbegin', '<b style="color:#d1d4dc">차트게임</b>: 50턴째 봉이나 [다음종목]에서 열린 포지션은 그 봉 종가로 자동 청산되고, 대기 주문은 취소돼요. 새 종목은 5초 뒤에 넘길 수 있어요. 비중 = 주문 가능 현금 중 증거금으로 쓸 비율.<br>');
  // 안 쓰는 것 숨기기: 레버리지 칩 줄, 슬라이더, 최대 수량, 자산 제목·칸, 시작 잔고 줄, 원래 버튼 줄
  hideEl(document.querySelector('#side .otop')); hideEl(sliderWrap); hideEl($('maxL').closest('.row2')); hideEl(longParent);
  hideEl($('avail').closest('.row2')); hideEl($('orderHint').closest('.row2'));
  hideEl([...side.querySelectorAll('h3')].find((h) => h.textContent.includes('자산'))); hideEl($('acct')); hideEl($('fee').parentElement);
  side.prepend(assetCard, turnBox, orderCard, posCard);
  side.appendChild(helpBox);
  let pctPick = null;
  pcts.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.gp === 'me') { pctPick = 'me'; $('margin').focus(); $('margin').select(); }
    else { pctPick = +b.dataset.gp; setMarginPct(pctPick); }
    paintPcts(); b.blur();
  });
  $('margin').addEventListener('input', () => { pctPick = 'me'; paintPcts(); });
  function paintPcts() { pcts.querySelectorAll('button').forEach((x) => x.classList.toggle('on', String(pctPick) === x.dataset.gp)); }
  // 매수·매도 버튼 이름: 리플레이 이름에 단축키 표시
  const origAcct = renderAcct;
  renderAcct = function () {
    origAcct();
    for (const [id, k] of [['btnLong', 'B'], ['btnShort', 'S']]) {
      const b = $(id); b.textContent = b.textContent.replace(/ ?\((롱|숏)\)/, '') + ` (${k})`;
    }
    renderAsset();
  };
  function renderAsset() {
    if (!G) return;
    const p = cursor >= 0 && bars.length ? curPrice() : 0;
    const u = open && p ? posPnl(open, p).net : 0, eq = acct.balance + u, roi = (eq / SEED - 1) * 100;
    $('gRoi').textContent = sgn(roi) + '%'; $('gRoi').className = 'ga-roi num ' + cls(roi);
    $('gEq').textContent = usd(eq);
    $('gCash').textContent = usd(availBal());
    $('gHold').innerHTML = open && p ? `<span class="${open.side === 'long' ? 'up' : 'down'}">${open.side === 'long' ? '롱' : '숏'} 3x</span> ${usd(open.notional)} <span class="${cls(u)}">(${sgn(u / open.margin * 100)}%)</span>` :
      pendEntry ? `<span class="dim">지정가 대기 ${fmtP(pendEntry.entry)}</span>` : '<span class="dim">없음</span>';
    const r = G.round;
    if (r && !r.done && p) r.minEq = Math.min(r.minEq ?? r.startBal, eq);
    const rp = r ? acct.balance + u - r.startBal : 0;
    $('gRpnl').innerHTML = r ? `<span class="${cls(rp)}">${usdS(rp)}</span>` : '-';
    const m = +$('margin').value || 0;
    $('gAvail').innerHTML = $('roChk').checked ? `줄일 증거금 ${usd(m)}${open ? ` · 지금 증거금 ${usd(open.margin)}` : ''}` :
      `주문 가능 ${usd(availBal())} · 이번 주문 증거금 ${usd(m)} → 크기 ${usd(m * LEV)}`;
    holdBtn.disabled = !r || r.done || starting;
    renderTier(); renderPlay();
  }
  // ------------------------------------------------------------ 티어 · 플레이타임
  function tierBlock(i, size) {
    const t = TIERS[i], nx = TIERS[i + 1], bal = acct.balance;
    const pct = nx ? Math.max(0, Math.min(100, (bal - t.min) / (nx.min - t.min) * 100)) : 100;
    return `${tierSvg(i, size)}<div style="flex:1; min-width:0"><div class="tn" style="color:${t.c1}">${t.name} <small class="dim" style="font-weight:400">${t.en}</small></div>` +
      `<div class="dim" style="font-size:11.5px">${nx ? `${nx.name} (${usd(nx.min).replace('.00', '')})까지 ${usd(nx.min - bal)} 남음` : '최고 티어'}</div>` +
      `<div class="tbar"><i style="width:${pct}%; background:${t.c1}"></i></div></div>`;
  }
  let tierDrawn = null;
  function renderTier() {
    const i = tierIndex(acct.balance), key = i + ':' + Math.round(acct.balance);
    if (G.tier == null) G.tier = i;
    if (i !== G.tier) { tierToast(i, i > G.tier); sfx(i > G.tier ? 'tierUp' : 'tierDown'); G.tier = i; }
    G.bestTier = Math.max(G.bestTier || 0, i);
    if (tierDrawn !== key) { $('gTier').innerHTML = tierBlock(i, 46); tierDrawn = key; }
  }
  const toast = document.createElement('div'); toast.id = 'gToast'; document.body.appendChild(toast);
  let toastTimer = null;
  function tierToast(i, up) {
    const t = TIERS[i];
    toast.innerHTML = `<div class="k" style="color:${up ? t.c1 : '#ef5350'}">${up ? '티어 승급' : '티어 강등'}</div>${tierSvg(i, 110)}<div class="n" style="color:${t.c1}">${t.name}</div>` +
      `<div class="dim">잔고 ${usd(acct.balance)}</div>`;
    toast.style.display = 'flex';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
  }
  toast.onclick = () => { toast.style.display = 'none'; };
  function fmtDur(ms) {
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h ? `${h}시간 ${m % 60}분` : m ? `${m}분 ${Math.floor(ms / 1000) % 60}초` : `${Math.floor(ms / 1000)}초`;
  }
  function renderPlay() {
    $('gPlayTop').textContent = `⏱ 플레이타임 ${((G.playMs || 0) / 3600000).toFixed(1)}시간`;
    if (!$('gPlay')) return;
    const r = G.round;
    $('gPlay').innerHTML = `${fmtDur(G.playMs || 0)}${r && !r.done ? ` <span class="dim">(이번 종목 ${fmtDur(r.playMs || 0)})</span>` : ''}`;
  }
  // 플레이타임: 게임 화면을 보고 있고(탭이 앞에 있음), 3분 안에 키·마우스를 움직였을 때만 센다
  const IDLE_MS = 180000;
  let lastAct = Date.now(), lastTick = Date.now(), tickN = 0;
  for (const ev of ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart']) document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true, capture: true });
  setInterval(() => {
    const now = Date.now(), dt = Math.min(2000, now - lastTick); lastTick = now;
    if (!G || document.hidden || $('gHome').style.display !== 'none' || now - lastAct > IDLE_MS) return;
    G.playMs = (G.playMs || 0) + dt;
    if (G.round && !G.round.done) G.round.playMs = (G.round.playMs || 0) + dt;
    renderPlay();
    if (++tickN % 10 === 0) saveG();
    if (tickN % 60 === 0) checkAch();
  }, 1000);
  // 시간 축: 턴 동안은 시:분만
  chart.applyOptions({ timeScale: { tickMarkFormatter: (t) => { const s = fmtKst(t - KST_OFF); return hidden() || s.slice(11) !== '00:00' ? s.slice(11) : s.slice(5, 10); } } });

  // ------------------------------------------------------------ 시작 화면
  const home = document.createElement('div'); home.id = 'gHome';
  home.innerHTML = `<a class="back" href="replay.html">← 차트 리플레이</a><div class="card">
    <div class="ico" id="gHomeIco"></div><div class="tname" id="gHomeTier"></div><div class="ten" id="gHomeTen"></div>
    <div class="kick">CHART GAME</div><h1>차트게임</h1>
    <p>거래량이 많았던 때의 주요 알트코인 30개 차트를 5분봉으로 랜덤하게 돌려 보며 직관을 키우는 연습이에요. 종목 하나에 50턴, 시드 3,000 USDT로 시작해 계속 이어집니다.</p>
    <div class="row"><span class="l">평가자산</span><span class="r num" id="gHomeEq">-</span></div>
    <div class="row"><span class="l">시드 대비</span><span class="r num" id="gHomeRoi">-</span></div>
    <div class="row"><span class="l">플레이타임</span><span class="r num" id="gHomePlay">-</span></div>
    <div class="row"><span class="l">업적</span><span class="r num" id="gHomeAch">-</span></div>
    <div class="gtier" id="gHomeNext" style="margin:4px 2px 12px; text-align:left"></div>
    <button class="go" id="gGo">게임 시작</button>
    <button class="go2" id="gDaily">📅 오늘의 차트</button>
    <div style="display:flex; gap:8px"><button class="go2" id="gHomeStats" style="background:#262b3c">📊 전적 (T)</button><button class="go2" id="gHomeKeys" style="background:#262b3c">⌨ 단축키 (?)</button></div>
    <details><summary>티어 표 보기</summary><div class="tlist" id="gTierList"></div>
      <div style="margin-top:8px; line-height:1.5">티어는 <b>잔고</b>(청산해서 확정된 금액) 기준이에요. 잔고가 줄면 티어도 내려가요. 플레이타임은 게임 화면을 보고 있고 3분 안에 키·마우스를 움직였을 때만 세요.</div></details>
    <div class="note" id="gHomeNote">초기 시드 3,000 USDT 고정 · 잔고 초기화 없음 · 레버리지 3배 · 격리</div></div>`;
  document.body.appendChild(home);

  // ------------------------------------------------------------ 데이터
  const fileCache = new Map();
  function loadFile(f) {
    if (!fileCache.has(f)) {
      fileCache.set(f, fetchText('data/' + f).then((txt) => {
        const out = [];
        const lines = txt.split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
          const r = lines[i].split(',');
          if (r.length < 6) continue;
          out.push({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], qv: r[6] ? +r[6] : 0, bv: r.length > 7 && r[7] !== '' ? +r[7] : null });
        }
        return out;
      }).catch((e) => { fileCache.delete(f); throw e; }));
      if (fileCache.size > 12) fileCache.delete(fileCache.keys().next().value);
    }
    return fileCache.get(f);
  }
  const ymOf = (ts) => { const d = new Date(ts * 1000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
  // start = 1턴 봉 시각. 앞 200봉(1턴 봉 포함) + 뒤 49봉. 빈 곳이 많으면 null
  async function buildWindow(per, start) {
    const from = start - (PRE - 1) * 300, to = start + (TURNS - 1) * 300;
    if (from < per.start || to >= per.end) return null;
    const months = [...new Set([ymOf(from), ymOf(to)])];
    if (months.some((m) => !per.files[m])) return null;
    const parts = await Promise.all(months.map((m) => loadFile(per.files[m])));
    const seen = new Set(), out = [];
    for (const a of [].concat(...parts)) if (a.t >= from && a.t <= to && !seen.has(a.t)) { seen.add(a.t); out.push({ ...a }); }
    out.sort((a, b) => a.t - b.t);
    const firstTurn = out.findIndex((a) => a.t === start);
    if (firstTurn < 0 || firstTurn < PRE - 4 || out.length - firstTurn < TURNS) return null;
    return { rows: out, firstTurn };
  }
  async function pickRound() {
    const coins = index.coins, last = G.rounds.length ? G.rounds[G.rounds.length - 1] : null;
    for (let tries = 0; tries < 50; tries++) {
      const c = coins[Math.floor(Math.random() * coins.length)];
      if (last && coins.length > 1 && c.short === last.short && tries < 40) continue;   // 같은 종목 연달아 피하기
      const spans = c.periods.map((p) => Math.max(0, (p.end - p.start) / 300 - PRE - TURNS));
      const tot = spans.reduce((s, x) => s + x, 0);
      if (tot <= 0) continue;
      let r = Math.random() * tot, k = 0;
      while (k < spans.length - 1 && r >= spans[k]) { r -= spans[k]; k++; }
      const per = c.periods[k];
      const start = per.start + (PRE - 1 + Math.floor(Math.random() * spans[k])) * 300;
      const w = await buildWindow(per, start);
      if (w) return { pick: { short: c.short, name: c.name, symbol: c.symbol, pk: k, start, sources: per.sources }, w };
    }
    throw new Error('뽑을 수 있는 차트가 없어요');
  }
  function setGamePrecision(price) { setPrecision(Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(Math.max(price, 1e-9)))))); }

  // ------------------------------------------------------------ 종목 · 턴
  function showWindow(w, r) {
    bars = w.rows;
    meta = { symbol: 'GAME', real: r.symbol, market: '차트게임', quote: 'USDT', file: 'game' };
    months = []; loadedHi = -1; pend = null;
    tfSec = 300; $('tf').value = '5';
    r.firstTurn = w.firstTurn;
    cursor = w.firstTurn + r.turn - 1;
    setGamePrecision(bars[w.firstTurn].c);
    rebuild();
    const fit = () => chart.timeScale().setVisibleLogicalRange({ from: agg.length - 120, to: agg.length + 8 });
    fit(); requestAnimationFrame(() => requestAnimationFrame(fit));
    chart.applyOptions({});
    renderInfo(); renderPos(); renderTurn();
  }
  async function startRound(daily) {
    if (starting) return;
    starting = true; stopPlay();
    const prevRound = G.round;
    $('gResult').style.display = 'none';
    renderTurn();
    try {
      if (typeof daily !== 'string') daily = null;
      const { pick, w } = daily ? await pickDaily(daily) : await pickRound();
      G.n = (G.n || 0);
      G.round = { ...pick, id: Date.now(), turn: 1, startedAt: Date.now(), startBal: acct.balance, done: false, daily };
      if (daily) { G.daily = G.daily || {}; G.daily[daily] = { started: Date.now() }; }
      open = null; pendEntry = null; reduces = [];
      $('margin').value = DEF_MARGIN; pctPick = null; paintPcts();   // 새 종목마다 증거금 기본값으로
      drawings = []; saveDrawings();                     // 그린 것은 종목마다 새로
      showWindow(w, G.round);
      // 새 종목의 현재가로 지정가 칸을 맞추고, 앞 종목 가격이 남은 칸은 비운다
      $('entryPx').value = +curPrice().toFixed(precision);
      for (const id of ['pcPx', 'tp', 'sl', 'pcAmt']) if ($(id)) $(id).value = '';
      renderAcct();
      saveG();
    } catch (e) {
      console.error(e);
      G.round = prevRound; saveG();             // 실패하면 앞 종목 상태로 되돌려 다시 누를 수 있게
      flash('차트를 불러오지 못했어요: ' + e.message, 6000);
    } finally { starting = false; renderTurn(); }
  }
  function endRound(why) {
    const r = G.round; if (!r || r.done) return;
    stopPlay();
    if (pendEntry) { setOrd(pendEntry.oid, { status: '취소', note: '종목 끝' }); pendEntry = null; }
    for (const x of reduces) setOrd(x.oid, { status: '취소', note: '종목 끝' });
    reduces = [];
    if (open) closePos(curPrice(), 'round');
    r.done = true;
    const mine = trades.filter((t) => t.round === r.id);
    G.n = (G.n || 0) + 1;
    G.rounds.push({ n: G.n, short: r.short, name: r.name, symbol: r.symbol, from: bars[r.firstTurn].t, to: bars[cursor].t, turns: r.turn,
      entries: mine.length, pnl: acct.balance - r.startBal, startCash: r.startBal, endCash: acct.balance, liq: mine.some((t) => t.liq), why,
      playMs: r.playMs || 0, tierFrom: tierIndex(r.startBal), tierTo: tierIndex(acct.balance), rid: r.id, daily: r.daily || null });
    const h = G.rounds[G.rounds.length - 1];
    try { h.review = buildReview(r); } catch (e) { console.error(e); h.review = null; }
    if (r.daily) G.daily[r.daily] = { done: true, pct: pctOf(h) * 100, entries: mine.length, cap: h.review ? h.review.avgCap : null,
      emoji: mine.map((t) => (t.liq ? '💥' : t.pnl > 0 ? '🟩' : '🟥')).join('').slice(0, 40), short: r.short };
    renderTier();
    h.ach = checkAch({ h, r, tr: mine, rv: h.review || { trades: [] } }).concat(checkAch()).map((a) => a.k);
    saveG();
    chart.applyOptions({});
    renderInfo(); renderPos(); renderTurn(); renderMarkers();
    showResult();
  }
  function showResult() {
    const h = G.rounds[G.rounds.length - 1]; if (!h) return;
    const pct = h.pnl / h.startCash * 100;
    $('gResBody').innerHTML = `<div class="dim">${h.why} · 종목 공개</div><h2>${h.name} (${h.short})</h2>` +
      `<div class="dim num">${origFmt(h.from)} ~ ${origFmt(h.to)} KST · 5분봉 · ${h.symbol}</div>` +
      `<div class="bigp num ${cls(h.pnl)}">${usdS(h.pnl)} (${sgn(pct)}%)</div>` +
      `<div class="dim">포지션 ${h.entries}번${h.liq ? ' · <span class="down">강제 청산 있음</span>' : ''} · 잔고 ${usd(h.endCash)} · 플레이 ${fmtDur(h.playMs || 0)}</div>` +
      (h.tierTo != null && h.tierTo !== h.tierFrom ? `<div style="margin-top:6px; color:${TIERS[h.tierTo].c1}; font-weight:700">${h.tierTo > h.tierFrom ? '티어 승급' : '티어 강등'}: ${TIERS[h.tierFrom].name} → ${TIERS[h.tierTo].name}</div>` : '') +
      reviewSummary(h.review) +
      ((h.ach || []).length ? `<div class="gresach">${h.ach.map((k) => { const a = ACH.find((x) => x.k === k); return a ? `<span>${a.ico} ${a.name}</span>` : ''; }).join('')}</div>` : '') +
      (h.daily ? `<div style="margin-top:8px; color:#f0b90b; font-weight:700">📅 오늘의 차트 완료</div>` : '') +
      `<div><button id="gResNext">다음종목 (N)</button> <button id="gResRev" style="background:#262b3c">복기 보기</button>` +
      (h.daily ? ` <button id="gResShare" style="background:#8a6d1a">결과 복사</button>` : !dailyState().rec ? ` <button id="gResDaily" style="background:#2b3f6b">📅 오늘의 차트</button>` : '') + `</div>`;
    $('gResult').style.display = 'flex';
    countUp($('gResBody').querySelector('.bigp'), h.pnl, (v) => `${usdS(v)} (${sgn(v / h.startCash * 100)}%)`);
    $('gResNext').onclick = () => startRound();
    $('gResRev').onclick = () => { $('gResult').style.display = 'none'; openTab('review'); };
    if ($('gResShare')) $('gResShare').onclick = () => copyDaily(h.daily);
    if ($('gResDaily')) $('gResDaily').onclick = () => startDaily();
  }
  function nextCoin() {
    if (starting) return;
    const r = G.round;
    if (r && !r.done) {
      if (Date.now() - r.startedAt < LOCK_MS) return;
      endRound(`${r.turn}턴에서 넘김`);
    }
    startRound();
  }
  function renderTurn() {
    const r = G && G.round, b = $('gNext');
    $('gTurnTxt').textContent = r ? `${r.turn}/${TURNS}` : `-/${TURNS}`;
    $('gProg').style.width = r ? (r.turn / TURNS * 100) + '%' : '0';
    $('btnStep').disabled = $('btnStep10').disabled = $('btnPlay').disabled = !r || r.done || starting;
    clearTimeout(lockTimer);
    if (!r || starting) { b.disabled = true; b.textContent = '⏩ 다음종목'; return; }
    const left = LOCK_MS - (Date.now() - r.startedAt);
    if (!r.done && left > 0) { b.disabled = true; b.textContent = `⏳ ${Math.ceil(left / 1000)}초`; lockTimer = setTimeout(renderTurn, Math.min(250, left)); }
    else { b.disabled = false; b.textContent = '⏩ 다음종목'; }
  }

  // ------------------------------------------------------------ 복기 (체스 게임 리뷰처럼: 끝난 종목을 숫자로 돌아보기)
  // 가격 기준 %. 3배 레버리지 ROE 는 대략 ×3.
  function buildReview(r) {
    const a = r.firstTurn, b = Math.min(cursor, bars.length - 1), seg = bars.slice(a, b + 1);
    const c0 = seg[0].c;
    let lo = c0, hi = c0, bestL = 0, bestS = 0;
    for (const x of seg.slice(1)) {
      bestL = Math.max(bestL, x.h / lo - 1); bestS = Math.max(bestS, 1 - x.l / hi);
      lo = Math.min(lo, x.l); hi = Math.max(hi, x.h);
    }
    const list = trades.filter((t) => t.round === r.id).map((t) => {
      const held = seg.filter((x) => x.t > t.t_in && x.t <= t.t_out);
      const long = t.side === 'long';
      let mfe = 0, mae = 0;
      for (const x of held) {
        mfe = Math.max(mfe, long ? x.h / t.entry - 1 : 1 - x.l / t.entry);
        mae = Math.min(mae, long ? x.l / t.entry - 1 : 1 - x.h / t.entry);
      }
      const res = pnlPct(t.side, t.entry, t.exit) / 100;
      return { side: t.side, t_in: t.t_in, t_out: t.t_out, entry: t.entry, exit: t.exit, res, mfe, mae, cap: mfe > 0 ? res / mfe : null,
        hold: Math.round((t.t_out - t.t_in) / 300), pnl: t.pnl, reason: t.reason, liq: t.liq };
    });
    const caps = list.filter((x) => x.cap != null && x.mfe > 0.002).map((x) => x.cap);
    return { move: seg[seg.length - 1].c / c0 - 1, bestL, bestS, trades: list, avgCap: caps.length ? caps.reduce((s, x) => s + x, 0) / caps.length : null };
  }
  const pc = (x, d = 2) => (x * 100 >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
  function reviewSummary(rv) {
    if (!rv) return '';
    return `<div class="grv"><div><span class="dim">이 구간 최대 롱 폭</span><b class="up">${pc(rv.bestL)}</b></div>` +
      `<div><span class="dim">최대 숏 폭</span><b class="down">${pc(rv.bestS)}</b></div>` +
      `<div><span class="dim">처음→끝</span><b class="${cls(rv.move)}">${pc(rv.move)}</b></div>` +
      `<div><span class="dim">평균 포착률</span><b>${rv.avgCap == null ? '-' : Math.round(rv.avgCap * 100) + '%'}</b></div></div>` +
      `<div class="dim" style="font-size:11.5px">가격 기준 % (3배 레버리지 수익률은 약 ×3) · 포착률 = 내 결과 ÷ 들고 있는 동안 가장 좋았던 지점</div>`;
  }
  function renderReviewTab(el) {
    const h = [...G.rounds].reverse().find((x) => x.review);
    if (!h) { el.innerHTML = '<div class="empty">끝난 종목이 있으면 여기서 복기할 수 있어요.</div>'; return; }
    const rv = h.review, cur = G.round && G.round.done && G.rounds[G.rounds.length - 1] === h;
    el.innerHTML = `<div style="padding:6px 12px; display:flex; gap:14px; align-items:center; flex-wrap:wrap"><b>#${h.n} ${h.name} (${h.short})</b>` +
      `<span class="dim">${origFmt(h.from)} ~ ${origFmt(h.to).slice(11)}</span>${reviewSummary(rv).replace('class="grv"', 'class="grv" style="margin:0"')}</div>` +
      (rv.trades.length ? '<table><thead><tr><th>#</th><th>방향</th><th>진입 → 청산 (KST)</th><th>보유</th><th>평단 → 청산가</th><th>결과 (가격)</th><th>가장 좋았을 때 (MFE)</th><th>가장 나빴을 때 (MAE)</th><th>포착률</th><th>실현 손익</th><th>청산 방식</th></tr></thead><tbody>' +
        rv.trades.map((t, i) => `<tr data-i="${i}" style="${cur ? 'cursor:pointer' : ''}"><td class="dim">${i + 1}</td><td>${sideTxt(t.side)}</td><td class="dim">${origFmt(t.t_in).slice(11)} → ${origFmt(t.t_out).slice(11)}</td><td>${t.hold}턴</td>` +
          `<td>${fmtN(t.entry)} → ${fmtN(t.exit)}</td><td class="${cls(t.res)}">${pc(t.res)}</td><td class="up">${pc(t.mfe)}</td><td class="down">${pc(t.mae)}</td>` +
          `<td>${t.cap == null ? '-' : Math.round(t.cap * 100) + '%'}</td><td class="${cls(t.pnl)}">${usdS(t.pnl)}</td><td class="dim">${t.liq ? '강제청산' : ({ tp: '익절', sl: '손절', reduce: '지정가', round: '종목 끝', manual: '시장가' })[t.reason] || t.reason}</td></tr>`).join('') + '</tbody></table>' +
        (cur ? '<div class="dim" style="padding:6px 12px; font-size:11.5px">줄을 누르면 차트가 그 포지션 구간으로 이동해요.</div>' : '')
        : '<div class="empty">이 종목에서는 포지션을 잡지 않았어요 (관망).</div>');
    if (cur) el.querySelectorAll('tr[data-i]').forEach((tr) => tr.onclick = () => {
      const t = rv.trades[+tr.dataset.i];
      chart.timeScale().setVisibleRange({ from: t.t_in + KST_OFF - 25 * 300, to: t.t_out + KST_OFF + 25 * 300 });
    });
  }

  // ------------------------------------------------------------ 업적 (스팀 업적처럼)
  const pctOf = (h) => h.pnl / h.startCash;
  const ACH = [
    { k: 'first', ico: '🎯', name: '첫 포지션', desc: '포지션을 잡고 청산까지 해 보기', round: (c) => c.tr.length >= 1 },
    { k: 'firstwin', ico: '💵', name: '첫 수익', desc: '수익으로 청산하기', round: (c) => c.tr.some((t) => t.pnl > 0) },
    { k: 'watch', ico: '👀', name: '관망도 실력', desc: '50턴 동안 진입 없이 종목 끝내기', round: (c) => !c.tr.length && c.h.turns >= TURNS },
    { k: 'cool', ico: '🧊', name: '30분 룰', desc: '손실 청산 뒤 30분(6턴) 이상 쉬고 다시 진입하기 (한 종목 안에서, 손실 뒤 진입이 모두 6턴 이상 뒤)', round: (c) => {
      const tr = [...c.tr].sort((a, b) => a.t_in - b.t_in); let ok = false;
      for (let i = 0; i < tr.length - 1; i++) if (tr[i].pnl < 0) { if (tr[i + 1].t_in - tr[i].t_out < 1800) return false; ok = true; }
      return ok; } },
    { k: 'patience', ico: '⏳', name: '버티기', desc: '수익 포지션을 10턴 이상 들고 수익 청산', round: (c) => c.tr.some((t) => t.pnl > 0 && t.t_out - t.t_in >= 3000) },
    { k: 'limit', ico: '🧷', name: '지정가 장인', desc: '한 종목에서 체결된 주문이 모두 지정가 (2개 이상, 종목 끝 청산 없이)', round: (c) => {
      const f = orders.filter((o) => o.round === c.h.rid && o.status === '체결'); return f.length >= 2 && f.every((o) => /지정가/.test(o.kind)); } },
    { k: 'capture', ico: '🎣', name: '꼭대기 근처', desc: '포착률 70% 이상으로 수익 청산 (들고 있는 동안 0.5% 이상 움직였을 때)', round: (c) => c.rv.trades.some((t) => t.res > 0 && t.mfe > 0.005 && t.cap >= 0.7) },
    { k: 'sniper', ico: '🔫', name: '원샷', desc: '한 종목에서 한 번만 진입해 +10% 이상', round: (c) => c.tr.length === 1 && pctOf(c.h) >= 0.1 },
    { k: 'p20', ico: '🚀', name: '로켓', desc: '한 종목 수익률 +20% 이상', round: (c) => pctOf(c.h) >= 0.2 },
    { k: 'p50', ico: '🌕', name: '달까지', desc: '한 종목 수익률 +50% 이상', round: (c) => pctOf(c.h) >= 0.5 },
    { k: 'comeback', ico: '🔄', name: '역전승', desc: '한 종목에서 평가자산 -10% 아래까지 갔다가 수익으로 끝내기', round: (c) => c.r.minEq != null && c.r.minEq <= c.h.startCash * 0.9 && c.h.pnl > 0 },
    { k: 'win3', ico: '🔥', name: '3연승', desc: '3종목 연속 수익', round: () => G.rounds.length >= 3 && G.rounds.slice(-3).every((x) => x.pnl > 0) },
    { k: 'safe10', ico: '🛡️', name: '안전 운전', desc: '강제청산 없이 10종목 연속 (포지션 1번 이상 잡은 종목만 셈)', round: () => { const t = G.rounds.filter((x) => x.entries > 0); return t.length >= 10 && t.slice(-10).every((x) => !x.liq); } },
    { k: 'r10', ico: '🥉', name: '10종목', desc: '종목 10개 끝내기', round: () => G.rounds.length >= 10 },
    { k: 'r50', ico: '🥈', name: '50종목', desc: '종목 50개 끝내기', round: () => G.rounds.length >= 50 },
    { k: 'r100', ico: '🥇', name: '100종목', desc: '종목 100개 끝내기', round: () => G.rounds.length >= 100 },
    { k: 'h1', ico: '⏱', name: '1시간', desc: '플레이타임 1시간', any: () => (G.playMs || 0) >= 3600000 },
    { k: 'h10', ico: '⌛', name: '10시간', desc: '플레이타임 10시간', any: () => (G.playMs || 0) >= 36000000 },
    { k: 'h100', ico: '🏛️', name: '100시간', desc: '플레이타임 100시간', any: () => (G.playMs || 0) >= 360000000 },
    { k: 'silver', ico: '🥈', name: '실버 달성', desc: '실버 티어 (잔고 10,000)', any: () => (G.bestTier || 0) >= 2 },
    { k: 'gold', ico: '🏅', name: '골드 달성', desc: '골드 티어 (잔고 50,000)', any: () => (G.bestTier || 0) >= 3 },
    { k: 'diamond', ico: '💎', name: '다이아 달성', desc: '다이아 티어 (잔고 500,000)', any: () => (G.bestTier || 0) >= 5 },
    { k: 'challenger', ico: '👑', name: '챌린저 달성', desc: '챌린저 티어 (잔고 10,000,000)', any: () => (G.bestTier || 0) >= 8 },
    { k: 'daily1', ico: '📅', name: '오늘의 차트', desc: '오늘의 차트 처음 끝내기', any: () => dailyDone() >= 1 },
    { k: 'daily7', ico: '🗓️', name: '오늘의 차트 7번', desc: '오늘의 차트 7번 끝내기 (날짜 상관없이)', any: () => dailyDone() >= 7 },
  ];
  const dailyDone = () => Object.values(G.daily || {}).filter((x) => x.done).length;
  const achToast = document.createElement('div'); achToast.id = 'gAchToast'; document.body.appendChild(achToast);
  function checkAch(ctx) {
    G.ach = G.ach || {};
    const got = [];
    for (const a of ACH) {
      if (G.ach[a.k]) continue;
      let ok = false;
      try { ok = ctx ? !!(a.round ? a.round(ctx) : a.any()) : !!(a.any && a.any()); } catch (e) { ok = false; }
      if (ok) { G.ach[a.k] = Date.now(); got.push(a); }
    }
    for (const a of got) {
      const d = document.createElement('div'); d.className = 'gach';
      d.innerHTML = `<span class="ai">${a.ico}</span><div><div class="dim" style="font-size:11px">업적 달성</div><b>${a.name}</b><div class="dim" style="font-size:11.5px">${a.desc}</div></div>`;
      achToast.appendChild(d); setTimeout(() => d.remove(), 5000);
    }
    if (got.length) { saveG(); setTimeout(() => sfx('ach'), 350); }
    return got;
  }
  function renderAchTab(el) {
    G.ach = G.ach || {};
    const n = ACH.filter((a) => G.ach[a.k]).length;
    el.innerHTML = `<div class="dim" style="padding:6px 12px">업적 ${n}/${ACH.length}</div><div class="glist">` +
      ACH.map((a) => `<div class="${G.ach[a.k] ? 'on' : ''}"><span class="ai">${a.ico}</span><div><b>${a.name}</b><div class="dim">${a.desc}</div>` +
        `<div class="dim" style="font-size:11px">${G.ach[a.k] ? origFmt(G.ach[a.k] / 1000).slice(0, 16) + ' 달성' : '아직'}</div></div></div>`).join('') + '</div>';
  }

  // ------------------------------------------------------------ 오늘의 차트 (Wordle 처럼: 하루 한 번, 같은 데이터면 누구나 같은 차트)
  const todayKst = () => origFmt(Math.floor(Date.now() / 1000)).slice(0, 10);
  function seeded(str) {                 // 날짜 글자 → 항상 같은 난수열
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  async function pickDaily(day) {
    const rnd = seeded('chart-game-daily:' + day), coins = [...index.coins].sort((a, b) => (a.short < b.short ? -1 : 1));
    for (let tries = 0; tries < 60; tries++) {
      const c = coins[Math.floor(rnd() * coins.length)];
      const spans = c.periods.map((p) => Math.max(0, (p.end - p.start) / 300 - PRE - TURNS));
      const tot = spans.reduce((s, x) => s + x, 0);
      const u = rnd(), v = rnd();
      if (tot <= 0) continue;
      let r = u * tot, k = 0;
      while (k < spans.length - 1 && r >= spans[k]) { r -= spans[k]; k++; }
      const per = c.periods[k];
      const start = per.start + (PRE - 1 + Math.floor(v * spans[k])) * 300;
      const w = await buildWindow(per, start);
      if (w) return { pick: { short: c.short, name: c.name, symbol: c.symbol, pk: k, start, sources: per.sources }, w };
    }
    throw new Error('오늘의 차트를 고르지 못했어요');
  }
  function dailyState() { const d = todayKst(); return { d, rec: (G.daily || {})[d] }; }
  function startDaily() {
    const { d, rec } = dailyState();
    if (rec) { if (rec.done) copyDaily(d); else flash('오늘의 차트는 이미 시작했어요. 지금 종목을 끝내면 결과를 볼 수 있어요.'); return; }
    const r = G.round;
    if (r && !r.done) {
      if (!confirm('진행 중인 종목을 지금 가격에 끝내고 오늘의 차트를 시작할까요?')) return;
      endRound(`${r.turn}턴에서 넘김`);
    }
    startRound(d);
  }
  function dailyText(d) {
    const x = G.daily[d]; if (!x || !x.done) return '';
    return `📈 차트게임 · 오늘의 차트 ${d.slice(5).replace('-', '/')}\n결과 ${x.pct >= 0 ? '+' : ''}${x.pct.toFixed(2)}% ${x.emoji || '⬜'}\n` +
      `포지션 ${x.entries}번${x.cap != null ? ` · 평균 포착률 ${Math.round(x.cap * 100)}%` : ''} · ${TIERS[tierIndex(acct.balance)].name}`;
  }
  async function copyDaily(d) {
    const t = dailyText(d); if (!t) return;
    try { await navigator.clipboard.writeText(t); flash('오늘의 차트 결과를 복사했어요. 친구에게 붙여 넣어 보내세요.', 3000); }
    catch (e) { prompt('아래 글을 복사해 보내세요', t); }
  }

  // ------------------------------------------------------------ 키
  // ------------------------------------------------------------ 효과음 (파일 없이 브라우저에서 바로 만든 짧은 소리. M 키나 🔊 버튼으로 끄고 켬)
  const SND_KEY = 'chart-game-sound';
  let sndOn = localStorage.getItem(SND_KEY) !== 'off', actx = null, lastSnd = 0;
  function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0, slide = 0) {
    const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol = 0.25) {
    const n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = vol;
    src.buffer = buf; src.connect(f).connect(g).connect(actx.destination); src.start();
  }
  const SOUNDS = {
    fill: () => { tone(1800, 0.04, 'square', 0.06); tone(1200, 0.05, 'square', 0.04, 0.03); },              // 딸깍 (체결)
    win: () => { tone(1046, 0.18, 'sine', 0.14); tone(1568, 0.35, 'sine', 0.12, 0.09); },                     // 띵 (수익 청산)
    loss: () => { tone(160, 0.22, 'sine', 0.25, 0, 0.5); },                                                  // 쿵 (손실 청산)
    liq: () => { noise(0.5, 0.35); tone(90, 0.5, 'sawtooth', 0.12, 0, 0.4); },                               // 펑 (강제청산)
    tierUp: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.09)),        // 승급
    tierDown: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.1)),
    ach: () => { tone(1318, 0.12, 'sine', 0.1); tone(1760, 0.3, 'sine', 0.1, 0.08); },                       // 업적
  };
  function sfx(name) {
    if (!sndOn || !SOUNDS[name]) return;
    const now = performance.now(); if (now - lastSnd < 40 && name === 'fill') return; lastSnd = now;
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); SOUNDS[name](); } catch (e) {}
  }
  function setSound(on) { sndOn = on; localStorage.setItem(SND_KEY, on ? 'on' : 'off'); $('gSnd').textContent = on ? '🔊' : '🔇'; $('gSnd').title = `효과음 ${on ? '켜짐' : '꺼짐'} (M)`; if (on) sfx('fill'); }
  // 소리를 낼 곳: 진입·추가 체결, 청산(전부·부분), 티어, 업적
  const baseNewPos = newPos; newPos = function (...a) { sfx('fill'); return baseNewPos(...a); };
  const baseAddFill = addFill; addFill = function (...a) { sfx('fill'); return baseAddFill(...a); };
  const basePartialAt = partialAt; partialAt = function (...a) { const x = basePartialAt(...a); sfx(x.pnl > 0 ? 'win' : 'loss'); return x; };
  const baseTradeHook = tradeHook; tradeHook = function (tr) { baseTradeHook(tr); sfx(tr.liq ? 'liq' : tr.pnl > 0 ? 'win' : 'loss'); };

  // ------------------------------------------------------------ 결과 숫자 올라가는 연출
  function countUp(el, to, fmt, ms = 900) {
    const t0 = performance.now(); let done = false;
    const fin = () => { if (!done) { done = true; el.textContent = fmt(to); } };
    (function f(now) { if (done) return; const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(f); else fin(); })(t0);
    setTimeout(fin, ms + 400);       // 화면이 가려져 있어도 마지막 값은 꼭 보이게
  }

  // ------------------------------------------------------------ 단축키 표 (? 키)
  const KEYS = [['B', '매수 (롱)'], ['S', '매도 (숏)'], ['H 또는 →', '다음 봉 (1턴)'], ['Shift + →', '10봉'], ['Space', '재생 / 멈춤'], ['N', '다음종목 (5초 뒤)'],
    ['X', '포지션 시장가 청산'], ['C', '전체 청산 (포지션 + 대기 주문 모두 취소)'], ['1 · 2 · 3 · 4', '증거금 비중 10 · 25 · 50 · 100%'], ['M', '효과음 켜기 / 끄기'],
    ['T', '전적 보기'], ['?', '이 표 열기 / 닫기'], ['Esc', '입력 칸 빠져나오기 · 창 닫기'], ['Alt + 글자', '그리기 도구']];
  const keyBox = document.createElement('div'); keyBox.id = 'gKeys'; keyBox.className = 'gmodal';
  keyBox.innerHTML = `<div class="gm"><div class="gmh"><b>⌨ 단축키</b><button data-x>닫기 (Esc)</button></div><table class="gkt">${KEYS.map(([k, v]) => `<tr><td>${k.split(' ').map((x) => /^(또는|\+|·)$/.test(x) ? `<span class="dim">${x}</span>` : `<kbd>${x}</kbd>`).join(' ')}</td><td>${v}</td></tr>`).join('')}</table>` +
    `<div class="dim" style="font-size:12px; margin-top:10px; line-height:1.6">한글 입력 상태여도 됩니다(키 자리로 알아봐요). 숫자를 적는 칸에 커서가 있으면 단축키 대신 글자가 들어가니, <kbd>Esc</kbd> 로 칸을 빠져나온 뒤 누르세요.</div></div>`;
  document.body.appendChild(keyBox);
  // ------------------------------------------------------------ 전적 (통계)
  const statBox = document.createElement('div'); statBox.id = 'gStats'; statBox.className = 'gmodal';
  document.body.appendChild(statBox);
  const openModal = (m) => { document.querySelectorAll('.gmodal').forEach((x) => { if (x !== m) x.style.display = 'none'; }); m.style.display = 'flex'; };
  const closeModals = () => { let any = false; document.querySelectorAll('.gmodal').forEach((x) => { if (x.style.display === 'flex') any = true; x.style.display = 'none'; }); return any; };
  document.querySelectorAll('.gmodal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-x')) m.style.display = 'none'; }));
  const toggleKeys = () => (keyBox.style.display === 'flex' ? keyBox.style.display = 'none' : openModal(keyBox));
  function statsOf(list) {
    const w = list.filter((t) => t.pnl > 0), l = list.filter((t) => t.pnl <= 0);
    const sw = w.reduce((s, t) => s + t.pnl, 0), sl = l.reduce((s, t) => s + t.pnl, 0);
    return { n: list.length, win: list.length ? w.length / list.length : 0, pnl: sw + sl, avgW: w.length ? sw / w.length : 0, avgL: l.length ? sl / l.length : 0,
      pf: sl < 0 ? sw / -sl : null, rr: w.length && l.length ? (sw / w.length) / (-sl / l.length) : null, exp: list.length ? (sw + sl) / list.length : 0 };
  }
  function balChart(rs) {
    const pts = [SEED].concat(rs.map((x) => x.endCash)), W = 640, H = 210, L = 64, R = 10, T = 10, B = 24;
    if (pts.length < 2) return '<div class="empty">종목을 끝내면 잔고 그래프가 그려져요.</div>';
    const lg = (v) => Math.log10(Math.max(v, 1));
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const ti = tierIndex(hi); hi = Math.max(hi, TIERS[Math.min(ti + 1, TIERS.length - 1)].min * 1.25); lo = Math.min(lo, 2500);   // 다음 티어 띠까지 보이게
    const y = (v) => T + (1 - (lg(v) - lg(lo)) / (lg(hi) - lg(lo))) * (H - T - B), x = (i) => L + i / (pts.length - 1) * (W - L - R);
    const bands = TIERS.map((t, k) => ({ t, a: Math.max(lo, k ? t.min : lo), b: Math.min(hi, TIERS[k + 1] ? TIERS[k + 1].min : hi) })).filter((z) => z.b > z.a);
    return `<svg viewBox="0 0 ${W} ${H}" class="gchart">` +
      bands.map((z) => `<rect x="${L}" y="${y(z.b)}" width="${W - L - R}" height="${y(z.a) - y(z.b)}" fill="${z.t.c1}" opacity=".07"/>` +
        `<text x="${L - 6}" y="${(y(z.a) + y(z.b)) / 2 + 4}" text-anchor="end" fill="${z.t.c1}" font-size="11">${z.t.name}</text>` +
        (z.a > lo ? `<line x1="${L}" x2="${W - R}" y1="${y(z.a)}" y2="${y(z.a)}" stroke="${z.t.c1}" stroke-opacity=".35" stroke-dasharray="3 3"/>` : '')).join('') +
      `<line x1="${L}" x2="${W - R}" y1="${y(SEED)}" y2="${y(SEED)}" stroke="#868b98" stroke-opacity=".5"/>` +
      `<polyline fill="none" stroke="#5b8def" stroke-width="2" points="${pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` +
      pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${pts.length > 60 ? 1.5 : 3}" fill="${TIERS[tierIndex(v)].c1}"><title>${i ? `#${rs[i - 1].n} ${rs[i - 1].name}` : '시작'} · 잔고 ${usd(v)}</title></circle>`).join('') +
      `<text x="${L}" y="${H - 6}" fill="#868b98" font-size="11">시작</text><text x="${W - R}" y="${H - 6}" fill="#868b98" font-size="11" text-anchor="end">${rs.length}종목</text></svg>`;
  }
  function renderStats() {
    const tr = trades.filter((t) => !(hidden() && t.round === G.round.id)), rs = G.rounds, a = statsOf(tr);   // 진행 중인 종목은 이름이 드러나지 않게 빼고 셈
    const pctS = (x) => (x * 100).toFixed(0) + '%';
    let best = 0, worst = 0, cw = 0, cl = 0;
    for (const t of tr) { if (t.pnl > 0) { cw++; cl = 0; } else { cl++; cw = 0; } best = Math.max(best, cw); worst = Math.max(worst, cl); }
    let peak = SEED, mdd = 0;
    for (const v of [SEED].concat(rs.map((x) => x.endCash))) { peak = Math.max(peak, v); mdd = Math.max(mdd, 1 - v / peak); }
    const fees = tr.reduce((s, t) => s + (t.fees || 0), 0);
    const card = (k, v, c = '') => `<div class="gsc"><div class="dim">${k}</div><b class="${c}">${v}</b></div>`;
    const sideRow = (lab, list) => { const s = statsOf(list); return `<tr><td>${lab}</td><td>${s.n}</td><td>${s.n ? pctS(s.win) : '-'}</td><td class="${cls(s.pnl)}">${usdS(s.pnl)}</td><td class="${cls(s.exp)}">${s.n ? usdS(s.exp) : '-'}</td><td>${s.rr != null ? s.rr.toFixed(2) : '-'}</td></tr>`; };
    const bySym = {};
    for (const t of tr) (bySym[t.symbol] = bySym[t.symbol] || []).push(t);
    const roundsBy = {}; for (const r of rs) roundsBy[r.symbol] = (roundsBy[r.symbol] || 0) + 1;
    const symRows = Object.entries(bySym).map(([k, v]) => ({ k, v, s: statsOf(v) })).sort((p, q) => q.s.pnl - p.s.pnl);
    const why = {}; for (const t of tr) { const k = t.liq ? '강제청산' : ({ tp: '익절가', sl: '손절가', reduce: '지정가 청산', round: '종목 끝', manual: '시장가' })[t.reason] || t.reason; why[k] = (why[k] || 0) + 1; }
    statBox.innerHTML = `<div class="gm" style="width:760px"><div class="gmh"><b>📊 전적</b><button data-x>닫기 (Esc)</button></div>` +
      `<div class="gscs">${card('끝낸 종목', rs.length)}${card('이긴 종목', rs.length ? pctS(rs.filter((x) => x.pnl > 0).length / rs.length) : '-')}${card('포지션', a.n)}${card('포지션 승률', a.n ? pctS(a.win) : '-')}` +
      `${card('평균 손익비', a.rr != null ? a.rr.toFixed(2) : '-')}${card('포지션당 기대값', a.n ? usdS(a.exp) : '-', cls(a.exp))}${card('총 실현 손익', usdS(a.pnl), cls(a.pnl))}${card('낸 수수료', usd(fees))}` +
      `${card('최다 연승 / 연패', `${best} / ${worst}`)}${card('최대 낙폭 (종목 끝 잔고)', mdd ? '-' + (mdd * 100).toFixed(1) + '%' : '0%', mdd ? 'down' : '')}${card('플레이타임', fmtDur(G.playMs || 0))}${card('업적', `${ACH.filter((x) => (G.ach || {})[x.k]).length}/${ACH.length}`)}</div>` +
      `<h4>잔고 · 티어 변화 <span class="dim" style="font-weight:400">(종목이 끝날 때 잔고, 세로는 로그 눈금)</span></h4>${balChart(rs)}` +
      `<div class="g2"><div><h4>롱 · 숏</h4><table class="gst"><tr><th></th><th>횟수</th><th>승률</th><th>손익</th><th>기대값</th><th>손익비</th></tr>${sideRow('<span class="up">롱</span>', tr.filter((t) => t.side === 'long'))}${sideRow('<span class="down">숏</span>', tr.filter((t) => t.side === 'short'))}</table>` +
      `<h4>청산 방식</h4><div class="gwhy">${Object.entries(why).sort((p, q) => q[1] - p[1]).map(([k, v]) => `<div><span>${k}</span><i style="width:${v / Math.max(1, tr.length) * 100}%"></i><b>${v}</b></div>`).join('') || '<span class="dim">아직 없음</span>'}</div></div>` +
      `<div><h4>코인별</h4><div style="max-height:260px; overflow:auto"><table class="gst"><tr><th>종목</th><th>판</th><th>포지션</th><th>승률</th><th>손익</th></tr>${symRows.map((r) => `<tr><td>${r.k.replace(/USDT$/, '')}</td><td>${roundsBy[r.k] || 0}</td><td>${r.s.n}</td><td>${pctS(r.s.win)}</td><td class="${cls(r.s.pnl)}">${usdS(r.s.pnl)}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">아직 없음</td></tr>'}</table></div></div></div>` +
      `<div class="dim" style="font-size:11.5px; margin-top:8px">손익비 = 평균 수익 ÷ 평균 손실 · 기대값 = 포지션 하나당 평균 손익 · 진행 중인 종목의 포지션은 종목 이름이 드러나지 않게 종목이 끝난 뒤에 셉니다.</div></div>`;
    statBox.querySelector('[data-x]').onclick = () => { statBox.style.display = 'none'; };
  }
  const openStats = () => { if (statBox.style.display === 'flex') { statBox.style.display = 'none'; return; } renderStats(); openModal(statBox); };
  // 위 막대에 버튼: 전적 · 단축키 · 소리
  for (const [id, txt, title, fn] of [['gStatBtn', '📊 전적', '전적 (T)', openStats], ['gKeyBtn', '⌨ 단축키', '단축키 표 (?)', toggleKeys], ['gSnd', '🔊', '효과음 (M)', () => setSound(!sndOn)]]) {
    const b = document.createElement('button'); b.id = id; b.textContent = txt; b.title = title; b.className = 'gtopb';
    b.onclick = (e) => { fn(); b.blur(); };
    bar.insertBefore(b, $('gPlayTop'));
  }
  $('gPlayTop').style.marginLeft = '0';
  $('gStatBtn').style.marginLeft = 'auto';
  setSound(sndOn); lastSnd = 0;

  // 키는 글자(e.key)가 아니라 키 자리(e.code)로 본다: 한글 입력 상태면 e.key 가 'ㅗ'·'ㅜ' 라서 예전엔 안 먹었음
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closeModals()) { e.preventDefault(); return; }
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) { e.preventDefault(); toggleKeys(); return; }
    if (e.code === 'KeyM') { e.preventDefault(); setSound(!sndOn); return; }
    if (e.code === 'KeyT') { e.preventDefault(); openStats(); return; }
    if ($('gHome').style.display !== 'none') return;
    const c = e.code;
    if (c === 'KeyH') { e.preventDefault(); step(1); }
    else if (c === 'KeyN') { e.preventDefault(); if (G.round && (G.round.done || !$('gNext').disabled)) nextCoin(); }
    else if (c === 'KeyC') { e.preventDefault(); closeAll(); }
    else if (/^(Digit|Numpad)[1-4]$/.test(c)) { e.preventDefault(); const b = pcts.querySelector(`button[data-gp="${[10, 25, 50, 100][+c.slice(-1) - 1]}"]`); if (b) b.click(); }
  }, true);
  function closeAll() {                     // 전체 청산: 포지션 시장가 청산 + 대기 주문(지정가 진입·Reduce-Only·Chase) 모두 취소
    if (!G.round || G.round.done) return;
    const n = (pendEntry ? 1 : 0) + reduces.length;
    if (pendEntry) { setOrd(pendEntry.oid, { status: '취소', note: '전체 청산' }); pendEntry = null; }
    for (const x of reduces) setOrd(x.oid, { status: '취소', note: '전체 청산' });
    reduces = [];
    if (open) closePos(); else { renderPos(); flash(n ? `대기 주문 ${n}개를 모두 취소했어요.` : '청산할 포지션이나 대기 주문이 없어요.'); }
  }

  // ------------------------------------------------------------ 시작
  loadG();
  function renderHome() {
    const roi = (acct.balance / SEED - 1) * 100;
    $('gHomeEq').textContent = usd(acct.balance);
    $('gHomeRoi').textContent = sgn(roi) + '%'; $('gHomeRoi').className = 'r num ' + cls(roi);
    $('gGo').textContent = G.round || G.rounds.length ? '게임 이어하기' : '게임 시작';
    const i = tierIndex(acct.balance), t = TIERS[i];
    $('gHomeIco').innerHTML = tierSvg(i, 118);
    $('gHomeIco').style.background = `radial-gradient(circle, ${t.c2}66 0%, #1b2030 68%, transparent 71%)`;
    $('gHomeTier').textContent = t.name; $('gHomeTier').style.color = t.c1;
    $('gHomeTen').textContent = t.en + (G.bestTier > i ? ` · 최고 ${TIERS[G.bestTier].name}` : ''); $('gHomeTen').style.color = t.c1;
    $('gHomePlay').textContent = fmtDur(G.playMs || 0);
    $('gHomeAch').textContent = `${ACH.filter((a) => (G.ach || {})[a.k]).length} / ${ACH.length}`;
    const ds = dailyState();
    $('gDaily').textContent = ds.rec ? (ds.rec.done ? `📅 오늘의 차트 완료 (${sgn(ds.rec.pct)}%) · 결과 복사` : '📅 오늘의 차트 진행 중 → [게임 이어하기]') : '📅 오늘의 차트 (하루 한 번)';
    const nx = TIERS[i + 1], pct = nx ? Math.max(0, Math.min(100, (acct.balance - t.min) / (nx.min - t.min) * 100)) : 100;
    $('gHomeNext').innerHTML = `<div style="flex:1"><div class="dim" style="font-size:12px">${nx ? `다음 티어 <b style="color:${nx.c1}">${nx.name}</b>까지 ${usd(nx.min - acct.balance)}` : '최고 티어에 도착했어요'}</div>` +
      `<div class="tbar"><i style="width:${pct}%; background:${t.c1}"></i></div></div>`;
    $('gTierList').innerHTML = TIERS.map((x, k) => `<div class="${k === i ? 'me' : ''}">${tierSvg(k, 40)}<b style="color:${x.c1}">${x.name}</b><span class="dim">${usd(Math.max(x.min, k ? x.min : SEED)).replace('.00', '')}${k ? '~' : ' 시작'}</span></div>`).join('');
  }
  renderHome();
  renderPos();
  async function enterGame() {             // 시작 화면을 닫고, 하던 종목이 있으면 다시 띄운다. 띄웠으면 true
    home.style.display = 'none';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // 차트 크기가 잡힌 뒤
    if (G.round) {
      const c = index.coins.find((x) => x.short === G.round.short);
      const w = c && c.periods[G.round.pk] ? await buildWindow(c.periods[G.round.pk], G.round.start) : null;
      if (w) { showWindow(w, G.round); return true; }
      G.round = null; open = null; pendEntry = null; reduces = [];   // 데이터가 바뀌어 같은 차트를 못 찾으면 새로
    }
    return false;
  }
  $('gGo').onclick = async () => {
    if (!index) return;
    if (await enterGame()) { if (G.round.done) showResult(); return; }
    startRound();
  };
  $('gHomeStats').onclick = () => openStats();
  $('gHomeKeys').onclick = () => toggleKeys();
  $('gDaily').onclick = async () => {
    if (!index) return;
    const ds = dailyState();
    if (ds.rec && ds.rec.done) return copyDaily(ds.d);
    if (ds.rec) return $('gGo').onclick();          // 오늘의 차트 하던 중이면 이어서
    if (await enterGame() && !G.round.done) { startDaily(); return; }
    startRound(ds.d);
  };
  (async () => {
    try { index = JSON.parse(await fetchText('data/game/index.json')); } catch (e) { index = null; }
    if (!index || !index.coins || !index.coins.length) {
      $('gGo').disabled = true; $('gDaily').disabled = true;
      $('gHomeNote').innerHTML = '차트게임 데이터가 없어요. 내 컴퓨터에서 <b>python3 fetch_game.py</b> 로 받은 뒤 로컬 서버(<b>python3 -m http.server 8765</b>)로 열어 주세요. 공개 사이트에는 차트 데이터가 없어요.';
    }
  })();
})();
