/* go-lattice: the model, in the browser.
 *
 * A direct port of the golattice Python package. Everything the plots show is
 * computed here from the position, and the engine scores moves with the same
 * quantities -- there is no separate heuristic hiding behind the graphs.
 */
'use strict';

const EMPTY = 0, BLACK = 1, WHITE = -1;

/* ---------------------------------------------------------------- board -- */

class Board {
  constructor(size) {
    this.n = size;
    this.s = new Int8Array(size * size);
    this.ko = -1;
    this.captured = { 1: 0, '-1': 0 };
  }

  clone() {
    const b = new Board(this.n);
    b.s.set(this.s);
    b.ko = this.ko;
    b.captured = { 1: this.captured[1], '-1': this.captured['-1'] };
    return b;
  }

  nbrs(i) {
    const n = this.n, r = (i / n) | 0, c = i % n, out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }

  /** Connected same-colour component containing i, plus its liberty set. */
  group(i) {
    const colour = this.s[i];
    if (colour === EMPTY) return { stones: [], libs: [] };
    const seen = new Set([i]), stack = [i], libs = new Set();
    while (stack.length) {
      const j = stack.pop();
      for (const k of this.nbrs(j)) {
        if (this.s[k] === EMPTY) libs.add(k);
        else if (this.s[k] === colour && !seen.has(k)) { seen.add(k); stack.push(k); }
      }
    }
    return { stones: [...seen], libs: [...libs] };
  }

  groups(colour) {
    const seen = new Set(), out = [];
    for (let i = 0; i < this.s.length; i++) {
      if (this.s[i] === colour && !seen.has(i)) {
        const g = this.group(i);
        g.stones.forEach(x => seen.add(x));
        out.push(g);
      }
    }
    return out;
  }

  /** l_i: empty sites adjacent to i. This is the root weight before lambda. */
  libertyCount(i) {
    let c = 0;
    for (const j of this.nbrs(i)) if (this.s[j] === EMPTY) c++;
    return c;
  }

  isLegal(i, colour) {
    if (i < 0 || i >= this.s.length || this.s[i] !== EMPTY) return false;
    if (i === this.ko) return false;
    const t = this.clone();
    t.s[i] = colour;
    for (const j of t.nbrs(i)) {
      if (t.s[j] === -colour && t.group(j).libs.length === 0) return true;
    }
    return t.group(i).libs.length > 0;   // no suicide
  }

  play(i, colour) {
    this.s[i] = colour;
    const removed = [];
    for (const j of this.nbrs(i)) {
      if (this.s[j] === -colour) {
        const g = this.group(j);
        if (g.libs.length === 0) {
          for (const k of g.stones) { this.s[k] = EMPTY; removed.push(k); }
        }
      }
    }
    this.captured[colour] += removed.length;
    const own = this.group(i);
    this.ko = (removed.length === 1 && own.stones.length === 1 && own.libs.length === 1)
      ? removed[0] : -1;
    return removed;
  }

  legalMoves(colour) {
    const out = [];
    for (let i = 0; i < this.s.length; i++) if (this.isLegal(i, colour)) out.push(i);
    return out;
  }
}

/* ----------------------------------------------------------- laplacian -- */

/** M = L + R for one group, dense and symmetric. */
function groupMatrix(board, stones, lam) {
  const pos = new Map();
  stones.forEach((s, k) => pos.set(s, k));
  const n = stones.length;
  const M = Array.from({ length: n }, () => new Float64Array(n));
  for (const s of stones) {
    const a = pos.get(s);
    for (const t of board.nbrs(s)) {
      const b = pos.get(t);
      if (b !== undefined) { M[a][a] += 1; M[a][b] -= 1; }
    }
    M[a][a] += lam * board.libertyCount(s);
  }
  return M;
}

/** Cholesky log-determinant. Returns null when M is not positive definite,
 *  which happens exactly when some group has no liberty. */
function logDetSPD(M) {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  let ld = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 1e-12) return null;      // singular => a dead group
        L[i][i] = Math.sqrt(sum);
        ld += 2 * Math.log(L[i][i]);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return ld;
}

/** Smallest eigenvalue by inverse-free power iteration on (cI - M). */
function smallestEigenvalue(M) {
  const n = M.length;
  if (n === 0) return Infinity;
  if (n === 1) return M[0][0];
  let c = 0;
  for (let i = 0; i < n; i++) {          // Gershgorin bound on the spectrum
    let radius = 0;
    for (let j = 0; j < n; j++) if (j !== i) radius += Math.abs(M[i][j]);
    c = Math.max(c, M[i][i] + radius);
  }
  let v = new Float64Array(n).fill(1 / Math.sqrt(n));
  let lambda = 0;
  for (let iter = 0; iter < 200; iter++) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let acc = c * v[i];
      for (let j = 0; j < n; j++) acc -= M[i][j] * v[j];
      w[i] = acc;
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += w[i] * w[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-14) break;
    for (let i = 0; i < n; i++) w[i] /= norm;
    const diff = w.reduce((a, x, i) => a + Math.abs(x - v[i]), 0);
    v = w;
    lambda = c - norm;
    if (diff < 1e-11) break;
  }
  return Math.max(0, lambda);
}

/** lambda_min(L+R) per group: the liberty gap. Zero means dead. */
function libertyGaps(board, colour, lam) {
  return board.groups(colour).map(g => ({
    stones: g.stones,
    libs: g.libs.length,
    gap: smallestEigenvalue(groupMatrix(board, g.stones, lam)),
  }));
}

/** sum_groups log det(L+R); null if any group of this colour is dead. */
function logDetColour(board, colour, lam) {
  let total = 0;
  for (const g of board.groups(colour)) {
    const ld = logDetSPD(groupMatrix(board, g.stones, lam));
    if (ld === null) return null;
    total += ld;
  }
  return total;
}

/* ------------------------------------------------------------ topology -- */

/** 4-connected components of empty space: beta_0(E_s). */
function chambers(board) {
  const n = board.n, seen = new Uint8Array(board.s.length), out = [];
  for (let i = 0; i < board.s.length; i++) {
    if (board.s[i] !== EMPTY || seen[i]) continue;
    const comp = [i], stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      for (const k of board.nbrs(j)) {
        if (board.s[k] === EMPTY && !seen[k]) { seen[k] = 1; comp.push(k); stack.push(k); }
      }
    }
    out.push(comp);
  }
  return out;
}

function chamberOwner(board, chamber) {
  let black = false, white = false;
  for (const i of chamber) {
    for (const j of board.nbrs(i)) {
      if (board.s[j] === BLACK) black = true;
      else if (board.s[j] === WHITE) white = true;
    }
  }
  if (black && !white) return BLACK;
  if (white && !black) return WHITE;
  return EMPTY;
}

/** Everything the panels need, in one sweep over the position. */
function topologySummary(board) {
  const chs = chambers(board);
  let tb = 0, tw = 0, tn = 0, largest = 0;
  const owner = new Int8Array(board.s.length);
  for (const ch of chs) {
    const o = chamberOwner(board, ch);
    for (const i of ch) owner[i] = o;
    if (o === BLACK) { tb += ch.length; largest = Math.max(largest, ch.length); }
    else if (o === WHITE) { tw += ch.length; largest = Math.max(largest, ch.length); }
    else tn += ch.length;
  }
  // Alexander duality: beta_1 of the barrier equals the number of complement
  // components; the board edge supplies one trivial cycle, hence the -1.
  const beta1 = chs.length;
  return {
    beta0Empty: chs.length,
    beta1Barrier: beta1,
    enclosure: Math.max(0, beta1 - 1),
    territoryBlack: tb,
    territoryWhite: tw,
    territoryNeutral: tn,
    largestOwned: largest,
    ownerMap: owner,
    chambers: chs,
  };
}

/* ---------------------------------------------------------- hamiltonian -- */

/** H_0: BEG bond energy, each edge counted once. */
function h0(board, p) {
  const n = board.n;
  let e = 0, stones = 0, m = 0;
  for (let i = 0; i < board.s.length; i++) {
    const si = board.s[i], r = (i / n) | 0, c = i % n;
    if (si !== EMPTY) { stones++; m += si; }
    if (c < n - 1) {
      const sj = board.s[i + 1];
      e += -p.J * si * sj - p.K * si * si * sj * sj;
    }
    if (r < n - 1) {
      const sj = board.s[i + n];
      e += -p.J * si * sj - p.K * si * si * sj * sj;
    }
  }
  return e + p.Delta * stones - p.h * m;
}

/** H_eff = H_0 - (alpha/beta) sum_c log det M_c. Infinite if a group is dead. */
function hEff(board, p) {
  const lb = logDetColour(board, BLACK, p.lam);
  const lw = logDetColour(board, WHITE, p.lam);
  if (lb === null || lw === null) return Infinity;
  return h0(board, p) - (p.alpha / p.beta) * (lb + lw);
}

/* --------------------------------------------------------------- engine -- */

/* Tactical layer, read straight off the root weights.
 *
 * l_i -- the number of empty points next to stone i -- is exactly the diagonal
 * of R in M = L + R, and a group in atari is one whose liberty gap is about to
 * collapse. So these are not heuristics bolted onto the physics; they are the
 * same quantities, evaluated by counting instead of by diagonalising. Counting
 * is what makes the bot fast enough to search a useful number of candidates,
 * and the eigenvalue is kept for the plots and for the strategic terms.
 */

/** Total size of this colour's groups that are down to one liberty. */
function atariWeight(board, colour) {
  let w = 0;
  for (const g of board.groups(colour)) {
    if (g.libs.length === 1) w += Math.min(g.stones.length, 8);
  }
  return w;
}

/** Sum of liberties over this colour's groups: the colour's total breathing room. */
function totalLiberties(board, colour) {
  let t = 0;
  for (const g of board.groups(colour)) t += g.libs.length;
  return t;
}

/** True if `i` is a single-point eye of `colour`. Filling one destroys an H^0
 *  class of your own complement and is never worth a stone. */
function isOwnEye(board, i, colour) {
  if (board.s[i] !== EMPTY) return false;
  for (const j of board.nbrs(i)) if (board.s[j] !== colour) return false;
  const n = board.n, r = (i / n) | 0, c = i % n;
  let enemyDiag = 0, diagCount = 0;
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
    diagCount++;
    if (board.s[rr * n + cc] === -colour) enemyDiag++;
  }
  return enemyDiag <= (diagCount < 4 ? 0 : 1);
}

/** Distance from the board edge, in lines (0 = on the edge). */
function lineOf(board, i) {
  const n = board.n, r = (i / n) | 0, c = i % n;
  return Math.min(r, c, n - 1 - r, n - 1 - c);
}

/** Score one move. Lower is better. */
function moveScore(board, i, colour, p, wTerr, wCap) {
  if (isOwnEye(board, i, colour)) return Infinity;

  const beforeOwnAtari = atariWeight(board, colour);
  const beforeOppAtari = atariWeight(board, -colour);
  const beforeOwnLibs = totalLiberties(board, colour);
  const beforeOppLibs = totalLiberties(board, -colour);

  const t = board.clone();
  const captured = t.play(i, colour);

  const own = t.group(i);
  const ownLibs = own.libs.length;
  if (ownLibs === 0) return Infinity;

  let score = 0;

  /* -- captures ------------------------------------------------------- */
  score -= wCap * 3.0 * captured.length;

  /* -- never hand over a group ---------------------------------------- */
  // self-atari: after this move our own group sits on one liberty
  if (ownLibs === 1 && captured.length === 0) {
    score += 12 + 3 * Math.min(own.stones.length, 8);
  }

  // capturing race: a short-of-breath group that touches a better-off enemy
  // group loses the race, and the bot has no lookahead to discover that later
  if (ownLibs <= 3 && captured.length === 0) {
    let losingRace = own.stones.length > 0;
    let touchesEnemy = false;
    for (const st of own.stones) {
      for (const j of t.nbrs(st)) {
        if (t.s[j] === -colour) {
          touchesEnemy = true;
          if (t.group(j).libs.length <= ownLibs) losingRace = false;  // we win or tie
        }
      }
    }
    if (touchesEnemy && losingRace) {
      score += p.alpha * 5.5 / ownLibs;             // 5.5, 2.75, 1.8 for 1,2,3
    }
    // being short of breath is bad regardless of who is nearby
    score += p.alpha * 1.6 / (ownLibs * ownLibs);
  }

  /* -- rescue and pressure ---------------------------------------------
   * alpha is the liberty-entropy weight of the model, and it scales exactly
   * the terms that care about liberties: how hard the bot fights to keep its
   * own groups breathing and to take the opponent's breath away. Turn it down
   * and it stops fighting and just takes territory; turn it up and it will
   * chase a capture across the board at the cost of shape. */
  const a = p.alpha;
  // our stones freed from atari (negative delta is good)
  score += 4.0 * a * (atariWeight(t, colour) - beforeOwnAtari);
  // enemy stones pushed into atari (positive delta is good, so subtract)
  score -= 2.6 * a * (atariWeight(t, -colour) - beforeOppAtari);

  /* -- breathing room -------------------------------------------------- */
  score -= 0.30 * a * (totalLiberties(t, colour) - beforeOwnLibs);
  score += 0.22 * a * (totalLiberties(t, -colour) - beforeOppLibs);

  /* -- efficiency: solid clumps are strong and slow --------------------- */
  let ownAdj = 0, oppAdj = 0;
  for (const j of board.nbrs(i)) {
    if (board.s[j] === colour) ownAdj++;
    else if (board.s[j] === -colour) oppAdj++;
  }
  if (ownAdj >= 2) score += 0.85 * (ownAdj - 1);      // filling your own shape
  score += 0.25 * p.K * ownAdj;                       // K still tunes clustering
  score -= 0.20 * p.J * oppAdj;                       // J still tunes contact

  /* -- where on the board ---------------------------------------------- */
  const line = lineOf(board, i);
  const stones = board.s.reduce((a, v) => a + (v !== EMPTY ? 1 : 0), 0);
  if (stones < board.n * board.n * 0.25) {
    if (line === 0) score += 2.2;                     // first line, too early
    else if (line === 1) score += 0.9;
    else if (line === 2 || line === 3) score -= 0.55; // third and fourth lines
  }

  /* -- proximity: play near the action ---------------------------------- */
  if (stones > 0) {
    let best = 99;
    const n = board.n, r = (i / n) | 0, c = i % n;
    for (let k = 0; k < board.s.length; k++) {
      if (board.s[k] === EMPTY) continue;
      const d = Math.abs(r - ((k / n) | 0)) + Math.abs(c - (k % n));
      if (d < best) best = d;
    }
    if (best > 3) score += 0.55 * (best - 3);
  }

  /* -- territory: the one strategic term worth its cost ------------------ */
  if (wTerr > 0) {
    const bt = topologySummary(board);
    const at = topologySummary(t);
    const before = colour === BLACK ? bt.territoryBlack : bt.territoryWhite;
    const after = colour === BLACK ? at.territoryBlack : at.territoryWhite;
    score -= wTerr * 0.35 * (after - before);
  }

  return score;
}

/** Candidate moves worth scoring: legal, near the action, not our own eye. */
function candidateMoves(board, colour, limit) {
  const legal = board.legalMoves(colour).filter(i => !isOwnEye(board, i, colour));
  if (!legal.length) return [];

  const occupied = [];
  for (let i = 0; i < board.s.length; i++) if (board.s[i] !== EMPTY) occupied.push(i);
  if (!occupied.length) return legal;
  if (legal.length <= limit) return legal;

  const n = board.n;
  return legal.map(i => {
    const r = (i / n) | 0, c = i % n;
    let best = 99;
    for (const o of occupied) {
      const dd = Math.abs(r - ((o / n) | 0)) + Math.abs(c - (o % n));
      if (dd < best) best = dd;
    }
    return [i, best];
  }).sort((a, b) => a[1] - b[1]).slice(0, limit).map(x => x[0]);
}

/** Minimax to depth two.
 *
 * The single biggest weakness of scoring a move by the position it produces is
 * that a stone which dies on the very next move looks fine. One ply of reply
 * fixes exactly that, and it is what turned this from a bot that fed stones to
 * its opponent into one that plays a recognisable game. Territory is skipped in
 * the reply scan -- it is the expensive term and it barely moves the ranking of
 * a refutation.
 */
function scoreWithReply(board, i, colour, p, wTerr, wCap, gamma, replyWidth) {
  const own = moveScore(board, i, colour, p, wTerr, wCap);
  if (!Number.isFinite(own)) return own;
  if (gamma <= 0) return own;

  const t = board.clone();
  t.play(i, colour);

  let bestReply = Infinity;
  for (const j of candidateMoves(t, -colour, replyWidth)) {
    const r = moveScore(t, j, -colour, p, 0, wCap);
    if (r < bestReply) bestReply = r;
  }
  if (!Number.isFinite(bestReply)) return own;
  return own - gamma * bestReply;
}

/** Boltzmann-sample a move. Returns -1 to pass.
 *
 * Two stages: rank cheaply, then spend the lookahead only on the shortlist.
 */
function chooseMove(board, colour, p, opts = {}) {
  const temperature = opts.temperature ?? 0.25;
  const wTerr = opts.wTerritory ?? 1.0;
  const wCap = opts.wCapture ?? 2.0;
  const width = opts.candidates ?? 60;
  const gamma = opts.gamma ?? 0.8;
  const shortlist = opts.shortlist ?? 12;
  const replyWidth = opts.replyWidth ?? 12;

  // opening: the energy is flat on an empty board, so take a star point
  let anyStone = false;
  for (let i = 0; i < board.s.length; i++) if (board.s[i] !== EMPTY) { anyStone = true; break; }
  if (!anyStone) {
    const n = board.n, k = n >= 13 ? 3 : 2, mid = (n - 1) >> 1;
    const stars = [];
    for (const r of [k, mid, n - 1 - k]) for (const c of [k, mid, n - 1 - k]) stars.push(r * n + c);
    return stars[Math.floor(Math.random() * stars.length)];
  }

  const cands = candidateMoves(board, colour, width);
  if (!cands.length) return -1;

  // stage 1: cheap ranking, no lookahead, no territory
  const rough = [];
  for (const i of cands) {
    const sc = moveScore(board, i, colour, p, 0, wCap);
    if (Number.isFinite(sc)) rough.push([i, sc]);
  }
  if (!rough.length) return -1;
  rough.sort((a, b) => a[1] - b[1]);

  // stage 2: full score with one ply of reply, on the shortlist only
  const scored = [];
  for (const [i] of rough.slice(0, shortlist)) {
    const sc = scoreWithReply(board, i, colour, p, wTerr, wCap, gamma, replyWidth);
    if (Number.isFinite(sc)) scored.push([i, sc]);
  }
  if (!scored.length) return -1;

  const best = Math.min(...scored.map(x => x[1]));
  if (best > (opts.passThreshold ?? 2.5)) return -1;   // nothing worth a stone
  if (temperature <= 1e-9) return scored.reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  const weights = scored.map(([, sc]) => Math.exp(-(sc - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total, acc = 0;
  for (let k = 0; k < scored.length; k++) {
    acc += weights[k];
    if (acc >= r) return scored[k][0];
  }
  return scored[scored.length - 1][0];
}
