/* go-lattice: board rendering, controls, and the live physics panels. */
'use strict';

const el = id => document.getElementById(id);

const state = {
  board: null,
  history: [],          // {s, ko, captured} snapshots for undo
  toPlay: BLACK,
  human: BLACK,
  overlay: 'none',      // none | territory | gap | chamber
  thinking: false,
  selfPlay: false,
  useSearch: true,      // MCTS on by default; 'Score only' turns it off
  passes: 0,
  gameOver: false,
  komi: 0,
  series: [],           // per-move record for the plots
  lastMove: -1,
};

let searchWorker = null;
let botTimer = null;
let searchRevision = 0;

const params = () => ({
  J: +el('sJ').value, K: +el('sK').value, Delta: +el('sD').value,
  h: 0, alpha: +el('sA').value, beta: 1.0, lam: 1.0,
});

/* ------------------------------------------------------------- drawing -- */

const BOARD_BG = '#e8c88a';

function drawBoard() {
  const cv = el('board'), ctx = cv.getContext('2d');
  const b = state.board, n = b.n;
  const S = cv.width;
  const pad = S / (n + 1) * 0.85;
  const step = (S - 2 * pad) / (n - 1);
  const xy = i => [pad + (i % n) * step, pad + (((i / n) | 0)) * step];

  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, S, S);

  // overlays sit under the grid so lines stay readable
  if (state.overlay !== 'none') drawOverlay(ctx, step, pad, xy);

  // grid
  ctx.strokeStyle = 'rgba(60,40,15,.55)';
  ctx.lineWidth = Math.max(1, S / 900);
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    ctx.moveTo(pad, pad + k * step); ctx.lineTo(S - pad, pad + k * step);
    ctx.moveTo(pad + k * step, pad); ctx.lineTo(pad + k * step, S - pad);
  }
  ctx.stroke();

  // star points
  const k = n >= 13 ? 3 : 2, mid = (n - 1) / 2;
  const stars = n % 2 ? [k, mid, n - 1 - k] : [k, n - 1 - k];
  ctx.fillStyle = 'rgba(50,32,10,.8)';
  for (const r of stars) for (const c of stars) {
    if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
    const [x, y] = xy(r * n + c);
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, step * .08), 0, 7); ctx.fill();
  }

  // stones
  const rad = step * 0.46;
  for (let i = 0; i < b.s.length; i++) {
    if (b.s[i] === EMPTY) continue;
    const [x, y] = xy(i);
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 7);
    ctx.fillStyle = b.s[i] === BLACK ? '#141414' : '#f6f4ef';
    ctx.fill();
    ctx.lineWidth = Math.max(1, S / 1000);
    ctx.strokeStyle = b.s[i] === BLACK ? '#000' : '#b9b4a8';
    ctx.stroke();
  }

  // last move marker
  if (state.lastMove >= 0 && b.s[state.lastMove] !== EMPTY) {
    const [x, y] = xy(state.lastMove);
    ctx.beginPath(); ctx.arc(x, y, rad * .34, 0, 7);
    ctx.fillStyle = b.s[state.lastMove] === BLACK ? '#f2f2f2' : '#333';
    ctx.fill();
  }
}

function drawOverlay(ctx, step, pad, xy) {
  const b = state.board;
  const topo = topologySummary(b);

  if (state.overlay === 'territory') {
    for (let i = 0; i < b.s.length; i++) {
      if (b.s[i] !== EMPTY) continue;
      const o = topo.ownerMap[i];
      if (o === 0) continue;
      const [x, y] = xy(i);
      ctx.fillStyle = o === BLACK ? 'rgba(20,20,20,.30)' : 'rgba(47,111,111,.30)';
      ctx.fillRect(x - step / 2, y - step / 2, step, step);
    }
  } else if (state.overlay === 'chamber') {
    topo.chambers.forEach((ch, k) => {
      const hue = (k * 47) % 360;
      ctx.fillStyle = `hsla(${hue},62%,52%,.30)`;
      for (const i of ch) {
        const [x, y] = xy(i);
        ctx.fillRect(x - step / 2, y - step / 2, step, step);
      }
    });
  } else if (state.overlay === 'gap') {
    const p = params();
    for (const colour of [BLACK, WHITE]) {
      for (const g of libertyGaps(b, colour, p.lam)) {
        // low gap = hot = in danger
        const t = Math.min(1, g.gap / 4);
        const hue = 8 + t * 108;                 // red -> green
        ctx.fillStyle = `hsla(${hue},78%,48%,.42)`;
        for (const i of g.stones) {
          const [x, y] = xy(i);
          ctx.fillRect(x - step / 2, y - step / 2, step, step);
        }
      }
    }
  }
}

/* -------------------------------------------------------------- panels -- */

function refreshPanels(record = false) {
  const b = state.board, p = params();
  const topo = topologySummary(b);

  el('tB0').textContent = topo.beta0Empty;
  el('tEnc').textContent = topo.enclosure;
  el('tTB').textContent = topo.territoryBlack;
  el('tTW').textContent = topo.territoryWhite;
  el('tCB').textContent = b.captured[BLACK];
  el('tCW').textContent = b.captured[WHITE];

  // liberty gap bars, most endangered first
  const rows = [];
  for (const colour of [BLACK, WHITE]) {
    for (const g of libertyGaps(b, colour, p.lam)) rows.push({ colour, ...g });
  }
  rows.sort((a, c) => a.gap - c.gap);
  el('gaps').innerHTML = rows.slice(0, 14).map(g => {
    const t = Math.min(1, g.gap / 4);
    const hue = 8 + t * 108;
    const pct = Math.max(3, t * 100);
    const fill = g.colour === BLACK ? '#181818' : '#f4f2ee';
    const border = g.colour === BLACK ? '#000' : '#b9b4a8';
    return `<div class="gap">
      <span class="dot" style="background:${fill};border-color:${border}"></span>
      <span class="bar"><i style="width:${pct}%;background:hsl(${hue},72%,46%)"></i></span>
      <span class="gapv">${g.gap.toFixed(2)}</span>
    </div>`;
  }).join('') || '<div class="gapv">no groups yet</div>';

  // Record only a committed turn (or the initial position), never a redraw.
  if (record) {
    const ldB = logDetColour(b, BLACK, p.lam);
    const ldW = logDetColour(b, WHITE, p.lam);
    state.series.push({
      ldB: ldB === null ? 0 : ldB,
      ldW: ldW === null ? 0 : ldW,
      tb: topo.territoryBlack, tw: topo.territoryWhite, enc: topo.enclosure,
    });
  }
  drawPlots();
}

function drawSeries(canvasId, series, keys, colours, opts = {}) {
  const cv = el(canvasId), ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height, pad = 22;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fcfbf9'; ctx.fillRect(0, 0, W, H);

  if (series.length < 2) {
    ctx.fillStyle = '#9a9a9a'; ctx.font = '22px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('play a few moves', W / 2, H / 2);
    return;
  }

  let lo = Infinity, hi = -Infinity;
  for (const row of series) for (const k of keys) {
    lo = Math.min(lo, row[k]); hi = Math.max(hi, row[k]);
  }
  if (opts.fromZero) lo = Math.min(0, lo);
  if (hi - lo < 1e-9) { hi = lo + 1; }
  const px = i => pad + i / (series.length - 1) * (W - 2 * pad);
  const py = v => H - pad - (v - lo) / (hi - lo) * (H - 2 * pad);

  // axes
  ctx.strokeStyle = '#e4e1dc'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();

  keys.forEach((k, ki) => {
    ctx.beginPath();
    series.forEach((row, i) => (i ? ctx.lineTo(px(i), py(row[k])) : ctx.moveTo(px(i), py(row[k]))));
    ctx.strokeStyle = colours[ki]; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.stroke();
  });

  ctx.fillStyle = '#9a9a9a'; ctx.font = '18px Inter, sans-serif';
  ctx.textAlign = 'left';  ctx.fillText(hi.toFixed(1), 4, pad + 6);
  ctx.fillText(lo.toFixed(1), 4, H - pad + 2);
}

function drawPlots() {
  drawSeries('plotDet', state.series, ['ldB', 'ldW'], ['#181818', '#2f6f6f']);
  drawSeries('plotTerr', state.series, ['tb', 'tw', 'enc'],
             ['#181818', '#2f6f6f', '#c0862f'], { fromZero: true });
}

/* --------------------------------------------------------------- game -- */

function snapshot() {
  const b = state.board;
  state.history.push({
    s: Int8Array.from(b.s), ko: b.ko,
    captured: { 1: b.captured[1], '-1': b.captured['-1'] },
    toPlay: state.toPlay, lastMove: state.lastMove, passes: state.passes,
    gameOver: state.gameOver,
    seriesLen: state.series.length,
  });
}

function setStatus(msg) { el('status').innerHTML = msg; }

function updateControls() {
  const humanTurn = state.toPlay === state.human;
  el('pass').disabled = state.gameOver || state.thinking || state.selfPlay || !humanTurn;
  el('undo').disabled = !state.history.length;
  el('selfPlay').disabled = state.gameOver;
  el('selfPlay').textContent = state.selfPlay ? 'Stop' : 'Watch it play itself';
  el('selfPlay').classList.toggle('primary', state.selfPlay);
  el('selfPlay').setAttribute('aria-pressed', String(state.selfPlay));
  el('resumeBot').hidden = state.gameOver || state.thinking || state.selfPlay || humanTurn;
  el('board').setAttribute('aria-busy', String(state.thinking));
}

// A terminated worker can still have a queued message. The revision makes both
// those messages and delayed callbacks harmless after any position change.
function cancelSearch() {
  searchRevision++;
  clearTimeout(botTimer);
  botTimer = null;
  if (searchWorker) searchWorker.terminate();
  searchWorker = null;
  state.thinking = false;
}

function newGame() {
  cancelSearch();
  const n = +el('size').value;
  state.board = new Board(n);
  state.history = [];
  state.human = BLACK;
  state.toPlay = BLACK;
  state.passes = 0;
  state.gameOver = false;
  state.selfPlay = false;
  state.lastMove = -1;
  state.series = [];
  drawBoard();
  refreshPanels(true);
  showSearchStats(null);
  updateControls();
  setStatus('Your move &mdash; you are <strong>Black</strong>.');
}

function finishGame() {
  state.gameOver = true;
  state.selfPlay = false;
  const topo = topologySummary(state.board);
  let black = topo.territoryBlack, white = topo.territoryWhite;
  for (const stone of state.board.s) {
    if (stone === BLACK) black++;
    else if (stone === WHITE) white++;
  }
  white += state.komi;
  const margin = black - white;
  const result = margin === 0 ? 'Draw.'
    : `<strong>${margin > 0 ? 'Black' : 'White'} wins by ${Math.abs(margin)}.</strong>`;
  setStatus(`Both passed &mdash; game over. ${result} Black ${black}, White ${white} (including ${state.komi} komi).`);
  updateControls();
}

function applyTurn(move, colour) {
  snapshot();
  let removed = [];
  if (move < 0) {
    state.board.pass();
    state.passes++;
    state.lastMove = -1;
  } else {
    removed = state.board.play(move, colour);
    state.passes = 0;
    state.lastMove = move;
  }
  state.toPlay = -colour;
  drawBoard();
  refreshPanels(true);
  if (state.passes >= 2) finishGame();
  else updateControls();
  return removed;
}

function humanPlay(i) {
  if (state.gameOver || state.thinking || state.selfPlay || state.toPlay !== state.human) return;
  if (!state.board.isLegal(i, state.human)) {
    setStatus('That move is illegal &mdash; occupied, suicide, or ko.');
    return;
  }
  const removed = applyTurn(i, state.human);
  queueBot(removed.length ? `You captured <strong>${removed.length}</strong>. Thinking&hellip;` : 'Thinking&hellip;');
}

function humanPass() {
  if (state.gameOver || state.thinking || state.selfPlay || state.toPlay !== state.human) return;
  applyTurn(-1, state.human);
  if (!state.gameOver) queueBot('You passed. Thinking&hellip;');
}

function queueBot(message = 'Thinking&hellip;', delay = 50) {
  if (state.gameOver || state.thinking) return;
  state.thinking = true;
  const revision = searchRevision;
  updateControls();
  setStatus(message);
  botTimer = setTimeout(() => {
    botTimer = null;
    if (revision === searchRevision && state.thinking && !state.gameOver) botMove(revision);
  }, delay);
}

function searchFailed(revision) {
  if (revision !== searchRevision) return;
  cancelSearch();
  state.selfPlay = false;
  showSearchStats(null);
  updateControls();
  setStatus('The move engine could not finish. Retry with Resume bot or Undo. If opened as a local file, serve this page over HTTP so its worker can load.');
}

function botMove(revision) {
  const colour = state.toPlay;
  const opts = {
    budgetMs: +el('strength').value,
    temperature: +el('sTemp').value,
    wTerritory: +el('sT').value,
    wCapture: 2.0,
    candidates: state.useSearch ? (state.board.n >= 19 ? 30 : 40) : (state.board.n >= 19 ? 60 : 80),
    shortlist: state.board.n >= 19 ? 10 : 12,
    replyWidth: state.board.n >= 19 ? 10 : 12,
    passes: state.passes,
    komi: state.komi,
  };
  try {
    if (!searchWorker) searchWorker = new Worker('search-worker.js');
    searchWorker.onmessage = ({ data }) => {
      if (revision !== searchRevision || data.revision !== revision || !state.thinking || colour !== state.toPlay) return;
      if (data.error || !Number.isInteger(data.move) || data.move < -1 ||
          (data.move >= 0 && !state.board.isLegal(data.move, colour))) {
        searchFailed(revision);
        return;
      }
      // Completing a request also invalidates a duplicate delivery.
      searchRevision++;
      state.thinking = false;
      showSearchStats(data.stats);
      const removed = applyTurn(data.move, colour);
      if (state.gameOver) return;
      const who = colour === BLACK ? 'Black' : 'White';
      const message = data.move < 0 ? `<strong>${who}</strong> passed.`
        : removed.length ? `<strong>${who}</strong> captured <strong>${removed.length}</strong>.`
        : `<strong>${who}</strong> played.`;
      if (state.selfPlay) queueBot(`${message} Thinking&hellip;`, 120);
      else setStatus(`${message} Your move &mdash; you are <strong>Black</strong>.`);
    };
    searchWorker.onerror = event => {
      event.preventDefault();
      searchFailed(revision);
    };
    searchWorker.postMessage({
      revision, colour, params: params(), opts, useSearch: state.useSearch,
      board: { n: state.board.n, s: state.board.s, ko: state.board.ko, captured: state.board.captured },
    });
  } catch (_) {
    searchFailed(revision);
  }
}

function showSearchStats(st) {
  if (!st) {
    for (const id of ['tIters', 'tWin', 'tVisits', 'tKids']) el(id).textContent = '\u2014';
    return;
  }
  el('tIters').textContent = st.iterations.toLocaleString();
  el('tWin').textContent = st.winRate == null ? '\u2014' : (100 * st.winRate).toFixed(0) + '%';
  el('tVisits').textContent = st.visits.toLocaleString();
  el('tKids').textContent = st.children;
}

function undo() {
  if (!state.history.length) return;
  cancelSearch();
  state.selfPlay = false;
  // step back over the bot's reply and your own move
  for (let k = 0; k < 2 && state.history.length; k++) {
    const h = state.history.pop();
    state.board.s.set(h.s);
    state.board.ko = h.ko;
    state.board.captured = h.captured;
    state.toPlay = h.toPlay;
    state.lastMove = h.lastMove;
    state.passes = h.passes;
    state.gameOver = h.gameOver;
    state.series.length = h.seriesLen;
    if (state.toPlay === state.human) break;
  }
  drawBoard(); refreshPanels();
  showSearchStats(null);
  updateControls();
  setStatus('Taken back. Your move.');
}

/* ------------------------------------------------------------- wiring -- */

function boardClickTarget(ev) {
  const cv = el('board'), rect = cv.getBoundingClientRect();
  const n = state.board.n, S = cv.width;
  const pad = S / (n + 1) * 0.85, step = (S - 2 * pad) / (n - 1);
  const x = (ev.clientX - rect.left) * (S / rect.width);
  const y = (ev.clientY - rect.top) * (S / rect.height);
  const c = Math.round((x - pad) / step), r = Math.round((y - pad) / step);
  if (r < 0 || c < 0 || r >= n || c >= n) return -1;
  const [cx, cy] = [pad + c * step, pad + r * step];
  if (Math.hypot(x - cx, y - cy) > step * 0.55) return -1;
  return r * n + c;
}

function wire() {
  el('board').addEventListener('click', ev => {
    const i = boardClickTarget(ev);
    if (i >= 0) humanPlay(i);
  });

  el('newGame').addEventListener('click', newGame);
  el('size').addEventListener('change', newGame);
  el('pass').addEventListener('click', humanPass);
  el('undo').addEventListener('click', undo);
  el('resumeBot').addEventListener('click', () => {
    if (state.toPlay !== state.human) queueBot();
  });

  el('engineMcts').addEventListener('click', () => {
    state.useSearch = true;
    el('engineMcts').classList.add('primary');
    el('enginePolicy').classList.remove('primary');
    el('engineMcts').setAttribute('aria-pressed', 'true');
    el('enginePolicy').setAttribute('aria-pressed', 'false');
  });
  el('enginePolicy').addEventListener('click', () => {
    state.useSearch = false;
    el('enginePolicy').classList.add('primary');
    el('engineMcts').classList.remove('primary');
    el('enginePolicy').setAttribute('aria-pressed', 'true');
    el('engineMcts').setAttribute('aria-pressed', 'false');
    showSearchStats(null);
  });

  el('selfPlay').addEventListener('click', () => {
    if (state.gameOver) return;
    if (state.selfPlay) {
      state.selfPlay = false;
      cancelSearch();
      updateControls();
      setStatus(state.toPlay === state.human ? 'Stopped. Your move &mdash; you are <strong>Black</strong>.'
        : 'Stopped. White to play &mdash; Resume bot to continue.');
    } else {
      state.selfPlay = true;
      updateControls();
      queueBot();
    }
  });

  const overlays = { ovNone: 'none', ovTerr: 'territory', ovGap: 'gap', ovChamber: 'chamber' };
  for (const [id, mode] of Object.entries(overlays)) {
    el(id).addEventListener('click', () => {
      state.overlay = mode;
      for (const other of Object.keys(overlays)) {
        el(other).classList.toggle('primary', other === id);
        el(other).setAttribute('aria-pressed', String(other === id));
      }
      drawBoard();
    });
  }

  /* Keep the scoring panel showing the live coefficients, and light up the row
   * a slider controls so it is obvious which term is being moved. */
  const signed = x => (x >= 0 ? '+' : '\u2212') + Math.abs(x).toFixed(2);

  function refreshFormula() {
    const J = +el('sJ').value, K = +el('sK').value, D = +el('sD').value;
    const A = +el('sA').value, T = +el('sT').value, TE = +el('sTemp').value;
    el('fDelta').textContent = signed(1.4 * D);
    el('fAlpha').textContent = A.toFixed(2) + ' \u00d7';
    el('fJ').textContent = signed(-0.20 * J) + ' \u00d7';
    el('fK').textContent = signed(0.25 * K) + ' \u00d7';
    el('fTerr').textContent = signed(-0.35 * T) + ' \u00d7';
    el('fTemp').textContent = TE.toFixed(2);
  }

  let litTimer = null;
  function light(term) {
    document.querySelectorAll('.frow.lit, .fsum.lit')
      .forEach(n => n.classList.remove('lit'));
    document.querySelectorAll(`[data-term="${term}"]`).forEach(n => {
      if (n.classList.contains('frow') || n.classList.contains('fsum')) n.classList.add('lit');
    });
    clearTimeout(litTimer);
    litTimer = setTimeout(() => {
      document.querySelectorAll('.frow.lit, .fsum.lit')
        .forEach(n => n.classList.remove('lit'));
    }, 1400);
  }

  for (const [s, v, d] of [['sJ','vJ',2],['sK','vK',2],['sD','vD',2],
                           ['sA','vA',2],['sT','vT',2],['sTemp','vTemp',2]]) {
    const upd = () => { el(v).textContent = (+el(s).value).toFixed(d); };
    el(s).addEventListener('input', () => {
      upd();
      refreshFormula();
      light(el(s).dataset.term);
      if (state.overlay === 'gap') drawBoard();
    });
    upd();
  }
  refreshFormula();

  // keep the canvas crisp on high-dpi screens
  const cv = el('board');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = 640 * dpr; cv.height = 640 * dpr;
  for (const id of ['plotDet', 'plotTerr']) {
    const p = el(id);
    p.width = 700 * dpr; p.height = 220 * dpr;
  }
}

wire();
newGame();
