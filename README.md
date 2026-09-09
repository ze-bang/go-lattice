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

- **A living group is a domain with a sink.** `M = L + R` is a killed Laplacian; liberties
  are absorbing roots. Capture is the spectral event `λ_min → 0`. That smallest eigenvalue
  — the *liberty gap* — is a continuous measure of how close a group is to dying, and the
  bot plots it live.
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
tests/       the theorems, tested — Python and JS agree numerically
docs/        the interactive bot (GitHub Pages)
```

## The bot

`docs/` is a self-contained page with no dependencies. No neural network, no opening
book, and nothing in the evaluation that wasn't derived from the model.

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
gap as heat. Roughly 13 ms per move on 9×9 and 35 ms on 19×19.

## Running the Python side

```bash
pip install numpy pytest
PYTHONPATH=. python -m pytest tests/ -q
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

The JS engine in `docs/physics.js` is a port of the same functions, and
`tests/test_physics_js.mjs` checks it against the same invariants:

```bash
node tests/test_physics_js.mjs
```

If the two ever disagree — on the determinant theorem, on the liberty gap vanishing
exactly at capture, on the chamber count — that suite fails.

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
