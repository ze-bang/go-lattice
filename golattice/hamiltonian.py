"""The Blume-Emery-Griffiths energy and the forest-corrected effective energy.

    H_0 = -J sum_<ij> s_i s_j - K sum_<ij> s_i^2 s_j^2 + Delta sum_i s_i^2 - h sum_i s_i

    H_eff = H_0 - (alpha/beta) sum_c log det(L_c + R_c)

The second term is the liberty entropy: it rewards positions whose stones
have many independent rooted-forest routes to a liberty.
"""
from __future__ import annotations

from dataclasses import dataclass

from .board import BLACK, EMPTY, WHITE, Board
from .laplacian import log_det


@dataclass
class Params:
    J: float = 1.0        # colour alignment
    K: float = 0.4        # occupation clustering, colour-blind
    Delta: float = 0.2    # crystal field: cost of putting a stone down
    h: float = 0.0        # Black/White bias
    alpha: float = 1.0    # forest exponent
    beta: float = 1.0     # inverse temperature
    lam: float = 1.0      # root weight scale


def h0(board: Board, p: Params) -> float:
    """Bond energy of a position. Each edge counted once."""
    n = board.size
    e_pair = 0.0
    for i, si in enumerate(board.s):
        r, c = divmod(i, n)
        for j in ((i + 1) if c < n - 1 else None, (i + n) if r < n - 1 else None):
            if j is None:
                continue
            sj = board.s[j]
            e_pair += -p.J * si * sj - p.K * (si * si) * (sj * sj)
    n_stones = sum(1 for v in board.s if v != EMPTY)
    m_total = sum(board.s)
    return e_pair + p.Delta * n_stones - p.h * m_total


def forest_term(board: Board, p: Params) -> float:
    """-(alpha/beta) sum_c log det M_c. +inf if either colour has a dead group."""
    total = 0.0
    for colour in (BLACK, WHITE):
        ld = log_det(board, colour, p.lam)
        if ld == float("-inf"):
            return float("inf")
        total += ld
    return -(p.alpha / p.beta) * total


def h_eff(board: Board, p: Params) -> float:
    f = forest_term(board, p)
    if f == float("inf"):
        return float("inf")
    return h0(board, p) + f
