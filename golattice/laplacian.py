"""The liberty constraint as a Laplacian determinant.

For one colour c, let G_c be the graph of same-colour stones with nearest-
neighbour edges, L_c its graph Laplacian, and R_c = diag(lambda * l_i) the
root weights, where l_i counts empty sites adjacent to stone i.

    M_c = L_c + R_c

    det M_c > 0  <=>  every group of colour c has at least one liberty

and by the matrix-forest theorem det M_c counts rooted spanning forests in
which every stone reaches a liberty. This module computes M_c, its
determinant, its smallest eigenvalue (the "liberty gap"), and the Green
function trace used as a vulnerability measure.
"""
from __future__ import annotations

import numpy as np

from .board import EMPTY, Board


def group_matrix(board: Board, group: set[int], lam: float = 1.0) -> np.ndarray:
    """M = L + R for a single group, as a dense symmetric matrix."""
    sites = sorted(group)
    pos = {s: k for k, s in enumerate(sites)}
    M = np.zeros((len(sites), len(sites)))
    for s in sites:
        a = pos[s]
        for t in board.neighbours(s):
            b = pos.get(t)
            if b is not None:                  # same-colour edge, seen once per end
                M[a, a] += 1.0                 # degree
                M[a, b] -= 1.0                 # off-diagonal
        M[a, a] += lam * board.liberty_count(s)   # root weight r_i
    return M


def liberty_gap(board: Board, group: set[int], lam: float = 1.0) -> float:
    """lambda_min(L + R). Zero exactly when the group has no liberty."""
    if not group:
        return float("inf")
    M = group_matrix(board, group, lam)
    return float(np.linalg.eigvalsh(M)[0])


def log_det(board: Board, colour: int, lam: float = 1.0) -> float:
    """sum_groups log det(L + R) for one colour; -inf if any group is dead."""
    total = 0.0
    for g, _ in board.groups(colour):
        M = group_matrix(board, g, lam)
        sign, ld = np.linalg.slogdet(M)
        if sign <= 0:
            return float("-inf")
        total += ld
    return total


def vulnerability(board: Board, group: set[int], lam: float = 1.0) -> float:
    """Tr (L + R)^{-1}. Diverges as the group approaches capture."""
    if not group:
        return 0.0
    M = group_matrix(board, group, lam)
    try:
        return float(np.trace(np.linalg.inv(M)))
    except np.linalg.LinAlgError:
        return float("inf")


def all_gaps(board: Board, colour: int, lam: float = 1.0) -> list[tuple[set[int], float]]:
    """Liberty gap for every group of one colour."""
    return [(g, liberty_gap(board, g, lam)) for g, _ in board.groups(colour)]


def has_all_liberties(board: Board, colour: int) -> bool:
    """Direct combinatorial check, used to verify the determinant theorem."""
    return all(libs for _, libs in board.groups(colour))
