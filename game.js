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
    if (btab !== 'rounds') return origBottom();
    renderBottomCounts();
    $('histFilter').style.display = 'none';
    const el = $('bbody'), h = G.rounds;
    if (!h.length) { el.innerHTML = '<div class="empty">아직 끝난 종목이 없어요.</div>'; return; }
    const tot = h.reduce((s, x) => s + x.pnl, 0), wins = h.filter((x) => x.pnl > 0).length;
    el.innerHTML = `<div class="dim" style="padding:6px 12px">${h.length}종목 · 손익 <b class="${cls(tot)}">${usdS(tot)}</b> · 이긴 종목 ${wins}/${h.length}</div>` +
      '<table><thead><tr><th>#</th><th>종목</th><th>기간 (KST)</th><th>턴</th><th>진입</th><th>손익</th><th>수익률</th><th>끝 잔고</th><th>끝난 이유</th></tr></thead><tbody>' +
      h.slice().reverse().map((x) => `<tr><td class="dim">${x.n}</td><td><b>${x.name}</b> <span class="dim">${x.short}</span></td>` +
        `<td class="dim">${origFmt(x.from)} ~ ${origFmt(x.to).slice(11)}</td><td>${x.turns}</td><td>${x.entries}회${x.liq ? ' <span class="down">강제청산</span>' : ''}</td>` +
        `<td class="${cls(x.pnl)}">${usdS(x.pnl)}</td><td class="${cls(x.pnl)}">${sgn(x.pnl / x.startCash * 100)}%</td><td>${usd(x.endCash)}</td><td class="dim">${x.why || ''}</td></tr>`).join('') +
      '</tbody></table>';
  };
  const origRenderPos = renderPos;
  renderPos = function () { origRenderPos(); if (G) saveG(); };

  // ------------------------------------------------------------ 화면 바꾸기
  const css = document.createElement('style');
  css.textContent = `
    #gHome { position:fixed; inset:0; z-index:100; background:#131722; display:flex; align-items:center; justify-content:center; }
    #gHome .card { width:390px; background:linear-gradient(180deg, #1b2a24 0%, #1a1f2b 55%); border:1px solid #2b3a33; border-radius:28px; padding:34px 26px 26px; text-align:center; box-shadow:0 18px 40px rgba(0,0,0,.45); }
    #gHome .ico { width:150px; height:150px; margin:0 auto 18px; border-radius:50%; background:radial-gradient(circle, #23493a 0%, #1b2f28 70%, transparent 72%); display:flex; align-items:center; justify-content:center; }
    #gHome .ico svg { width:84px; height:84px; filter:drop-shadow(0 6px 12px rgba(38,166,154,.35)); }
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
  tb.onclick = () => { btab = 'rounds'; document.querySelectorAll('.btabs .bt').forEach((x) => x.classList.toggle('on', x === tb)); renderBottom(); };
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
  const assetCard = mk('div', 'gcard', `<div class="ga-top"><div><div class="dim">수익률 <small>(시드 3,000 대비)</small></div><div id="gRoi" class="ga-roi num">+0.00%</div></div>` +
    `<div style="text-align:right"><div class="dim">평가자산</div><div id="gEq" class="ga-eq num">-</div></div></div><div class="ga-line"></div>` +
    `<div class="row2"><span class="dim">현금 (주문 가능)</span><span id="gCash" class="num">-</span></div>` +
    `<div class="row2"><span class="dim">보유 포지션</span><span id="gHold" class="num">없음</span></div>` +
    `<div class="row2"><span class="dim">이번 종목 손익</span><span id="gRpnl" class="num">-</span></div>`);
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
    const rp = r ? acct.balance + u - r.startBal : 0;
    $('gRpnl').innerHTML = r ? `<span class="${cls(rp)}">${usdS(rp)}</span>` : '-';
    const m = +$('margin').value || 0;
    $('gAvail').innerHTML = $('roChk').checked ? `줄일 증거금 ${usd(m)}${open ? ` · 지금 증거금 ${usd(open.margin)}` : ''}` :
      `주문 가능 ${usd(availBal())} · 이번 주문 증거금 ${usd(m)} → 크기 ${usd(m * LEV)}`;
    holdBtn.disabled = !r || r.done || starting;
  }
  // 시간 축: 턴 동안은 시:분만
  chart.applyOptions({ timeScale: { tickMarkFormatter: (t) => { const s = fmtKst(t - KST_OFF); return hidden() || s.slice(11) !== '00:00' ? s.slice(11) : s.slice(5, 10); } } });

  // ------------------------------------------------------------ 시작 화면
  const home = document.createElement('div'); home.id = 'gHome';
  home.innerHTML = `<a class="back" href="replay.html">← 차트 리플레이</a><div class="card">
    <div class="ico"><svg viewBox="0 0 64 64" fill="none"><path d="M6 46 L22 30 L32 38 L50 18" stroke="#3ddc97" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 16 H52 V28" stroke="#3ddc97" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 54 H58" stroke="#2c6b51" stroke-width="3" stroke-linecap="round"/></svg></div>
    <div class="kick">CHART GAME</div><h1>차트게임</h1>
    <p>거래량이 많았던 때의 주요 알트코인 30개 차트를 5분봉으로 랜덤하게 돌려 보며 직관을 키우는 연습이에요. 종목 하나에 50턴, 시드 3,000 USDT로 시작해 계속 이어집니다.</p>
    <div class="row"><span class="l">평가자산</span><span class="r num" id="gHomeEq">-</span></div>
    <div class="row"><span class="l">시드 대비</span><span class="r num" id="gHomeRoi">-</span></div>
    <button class="go" id="gGo">게임 시작</button>
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
  async function startRound() {
    if (starting) return;
    starting = true; stopPlay();
    const prevRound = G.round;
    $('gResult').style.display = 'none';
    renderTurn();
    try {
      const { pick, w } = await pickRound();
      G.n = (G.n || 0);
      G.round = { ...pick, id: Date.now(), turn: 1, startedAt: Date.now(), startBal: acct.balance, done: false };
      open = null; pendEntry = null; reduces = [];
      $('margin').value = DEF_MARGIN; pctPick = null; paintPcts();   // 새 종목마다 증거금 기본값으로
      drawings = []; saveDrawings();                     // 그린 것은 종목마다 새로
      showWindow(w, G.round);
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
      entries: mine.length, pnl: acct.balance - r.startBal, startCash: r.startBal, endCash: acct.balance, liq: mine.some((t) => t.liq), why });
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
      `<div class="dim">포지션 ${h.entries}번${h.liq ? ' · <span class="down">강제 청산 있음</span>' : ''} · 잔고 ${usd(h.endCash)}</div>` +
      `<button id="gResNext">다음종목 (N)</button> <button id="gResLook" style="background:#262b3c">차트 보기</button>`;
    $('gResult').style.display = 'flex';
    $('gResNext').onclick = () => startRound();
    $('gResLook').onclick = () => { $('gResult').style.display = 'none'; };
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

  // ------------------------------------------------------------ 키
  document.addEventListener('keydown', (e) => {
    if ($('gHome').style.display !== 'none') return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); step(1); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); if (G.round && (G.round.done || !$('gNext').disabled)) nextCoin(); }
  });

  // ------------------------------------------------------------ 시작
  loadG();
  function renderHome() {
    const roi = (acct.balance / SEED - 1) * 100;
    $('gHomeEq').textContent = usd(acct.balance);
    $('gHomeRoi').textContent = sgn(roi) + '%'; $('gHomeRoi').className = 'r num ' + cls(roi);
    $('gGo').textContent = G.round || G.rounds.length ? '게임 이어하기' : '게임 시작';
  }
  renderHome();
  renderPos();
  $('gGo').onclick = async () => {
    if (!index) return;
    home.style.display = 'none';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // 차트 크기가 잡힌 뒤
    if (G.round) {
      const c = index.coins.find((x) => x.short === G.round.short);
      const w = c && c.periods[G.round.pk] ? await buildWindow(c.periods[G.round.pk], G.round.start) : null;
      if (w) { showWindow(w, G.round); if (G.round.done) showResult(); return; }
      G.round = null; open = null; pendEntry = null; reduces = [];   // 데이터가 바뀌어 같은 차트를 못 찾으면 새로
    }
    startRound();
  };
  (async () => {
    try { index = JSON.parse(await fetchText('data/game/index.json')); } catch (e) { index = null; }
    if (!index || !index.coins || !index.coins.length) {
      $('gGo').disabled = true;
      $('gHomeNote').innerHTML = '차트게임 데이터가 없어요. 내 컴퓨터에서 <b>python3 fetch_game.py</b> 로 받은 뒤 로컬 서버(<b>python3 -m http.server 8765</b>)로 열어 주세요. 공개 사이트에는 차트 데이터가 없어요.';
    }
  })();
})();
