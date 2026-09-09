/* FastBoard must agree with the reference Board move for move.
 *
 * The incremental representation is easy to get subtly wrong -- a liberty not
 * restored after a capture, a ko point set on the wrong move -- and the errors
 * are invisible until a playout wanders into an illegal position. So this plays
 * thousands of random games on both boards in lockstep and compares the full
 * state after every single move.
 *
 *   node tests/test_fastboard.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, '..', 'docs');
const ctx = {};
new Function('ctx', `${readFileSync(join(docs, 'physics.js'), 'utf8')}
  ${readFileSync(join(docs, 'fastboard.js'), 'utf8')}
  ;Object.assign(ctx,{Board,EMPTY,BLACK,WHITE,FastBoard,toFastBoard,chambers,
    chamberOwner,topologySummary});`)(ctx);
const { Board, EMPTY, BLACK, WHITE, FastBoard, toFastBoard, topologySummary } = ctx;

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) passed++; else { failed++; console.error(`  FAIL  ${name}  ${extra}`); }
};

/* deterministic RNG so a failure is reproducible */
let seed = 20260908;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/* -- lockstep random games -------------------------------------------- */
for (const n of [5, 9, 13]) {
  let mismatch = null, games = 0, moves = 0;

  for (let g = 0; g < (n === 13 ? 20 : 60) && !mismatch; g++) {
    const ref = new Board(n);
    const fb = new FastBoard(n);
    let colour = BLACK, passes = 0;
    games++;

    for (let k = 0; k < n * n * 3 && !mismatch; k++) {
      // legality must agree on EVERY point, not just the one we play
      for (let i = 0; i < ref.s.length; i++) {
        if (ref.isLegal(i, colour) !== fb.isLegal(i, colour)) {
          mismatch = `legality differs at ${i} (game ${g}, move ${k}, colour ${colour})`;
          break;
        }
      }
      if (mismatch) break;

      const legal = [];
      for (let i = 0; i < ref.s.length; i++) if (ref.isLegal(i, colour)) legal.push(i);
      if (!legal.length) { if (++passes >= 2) break; colour = -colour; continue; }
      passes = 0;

      const mv = legal[(rnd() * legal.length) | 0];
      const removedRef = ref.play(mv, colour).length;
      const removedFb = fb.play(mv, colour);
      moves++;

      if (removedRef !== removedFb) {
        mismatch = `capture count differs at move ${k}: ref ${removedRef} vs fast ${removedFb}`;
        break;
      }
      for (let i = 0; i < ref.s.length; i++) {
        if (ref.s[i] !== fb.s[i]) { mismatch = `stone differs at ${i} after move ${k}`; break; }
      }
      if (mismatch) break;
      if (ref.ko !== fb.ko) {
        mismatch = `ko differs after move ${k}: ref ${ref.ko} vs fast ${fb.ko}`;
        break;
      }

      // liberty class must match the reference group's real liberty count
      for (let i = 0; i < ref.s.length && !mismatch; i++) {
        if (ref.s[i] === EMPTY) continue;
        const real = ref.group(i).libs.length;
        const cls = fb.libertyClass(fb.find(i));
        const want = real === 0 ? 0 : (real === 1 ? 1 : 2);
        if (cls !== want) {
          mismatch = `liberty class at ${i}: real ${real} -> want ${want}, got ${cls}`;
        } else if (cls === 1) {
          const pt = fb.singleLiberty(fb.find(i));
          if (pt !== ref.group(i).libs[0]) {
            mismatch = `atari point at ${i}: ref ${ref.group(i).libs[0]} vs fast ${pt}`;
          }
        }
      }
      colour = -colour;
    }
  }
  check(`${n}x${n}: FastBoard matches Board over ${games} random games`,
        !mismatch, mismatch || '');
}

/* -- capture, suicide, ko ---------------------------------------------- */
{
  const fb = new FastBoard(5);
  const c = 2 * 5 + 2;
  fb.play(c, WHITE);
  const ns = [];
  for (let k = 0; k < fb.ndeg[c]; k++) ns.push(fb.nbr[c * 4 + k]);
  for (const j of ns.slice(0, ns.length - 1)) fb.play(j, BLACK);
  check('atari detected before the capture', fb.libertyClass(fb.find(c)) === 1);
  const got = fb.play(ns[ns.length - 1], BLACK);
  check('capture removes one stone', got === 1 && fb.s[c] === 0);
  check('capture is counted', fb.capturedBlack === 1);
}

/* -- eye detection ------------------------------------------------------ */
{
  const fb = new FastBoard(7);
  const centre = 3 * 7 + 3;
  for (let k = 0; k < fb.ndeg[centre]; k++) fb.play(fb.nbr[centre * 4 + k], BLACK);
  check('a surrounded point is an eye for Black', fb.isEye(centre, BLACK));
  check('and not an eye for White', !fb.isEye(centre, WHITE));
}

/* -- area score agrees with the topology module ------------------------- */
{
  let bad = 0;
  for (let g = 0; g < 25; g++) {
    const ref = new Board(9);
    const fb = new FastBoard(9);
    let colour = BLACK, passes = 0;
    for (let k = 0; k < 200; k++) {
      const legal = [];
      for (let i = 0; i < ref.s.length; i++) {
        if (ref.isLegal(i, colour) && !fb.isEye(i, colour)) legal.push(i);
      }
      if (!legal.length) { if (++passes >= 2) break; colour = -colour; continue; }
      passes = 0;
      const mv = legal[(rnd() * legal.length) | 0];
      ref.play(mv, colour); fb.play(mv, colour);
      colour = -colour;
    }
    const t = topologySummary(ref);
    let stonesB = 0, stonesW = 0;
    for (const v of ref.s) { if (v === BLACK) stonesB++; else if (v === WHITE) stonesW++; }
    const fromTopology = (stonesB + t.territoryBlack) - (stonesW + t.territoryWhite);
    if (fb.areaScore() !== fromTopology) bad++;
  }
  check('areaScore matches stones + owned chambers from topology.js', bad === 0,
        `${bad} of 25 disagreed`);
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
