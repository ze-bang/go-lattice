/* Node harness for docs/physics.js.
 *
 * The browser file is a plain script with no module wrapper, so it is read and
 * evaluated here. These assertions mirror tests/test_liberty_determinant.py:
 * if the JS engine and the Python reference ever disagree, one of these fails.
 *
 *   node tests/test_physics_js.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'docs', 'physics.js'), 'utf8');
const ctx = {};
// expose the top-level declarations we want to poke at
const exposed = `${src}\n;Object.assign(ctx, {Board, EMPTY, BLACK, WHITE, groupMatrix,
  logDetSPD, smallestEigenvalue, libertyGaps, logDetColour, chambers,
  chamberOwner, topologySummary, h0, hEff, moveScore, chooseMove});`;
new Function('ctx', exposed)(ctx);

const {
  Board, EMPTY, BLACK, WHITE, groupMatrix, logDetSPD, smallestEigenvalue,
  logDetColour, chambers, topologySummary, chooseMove,
} = ctx;

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL  ${name}  ${extra}`); }
}
function close(a, b, tol = 1e-9) { return Math.abs(a - b) < tol; }

/* --- determinant of small groups ------------------------------------- */
{
  const b = new Board(5);
  const i = 2 * 5 + 2;
  b.s[i] = BLACK;
  const M = groupMatrix(b, b.group(i).stones, 1.0);
  check('isolated stone: M = [4]', M.length === 1 && close(M[0][0], 4));
  check('isolated stone: det = 4', close(Math.exp(logDetSPD(M)), 4, 1e-9));
}
{
  const b = new Board(5);
  const i = 2 * 5 + 2, j = 2 * 5 + 3;
  b.s[i] = BLACK; b.s[j] = BLACK;
  const M = groupMatrix(b, b.group(i).stones, 1.0);
  const r1 = b.libertyCount(i), r2 = b.libertyCount(j);
  check('two-stone chain: det = r1+r2+r1r2',
        close(Math.exp(logDetSPD(M)), r1 + r2 + r1 * r2, 1e-8),
        `got ${Math.exp(logDetSPD(M))} want ${r1 + r2 + r1 * r2}`);
}
{
  const b = new Board(5);
  const c = 2 * 5 + 2;
  b.s[c] = BLACK;
  for (const j of b.nbrs(c)) b.s[j] = WHITE;
  check('surrounded stone: logDetSPD null', logDetSPD(groupMatrix(b, [c], 1.0)) === null);
  check('surrounded stone: logDetColour null', logDetColour(b, BLACK, 1.0) === null);
  check('surrounded stone: gap = 0', close(smallestEigenvalue(groupMatrix(b, [c], 1.0)), 0, 1e-6));
}

/* --- exact zero modes and root scales --------------------------------- */
{
  const p = { J: 1, K: 0.4, Delta: 0.2, h: 0, alpha: 1, beta: 1, lam: 1 };
  for (const n of [2, 5, 6, 9]) {
    for (const colour of [BLACK, WHITE]) {
      const b = new Board(n);
      b.s.fill(colour);
      check(`dense dead ${n}x${n}, colour ${colour}: log determinant is null`,
            logDetColour(b, colour, 1) === null);
      check(`dense dead ${n}x${n}, colour ${colour}: exact zero gap`,
            ctx.libertyGaps(b, colour, 1)[0].gap === 0);
      check(`dense dead ${n}x${n}, colour ${colour}: infinite effective energy`,
            ctx.hEff(b, p) === Infinity);
    }
  }

  const b = new Board(5);
  b.s[12] = BLACK;
  for (const lam of [1e-14, 0.25, 3]) {
    check(`positive root scale ${lam}: finite live determinant`,
          close(logDetColour(b, BLACK, lam), Math.log(4 * lam)));
    check(`positive root scale ${lam}: correct isolated gap`,
          ctx.libertyGaps(b, BLACK, lam)[0].gap === 4 * lam);
  }
  const empty = new Board(5);
  for (const lam of [0, -1, Infinity, -Infinity, NaN]) {
    for (const call of [
      () => groupMatrix(empty, [], lam),
      () => ctx.libertyGaps(empty, BLACK, lam),
      () => logDetColour(empty, BLACK, lam),
    ]) {
      let rejected = false;
      try { call(); } catch (err) { rejected = err instanceof RangeError; }
      check(`invalid root scale ${lam} is rejected on empty boards`, rejected);
    }
  }
}

/* --- the determinant theorem on random positions ---------------------- */
{
  let rngState = 12345;
  const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let mismatches = 0;
  for (let trial = 0; trial < 200; trial++) {
    const b = new Board(7);
    for (let i = 0; i < b.s.length; i++) {
      const r = rnd();
      b.s[i] = r < 0.5 ? EMPTY : (r < 0.75 ? BLACK : WHITE);
    }
    for (const colour of [BLACK, WHITE]) {
      const combinatorial = b.groups(colour).every(g => g.libs.length > 0);
      const determinant = logDetColour(b, colour, 1.0) !== null;
      if (combinatorial !== determinant) mismatches++;
    }
  }
  check('det M > 0  <=>  every group has a liberty (200 random boards)',
        mismatches === 0, `${mismatches} mismatches`);
}

/* --- liberty gap vanishes exactly for dead groups ---------------------- */
{
  let rngState = 999;
  const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let bad = 0;
  for (let trial = 0; trial < 60; trial++) {
    const b = new Board(7);
    for (let i = 0; i < b.s.length; i++) {
      const r = rnd();
      b.s[i] = r < 0.34 ? EMPTY : (r < 0.67 ? BLACK : WHITE);
    }
    for (const colour of [BLACK, WHITE]) {
      for (const g of b.groups(colour)) {
        const gap = smallestEigenvalue(groupMatrix(b, g.stones, 1.0));
        if (g.libs.length > 0 && gap <= 1e-6) bad++;
        if (g.libs.length === 0 && gap > 1e-5) bad++;
      }
    }
  }
  check('liberty gap > 0 iff the group has a liberty', bad === 0, `${bad} bad groups`);
}

/* --- topology --------------------------------------------------------- */
{
  const b = new Board(7);
  for (const [r, c] of [[2,2],[2,3],[2,4],[3,2],[3,4],[4,2],[4,3],[4,4]]) b.s[r*7+c] = BLACK;
  const chs = chambers(b);
  const sizes = chs.map(c => c.length).sort((x, y) => x - y);
  check('ring: two chambers', chs.length === 2, `got ${chs.length}`);
  check('ring: one enclosed point', sizes[0] === 1, `got ${sizes[0]}`);
  const topo = topologySummary(b);
  check('ring: enclosure = 1', topo.enclosure === 1, `got ${topo.enclosure}`);
  // With no White stones anywhere, *both* chambers are bounded only by Black,
  // so Black owns every empty point -- 1 inside the eye and 40 outside. That is
  // correct Go scoring, not a bug: a lone colour owns the whole board.
  const eye = chs.find(c => c.length === 1);
  check('ring: the eye is owned by Black', ctx.chamberOwner(b, eye) === BLACK);
  check('ring: Black owns every empty point', topo.territoryBlack === 41,
        `got ${topo.territoryBlack}`);
  check('ring: nothing is neutral', topo.territoryNeutral === 0);
}
{
  const b = new Board(9);
  check('empty board: enclosure = 0', topologySummary(b).enclosure === 0);
  check('empty board: one chamber', topologySummary(b).beta0Empty === 1);
}

/* --- capture ---------------------------------------------------------- */
{
  const b = new Board(5);
  const c = 2 * 5 + 2;
  b.s[c] = WHITE;
  const ns = b.nbrs(c);
  for (const j of ns.slice(0, ns.length - 1)) b.s[j] = BLACK;
  const removed = b.play(ns[ns.length - 1], BLACK);
  check('capture removes the group', removed.length === 1 && b.s[c] === EMPTY);
  check('capture is counted', b.captured[BLACK] === 1);
}

/* --- suicide and ko --------------------------------------------------- */
{
  const b = new Board(5);
  for (const i of [1, 5, 11]) b.s[i] = BLACK;
  for (const i of [6, 2, 12, 8]) b.s[i] = WHITE;
  b.play(7, BLACK);
  check('simple ko forbids immediate recapture', b.ko === 6 && !b.isLegal(6, WHITE));
  const stones = [...b.s], captured = { ...b.captured };
  b.pass();
  check('pass releases the simple ko restriction', b.ko === -1 && b.isLegal(6, WHITE));
  check('pass preserves stones and capture counts',
        b.s.every((stone, i) => stone === stones[i]) &&
        b.captured[BLACK] === captured[BLACK] && b.captured[WHITE] === captured[WHITE]);
}
{
  const b = new Board(5);
  const c = 2 * 5 + 2;
  for (const j of b.nbrs(c)) b.s[j] = WHITE;
  check('suicide is illegal', !b.isLegal(c, BLACK));
  check('but legal if it captures', (() => {
    const t = new Board(5);
    const mid = 2 * 5 + 2;
    t.s[mid] = WHITE;
    const ns = t.nbrs(mid);
    for (const j of ns.slice(0, ns.length - 1)) t.s[j] = BLACK;
    return t.isLegal(ns[ns.length - 1], BLACK);
  })());
}

/* --- the engine returns legal moves ----------------------------------- */
{
  const p = { J: 1, K: 0.4, Delta: 0.2, h: 0, alpha: 1, beta: 1, lam: 1 };
  const b = new Board(9);
  let colour = BLACK, illegal = 0, moves = 0;
  for (let k = 0; k < 40; k++) {
    const mv = chooseMove(b, colour, p, { temperature: 0.6, candidates: 40 });
    if (mv < 0) break;
    if (!b.isLegal(mv, colour)) { illegal++; break; }
    b.play(mv, colour);
    moves++;
    colour = -colour;
  }
  check('engine plays only legal moves', illegal === 0);
  check('engine actually plays a game', moves > 20, `only ${moves} moves`);
  check('no group is ever left dead on the board',
        logDetColour(b, BLACK, 1) !== null && logDetColour(b, WHITE, 1) !== null);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
