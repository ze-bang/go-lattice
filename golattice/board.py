"""Go board mechanics: groups, liberties, capture, ko.

Deliberately plain: the interesting physics lives in laplacian.py and
topology.py, and this module exists to hand those a correct position.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator

EMPTY, BLACK, WHITE = 0, 1, -1


def opposite(color: int) -> int:
    return -color


@dataclass
class Board:
    """A Go position as a spin-1 configuration s_i in {-1, 0, +1}."""

    size: int = 19
    s: list[int] = field(default_factory=list)
    ko: int | None = None           # site forbidden by the simple ko rule
    captured: dict[int, int] = field(default_factory=lambda: {BLACK: 0, WHITE: 0})

    def __post_init__(self) -> None:
        if not self.s:
            self.s = [EMPTY] * (self.size * self.size)

    # -- geometry ---------------------------------------------------------
    def idx(self, r: int, c: int) -> int:
        return r * self.size + c

    def rc(self, i: int) -> tuple[int, int]:
        return divmod(i, self.size)

    def neighbours(self, i: int) -> Iterator[int]:
        n = self.size
        r, c = divmod(i, n)
        if r > 0:
            yield i - n
        if r < n - 1:
            yield i + n
        if c > 0:
            yield i - 1
        if c < n - 1:
            yield i + 1

    # -- groups and liberties ---------------------------------------------
    def group(self, i: int) -> tuple[set[int], set[int]]:
        """Connected same-colour component containing i, and its liberties."""
        colour = self.s[i]
        if colour == EMPTY:
            return set(), set()
        seen, stack, libs = {i}, [i], set()
        while stack:
            j = stack.pop()
            for k in self.neighbours(j):
                if self.s[k] == EMPTY:
                    libs.add(k)
                elif self.s[k] == colour and k not in seen:
                    seen.add(k)
                    stack.append(k)
        return seen, libs

    def groups(self, colour: int) -> list[tuple[set[int], set[int]]]:
        """Every group of `colour`, each with its liberty set."""
        out: list[tuple[set[int], set[int]]] = []
        seen: set[int] = set()
        for i, v in enumerate(self.s):
            if v == colour and i not in seen:
                g, libs = self.group(i)
                seen |= g
                out.append((g, libs))
        return out

    def liberty_count(self, i: int) -> int:
        """l_i: number of empty sites adjacent to site i."""
        return sum(1 for j in self.neighbours(i) if self.s[j] == EMPTY)

    # -- moves -------------------------------------------------------------
    def is_legal(self, i: int, colour: int) -> bool:
        if i < 0 or i >= len(self.s) or self.s[i] != EMPTY:
            return False
        if self.ko is not None and i == self.ko:
            return False
        # try it
        trial = self.copy()
        trial.s[i] = colour
        # captures first
        for j in trial.neighbours(i):
            if trial.s[j] == opposite(colour):
                g, libs = trial.group(j)
                if not libs:
                    return True          # captures something, so legal
        # otherwise the new group must have a liberty (no suicide)
        _, libs = trial.group(i)
        return bool(libs)

    def play(self, i: int, colour: int) -> list[int]:
        """Place a stone and resolve captures. Returns the captured sites."""
        self.s[i] = colour
        removed: list[int] = []
        for j in list(self.neighbours(i)):
            if self.s[j] == opposite(colour):
                g, libs = self.group(j)
                if not libs:
                    removed.extend(g)
                    for k in g:
                        self.s[k] = EMPTY
        self.captured[colour] = self.captured.get(colour, 0) + len(removed)

        # simple ko: a single stone captured by a single stone with one liberty
        own, own_libs = self.group(i)
        self.ko = removed[0] if (len(removed) == 1 and len(own) == 1
                                 and len(own_libs) == 1) else None
        return removed

    def legal_moves(self, colour: int) -> list[int]:
        return [i for i in range(len(self.s)) if self.is_legal(i, colour)]

    def copy(self) -> "Board":
        b = Board(self.size, list(self.s), self.ko, dict(self.captured))
        return b

    def __str__(self) -> str:
        glyph = {EMPTY: ".", BLACK: "X", WHITE: "O"}
        rows = []
        for r in range(self.size):
            rows.append(" ".join(glyph[self.s[self.idx(r, c)]]
                                 for c in range(self.size)))
        return "\n".join(rows)
