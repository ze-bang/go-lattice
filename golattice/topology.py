"""Complement topology: chambers, barriers, enclosure, territory.

Empty regions use 4-connectivity, which pairs with 8-connectivity on the
barrier. That pairing is what makes the digital analogue of Alexander duality
come out right: with the same connectivity on both sides, a diagonal chain of
stones would be simultaneously a closed curve and not a separator. Under
4-connected empty space a diagonal wall does separate, which matches both the
duality and the Go intuition that a diagonal wall encloses territory even
though it is not a solid connection.

Barrier cycles are therefore read off the complement rather than counted in
the barrier graph directly -- see `barrier_betti1`.
"""
from __future__ import annotations

from .board import BLACK, EMPTY, WHITE, Board

# ownership codes
NEUTRAL = 0


def _neighbours4(n: int, i: int):
    r, c = divmod(i, n)
    if r > 0:
        yield i - n
    if r < n - 1:
        yield i + n
    if c > 0:
        yield i - 1
    if c < n - 1:
        yield i + 1


def chambers(board: Board) -> list[set[int]]:
    """Connected components of empty space (4-connectivity).

    Their count is beta_0(E_s) = dim H^0 of the empty-space complex.
    """
    n = board.size
    seen: set[int] = set()
    out: list[set[int]] = []
    for i, v in enumerate(board.s):
        if v != EMPTY or i in seen:
            continue
        comp, stack = {i}, [i]
        seen.add(i)
        while stack:
            j = stack.pop()
            for k in _neighbours4(n, j):
                if board.s[k] == EMPTY and k not in seen:
                    seen.add(k)
                    comp.add(k)
                    stack.append(k)
        out.append(comp)
    return out


def chamber_owner(board: Board, chamber: set[int]) -> int:
    """+1 / -1 if every adjacent stone is one colour, 0 if mixed or none."""
    n = board.size
    colours = set()
    for i in chamber:
        for j in _neighbours4(n, i):
            if board.s[j] != EMPTY:
                colours.add(board.s[j])
    if colours == {BLACK}:
        return BLACK
    if colours == {WHITE}:
        return WHITE
    return NEUTRAL


def territory(board: Board) -> dict[int, int]:
    """Owned empty area per colour: the functional T[s] of the note."""
    out = {BLACK: 0, WHITE: 0, NEUTRAL: 0}
    for ch in chambers(board):
        out[chamber_owner(board, ch)] += len(ch)
    return out


def barrier_betti1(board: Board) -> int:
    """beta_1 of the barrier complex B_s = stones union the board boundary.

    Rather than counting cycles in the barrier directly, read them off the
    complement. Alexander duality on the sphere gives

        H~_0(S^2 - B) ~= H~^1(B),

    so independent barrier cycles correspond to extra complement components.
    Modelling the board as a disk whose edge already belongs to B, the
    components of the complement are exactly the empty chambers, hence

        beta_1(B_s) = #chambers.

    Counting cycles in an 8-connected barrier *graph* instead would be wrong:
    E - V + C picks up every little diagonal triangle, which are artefacts of
    the graph rather than cycles of the thickened complex. An empty board
    returns 1 (the board edge itself), which `enclosure` subtracts off.
    """
    return len(chambers(board))


def enclosure(board: Board) -> int:
    """E(s) = beta_1(B_s) - 1, dropping the trivial board-edge cycle."""
    return max(0, barrier_betti1(board) - 1)


def summary(board: Board) -> dict:
    """Everything the live plots need, in one pass."""
    chs = chambers(board)
    terr = {BLACK: 0, WHITE: 0, NEUTRAL: 0}
    for ch in chs:
        terr[chamber_owner(board, ch)] += len(ch)
    return {
        "beta0_empty": len(chs),
        "beta1_barrier": barrier_betti1(board),
        "enclosure": enclosure(board),
        "territory_black": terr[BLACK],
        "territory_white": terr[WHITE],
        "territory_neutral": terr[NEUTRAL],
        "largest_owned": max((len(c) for c in chs
                              if chamber_owner(board, c) != NEUTRAL), default=0),
    }
