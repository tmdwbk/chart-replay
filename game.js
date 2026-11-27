// 차트게임 모드 (replay.html?game). 리플레이 화면의 주문·포지션·기록 기능을 그대로 쓰고, 그 위에 게임 규칙만 얹는다.
// - 거래량이 많았던 때의 주요 알트코인 30개 1분봉에서 랜덤으로 한 구간 (2026-11-24 5분봉 → 1분봉, 종목당 50턴 → 150턴) (data/game/, fetch_game.py 로 받음)
// - 시드 3,000 USDT 고정 · 잔고 초기화는 [↺ 시드 초기화] 버튼으로(2026-11-25) · 레버리지 3배 고정 · 격리 고정 · 실전 수수료 항상(메이커 0.02%/테이커 0.05%·펀딩·슬리피지)
// - 종목 하나에 TURNS턴(1턴 = 시작 화면, 다음 봉 하나 = 1턴), 새 종목은 5초 뒤에 넘길 수 있음
// - 턴 동안 종목 이름·날짜는 가리고, 종목이 끝나면 공개
// 가상 연습용. 실제 주문·API 키 없음.
(function () {
  if (!GAME_MODE) return;

  const SEED = 3000, TURNS = 150, PRE = 200, LOCK_MS = 5000, FEE_PCT = 0.02, LEV = 3, DEF_MARGIN = 1000;
  const BAR = 60, BAR_LABEL = '1분';      // 봉 길이(초)와 이름. 데이터(fetch_game.py)도 같은 길이여야 한다
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
  tradeHook = function (r) { r.round = G.round ? G.round.id : null; };   // 포지션 기록과 주문 기록 둘 다 여기를 지난다
  const isTrade = (r) => r && r.t_in != null && r.t_out != null;           // 포지션 기록(청산 완료)만 true. 주문 기록은 false
  stepBack = function () { flash('차트게임에서는 뒤로 갈 수 없어요.'); };
  const turnNow = () => (G.round ? cursor - G.round.firstTurn + 1 : 0);
  const origStep = step;
  step = function (n) {
    if (!G.round || G.round.done || starting) { stopPlay(); return; }
    n = Math.min(n, TURNS - turnNow());
    if (n <= 0) { stopPlay(); return; }
    origStep(n);
    G.round.turn = turnNow();
    if (G.round.turn >= TURNS) endRound(`${TURNS}턴 끝`);
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
      `<span><b>${dispSym()}</b> <span class="dim">${hidden() ? '종목·날짜는 종목이 끝나면 공개' : r.name + ' · ' + (r.sources || []).map((x) => (x === 'bybit' ? '바이비트' : x === 'gate' ? '게이트' : '바이낸스') + ' 선물').join('·') + (r.mine ? ' · 🔁 내 매매 차트' : '')}</span></span>` +
      `<span>턴 <b>${r.turn}/${TURNS}</b></span><span>지금 <b>${fmtKst(nowT())}</b> KST</span>` +
      `<span>${BAR_LABEL} 봉 시 ${fmtP(a.o)} 고 ${fmtP(a.h)} 저 ${fmtP(a.l)} 종 <b class="${cls(ch)}">${fmtP(a.c)}</b> <span class="${cls(ch)}">${sgn(ch)}%</span></span>` +
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
        `<td class="${cls(x.pnl)}">${usdS(x.pnl)}</td><td class="${cls(x.pnl)}">${sgn(x.pnl / x.startCash * 100)}%</td><td>${usd(x.endCash)}</td><td style="color:${TIERS[x.tierTo ?? tierIndex(x.endCash)].c1}">${TIERS[x.tierTo ?? tierIndex(x.endCash)].name}</td><td class="dim">${x.playMs != null ? fmtDur(x.playMs) : '-'}</td><td class="dim">${x.why || ''}</td></tr>`).join('') +
      '</tbody></table>';
  };
  const origRenderPos = renderPos;
  renderPos = function () { origRenderPos(); if (G) saveG(); };

  // ------------------------------------------------------------ 화면 바꾸기
  const css = document.createElement('style');
  css.textContent = `
    #gHome { position:fixed; inset:0; z-index:100; background:#0b0b0c; display:flex; overflow-y:auto; padding:24px 0; }
    #gHome .card { margin:auto; }
    #gHome .card { width:390px; background:linear-gradient(180deg, #1a1a1d 0%, #141416 55%); border:1px solid #2a2a2e; border-radius:28px; padding:34px 26px 26px; text-align:center; box-shadow:0 18px 40px rgba(0,0,0,.45); }
    #gHome .ico { width:140px; height:140px; margin:0 auto 14px; border-radius:50%; background:radial-gradient(circle, #2a2a2e 0%, #161618 70%, transparent 72%); display:flex; align-items:center; justify-content:center; }
    #gHome .ico svg { width:118px; height:118px; filter:drop-shadow(0 8px 16px rgba(0,0,0,.45)); }
    .temb { display:inline-block; flex:none; } .temb.tchal { animation:tchal 2.4s ease-in-out infinite; }
    @keyframes tchal { 50% { transform:scale(1.05); } }
    #gHome .kick { color:#a1a1aa; letter-spacing:.22em; font-weight:700; font-size:12px; }
    #gHome h1 { color:#fff; font-size:22px; margin:8px 0 10px; }
    #gHome p { color:#a1a1aa; line-height:1.6; margin:0 0 20px; font-size:13.5px; }
    #gHome .row { display:flex; justify-content:space-between; align-items:center; background:#1f1f22; border-radius:14px; padding:16px 20px; margin-bottom:10px; }
    #gHome .row .l { color:#8a8a93; } #gHome .row .r { color:#fff; font-size:18px; font-weight:700; }
    #gHome .go { width:100%; background:#e4e4e7; border:none; border-radius:16px; padding:17px 0; color:#0b0b0c; font-size:16px; font-weight:700; margin-top:6px; }
    #gHome .go:hover { background:#fff; } #gHome .go:disabled { opacity:.5; }
    #gHome .note { margin-top:14px; font-size:12px; color:#8a8a93; line-height:1.5; }
    #gHome .back { position:absolute; top:14px; left:16px; color:#a1a1aa; text-decoration:none; }
    #gTurn { display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:#18181b; }
    #gTurn .prog { flex:1; height:6px; background:#2a2a2e; border-radius:3px; overflow:hidden; }
    #gTurn .prog i { display:block; height:100%; width:0; background:#a1a1aa; transition:width .15s; }
    #gNext { background:#232326; border-color:#3f3f46; color:#e4e4e7; white-space:nowrap; min-width:92px; }
    #chartRow { position:relative; }
    #gResult { position:absolute; inset:0; z-index:9; display:none; align-items:center; justify-content:center; background:rgba(10,12,18,.55); }
    #gResult .rc { background:#18181b; border:1px solid #3a3a40; border-radius:14px; padding:22px 26px; min-width:340px; text-align:center; box-shadow:0 10px 30px rgba(0,0,0,.5); }
    #gResult h2 { margin:0 0 4px; color:#fff; font-size:20px; }
    #gResult .bigp { font-size:24px; font-weight:700; margin:12px 0 4px; }
    #gResult button[style] { color:#e4e4e7; }   /* 배경을 따로 준 보조 버튼은 밝은 글자 */
    #gResult button { margin-top:16px; background:#e4e4e7; border:none; color:#0b0b0c; font-weight:700; padding:10px 28px; border-radius:10px; font-size:14px; }

    #side { gap:10px; }
    :root { --botH:153px; }   /* 아래 기록 칸: 리플레이(230px)의 2/3 */
    .gcard { background:#18181b; border:1px solid var(--line); border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:6px; }
    #gTurn.gcard { flex-direction:row; }
    .gtier { display:flex; align-items:center; gap:10px; }
    .gtier .tn { color:#fff; font-weight:700; font-size:15px; letter-spacing:.02em; }
    .gtier .tbar { height:5px; background:#2a2a2e; border-radius:3px; overflow:hidden; margin-top:5px; }
    .gtier .tbar i { display:block; height:100%; width:0; border-radius:3px; }
    #gToast { position:fixed; left:50%; top:22%; transform:translateX(-50%); z-index:200; display:none; flex-direction:column; align-items:center; gap:6px;
      background:rgba(20,24,33,.96); border:1px solid #3f3f46; border-radius:18px; padding:22px 40px; box-shadow:0 18px 50px rgba(0,0,0,.6); text-align:center; }
    #gToast .k { letter-spacing:.2em; font-size:12px; font-weight:700; } #gToast .n { color:#fff; font-size:22px; font-weight:800; }
    #gHome .tname { color:#fff; font-size:17px; font-weight:800; margin:-8px 0 2px; } #gHome .ten { font-size:11px; letter-spacing:.25em; margin-bottom:14px; }
    #gHome details { text-align:left; margin-top:10px; font-size:12.5px; color:#a1a1aa; }
    #gHome details summary { cursor:pointer; color:#8a8a93; text-align:center; }
    .tlist { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin-top:8px; }
    .tlist div { display:flex; flex-direction:column; align-items:center; background:#1f1f22; border-radius:10px; padding:6px 2px; font-size:11.5px; }
    .tlist div.me { outline:1px solid #a1a1aa; }
    .grv { display:grid; grid-template-columns:repeat(5, auto); gap:4px 14px; justify-content:center; margin:12px 0 4px; }
    .grv div { display:flex; flex-direction:column; align-items:center; font-size:12px; } .grv b { font-size:15px; }
    .gresach { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:10px; }
    .gresach span { background:#232326; border:1px solid #f0b90b66; color:#ffe08a; border-radius:12px; padding:3px 10px; font-size:12px; }
    #gAchToast { position:fixed; right:18px; bottom:18px; z-index:210; display:flex; flex-direction:column; gap:8px; pointer-events:none; }
    .gach { display:flex; gap:10px; align-items:center; background:#18181b; border:1px solid #f0b90b88; border-radius:12px; padding:10px 14px; min-width:250px; max-width:330px; box-shadow:0 10px 30px rgba(0,0,0,.5); animation:gachIn .25s ease-out; }
    @keyframes gachIn { from { transform:translateY(20px); opacity:0; } to { transform:none; opacity:1; } }
    .ai { font-size:24px; width:32px; text-align:center; }
    .glist { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:6px; padding:4px 12px 12px; }
    .glist > div { display:flex; gap:8px; align-items:center; background:#18181b; border:1px solid var(--line); border-radius:8px; padding:7px 10px; font-size:12px; opacity:.45; filter:grayscale(1); }
    .glist > div.on { opacity:1; filter:none; border-color:#f0b90b66; }
    #gHome .go2 { width:100%; background:#2c2c31; border:none; border-radius:16px; padding:13px 0; color:#fff; font-size:14.5px; font-weight:700; margin-top:8px; }
    #gHome .go2:hover { background:#3a3a40; }
    .gmodal { position:fixed; inset:0; z-index:150; display:none; align-items:center; justify-content:center; background:rgba(8,10,15,.6); }
    .gm { background:#18181b; border:1px solid #3a3a40; border-radius:14px; padding:16px 20px; max-height:90vh; overflow:auto; box-shadow:0 18px 50px rgba(0,0,0,.6); max-width:94vw; }
    .gmh { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:15px; }
    .gkt td { padding:5px 10px; font-size:13px; } .gkt td:first-child { white-space:nowrap; text-align:right; }
    .gkt kbd { font-size:12px; padding:1px 6px; }
    .gtopb { background:#232326; border:1px solid #3a3a40; border-radius:12px; padding:3px 10px; }
    .gscs { display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; }
    .gsc { background:#232326; border-radius:8px; padding:7px 10px; font-size:11.5px; } .gsc b { font-size:16px; color:#fff; display:block; margin-top:2px; } .gsc b.up { color:var(--up); } .gsc b.down { color:var(--down); }
    .gm h4 { margin:14px 0 6px; font-size:13px; }
    .gchart { width:100%; height:auto; background:#0f0f11; border-radius:8px; }
    .g2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .gst { width:100%; font-size:12px; border-collapse:collapse; } .gst th { color:var(--dim); font-weight:400; text-align:left; padding:3px 6px; } .gst td { padding:4px 6px; border-top:1px solid var(--line); }
    .gwhy div { display:grid; grid-template-columns:80px 1fr 30px; align-items:center; gap:6px; font-size:12px; margin:3px 0; }
    .gwhy i { display:block; height:8px; background:#a1a1aa; border-radius:4px; min-width:2px; } .gwhy b { text-align:right; }
    #fillLayer { position:absolute; inset:0; pointer-events:none; z-index:3; overflow:hidden; }
    .fbadge { position:absolute; transform:translate(-50%, -50%); min-width:15px; height:15px; padding:0 2px; border-radius:3px; font:700 10px/15px -apple-system, sans-serif; text-align:center; color:#fff; pointer-events:auto; cursor:default; }
    .fbadge.b { background:rgba(38,166,154,.8); } .fbadge.s { background:rgba(239,83,80,.8); }   /* 글자 둘레 색: 불투명도 80% */
    .fbadge:hover { outline:2px solid #fff; z-index:2; }
    .farrow { position:absolute; width:0; height:0; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:9px solid; transform:translate(-100%, -50%); filter:drop-shadow(0 0 2px rgba(0,0,0,.8)); pointer-events:none; }
    .farrow.b { border-left-color:#26a69a; } .farrow.s { border-left-color:#ef5350; }
    #fillTip { position:absolute; z-index:6; display:none; pointer-events:none; background:#2a2a2e; border:1px solid #46464d; border-radius:6px; padding:6px 10px; font-size:12px; line-height:1.5; white-space:nowrap; box-shadow:0 6px 18px rgba(0,0,0,.5); font-variant-numeric:tabular-nums; }
    #fillTip hr { border:none; border-top:1px solid #46464d; margin:4px 0; }
    .ochip.pinfo { cursor:default; pointer-events:none; }   /* 보기만: 끌거나 누를 수 없음 */
    .grealfee { display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:12px; padding:6px 8px; border:1px solid #3a3a40; border-radius:8px; background:#1f1f22; }
    .grealfee input { accent-color:#f0b90b; flex:none; } .grealfee b { white-space:nowrap; } .grealfee span { font-size:11px; }
    #gFx { position:absolute; inset:0; pointer-events:none; z-index:8; overflow:hidden; }
    .fxPnl { position:absolute; transform:translate(-50%, -50%); text-align:center; font-variant-numeric:tabular-nums; animation:fxPop 2.1s cubic-bezier(.2,1.4,.4,1) forwards; text-shadow:0 2px 10px rgba(0,0,0,.7); white-space:nowrap; }
    .fxPnl .l { font-size:14px; font-weight:700; color:#fff; letter-spacing:.03em; }
    .fxPnl .v { font-size:34px; font-weight:900; line-height:1.1; }
    .fxPnl .r { font-size:14px; font-weight:700; opacity:.9; }
    .fxPnl.win .v, .fxPnl.win .r { color:#3ddc97; } .fxPnl.big .v, .fxPnl.big .r { color:#ffd54f; } .fxPnl.big .v { font-size:44px; }
    .fxPnl.loss .v, .fxPnl.loss .r { color:#ff6b6b; } .fxPnl.liq .v, .fxPnl.liq .r { color:#ff3b3b; } .fxPnl.liq .v { font-size:40px; }
    @keyframes fxPop { 0% { transform:translate(-50%, -50%) scale(.3); opacity:0; } 14% { transform:translate(-50%, -50%) scale(1.18); opacity:1; } 26% { transform:translate(-50%, -50%) scale(1); }
      75% { transform:translate(-50%, calc(-50% - 34px)) scale(1); opacity:1; } 100% { transform:translate(-50%, calc(-50% - 60px)) scale(.95); opacity:0; } }
    .fxBit { position:absolute; width:7px; height:11px; border-radius:2px; animation:fxBurst 1.3s cubic-bezier(.15,.8,.3,1) forwards; }
    @keyframes fxBurst { 0% { transform:translate(-50%, -50%) rotate(0); opacity:1; } 100% { transform:translate(calc(-50% + var(--dx)), calc(-50% + var(--dy) + 90px)) rotate(var(--r)); opacity:0; } }
    .fxRing { position:absolute; width:20px; height:20px; border:3px solid #3ddc97; border-radius:50%; transform:translate(-50%, -50%); animation:fxRing .8s ease-out forwards; }
    @keyframes fxRing { to { width:220px; height:220px; opacity:0; border-width:1px; } }
    .fxFlash { position:absolute; inset:0; box-shadow:inset 0 0 120px 30px rgba(239,83,80,.55); animation:fxFade .85s ease-out forwards; }
    .fxFlash.liq { background:rgba(120,0,0,.28); box-shadow:inset 0 0 160px 50px rgba(255,40,40,.8); }
    @keyframes fxFade { from { opacity:1; } to { opacity:0; } }
    #chart.fxShake { animation:fxShake .45s ease-in-out; } #chart.fxShakeHard { animation:fxShakeHard .65s ease-in-out; }
    @keyframes fxShake { 0%,100% { transform:none; } 20% { transform:translateX(-6px); } 40% { transform:translateX(6px); } 60% { transform:translateX(-4px); } 80% { transform:translateX(3px); } }
    @keyframes fxShakeHard { 0%,100% { transform:none; } 10% { transform:translate(-12px, 4px); } 25% { transform:translate(11px, -5px); } 40% { transform:translate(-9px, 3px); } 55% { transform:translate(8px, -3px); } 70% { transform:translate(-5px, 2px); } 85% { transform:translate(3px, 0); } }
    .gseries { display:flex; align-items:center; gap:4px; flex-wrap:wrap; font-size:12px; margin:2px 0; }
    .gseries b { margin-right:2px; }
    .sd { display:inline-flex; width:18px; height:18px; border-radius:50%; border:1px solid #4a4a50; background:#242427; font-style:normal; font-size:9.5px; font-weight:700; align-items:center; justify-content:center; color:#fff; }
    .sd.w { background:#1f7a4d; border-color:#3ddc97; } .sd.l { background:#8a2b2b; border-color:#ff6b6b; }
    .gach.bad { border-color:#ef535088; } .gach.go { border-color:#9a9aa2; }
    .gmine { margin-top:8px; padding:6px 10px; border:1px solid #3f3f46; border-radius:8px; background:#141416; font-size:12.5px; }
    #gStreak { font-size:12px; font-weight:800; color:#ffb74d; white-space:nowrap; }
    #chartRow.gglow { box-shadow: inset 0 0 calc(30px + 60px * var(--glow, .3)) rgba(61,220,151, calc(.15 + .45 * var(--glow, .3))); }
    #gTimer { font-weight:800; font-variant-numeric:tabular-nums; color:#e4e4e7; min-width:38px; text-align:right; }
    #gTimer.hot { color:#ff6b6b; animation:gPulse .5s ease-in-out infinite alternate; }
    @keyframes gPulse { from { transform:scale(1); } to { transform:scale(1.18); } }
    .gtopb.on { background:#3f3f46; color:#fff; border-color:#71717a; }
    #gPromoBar { position:absolute; left:50%; top:8px; transform:translateX(-50%); z-index:7; display:none; align-items:center; gap:6px; padding:5px 12px; border-radius:20px;
      background:rgba(20,10,14,.88); border:1px solid #7f1d1d; font-size:12.5px; white-space:nowrap; box-shadow:0 0 18px rgba(239,83,80,.35); }
    body.gpromo #chartRow { box-shadow: inset 0 0 90px rgba(170,40,60,.32); }
    body.gpromo .gcard { border-color:#4a2a30; }
    .fxBig { position:absolute; left:50%; top:42%; transform:translate(-50%,-50%); text-align:center; z-index:9; animation:fxBig 1.8s cubic-bezier(.2,1.3,.4,1) forwards; text-shadow:0 4px 24px rgba(0,0,0,.8); pointer-events:none; }
    .fxBig .t { font-size:72px; font-weight:900; letter-spacing:.06em; } .fxBig .s { font-size:16px; font-weight:700; color:#e4e4e7; }
    .fxBig.w .t { color:#3ddc97; } .fxBig.l .t { color:#ff5252; } .fxBig.d .t { color:#a1a1aa; }
    @keyframes fxBig { 0% { transform:translate(-50%,-50%) scale(2.2); opacity:0; } 18% { transform:translate(-50%,-50%) scale(1); opacity:1; } 80% { opacity:1; } 100% { transform:translate(-50%,-62%) scale(.96); opacity:0; } }
    .fbadge.ghost { opacity:.55; outline:1px dashed rgba(255,255,255,.7); font-size:9px; }
    .sring { display:inline-flex; border-radius:50%; padding:2px; box-shadow:0 0 0 2px var(--rc), 0 0 12px var(--rc); }
    #gDown { position:absolute; inset:0; z-index:20; display:none; align-items:center; justify-content:center; text-align:center; background:rgba(8,8,10,.92); padding:20px; }
    #gDown button { margin-top:14px; background:#e4e4e7; color:#0b0b0c; border:none; border-radius:10px; padding:10px 24px; font-weight:700; }
    #gMob { display:none; }
    @media (max-width: 900px) {
      .bar { flex-wrap:nowrap; overflow-x:auto; gap:6px; padding:6px 8px; scrollbar-width:none; }
      .bar::-webkit-scrollbar { display:none; }
      .bar > .dim, .bar label, #speed, #btnStep10, #btnPlay, #gKeyBtn { display:none !important; }
      .bar > * { white-space:nowrap; flex:none; }
      #gPlayTop { padding:3px 8px; font-size:12px; }
      #info { font-size:12px; gap:8px; padding:4px 8px; }
      #info span:last-child { display:none; }
      #tools, #drawBar, #legend { display:none !important; }
      #chartRow { height:58vh !important; min-height:300px; }
      #gMob { display:grid; grid-template-columns:1.2fr 1.1fr 1.2fr .9fr 1fr; gap:6px; position:fixed; left:0; right:0; bottom:0; z-index:60;
        padding:8px 8px calc(8px + env(safe-area-inset-bottom)); background:rgba(11,11,12,.96); border-top:1px solid #2a2a2e; }
      #gMob button { height:48px; border-radius:10px; border:1px solid #3a3a40; background:#232326; color:#e4e4e7; font-size:14px; font-weight:700; touch-action:manipulation; }
      #gMob button.b { background:#1f7a4d; border-color:#1f7a4d; color:#fff; } #gMob button.s { background:#c2454f; border-color:#c2454f; color:#fff; }
      #gMob button:disabled { opacity:.4; }
      body { padding-bottom:calc(72px + env(safe-area-inset-bottom)); }
      #gHome .card { width:calc(100vw - 24px); padding:22px 16px; }
      .gm { padding:12px; } .gscs { grid-template-columns:repeat(2, 1fr); } .g2 { grid-template-columns:1fr; }
    }
    #gDrillBar { position:absolute; left:50%; bottom:34px; transform:translateX(-50%); z-index:7; display:none; gap:8px; align-items:center; max-width:92%;
      padding:5px 12px; border-radius:16px; background:rgba(20,20,24,.92); border:1px solid #52525b; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .gdrill { margin-top:10px; padding:10px 12px; border:1px solid #3f3f46; border-radius:10px; background:#141416; text-align:left; }
    .gdrill input { background:#1f1f22; border:1px solid #3a3a40; color:#e4e4e7; border-radius:8px; padding:6px 8px; }
    .gdrill button { margin-top:0 !important; padding:6px 12px !important; font-size:12px !important; }
    .rstep { display:flex; gap:10px; padding:10px 0; border-top:1px solid #2a2a2e; }
    .rstep .rn { width:26px; height:26px; flex:none; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#232326; border:1px solid #52525b; font-weight:800; }
    .rstep.done .rn { background:#e4e4e7; color:#0b0b0c; } .rstep.done b { color:#a1a1aa; text-decoration:line-through; }
    .rstep input { background:#1f1f22; border:1px solid #3a3a40; color:#e4e4e7; border-radius:6px; padding:4px 6px; }
    .rstep button.rec { border-color:#e4e4e7; color:#fff; }
    .ga-top { display:flex; justify-content:space-between; align-items:flex-end; }
    .ga-roi { font-size:26px; font-weight:700; } .ga-eq { font-size:20px; font-weight:700; color:#fff; }
    .ga-line { border-top:1px solid var(--line); margin:6px 0 2px; }
    .gacts { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    .gacts button { height:50px; font-size:14px; font-weight:700; border-radius:8px; border:none; color:#fff; padding:0 4px; flex:none; }
    .gacts #btnLong { background:#1f7a4d; } .gacts #btnShort { background:#c2454f; } .gacts #gHoldBtn { background:#2c2c31; border:1px solid #3f3f46; }
    .gacts button:hover { filter:brightness(1.1); }
    .gacts button:disabled { opacity:.45; }
    .gpcts { display:flex; gap:6px; align-items:center; }
    .gpcts button { flex:1; padding:6px 0; background:#232326; border:1px solid #3a3a40; border-radius:6px; }
    .gpcts button.on { background:#e8eaed; color:#0b0b0c; border-color:#e8eaed; font-weight:700; }
    .gavail { font-size:12px; }
    .gseg { border:none !important; background:#232326; border-radius:8px; padding:3px; gap:3px !important; }
    .gseg .tab { flex:1; border:none !important; border-radius:6px !important; padding:6px 0 !important; font-size:13px !important; }
    .gseg .tab.on { background:#3f3f46; color:#fff; }
    .gkeys { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; color:var(--dim); font-size:12px; margin-top:4px; }
    .gfixed { font-size:11px; text-align:center; }
    .ghelp summary { cursor:pointer; color:var(--dim); font-size:12px; }
    .gHide { display:none !important; }`;
  document.head.appendChild(css);
  document.title = '차트게임';

  // 위 막대: 데이터 고르기·시작 시각·봉·넘기는 단위·뒤로 가기는 숨긴다
  const bar = document.querySelector('.bar');
  const gameLink = bar.querySelector('a[href="replay.html?game"]');
  if (gameLink) gameLink.classList.add('gHide');   // 리플레이 화면은 없앰 (2026-11-24)
  ['symbol', 'month', 'btnDir', 'fileInput', 'startAt', 'btnStart', 'tf', 'unit', 'btnBack'].forEach((id) => {
    const el = $(id); if (!el) return;
    const lab = el.closest('label'); (lab || el).classList.add('gHide');
  });
  [...bar.querySelectorAll('label')].forEach((l) => { if (['종목', '달', '시작 시각(KST)', '봉', '넘기는 단위'].includes(l.textContent.trim())) l.classList.add('gHide'); });
  [...bar.querySelectorAll('.sep')].slice(0, 2).forEach((x) => x.classList.add('gHide'));
  const title = document.createElement('b'); title.textContent = '🎮 차트게임'; title.style.cssText = 'color:#fff;font-size:14px;margin:0 6px';
  bar.insertBefore(title, bar.children[1]);
  const rule = document.createElement('span'); rule.className = 'dim';
  rule.textContent = `${BAR_LABEL}봉 · 시드 3,000 USDT · 레버리지 3배 · 격리 · 지정가 수수료 0.02% · 종목당 ${TURNS}턴`;
  bar.appendChild(rule);
  const playTop = document.createElement('span'); playTop.id = 'gPlayTop';          // 맨 오른쪽 위: 전체 플레이타임 n.n시간
  playTop.title = '전체 플레이타임 (게임 화면을 보고 움직일 때만 셈)';
  playTop.style.cssText = 'margin-left:auto; color:#fff; font-weight:700; font-variant-numeric:tabular-nums; background:#232326; border:1px solid #3a3a40; border-radius:12px; padding:3px 12px';
  bar.appendChild(playTop);
  $('btnStep').textContent = '▶ 다음 봉'; $('btnStep').title = 'H 또는 →';
  $('tf').value = String(BAR / 60); tfSec = BAR;
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
  const keys = mk('div', 'gkeys', '<span><kbd>B</kbd> 매수</span><span><kbd>H</kbd> 다음</span><span><kbd>S</kbd> 매도</span><span><kbd>X</kbd> 청산</span><span><kbd>F</kbd> 다음종목</span>');
  const fixed = mk('div', 'dim gfixed', '격리 · 레버리지 3배 고정 · 수수료 지정가 0.02% · 가상 연습');
  orderCard.append(acts, pcts, avail, typeSeg, pxWrap, mWrap, $('tpslChk').closest('label'), $('roChk').closest('label'), $('tpslBox'), keys, fixed);
  const posCard = mk('div', 'gcard', '<div class="dim" style="margin-bottom:4px">포지션</div>');
  posCard.append($('pos'), $('posBtns'), $('pcBox'));
  const helpBox = mk('details', 'ghelp', '<summary>도움말</summary>');
  [...side.querySelectorAll('.help')].forEach((h) => helpBox.appendChild(h));
  helpBox.querySelector('.help').insertAdjacentHTML('afterbegin', `<b style="color:#d4d4d8">차트게임</b>: ${TURNS}턴째 봉이나 [다음종목]에서 열린 포지션은 그 봉 종가로 자동 청산되고, 대기 주문은 취소돼요. 새 종목은 5초 뒤에 넘길 수 있어요. 비중 = 주문 가능 현금 중 증거금으로 쓸 비율.<br>`);
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
  // ------------------------------------------------------------ 티어 · 승급전 (2026-11-24 승주 결정)
  // 잔고가 다음 티어 기준을 넘으면 바로 오르지 않고 승급전: 5판 중 3승. 한 판 = 포지션 하나를 끝까지 청산한 매매.
  // 승리 = 그 매매 순손익(수수료·펀딩 포함) +10 USDT 이상, 패배 = 조금이라도 손실, 0~10 미만은 무승부(판수에 안 셈).
  // 3패면 실패 → 매매 3번 뒤 다시 도전. 승급전 중 잔고가 기준 아래로 내려가면 취소. 잔고가 지금 티어 기준 아래면 바로 강등.
  const SERIES_GAMES = 5, SERIES_WINS = 3, SERIES_WIN_USDT = 10, SERIES_COOLDOWN = 3;
  function rankNow() { if (G.rank == null) G.rank = tierIndex(acct.balance); return G.rank; }   // 처음엔 잔고로 정함(예전 기록 이어받기)
  function seriesDots(se) {
    const res = se.games.filter((g) => g !== 'D');
    let h = '';
    for (let k = 0; k < SERIES_GAMES; k++) h += `<i class="sd ${res[k] === 'W' ? 'w' : res[k] === 'L' ? 'l' : ''}">${res[k] === 'W' ? '승' : res[k] === 'L' ? '패' : ''}</i>`;
    return h;
  }
  function seriesText(se) {
    const d = se.games.filter((g) => g === 'D').length;
    return `${se.w}승 ${se.l}패${d ? ` · 무승부 ${d}` : ''} · ${SERIES_WINS}승 하면 승급`;
  }
  function tierBlock(i, size) {
    const t = TIERS[i], nx = TIERS[i + 1], bal = acct.balance, se = G.series;
    const pct = nx ? Math.max(0, Math.min(100, (bal - t.min) / (nx.min - t.min) * 100)) : 100;
    let sub;
    if (se) sub = `<div class="gseries"><b style="color:${TIERS[se.to].c1}">${TIERS[se.to].name} 승급전</b> ${seriesDots(se)}</div><div class="dim" style="font-size:11px">${seriesText(se)} · 판당 +$${SERIES_WIN_USDT} 이상이면 승리, 손실이면 패배 · 잔고 고정</div>`;
    else if (nx && bal >= nx.min && G.seriesCool > 0) sub = `<div class="dim" style="font-size:11.5px">승급전 다시 도전까지 매매 <b>${G.seriesCool}</b>번</div>`;
    else sub = `<div class="dim" style="font-size:11.5px">${nx ? `${nx.name} 승급전 (${usd(nx.min).replace('.00', '')})까지 ${usd(Math.max(0, nx.min - bal))} 남음` : '최고 티어'}</div>` +
      `<div class="tbar"><i style="width:${pct}%; background:${t.c1}"></i></div>`;
    return `${tierSvg(i, size)}<div style="flex:1; min-width:0"><div class="tn" style="color:${t.c1}">${t.name} <small class="dim" style="font-weight:400">${t.en}</small></div>${sub}</div>`;
  }
  function seriesToast(html, cls2 = '') {
    const d = document.createElement('div'); d.className = 'gach ' + cls2; d.innerHTML = html;
    achToast.appendChild(d); setTimeout(() => d.remove(), 4500);
  }
  function logSeries(result) { (G.seriesLog = G.seriesLog || []).push({ to: G.series.to, w: G.series.w, l: G.series.l, games: G.series.games.slice(), start: G.series.start, end: Date.now(), result }); }
  // tr: 방금 끝난 포지션 기록(승급전 한 판). 없으면 강등·시작만 확인
  function updateRank(tr) {
    let rank = rankNow();
    let bal = acct.balance;
    // 1. 강등: 지금 티어 기준 아래로 내려가면 바로 (승급전 중엔 잔고가 고정이라 강등 없음)
    if (!G.series && rank > 0 && bal < TIERS[rank].min) {
      while (rank > 0 && bal < TIERS[rank].min) rank--;
      if (G.series) { logSeries('cancel'); G.series = null; }
      G.rank = rank; tierToast(rank, false); sfx('tierDown'); saveG();
      return;
    }
    // 2. 승급전 한 판 (승급전이 시작되기 전에 연 포지션이 끝난 건 판으로 안 세고, 그때 잔고를 고정 기준으로)
    if (G.series && tr && G.series.bal == null) G.series.bal = acct.balance;
    else if (G.series && tr) {
      const se = G.series, res = tr.pnl >= SERIES_WIN_USDT ? 'W' : tr.pnl < 0 ? 'L' : 'D';
      // 승급전 판은 잔고에 반영하지 않는다 (2026-11-24 승주 결정): 시작할 때 잔고로 되돌린다. 기록엔 '승급전' 표시
      if (se.bal != null) { acct.balance = se.bal; bal = se.bal; tr.balance = se.bal; }
      tr.series = { to: se.to, res };
      se.games.push(res);
      try { promoFx(res, se); } catch (e) { console.error(e); }
      if (res === 'W') se.w++; else if (res === 'L') se.l++;
      if (se.w >= SERIES_WINS) {
        logSeries('win'); const to = se.to; G.series = null; G.seriesCool = 0;
        G.rank = rank = to; G.promoWins = (G.promoWins || 0) + 1; if (se.l === 0) G.promoPerfect = true;
        tierToast(to, true); sfx('tierUp');
      } else if (se.l > SERIES_GAMES - SERIES_WINS) {
        logSeries('fail'); G.series = null; G.seriesCool = SERIES_COOLDOWN;
        seriesToast(`<span class="ai">😵</span><div><div class="dim" style="font-size:11px">승급전 실패</div><b>${TIERS[se.to].name} 승급전 ${se.w}승 ${se.l}패</b><div class="dim" style="font-size:11.5px">매매 ${SERIES_COOLDOWN}번 뒤 다시 도전할 수 있어요</div></div>`, 'bad');
        sfx('tierDown');
      } else {
        const lab = res === 'W' ? ['✅', '승급전 승리', 'up'] : res === 'L' ? ['❌', '승급전 패배', 'down'] : ['➖', '무승부 (판수에 안 셈)', 'dim'];
        seriesToast(`<span class="ai">${lab[0]}</span><div><div class="dim" style="font-size:11px">${TIERS[se.to].name} 승급전</div><b class="${lab[2]}">${lab[1]} ${usdS(tr.pnl)}</b><div class="dim" style="font-size:11.5px">${seriesText(se)}</div></div>`);
      }
    } else if (tr && G.seriesCool > 0) G.seriesCool--;
    if (G.series && G.series.bal == null && !(open && !tr)) G.series.bal = acct.balance;
    // 4. 승급전 시작
    if (!G.series && rank < TIERS.length - 1 && bal >= TIERS[rank + 1].min && !(G.seriesCool > 0)) {
      G.series = { to: rank + 1, w: 0, l: 0, games: [], start: Date.now(), bal: open ? null : acct.balance };   // 포지션을 들고 있으면 그 포지션이 끝난 뒤 잔고로
      const t = TIERS[rank + 1];
      seriesToast(`<span class="ai">⚔️</span><div><div class="dim" style="font-size:11px">승급전 시작</div><b style="color:${t.c1}">${t.name} 승급전 — 5판 중 3승</b><div class="dim" style="font-size:11.5px">포지션 하나를 끝까지 청산하면 한 판. +$${SERIES_WIN_USDT} 이상이면 승리, 손실이면 패배, 그 사이는 무승부. <b>승급전 판은 잔고에 반영되지 않아요.</b></div></div>`, 'go');
      sfx('ach');
    }
    G.rank = rank;
    G.bestTier = Math.max(G.bestTier || 0, rank);
    saveG();
  }
  let tierDrawn = null;
  function renderTier() {
    updateRank(null);
    const i = rankNow(), se = G.series;
    const key = [i, Math.round(acct.balance), se && se.games.join(''), G.seriesCool].join(':');
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
    if (G.sess) G.sess.last = now;
    if (G.round && !G.round.done) G.round.playMs = (G.round.playMs || 0) + dt;
    renderPlay();
    if (++tickN % 10 === 0) saveG();
    if (tickN % 60 === 0) checkAch();
  }, 1000);
  // 시간 축: 턴 동안은 시:분만
  chart.applyOptions({ timeScale: { tickMarkFormatter: (t) => { const s = fmtKst(t - KST_OFF); return hidden() || s.slice(11) !== '00:00' ? s.slice(11) : s.slice(5, 10); } } });

  // ------------------------------------------------------------ 시작 화면
  const home = document.createElement('div'); home.id = 'gHome';
  home.innerHTML = `<div class="card">
    <div class="ico" id="gHomeIco"></div><div class="tname" id="gHomeTier"></div><div class="ten" id="gHomeTen"></div>
    <div class="kick">CHART GAME</div><h1>차트게임</h1>
    <p>거래량이 많았던 때의 주요 알트코인 30개 차트를 ${BAR_LABEL}봉으로 랜덤하게 돌려 보며 직관을 키우는 연습이에요. 종목 하나에 ${TURNS}턴, 시드 3,000 USDT로 시작해 계속 이어집니다.</p>
    <div class="row"><span class="l">총 점수</span><span class="r num" id="gHomeEq">-</span></div>
    <div class="row"><span class="l">최근 10매매 평균</span><span class="r num" id="gHomeRoi">-</span></div>
    <div class="row"><span class="l">플레이타임</span><span class="r num" id="gHomePlay">-</span></div>
    <div class="row"><span class="l">업적</span><span class="r num" id="gHomeAch">-</span></div>
    <div class="gtier" id="gHomeNext" style="margin:4px 2px 12px; text-align:left"></div>
    <button class="go" id="gGo">게임 시작</button>
    <button class="go2" id="gDaily">📅 오늘의 차트</button>
    <div style="display:flex; gap:8px"><button class="go2" id="gHomeStats" style="background:#232326">📊 전적 (T)</button><button class="go2" id="gHomeKeys" style="background:#232326">⌨ 단축키 (?)</button></div>
    <button class="go2" id="gHomeGhost" style="background:#1f1f22">👻 친구 고스트 불러오기 (오늘의 차트)</button>
    <button class="go2" id="gHomeReset" style="background:transparent; border:1px solid #3a3a40; color:#a1a1aa; font-weight:500">↺ 점수·티어 처음부터</button>
    <details><summary>티어 표 보기</summary><div class="tlist" id="gTierList"></div>
      <div style="margin-top:8px; line-height:1.5">티어는 <b>잔고</b>(청산해서 확정된 금액) 기준이에요. 잔고가 줄면 티어도 내려가요. 플레이타임은 게임 화면을 보고 있고 3분 안에 키·마우스를 움직였을 때만 세요.</div></details>
    <div class="note" id="gHomeNote">초기 시드 3,000 USDT · 레버리지 3배 · 격리</div></div>`;
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
    const from = start - (PRE - 1) * BAR, to = start + (TURNS - 1) * BAR;
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
  // ---- 내 최근 매매로 만든 판 (make_my_rounds.py 가 만든 data/game/my_index.json, 내 컴퓨터에만 있음)
  let mine = null;
  async function buildMyWindow(m) {
    const all = await loadFile(m.file);
    const rows = all.map((a) => ({ ...a })), firstTurn = rows.findIndex((a) => a.t === m.start);
    if (firstTurn < PRE - 4 || rows.length - firstTurn < TURNS) return null;
    return { rows, firstTurn };
  }
  const minePick = (m) => ({ short: m.short, name: m.name, symbol: m.symbol, pk: 'mine', start: m.start, sources: m.sources, mine: m.id });
  const mineLeft = () => (mine ? mine.rounds.filter((r) => !(G.minePlayed || []).includes(r.id)) : []);
  async function pickRound() {
    // 내 매매 판이 있으면 그것만 나온다 (모든 차트에 '그때 실전의 나' 고스트). 다 했으면 가장 덜 한 판부터 다시.
    if (mine && mine.rounds && mine.rounds.length) {
      const played = G.minePlayed || [], cnt = (id) => played.filter((x) => x === id).length;
      const last = G.round && G.round.mine;
      for (let tries = 0; tries < 6; tries++) {
        const least = Math.min(...mine.rounds.map((r) => cnt(r.id)));
        let pool = mine.rounds.filter((r) => cnt(r.id) === least && (mine.rounds.length < 2 || r.id !== last));
        if (!pool.length) pool = mine.rounds;
        const m = pool[Math.floor(Math.random() * pool.length)];
        (G.minePlayed = played).push(m.id);
        const w = await buildMyWindow(m).catch(() => null);
        if (w) return { pick: minePick(m), w };
      }
    }
    return pickCoinRound();                          // 내 매매 판이 없는 컴퓨터(친구 등)는 원래 30종목
  }
  async function pickCoinRound() {
    const coins = index.coins, last = G.rounds.length ? G.rounds[G.rounds.length - 1] : null;
    for (let tries = 0; tries < 50; tries++) {
      const c = coins[Math.floor(Math.random() * coins.length)];
      if (last && coins.length > 1 && c.short === last.short && tries < 40) continue;   // 같은 종목 연달아 피하기
      const spans = c.periods.map((p) => Math.max(0, (p.end - p.start) / BAR - PRE - TURNS));
      const tot = spans.reduce((s, x) => s + x, 0);
      if (tot <= 0) continue;
      let r = Math.random() * tot, k = 0;
      while (k < spans.length - 1 && r >= spans[k]) { r -= spans[k]; k++; }
      const per = c.periods[k];
      const start = per.start + (PRE - 1 + Math.floor(Math.random() * spans[k])) * BAR;
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
    tfSec = BAR; $('tf').value = String(BAR / 60);
    r.firstTurn = w.firstTurn;
    cursor = w.firstTurn + r.turn - 1;
    setGamePrecision(bars[w.firstTurn].c);
    rebuild();
    const fit = () => chart.timeScale().setVisibleLogicalRange({ from: agg.length - 120, to: agg.length + RIGHT_BARS });
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
      onRoundStart(G.round);
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
      if (/fetch|응답|Failed|NetworkError|load/i.test(String(e && e.message))) serverDown(); else flash('차트를 불러오지 못했어요: ' + e.message, 6000);
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
      entries: mine.length, pnl: mine.reduce((a, t) => a + (t.pnl || 0), 0),   /* 잔고를 안 쓰므로 그 종목 매매 손익 합 */ startCash: r.startBal, endCash: acct.balance, liq: mine.some((t) => t.liq), why,   // 매매 안 하고 넘기면 손익 0
      playMs: r.playMs || 0, tierFrom: r.rankStart ?? tierIndex(r.startBal), tierTo: rankNow(), rid: r.id, daily: r.daily || null, mine: r.mine || null, drill: r.drill || null,
      score: Math.round(mine.reduce((a, t) => a + ((t.score && t.score.total) || 0), 0) * 10) / 10, R: Math.round(mine.reduce((a, t) => a + ((t.score && t.score.R) || 0), 0) * 100) / 100, scoreAfter: G.score || 0 });
    const h = G.rounds[G.rounds.length - 1];
    try { h.review = buildReview(r); } catch (e) { console.error(e); h.review = null; }
    try { roundExtra(r, h); } catch (e) { console.error(e); }
    if (r.daily) G.daily[r.daily] = { done: true, pct: pctOf(h) * 100, entries: mine.length, cap: h.review ? h.review.avgCap : null,
      emoji: mine.map((t) => (t.liq ? '💥' : t.pnl > 0 ? '🟩' : '🟥')).join('').slice(0, 40), short: r.short, ghost: myFillsCode(r) };
    renderTier();
    h.ach = checkAch({ h, r, tr: mine, rv: h.review || { trades: [] } }).concat(checkAch()).map((a) => a.k);
    saveG();
    chart.applyOptions({});
    renderInfo(); renderPos(); renderTurn(); renderMarkers();
    showResult();
  }
  function mineLine(h) {                    // 내 매매로 만든 판이면, 그때 실제로 한 매매를 보여 준다
    const m = h.mine && mine && mine.rounds.find((x) => x.id === h.mine);
    if (!m || !m.trade) return '';
    const t = m.trade, long = t.side === 'long', hm = (s) => origFmt(s).slice(11);
    return `<div class="gmine">🔁 <b>그때 실제 내 매매</b> <span class="${long ? 'up' : 'down'}">${long ? '롱' : '숏'}</span> ${hm(t.open)}${t.entry ? ` @${fmtP(t.entry)}` : ''} → ${hm(t.close)}${t.exit ? ` @${fmtP(t.exit)}` : ''} · 손익 <b class="${cls(t.pnl)}">${usdS(t.pnl)}</b></div>`;
  }
  function showResult() {
    const h = G.rounds[G.rounds.length - 1]; if (!h) return;
    const pct = h.pnl / h.startCash * 100;
    $('gResBody').innerHTML = `<div class="dim">${h.why} · 종목 공개</div><h2>${h.name} (${h.short})</h2>` +
      `<div class="dim num">${origFmt(h.from)} ~ ${origFmt(h.to)} KST · ${BAR_LABEL}봉 · ${h.symbol}</div>` +
      `<div class="bigp num ${cls(h.score || 0)}">${(h.score || 0) > 0 ? '+' : ''}${(h.score || 0).toFixed(1)}점</div>` +
      `<div class="dim">손익 <span class="${cls(h.pnl)}">${h.R != null ? (h.R > 0 ? '+' : '') + h.R.toFixed(2) + 'R · ' : ''}${usdS(h.pnl)} (${sgn(pct)}%)</span> · 포지션 ${h.entries}번${h.liq ? ' · <span class="down">강제 청산 있음</span>' : ''} · 총 점수 ${(h.scoreAfter || 0).toFixed(1)} · 플레이 ${fmtDur(h.playMs || 0)}</div>` +
      (h.tierTo != null && h.tierTo !== h.tierFrom ? `<div style="margin-top:6px; color:${TIERS[h.tierTo].c1}; font-weight:700">${h.tierTo > h.tierFrom ? '티어 승급' : '티어 강등'}: ${TIERS[h.tierFrom].name} → ${TIERS[h.tierTo].name}</div>` : '') +
      reviewSummary(h.review) +
      ((h.ach || []).length ? `<div class="gresach">${h.ach.map((k) => { const a = ACH.find((x) => x.k === k); return a ? `<span>${a.ico} ${a.name}</span>` : ''; }).join('')}</div>` : '') +
      (h.daily ? `<div style="margin-top:8px; color:#f0b90b; font-weight:700">📅 오늘의 차트 완료</div>` : '') +
      mineLine(h) +
      `<div><button id="gResNext">다음종목 (F)</button> <button id="gResRev" style="background:#232326">복기 보기</button>` +
      (h.daily ? ` <button id="gResShare" style="background:#8a6d1a">결과 복사</button> <button id="gResGhost" style="background:#232326">👻 친구 고스트</button>` : !dailyState().rec ? ` <button id="gResDaily" style="background:#2c2c31">📅 오늘의 차트</button>` : '') + `</div>`;
    $('gResult').style.display = 'flex';
    countUp($('gResBody').querySelector('.bigp'), h.score || 0, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}점`);
    $('gResNext').onclick = () => startRound();
    $('gResRev').onclick = () => { $('gResult').style.display = 'none'; openTab('review'); };
    if ($('gResShare')) $('gResShare').onclick = () => copyDaily(h.daily);
    if ($('gResGhost')) $('gResGhost').onclick = () => importGhost();
    if ($('gResDaily')) $('gResDaily').onclick = () => startDaily();
  }
  function nextCoin() {
    if (starting) return;
    const r = G.round;
    if (r && !r.done) {
      if (Date.now() - r.startedAt < LOCK_MS) return;
      endRound(`${r.turn}턴에서 넘김`);           // 넘겨도 바로 다음 종목으로 가지 않고 결과(종목 공개·수익률)를 먼저 보여 준다 (2026-11-27)
      return;                                      // 결과 화면에서 F 를 한 번 더 누르거나 [다음종목] 을 누르면 넘어감
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
  const POST_N = 30, GIVEBACK_MFE = 0.01;   // 청산 뒤 30봉(1분봉 = 30분)   // 청산 뒤 몇 턴을 볼지 · '한때 수익'으로 칠 폭(가격 +1%)
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
      // 청산 뒤 10턴: 같은 방향으로 더 간 폭(크면 일찍 판 것) · 반대로 간 폭(크면 잘 나온 것). 종목 끝까지 남은 봉이 적으면 그만큼만
      const after = seg.filter((x) => x.t > t.t_out).slice(0, POST_N);
      let postFav = 0, postAdv = 0;
      for (const x of after) {
        postFav = Math.max(postFav, t.side === 'long' ? x.h / t.exit - 1 : 1 - x.l / t.exit);
        postAdv = Math.max(postAdv, t.side === 'long' ? 1 - x.l / t.exit : x.h / t.exit - 1);
      }
      const long = t.side === 'long';
      let mfe = 0, mae = 0;
      for (const x of held) {
        mfe = Math.max(mfe, long ? x.h / t.entry - 1 : 1 - x.l / t.entry);
        mae = Math.min(mae, long ? x.l / t.entry - 1 : 1 - x.h / t.entry);
      }
      const res = pnlPct(t.side, t.entry, t.exit) / 100;
      const giveback = mfe >= GIVEBACK_MFE && t.pnl < 0;              // 수익→손실 전환: 한때 +1% 이상 갔는데 손실로 끝남
      const post = after.length ? { fav: r4(postFav), adv: r4(postAdv), n: after.length } : null;
      if (t.x) { t.x.post = post; t.x.giveback = giveback; }            // 내보내기·전적에도 쓰도록 포지션 기록에 붙인다
      return { side: t.side, t_in: t.t_in, t_out: t.t_out, entry: t.entry, exit: t.exit, res, mfe, mae, cap: mfe > 0 ? res / mfe : null,
        hold: Math.round((t.t_out - t.t_in) / BAR), pnl: t.pnl, reason: t.reason, liq: t.liq, post, giveback };
    });
    const caps = list.filter((x) => x.cap != null && x.mfe > 0.002).map((x) => x.cap);
    const reached = list.filter((x) => x.mfe >= GIVEBACK_MFE);
    return { move: seg[seg.length - 1].c / c0 - 1, bestL, bestS, trades: list, avgCap: caps.length ? caps.reduce((s, x) => s + x, 0) / caps.length : null,
      giveback: list.filter((x) => x.giveback).length, reached: reached.length };
  }
  const pc = (x, d = 2) => (x * 100 >= 0 ? '+' : '') + (x * 100).toFixed(d) + '%';
  function reviewSummary(rv) {
    if (!rv) return '';
    return `<div class="grv"><div><span class="dim">이 구간 최대 롱 폭</span><b class="up">${pc(rv.bestL)}</b></div>` +
      `<div><span class="dim">최대 숏 폭</span><b class="down">${pc(rv.bestS)}</b></div>` +
      `<div><span class="dim">처음→끝</span><b class="${cls(rv.move)}">${pc(rv.move)}</b></div>` +
      `<div><span class="dim">평균 포착률</span><b>${rv.avgCap == null ? '-' : Math.round(rv.avgCap * 100) + '%'}</b></div>` +
      (rv.reached != null ? `<div><span class="dim">수익→손실</span><b class="${rv.giveback ? 'down' : ''}">${rv.reached ? `${rv.giveback}/${rv.reached}` : '-'}</b></div>` : '') + `</div>` +
      `<div class="dim" style="font-size:11.5px">가격 기준 % (3배 레버리지 수익률은 약 ×3) · 포착률 = 내 결과 ÷ 들고 있는 동안 가장 좋았던 지점 · 수익→손실 = 한때 +1% 이상 갔다가 손실로 끝난 포지션 / +1% 이상 갔던 포지션</div>`;
  }
  function renderReviewTab(el) {
    const h = [...G.rounds].reverse().find((x) => x.review);
    if (!h) { el.innerHTML = '<div class="empty">끝난 종목이 있으면 여기서 복기할 수 있어요.</div>'; return; }
    const rv = h.review, cur = G.round && G.round.done && G.rounds[G.rounds.length - 1] === h;
    el.innerHTML = `<div style="padding:6px 12px; display:flex; gap:14px; align-items:center; flex-wrap:wrap"><b>#${h.n} ${h.name} (${h.short})</b>` +
      `<span class="dim">${origFmt(h.from)} ~ ${origFmt(h.to).slice(11)}</span>${reviewSummary(rv).replace('class="grv"', 'class="grv" style="margin:0"')}</div>` +
      (rv.trades.length ? '<table><thead><tr><th>#</th><th>방향</th><th>진입 → 청산 (KST)</th><th>보유</th><th>평단 → 청산가</th><th>결과 (가격)</th><th>가장 좋았을 때 (MFE)</th><th>가장 나빴을 때 (MAE)</th><th>포착률</th><th title="청산 뒤 10턴 동안 같은 방향으로 더 간 폭 (크면 일찍 판 것)">청산 뒤 더 간 폭</th><th title="청산 뒤 10턴 동안 반대로 간 폭 (크면 잘 나온 것)">청산 뒤 반대 폭</th><th>실현 손익</th><th>청산 방식</th></tr></thead><tbody>' +
        rv.trades.map((t, i) => `<tr data-i="${i}" style="${cur ? 'cursor:pointer' : ''}"><td class="dim">${i + 1}</td><td>${sideTxt(t.side)}</td><td class="dim">${origFmt(t.t_in).slice(11)} → ${origFmt(t.t_out).slice(11)}</td><td>${t.hold}턴</td>` +
          `<td>${fmtN(t.entry)} → ${fmtN(t.exit)}</td><td class="${cls(t.res)}">${pc(t.res)}</td><td class="up">${pc(t.mfe)}</td><td class="down">${pc(t.mae)}</td>` +
          `<td>${t.cap == null ? '-' : Math.round(t.cap * 100) + '%'}${t.giveback ? ' <span class="tag" style="color:#ef5350">수익→손실</span>' : ''}</td>` +
          `<td>${t.post ? `<span class="${t.post.fav > Math.max(0, t.res) ? 'up' : 'dim'}">+${(t.post.fav * 100).toFixed(2)}%</span>${t.post.n < POST_N ? ` <span class="dim">(${t.post.n}턴)</span>` : ''}` : '<span class="dim">-</span>'}</td>` +
          `<td>${t.post ? `<span class="dim">${(t.post.adv * 100).toFixed(2)}%</span>` : '<span class="dim">-</span>'}</td><td class="${cls(t.pnl)}">${usdS(t.pnl)}</td><td class="dim">${t.liq ? '강제청산' : ({ tp: '익절', sl: '손절', reduce: '지정가', round: '종목 끝', manual: '시장가' })[t.reason] || t.reason}</td></tr>`).join('') + '</tbody></table>' +
        (cur ? '<div class="dim" style="padding:6px 12px; font-size:11.5px">줄을 누르면 차트가 그 포지션 구간으로 이동해요.</div>' : '')
        : '<div class="empty">이 종목에서는 포지션을 잡지 않았어요 (관망).</div>');
    if (cur) el.querySelectorAll('tr[data-i]').forEach((tr) => tr.onclick = () => {
      const t = rv.trades[+tr.dataset.i];
      chart.timeScale().setVisibleRange({ from: t.t_in + KST_OFF - 40 * BAR, to: t.t_out + KST_OFF + 40 * BAR });
    });
  }

  // ------------------------------------------------------------ 업적 (스팀 업적처럼)
  const pctOf = (h) => h.pnl / h.startCash;
  const ACH = [
    { k: 'first', ico: '🎯', name: '첫 포지션', desc: '포지션을 잡고 청산까지 해 보기', round: (c) => c.tr.length >= 1 },
    { k: 'firstwin', ico: '💵', name: '첫 수익', desc: '수익으로 청산하기', round: (c) => c.tr.some((t) => t.pnl > 0) },
    { k: 'watch', ico: '👀', name: '관망도 실력', desc: `${TURNS}턴 동안 진입 없이 종목 끝내기`, round: (c) => !c.tr.length && c.h.turns >= TURNS },
    { k: 'cool', ico: '🧊', name: '30분 룰', desc: '손실 청산 뒤 30분 이상 쉬고 다시 진입하기 (한 종목 안에서, 손실 뒤 진입이 모두 30분 이상 뒤)', round: (c) => {
      const tr = [...c.tr].sort((a, b) => a.t_in - b.t_in); let ok = false;
      for (let i = 0; i < tr.length - 1; i++) if (tr[i].pnl < 0) { if (tr[i + 1].t_in - tr[i].t_out < 1800) return false; ok = true; }
      return ok; } },
    { k: 'patience', ico: '⏳', name: '버티기', desc: '수익 포지션을 30분 이상 들고 수익 청산', round: (c) => c.tr.some((t) => t.pnl > 0 && t.t_out - t.t_in >= 1800) },
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
    { k: 'silver', ico: '🥈', name: '실버 달성', desc: '실버 티어 승급', any: () => (G.bestTier || 0) >= 2 },
    { k: 'gold', ico: '🏅', name: '골드 달성', desc: '골드 티어 승급', any: () => (G.bestTier || 0) >= 3 },
    { k: 'diamond', ico: '💎', name: '다이아 달성', desc: '다이아 티어 승급', any: () => (G.bestTier || 0) >= 5 },
    { k: 'challenger', ico: '👑', name: '챌린저 달성', desc: '챌린저 티어 승급', any: () => (G.bestTier || 0) >= 8 },
    { k: 'promo1', ico: '⚔️', name: '첫 승급', desc: '승급전 처음 통과하기', any: () => (G.promoWins || 0) >= 1 },
    { k: 'promoPerfect', ico: '🧹', name: '무패 승급', desc: '승급전을 한 판도 지지 않고 통과', any: () => !!G.promoPerfect },
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
    if (mine && mine.rounds && mine.rounds.length) {      // 내 매매 판이 있으면 그중 하나 (날짜로 정해짐)
      const rr = seeded('chart-game-daily-mine:' + day), list = [...mine.rounds].sort((a, b) => (a.id < b.id ? -1 : 1));
      for (let tries = 0; tries < list.length; tries++) {
        const m = list[Math.floor(rr() * list.length)], w = await buildMyWindow(m).catch(() => null);
        if (w) return { pick: minePick(m), w };
      }
    }
    const rnd = seeded('chart-game-daily:' + day), coins = [...index.coins].sort((a, b) => (a.short < b.short ? -1 : 1));
    for (let tries = 0; tries < 60; tries++) {
      const c = coins[Math.floor(rnd() * coins.length)];
      const spans = c.periods.map((p) => Math.max(0, (p.end - p.start) / BAR - PRE - TURNS));
      const tot = spans.reduce((s, x) => s + x, 0);
      const u = rnd(), v = rnd();
      if (tot <= 0) continue;
      let r = u * tot, k = 0;
      while (k < spans.length - 1 && r >= spans[k]) { r -= spans[k]; k++; }
      const per = c.periods[k];
      const start = per.start + (PRE - 1 + Math.floor(v * spans[k])) * BAR;
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
      `포지션 ${x.entries}번${x.cap != null ? ` · 평균 포착률 ${Math.round(x.cap * 100)}%` : ''} · ${TIERS[rankNow()].name}` +
      (x.ghost ? `\n👻 고스트 코드 (차트게임에서 [👻 친구 고스트]에 붙여 넣기): ${x.ghost}` : '');
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
    fill: () => { tone(1800, 0.04, 'square', 0.06); tone(1200, 0.05, 'square', 0.04, 0.03); },              // 딸깍 (체결) — 2026-11-25 원래 소리로 되돌림
    win: () => { tone(1046, 0.18, 'sine', 0.14); tone(1568, 0.35, 'sine', 0.12, 0.09); },                     // 띵 (수익 청산)
    loss: () => { tone(160, 0.22, 'sine', 0.25, 0, 0.5); },                                                  // 쿵 (손실 청산)
    liq: () => { noise(0.5, 0.35); tone(90, 0.5, 'sawtooth', 0.12, 0, 0.4); },                               // 펑 (강제청산)
    tierUp: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.09)),        // 승급
    tierDown: () => [392, 330, 262].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, i * 0.1)),
    ach: () => { tone(1318, 0.12, 'sine', 0.1); tone(1760, 0.3, 'sine', 0.1, 0.08); },                       // 업적
  };
  // 내 소리 파일로 바꾸기: data/sounds/<이름>.mp3·wav·ogg·m4a (fill 체결, win 수익, loss 손실, liq 강제청산, tierUp, tierDown, ach)
  // data/ 는 GitHub 에 올라가지 않아 이 컴퓨터에서만 들린다.
  const SND_FILE = {};
  (async () => {
    for (const n of Object.keys(SOUNDS)) for (const ext of ['mp3', 'wav', 'ogg', 'm4a']) {
      try { const r = await fetch(`data/sounds/${n}.${ext}`, { method: 'HEAD', cache: 'no-store' }); if (r.ok) { SND_FILE[n] = new Audio(`data/sounds/${n}.${ext}`); break; } } catch (e) {}
    }
  })();
  function sfx(name) {
    if (!sndOn || !SOUNDS[name]) return;
    const now = performance.now(); if (now - lastSnd < 40 && name === 'fill') return; lastSnd = now;
    if (SND_FILE[name]) { try { const a = SND_FILE[name].cloneNode(); a.volume = 0.8; a.play().catch(() => {}); } catch (e) {} return; }
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); SOUNDS[name](); } catch (e) {}
  }
  function setSound(on) { sndOn = on; localStorage.setItem(SND_KEY, on ? 'on' : 'off'); $('gSnd').textContent = on ? '🔊' : '🔇'; $('gSnd').title = `효과음 ${on ? '켜짐' : '꺼짐'} (M)`; if (on) sfx('fill'); }
  // 소리를 낼 곳: 진입·추가 체결, 청산(전부·부분), 티어, 업적
  const baseNewPos = newPos; newPos = function (...a) { sfx('fill'); return baseNewPos(...a); };
  const baseAddFill = addFill; addFill = function (...a) { sfx('fill'); return baseAddFill(...a); };
  const basePartialAt = partialAt; partialAt = function (...a) { const x = basePartialAt(...a); sfx(x.pnl > 0 ? 'win' : 'loss'); return x; };
  const baseTradeHook = tradeHook; tradeHook = function (tr) { baseTradeHook(tr); if (isTrade(tr) && tr.reason !== 'round') sfx(tr.liq ? 'liq' : tr.pnl > 0 ? 'win' : 'loss'); };   // 종목 끝 자동 청산은 소리 없음

  // ------------------------------------------------------------ 결과 숫자 올라가는 연출
  function countUp(el, to, fmt, ms = 900) {
    const t0 = performance.now(); let done = false;
    const fin = () => { if (!done) { done = true; el.textContent = fmt(to); } };
    (function f(now) { if (done) return; const k = Math.max(0, Math.min(1, (now - t0) / ms)), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(to * e); if (k < 1) requestAnimationFrame(f); else fin(); })(t0);
    setTimeout(fin, ms + 400);       // 화면이 가려져 있어도 마지막 값은 꼭 보이게
  }

  // ------------------------------------------------------------ 단축키 표 (? 키)
  const KEYS = [['B', '매수 (롱)'], ['S', '매도 (숏)'], ['H 또는 →', '다음 봉 (1턴)'], ['Shift + →', '10봉'], ['Space', '재생 / 멈춤'], ['F', '다음종목 (5초 뒤)'],
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
  function scoreChart() {                    // 총 점수 추이 + 티어 띠 (선형)
    const pts = [0].concat((G.scoreLog || []).map((l) => l.after)), W = 640, H = 210, L = 64, R = 10, T = 10, B = 24;
    if (pts.length < 2) return '<div class="empty">매매를 끝내면 점수 그래프가 그려져요.</div>';
    const ti = tierIndex(Math.max(...pts)), hi = Math.max(...pts, TIERS[Math.min(ti + 1, TIERS.length - 1)].min * 1.1), lo = Math.min(0, ...pts);
    const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B), x = (i) => L + i / (pts.length - 1) * (W - L - R);
    const bands = TIERS.map((t, k) => ({ t, a: Math.max(lo, t.min), b: Math.min(hi, TIERS[k + 1] ? TIERS[k + 1].min : hi) })).filter((z) => z.b > z.a);
    return `<svg viewBox="0 0 ${W} ${H}" class="gchart">` +
      bands.map((z) => `<rect x="${L}" y="${y(z.b)}" width="${W - L - R}" height="${y(z.a) - y(z.b)}" fill="${z.t.c1}" opacity=".07"/><text x="${L - 6}" y="${(y(z.a) + y(z.b)) / 2 + 4}" text-anchor="end" fill="${z.t.c1}" font-size="11">${z.t.name}</text>`).join('') +
      `<polyline fill="none" stroke="#e4e4e7" stroke-width="2" points="${pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` +
      `<text x="${L}" y="${H - 6}" fill="#868b98" font-size="11">시작</text><text x="${W - R}" y="${H - 6}" fill="#868b98" font-size="11" text-anchor="end">${pts.length - 1}매매 · ${pts[pts.length - 1].toFixed(1)}점</text></svg>`;
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
      `<line x1="${L}" x2="${W - R}" y1="${y(SEED)}" y2="${y(SEED)}" stroke="#8a8a93" stroke-opacity=".5"/>` +
      `<polyline fill="none" stroke="#a1a1aa" stroke-width="2" points="${pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>` +
      pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${pts.length > 60 ? 1.5 : 3}" fill="${TIERS[tierIndex(v)].c1}"><title>${i ? `#${rs[i - 1].n} ${rs[i - 1].name}` : '시작'} · 잔고 ${usd(v)}</title></circle>`).join('') +
      `<text x="${L}" y="${H - 6}" fill="#8a8a93" font-size="11">시작</text><text x="${W - R}" y="${H - 6}" fill="#8a8a93" font-size="11" text-anchor="end">${rs.length}종목</text></svg>`;
  }
  function renderStats() {
    const tr = trades.filter((t) => !(hidden() && t.round === G.round.id)), rs = G.rounds, a = statsOf(tr);   // 진행 중인 종목은 이름이 드러나지 않게 빼고 셈
    const pctS = (x) => (x * 100).toFixed(0) + '%';
    let best = 0, worst = 0, cw = 0, cl = 0;
    for (const t of tr) { if (t.pnl > 0) { cw++; cl = 0; } else { cl++; cw = 0; } best = Math.max(best, cw); worst = Math.max(worst, cl); }
    let peak = SEED, mdd = 0;
    for (const v of [SEED].concat(rs.map((x) => x.endCash))) { peak = Math.max(peak, v); mdd = Math.max(mdd, 1 - v / peak); }
    const fees = tr.reduce((s, t) => s + (t.fees || 0), 0);
    // 청산 습관 (2026-11-20 이후 기록된 포지션만: 포착률·청산 뒤 움직임·수익→손실)
    const xs = tr.filter((t) => t.x && t.x.mfe != null), wins = xs.filter((t) => t.pnl > 0);
    const avg = (arr) => (arr.length ? arr.reduce((p, q) => p + q, 0) / arr.length : null);
    const reached = xs.filter((t) => t.x.mfe >= GIVEBACK_MFE), gb = reached.filter((t) => t.pnl < 0);
    const wPost = wins.filter((t) => t.x.post);
    const hab = { cap: avg(wins.filter((t) => t.x.cap != null).map((t) => t.x.cap)), gb: reached.length ? gb.length / reached.length : null, gbN: `${gb.length}/${reached.length}`,
      postFav: avg(wPost.map((t) => t.x.post.fav)), early: wPost.length ? wPost.filter((t) => t.x.post.fav > t.x.res).length / wPost.length : null, n: xs.length };
    const pf = (v) => (v == null ? '-' : (v * 100).toFixed(0) + '%');
    const card = (k, v, c = '') => `<div class="gsc"><div class="dim">${k}</div><b class="${c}">${v}</b></div>`;
    const sideRow = (lab, list) => { const s = statsOf(list); return `<tr><td>${lab}</td><td>${s.n}</td><td>${s.n ? pctS(s.win) : '-'}</td><td class="${cls(s.pnl)}">${usdS(s.pnl)}</td><td class="${cls(s.exp)}">${s.n ? usdS(s.exp) : '-'}</td><td>${s.rr != null ? s.rr.toFixed(2) : '-'}</td></tr>`; };
    const bySym = {};
    for (const t of tr) (bySym[t.symbol] = bySym[t.symbol] || []).push(t);
    const roundsBy = {}; for (const r of rs) roundsBy[r.symbol] = (roundsBy[r.symbol] || 0) + 1;
    const symRows = Object.entries(bySym).map(([k, v]) => ({ k, v, s: statsOf(v) })).sort((p, q) => q.s.pnl - p.s.pnl);
    const why = {}; for (const t of tr) { const k = t.liq ? '강제청산' : ({ tp: '익절가', sl: '손절가', reduce: '지정가 청산', round: '종목 끝', manual: '시장가' })[t.reason] || t.reason; why[k] = (why[k] || 0) + 1; }
    statBox.innerHTML = `<div class="gm" style="width:760px"><div class="gmh"><b>📊 전적</b><span><button id="gReset" title="점수·티어를 처음부터">↺ 점수 처음부터</button> <button id="gExport" title="실력 분석용: JSON(전부) + CSV(포지션 한 줄씩)">⬇ 분석용 내보내기</button> <button data-x>닫기 (Esc)</button></span></div>` +
      `<div class="gscs">${card('끝낸 종목', rs.length)}${card('이긴 종목', rs.length ? pctS(rs.filter((x) => x.pnl > 0).length / rs.length) : '-')}${card('포지션', a.n)}${card('포지션 승률', a.n ? pctS(a.win) : '-')}` +
      `${card('평균 손익비', a.rr != null ? a.rr.toFixed(2) : '-')}${card('포지션당 기대값', a.n ? usdS(a.exp) : '-', cls(a.exp))}${card('총 실현 손익', usdS(a.pnl), cls(a.pnl))}${card('낸 수수료', usd(fees))}` +
      `${card('최다 연승 / 연패', `${best} / ${worst}`)}${card('최대 낙폭 (종목 끝 잔고)', mdd ? '-' + (mdd * 100).toFixed(1) + '%' : '0%', mdd ? 'down' : '')}${card('플레이타임', fmtDur(G.playMs || 0))}${card('업적', `${ACH.filter((x) => (G.ach || {})[x.k]).length}/${ACH.length}`)}</div>` +
      `<h4>청산 습관 <span class="dim" style="font-weight:400">(실력 측정용 기록이 있는 포지션 ${hab.n}개 · 많을수록 믿을 만해요)</span></h4>` +
      `<div class="gscs">${card('이긴 포지션 평균 포착률', pf(hab.cap))}${card('수익→손실 전환율', hab.gb == null ? '-' : `${pf(hab.gb)} <small class="dim">(${hab.gbN})</small>`, hab.gb > 0.3 ? 'down' : '')}` +
      `${card('이긴 포지션: 청산 뒤 더 간 폭', hab.postFav == null ? '-' : '+' + (hab.postFav * 100).toFixed(2) + '%')}${card('일찍 판 비율', pf(hab.early), hab.early > 0.5 ? 'down' : '')}</div>` +
      `<div class="dim" style="font-size:11.5px; margin-top:4px">수익→손실 = 한때 +1% 이상 갔던 포지션 중 손실로 끝난 비율 · 청산 뒤 = 청산하고 10턴 안에 같은 방향으로 더 간 폭(가격 기준) · 일찍 판 비율 = 이긴 포지션 중 청산 뒤에 더 간 폭이 내가 가져간 폭보다 큰 비율</div>` +
      `<h4>점수 · 티어 변화 <span class="dim" style="font-weight:400">(매매가 끝날 때마다 총 점수)</span></h4>${scoreChart()}` +
      `<div class="g2"><div><h4>롱 · 숏</h4><table class="gst"><tr><th></th><th>횟수</th><th>승률</th><th>손익</th><th>기대값</th><th>손익비</th></tr>${sideRow('<span class="up">롱</span>', tr.filter((t) => t.side === 'long'))}${sideRow('<span class="down">숏</span>', tr.filter((t) => t.side === 'short'))}</table>` +
      `<h4>청산 방식</h4><div class="gwhy">${Object.entries(why).sort((p, q) => q[1] - p[1]).map(([k, v]) => `<div><span>${k}</span><i style="width:${v / Math.max(1, tr.length) * 100}%"></i><b>${v}</b></div>`).join('') || '<span class="dim">아직 없음</span>'}</div></div>` +
      `<div><h4>코인별</h4><div style="max-height:260px; overflow:auto"><table class="gst"><tr><th>종목</th><th>판</th><th>포지션</th><th>승률</th><th>손익</th></tr>${symRows.map((r) => `<tr><td>${r.k.replace(/USDT$/, '')}</td><td>${roundsBy[r.k] || 0}</td><td>${r.s.n}</td><td>${pctS(r.s.win)}</td><td class="${cls(r.s.pnl)}">${usdS(r.s.pnl)}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">아직 없음</td></tr>'}</table></div></div></div>` +
      `<div class="dim" style="font-size:11.5px; margin-top:8px">손익비 = 평균 수익 ÷ 평균 손실 · 기대값 = 포지션 하나당 평균 손익 · 진행 중인 종목의 포지션은 종목 이름이 드러나지 않게 종목이 끝난 뒤에 셉니다.</div></div>`;
    statBox.querySelector('[data-x]').onclick = () => { statBox.style.display = 'none'; };
    $('gExport').onclick = () => exportData();
    $('gReset').onclick = () => resetSeed();
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

  // ------------------------------------------------------------ 실력 측정용 기록 (플레이 방식은 그대로, 기록만 늘림)
  // 포지션마다 tr.x 에: 진입 순간 차트 상태 · 손절/익절 계획과 옮김 · MFE/MAE · R 배수 · 생각한 시간 · 직전 매매 뒤 행동 · 세션
  // 종목마다: 턴별 생각한 시간 · 첫 진입 턴 · 세션 · 시작 때 연승/연패 · 시각
  const LOG_VER = 1;
  let lastRevealAt = Date.now(), pendingDecision = null;
  const r4 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 10000) / 10000);
  function entryContext() {             // 진입 순간, 이미 보인 봉만으로 계산 (앞날 정보 없음)
    const i = cursor, c = bars[i].c, from = Math.max(0, i - 199), win = bars.slice(from, i + 1);
    let hi = -Infinity, lo = Infinity; for (const b of win) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); }
    const ch = (n) => (i - n >= 0 ? c / bars[i - n].c - 1 : null);
    const tr14 = []; for (let k = Math.max(1, i - 13); k <= i; k++) tr14.push(Math.max(bars[k].h, bars[k - 1].c) - Math.min(bars[k].l, bars[k - 1].c));   // 진폭(전 봉 종가 포함)
    const qv48 = bars.slice(Math.max(0, i - 48), i).map((b) => b.qv || 0), avgQv = qv48.length ? qv48.reduce((s, x) => s + x, 0) / qv48.length : 0;
    const vol48 = bars.slice(Math.max(0, i - 48), i).map((b) => b.v || 0), avgV = vol48.length ? vol48.reduce((s, x) => s + x, 0) / vol48.length : 0;
    const last = bars[i];
    return {
      rangePos: r4(hi > lo ? (c - lo) / (hi - lo) : 0.5),         // 최근 200봉 고저 안의 위치 (0 = 최저, 1 = 최고)
      fromHigh: r4(c / hi - 1), fromLow: r4(c / lo - 1),           // 200봉 최고·최저에서 떨어진 정도
      ch1: r4(ch(300 / BAR)), ch6: r4(ch(1800 / BAR)), ch12: r4(ch(3600 / BAR)), ch48: r4(ch(14400 / BAR)),   // 직전 5분·30분·1시간·4시간 변화 (봉 길이와 상관없이 시간으로)
      atr14: r4(tr14.length ? tr14.reduce((s, x) => s + x, 0) / tr14.length / c : null),   // 변동성 (14봉 평균 진폭 ÷ 가격)
      volX: r4(avgQv ? (last.qv || 0) / avgQv : avgV ? (last.v || 0) / avgV : null),        // 진입 봉 거래대금 ÷ 직전 48봉 평균
      takerBuy: r4(last.bv != null && last.v ? last.bv / last.v : null),                     // 진입 봉 매수 체결 비율
      candle: r4(last.c / last.o - 1),
    };
  }
  const roundTrades = (rid) => trades.filter((t) => t.round === rid);
  const baseNewPos2 = newPos;
  newPos = function (ord, t) {
    const pos = baseNewPos2(ord, t), r = G.round;
    try {
      const prev = r ? roundTrades(r.id).slice(-1)[0] : null;
      pos.x = {
        v: LOG_VER, ctx: entryContext(), entryTurn: r ? r.turn : null, kind: orderType,
        decisionSec: pendingDecision, slEntry: ord.sl ?? null, tpEntry: ord.tp ?? null, slLog: [], tpLog: [], adds: [],
        afterPrev: prev ? { turns: Math.round((t - prev.t_out) / BAR), prevPnl: r4(prev.pnl), prevLoss: prev.pnl < 0, sizeRatio: r4(ord.margin / (prev.margin || ord.margin)) } : null,
        firstInRound: !prev, session: G.sess ? G.sess.id : null, hourKst: +origFmt(Math.floor(Date.now() / 1000)).slice(11, 13),
      };
      pos._sl = pos.sl ?? null; pos._tp = pos.tp ?? null;
      if (r && r.firstEntryTurn == null) r.firstEntryTurn = r.turn;
    } catch (e) { console.error(e); }
    pendingDecision = null;
    return pos;
  };
  const baseAddFill2 = addFill;
  addFill = function (price, o, t) {
    try { if (open && open.x) { const u = posPnl(open, price).net; open.x.adds.push({ t, price, margin: o.margin, upnl: r4(u), losing: u < 0, turn: G.round ? G.round.turn : null }); } } catch (e) {}
    return baseAddFill2(price, o, t);
  };
  const baseSubmit = submit;
  submit = function (side) { pendingDecision = Math.round((Date.now() - lastRevealAt) / 100) / 10; return baseSubmit(side); };
  function trackStops() {               // 손절·익절이 바뀌었으면 기록 (입력·드래그·취소 어느 길이든 renderPos 를 거침)
    if (!open || !open.x) return;
    const L = (k, log) => {
      const now = open[k] ?? null, was = open['_' + k];
      if (now === was) return;
      const away = k === 'sl' && was != null && now != null && (open.side === 'long' ? now < was : now > was);   // 손절을 더 멀리
      log.push({ t: nowT(), turn: G.round ? G.round.turn : null, from: was, to: now, away: !!away, removed: was != null && now == null });
      open['_' + k] = now;
    };
    L('sl', open.x.slLog); L('tp', open.x.tpLog);
  }
  const baseTradeHook2 = tradeHook;
  tradeHook = function (tr) {
    baseTradeHook2(tr);
    try {
      if (!isTrade(tr) || !open || !open.x) return;
      trackStops();
      const x = { ...open.x }, long = tr.side === 'long';
      let mfe = 0, mae = 0;
      for (const b of bars) if (b.t > tr.t_in && b.t <= tr.t_out) {
        mfe = Math.max(mfe, long ? b.h / tr.entry - 1 : 1 - b.l / tr.entry);
        mae = Math.min(mae, long ? b.l / tr.entry - 1 : 1 - b.h / tr.entry);
      }
      const res = pnlPct(tr.side, tr.entry, tr.exit) / 100;
      const firstEntry = (open.fills && open.fills[0]) ? open.fills[0].price : tr.entry;
      const riskPct = x.slEntry != null ? Math.abs(firstEntry - x.slEntry) / firstEntry : null;                // 처음 계획한 손실폭 (가격 기준)
      const riskUsd = riskPct != null ? riskPct * (open.fills && open.fills[0] ? open.fills[0].notional : tr.notional) : null;
      Object.assign(x, {
        mfe: r4(mfe), mae: r4(mae), res: r4(res), cap: mfe > 0 ? r4(res / mfe) : null,
        holdTurns: Math.round((tr.t_out - tr.t_in) / BAR), riskPct: r4(riskPct), R: riskUsd ? r4(tr.pnl / riskUsd) : null,
        slMoves: x.slLog.length, slAway: x.slLog.filter((z) => z.away).length, slRemoved: x.slLog.some((z) => z.removed),
        addsLosing: x.adds.filter((a) => a.losing).length, addsWinning: x.adds.filter((a) => !a.losing).length,
        exitTurn: G.round ? G.round.turn : null, balBefore: r4(acct.balance - tr.pnl), riskOfBal: r4(tr.pnl / Math.max(1, acct.balance - tr.pnl)),
      });
      delete x.v;
      tr.x = x; tr.logv = LOG_VER;
    } catch (e) { console.error(e); }
  };
  const baseRenderPos2 = renderPos;
  renderPos = function () { try { trackStops(); } catch (e) {} baseRenderPos2(); };
  // 턴마다 생각한 시간 (실제 초). 한 번에 여러 봉을 넘기면 한 번만 적음
  const baseStep2 = step;
  step = function (n) {
    const r = G.round, before = r ? r.turn : 0;
    baseStep2(n);
    if (r && r.turn > before) {
      const sec = Math.min(600, Math.round((Date.now() - lastRevealAt) / 100) / 10);
      (r.thinkSec = r.thinkSec || []).push(sec);
      lastRevealAt = Date.now();
    }
  };
  // 세션: 30분 넘게 쉬면 새 세션
  function touchSession() {
    const now = Date.now();
    if (!G.sess || now - (G.sess.last || 0) > 30 * 60000) G.sess = { id: (G.sess ? G.sess.id : 0) + 1, start: now, last: now, rounds: 0 };
    G.sess.last = now;
  }
  function streakNow() {                 // 지금까지 끝난 종목의 연승(+)·연패(−) 수
    let n = 0; const rs = G.rounds;
    for (let i = rs.length - 1; i >= 0; i--) { const w = rs[i].pnl > 0; if (n === 0) n = w ? 1 : -1; else if ((n > 0) === w) n += w ? 1 : -1; else break; }
    return n;
  }
  function onRoundStart(r) {
    touchSession(); G.sess.rounds++;
    r.rankStart = rankNow();
    Object.assign(r, { session: G.sess.id, sessIdx: G.sess.rounds, streakStart: streakNow(), hourKst: +origFmt(Math.floor(Date.now() / 1000)).slice(11, 13), thinkSec: [], logv: LOG_VER });
    lastRevealAt = Date.now();
  }
  function roundExtra(r, h) {            // 끝난 종목 기록에 붙일 것
    const t = r.thinkSec || [];
    const sorted = [...t].sort((a, b) => a - b);
    Object.assign(h, { session: r.session ?? null, sessIdx: r.sessIdx ?? null, streakStart: r.streakStart ?? null, hourKst: r.hourKst ?? null,
      firstEntryTurn: r.firstEntryTurn ?? null, thinkAvg: t.length ? r4(t.reduce((s, x) => s + x, 0) / t.length) : null, thinkMed: sorted.length ? sorted[sorted.length >> 1] : null,
      thinkSec: t, minEqPct: r.minEq != null ? r4(r.minEq / r.startBal - 1) : null, logv: LOG_VER });
  }

  // ------------------------------------------------------------ 분석용 내보내기
  function exportData() {
    const live = hidden() ? G.round.id : null;
    const tr = trades.filter((t) => t.round !== live), rs = G.rounds;
    const rmap = Object.fromEntries(rs.map((h) => [h.rid, h]));
    const day = origFmt(Math.floor(Date.now() / 1000)).slice(0, 10);
    const json = {
      app: 'chart-replay 차트게임', format: 'chart-game-analysis', version: LOG_VER, exportedAtKst: origFmt(Math.floor(Date.now() / 1000)),
      rules: { seedUsdt: SEED, leverage: LEV, marginMode: '격리', feePct: FEE_PCT, turnsPerRound: TURNS, barSec: BAR, preBars: PRE },
      notes: ['가격 % 는 소수 (0.01 = 1%)', 'R = 손익 ÷ 처음 손절까지의 손실액 (진입 때 손절가가 있을 때만)', 'ctx 는 진입 순간까지 보인 봉으로만 계산', '시각은 KST 문자열과 UTC 초를 함께'],
      account: { balance: acct.balance, tier: TIERS[rankNow()].name, series: G.series || null, seriesLog: G.seriesLog || [], bestTier: TIERS[G.bestTier || 0].name, playHours: r4((G.playMs || 0) / 3600000), achievements: Object.keys(G.ach || {}) },
      rounds: rs.map((h) => ({ ...h, review: h.review ? { ...h.review, trades: undefined } : null, fromKst: origFmt(h.from), toKst: origFmt(h.to) })),
      trades: tr.map((t, i) => ({ i: i + 1, roundN: rmap[t.round] ? rmap[t.round].n : null, coin: t.symbol, side: t.side, inKst: origFmt(t.t_in), outKst: origFmt(t.t_out), ...t })),
      orders: orders.filter((o) => o.round !== live).map((o) => ({ ...o, tKst: origFmt(o.t), ftKst: o.ft ? origFmt(o.ft) : null })),
    };
    download(`chart-game-analysis-${day}.json`, JSON.stringify(json, null, 1), 'application/json');
    // 포지션 한 줄씩 CSV (엑셀·스프레드시트용)
    const cols = [['번호', (t, i) => i + 1], ['종목번호', (t) => (rmap[t.round] ? rmap[t.round].n : '')], ['코인', (t) => t.symbol], ['방향', (t) => (t.side === 'long' ? '롱' : '숏')],
      ['진입(KST)', (t) => origFmt(t.t_in)], ['청산(KST)', (t) => origFmt(t.t_out)], ['평단', (t) => t.entry], ['청산가', (t) => t.exit], ['증거금', (t) => t.margin], ['손익', (t) => r4(t.pnl)],
      ['수수료', (t) => r4(t.fees)], ['펀딩비', (t) => r4(t.funding || 0)], ['실전수수료', (t) => (t.real ? 1 : 0)], ['청산방식', (t) => (t.liq ? '강제청산' : t.reason)], ['진입방식', (t) => t.x && t.x.kind], ['진입턴', (t) => t.x && t.x.entryTurn], ['보유턴', (t) => t.x && t.x.holdTurns],
      ['결과%', (t) => t.x && t.x.res], ['MFE', (t) => t.x && t.x.mfe], ['MAE', (t) => t.x && t.x.mae], ['포착률', (t) => t.x && t.x.cap], ['청산뒤더간폭', (t) => t.x && t.x.post && t.x.post.fav], ['청산뒤반대폭', (t) => t.x && t.x.post && t.x.post.adv], ['청산뒤본봉수', (t) => t.x && t.x.post && t.x.post.n], ['수익손실전환', (t) => t.x && t.x.mfe != null ? (t.x.giveback ? 1 : 0) : ''], ['손절가(진입때)', (t) => t.x && t.x.slEntry], ['익절가(진입때)', (t) => t.x && t.x.tpEntry],
      ['계획손실폭', (t) => t.x && t.x.riskPct], ['R', (t) => t.x && t.x.R], ['손절옮김', (t) => t.x && t.x.slMoves], ['손절멀리', (t) => t.x && t.x.slAway], ['손절없앰', (t) => t.x && (t.x.slRemoved ? 1 : 0)],
      ['물타기', (t) => t.x && t.x.addsLosing], ['불타기', (t) => t.x && t.x.addsWinning], ['생각한초', (t) => t.x && t.x.decisionSec],
      ['직전매매후턴', (t) => t.x && t.x.afterPrev && t.x.afterPrev.turns], ['직전손실', (t) => t.x && t.x.afterPrev && (t.x.afterPrev.prevLoss ? 1 : 0)], ['증거금배율(직전대비)', (t) => t.x && t.x.afterPrev && t.x.afterPrev.sizeRatio],
      ['200봉위치', (t) => t.x && t.x.ctx.rangePos], ['5분변화', (t) => t.x && t.x.ctx.ch1], ['30분변화', (t) => t.x && t.x.ctx.ch6], ['1시간변화', (t) => t.x && t.x.ctx.ch12], ['4시간변화', (t) => t.x && t.x.ctx.ch48],
      ['변동성ATR', (t) => t.x && t.x.ctx.atr14], ['거래대금배수', (t) => t.x && t.x.ctx.volX], ['매수체결비율', (t) => t.x && t.x.ctx.takerBuy],
      ['세션', (t) => t.x && t.x.session], ['세션내종목순서', (t) => (rmap[t.round] ? rmap[t.round].sessIdx : '')], ['시작때연승연패', (t) => (rmap[t.round] ? rmap[t.round].streakStart : '')], ['시각(KST시)', (t) => t.x && t.x.hourKst]];
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = '﻿' + cols.map((c) => c[0]).join(',') + '\n' + tr.map((t, i) => cols.map((c) => esc(c[1](t, i))).join(',')).join('\n');
    download(`chart-game-positions-${day}.csv`, csv, 'text/csv');
    flash(`분석용 파일 2개를 받았어요 (포지션 ${tr.length}개 · 종목 ${rs.length}개)${live ? ' · 진행 중인 종목은 끝난 뒤에 들어가요' : ''}.`, 5000);
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ------------------------------------------------------------ 체결 표시: 거래소처럼 B(매수)·S(매도) 배지, 올리면 가격·규모
  const RIGHT_BARS = 34;                    // 마지막 봉 오른쪽 빈 칸(봉 수). 포지션·주문 표를 여기에 둬 캔들을 가리지 않게
  chart.applyOptions({ timeScale: { rightOffset: RIGHT_BARS } });
  const fillLayer = document.createElement('div'); fillLayer.id = 'fillLayer'; $('chart').appendChild(fillLayer);
  const fillTip = document.createElement('div'); fillTip.id = 'fillTip'; $('chart').appendChild(fillTip);
  let fillKey = '', fillGroups = [];
  function axisW() {                       // 오른쪽 가격 축 폭 (차트가 아직 안 그려졌으면 화면 요소에서 재고, 그래도 없으면 70)
    const w = chart.priceScale('right').width();
    if (w > 0) return w;
    const tds = $('chart').querySelectorAll('.tv-lightweight-charts table tr:first-child td');
    return tds.length >= 2 && tds[tds.length - 1].offsetWidth ? tds[tds.length - 1].offsetWidth : 70;
  }
  const coinOf = () => (hidden() ? '' : ' ' + ((G.round && G.round.short) || ''));
  function fillLine(o) {
    const buy = o.dir === 'long', q = o.notional / o.fp;
    const what = { 진입: '진입', 추가: '추가매수', '부분 청산': '부분 청산', 청산: '청산', '추격 청산': '추격 청산', '추격 부분 청산': '추격 부분 청산' }[o.act] || o.act || '';
    const qty = q.toLocaleString('en-US', { maximumFractionDigits: q < 10 ? 4 : q < 1000 ? 2 : 0 });
    return `<b class="${buy ? 'up' : 'down'}">${buy ? '매수' : '매도'}</b> ${usd(o.notional).replace('$', '')} USDT <span class="dim">(${qty}${coinOf()})</span> @ <b>${fmtP(o.fp)}</b>` +
      `<br><span class="dim">${o.kind}${what ? ' · ' + what : ''} · 증거금 ${usd(o.margin)} · ${fmtKst(o.ft).slice(11)}${o.pnl != null ? ` · 실현 <span class="${cls(o.pnl)}">${usdS(o.pnl)}</span>` : ''}</span>`;
  }
  function buildFills() {
    const r = G.round;
    const list = r ? orders.filter((o) => o.round === r.id && o.status === '체결' && o.fp != null && o.ft != null) : [];
    const key = (r ? r.id : '') + ':' + list.length + ':' + ordVer;
    if (key === fillKey) return;
    fillKey = key;
    const groups = {};
    for (const o of list) {
      const k = bucket(o.ft) + ':' + o.dir;
      (groups[k] = groups[k] || { t: bucket(o.ft), dir: o.dir, list: [] }).list.push(o);
    }
    fillGroups = Object.values(groups).map((g) => {
      const n = g.list.reduce((s, o) => s + o.notional, 0);
      g.price = g.list.reduce((s, o) => s + o.fp * o.notional, 0) / (n || 1);       // 같은 봉 여러 건이면 금액 가중 평균 가격에 하나로
      return g;
    });
    fillLayer.innerHTML = '';
    for (const g of fillGroups) {
      const el = document.createElement('div');
      el.className = 'fbadge ' + (g.dir === 'long' ? 'b' : 's');
      el.textContent = (g.dir === 'long' ? 'B' : 'S') + (g.list.length > 1 ? g.list.length : '');
      el.onmouseenter = () => {
        fillTip.innerHTML = g.list.length > 1 ? `<div class="dim" style="margin-bottom:3px">${g.list.length}건 · 평균 ${fmtP(g.price)}</div>` + g.list.map(fillLine).join('<hr>') : fillLine(g.list[0]);
        fillTip.style.display = 'block';
        // 실제 체결 가격 자리에 작은 화살표 (매수 초록 ▶, 매도 빨강 ▶) — 캔들 왼쪽에서 그 가격을 가리킨다
        const bx = chart.timeScale().timeToCoordinate(g.t + KST_OFF);
        for (const o of g.list) {
          const py = candle.priceToCoordinate(o.fp);
          if (bx == null || py == null) continue;
          const a = document.createElement('div');
          a.className = 'farrow ' + (o.dir === 'long' ? 'b' : 's');
          a.style.left = (bx - 6) + 'px'; a.style.top = py + 'px';
          fillLayer.appendChild(a);
        }
        const W = $('chart').clientWidth, x = parseFloat(el.style.left), y = parseFloat(el.style.top);
        const tw = fillTip.offsetWidth, th = fillTip.offsetHeight;
        fillTip.style.left = Math.max(4, Math.min(W - tw - 80, x - tw / 2)) + 'px';
        fillTip.style.top = (y - th - 14 > 4 ? y - th - 14 : y + 16) + 'px';
      };
      el.onmouseleave = () => { fillTip.style.display = 'none'; fillLayer.querySelectorAll('.farrow').forEach((a) => a.remove()); };
      g.el = el; fillLayer.appendChild(el);
    }
  }
  function placeFills() {
    if (!fillGroups.length) return;
    const W = $('chart').clientWidth - axisW(), H = $('chart').clientHeight - 26;
    const barAt = new Map(); for (const a of agg.slice(-400)) barAt.set(a.t, a);
    for (const g of fillGroups) {
      // 캔들을 가리지 않게: B 는 그 봉 저가 아래, S 는 고가 위에 (체결 가격은 올리면 보임)
      const a = barAt.get(g.t), x = chart.timeScale().timeToCoordinate(g.t + KST_OFF);
      const edge = a ? candle.priceToCoordinate(g.dir === 'long' ? a.l : a.h) : candle.priceToCoordinate(g.price);
      const y = edge == null ? null : edge + (g.dir === 'long' ? 17 : -17) + (g.ghost ? (g.dir === 'long' ? 19 : -19) : 0);   // 배지 반 높이(7.5) + 띄움(약 10px)
      if (x == null || y == null || x < 0 || x > W || y < 0 || y > H) { g.el.style.display = 'none'; continue; }
      g.el.style.display = ''; g.el.style.left = x + 'px'; g.el.style.top = y + 'px';
    }
  }
  (function fillLoop() { placeFills(); requestAnimationFrame(fillLoop); })();
  renderMarkers = function () { candle.setMarkers([]); fillKey = ''; buildFills(); placeFills(); };   // 화살표 대신 B·S 배지

  // ------------------------------------------------------------ 들고 있는 포지션 표시: 캔들 위가 아니라 오른쪽 빈 칸으로
  // 선 제목(롱 평단·익절·손절 글자)은 오른쪽 끝 최신 캔들 위에 그려져 가격을 가렸으므로 지우고, 같은 정보를 오른쪽 빈 칸의 표에 둔다
  const baseSync = syncLines;
  syncLines = function () {
    baseSync();
    for (const l of lines) if (l.options().title) l.applyOptions({ title: '' });
  };
  const baseChips = renderChips;
  renderChips = function () {
    baseChips();
    const layer = $('ordLayer');
    if (open && cursor >= 0) {             // 포지션 표: 롱/숏 · 증거금 · ROE (끌 수 없음)
      const roe = posPnl(open, curPrice()).net / open.margin * 100, long = open.side === 'long';
      const el = document.createElement('div');
      el.className = 'ochip pinfo'; el.dataset.kind = 'pinfo'; el.dataset.price = open.entry;
      el.innerHTML = `<span style="background:${long ? '#26a69a' : '#ef5350'}">${long ? '롱' : '숏'} ${usd(open.margin)}</span><span style="background:${roe >= 0 ? '#1b5e57' : '#6b2a2a'}">${sgn(roe)}%</span>`;
      el.title = `평단 ${fmtP(open.entry)} · 크기 ${usd(open.notional)}`;
      layer.insertBefore(el, layer.firstChild);
    }
    // 오른쪽 정렬: 가격 축 바로 왼쪽부터. 같은 줄(같은 가격)의 표는 왼쪽으로 이어 붙인다
    const axis = axisW() + 6, rows = {};
    for (const el of [...layer.children].reverse()) {
      if (el.style.display === 'none') continue;
      const k = el.dataset.price, used = rows[k] || 0;
      el.style.left = 'auto'; el.style.right = (axis + used) + 'px';
      rows[k] = used + el.offsetWidth + 4;
    }
    positionChips();
  };

  // ------------------------------------------------------------ 실전 수수료 (항상 켜짐 — 2026-11-20 승주 결정)
  // 켜면: ① 바로 체결되는 주문(시장가·X·C·손절·바로 체결된 지정가·종목 끝 청산)은 테이커, 걸어 둔 지정가가 체결되면 메이커
  //       ② 펀딩비: 정산 시각(보통 8시간마다)에 포지션을 들고 있으면 그때 펀딩비를 잔고에서 주고받음
  //       ③ 슬리피지: 테이커 체결은 그 가격보다 조금 불리하게 체결
  const TAKER_PCT = 0.05, SLIP_PCT = 0.02;      // 게이트 기본 등급 테이커(대략) · 시장가 체결 가격 차이
  const realOn = () => true;                      // 끌 수 없음
  const slipP = (p, buy) => p * (1 + (buy ? 1 : -1) * SLIP_PCT / 100);
  const extraRate = () => TAKER_PCT - FEE_PCT;    // 테이커 - 메이커 (기본 계산은 메이커로 되어 있어 차액만 더함)
  let inSubmit = false, mktPartial = false, lastSlip = null;
  // 주문 칸 아래 안내 (스위치 없음)
  const realBox = mk('div', 'grealfee', `<b>실전 수수료</b> <span class="dim">메이커 ${FEE_PCT}% · 테이커 ${TAKER_PCT}% · 펀딩비 · 슬리피지 ${SLIP_PCT}%</span>`);
  realBox.title = '바로 체결되는 주문(시장가·X·C·손절·바로 체결된 지정가·종목 끝 청산)은 테이커 수수료와 슬리피지, 걸어 둔 지정가 체결은 메이커, 포지션을 들고 정산 시각을 지나면 펀딩비를 주고받아요.';
  fixed.after(realBox);
  function paintReal() {
    fixed.textContent = '격리 · 레버리지 3배 고정 · 가상 연습';
    rule.textContent = `${BAR_LABEL}봉 · 시드 3,000 USDT · 레버리지 3배 · 격리 · 메이커 ${FEE_PCT}%·테이커 ${TAKER_PCT}%·펀딩·슬리피지 · 종목당 ${TURNS}턴`;
  }

  // ① 진입: 주문을 낸 그 자리에서 체결되면(시장가·바로 체결된 지정가) 테이커 + 슬리피지
  const baseSubmitR = submit;
  submit = function (side) {
    inSubmit = true; lastSlip = null;
    try { return baseSubmitR(side); } finally {
      inSubmit = false;
      if (lastSlip != null) {                    // 주문 기록의 체결가도 슬리피지 반영
        const o = [...orders].reverse().find((x) => x.status === '체결' && /진입|추가/.test(x.act || ''));
        if (o) { o.fp = lastSlip; o.note = (o.note ? o.note + ' · ' : '') + `테이커·슬리피지 ${SLIP_PCT}%`; saveOrders(); renderMarkers(); }
      }
    }
  };
  const baseNewPosR = newPos;
  newPos = function (ord, t) {
    if (!(realOn() && inSubmit)) return baseNewPosR(ord, t);
    const o2 = { ...ord, entry: slipP(ord.entry, ord.side === 'long') };
    const pos = baseNewPosR(o2, t);
    pos.extraIn = o2.notional * extraRate() / 100; pos.real = true; lastSlip = o2.entry;
    return pos;
  };
  const baseAddFillR = addFill;
  addFill = function (price, o, t) {
    if (!(realOn() && inSubmit && open)) return baseAddFillR(price, o, t);
    const p2 = slipP(price, open.side === 'long');
    open.extraIn = (open.extraIn || 0) + o.notional * extraRate() / 100; lastSlip = p2;
    return baseAddFillR(p2, o, t);
  };
  // 손익 계산에 테이커 차액을 더한다 (진입 차액 + 청산이 테이커면 청산 차액)
  const basePosPnl = posPnl;
  posPnl = function (pos, p) {
    const r = basePosPnl(pos, p);
    const exIn = pos.extraIn || 0, exOut = pos._exitRate ? pos.notional * (p / pos.entry) * pos._exitRate / 100 : 0;
    if (exIn || exOut) { r.feeIn += exIn; r.feeOut += exOut; r.net -= exIn + exOut; }
    return r;
  };
  // 청산: 익절가·지정가(Reduce-Only·추격)·강제청산은 메이커(강제청산은 증거금만큼만 잃음), 그 밖(X·C·버튼·손절·종목 끝)은 테이커 + 슬리피지
  const baseClosePosR = closePos;
  closePos = function (forcedPrice, reason) {
    if (!realOn() || !open || cursor < 0 || ['tp', 'reduce', 'liq'].includes(reason)) return baseClosePosR(forcedPrice, reason);
    const p = slipP(forcedPrice != null ? forcedPrice : curPrice(), open.side === 'short');
    open._exitRate = extraRate();
    try { return baseClosePosR(p, reason); } finally { if (open) delete open._exitRate; }
  };
  // 부분 청산: 시장가면 테이커 + 슬리피지. 줄인 비율만큼 진입 때 테이커 차액도 이때 정산
  const basePartialClose = partialClose;
  partialClose = function (amt) { mktPartial = realOn(); try { return basePartialClose(amt); } finally { mktPartial = false; } };
  const basePartialAtR = partialAt;
  partialAt = function (amt, p) {
    if (!realOn() || !open) return basePartialAtR(amt, p);
    const f = Math.min(1, amt / open.notional), inEx = (open.extraIn || 0) * f;
    const x = basePartialAtR(amt, mktPartial ? slipP(p, open.side === 'short') : p);
    const ex = inEx + (mktPartial ? x.q * x.p * extraRate() / 100 : 0);
    if (ex) {
      acct.balance = Math.max(0, acct.balance - ex); saveAcct();
      open.realized -= ex; open.feesPaid = (open.feesPaid || 0) + ex; open.extraIn = (open.extraIn || 0) - inEx;
      const last = open.partials[open.partials.length - 1]; if (last) last.pnl -= ex;
      x.pnl -= ex; x.fees += ex;
    }
    return x;
  };

  // ② 펀딩비: 종목마다 그 기간의 펀딩비 파일을 읽어 두고, 봉을 넘길 때 정산 시각을 지나면 주고받는다
  let fundList = [], fundRound = null;
  async function loadFunding(r) {
    fundList = []; fundRound = r.id;
    try {
      const c = index.coins.find((x) => x.short === r.short), per = c && c.periods[r.pk];
      const fs = per && per.funding ? Object.values(per.funding) : [];
      const out = [];
      for (const f of fs) {
        const txt = await fetchText('data/' + f);
        for (const line of txt.split(/\r?\n/).slice(1)) { const [t, v] = line.split(','); if (t && v) out.push({ t: +t, rate: +v }); }
      }
      if (fundRound === r.id) fundList = out.sort((a, b) => a.t - b.t);
    } catch (e) { console.error('펀딩비를 읽지 못했어요', e); }
  }
  const baseShowWindow = showWindow;
  showWindow = function (w, r) { baseShowWindow(w, r); loadFunding(r); };
  function applyFunding(fromClose, toClose) {   // (fromClose, toClose] 사이의 정산 시각 — 봉 종가 시각 기준
    if (!realOn() || !open || !fundList.length) return;
    for (const f of fundList) {
      if (f.t <= fromClose || f.t > toClose || f.t <= open.t + BAR) continue;
      const bar = bars.find((b) => b.t + BAR >= f.t) || bars[cursor];
      const v = (open.qty || open.notional / open.entry) * bar.c;      // 그 시각 포지션 가치
      const cost = (open.side === 'long' ? 1 : -1) * v * f.rate;        // 양수 = 낸 돈
      acct.balance = Math.max(0, acct.balance - cost); saveAcct();
      open.funding = (open.funding || 0) + cost;
      (open.fundLog = open.fundLog || []).push({ t: f.t, rate: f.rate, cost });
      flash(`펀딩비 정산 (${fmtKst(f.t).slice(11)}) 펀딩비율 ${(f.rate * 100).toFixed(4)}% → ${cost > 0 ? '냄' : '받음'} ${usd(Math.abs(cost))}`, 4000);
    }
  }
  const baseStepR = step;
  step = function (n) {
    const before = cursor >= 0 && bars[cursor] ? bars[cursor].t + BAR : null;
    baseStepR(n);
    if (before != null && cursor >= 0 && bars[cursor]) { applyFunding(before, bars[cursor].t + BAR); renderPos(); }
  };
  // 포지션 기록에 펀딩비를 넣고, 실현 손익도 펀딩비까지 뺀 순손익으로 (잔고에는 정산 때 이미 반영)
  const baseTradeHookR = tradeHook;
  tradeHook = function (tr) {
    baseTradeHookR(tr);
    if (isTrade(tr) && open && (open.funding || open.real || open.extraIn)) {
      tr.funding = open.funding || 0; tr.real = true;
      if (tr.funding) { tr.pnl -= tr.funding; tr.fees = (tr.fees || 0); }
      if (tr.x) { tr.x.funding = r4(tr.funding); tr.x.realFee = true; }
    }
  };
  paintReal();

  // ------------------------------------------------------------ 청산 연출: 포지션이 0 → 진입 → 0 으로 끝나면 (종목 끝 자동 청산은 결과 화면이 따로 있어 제외)
  const fx = document.createElement('div'); fx.id = 'gFx'; $('chartRow').appendChild(fx);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function closeFx(tr) {
    const pnl = tr.pnl, roe = tr.margin ? pnl / tr.margin * 100 : 0, win = pnl > 0;
    const kind = tr.liq ? 'liq' : !win ? 'loss' : roe >= 20 ? 'big' : 'win';
    const label = tr.liq ? '💥 강제청산' : tr.reason === 'tp' ? '🎯 익절' : tr.reason === 'sl' ? '🛑 손절' : win ? '✅ 수익 청산' : '손실 청산';
    // 위치: 청산한 봉·가격 근처 (화면 밖이면 가운데)
    const W = fx.clientWidth, H = fx.clientHeight, cl = $('chart').offsetLeft, ct = $('chart').offsetTop;   // 차트 왼쪽 그리기 도구 막대만큼 밀기
    let x = chart.timeScale().timeToCoordinate(bucket(nowT()) + KST_OFF), y = candle.priceToCoordinate(tr.exitLast ?? tr.exit);
    x = x == null ? W / 2 : Math.max(120, Math.min(W - 200, x + cl)); y = y == null ? H / 2 : Math.max(90, Math.min(H - 120, y + ct));
    const box = document.createElement('div');
    box.className = 'fxPnl ' + kind;
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.innerHTML = `<div class="l">${label}${kind === 'big' ? ' · BIG WIN' : ''}</div><div class="v">${usdS(pnl)}</div><div class="r">ROE ${sgn(roe)}%</div>`;
    fx.appendChild(box);
    setTimeout(() => box.remove(), 2200);
    if (reduceMotion) return;
    if (win) {                               // 수익: 색종이 터짐 (크면 더 많이)
      const n = kind === 'big' ? 46 : 22, cols = kind === 'big' ? ['#ffd54f', '#26a69a', '#a1a1aa', '#ff8a65', '#fff'] : ['#26a69a', '#7be0c3', '#ffd54f', '#fff'];
      for (let i = 0; i < n; i++) {
        const p = document.createElement('i'); p.className = 'fxBit';
        const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * (kind === 'big' ? 180 : 110);
        p.style.cssText = `left:${x}px; top:${y}px; background:${cols[i % cols.length]}; --dx:${Math.cos(a) * d}px; --dy:${Math.sin(a) * d - 40}px; --r:${Math.random() * 720 - 360}deg; animation-delay:${Math.random() * 80}ms`;
        fx.appendChild(p); setTimeout(() => p.remove(), 1500);
      }
      const ring = document.createElement('div'); ring.className = 'fxRing'; ring.style.left = x + 'px'; ring.style.top = y + 'px';
      fx.appendChild(ring); setTimeout(() => ring.remove(), 900);
    } else {                                 // 손실: 붉은 번쩍임 + 흔들림 (강제청산은 더 세게)
      const flashEl = document.createElement('div'); flashEl.className = 'fxFlash ' + kind; fx.appendChild(flashEl); setTimeout(() => flashEl.remove(), 900);
      const c = $('chart'); c.classList.remove('fxShake', 'fxShakeHard'); void c.offsetWidth; c.classList.add(kind === 'liq' ? 'fxShakeHard' : 'fxShake');
      setTimeout(() => c.classList.remove('fxShake', 'fxShakeHard'), 700);
    }
  }
  const baseTradeHookFx = tradeHook;
  tradeHook = function (tr) {
    baseTradeHookFx(tr);
    if (isTrade(tr) && tr.reason !== 'round') { try { closeFx(tr); } catch (e) { console.error(e); } }
  };

  // 승급전: 포지션이 끝까지 청산될 때마다 한 판 (수수료·펀딩까지 뺀 순손익으로)
  const baseTradeHookRank = tradeHook;
  tradeHook = function (tr) { baseTradeHookRank(tr); if (isTrade(tr)) { try { updateRank(tr); tierDrawn = null; } catch (e) { console.error(e); } } };

  // 지정가 칸: 직접 고치지 않았으면 턴마다 지금 가격으로 따라간다 (예전엔 종목 시작 가격에 멈춰 있어서,
  // 가격이 움직인 뒤 B·S 를 누르면 한쪽은 바로 체결되고 다른 쪽은 지금 가격 위·아래 대기 주문이 됐다)
  let pxDirty = false;
  $('entryPx').addEventListener('input', () => { pxDirty = true; });
  const followPx = () => { if (!pxDirty && cursor >= 0 && bars.length) $('entryPx').value = +curPrice().toFixed(precision); };
  const baseStepPx = step;
  step = function (n) { baseStepPx(n); followPx(); renderAcct(); };
  const baseSubmitPx = submit;
  submit = function (side) { const r = baseSubmitPx(side); pxDirty = false; followPx(); return r; };
  if ($('btnLast')) $('btnLast').addEventListener('click', () => { pxDirty = false; });
  const baseShowWindowPx = showWindow;
  showWindow = function (w, r) { baseShowWindowPx(w, r); pxDirty = false; followPx(); };

  // ============================================================ 2026-11-24 추가: 봉 애니메이션 · 연승/연패 · 승급전 화면 · 10초 모드 · 고스트 · 시즌 · 진동
  // ---- 봉이 그려지는 애니메이션: 다음 봉 한 개를 열 때 0.3초 동안 시가에서 고가·저가를 오가다 종가로
  let animTok = 0, animBar = null;
  // 애니메이션 중인 봉이 아직 차트의 마지막 봉일 때만 마무리한다. 종목이 바뀐 뒤 예전 종목 봉을 새 차트에 붙이던 버그(2026-11-25)
  function finishAnim() { if (animBar) { if (agg[agg.length - 1] === animBar) { try { candle.update(toCandle(animBar)); } catch (e) {} } animBar = null; animTok++; } }
  function cancelAnim() { animBar = null; animTok++; }
  function animateLast() {
    if (reduceMotion || !agg.length) return;
    const a = agg[agg.length - 1], tok = ++animTok;
    animBar = a;
    const up = a.c >= a.o, mid1 = a.o + (a.c - a.o) * 0.3;
    const pts = [a.o, up ? a.l : a.h, mid1, up ? a.h : a.l, a.o + (a.c - a.o) * 0.7, a.c];   // 꼬리 끝을 한 번씩 찍고 종가로
    const frames = 10, per = 30;
    let k = 0, hi = a.o, lo = a.o;
    (function f() {
      if (tok !== animTok || agg[agg.length - 1] !== a) return;   // 종목이 바뀌었거나 새 봉이 열렸으면 멈춤
      const x = (k / frames) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x)), v = pts[i] + (pts[i + 1] - pts[i]) * (x - i);
      hi = Math.max(hi, v); lo = Math.min(lo, v);
      try { candle.update({ time: a.t + KST_OFF, open: a.o, high: hi, low: lo, close: v }); } catch (e) {}
      if (++k <= frames) setTimeout(f, per); else finishAnim();
    })();
  }

  // ---- 연승·연패 (포지션을 끝까지 청산한 매매 기준, 종목 끝 자동 청산 제외)
  const streakChip = document.createElement('div'); streakChip.id = 'gStreak'; $('gTurn').appendChild(streakChip);
  function paintStreak() {
    const w = G ? (G.streakW || 0) : 0;
    streakChip.textContent = w >= 2 ? `🔥 ${w}연승` : '';
    streakChip.style.display = w >= 2 ? '' : 'none';
    const row = $('chartRow');
    row.classList.toggle('gglow', w >= 2);
    row.style.setProperty('--glow', String(Math.min(1, 0.25 + (w - 2) * 0.18)));
  }
  let restUntil = 0;
  const restBox = document.createElement('div'); restBox.id = 'gRest'; restBox.className = 'gmodal'; document.body.appendChild(restBox);
  function showRest(n) {
    restUntil = Date.now() + 5000;
    restBox.innerHTML = `<div class="gm" style="text-align:center; max-width:360px"><div style="font-size:42px">🧊</div><h3 style="margin:6px 0">${n}연패 — 쉬어가기</h3>` +
      `<div class="dim" style="line-height:1.6">연달아 지면 판단이 흔들리기 쉬워요. 실전 원칙처럼 잠깐 쉬고, 이 종목은 관망하거나 다음 종목으로 넘겨 보세요.</div>` +
      `<div id="gRestCount" style="margin:10px 0; font-weight:700">5초 뒤에 주문할 수 있어요</div><button data-x>알겠어요</button></div>`;
    restBox.style.display = 'flex';
    restBox.querySelector('[data-x]').onclick = () => { restBox.style.display = 'none'; };
    const t = setInterval(() => {
      const left = Math.ceil((restUntil - Date.now()) / 1000), el = $('gRestCount');
      if (!el) { clearInterval(t); return; }
      if (left <= 0) { el.textContent = '이제 주문할 수 있어요'; clearInterval(t); } else el.textContent = `${left}초 뒤에 주문할 수 있어요`;
    }, 250);
  }
  const baseSubmitRest = submit;
  submit = function (side) {
    if (Date.now() < restUntil) { flash(`쉬어가는 중이에요. ${Math.ceil((restUntil - Date.now()) / 1000)}초 뒤에 주문할 수 있어요.`, 2000); return; }
    return baseSubmitRest(side);
  };
  const baseTradeHookStreak = tradeHook;
  tradeHook = function (tr) {
    baseTradeHookStreak(tr);
    if (!isTrade(tr) || tr.reason === 'round' || tr.series) return;     // 승급전 판은 따로 셈
    if (tr.pnl > 0) { G.streakW = (G.streakW || 0) + 1; G.streakL = 0; }
    else { G.streakL = (G.streakL || 0) + 1; G.streakW = 0; if (G.streakL >= 2) setTimeout(() => showRest(G.streakL), 900); }
    paintStreak();
  };

  // ---- 승급전 화면: 배경·배너·음악, 판마다 큰 승·패 연출
  const promoBar = document.createElement('div'); promoBar.id = 'gPromoBar'; $('chartRow').appendChild(promoBar);
  function paintPromo() {
    const se = G && G.series, on = !!(se && G.round && !G.round.done);
    document.body.classList.toggle('gpromo', !!se);
    promoBar.style.display = se ? 'flex' : 'none';
    if (se) promoBar.innerHTML = `<span>⚔️</span><b style="color:${TIERS[se.to].c1}">${TIERS[se.to].name} 승급전</b> ${seriesDots(se)} <span class="dim">${seriesText(se)} · 잔고는 그대로</span>`;
    promoMusic(on);
  }
  function promoFx(res, se) {
    const big = document.createElement('div');
    big.className = 'fxBig ' + (res === 'W' ? 'w' : res === 'L' ? 'l' : 'd');
    const done = res === 'W' && se.w + 1 >= SERIES_WINS ? '승급!' : res === 'L' && se.l + 1 > SERIES_GAMES - SERIES_WINS ? '승급 실패' : '';
    big.innerHTML = `<div class="t">${res === 'W' ? '승리' : res === 'L' ? '패배' : '무승부'}</div><div class="s">${done || (res === 'D' ? '판수에 안 셈' : `${TIERS[se.to].name} 승급전`)}</div>`;
    fx.appendChild(big); setTimeout(() => big.remove(), 1900);
  }
  let musicTimer = null, musicStep = 0;
  function promoMusic(on) {
    if (on && sndOn && !musicTimer) {
      const notes = [220, 262, 330, 262, 196, 247, 294, 247];            // 낮고 긴장감 있는 반복 (직접 만든 소리)
      musicTimer = setInterval(() => {
        if (!sndOn || document.hidden || !actx) return;
        try { tone(notes[musicStep % notes.length], 0.22, 'triangle', 0.035); if (musicStep % 4 === 0) tone(notes[musicStep % notes.length] / 2, 0.4, 'sine', 0.05); } catch (e) {}
        musicStep++;
      }, 260);
    } else if ((!on || !sndOn) && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  // ---- 10초 모드: 턴마다 10초 안에 판단, 지나면 저절로 다음 봉
  const TURN_SEC = 10;
  let turnStart = Date.now(), lastTurnSeen = -1;
  const timerEl = document.createElement('div'); timerEl.id = 'gTimer'; $('gTurn').appendChild(timerEl);
  const timerBtn = document.createElement('button'); timerBtn.className = 'gtopb'; timerBtn.id = 'gTimerBtn';
  bar.insertBefore(timerBtn, $('gStatBtn'));
  function paintTimerBtn() { timerBtn.textContent = G && G.timer ? `⏱ ${TURN_SEC}초 모드 켜짐` : `⏱ ${TURN_SEC}초 모드`; timerBtn.classList.toggle('on', !!(G && G.timer)); }
  timerBtn.onclick = () => { G.timer = !G.timer; turnStart = Date.now(); saveG(); paintTimerBtn(); timerBtn.blur(); flash(G.timer ? `${TURN_SEC}초 모드: 턴마다 ${TURN_SEC}초가 지나면 저절로 다음 봉으로 넘어가요.` : '10초 모드를 껐어요.', 2500); };
  setInterval(() => {
    if (!G) return;
    const r = G.round, active = G.timer && r && !r.done && !starting && $('gHome').style.display === 'none' && $('gResult').style.display !== 'flex' &&
      ![...document.querySelectorAll('.gmodal')].some((m) => m.style.display === 'flex') && !document.hidden;
    if (!r || r.turn !== lastTurnSeen) { lastTurnSeen = r ? r.turn : -1; turnStart = Date.now(); }
    if (!active) { timerEl.style.display = 'none'; turnStart = Math.max(turnStart, Date.now() - (TURN_SEC - 1) * 1000 * 0); return; }
    const left = TURN_SEC - (Date.now() - turnStart) / 1000;
    timerEl.style.display = '';
    timerEl.textContent = `⏱ ${Math.max(0, Math.ceil(left))}`;
    timerEl.classList.toggle('hot', left <= 3);
    if (left <= 0) { turnStart = Date.now(); step(1); }
  }, 200);

  // ---- 고스트: 같은 차트 위에 반투명 B·S (내 매매 차트 = 그때 실제 나, 오늘의 차트 = 친구 코드)
  function myFillsCode(r) {                  // 오늘의 차트에서 내 체결을 짧은 코드로 (종목 이름·날짜는 안 넣음)
    const f = orders.filter((o) => o.round === r.id && o.status === '체결' && o.ft != null).map((o) => [Math.round((o.ft - bars[r.firstTurn].t) / BAR) + 1, o.dir === 'long' ? 'B' : 'S', +(+o.fp).toPrecision(7)]);
    return 'CG1.' + btoa(unescape(encodeURIComponent(JSON.stringify({ d: r.daily, f })))).replace(/=+$/, '');
  }
  function parseGhost(code) {
    const m = String(code).trim().match(/CG1\.([A-Za-z0-9+/]+)/);
    if (!m) return null;
    try { const j = JSON.parse(decodeURIComponent(escape(atob(m[1])))); return j && j.d && Array.isArray(j.f) ? j : null; } catch (e) { return null; }
  }
  function importGhost() {
    const code = prompt('친구가 보낸 오늘의 차트 결과 글(👻 CG1. 으로 시작하는 줄 포함)을 붙여 넣으세요');
    if (!code) return;
    const g = parseGhost(code);
    if (!g) { flash('고스트 코드를 찾지 못했어요. 👻 CG1. 로 시작하는 부분이 들어 있어야 해요.', 3500); return; }
    const name = (prompt('누구의 고스트인가요? (이름)', '친구') || '친구').slice(0, 12);
    G.ghosts = G.ghosts || {};
    (G.ghosts[g.d] = G.ghosts[g.d] || []).push({ name, f: g.f });
    saveG(); renderHome && renderHome();
    flash(`${g.d} 오늘의 차트에 ${name} 고스트를 넣었어요 (체결 ${g.f.length}번). 그 날짜 오늘의 차트를 하면 같이 보여요.`, 4000);
  }
  function ghostsNow() {                     // 지금 판에서 '이미 지난' 고스트 체결
    const r = G && G.round; if (!r || cursor < 0 || !bars.length) return [];
    const out = [], tNow = nowT();
    if (r.mine && mine) {
      const m = mine.rounds.find((x) => x.id === r.mine), t = m && m.trade;
      if (t) {
        const long = t.side === 'long';
        out.push({ who: '그때 실전의 나', t: bucket(t.open), dir: long ? 'long' : 'short', price: t.entry, act: '진입' });
        out.push({ who: '그때 실전의 나', t: bucket(t.close), dir: long ? 'short' : 'long', price: t.exit, act: '청산' });
      }
    }
    if (r.daily && G.ghosts && G.ghosts[r.daily]) for (const g of G.ghosts[r.daily]) for (const [turn, d, p] of g.f) {
      const b = bars[r.firstTurn + turn - 1]; if (b) out.push({ who: g.name, t: b.t, dir: d === 'B' ? 'long' : 'short', price: p, act: '' });
    }
    return out.filter((x) => x.t <= tNow && x.price);
  }
  const baseBuildFills = buildFills;
  buildFills = function () {
    const gs = ghostsNow();
    baseBuildFills();
    fillLayer.querySelectorAll('.fbadge.ghost').forEach((e) => e.remove());
    fillGroups = fillGroups.filter((g) => !g.ghost);
    for (const x of gs) {
      const el = document.createElement('div');
      el.className = 'fbadge ghost ' + (x.dir === 'long' ? 'b' : 's');
      el.textContent = '👻';
      el.title = `${x.who} ${x.dir === 'long' ? '매수' : '매도'}${x.act ? ' (' + x.act + ')' : ''} @ ${fmtP(x.price)} · ${fmtKst(x.t).slice(11)}`;
      fillLayer.appendChild(el);
      fillGroups.push({ t: x.t, dir: x.dir, price: x.price, list: [], el, ghost: true });
    }
  };

  // ---- 시즌: KST 달마다. 그 달 가장 높이 오른 티어를 기억하고, 다음 시즌엔 그 색 테두리(보상)를 엠블럼에
  function seasonId() { return todayKst().slice(0, 7); }
  function seasonTick() {
    if (!G) return;
    const id = seasonId(), r = rankNow();
    if (!G.season) G.season = { id, best: r };
    else if (G.season.id !== id) {
      (G.seasonHist = G.seasonHist || []).push(G.season);
      const prev = G.season;
      G.season = { id, best: r };
      seriesToast(`<span class="ai">🏆</span><div><div class="dim" style="font-size:11px">새 시즌 ${id}</div><b>지난 시즌(${prev.id}) 최고 ${TIERS[prev.best].name}</b><div class="dim" style="font-size:11.5px">보상: ${TIERS[prev.best].name} 테두리를 엠블럼에 달아 줘요</div></div>`, 'go');
    } else G.season.best = Math.max(G.season.best, r);
  }
  const ringOf = () => { const h = G && G.seasonHist && G.seasonHist.length ? G.seasonHist[G.seasonHist.length - 1] : null; return h ? TIERS[h.best] : null; };
  const baseTierBlock = tierBlock;
  tierBlock = function (i, size) {
    const out = baseTierBlock(i, size), ring = ringOf(), cut = out.indexOf('>') + 1;   // 맨 앞의 엠블럼 그림 한 개
    const ss = G && G.season ? `<div class="dim" style="font-size:10.5px">시즌 ${G.season.id.slice(5)}월 최고 <b style="color:${TIERS[G.season.best].c1}">${TIERS[G.season.best].name}</b></div>` : '';
    const svgPart = ring ? `<span class="sring" style="--rc:${ring.c1}" title="지난 시즌 보상 테두리 (${ring.name})">${out.slice(0, cut)}</span>` : out.slice(0, cut);
    return svgPart + out.slice(cut).replace(/<\/div>$/, ss + '</div>');
  };

  // ---- 진동 (휴대폰에서): 체결·수익·손실·강제청산·승급
  const VIB = { fill: 15, win: [30, 40, 30], loss: 120, liq: [200, 80, 200], tierUp: [40, 40, 40, 40, 120], tierDown: 150, ach: 30 };
  const baseSfxV = sfx;
  sfx = function (name) { baseSfxV(name); try { if (navigator.vibrate && matchMedia('(pointer: coarse)').matches && VIB[name]) navigator.vibrate(VIB[name]); } catch (e) {} };

  // ---- 한 턴마다: 애니메이션·고스트·승급전 화면·시즌
  const baseStepFx = step;
  step = function (n) {
    finishAnim();
    const before = agg.length;
    baseStepFx(n);
    if (n === 1 && agg.length > before) animateLast();
    renderMarkers();
    paintPromo();
  };
  const baseRenderTierFx = renderTier;
  renderTier = function () { seasonTick(); baseRenderTierFx(); paintPromo(); };
  const baseShowWindowFx = showWindow;
  showWindow = function (w, r) { cancelAnim(); baseShowWindowFx(w, r); paintStreak(); paintPromo(); paintTimerBtn(); };
  paintTimerBtn();
  window.addEventListener('tiers-local', () => { tierDrawn = null; try { renderTier(); renderHome(); } catch (e) {} });   // 내 엠블럼 그림을 찾으면 다시 그림

  function serverDown() {                   // 게임 서버(까만 창·맥 앱)가 꺼져 있을 때
    let el = $('gDown');
    if (!el) { el = document.createElement('div'); el.id = 'gDown'; $('chartRow').appendChild(el); }
    el.innerHTML = `<div><div style="font-size:40px">🔌</div><b>게임 서버가 꺼져 있어요</b><div class="dim" style="margin-top:6px; line-height:1.6">브라우저가 예전에 받아 둔 화면만 보여 주고 있어요.<br>맥에서 <b>차트게임 앱</b>을 누르거나 까만 창(START-CHART-GAME / start_game.py)을 다시 켠 뒤 새로고침하세요.</div><button onclick="location.reload()">새로고침</button></div>`;
    el.style.display = 'flex';
  }

  // ---- 휴대폰: 아래에 늘 보이는 주문 줄 (매수·다음·매도·청산·다음종목). 넓은 화면에선 숨김
  const mob = document.createElement('div'); mob.id = 'gMob';
  mob.innerHTML = '<button data-a="long" class="b">매수</button><button data-a="step">다음 ▶</button><button data-a="short" class="s">매도</button><button data-a="close">청산</button><button data-a="next">다음종목</button>';
  document.body.appendChild(mob);
  mob.addEventListener('click', (e) => {
    const a = e.target.closest('button') && e.target.closest('button').dataset.a; if (!a) return;
    if (a === 'long' || a === 'short') submit(a);
    else if (a === 'step') step(1);
    else if (a === 'close') closePos();
    else if (a === 'next') { if (G.round && (G.round.done || !$('gNext').disabled)) nextCoin(); else flash('5초 뒤에 넘길 수 있어요.', 1500); }
  });
  function paintMob() {
    const r = G && G.round, live = !!(r && !r.done);
    mob.querySelector('[data-a="close"]').disabled = !open;
    mob.querySelector('[data-a="step"]').disabled = !live;
    const L = mob.querySelector('[data-a="long"]'), S = mob.querySelector('[data-a="short"]');
    L.textContent = open ? (open.side === 'long' ? '추가 매수' : '매수·청산') : '매수';
    S.textContent = open ? (open.side === 'short' ? '추가 매도' : '매도·청산') : '매도';
  }
  const baseRenderPosMob = renderPos;
  renderPos = function () { baseRenderPosMob(); try { paintMob(); } catch (e) {} };

  // ============================================================ 2026-11-27 승주: 잔고 → 점수, 점수로 티어, 시장가 없앰, 하루 루틴·훈련
  // ---- 시장가 없앰: 주문 칸은 지정가만. 직접 청산(X·버튼·C·부분 청산)은 '지정가 추격 청산'으로
  { const mt = document.querySelector('#side .tabs [data-t="market"]'); if (mt) mt.classList.add('gHide'); }
  orderType = 'limit';
  const baseSubmitM = submit;
  submit = function (side) { orderType = 'limit'; return baseSubmitM(side); };
  const baseClosePosM = closePos;
  closePos = function (fp, reason) {
    if (fp == null && reason == null && open && cursor >= 0 && G.round && !G.round.done) {   // 사람이 누른 청산 → 지정가 추격
      if (reduces.some((r) => r.chase && r.amt >= open.notional * 0.999)) { flash('이미 지정가 청산 주문이 걸려 있어요. 다음 봉에서 닿으면 체결돼요.', 2500); return; }
      placeChase(open.notional);
      return;
    }
    return baseClosePosM(fp, reason);
  };
  partialClose = function (amt) { if (!open) return; placeChase(Math.min(amt, open.notional)); };
  if ($('btnPartial')) $('btnPartial').textContent = '지정가로 이만큼 청산 (추격)';
  if ($('btnClose')) $('btnClose').innerHTML = '지정가 청산 <kbd>X</kbd>';

  // ---- 점수: 매매(포지션 하나를 끝까지 청산)마다 과정 + 결과
  //   과정(최대 +10): 스탑 주문 +3 · 익절 주문 +2 · 계획 손익비 1.2 이상 +2 · 손실이 −1R 안 +2 · 원칙(손실 뒤 30분 안 재진입·물타기·스탑 넓힘 없음) +1
  //   결과: 1R 당 3점 (−6 ~ +9), 강제청산이면 −10 더. 그래서 원칙대로 진 매매도 보통 플러스
  const SC = { stop: 3, tp: 2, rr: 2, risk: 2, rule: 1, perR: 3, rMin: -6, rMax: 9, liq: -10, rrMin: 1.2, rrTol: 0.05, demote: 20 };
  const firstSet = (log, entryTurn) => { const s = (log || []).find((z) => z.from == null && z.to != null); return s && entryTurn != null && s.turn != null && s.turn - entryTurn <= 5 ? s.to : null; };
  function tradeRisk(tr) {                    // 진입 때(또는 5턴 안에) 건 스탑·익절과 계획 손익비
    const x = tr.x || {}, e = (tr.fills && tr.fills[0] && tr.fills[0].price) || tr.entry;
    const sl = x.slEntry != null ? x.slEntry : firstSet(x.slLog, x.entryTurn);
    const tp = x.tpEntry != null ? x.tpEntry : firstSet(x.tpLog, x.entryTurn);
    const rr = sl != null && tp != null && Math.abs(e - sl) > 0 ? Math.abs(tp - e) / Math.abs(e - sl) : null;
    const stopPct = sl != null ? Math.abs(e - sl) / e : 0.05;                        // 스탑이 없으면 5%를 1R 로
    const n0 = (tr.fills && tr.fills[0] && tr.fills[0].notional) || tr.notional || 1000;
    const R = tr.pnl / (n0 * stopPct);
    return { sl, tp, rr, R, e };
  }
  function scoreTrade(tr) {
    const x = tr.x || {}, k = tradeRisk(tr), parts = [];
    if (k.sl != null) parts.push(['스탑 주문', SC.stop]);
    if (k.tp != null) parts.push(['익절 주문', SC.tp]);
    if (k.rr != null && k.rr >= SC.rrMin - SC.rrTol) parts.push([`손익비 ${k.rr.toFixed(2)}`, SC.rr]);
    if (k.sl != null && k.R >= -1.05) parts.push(['손실 −1R 안', SC.risk]);
    const broke = (x.afterPrev && x.afterPrev.prevLoss && x.afterPrev.turns < 30) || (x.addsLosing > 0) || (x.slAway > 0);
    if (!broke) parts.push(['원칙 지킴', SC.rule]);
    const proc = parts.reduce((a, p) => a + p[1], 0);
    const res = Math.max(SC.rMin, Math.min(SC.rMax, k.R * SC.perR)) + (tr.liq ? SC.liq : 0);
    return { proc, res: Math.round(res * 10) / 10, total: Math.round((proc + res) * 10) / 10, parts, R: Math.round(k.R * 100) / 100, rr: k.rr };
  }
  const f1 = (v) => (v > 0 ? '+' : '') + (Math.round(v * 10) / 10).toFixed(1);
  function scoreMigrate() {                   // 처음 한 번: 점수제로 바꾸며 티어는 아이언부터 (2026-11-27). loadG 뒤에 부른다
    if (G.scoreV) return;
    G.scoreV = 1; G.score = 0; G.rank = 0; G.series = null; G.seriesCool = 0; G.scoreLog = []; acct.balance = SEED; acct.start = SEED; saveG();
  }
  const baseTradeHookS = tradeHook;
  tradeHook = function (tr) {
    baseTradeHookS(tr);
    if (!isTrade(tr)) return;
    try {
      const sc = scoreTrade(tr);
      tr.score = sc;
      G.score = Math.round(((G.score || 0) + sc.total) * 10) / 10;
      (G.scoreLog = G.scoreLog || []).push({ t: Date.now(), round: tr.round, total: sc.total, proc: sc.proc, res: sc.res, after: G.score });
      acct.balance = SEED;                    // 잔고는 쓰지 않는다: 주문용으로 늘 3,000 고정
      tierDrawn = null; updateRank(null);
      seriesToast(`<span class="ai">${sc.total >= 0 ? '⭐' : '💢'}</span><div><div class="dim" style="font-size:11px">이번 매매 점수</div><b class="${sc.total >= 0 ? 'up' : 'down'}">${f1(sc.total)}점</b> <span class="dim">(과정 ${sc.proc} · 결과 ${f1(sc.res)})</span><div class="dim" style="font-size:11px">${sc.parts.map((p) => p[0]).join(' · ') || '과정 점수 없음'}</div></div>`);
    } catch (e) { console.error(e); }
  };
  // 티어: 점수가 기준을 넘으면 바로 승급 (승급전 없음). 기준보다 20점 아래로 떨어질 때만 강등
  updateRank = function () {
    let rank = rankNow(); const sc = G.score || 0;
    G.series = null;
    let up = rank;
    while (up < TIERS.length - 1 && sc >= TIERS[up + 1].min) up++;
    if (up > rank) { G.rank = up; G.promoWins = (G.promoWins || 0) + 1; tierToast(up, true); sfx('tierUp'); }
    else if (rank > 0 && sc < TIERS[rank].min - SC.demote) { let d = rank; while (d > 0 && sc < TIERS[d].min - SC.demote) d--; G.rank = d; tierToast(d, false); sfx('tierDown'); }
    G.bestTier = Math.max(G.bestTier || 0, G.rank || 0);
    saveG();
  };
  tierBlock = function (i, size) {
    const t = TIERS[i], nx = TIERS[i + 1], sc = G.score || 0, ring = ringOf();
    const pct = nx ? Math.max(0, Math.min(100, (sc - t.min) / (nx.min - t.min) * 100)) : 100;
    const svg = ring ? `<span class="sring" style="--rc:${ring.c1}" title="지난 시즌 보상 테두리 (${ring.name})">${tierSvg(i, size)}</span>` : tierSvg(i, size);
    const ss = G.season ? `<div class="dim" style="font-size:10.5px">시즌 ${G.season.id.slice(5)}월 최고 <b style="color:${TIERS[G.season.best].c1}">${TIERS[G.season.best].name}</b></div>` : '';
    return `${svg}<div style="flex:1; min-width:0"><div class="tn" style="color:${t.c1}">${t.name} <small class="dim" style="font-weight:400">${t.en}</small> <b style="color:#fff; font-size:13px">${sc.toFixed(1)}점</b></div>` +
      `<div class="dim" style="font-size:11.5px">${nx ? `${nx.name}까지 ${Math.max(0, nx.min - sc).toFixed(1)}점` : '최고 티어'}</div><div class="tbar"><i style="width:${pct}%; background:${t.c1}"></i></div>${ss}</div>`;
  };
  // 자산 칸 → 점수 칸
  const roundScore = () => trades.filter((t) => G.round && t.round === G.round.id && t.score).reduce((a, t) => a + t.score.total, 0);
  const roundR = () => trades.filter((t) => G.round && t.round === G.round.id && t.score).reduce((a, t) => a + t.score.R, 0);
  const baseRenderAcctS = renderAcct;
  renderAcct = function () {
    baseRenderAcctS();
    if (!G) return;
    const last = [...trades].reverse().find((t) => t.score);
    $('gRoi').textContent = (G.score || 0).toFixed(1) + '점'; $('gRoi').className = 'ga-roi num';
    $('gEq').textContent = f1(roundScore()) + '점';
    $('gCash').innerHTML = last ? `<span class="${last.score.total >= 0 ? 'up' : 'down'}">${f1(last.score.total)}</span> <span class="dim">(과정 ${last.score.proc} · 결과 ${f1(last.score.res)})</span>` : '<span class="dim">-</span>';
    const rr = roundR(); $('gRpnl').innerHTML = `<span class="${cls(rr)}">${f1(rr)}R</span>`;
  };
  [['수익률 <small>(시드 3,000 대비)</small>', '총 점수'], ['평가자산', '이번 종목 점수'], ['현금 (주문 가능)', '마지막 매매 점수'], ['이번 종목 손익', '이번 종목 손익 (R)']].forEach(([a, b]) => {
    const el = [...document.querySelectorAll('#side .dim')].find((d) => d.innerHTML.trim() === a); if (el) el.innerHTML = b;
  });

  // ---- 하루 루틴: ① 오늘의 차트 1판 → ② 훈련 3판(추천 훈련 하나) → ③ 훈련 판마다 한 줄 복기 → ④ 주 1회 점검
  const DRILLS = {
    tp: { name: '① 익절 지키기', tip: '진입하면서 익절 주문을 걸고, 닿을 때까지 그대로 두기. 일찍 나오지 않기.',
      score: (ts) => ts.length ? Math.round(ts.filter((t) => tradeRisk(t).tp != null && (t.reason === 'tp' || (t.score && t.score.rr && t.score.R >= t.score.rr * 0.8))).length / ts.length * 100) : null },
    rr: { name: '② 계획 손익비 1.2', tip: '진입 전에 익절 거리 ÷ 스탑 거리가 1.2 이상인 자리만. 아니면 관망.',
      score: (ts) => ts.length ? Math.round(ts.filter((t) => { const r = tradeRisk(t).rr; return r != null && r >= SC.rrMin - SC.rrTol; }).length / ts.length * 100) : null },
    stop: { name: '③ 손절 자리', tip: '진입 전에 스탑을 걸고, 넓히지 않고, 손실은 −1R 안에서 끝내기.',
      score: (ts) => ts.length ? Math.round(ts.filter((t) => { const k = tradeRisk(t); return k.sl != null && k.R >= -1.05 && !(t.x && t.x.slAway > 0); }).length / ts.length * 100) : null },
  };
  const DRILL_N = 3;
  function recommendDrill() {                 // 최근 매매 20건에서 가장 약한 것
    const ts = trades.filter((t) => t.score).slice(-20);
    if (ts.length < 3) return 'tp';
    let best = 'tp', low = 101;
    for (const [k, d] of Object.entries(DRILLS)) { const v = d.score(ts); if (v != null && v < low) { low = v; best = k; } }
    return best;
  }
  function routine() {
    const day = todayKst();
    G.routine = G.routine || {};
    const r = G.routine[day] = G.routine[day] || { drill: null, rounds: [] };
    const drillRounds = G.rounds.filter((h) => h.drill && r.rounds.includes(h.rid));
    const weeklyDue = !G.weeklyAt || (Date.parse(day) - Date.parse(G.weeklyAt)) / 86400000 >= 7;
    return { day, r, s1: !!(G.daily && G.daily[day] && G.daily[day].done), drillRounds, s2: drillRounds.length >= DRILL_N, s3: drillRounds.length >= DRILL_N && drillRounds.every((h) => h.note), weeklyDue };
  }
  const baseOnRoundStart = onRoundStart;
  onRoundStart = function (r) {
    baseOnRoundStart(r);
    if (G.drillActive && !r.daily) { r.drill = G.drillActive; const ro = routine(); if (!ro.r.rounds.includes(r.id)) ro.r.rounds.push(r.id); }
  };
  function startDrill(key) {
    const ro = routine();
    ro.r.drill = key; G.drillActive = key; saveG();
    const go = () => { const r = G.round; if (r && !r.done) { if (!confirm('지금 하던 종목을 끝내고 훈련을 시작할까요?')) return; endRound(`${r.turn}턴에서 넘김`); } $('gResult').style.display = 'none'; startRound(); };
    if ($('gHome').style.display !== 'none') enterGame().then(() => go()); else go();
    closeModals();
  }
  function drillBanner() {
    let el = $('gDrillBar');
    if (!el) { el = document.createElement('div'); el.id = 'gDrillBar'; $('chartRow').appendChild(el); }
    const r = G && G.round, d = r && r.drill && DRILLS[r.drill];
    if (!d || r.done) { el.style.display = 'none'; return; }
    const ro = routine();
    el.style.display = 'flex';
    el.innerHTML = `<b>🏋️ 훈련 ${d.name}</b> <span class="dim">${Math.min(DRILL_N, ro.drillRounds.length + 1)}/${DRILL_N}판 · ${d.tip}</span>`;
  }
  // 결과 화면: 훈련 점수 + 한 줄 복기 + 루틴 다음 단계
  const baseShowResultR = showResult;
  showResult = function () {
    baseShowResultR();
    const h = G.rounds[G.rounds.length - 1]; if (!h) return;
    const mineT = trades.filter((t) => t.round === h.rid);
    const box = document.createElement('div'); box.className = 'gdrill';
    let html = '';
    if (h.drill && DRILLS[h.drill]) {
      if (h.drillScore === undefined) { h.drillScore = DRILLS[h.drill].score(mineT); saveG(); }
      html += `<div><b>🏋️ ${DRILLS[h.drill].name}</b> 훈련 점수 <b style="font-size:18px">${h.drillScore == null ? '관망 (매매 없음)' : h.drillScore + '점'}</b></div>` +
        `<div class="dim" style="font-size:12px">${DRILLS[h.drill].tip}</div>` +
        `<div style="display:flex; gap:6px; margin-top:6px"><input id="gNote" maxlength="80" placeholder="한 줄 복기: 실전의 나(👻)와 비교해서 다음엔?" value="${(h.note || '').replace(/"/g, '&quot;')}" style="flex:1"><button id="gNoteSave">저장</button></div>`;
    }
    const ro = routine();
    const next = !ro.s1 ? '① 오늘의 차트' : !ro.s2 ? `② 훈련 ${Math.min(DRILL_N, ro.drillRounds.length + 1)}/${DRILL_N}판` : !ro.s3 ? '③ 훈련 판 한 줄 복기' : ro.weeklyDue ? '④ 주간 점검' : '오늘 루틴 끝 🎉';
    html += `<div class="dim" style="margin-top:8px">오늘의 루틴 · 다음: <b style="color:#fff">${next}</b> <button id="gToRoutine" style="margin-left:6px">루틴 보기</button></div>`;
    box.innerHTML = html;
    const btns = $('gResBody').querySelector('#gResNext').parentElement;
    btns.before(box);
    if ($('gNoteSave')) $('gNoteSave').onclick = () => { h.note = $('gNote').value.trim(); saveG(); paintRoutineBtn(); flash('한 줄 복기를 저장했어요.', 1500); };
    $('gToRoutine').onclick = () => openRoutine();
    // 다음 판: 훈련 중이고 아직 3판이 안 됐으면 훈련 판으로 이어서, 다 했으면 훈련 끝
    if (G.drillActive && routine().drillRounds.length >= DRILL_N) { G.drillActive = null; saveG(); }
  };
  // 루틴 창
  const rtBox = document.createElement('div'); rtBox.id = 'gRoutine'; rtBox.className = 'gmodal'; document.body.appendChild(rtBox);
  rtBox.addEventListener('click', (e) => { if (e.target === rtBox) rtBox.style.display = 'none'; });
  function openRoutine() {
    const ro = routine(), rec = ro.r.drill || recommendDrill();
    const step = (n, done, title, body) => `<div class="rstep ${done ? 'done' : ''}"><div class="rn">${done ? '✓' : n}</div><div style="flex:1"><b>${title}</b><div class="dim" style="font-size:12px; margin-top:2px">${body}</div></div></div>`;
    const notes = ro.drillRounds.map((h, i) => `<div style="display:flex; gap:6px; align-items:center; margin-top:4px"><span class="dim" style="width:150px">${i + 1}판 · ${h.name} · ${h.drillScore == null ? '관망' : h.drillScore + '점'}</span><input data-rid="${h.rid}" maxlength="80" value="${(h.note || '').replace(/"/g, '&quot;')}" placeholder="한 줄 복기" style="flex:1"></div>`).join('');
    rtBox.innerHTML = `<div class="gm" style="width:560px"><div class="gmh"><b>📋 오늘의 루틴 (15~20분)</b><button data-x>닫기 (Esc)</button></div>` +
      step(1, ro.s1, '① 준비 1판: 오늘의 차트', ro.s1 ? `끝 (${f1(G.daily[ro.day].pct || 0)}%)` : `<button id="rtDaily">오늘의 차트 하기</button>`) +
      step(2, ro.s2, `② 훈련 ${DRILL_N}판: 한 가지만`, `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px">${Object.entries(DRILLS).map(([k, d]) => `<button data-drill="${k}" class="${k === rec ? 'rec' : ''}">${d.name}${k === recommendDrill() ? ' · 추천' : ''}</button>`).join('')}</div>` +
        `<div style="margin-top:4px">${ro.drillRounds.length}/${DRILL_N}판 했어요${ro.r.drill ? ` · 오늘 훈련: ${DRILLS[ro.r.drill].name}` : ''}. 한 주 동안 같은 훈련을 반복하는 게 좋아요.</div>`) +
      step(3, ro.s3, '③ 복기 1분씩: 실전의 나(👻)와 비교하고 한 줄', ro.drillRounds.length ? notes : '훈련 판을 하면 여기에 판마다 한 줄 칸이 생겨요.') +
      step(4, !ro.weeklyDue, '④ 주 1회: 훈련 점수 · 실전 숫자 보기', ro.weeklyDue ? `<button id="rtWeekly">주간 점검 열기</button>` : `이번 주 했어요 (${G.weeklyAt})`) +
      `<div class="dim" style="font-size:11.5px; margin-top:8px">추천 훈련 = 최근 매매 20건에서 가장 약한 항목. 점수: 과정(스탑·익절·손익비 1.2·−1R 안·원칙) + 결과(R).</div></div>`;
    rtBox.style.display = 'flex';
    rtBox.querySelector('[data-x]').onclick = () => { rtBox.style.display = 'none'; };
    if ($('rtDaily')) $('rtDaily').onclick = () => { rtBox.style.display = 'none'; $('gHome').style.display !== 'none' ? $('gDaily').click() : startDaily(); };
    rtBox.querySelectorAll('[data-drill]').forEach((b) => b.onclick = () => startDrill(b.dataset.drill));
    rtBox.querySelectorAll('input[data-rid]').forEach((inp) => inp.onchange = () => { const h = G.rounds.find((x) => String(x.rid) === inp.dataset.rid); if (h) { h.note = inp.value.trim(); saveG(); paintRoutineBtn(); } });
    if ($('rtWeekly')) $('rtWeekly').onclick = () => openWeekly();
  }
  function openWeekly() {
    const now = Date.now(), wk = 7 * 86400000;
    const logs = G.scoreLog || [];
    const thisW = logs.filter((l) => now - l.t < wk), prevW = logs.filter((l) => now - l.t >= wk && now - l.t < 2 * wk);
    const avg = (a, k) => (a.length ? a.reduce((s, x) => s + x[k], 0) / a.length : null);
    const ts = trades.filter((t) => t.score).slice(-20);
    const rows = Object.entries(DRILLS).map(([k, d]) => `<tr><td>${d.name}</td><td>${d.score(ts) == null ? '-' : d.score(ts) + '%'}</td></tr>`).join('');
    const dr = G.rounds.filter((h) => h.drill && h.drillScore != null).slice(-15);
    rtBox.innerHTML = `<div class="gm" style="width:560px"><div class="gmh"><b>🗓 주간 점검</b><button data-x>닫기</button></div>` +
      `<div class="gscs" style="grid-template-columns:repeat(3,1fr)"><div class="gsc"><div class="dim">이번 주 매매</div><b>${thisW.length}</b></div><div class="gsc"><div class="dim">평균 점수 (이번 주)</div><b>${avg(thisW, 'total') == null ? '-' : f1(avg(thisW, 'total'))}</b></div><div class="gsc"><div class="dim">평균 점수 (지난주)</div><b>${avg(prevW, 'total') == null ? '-' : f1(avg(prevW, 'total'))}</b></div>` +
      `<div class="gsc"><div class="dim">평균 과정 점수</div><b>${avg(thisW, 'proc') == null ? '-' : avg(thisW, 'proc').toFixed(1)} / 10</b></div><div class="gsc"><div class="dim">평균 결과 점수</div><b>${avg(thisW, 'res') == null ? '-' : f1(avg(thisW, 'res'))}</b></div><div class="gsc"><div class="dim">최근 훈련 판</div><b>${dr.length}</b></div></div>` +
      `<h4>게임 기록 최근 20건: 훈련 항목 달성률</h4><table class="gst">${rows}</table>` +
      `<h4>실전과 비교</h4><div class="dim" style="line-height:1.6">매매일지 사이트(127.0.0.1:8765) 홈의 <b>🎯 계획 손익비 vs 실제 R</b>(익절 실현률·손실 크기)과 위 숫자를 나란히 보세요. 게임에서 오른 항목이 2~3주 뒤 실전에서도 오르면 연습이 옮겨진 거예요. [📊 전적]의 분석용 내보내기 파일을 Claude 에게 보여 줘도 돼요.</div>` +
      `<button id="wkDone" style="margin-top:12px">이번 주 점검 끝</button></div>`;
    rtBox.style.display = 'flex';
    rtBox.querySelector('[data-x]').onclick = () => { rtBox.style.display = 'none'; };
    $('wkDone').onclick = () => { G.weeklyAt = todayKst(); saveG(); paintRoutineBtn(); openRoutine(); };
  }
  // 위 막대 '루틴' 버튼 (진행 상태), 시작 화면 루틴 카드
  const rtBtn = document.createElement('button'); rtBtn.className = 'gtopb'; rtBtn.id = 'gRtBtn'; rtBtn.onclick = () => { openRoutine(); rtBtn.blur(); };
  bar.insertBefore(rtBtn, $('gTimerBtn'));
  function paintRoutineBtn() {
    if (!G) return;
    const ro = routine(), done = [ro.s1, ro.s2, ro.s3, !ro.weeklyDue].filter(Boolean).length;
    rtBtn.textContent = `📋 오늘의 루틴 ${done}/4`;
    rtBtn.classList.toggle('on', done === 4);
    const hc = $('gHomeRoutine');
    if (hc) hc.innerHTML = `📋 오늘의 루틴 ${done}/4 · ${!ro.s1 ? '① 오늘의 차트부터' : !ro.s2 ? `② 훈련 ${ro.drillRounds.length}/${DRILL_N}판` : !ro.s3 ? '③ 한 줄 복기' : ro.weeklyDue ? '④ 주간 점검' : '오늘 끝 🎉'}`;
  }
  { const go = $('gGo'); const hb = document.createElement('button'); hb.className = 'go2'; hb.id = 'gHomeRoutine'; hb.style.cssText = 'background:#2c2c31; border:1px solid #52525b'; hb.onclick = () => openRoutine(); go.before(hb); }
  const baseRenderPosR = renderPos;
  renderPos = function () { baseRenderPosR(); try { drillBanner(); paintRoutineBtn(); } catch (e) {} };

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
    else if (c === 'KeyF' || c === 'KeyN') { e.preventDefault(); if (G.round && (G.round.done || !$('gNext').disabled)) nextCoin(); }
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
  scoreMigrate();
  function renderHome() {
    const roi = (acct.balance / SEED - 1) * 100;
    $('gHomeEq').textContent = (G.score || 0).toFixed(1) + '점';
    { const l = (G.scoreLog || []).slice(-10), a = l.length ? l.reduce((s2, x) => s2 + x.total, 0) / l.length : null;
      $('gHomeRoi').textContent = a == null ? '-' : (a > 0 ? '+' : '') + a.toFixed(1) + '점'; $('gHomeRoi').className = 'r num ' + cls(a || 0); }
    $('gGo').textContent = G.round || G.rounds.length ? '게임 이어하기' : '게임 시작';
    const i = rankNow(), t = TIERS[i];
    $('gHomeIco').innerHTML = tierSvg(i, 118);
    $('gHomeIco').style.background = `radial-gradient(circle, ${t.c2}66 0%, #1b2030 68%, transparent 71%)`;
    $('gHomeTier').textContent = t.name; $('gHomeTier').style.color = t.c1;
    $('gHomeTen').textContent = t.en + (G.bestTier > i ? ` · 최고 ${TIERS[G.bestTier].name}` : ''); $('gHomeTen').style.color = t.c1;
    $('gHomePlay').textContent = fmtDur(G.playMs || 0);
    $('gHomeAch').textContent = `${ACH.filter((a) => (G.ach || {})[a.k]).length} / ${ACH.length}`;
    const ds = dailyState();
    $('gDaily').textContent = ds.rec ? (ds.rec.done ? `📅 오늘의 차트 완료 (${sgn(ds.rec.pct)}%) · 결과 복사` : '📅 오늘의 차트 진행 중 → [게임 이어하기]') : '📅 오늘의 차트 (하루 한 번)';
    const nx = TIERS[i + 1], pct = nx ? Math.max(0, Math.min(100, (acct.balance - t.min) / (nx.min - t.min) * 100)) : 100;
    { const sc = G.score || 0, pc = nx ? Math.max(0, Math.min(100, (sc - t.min) / (nx.min - t.min) * 100)) : 100;   // 점수제 (2026-11-27)
      $('gHomeNext').innerHTML = `<div style="flex:1"><div class="dim" style="font-size:12px">${nx ? `<b style="color:${nx.c1}">${nx.name}</b>까지 ${Math.max(0, nx.min - sc).toFixed(1)}점` : '최고 티어에 도착했어요'}</div><div class="tbar"><i style="width:${pc}%; background:${t.c1}"></i></div></div>`; }
    $('gTierList').innerHTML = TIERS.map((x, k) => `<div class="${k === i ? 'me' : ''}">${tierSvg(k, 40)}<b style="color:${x.c1}">${x.name}</b><span class="dim">${usd(Math.max(x.min, k ? x.min : SEED)).replace('.00', '')}${k ? '~' : ' 시작'}</span></div>`).join('');
  }
  renderHome();
  paintReal();
  renderPos();
  async function enterGame() {             // 시작 화면을 닫고, 하던 종목이 있으면 다시 띄운다. 띄웠으면 true
    home.style.display = 'none';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // 차트 크기가 잡힌 뒤
    if (G.round) {
      let w = null;
      if (G.round.mine) { const m = mine && mine.rounds.find((x) => x.id === G.round.mine); w = m ? await buildMyWindow(m).catch(() => null) : null; }
      else {
        const c = index.coins.find((x) => x.short === G.round.short);
        w = c && c.periods[G.round.pk] ? await buildWindow(c.periods[G.round.pk], G.round.start) : null;
      }
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
  $('gHomeGhost').onclick = () => importGhost();
  $('gHomeReset').onclick = () => resetSeed();
  // 시드 초기화 (2026-11-25 승주 요청): 잔고 3,000 · 티어 아이언 · 승급전·연승/연패 처음부터. 하던 종목은 버리고 새로.
  // 지난 기록(종목·포지션·주문 기록, 업적, 플레이타임, 시즌 기록)은 그대로 두고, 초기화한 때를 기록에 남긴다.
  function resetSeed() {
    if (!confirm(`점수와 티어를 처음부터 할까요?\n\n· 점수 ${(G.score || 0).toFixed(1)} → 0\n· 티어 ${TIERS[rankNow()].name} → ${TIERS[0].name}, 연승 기록도 처음부터\n· 하던 종목(들고 있는 포지션·대기 주문 포함)은 버리고 새로 시작\n· 지난 종목·포지션 기록, 업적, 플레이타임은 그대로 남아요\n\n되돌릴 수 없어요.`)) return;
    (G.resets = G.resets || []).push({ at: Date.now(), balance: acct.balance, rank: rankNow() });
    for (const o of orders) if (o.status === '대기') o.status = '취소';
    open = null; pendEntry = null; reduces = [];
    acct.balance = SEED; acct.start = SEED;
    G.rank = 0; G.series = null; G.seriesCool = 0; G.streakW = 0; G.streakL = 0; G.round = null; G.score = 0; G.scoreLog = [];
    saveG();
    location.reload();
  }
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
    try { mine = JSON.parse(await fetchText('data/game/my_index.json')); } catch (e) { mine = null; }   // 없으면 원래 30종목만
    if (mine && mine.rounds && mine.rounds.length) $('gHomeNote').innerHTML += `<br>🔁 내가 매매한 차트 ${mine.rounds.length}판만 나와요 (모든 판에 그때 실전의 나 👻 고스트 · 아직 안 한 판 ${mineLeft().length}개)`;
    if (!index || !index.coins || !index.coins.length) {
      $('gGo').disabled = true; $('gDaily').disabled = true;
      // 왜 못 여는지 경우별로: 공개 사이트 링크 · 파일 더블클릭(file://) · 데이터를 아직 안 받음
      const zip = 'https://github.com/tmdwbk/chart-replay/archive/refs/heads/main.zip';
      const how = `<ol style="text-align:left; margin:8px 0 0; padding-left:18px; line-height:1.7">` +
        `<li><a href="${zip}" style="color:#a1a1aa">여기서 ZIP 받기</a> → 압축 풀기 (마우스 오른쪽 → 압축 풀기)</li>` +
        `<li>풀린 폴더에서 <b>START-CHART-GAME.bat</b> 더블클릭 (맥은 <b>start_game.command</b>)</li>` +
        `<li>까만 창이 알아서 준비하고 브라우저로 게임을 열어요. 그 창은 켜 두세요.</li></ol>`;
      const where = location.protocol === 'file:' ? '파일을 더블클릭해서 열면 차트 데이터를 읽을 수 없어요.'
        : /github\.io$/.test(location.hostname) ? '이 공개 링크에는 차트 데이터가 없어서(데이터 재배포 금지) 게임을 할 수 없어요. 내 컴퓨터에서 켜야 해요.'
        : '차트 데이터가 아직 없어요. 까만 창(START-CHART-GAME.bat)으로 켜면 처음 한 번 알아서 받아요.';
      $('gHomeNote').innerHTML = `<b style="color:#f0b90b">${where}</b>${how}`;
    }
  })();
})();
