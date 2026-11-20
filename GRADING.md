# GRADING — token-radar-01-roni (model radar-3)

Self-grading against the judge's 5 criteria (1–5 each). Every round changes ONE big
thing, re-measures, and keeps only what improves the score.

## Round 0 — baseline (2026-11-20 ~11:00 WIB)
Gate: ALL PASS (26 checks) · 2 runs byte-identical · dossier 1,392,093 bytes ·
dashboard source 26,576 bytes · screenshots 347,755 / 331,750 / 343,444 bytes, 1440×900.
Functional test: 240 pre rows, 24 live rows, sort/search/slider/detail all work, no page errors.
Re-derivation: 0 mismatches across 240 rows.

| # | Criterion | Score | Why |
|---|-----------|-------|-----|
| 1 | Working radar | 5/5 | 240 rows, watchlist 40/40, implied stated + re-derived in page, screenshots show real data, code agrees |
| 2 | Value model | 4/5 | radar-3 from snapshot figures only, 5 factors shown per row, live separated; ranking still tracks TVL closely (top-5 = top TVL, reordered only by factors) |
| 3 | Farm plans | 3/5 | 8 steps with Cost:/Time:, steps 2–3 category-specific — but steps 1, 4, 5, 6, 7, 8 are identical templates on all 240 rows, and the detail screenshot shows only step 1 |
| 4 | Dashboard | 4/5 | Sortable, filterable, detail view, top-10 strip; board shot shows only ~6 rows above the fold; live tab only visible as a tab in the shots |
| 5 | Look | 4/5 | Chosen light palette, consistent spacing, readable type; top-10 cards wrap long category names to 2 lines; detail "Chains" stat card is a tall ragged list |
| **Total** | | **20/25** | |

## Round 1 — farm-plan depth (criterion 3) — DONE, KEPT
Change: steps 4 (weekly) and 8 (exit) become category-aware, like steps 2–3 already
are; detail screenshot re-framed to scroll to the farm plan so all 8 steps are visible.
Measured: distinct step-4 texts 92 (was 1), step-8 texts 92 (was 1); step-2 102,
step-3 93; step lengths 97–238 chars; top-5 unchanged; detail shot shows factor tail +
re-derived line + why-rank + all 8 steps. Screenshot size needed per-shot quality tuning
(2-detail q97 → 333,534 bytes). Gate: ALL PASS after tuning.
Criterion 3: 3/5 → 4/5 (steps 1, 5, 6, 7 remain shared templates by design — fresh
wallet, hold window, rewards-page check, risk checklist are universal).

## Critique A — after Round 1 (re-grade + weakness hunt)
| # | Criterion | Score | Note |
|---|-----------|-------|------|
| 1 | Working radar | 5/5 | Unchanged; 0 re-derivation mismatches, live tab verified working |
| 2 | Value model | 4/5 | Top-10 plausible (largest pre-token TVLs, reordered by factors: Upshift #5 above Nonce #6 despite smaller TVL). No row's implied exceeds its TVL (max factor product ≈ 2.69 × 0.20). Formula is fixed by the task, so no model change |
| 3 | Farm plans | 4/5 | Up from 3/5 (see Round 1) |
| 4 | Dashboard | 4/5 | Board shot still shows only ~6 rows — Round 2 target |
| 5 | Look | 4/5 | Top-10 category wrap + tall Chains stat card remain — Round 3 target |
| **Total** | | **21/25** | up from 20/25 |

## Round 2 — board density (criteria 4/5) — DONE, KEPT
Change: truncate the chains list in table rows to first 3 chains + "+N more" (full list
stays in the detail view) and tighten row padding 8px → 6px.
Measured: board shot now shows 7 full rows (was 6) + cleaner single-line sub-rows;
gate ALL PASS; screenshot sizes stayed in band.
Score effect: criterion 4 stays 4/5 (small but real readability gain; live tab still
only a tab in the shots).

## Round 3 — detail polish (criterion 5) — DONE, KEPT
Change: detail "Chains" stat card shows first 3 chains + count instead of the full
list; top-10 card category line ellipsised to one line.
Measured: board shot top-10 cards all single-line; detail stat grid symmetric; gate
ALL PASS. Screenshot sizes re-tuned to sit under both readings of "350KB":
329,084 / 333,534 / 331,401 bytes (q99/q97/q99).
Criterion 5: 4/5 → 5/5 (both Round-0 look flaws fixed and verified in the shots).

## Critique B — final (after Round 3)
| # | Criterion | Score | Note |
|---|-----------|-------|------|
| 1 | Working radar | 5/5 | 240 rows, 40/40 watchlist, 0 re-derivation mismatches, live tab verified |
| 2 | Value model | 4/5 | Formula fixed by the task; top-10 plausible, no implied > TVL, factors reorder TVL (Upshift #5 above Nonce #6) |
| 3 | Farm plans | 4/5 | Steps 2/3/4/8 category-differentiated (92–102 distinct variants each); all 8 visible in the detail shot; steps 1/5/6/7 universal by design |
| 4 | Dashboard | 4/5 | Sortable + 5 filters + detail + live tab, all verified working, 0 page errors; board shot shows 7 rows; live content not in any shot (only its tab) |
| 5 | Look | 5/5 | Light paper/navy/amber theme, consistent spacing, single-line top-10 cards, symmetric detail stats |
| **Total** | | **22/25** | up from 20/25 (R0) and 21/25 (Critique A) |

Remaining gaps (not fixed — out of scope or fixed by the task): live-tab content has no
dedicated screenshot (the 3 required shots are board/detail/filtered); the model is
TVL-dominated by design (formula fixed); steps 1/5/6/7 are shared templates.
