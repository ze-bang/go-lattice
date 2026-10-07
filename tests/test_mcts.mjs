/* Deterministic search regressions: node tests/test_mcts.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const ctx = {};
new Function('ctx', ['physics.js', 'fastboard.js', 'mcts.js']
  .map(file => readFileSync(join(docs, file), 'utf8')).join('\n') +
  ';Object.assign(ctx,{Board,BLACK,WHITE,FastBoard,MctsNode,expand,iterate,rollout,mctsChooseMove});')(ctx);
const { Board, BLACK, WHITE, FastBoard, MctsNode, expand, iterate, rollout, mctsChooseMove } = ctx;
const params = { J: 1, K: 0.4, Delta: 0.2, h: 0, alpha: 1, beta: 1, lam: 1 };
const seeded = (seed = 12345) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const noRollout = () => { throw new Error('A terminal position must not play further moves'); };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  PASS  ${name}`); }

test('zero budget chooses the physics prior instead of the first corner', () => {
  const b = new Board(5);
  assert.equal(mctsChooseMove(b, BLACK, params, { budgetMs: 0 }), 12);
  assert.equal(mctsChooseMove.lastStats.iterations, 0);
  assert.equal(mctsChooseMove.lastStats.winRate, null);
});

test('the stone-cost parameter compares a stone with passing', () => {
  const b = new Board(5);
  assert.equal(mctsChooseMove(b, BLACK, params, { budgetMs: 0, temperature: 0 }), 12);
  assert.equal(mctsChooseMove(b, BLACK, { ...params, Delta: 10 },
    { budgetMs: 0, temperature: 0 }), -1);
});

test('zero temperature keeps priors valid and search counts exact', () => {
  const b = new Board(5);
  const move = mctsChooseMove(b, BLACK, params,
    { budgetMs: Infinity, maxIterations: 7, temperature: 0, rng: seeded() });
  assert.ok(move === -1 || b.isLegal(move, BLACK));
  assert.equal(mctsChooseMove.lastStats.iterations, 7);
  assert.ok(Number.isFinite(mctsChooseMove.lastStats.winRate));
  assert.ok(mctsChooseMove.lastStats.visits > 0);
});

test('seeded, bounded searches repeat without mutating their input', () => {
  const b = new Board(5);
  b.play(12, BLACK);
  b.play(13, WHITE);
  const snapshot = JSON.stringify(b);
  const run = () => {
    const move = mctsChooseMove(b, BLACK, params,
      { budgetMs: Infinity, maxIterations: 32, rng: seeded() });
    return { move, ...mctsChooseMove.lastStats };
  };
  assert.deepEqual(run(), run());
  assert.equal(JSON.stringify(b), snapshot);
});

test('a second pass ends the tree and backs up each player perspective', () => {
  const fb = new FastBoard(3);
  fb.play(0, BLACK);
  for (const colour of [BLACK, WHITE]) for (const komi of [0, 10]) {
    const root = new MctsNode(1);
    root.moves = Int32Array.of(-1);
    root.kids = [new MctsNode(1)];
    iterate(root, fb, colour, new Int32Array(fb.N), noRollout, 1, komi);
    const value = Math.sign(9 - komi) * colour;
    assert.equal(root.q, value);
    assert.equal(root.kids[0].q, -value);
    assert.equal(root.kids[0].kids, null);
  }
});

test('tree expansion preserves a pass when no stone can be played', () => {
  const fb = new FastBoard(1);
  const root = new MctsNode(1);
  const buf = new Int32Array(1);
  assert.equal(expand(root, fb, BLACK, buf), 1);
  assert.deepEqual(Array.from(root.moves), [-1]);
  for (let i = 0; i < 3; i++) iterate(root, fb, BLACK, buf, seeded(), 0, 0.5);
  assert.equal(root.q, -1);
  const terminal = root.kids[0].kids[0];
  assert.equal(terminal.n, 1);
  assert.equal(terminal.kids, null);
});

test('rollout respects two existing passes and applies komi exactly once', () => {
  const fb = new FastBoard(3);
  fb.play(0, BLACK);
  assert.equal(rollout(fb, WHITE, new Int32Array(9), noRollout, 2, 6.5), 2.5);
});

test('forced passes and completed games clear old search statistics', () => {
  mctsChooseMove(new Board(5), BLACK, params,
    { budgetMs: Infinity, maxIterations: 2, rng: seeded() });
  assert.equal(mctsChooseMove(new Board(1), WHITE, params), -1);
  assert.deepEqual(mctsChooseMove.lastStats, { iterations: 0, winRate: null, visits: 0, children: 0 });
  assert.equal(mctsChooseMove(new Board(5), BLACK, params, { passes: 2, rng: noRollout }), -1);
  assert.equal(mctsChooseMove.lastStats.iterations, 0);
});

console.log(`\n  ${passed} passed, 0 failed\n`);
