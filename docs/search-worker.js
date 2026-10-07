/* Run both move engines away from rendering and input handling. */
'use strict';

importScripts('physics.js', 'fastboard.js', 'mcts.js');

self.onmessage = ({ data }) => {
  const { revision, colour, params, opts, useSearch } = data;
  try {
    const board = new Board(data.board.n);
    board.s.set(data.board.s);
    board.ko = data.board.ko;
    board.captured = { ...data.board.captured };
    const move = useSearch ? mctsChooseMove(board, colour, params, opts)
      : chooseMove(board, colour, params, opts);
    self.postMessage({ revision, move, stats: useSearch ? mctsChooseMove.lastStats : null });
  } catch (error) {
    self.postMessage({ revision, error: error.message });
  }
};
