"""A Go engine whose evaluation function is the model itself.

There is no tree search, no neural network and no opening book. The engine
scores each legal move by the change it makes to

    H_eff = H_0 - (alpha/beta) sum_c log det(L_c + R_c)

plus a territory term, and samples from the resulting Boltzmann weight. It
is not strong. The point is that every term you can see in the plots is a
term it is actually playing by, so turning a slider visibly changes its
style: raise K and it clumps, raise alpha and it fights for liberties,
raise the territory weight and it starts walling off the board.
"""
from __future__ import annotations

import math
import random

from .board import BLACK, EMPTY, WHITE, Board, opposite
from .hamiltonian import Params, h0
from .laplacian import group_matrix, liberty_gap, log_det
from .topology import enclosure, territory


def move_score(board: Board, i: int, colour: int, p: Params,
               w_territory: float = 1.0, w_capture: float = 2.0) -> float:
    """Lower is better. Energy change of playing at i, plus reward terms."""
    before_h0 = h0(board, p)
    before_terr = territory(board)[colour]

    trial = board.copy()
    captured = trial.play(i, colour)

    after_h0 = h0(trial, p)
    d_energy = after_h0 - before_h0

    # forest term: reward keeping our own liberty gaps open and closing theirs
    ld_own = log_det(trial, colour, p.lam)
    ld_opp = log_det(trial, opposite(colour), p.lam)
    if ld_own == float("-inf"):
        return float("inf")                      # self-atari into death
    d_forest = -(p.alpha / p.beta) * ld_own
    if ld_opp != float("-inf"):
        d_forest += (p.alpha / p.beta) * ld_opp * 0.5   # squeeze the opponent

    d_terr = territory(trial)[colour] - before_terr

    return (d_energy + d_forest
            - w_territory * d_terr
            - w_capture * len(captured))


def choose_move(board: Board, colour: int, p: Params,
                temperature: float = 0.6,
                w_territory: float = 1.0,
                w_capture: float = 2.0,
                candidates: int | None = None,
                rng: random.Random | None = None) -> int | None:
    """Boltzmann-sample a move from the physics score. None means pass."""
    rng = rng or random.Random()
    legal = board.legal_moves(colour)
    if not legal:
        return None

    # near existing stones first: the energy is local, so distant moves are
    # almost always flat and just cost time to score
    if candidates is not None and len(legal) > candidates:
        occupied = [i for i, v in enumerate(board.s) if v != EMPTY]
        if occupied:
            def dist(i: int) -> int:
                r, c = divmod(i, board.size)
                return min(abs(r - divmod(o, board.size)[0])
                           + abs(c - divmod(o, board.size)[1]) for o in occupied)
            legal.sort(key=dist)
        legal = legal[:candidates]

    scores = [move_score(board, i, colour, p, w_territory, w_capture) for i in legal]
    finite = [(i, s) for i, s in zip(legal, scores) if s != float("inf")]
    if not finite:
        return None

    best = min(s for _, s in finite)
    if temperature <= 1e-9:
        return min(finite, key=lambda t: t[1])[0]
    weights = [math.exp(-(s - best) / temperature) for _, s in finite]
    total = sum(weights)
    r = rng.random() * total
    acc = 0.0
    for (i, _), w in zip(finite, weights):
        acc += w
        if acc >= r:
            return i
    return finite[-1][0]
