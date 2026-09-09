"""A Go engine built out of the model's own quantities.

The first version of this scored moves by the change in

    H_eff = H_0 - (alpha/beta) sum_c log det(L_c + R_c)

which is the right object for the equilibrium model and the wrong one for
choosing a move. `log det` is *extensive*: every stone adds roughly log 4, so
-alpha*log det behaves as a chemical potential for more stones and drowns out
everything else. The bot condensed instead of playing -- it filled the board
with a single solid mass.

What is used instead are the same quantities read intensively:

  * l_i, the number of empty points beside a stone, which is the diagonal of R
  * atari, which is a group whose liberty gap is one move from collapsing
  * the capturing race between adjacent short-of-breath groups
  * owned chambers, the territory functional
  * one ply of opponent reply, because a stone that dies next move otherwise
    looks perfectly healthy

It plays a weak but recognisable game. `docs/physics.js` is the same engine in
the browser, and `tests/` holds both to the same invariants.
"""
from __future__ import annotations

import math
import random

from .board import BLACK, EMPTY, WHITE, Board, opposite
from .hamiltonian import Params


def atari_weight(board: Board, colour: int) -> int:
    """Total size of `colour`'s groups that are down to a single liberty."""
    return sum(min(len(g), 8) for g, libs in board.groups(colour) if len(libs) == 1)


def total_liberties(board: Board, colour: int) -> int:
    return sum(len(libs) for _, libs in board.groups(colour))


def is_own_eye(board: Board, i: int, colour: int) -> bool:
    """A single-point eye of `colour`. Filling one destroys an H^0 class of
    your own complement and is never worth a stone."""
    if board.s[i] != EMPTY:
        return False
    if any(board.s[j] != colour for j in board.neighbours(i)):
        return False
    n = board.size
    r, c = divmod(i, n)
    enemy_diag = diag_count = 0
    for dr, dc in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
        rr, cc = r + dr, c + dc
        if not (0 <= rr < n and 0 <= cc < n):
            continue
        diag_count += 1
        if board.s[rr * n + cc] == opposite(colour):
            enemy_diag += 1
    return enemy_diag <= (0 if diag_count < 4 else 1)


def line_of(board: Board, i: int) -> int:
    n = board.size
    r, c = divmod(i, n)
    return min(r, c, n - 1 - r, n - 1 - c)


def move_score(board: Board, i: int, colour: int, p: Params,
               w_territory: float = 1.0, w_capture: float = 2.0) -> float:
    """Lower is better. Infinite means never play this."""
    from .topology import territory                      # local: cheap import

    if is_own_eye(board, i, colour):
        return float("inf")

    before_own_atari = atari_weight(board, colour)
    before_opp_atari = atari_weight(board, opposite(colour))
    before_own_libs = total_liberties(board, colour)
    before_opp_libs = total_liberties(board, opposite(colour))

    t = board.copy()
    captured = t.play(i, colour)

    own, own_libs = t.group(i)
    n_libs = len(own_libs)
    if n_libs == 0:
        return float("inf")

    a = p.alpha
    score = -w_capture * 3.0 * len(captured)

    # never hand over a group
    if n_libs == 1 and not captured:
        score += 12 + 3 * min(len(own), 8)

    # capturing race: short of breath and touching a better-off enemy group
    if n_libs <= 3 and not captured:
        losing, touches = bool(own), False
        for st in own:
            for j in t.neighbours(st):
                if t.s[j] == opposite(colour):
                    touches = True
                    if len(t.group(j)[1]) <= n_libs:
                        losing = False
        if touches and losing:
            score += a * 5.5 / n_libs
        score += a * 1.6 / (n_libs * n_libs)

    # rescue and pressure
    score += 4.0 * a * (atari_weight(t, colour) - before_own_atari)
    score -= 2.6 * a * (atari_weight(t, opposite(colour)) - before_opp_atari)

    # breathing room
    score -= 0.30 * a * (total_liberties(t, colour) - before_own_libs)
    score += 0.22 * a * (total_liberties(t, opposite(colour)) - before_opp_libs)

    # efficiency: solid clumps are strong and slow
    own_adj = sum(1 for j in board.neighbours(i) if board.s[j] == colour)
    opp_adj = sum(1 for j in board.neighbours(i) if board.s[j] == opposite(colour))
    if own_adj >= 2:
        score += 0.85 * (own_adj - 1)
    score += 0.25 * p.K * own_adj
    score -= 0.20 * p.J * opp_adj

    # where on the board, while it is still early
    stones = sum(1 for v in board.s if v != EMPTY)
    if stones < board.size * board.size * 0.25:
        line = line_of(board, i)
        if line == 0:
            score += 2.2
        elif line == 1:
            score += 0.9
        elif line in (2, 3):
            score -= 0.55

    if w_territory > 0:
        before = territory(board)[colour]
        after = territory(t)[colour]
        score -= w_territory * 0.35 * (after - before)

    return score


def candidate_moves(board: Board, colour: int, limit: int) -> list[int]:
    legal = [i for i in board.legal_moves(colour) if not is_own_eye(board, i, colour)]
    occupied = [i for i, v in enumerate(board.s) if v != EMPTY]
    if not occupied or len(legal) <= limit:
        return legal
    n = board.size

    def dist(i: int) -> int:
        r, c = divmod(i, n)
        return min(abs(r - divmod(o, n)[0]) + abs(c - divmod(o, n)[1]) for o in occupied)

    return sorted(legal, key=dist)[:limit]


def score_with_reply(board: Board, i: int, colour: int, p: Params,
                     w_territory: float, w_capture: float,
                     gamma: float, reply_width: int) -> float:
    """Minimax to depth two: a move refuted by the obvious answer is not good."""
    own = move_score(board, i, colour, p, w_territory, w_capture)
    if not math.isfinite(own) or gamma <= 0:
        return own
    t = board.copy()
    t.play(i, colour)
    best = float("inf")
    for j in candidate_moves(t, opposite(colour), reply_width):
        r = move_score(t, j, opposite(colour), p, 0.0, w_capture)
        best = min(best, r)
    if not math.isfinite(best):
        return own
    return own - gamma * best


def choose_move(board: Board, colour: int, p: Params,
                temperature: float = 0.25,
                w_territory: float = 1.0,
                w_capture: float = 2.0,
                candidates: int = 60,
                shortlist: int = 12,
                reply_width: int = 12,
                gamma: float = 0.8,
                pass_threshold: float = 2.5,
                rng: random.Random | None = None) -> int | None:
    """Rank cheaply, then spend the lookahead on the shortlist. None = pass."""
    rng = rng or random.Random()

    if all(v == EMPTY for v in board.s):
        n = board.size
        k = 3 if n >= 13 else 2
        mid = (n - 1) // 2
        stars = [r * n + c for r in (k, mid, n - 1 - k) for c in (k, mid, n - 1 - k)]
        return rng.choice(stars)

    cands = candidate_moves(board, colour, candidates)
    if not cands:
        return None

    rough = [(i, move_score(board, i, colour, p, 0.0, w_capture)) for i in cands]
    rough = [(i, s) for i, s in rough if math.isfinite(s)]
    if not rough:
        return None
    rough.sort(key=lambda t: t[1])

    scored = []
    for i, _ in rough[:shortlist]:
        s = score_with_reply(board, i, colour, p, w_territory, w_capture,
                             gamma, reply_width)
        if math.isfinite(s):
            scored.append((i, s))
    if not scored:
        return None

    best = min(s for _, s in scored)
    if best > pass_threshold:
        return None
    if temperature <= 1e-9:
        return min(scored, key=lambda t: t[1])[0]

    weights = [math.exp(-(s - best) / temperature) for _, s in scored]
    r = rng.random() * sum(weights)
    acc = 0.0
    for (i, _), w in zip(scored, weights):
        acc += w
        if acc >= r:
            return i
    return scored[-1][0]
