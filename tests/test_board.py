"""Regression tests for position changes that do not place a stone."""
from golattice.board import BLACK, WHITE, Board


def test_pass_releases_simple_ko_without_changing_stones_or_captures():
    board = Board(5)
    for row, col in [(0, 1), (1, 0), (2, 1)]:
        board.s[board.idx(row, col)] = BLACK
    for row, col in [(1, 1), (0, 2), (2, 2), (1, 3)]:
        board.s[board.idx(row, col)] = WHITE
    captured = board.idx(1, 1)
    capture = board.idx(1, 2)
    assert board.is_legal(capture, BLACK)
    assert board.play(capture, BLACK) == [captured]
    assert board.ko == captured
    assert not board.is_legal(captured, WHITE)

    stones, captures = list(board.s), dict(board.captured)
    board.pass_turn()
    assert board.ko is None
    assert board.s == stones
    assert board.captured == captures
    assert board.is_legal(captured, WHITE)
