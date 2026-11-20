# Token Radar — radar-3 (make.fun token-radar-01, profile B / @roni-rockabilly)
[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/anjay1933/token-radar-01-roni/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/anjay1933/token-radar-01-roni/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar: 240 pre-token protocols ranked by an implied value derived
only from the sealed DefiLlama snapshot (as_of 2026-11-14), plus a 24-row live-token
market tab. Light paper/navy/amber dashboard, written from scratch for this entry.

## Model radar-3

```
implied = TVL × 0.20 × growthF × chainF × categoryF × maturityF
growthF   = 1 + clamp(change_7d, −40, +100) / 100 × 0.8   (unknown change = 0)
chainF    = 1 + 0.03 × min(chains, 10)
categoryF = 0.85 + 0.30 × √(protocol TVL / total TVL of its category)
maturityF = 0.55 + 0.45 × ln(1 + min(age_days, 1460)) / ln(1461)   (unknown age = 365 days)
```

No protocol name is special-cased. The page re-derives every implied value from the
raw figures and shows whether it matches the board.

## Board

- 240 rows: the full 40-protocol watchlist + the 200 largest pre-token protocols
  below the $50M floor, ranked 1–240 by implied value.
- Live tab: the 24 largest market caps among protocols whose token already trades
  (CEX excluded); market caps are never mixed with implied values.
- Every row carries an 8-step farm plan with Cost: and Time: per step, a capital
  tier by TVL ($50–$250), a generic per-chain gas estimate, and a hold window by age.

## Run

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. Two runs write byte-identical output.
Screenshots (1440×900, 300–350KB each) are taken from the real running dashboard
with headless Chromium; see `GRADING.md` for the deep-loop record (baseline 20/25
→ final 22/25 across the 5 judge criteria).

## Files

- `main.ts` — entrypoint: snapshot in, board + data + dashboard + screenshots + dossier out.
- `dashboard/` — `index.html`, `app.css`, `app.js` (no network, no framework).
- `screenshots/` — `1-board.jpg`, `2-detail.jpg`, `3-filtered.jpg`.
- `vendor/makefun-board.ts` — make.fun's dossier library, unmodified (kit file).
- `GRADING.md` — self-grading per round.
