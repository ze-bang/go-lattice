/* A board built for playouts rather than for reading.
 *
 * The Board in physics.js clones itself to answer isLegal, which makes a
 * legality test O(N) and a full playout worse than O(N^2). That is fine when a
 * position is scored once for the plots and fatal when it has to be scored a
 * few thousand times a move. Measured: 11.9 ms per random 9x9 playout, so about
 * 17 playouts in a 200 ms budget. MCTS needs thousands.
 *
 * This is the standard Go-engine representation instead:
 *
 *   - chains in a union-find, so connectivity is near-O(1) amortised
 *   - liberties tracked incrementally as *pseudo-liberties*, counting a point
 *     once per adjacent stone of the chain
 *
 * Pseudo-liberties alone cannot tell 1 real liberty from 3 duplicates of the
 * same point, which is exactly what atari detection needs. The classic fix
 * (Lew) is to carry the sum and the sum of squares of the liberty ids too.
 * For a multiset of pseudo-liberties with count p, sum s and sum-of-squares q,
 * Cauchy-Schwarz gives s^2 <= p*q with equality iff every element is identical.
 * So
 *
 *      real liberties == 0   <=>  p == 0
 *      real liberties == 1   <=>  p > 0 and s*s == p*q,  the point being s/p
 *
 * which is all a playout ever needs to ask.
 */
'use strict';

const FB_EMPTY = 0, FB_BLACK = 1, FB_WHITE = -1;

class FastBoard {
  constructor(n) {
    this.n = n;
    this.N = n * n;
    this.s = new Int8Array(this.N);
    this.parent = new Int32Array(this.N);
    this.csize = new Int32Array(this.N);
    this.pl = new Int32Array(this.N);        // pseudo-liberty count, at root
    this.ls = new Float64Array(this.N);      // sum of liberty ids
    this.lq = new Float64Array(this.N);      // sum of squares of liberty ids
    // circular list of the stones in each chain, so removing one is O(chain)
    // rather than a scan of the whole board
    this.next = new Int32Array(this.N);
    this.ko = -1;
    this.capturedBlack = 0;                  // stones Black has captured
    this.capturedWhite = 0;

    // flat neighbour table: 4 slots per point, -1 padded
    this.nbr = new Int32Array(this.N * 4).fill(-1);
    this.ndeg = new Int8Array(this.N);
    for (let i = 0; i < this.N; i++) {
      const r = (i / n) | 0, c = i % n;
      let k = 0;
      if (r > 0) this.nbr[i * 4 + k++] = i - n;
      if (r < n - 1) this.nbr[i * 4 + k++] = i + n;
      if (c > 0) this.nbr[i * 4 + k++] = i - 1;
      if (c < n - 1) this.nbr[i * 4 + k++] = i + 1;
      this.ndeg[i] = k;
    }
  }

  clone() {
    const b = Object.create(FastBoard.prototype);
    b.n = this.n; b.N = this.N;
    b.s = this.s.slice();
    b.parent = this.parent.slice();
    b.csize = this.csize.slice();
    b.pl = this.pl.slice();
    b.ls = this.ls.slice();
    b.lq = this.lq.slice();
    b.next = this.next.slice();
    b.ko = this.ko;
    b.capturedBlack = this.capturedBlack;
    b.capturedWhite = this.capturedWhite;
    b.nbr = this.nbr;            // shared, never mutated
    b.ndeg = this.ndeg;
    return b;
  }

  find(i) {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[i] !== r) { const nx = this.parent[i]; this.parent[i] = r; i = nx; }
    return r;
  }

  /** 0, 1, or 2 meaning "two or more". */
  libertyClass(root) {
    const p = this.pl[root];
    if (p === 0) return 0;
    const s = this.ls[root];
    return (s * s === p * this.lq[root]) ? 1 : 2;
  }

  /** Only valid when libertyClass(root) === 1. */
  singleLiberty(root) {
    return this.ls[root] / this.pl[root];
  }

  /** True if `i` is a single-point eye of `colour` (never fill your own). */
  isEye(i, colour) {
    if (this.s[i] !== FB_EMPTY) return false;
    const d = this.ndeg[i];
    for (let k = 0; k < d; k++) {
      if (this.s[this.nbr[i * 4 + k]] !== colour) return false;
    }
    const n = this.n, r = (i / n) | 0, c = i % n;
    let enemy = 0, diag = 0;
    for (let dr = -1; dr <= 1; dr += 2) {
      for (let dc = -1; dc <= 1; dc += 2) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        diag++;
        if (this.s[rr * n + cc] === -colour) enemy++;
      }
    }
    return enemy <= (diag < 4 ? 0 : 1);
  }

  isLegal(i, colour) {
    if (i < 0 || i >= this.N || this.s[i] !== FB_EMPTY || i === this.ko) return false;
    const d = this.ndeg[i];
    for (let k = 0; k < d; k++) {
      const j = this.nbr[i * 4 + k];
      const sj = this.s[j];
      if (sj === FB_EMPTY) return true;                       // we get a liberty
      const cls = this.libertyClass(this.find(j));
      if (sj === colour && cls === 2) return true;            // join a live chain
      if (sj === -colour && cls === 1) return true;           // capture
    }
    return false;                                             // suicide
  }

  /** Remove point `p` from the liberties of the chain rooted at `root`. */
  _removeLiberty(root, p) {
    this.pl[root] -= 1;
    this.ls[root] -= p;
    this.lq[root] -= p * p;
  }

  _addLiberty(root, p) {
    this.pl[root] += 1;
    this.ls[root] += p;
    this.lq[root] += p * p;
  }

  _merge(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return ra;
    if (this.csize[ra] < this.csize[rb]) { const t = ra; ra = rb; rb = t; }
    this.parent[rb] = ra;
    // splice the two circular lists together
    const t = this.next[ra]; this.next[ra] = this.next[rb]; this.next[rb] = t;
    this.csize[ra] += this.csize[rb];
    this.pl[ra] += this.pl[rb];
    this.ls[ra] += this.ls[rb];
    this.lq[ra] += this.lq[rb];
    return ra;
  }

  _removeChain(root) {
    // walk the circular list, restore liberties to every adjacent survivor
    const stones = [];
    let cur = root;
    do { stones.push(cur); cur = this.next[cur]; } while (cur !== root);
    for (const i of stones) this.s[i] = FB_EMPTY;
    for (const i of stones) {
      const d = this.ndeg[i];
      for (let k = 0; k < d; k++) {
        const j = this.nbr[i * 4 + k];
        if (this.s[j] !== FB_EMPTY) this._addLiberty(this.find(j), i);
      }
    }
    return stones.length;
  }

  play(i, colour) {
    this.s[i] = colour;
    this.parent[i] = i;
    this.csize[i] = 1;
    this.pl[i] = 0; this.ls[i] = 0; this.lq[i] = 0;
    this.next[i] = i;

    const d = this.ndeg[i];
    for (let k = 0; k < d; k++) {
      const j = this.nbr[i * 4 + k];
      if (this.s[j] === FB_EMPTY) this._addLiberty(i, j);
    }

    let captured = 0, lastCapturedStone = -1, capturedChains = 0;
    let root = i;

    for (let k = 0; k < d; k++) {
      const j = this.nbr[i * 4 + k];
      const sj = this.s[j];
      if (sj === FB_EMPTY) continue;
      const rj = this.find(j);
      if (sj === colour) {
        this._removeLiberty(rj, i);
        root = this._merge(root, rj);
      } else {
        this._removeLiberty(rj, i);
        if (this.pl[rj] === 0) {
          lastCapturedStone = j;
          capturedChains++;
          captured += this._removeChain(rj);
        }
      }
    }

    if (colour === FB_BLACK) this.capturedBlack += captured;
    else this.capturedWhite += captured;

    root = this.find(i);
    this.ko = (captured === 1 && capturedChains === 1 &&
               this.csize[root] === 1 && this.libertyClass(root) === 1)
      ? lastCapturedStone : -1;

    return captured;
  }

  /** Tromp-Taylor area score, Black minus White. Only meaningful at the end
   *  of a playout, where every empty region is surrounded by one colour. */
  areaScore() {
    let black = 0, white = 0;
    const seen = new Uint8Array(this.N);
    const stack = new Int32Array(this.N);
    for (let i = 0; i < this.N; i++) {
      if (this.s[i] === FB_BLACK) { black++; continue; }
      if (this.s[i] === FB_WHITE) { white++; continue; }
      if (seen[i]) continue;
      let sp = 0, count = 0, touchB = false, touchW = false;
      stack[sp++] = i; seen[i] = 1;
      while (sp) {
        const p = stack[--sp];
        count++;
        const d = this.ndeg[p];
        for (let k = 0; k < d; k++) {
          const j = this.nbr[p * 4 + k];
          const sj = this.s[j];
          if (sj === FB_EMPTY) { if (!seen[j]) { seen[j] = 1; stack[sp++] = j; } }
          else if (sj === FB_BLACK) touchB = true;
          else touchW = true;
        }
      }
      if (touchB && !touchW) black += count;
      else if (touchW && !touchB) white += count;
    }
    return black - white;
  }
}

/** Import a position from the physics.js Board. */
function toFastBoard(board) {
  const fb = new FastBoard(board.n);
  for (let i = 0; i < board.s.length; i++) {
    if (board.s[i] !== 0) fb.play(i, board.s[i]);
  }
  fb.ko = board.ko;
  return fb;
}
