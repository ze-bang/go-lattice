/* Game lifecycle regressions, with controllable worker replies and timers.
 * Run with: node tests/test_app.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const docs = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const source = name => readFileSync(join(docs, name), 'utf8');
const defaults = { size: '9', sJ: '1', sK: '0.4', sD: '0.2', sA: '1', sT: '1', sTemp: '0.25', strength: '400' };

function app() {
  const elements = new Map(), timers = new Map(), workers = [];
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const context = new Proxy({}, { get: (obj, key) => obj[key] ?? (() => {}) });
      elements.set(id, {
        value: defaults[id] ?? '', width: 640, height: 640, dataset: {}, disabled: false,
        hidden: false, textContent: '', innerHTML: '', listeners: {}, attributes: {},
        classList: {
          add: name => classes.add(name), remove: name => classes.delete(name),
          contains: name => classes.has(name),
          toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, fn) { this.listeners[name] = fn; },
        getContext: () => context,
      });
    }
    return elements.get(id);
  }
  class Worker {
    constructor(url) { this.url = url; this.terminated = false; workers.push(this); }
    postMessage(data) { this.request = structuredClone(data); }
    terminate() { this.terminated = true; }
    reply(move, stats = null) { this.onmessage({ data: { revision: this.request.revision, move, stats } }); }
  }
  const sandbox = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { devicePixelRatio: 1 }, Worker,
    setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(source('physics.js'), sandbox);
  vm.runInContext(source('app.js'), sandbox);
  const api = vm.runInContext('({ state, humanPlay, humanPass, undo, newGame, refreshPanels })', sandbox);
  return {
    ...api, elements, element, timers, workers,
    click: id => element(id).listeners.click(),
    tick() {
      const [id, fn] = timers.entries().next().value ?? [];
      assert.ok(fn, 'expected a queued callback');
      timers.delete(id); fn();
    },
    stones: () => Array.from(api.state.board.s).filter(Boolean).length,
  };
}

let passed = 0;
function test(name, run) {
  run(); passed++; console.log(`  PASS ${name}`);
}

test('a queued reply immediately locks human input', () => {
  const a = app();
  assert.equal(a.state.series.length, 1);
  a.humanPlay(0);
  assert.equal(a.state.thinking, true);
  assert.equal(a.element('pass').disabled, true);
  a.humanPass(); a.humanPlay(1);
  assert.equal(a.state.history.length, 1);
  assert.equal(a.stones(), 1);
  a.tick();
  assert.equal(a.workers.length, 1);
  assert.equal(a.workers[0].url, 'search-worker.js');
  assert.equal(a.workers[0].request.colour, -1);
  assert.equal(a.workers[0].request.opts.komi, 0);
});

test('New game invalidates even a delayed callback already dequeued by the browser', () => {
  const a = app();
  a.humanPlay(0);
  const delayed = a.timers.values().next().value;
  a.newGame(); delayed();
  assert.equal(a.workers.length, 0);
  assert.equal(a.stones(), 0);
  assert.equal(a.state.thinking, false);
  assert.equal(a.state.series.length, 1);
});

test('New game terminates search and ignores stale worker replies', () => {
  const a = app();
  a.humanPlay(0); a.tick();
  const worker = a.workers[0];
  a.newGame(); worker.reply(1);
  assert.equal(worker.terminated, true);
  assert.equal(a.stones(), 0);
  assert.equal(a.state.toPlay, 1);
  assert.equal(a.state.history.length, 0);
  assert.equal(a.element('selfPlay').textContent, 'Watch it play itself');
});

test('Undo cancels a pending reply and does not append a plot sample', () => {
  const a = app();
  a.humanPlay(0); a.tick();
  const worker = a.workers[0];
  a.undo(); worker.reply(1);
  assert.equal(worker.terminated, true);
  assert.equal(a.stones(), 0);
  assert.equal(a.state.series.length, 1);
  assert.equal(a.state.thinking, false);
  assert.equal(a.element('pass').disabled, false);
});

test('Undo reverses a completed human/bot pair with exactly one baseline sample', () => {
  const a = app();
  a.humanPlay(0); a.tick(); a.workers[0].reply(1);
  assert.equal(a.state.series.length, 3);
  a.refreshPanels();
  assert.equal(a.state.series.length, 3);
  a.undo();
  assert.equal(a.state.series.length, 1);
  assert.equal(a.state.history.length, 0);
  assert.equal(a.stones(), 0);
});

test('human pass clears ko, records one turn, and carries pass count to the worker', () => {
  const a = app();
  a.state.board.ko = 17;
  a.humanPass();
  assert.equal(a.state.board.ko, -1);
  assert.equal(a.state.passes, 1);
  assert.equal(a.state.series.length, 2);
  a.humanPass();
  assert.equal(a.state.passes, 1);
  a.tick();
  assert.equal(a.workers[0].request.opts.passes, 1);
  assert.equal(a.workers[0].request.board.ko, -1);
  a.undo();
  assert.equal(a.state.board.ko, 17);
});

test('bot pass is undoable and two passes finish and lock an empty game', () => {
  const a = app();
  a.humanPass(); a.tick(); a.workers[0].reply(-1);
  assert.equal(a.state.history.length, 2);
  assert.equal(a.state.series.length, 3);
  assert.equal(a.state.gameOver, true);
  assert.match(a.element('status').innerHTML, /Draw/);
  assert.equal(a.element('pass').disabled, true);
  assert.equal(a.element('selfPlay').disabled, true);
  a.humanPlay(0); a.humanPass(); a.click('selfPlay');
  assert.equal(a.stones(), 0);
  assert.equal(a.state.passes, 2);
  assert.equal(a.timers.size, 0);
  a.undo();
  assert.equal(a.state.gameOver, false);
  assert.equal(a.state.passes, 0);
  assert.equal(a.state.series.length, 1);
});

test('human second pass ends immediately and scores stones plus owned empty area', () => {
  const a = app();
  a.humanPlay(0); a.tick();
  a.state.board.ko = 5;
  a.workers[0].reply(-1);
  assert.equal(a.state.board.ko, -1);
  a.humanPass();
  assert.equal(a.state.gameOver, true);
  assert.match(a.element('status').innerHTML, /Black wins by 81/);
  assert.equal(a.timers.size, 0);
  a.undo();
  assert.equal(a.state.gameOver, false);
  assert.equal(a.state.passes, 1);
  assert.equal(a.state.series.length, 3);
});

test('self-play continues after one pass and stops after two', () => {
  const a = app();
  a.click('selfPlay'); a.tick(); a.workers[0].reply(-1);
  assert.equal(a.state.selfPlay, true);
  assert.equal(a.state.thinking, true);
  a.tick(); a.workers[0].reply(-1);
  assert.equal(a.state.gameOver, true);
  assert.equal(a.state.selfPlay, false);
  assert.equal(a.state.thinking, false);
  assert.equal(a.element('selfPlay').textContent, 'Watch it play itself');
  assert.equal(a.timers.size, 0);
});

test('Stop cancels a queued self-play move and resets the button', () => {
  const a = app();
  a.click('selfPlay');
  const delayed = a.timers.values().next().value;
  a.click('selfPlay'); delayed();
  assert.equal(a.workers.length, 0);
  assert.equal(a.state.selfPlay, false);
  assert.equal(a.state.thinking, false);
  assert.equal(a.element('pass').disabled, false);
});

test('Stop terminates active search and allows an explicit bot resume', () => {
  const a = app();
  a.click('selfPlay'); a.tick(); a.workers[0].reply(0);
  a.tick();
  const stopped = a.workers[0];
  a.click('selfPlay'); stopped.reply(1);
  assert.equal(stopped.terminated, true);
  assert.equal(a.stones(), 1);
  assert.equal(a.state.thinking, false);
  assert.equal(a.element('resumeBot').hidden, false);
  a.click('resumeBot'); a.tick(); a.workers[1].reply(1);
  assert.equal(a.stones(), 2);
  assert.equal(a.state.toPlay, 1);
  assert.equal(a.element('resumeBot').hidden, true);
});

test('duplicate worker messages cannot play twice or leak into the next request', () => {
  const a = app();
  a.humanPlay(0); a.tick();
  const worker = a.workers[0];
  const staleMessage = { data: { revision: worker.request.revision, move: 3, stats: null } };
  worker.reply(1); worker.onmessage(staleMessage);
  assert.equal(a.stones(), 2);
  a.humanPlay(2); a.tick(); worker.onmessage(staleMessage);
  assert.equal(a.stones(), 3);
  assert.equal(a.state.thinking, true);
  worker.reply(3);
  assert.equal(a.stones(), 4);
});

test('illegal engine output leaves the position untouched and offers retry', () => {
  const a = app();
  a.humanPlay(0); a.tick(); a.workers[0].reply(0);
  assert.equal(a.stones(), 1);
  assert.equal(a.state.history.length, 1);
  assert.equal(a.state.thinking, false);
  assert.equal(a.workers[0].terminated, true);
  assert.equal(a.element('resumeBot').hidden, false);
});

test('worker load errors release controls without altering the board', () => {
  const a = app();
  a.humanPlay(0); a.tick();
  let prevented = false;
  a.workers[0].onerror({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(a.state.thinking, false);
  assert.equal(a.stones(), 1);
  assert.match(a.element('status').innerHTML, /HTTP/);
});

test('search statistics show an unknown win rate when no playouts completed', () => {
  const a = app();
  a.humanPlay(0); a.tick();
  a.workers[0].reply(1, { iterations: 0, winRate: null, visits: 0, children: 4 });
  assert.equal(a.element('tWin').textContent, '\u2014');
  a.newGame();
  assert.equal(a.element('tIters').textContent, '\u2014');
});

test('the real worker imports its engines and returns a legal move from each', () => {
  const messages = [];
  const sandbox = vm.createContext({ self: { postMessage: data => messages.push(data) } });
  sandbox.importScripts = (...names) => names.forEach(name => vm.runInContext(source(name), sandbox));
  vm.runInContext(source('search-worker.js'), sandbox);
  for (const useSearch of [true, false]) {
    sandbox.self.onmessage({ data: {
      revision: 9, colour: 1, useSearch,
      board: { n: 5, s: new Int8Array(25), ko: -1, captured: { 1: 0, '-1': 0 } },
      params: { J: 1, K: 0.4, Delta: 0.2, h: 0, alpha: 1, beta: 1, lam: 1 },
      opts: { budgetMs: 0, maxIterations: 2, temperature: 0.25, candidates: 8, passes: 0, komi: 0 },
    } });
    const result = messages.at(-1);
    assert.equal(result.revision, 9);
    assert.equal(result.error, undefined);
    assert.ok(Number.isInteger(result.move) && result.move >= -1 && result.move < 25);
    if (!useSearch) assert.equal(result.stats, null);
  }
});

console.log(`\n  ${passed} UI/worker regressions passed\n`);
