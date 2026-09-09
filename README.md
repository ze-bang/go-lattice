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

`docs/` is a self-contained page with no dependencies. The engine has **no tree search,
no network and no opening book**. It scores each legal move by

```
ΔH_eff  =  ΔH_BEG  −  (α/β) Σ_c log det(L_c + R_c)  −  w·Δterritory  −  w·captures
```

and Boltzmann-samples from it. It is not strong — a competent club player will take it
apart. That is the point: every term on the plots is a term it is actually playing by,
so moving a slider visibly changes its style. Turn `K` up and it clumps. Turn `α` up and
it starts fighting for liberties instead of territory. Set the temperature to zero and it
plays the single lowest-energy move every time, which is a surprisingly rigid opponent.

Live panels: liberty gap per group, `log det(L+R)` per colour over the game, β₀ of empty
space, the enclosure count ℰ, and territory. Board overlays show chamber decomposition,
ownership, and liberty gap as heat.

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
