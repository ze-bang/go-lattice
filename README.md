# go-lattice

A condensed-matter study of Go, and a Go bot that plays by it.

**[Play against the physics →](https://ze-bang.github.io/go-lattice/)**

I play Go. This repository is what happened when I started asking why a game whose
rules are entirely local produces objects — groups, eyes, territory, life — that are
entirely nonlocal.

---

## The idea in one page

A Go position is a spin-1 configuration: `s_i ∈ {−1, 0, +1}` for White, empty, Black.
That alone gets you a Blume–Emery–Griffiths lattice gas, which is unremarkable. The
interesting part is the liberty rule.

> Every connected group of stones must touch at least one empty point, or it is removed.

That reads as a global condition on connected components. It isn't. For one colour,
let `L_c` be the graph Laplacian of the same-colour stone graph, and `R_c = diag(λ·ℓ_i)`
where `ℓ_i` counts empty sites adjacent to stone `i`. Then

```
det(L_c + R_c) > 0   ⟺   every group of colour c has a liberty
```

The proof is three lines (`x'Mx` is a sum of squares; the zero modes are exactly the
components with no rooted vertex), and it is in the paper. By the matrix-forest theorem
that determinant *counts rooted spanning forests* — configurations in which every stone
follows a path to a liberty. So the survival rule becomes a local, certifiable object:

```
liberty rule  →  Laplacian determinant  →  rooted forests  →  fermionic field theory
```

Two consequences worth stating plainly:

- **A group with a liberty is a domain with a sink.** `M = L + R` is a killed Laplacian; liberties
  are absorbing roots. Capture is the spectral event `λ_min → 0`. That smallest eigenvalue
  — the *liberty gap* — measures rooting strength, and the bot plots it live. A positive
  gap certifies a current liberty; it does not establish life against best play.
- **Territory is complement topology.** Empty regions are the connected components of the
  complement of the barrier `B = stones ∪ board edge`. By Alexander duality on the sphere,
  extra complement components are exactly the H¹ classes of the barrier, so the enclosure
  count is `ℰ = β₀(empty) − 1` — the board edge supplies the one trivial cycle.

The open question the paper is actually about:

> Can a locally interacting, locally certifiable lattice system undergo a phase transition
> in the **topology of its complement**?

Go is the system that tells you which local constraint to study.

## What's here

```
paper/       the write-up (LaTeX + PDF, 21pp)
golattice/   Python reference implementation
tests/       physics invariants, board rules, search, and game controls
docs/
  physics.js    the model: Laplacian, forests, chambers, move score
  fastboard.js  union-find board built for playouts
  mcts.js       tree search, with the physics score as prior
  search-worker.js  background search so game controls stay responsive
  index.html    the page
```

## The bot

`docs/` is a static page with no JavaScript dependencies. It uses no neural network or
opening book. The evaluation combines the model's liberty and territory quantities
with hand-tuned tactical, opening, and shape heuristics.

The first version scored moves by the change in `H_eff` — which is the right object for
the equilibrium model and the wrong one for choosing a move. **`log det` is extensive.**
Every stone adds about `log 4`, so `−α log det` acts as a chemical potential for more
stones and swamps every other term. The bot condensed instead of playing: it filled the
board with one solid mass and captured 52 stones in a 9×9 game.

What it uses instead are the same quantities read *intensively*:

| term | what it is |
|---|---|
| liberties `ℓ_i` | the diagonal of `R` in `M = L + R`, counted rather than diagonalised |
| atari | a group one move from its liberty gap collapsing |
| capturing race | whether a short-of-breath group beats the enemy group beside it |
| eye protection | never fill your own single-point eye — that destroys an H⁰ class of your own complement |
| territory | owned chambers, the functional `T[s]` |
| one ply of reply | a stone that dies next move otherwise scores perfectly well |

That last one mattered most. Without it the bot fed stones to its opponent all game;
with it, self-play settles into games like 30–29 with 8 captures.

`α` is wired to exactly the terms it names — the liberty-entropy weight scales how hard
the bot fights for breath. At `α = 0.1` it plays carelessly and loses about 54 stones a
game; at `α = 3.0` that drops to 18. The other sliders move it similarly.

It is still weak. A club player will take it apart, it has no concept of life and death
beyond the one-move horizon, and it does not know when a position is settled well enough
to leave alone. What it is instead is *legible*: every curve beside the board is computed
from the position it is playing, and the sliders are coefficients in its scoring rather
than opaque weights.

Live panels: liberty gap per group, `log det(L+R)` per colour, β₀ of empty space, the
enclosure count ℰ, and territory. Board overlays show chambers, ownership, and liberty
gap as heat.

## Search

The score above is now the **prior**, not the whole engine. MCTS is importance sampling
of the game tree, which sits comfortably on a statistical-mechanics model:

```
PUCT(a) = Q(a) + c · P(a) · √N / (1 + n(a))
```

`P` is a softmax of the physics score, so the sliders decide where the search looks
first. `Q` comes from rolling the position out to the end thousands of times, so they
no longer have the last word. Rollouts use only atari, captures and eyes — the same
liberty structure the plots draw, counted rather than diagonalised.

**It needed a faster board first.** `Board` in `physics.js` clones itself to answer
`isLegal`, making legality O(N) and a playout worse than O(N²) — 11.9 ms for one 9×9
playout, about 17 in a 200 ms budget, where MCTS wants thousands. `fastboard.js` is the
standard representation instead: union-find chains with liberties maintained
incrementally as *pseudo-liberties*, plus their sum and sum of squares. That last part is
what makes atari exact — for a multiset with count `p`, sum `s` and sum-of-squares `q`,
Cauchy–Schwarz gives `s² ≤ pq` with equality iff every element is identical, so

```
real liberties == 0  ⟺  p == 0
real liberties == 1  ⟺  s² == p·q,  the point being s/p
```

| | before | after | playouts / 500 ms |
|---|---|---|---|
| 9×9 | 11.9 ms | **0.110 ms** | 4,566 |
| 13×13 | 79.1 ms | **0.276 ms** | 1,815 |
| 19×19 | 452 ms | **1.079 ms** | 463 |

Search against the raw score, 250 ms per move on 9×9, alternating colours:

```
MCTS won 10/10       margins: 15, 11, 11, 17, 23, 11, 9, 35, 13, 31
```

`Score only` on the page turns the search off if you want to play the bare model again.
19×19 is the weak case — a few hundred playouts is thin for a board that size.

Both engines run in a Web Worker. New game, Undo, and Stop cancel pending work, so
an old search cannot place a stone into a new position. Passes are undoable turns;
they clear simple ko, and two consecutive passes end the game. The displayed result
uses area scoring (stones plus surrounded empty points), zero komi, and no automatic
dead-stone removal. Play out disputed groups before passing.

Search includes passing as an action, including after an opponent's pass. Its prior
compares the stone score with the pass threshold, so Δ affects whether to continue;
temperature controls the root prior in Search and move sampling in Score only.

Incremental liberty bookkeeping fails silently, so `tests/test_fastboard.mjs` plays ~140
random games in lockstep against the reference board and compares legality **at every
point on every move**, plus ko, liberty class, the atari point, and the area score
against `topology.js`.

## Running locally

Serve the page over HTTP so the browser can load its worker:

```bash
python -m http.server 8000 --directory docs
```

Open `http://localhost:8000`. The hosted page works without any setup.

## Running the Python side

```bash
pip install numpy pytest
python -m pytest tests/ -q
```

```python
from golattice.board import Board, BLACK
from golattice.laplacian import liberty_gap, log_det
from golattice.topology import summary

b = Board(9)
for r, c in [(2,2),(2,3),(3,2),(3,3)]:
    b.s[b.idx(r, c)] = BLACK

g, libs = b.group(b.idx(2, 2))
print(liberty_gap(b, g))   # λ_min(L+R): how far from capture
print(summary(b))          # β₀, enclosure, territory
```

The board, Laplacian, and topology functions in `docs/physics.js` follow the Python
reference. Their test suites check the same invariants; the browser's move policy
has evolved separately from `golattice/engine.py`. Run all JavaScript checks with:

```bash
node tests/test_physics_js.mjs
node tests/test_fastboard.mjs
node tests/test_mcts.mjs
node tests/test_app.mjs
```

The tests cover the determinant theorem, the liberty gap vanishing at capture,
chamber counts, capture/ko/pass rules, deterministic search, and cancellation of
stale worker replies. GitHub Actions runs the Python and JavaScript suites on pushes
and pull requests.

Root weights require finite `λ > 0`. Dead groups are identified from their exact
liberty sets before numerical factorization, since roundoff can otherwise give a
singular Laplacian a positive determinant. The browser's nonzero liberty gaps use
an iterative approximation; Python uses a dense symmetric eigensolver.

## Status

The theorems in §"What could actually be proved" are proved. The three conjectures —
an enclosure transition in equilibrium, driven enclosure without an explicit topological
term, and strategy-induced topology — are open, and are the reason the repository exists.

The honest summary is not "Go is an Ising model". It is:

```
Go-like physics = spin-1 lattice gas
                + rooted-forest constraints
                + loop/complement topology
                + nonequilibrium adversarial dynamics
```
