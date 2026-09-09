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

/** Score one move. Lower is better. Same terms the plots display. */
function moveScore(board, i, colour, p, wTerr, wCap) {
  const before = h0(board, p);
  const beforeTerr = topologySummary(board);
  const beforeOwn = colour === BLACK ? beforeTerr.territoryBlack : beforeTerr.territoryWhite;

  const t = board.clone();
  const captured = t.play(i, colour);

  const ldOwn = logDetColour(t, colour, p.lam);
  if (ldOwn === null) return Infinity;             // walks into its own death

  let score = h0(t, p) - before;
  score += -(p.alpha / p.beta) * ldOwn;

  const ldOpp = logDetColour(t, -colour, p.lam);
  if (ldOpp !== null) score += (p.alpha / p.beta) * ldOpp * 0.5;  // squeeze them

  const afterTerr = topologySummary(t);
  const afterOwn = colour === BLACK ? afterTerr.territoryBlack : afterTerr.territoryWhite;
  score -= wTerr * (afterOwn - beforeOwn);
  score -= wCap * captured.length;
  return score;
}

/** Boltzmann-sample a move from the physics score. Returns -1 to pass. */
function chooseMove(board, colour, p, opts = {}) {
  const temperature = opts.temperature ?? 0.6;
  const wTerr = opts.wTerritory ?? 1.0;
  const wCap = opts.wCapture ?? 2.0;
  const maxCandidates = opts.candidates ?? 60;

  let legal = board.legalMoves(colour);
  if (!legal.length) return -1;

  const occupied = [];
  for (let i = 0; i < board.s.length; i++) if (board.s[i] !== EMPTY) occupied.push(i);

  if (occupied.length && legal.length > maxCandidates) {
    const n = board.n;
    const dist = i => {
      const r = (i / n) | 0, c = i % n;
      let best = 1e9;
      for (const o of occupied) {
        const d = Math.abs(r - ((o / n) | 0)) + Math.abs(c - (o % n));
        if (d < best) best = d;
      }
      return best;
    };
    legal = legal.map(i => [i, dist(i)]).sort((a, b) => a[1] - b[1])
      .slice(0, maxCandidates).map(x => x[0]);
  } else if (!occupied.length) {
    // empty board: opening on a star point beats scoring 361 identical moves
    const n = board.n, k = n >= 13 ? 3 : 2;
    const stars = [];
    for (const r of [k, (n - 1) / 2 | 0, n - 1 - k])
      for (const c of [k, (n - 1) / 2 | 0, n - 1 - k]) stars.push(r * n + c);
    return stars[Math.floor(Math.random() * stars.length)];
  }

  const scored = [];
  for (const i of legal) {
    const sc = moveScore(board, i, colour, p, wTerr, wCap);
    if (Number.isFinite(sc)) scored.push([i, sc]);
  }
  if (!scored.length) return -1;

  const best = Math.min(...scored.map(x => x[1]));
  if (temperature <= 1e-9) return scored.reduce((a, b) => (b[1] < a[1] ? b : a))[0];

  const weights = scored.map(([, s]) => Math.exp(-(s - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total, acc = 0;
  for (let k = 0; k < scored.length; k++) {
    acc += weights[k];
    if (acc >= r) return scored[k][0];
  }
  return scored[scored.length - 1][0];
}
