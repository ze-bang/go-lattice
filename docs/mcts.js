/* Monte Carlo tree search, with the model supplying the prior.
 *
 * MCTS is importance sampling of the game tree, which is a comfortable thing to
 * bolt onto a statistical-mechanics model: the physics score becomes the prior
 * over moves and the search spends its samples where that prior says to look.
 * The sliders therefore still steer the bot -- they shape P in
 *
 *     PUCT(a) = Q(a) + c * P(a) * sqrt(N) / (1 + n(a))
 *
 * but they no longer have the last word, because Q comes from playing the
 * position out thousands of times.
 *
 * Rollouts use only quantities FastBoard maintains incrementally -- atari,
 * captures, eyes -- which are the same liberty structure the plots draw, read
 * by counting rather than by diagonalising.
 */
'use strict';

const MCTS_C = 1.3;          // exploration constant

class MctsNode {
  constructor(prior) {
    this.n = 0;              // visits
    this.w = 0;              // summed value, from the mover's point of view
    this.prior = prior;
    this.moves = null;       // Int32Array of child moves, once expanded
    this.kids = null;        // MctsNode[]
  }
  get q() { return this.n ? this.w / this.n : 0; }
}

/** Legal, non-eye moves for `colour`, into a reusable buffer. */
function legalNonEye(fb, colour, buf) {
  let m = 0;
  for (let i = 0; i < fb.N; i++) {
    if (fb.s[i] === 0 && !fb.isEye(i, colour) && fb.isLegal(i, colour)) buf[m++] = i;
  }
  return m;
}

/** One rollout to the end, with a light liberty-driven policy. */
function rollout(fb0, colour, buf, rng) {
  const fb = fb0.clone();
  let col = colour, passes = 0;

  for (let step = 0; step < fb.N * 2; step++) {
    let move = -1;

    // urgent: take a chain that is in atari, or save one of ours
    // (scan is cheap because libertyClass is O(1) per chain root)
    if (rng() < 0.85) {
      for (let i = 0; i < fb.N && move < 0; i++) {
        if (fb.s[i] === 0) continue;
        const r = fb.find(i);
        if (r !== i || fb.libertyClass(r) !== 1) continue;
        const pt = fb.singleLiberty(r);
        if (fb.s[i] === -col) {                       // capture it
          if (fb.isLegal(pt, col)) move = pt;
        } else if (fb.s[i] === col && fb.csize[r] > 1) {   // rescue it
          if (fb.isLegal(pt, col) && !fb.isEye(pt, col)) move = pt;
        }
      }
    }

    if (move < 0) {
      const m = legalNonEye(fb, col, buf);
      if (!m) { if (++passes >= 2) break; col = -col; continue; }
      move = buf[(rng() * m) | 0];
    }

    passes = 0;
    fb.play(move, col);
    col = -col;
  }
  return fb.areaScore();
}

/** Expand a node: children are the legal non-eye moves, uniform prior. */
function expand(node, fb, colour, buf) {
  const m = legalNonEye(fb, colour, buf);
  node.moves = buf.slice(0, m);
  node.kids = new Array(m);
  const p = m ? 1 / m : 0;
  for (let k = 0; k < m; k++) node.kids[k] = new MctsNode(p);
  return m;
}

function selectChild(node) {
  let best = -1, bestVal = -Infinity;
  const sqrtN = Math.sqrt(Math.max(1, node.n));
  for (let k = 0; k < node.kids.length; k++) {
    const c = node.kids[k];
    // negate: a child's value is from the opponent's point of view
    const q = c.n ? -c.q : 0;
    const u = MCTS_C * c.prior * sqrtN / (1 + c.n);
    const v = q + u;
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return best;
}

/** One iteration: descend, expand a leaf, roll out, back the value up. */
function iterate(root, fb0, colour, buf, rng) {
  const path = [root];
  const fb = fb0.clone();
  let col = colour;

  let node = root;
  while (node.kids && node.kids.length) {
    const k = selectChild(node);
    if (k < 0) break;
    fb.play(node.moves[k], col);
    col = -col;
    node = node.kids[k];
    path.push(node);
    if (node.n === 0) break;            // new leaf: roll out from here
  }

  if (node.n > 0 && !node.kids) expand(node, fb, col, buf);

  const scoreBlack = rollout(fb, col, buf, rng);
  // value in [-1, 1] from Black's point of view, then per-node perspective
  const vBlack = scoreBlack > 0 ? 1 : (scoreBlack < 0 ? -1 : 0);

  let perspective = colour;            // whose move it was at the root
  for (let d = 0; d < path.length; d++) {
    const nd = path[d];
    nd.n += 1;
    nd.w += (perspective === 1 ? vBlack : -vBlack);
    perspective = -perspective;
  }
}

/**
 * Choose a move by search. `board` is the physics.js Board (for the priors),
 * `p` the model parameters, and the physics score sets the root prior.
 */
function mctsChooseMove(board, colour, p, opts = {}) {
  const budgetMs = opts.budgetMs ?? 500;
  const wTerr = opts.wTerritory ?? 1.0;
  const wCap = opts.wCapture ?? 2.0;
  const priorTemp = opts.priorTemp ?? 0.8;
  const rng = opts.rng ?? Math.random;

  const fb = toFastBoard(board);
  const buf = new Int32Array(fb.N);

  // ---- root children, with the physics score as prior --------------------
  const cands = candidateMoves(board, colour, opts.candidates ?? 40)
    .filter(i => fb.isLegal(i, colour) && !fb.isEye(i, colour));
  if (!cands.length) return -1;

  const scores = cands.map(i => moveScore(board, i, colour, p, wTerr, wCap));
  const finite = [];
  for (let k = 0; k < cands.length; k++) {
    if (Number.isFinite(scores[k])) finite.push([cands[k], scores[k]]);
  }
  if (!finite.length) return -1;

  const best = Math.min(...finite.map(x => x[1]));
  const weights = finite.map(([, s]) => Math.exp(-(s - best) / priorTemp));
  const wsum = weights.reduce((a, b) => a + b, 0);

  const root = new MctsNode(1);
  root.moves = Int32Array.from(finite.map(x => x[0]));
  root.kids = finite.map((_, k) => new MctsNode(weights[k] / wsum));
  root.n = 1;

  // ---- search ------------------------------------------------------------
  const t0 = Date.now();
  let iters = 0;
  while (Date.now() - t0 < budgetMs) {
    for (let b = 0; b < 16; b++) iterate(root, fb, colour, buf, rng);
    iters += 16;
  }

  // ---- pick the most-visited child --------------------------------------
  let bestK = -1, bestN = -1;
  for (let k = 0; k < root.kids.length; k++) {
    if (root.kids[k].n > bestN) { bestN = root.kids[k].n; bestK = k; }
  }
  if (bestK < 0) return -1;

  const chosen = root.kids[bestK];
  // resign-ish: if every line loses badly and the physics score says nothing is
  // worth a stone either, pass rather than fill our own position
  if (chosen.n > 30 && -chosen.q < -0.92 && best > 0) return -1;

  mctsChooseMove.lastStats = {
    iterations: iters,
    winRate: (1 - chosen.q) / 2,        // from the mover's point of view
    visits: bestN,
    children: root.kids.length,
  };
  return root.moves[bestK];
}
