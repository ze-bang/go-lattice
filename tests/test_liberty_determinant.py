"""The determinant theorem is the load-bearing claim, so it gets tested
against the direct combinatorial check on random positions."""
from __future__ import annotations

import random

import numpy as np
import pytest

from golattice.board import BLACK, EMPTY, WHITE, Board
from golattice.hamiltonian import Params, h_eff
from golattice.laplacian import (all_gaps, group_matrix, has_all_liberties,
                                 liberty_gap, log_det, vulnerability)
from golattice.topology import chambers, enclosure


def test_single_stone_determinant_is_its_root_weight():
    b = Board(5)
    b.s[b.idx(2, 2)] = BLACK
    g, _ = b.group(b.idx(2, 2))
    M = group_matrix(b, g, lam=1.0)
    # isolated stone in open space: L = [0], R = [4 liberties]
    assert M.shape == (1, 1)
    assert np.isclose(M[0, 0], 4.0)
    assert np.isclose(np.linalg.det(M), 4.0)


def test_two_stone_chain_matches_r1_plus_r2_plus_r1r2():
    """det(L + R) = r1 + r2 + r1*r2 for a two-stone group."""
    b = Board(5)
    i, j = b.idx(2, 2), b.idx(2, 3)
    b.s[i] = b.s[j] = BLACK
    g, _ = b.group(i)
    M = group_matrix(b, g, lam=1.0)
    r1, r2 = b.liberty_count(i), b.liberty_count(j)
    assert np.isclose(np.linalg.det(M), r1 + r2 + r1 * r2)


def test_surrounded_group_is_singular():
    """A stone with no liberty must give det = 0 and a zero liberty gap."""
    b = Board(5)
    c = b.idx(2, 2)
    b.s[c] = BLACK
    for j in b.neighbours(c):
        b.s[j] = WHITE
    g, libs = b.group(c)
    assert libs == set()
    M = group_matrix(b, g, lam=1.0)
    assert np.isclose(np.linalg.det(M), 0.0)
    assert np.isclose(liberty_gap(b, g), 0.0)
    assert log_det(b, BLACK) == float("-inf")


@pytest.mark.parametrize("size", [2, 5, 6, 9])
@pytest.mark.parametrize("colour", [BLACK, WHITE])
def test_dense_dead_group_has_exact_singular_observables(size, colour):
    """Floating LU/inversion can mistake a Laplacian zero mode for a tiny pivot."""
    b = Board(size, [colour] * (size * size))
    group, libs = b.group(0)
    assert not libs
    assert log_det(b, colour) == float("-inf")
    assert liberty_gap(b, group) == 0.0
    assert vulnerability(b, group) == float("inf")
    assert h_eff(b, Params()) == float("inf")


def test_a_live_group_does_not_mask_a_dead_group_of_the_same_colour():
    b = Board(7)
    for i in [0, 1, 7, 8, 48]:
        b.s[i] = BLACK
    for i in [2, 9, 14, 15]:
        b.s[i] = WHITE
    assert sorted(bool(libs) for _, libs in b.groups(BLACK)) == [False, True]
    assert log_det(b, BLACK) == float("-inf")
    assert h_eff(b, Params()) == float("inf")


@pytest.mark.parametrize("lam", [1e-14, 0.25, 3.0])
def test_positive_root_scales_preserve_single_stone_observables(lam):
    b = Board(5)
    b.s[12] = BLACK
    group, _ = b.group(12)
    root = 4 * lam
    assert log_det(b, BLACK, lam) == pytest.approx(np.log(root))
    assert liberty_gap(b, group, lam) == pytest.approx(root, abs=0)
    assert vulnerability(b, group, lam) == pytest.approx(1 / root)


@pytest.mark.parametrize("lam", [0, -1, float("inf"), float("-inf"), float("nan")])
def test_root_scale_must_be_finite_and_positive_even_on_empty_boards(lam):
    b = Board(5)
    calls = [
        lambda: group_matrix(b, set(), lam),
        lambda: liberty_gap(b, set(), lam),
        lambda: vulnerability(b, set(), lam),
        lambda: log_det(b, BLACK, lam),
        lambda: all_gaps(b, BLACK, lam),
    ]
    for call in calls:
        with pytest.raises(ValueError, match="finite and positive"):
            call()


@pytest.mark.parametrize("seed", range(40))
def test_determinant_theorem_on_random_positions(seed):
    """det M_c > 0 for every colour  <=>  every group has a liberty."""
    rng = random.Random(seed)
    b = Board(7)
    for i in range(len(b.s)):
        b.s[i] = rng.choice([EMPTY, EMPTY, BLACK, WHITE])

    for colour in (BLACK, WHITE):
        combinatorial = has_all_liberties(b, colour)
        determinant = log_det(b, colour) != float("-inf")
        assert combinatorial == determinant, (
            f"seed={seed} colour={colour}\n{b}")


@pytest.mark.parametrize("seed", range(20))
def test_liberty_gap_vanishes_exactly_for_dead_groups(seed):
    rng = random.Random(1000 + seed)
    b = Board(7)
    for i in range(len(b.s)):
        b.s[i] = rng.choice([EMPTY, BLACK, WHITE])
    for colour in (BLACK, WHITE):
        for g, libs in b.groups(colour):
            gap = liberty_gap(b, g)
            if libs:
                assert gap > 1e-9
            else:
                assert gap < 1e-9


def test_chambers_count_empty_regions():
    """A ring of stones splits the empty set into inside and outside."""
    b = Board(7)
    ring = [(2, 2), (2, 3), (2, 4), (3, 2), (3, 4), (4, 2), (4, 3), (4, 4)]
    for r, c in ring:
        b.s[b.idx(r, c)] = BLACK
    chs = chambers(b)
    sizes = sorted(len(c) for c in chs)
    assert sizes[0] == 1                    # the single enclosed point (3,3)
    assert len(chs) == 2                    # inside and outside


def test_enclosure_counts_one_for_a_single_ring():
    b = Board(7)
    ring = [(2, 2), (2, 3), (2, 4), (3, 2), (3, 4), (4, 2), (4, 3), (4, 4)]
    for r, c in ring:
        b.s[b.idx(r, c)] = BLACK
    assert enclosure(b) == 1


def test_capture_removes_the_group():
    b = Board(5)
    c = b.idx(2, 2)
    b.s[c] = WHITE
    for j in list(b.neighbours(c))[:-1]:
        b.s[j] = BLACK
    last = list(b.neighbours(c))[-1]
    removed = b.play(last, BLACK)
    assert removed == [c]
    assert b.s[c] == EMPTY
