// Token radar, model "radar-3" (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, ranks the pre-token protocols by an
// implied value that follows only from the snapshot's own figures, and writes
// the board, the dashboard data, the dashboard, the screenshots and the
// dossier the judge reads.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The model, stated in full on the dashboard so a reader can re-derive it:
//
//   implied = TVL x 0.20 x growthF x chainF x categoryF x maturityF
//   growthF   = 1 + clamp(change_7d, -40, +100) / 100 x 0.8   (unknown change: 0)
//   chainF    = 1 + 0.03 x min(chains, 10)
//   categoryF = 0.85 + 0.30 x sqrt(protocol TVL / total TVL of its category)
//   maturityF = 0.55 + 0.45 x ln(1 + min(age_days, 1460)) / ln(1461)
//               (age unknown: 365 days)
//
// No protocol name is ever special-cased: the same function scores every row.
// A protocol is "pre-token" when the snapshot records no token for it (both
// gecko_id and symbol are null); the wording is "records no token", never
// "has no token", because the record is not proof.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const MODEL_VERSION = 'radar-3';
const BASE_MULTIPLE = 0.2;
const EARLY_ROWS = 200;
const LIVE_ROWS = 24;

// ------------------------------------------------------------------ input

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (typeof doc.as_of !== 'string' || !Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: not a token-radar snapshot');
  }
  return doc;
}

// ------------------------------------------------------------------ model

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Whole days from `listed` to `asOf` (both YYYY-MM-DD); null when unlisted. */
function ageDays(listed: string | null, asOf: string): number | null {
  if (listed === null) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

interface Factors {
  base_usd: number;
  growth_factor: number;
  chain_factor: number;
  category_factor: number;
  maturity_factor: number;
}

/** The radar-3 factors for one protocol, from the snapshot's figures only. */
function radarFactors(p: SnapshotProtocol, age: number | null, categoryTotal: number): Factors {
  const growthPct = p.change_7d === null ? 0 : clamp(p.change_7d, -40, 100);
  const growth = 1 + (growthPct / 100) * 0.8;
  const chain = 1 + 0.03 * Math.min(p.chains.length, 10);
  const share = categoryTotal > 0 ? p.tvl_usd / categoryTotal : 0;
  const category = 0.85 + 0.3 * Math.sqrt(share);
  const days = age === null ? 365 : age;
  const maturity = 0.55 + (0.45 * Math.log(1 + Math.min(days, 1460))) / Math.log(1461);
  return { base_usd: p.tvl_usd * BASE_MULTIPLE, growth_factor: growth, chain_factor: chain, category_factor: category, maturity_factor: maturity };
}

function impliedValue(f: Factors): number {
  return Math.max(1, Math.round(f.base_usd * f.growth_factor * f.chain_factor * f.category_factor * f.maturity_factor));
}

/** A protocol records no token when both token fields are null. */
function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// ------------------------------------------------------------------ gas

/** Generic gas estimate per transaction, USD. Labelled an estimate everywhere it shows. */
const GAS_USD: Record<string, number> = {
  Ethereum: 2.5,
  Solana: 0.01,
  Base: 0.05,
  Arbitrum: 0.1,
  Optimism: 0.05,
  Binance: 0.15,
  Polygon: 0.05,
  Avalanche: 0.3,
  Sui: 0.02,
  Tron: 1.0,
  Bitcoin: 1.5,
  'Hyperliquid L1': 0.01,
};
const GAS_DEFAULT_USD = 0.5;

function gasUsd(chain: string | undefined): number {
  if (chain === undefined) return GAS_DEFAULT_USD;
  return GAS_USD[chain] ?? GAS_DEFAULT_USD;
}

function money(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

// ------------------------------------------------------------------ farm plan

/** Capital tier by TVL, in whole dollars. */
function capitalTier(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** Hold window in days, by age: young 60, middle 45, old 30 (unknown: 45). */
function holdDays(age: number | null): number {
  if (age === null) return 45;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** Core, second, weekly and exit actions per category; the fallback is deliberately plain. */
const CATEGORY_ACTIONS: Record<string, [string, string, string, string]> = {
  Lending: [
    'Deposit {capital} of stablecoins into the lending market and keep the supply position open',
    'Borrow a small amount against the deposit, use it on the same chain, then repay it in full',
    'Once a week, check the borrow rate and your health factor; repay a slice if the rate jumped or the factor fell',
    'Exit plan: repay any borrow first, then withdraw the supply in two halves — half after the hold window, half only while the rate still pays',
  ],
  Dexs: [
    'Add {capital} of liquidity to the most active pool and hold the LP position',
    'Swap a small amount through the router each week to keep the address active',
    'Once a week, check the pool volume and your LP share; move to the deeper pool if volume dried up',
    'Exit plan: remove liquidity in two halves, swap back to stables, and keep half only while trading fees still beat the gas',
  ],
  'Liquid Staking': [
    'Stake {capital} through the liquid-staking product and hold the receipt token',
    'Provide the receipt token as liquidity in the deepest pool on the same chain',
    'Once a week, check the staking yield and the receipt token peg; unstake if the peg slips more than 1%',
    'Exit plan: redeem the receipt token in two halves — half after the hold window, half only while the yield still beats the plain staking rate',
  ],
  'Liquid Restaking': [
    'Restake {capital} through the liquid-restaking product and hold the receipt token',
    'Deposit the receipt token into a vault or lending market that accepts it',
    'Once a week, check the restaking yield and the operator set; move if an operator is slashed or leaves',
    'Exit plan: unwind the vault position first, then redeem the receipt token in two halves and leave the last half only while rewards still accrue',
  ],
  Restaking: [
    'Restake {capital} of the native asset through the restaking product',
    'Delegate the restaked position to an operator with a public track record',
    'Once a week, check the operator performance and slashing events; redelegate if your operator underperforms',
    'Exit plan: undelegate and withdraw in two halves — half after the hold window, half only while the restaking yield still pays',
  ],
  Yield: [
    'Deposit {capital} into the highest-TVL yield vault and let it compound',
    'Move half the position to a second vault of the same protocol to spread vault risk',
    'Once a week, compare the vault APY with the week before; move if the APY halved for two weeks running',
    'Exit plan: withdraw from the vault in two halves — half after the hold window, half only while the APY still beats a plain deposit',
  ],
  'Yield Aggregator': [
    'Deposit {capital} into the aggregator vault with the largest TVL',
    'Rotate a small slice between the aggregator strategies once a month',
    'Once a week, read the aggregator strategy report; move if the strategy allocation changed without notice',
    'Exit plan: withdraw from the aggregator in two halves — half after the hold window, half only while the blended APY still beats the single-strategy vaults',
  ],
  RWA: [
    'Buy {capital} of the tokenised real-world asset on the primary market and hold it',
    'Reinvest any yield the asset pays back into the same product',
    'Once a week, check the asset issuer report and the redemption queue; exit the queue early if redemptions stall',
    'Exit plan: redeem through the primary market in two halves — half after the hold window, half only while the yield still beats a bank rate',
  ],
  CDP: [
    'Open a collateralised debt position with {capital} of collateral and mint the stable asset',
    'Keep the collateral ratio well above the liquidation line and top it up if it drifts',
    'Once a week, check the collateral ratio and the stable asset peg; top up collateral if the ratio fell toward the line',
    'Exit plan: repay the minted stable asset first, then release the collateral in two halves and keep half locked only while the peg holds',
  ],
  Bridge: [
    'Bridge {capital} across the bridge to its busiest destination chain and back once',
    'Use the bridge weekly for a small transfer instead of one large move',
    'Once a week, compare the bridge fee and arrival time with the week before; pause if fees tripled',
    'Exit plan: bridge the remaining balance back in two halves — half after the hold window, half only while the destination chain still has a use for it',
  ],
  'Canonical Bridge': [
    'Bridge {capital} through the canonical bridge to the destination chain',
    'Use the bridged assets in a product on the destination chain for the hold window',
    'Once a week, check the bridged asset balance on the destination chain and the canonical bridge status page',
    'Exit plan: bridge the assets back in two halves — half after the hold window, half only while the destination product still earns',
  ],
  Derivatives: [
    'Open a small {capital} perpetual or options position within the protocol and manage it actively',
    'Provide liquidity to the derivatives market maker pool if the protocol offers one',
    'Once a week, review the open interest and funding rate; close the position if funding stays negative for a week',
    'Exit plan: close the position in two halves — half after the hold window, half only while the funding rate still pays you to hold it',
  ],
  'Leveraged Farming': [
    'Open a modest leveraged farming position with {capital} and watch the health factor daily',
    'Close and reopen the position once to test the full exit path',
    'Once a week, check the leverage ratio and the borrow cost; deleverage if the borrow cost doubled',
    'Exit plan: deleverage fully first, then withdraw the farm position in two halves and keep half only while the leveraged APY still beats the plain farm',
  ],
  'Staking Pool': [
    'Stake {capital} in the staking pool and hold through the lock period',
    'Claim and restake any rewards the pool pays, if the protocol offers claiming',
    'Once a week, check the pool reward rate and the unlock queue; note any change in the lock terms',
    'Exit plan: unstake in two halves once the lock ends — half at once, half only while the pool rate still beats the alternatives',
  ],
  'Onchain Capital Allocator': [
    'Deposit {capital} into the allocator vault with the largest TVL',
    'Review the vault allocation report each month and move only if the strategy changes',
    'Once a week, read the allocator report and check whether the vault allocation drifted from its stated strategy',
    'Exit plan: withdraw from the allocator in two halves — half after the hold window, half only while the vault still follows its stated strategy',
  ],
  'Risk Curators': [
    'Deposit {capital} into a curated vault and keep the allocation for the hold window',
    'Compare the curator vaults and split the deposit across two curators',
    'Once a week, compare the curator vault APYs and risk scores; move if your curator drops out of the top half',
    'Exit plan: withdraw from the curator vault in two halves — half after the hold window, half only while the curator still ranks in the top half',
  ],
  'Liquidity Manager': [
    'Deposit {capital} into a managed liquidity vault on the busiest pool',
    'Rebalance the managed position once a month if the vault allows it',
    'Once a week, check the managed range against the current price; exit if the price left the range for a week',
    'Exit plan: withdraw from the managed vault in two halves — half after the hold window, half only while the price stays inside the managed range',
  ],
  Farm: [
    'Deposit {capital} into the farm and stake the LP tokens it issues',
    'Harvest and restake any farm rewards weekly',
    'Once a week, harvest the farm rewards and check the emission rate; stop compounding if emissions were cut',
    'Exit plan: unstake the LP tokens in two halves — half after the hold window, half only while emissions still pay for the gas',
  ],
  'Interest Rate Derivatives': [
    'Buy {capital} of the fixed-rate position and hold it to its maturity date',
    'Split the deposit between a fixed-rate and a floating-rate leg',
    'Once a week, check the fixed-rate yield against the floating rate; hold to maturity unless the gap inverted',
    'Exit plan: hold to maturity where possible; otherwise sell the position in two halves and keep half only while the fixed rate still beats floating',
  ],
  'Options Vault': [
    'Deposit {capital} into the options vault for one full epoch',
    'Roll the position into the next epoch only after reading the new terms',
    'Once a week, read the epoch terms and the vault strike; skip the next roll if the terms worsened',
    'Exit plan: let the epoch settle, then withdraw in two halves — half at settlement, half only if the next epoch terms improve',
  ],
  'Dual-Token Stablecoin': [
    'Mint {capital} of the stable asset with collateral and hold the pair',
    'Provide the stable asset as liquidity in its deepest pool',
    'Once a week, check the stable asset peg and the collateral ratio; add collateral if the peg slipped below $0.99',
    'Exit plan: burn the stable asset to release collateral in two halves — half after the hold window, half only while the peg holds at $1',
  ],
  'Stablecoin Wrapper': [
    'Wrap {capital} into the wrapped stable asset and hold it',
    'Use the wrapped asset as collateral in a lending market on the same chain',
    'Once a week, check the wrapped asset peg against the underlying stablecoin; unwrap if the peg slipped',
    'Exit plan: unwrap in two halves — half after the hold window, half only while the wrapped asset still earns as collateral',
  ],
  'Collateral Markets': [
    'Deposit {capital} of collateral into the collateral market',
    'Borrow a small amount against it and repay before the hold window ends',
    'Once a week, check the collateral factor and your borrow limit; repay a slice if the factor was cut',
    'Exit plan: repay the borrow first, then withdraw the collateral in two halves and keep half only while the market still lends at the same terms',
  ],
  'Uncollateralized Lending': [
    'Lend {capital} through the uncollateralised lending pool in small tranches',
    'Spread the deposit across at least two borrowers to limit single-borrower risk',
    'Once a week, check borrower repayment status; stop new tranches if any borrower missed a payment',
    'Exit plan: stop new tranches at once, then withdraw repaid tranches in two halves and keep half only while every borrower still pays on time',
  ],
  'Prediction Market': [
    'Place {capital} across two or three prediction markets with different outcomes',
    'Close winning positions promptly and record the result of each market',
    'Once a week, review open markets and close any position whose odds moved against you by half',
    'Exit plan: close all open markets in two halves — half after the hold window, half only while the odds still favour your side',
  ],
  'Governance Incentives': [
    'Lock {capital} in the governance incentive program for one full cycle',
    'Vote in each governance round while the lock is active',
    'Once a week, check the next vote and the incentive payout rate; vote in every round while locked',
    'Exit plan: unlock at the cycle end in two halves — half at once, half only while the incentive rate still beats the lock cost',
  ],
  Payments: [
    'Route {capital} of regular payments through the protocol for a month',
    'Hold the balance the protocol requires for its payment features',
    'Once a week, reconcile the payments routed through the protocol against your own records',
    'Exit plan: stop routing new payments, then withdraw the held balance in two halves and keep half only while the payment features still work',
  ],
  Insurance: [
    'Buy {capital} of cover for a position you already hold elsewhere',
    'Renew or extend the cover once before the hold window ends',
    'Once a week, check the cover terms and the claim window; file promptly if a covered event happens',
    'Exit plan: let the cover lapse at expiry in two halves — half of the covered position unwound first, half only while the cover still pays',
  ],
  CeDeFi: [
    'Deposit {capital} into the CeDeFi vault and keep it for the hold window',
    'Withdraw a small test amount once to confirm the exit path works',
    'Once a week, check the vault proof-of-reserves or audit note; pause deposits if the note is stale',
    'Exit plan: withdraw from the vault in two halves — half after the hold window, half only while the reserves note stays fresh',
  ],
  'Crypto Card Issuer': [
    'Order the card and spend {capital} through it over the hold window',
    'Keep the card balance topped up from the protocol wallet only',
    'Once a week, check card spending and the cashback rate; pause top-ups if the cashback rate was cut',
    'Exit plan: stop topping up, spend down the card balance in two halves, and keep half only while the cashback still pays',
  ],
  'Anchor BTC': [
    'Deposit {capital} of BTC into the anchor product and hold the receipt',
    'Use the receipt as collateral in a lending market on the same chain',
    'Once a week, check the BTC peg of the receipt and the anchor reserve report',
    'Exit plan: redeem the receipt for BTC in two halves — half after the hold window, half only while the receipt still trades at peg',
  ],
  'Decentralized BTC': [
    'Deposit {capital} of BTC into the decentralised BTC product and hold the receipt',
    'Provide the receipt as liquidity in the deepest BTC pool',
    'Once a week, check the receipt peg and the bridge reserve proof; exit the pool if the peg slipped',
    'Exit plan: pull the receipt from the pool, then redeem it for BTC in two halves and keep half only while the peg holds',
  ],
  Chain: [
    'Bridge {capital} onto the chain and use its flagship application',
    'Stake {capital} of the chain asset with a validator through the protocol',
    'Once a week, check the chain block time and the flagship application status; pause if the chain halted',
    'Exit plan: unstake and bridge back in two halves — half after the hold window, half only while the chain keeps finalising blocks',
  ],
  Indexes: [
    'Buy {capital} of the index token and hold it for the full window',
    'Rebalance the index holding once if the index composition changes',
    'Once a week, check the index composition and net asset value; sell if the index dropped a constituent without notice',
    'Exit plan: sell the index token in two halves — half after the hold window, half only while the index still tracks its stated basket',
  ],
  Privacy: [
    'Use {capital} through the privacy product for one shielded transfer a week',
    'Withdraw from the shielded pool once to confirm the exit path works',
    'Once a week, check the shielded pool anonymity set size; pause if the set shrank sharply',
    'Exit plan: withdraw from the shielded pool in two halves — half after the hold window, half only while the anonymity set stays healthy',
  ],
  'Basis Trading': [
    'Deposit {capital} into the basis-trading vault and hold for the full window',
    'Check the funding-rate report weekly and exit if the basis turns negative',
    'Once a week, read the funding-rate report; exit at once if the basis turned negative for two weeks',
    'Exit plan: withdraw from the vault in two halves — half after the hold window, half only while the basis stays positive',
  ],
  CEX: [
    'Use {capital} on the exchange product for regular spot trades over the hold window',
    'Withdraw a small test amount to your own wallet once to confirm the exit path',
    'Once a week, check the exchange withdrawal status and fee schedule; pause trading if withdrawals stall',
    'Exit plan: stop trading, then withdraw the balance in two halves — half after the hold window, half only while withdrawals still clear same-day',
  ],
};

const GENERIC_ACTIONS: [string, string, string, string] = [
  'Use {capital} in the protocol main product on {chain} and keep the position open',
  'Use a second feature of the same protocol with a small slice of the deposit',
  'Once a week, check the position and any official announcement; adjust only if the product terms changed',
  'Exit plan: unwind the position in two halves — half after the hold window, half only while the position still earns',
];

function categoryActions(category: string | null): [string, string, string, string] {
  if (category !== null && CATEGORY_ACTIONS[category] !== undefined) return CATEGORY_ACTIONS[category]!;
  return GENERIC_ACTIONS;
}

function fill(template: string, capital: string, chain: string): string {
  return template.replaceAll('{capital}', capital).replaceAll('{chain}', chain);
}

/** Eight farm steps: action + Cost: + Time: in every step, 20-600 chars each. */
function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const capital = `$${capitalTier(p.tvl_usd)}`;
  const chain = p.chains[0] ?? 'its first chain';
  const gas = money(gasUsd(p.chains[0]));
  const hold = holdDays(age);
  const [core, second, weekly, exit] = categoryActions(p.category);
  const steps = [
    `Set up a fresh wallet used only for ${p.name} on ${chain}; fund it with ${capital} plus ${gas} for gas and keep its seed offline. Cost: ${gas} gas to fund. Time: 15 min.`,
    `${fill(core, capital, chain)}. Cost: about ${gas} gas per transaction. Time: 20 min to set up.`,
    `${fill(second, capital, chain)}. Cost: about ${gas} gas per transaction. Time: 20 min.`,
    `${fill(weekly, capital, chain)}. Cost: about ${gas} gas per week. Time: 15 min weekly.`,
    `Hold the position for at least ${hold} days from the first deposit before judging it; do not chase a token rumour before the window ends. Cost: $0 while holding. Time: ${hold} days.`,
    `Open the protocol's official rewards page and read what it actually lists today; the snapshot carries no points or airdrop data, so do not assume a program exists. Cost: $0. Time: 10 min.`,
    `Risk check before adding more: (1) smart-contract risk, the code may hold a bug; (2) liquidity risk, exits can be slow or costly; (3) no token is guaranteed, a launch may never happen. Cost: $0. Time: 10 min.`,
    `${fill(exit, capital, chain)}; leave ${gas} for the final gas. Cost: about ${gas} gas per withdrawal. Time: 20 min.`,
  ];
  for (const s of steps) {
    if (s.length < 20 || s.length > 600) throw new Error(`farm step length ${s.length} for ${p.slug}`);
  }
  return steps;
}

function whyRank(
  p: SnapshotProtocol,
  rank: number,
  boardSize: number,
  tvlRank: number,
  f: Factors,
  age: number | null,
  categoryTotal: number,
): string {
  const growth = p.change_7d === null ? 'no 7-day change reported' : `a 7-day change of ${p.change_7d}%`;
  const ageText = age === null ? 'no listing date reported' : `${age} days listed`;
  const share = categoryTotal > 0 ? ((p.tvl_usd / categoryTotal) * 100).toFixed(1) : '0.0';
  return (
    `Rank ${rank} of ${boardSize}: ${p.name} holds $${p.tvl_usd.toLocaleString('en-US')} of TVL ` +
    `(the ${tvlRank === 1 ? 'largest' : `#${tvlRank} largest`} on this board), with ${growth}, ` +
    `${p.chains.length} chain${p.chains.length === 1 ? '' : 's'}, ${share}% of its category's TVL, and ${ageText}. ` +
    `Its factors multiply to ${(f.growth_factor * f.chain_factor * f.category_factor * f.maturity_factor).toFixed(3)} ` +
    `on a $${Math.round(f.base_usd).toLocaleString('en-US')} base, giving an implied value of $${impliedValue(f).toLocaleString('en-US')}.`
  );
}

// ------------------------------------------------------------------ board

interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_status: 'pre-token';
  on_watchlist: boolean;
  model: {
    version: string;
    base_usd: number;
    growth_factor: number;
    chain_factor: number;
    category_factor: number;
    maturity_factor: number;
    category_tvl_usd: number;
  };
  capital_tier_usd: number;
  gas_usd: number;
  hold_days: number;
  why_rank: string;
  farm_steps: string[];
}

interface LiveRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  symbol: string | null;
}

interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model_formula: string;
  rows: BoardRow[];
  live: LiveRow[];
  gas_table: { chain: string; usd: number }[];
  watchlist_size: number;
  total_protocols: number;
}

function buildRadar(snapshot: Snapshot): Radar {
  const asOf = snapshot.as_of;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlist = snapshot.watchlist.filter((s) => bySlug.has(s));
  const watchSet = new Set(watchlist);

  // Category totals over the whole snapshot: the category factor's denominator.
  const categoryTotal = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? '(none)';
    categoryTotal.set(key, (categoryTotal.get(key) ?? 0) + p.tvl_usd);
  }

  // Board: the whole watchlist, then the largest pre-token protocols below the floor.
  const belowFloor = snapshot.protocols
    .filter((p) => recordsNoToken(p) && !watchSet.has(p.slug) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  const picked = [...watchlist.map((s) => bySlug.get(s)!), ...belowFloor];

  // TVL rank among the picked rows, for the why-rank line.
  const byTvl = [...picked].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const tvlRank = new Map(byTvl.map((p, i) => [p.slug, i + 1]));

  const scored = picked.map((p) => {
    const age = ageDays(p.listed_at, asOf);
    const f = radarFactors(p, age, categoryTotal.get(p.category ?? '(none)') ?? 0);
    return { p, age, f, implied: impliedValue(f) };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.implied,
    token_status: 'pre-token',
    on_watchlist: watchSet.has(s.p.slug),
    model: {
      version: MODEL_VERSION,
      base_usd: Math.round(s.f.base_usd),
      growth_factor: round6(s.f.growth_factor),
      chain_factor: round6(s.f.chain_factor),
      category_factor: round6(s.f.category_factor),
      maturity_factor: round6(s.f.maturity_factor),
      category_tvl_usd: categoryTotal.get(s.p.category ?? '(none)') ?? 0,
    },
    capital_tier_usd: capitalTier(s.p.tvl_usd),
    gas_usd: gasUsd(s.p.chains[0]),
    hold_days: holdDays(s.age),
    why_rank: whyRank(s.p, i + 1, scored.length, tvlRank.get(s.p.slug)!, s.f, s.age, categoryTotal.get(s.p.category ?? '(none)') ?? 0),
    farm_steps: farmSteps(s.p, s.age),
  }));

  // Live-token tab: the largest market caps, CEX category kept out.
  const live = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p, i) => ({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      symbol: p.symbol,
    }));

  const gasTable = [
    ...Object.entries(GAS_USD).map(([chain, usd]) => ({ chain, usd })),
    { chain: 'Other chains', usd: GAS_DEFAULT_USD },
  ];

  return {
    as_of: snapshot.as_of,
    source: snapshot.source.replace('https://', '').replace('http://', ''),
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model_formula:
      'implied = TVL x 0.20 x growthF x chainF x categoryF x maturityF; ' +
      'growthF = 1 + clamp(change_7d, -40, +100)/100 x 0.8 (unknown change = 0); ' +
      'chainF = 1 + 0.03 x min(chains, 10); ' +
      'categoryF = 0.85 + 0.30 x sqrt(protocol TVL / total TVL of its category); ' +
      'maturityF = 0.55 + 0.45 x ln(1 + min(age_days, 1460)) / ln(1461) (unknown age = 365 days)',
    rows,
    live,
    gas_table: gasTable,
    watchlist_size: watchlist.length,
    total_protocols: snapshot.protocols.length,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The gate's shape, checked before anything is written. */
function boardIssue(radar: Radar, snapshot: Snapshot): string | null {
  const rows = radar.rows;
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows`;
  const ranks = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.rank) || r.rank < 1) return `row ${r.slug}: bad rank`;
    if (ranks.has(r.rank)) return `rank ${r.rank} twice`;
    ranks.add(r.rank);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1) return `row ${r.slug}: bad implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug}: ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug}: farm step ${t.length} chars`;
    }
  }
  for (let i = 1; i <= rows.length; i++) if (!ranks.has(i)) return `rank ${i} missing`;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `implied value rises at rank ${i + 1}`;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size < 2) return 'all implied values equal';
  for (const s of snapshot.watchlist) {
    if (!rows.some((r) => r.slug === s)) return `watchlist slug ${s} missing`;
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of rows) if (!slugs.has(r.slug)) return `row ${r.slug}: not in the snapshot`;
  return null;
}

function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

// ------------------------------------------------------------------ main

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  // Start clean so a stale file from an earlier run can never leak into /output.
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${radar.rows.length} rows scored (${radar.live.length} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
