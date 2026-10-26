/**
 * Pricing engine for the proposal tool (see docs/quote-manager-rebuild.md, "Pricing engine").
 * Pure: no I/O. Takes a cost plus rules and returns the sell price with the steps that produced it.
 *
 * Resolution order:
 *   1. margin rule (most specific category path wins): margin % → cost / (1 - m), or fixed profit amount
 *   2. list price guard: cap at list (never below cost), ignore, or sacrifice up to N% of profit to meet list
 *   3. price group discount: N% off the profit
 *   4. never below cost
 *   5. manual overrides: a fixed price replaces the rule price; a bid replaces both; a previously quoted
 *      price replaces a fixed price, and replaces a rule or bid price only when it is higher
 */

export type MarginRule = {
  /** Category path, e.g. [] (all products), ["Hardware"], ["Hardware", "Laptops"]. Case-insensitive prefix match. */
  category: string[];
  marginPct?: number;
  profitAmount?: number;
};

export type ListPriceGuard = { mode: "ignore" } | { mode: "cap" } | { mode: "partial"; sacrificePct: number };

export type PriceInput = {
  cost: number;
  listPrice?: number;
  categoryPath?: string[];
  rules: MarginRule[];
  guard?: ListPriceGuard;
  groupDiscountPct?: number;
  fixedPrice?: number;
  bidPrice?: number;
  quotedPrice?: number;
};

export type PriceResult = {
  cost: number;
  sellPrice: number;
  profit: number;
  marginPct: number;
  source: "rule" | "fixed" | "bid" | "quoted";
  rule?: { category: string; marginPct?: number; profitAmount?: number };
  steps: string[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => `$${round2(n).toFixed(2)}`;

export function pickRule(rules: MarginRule[], path: string[] = []): MarginRule | undefined {
  const norm = path.map((p) => p.trim().toLowerCase());
  let best: MarginRule | undefined;
  for (const r of rules) {
    const rp = r.category.map((p) => p.trim().toLowerCase());
    if (rp.length > norm.length || !rp.every((p, n) => p === norm[n])) continue;
    if (!best || rp.length > best.category.length) best = r;
  }
  return best;
}

export function priceItem(input: PriceInput): PriceResult {
  const { cost } = input;
  if (!Number.isFinite(cost) || cost < 0) throw new Error("cost must be a non-negative number");
  const steps: string[] = [`Cost ${money(cost)}`];

  const rule = pickRule(input.rules, input.categoryPath);
  let price = cost;
  if (rule?.profitAmount !== undefined) {
    price = cost + rule.profitAmount;
    steps.push(`Rule "${label(rule)}": profit ${money(rule.profitAmount)} → ${money(price)}`);
  } else if (rule?.marginPct !== undefined) {
    if (rule.marginPct < 0 || rule.marginPct >= 100) throw new Error("marginPct must be in [0, 100)");
    price = cost / (1 - rule.marginPct / 100);
    steps.push(`Rule "${label(rule)}": margin ${rule.marginPct}% → ${money(price)}`);
  } else {
    steps.push("No margin rule matched; sell at cost");
  }

  const list = input.listPrice;
  const guard = input.guard ?? { mode: "ignore" };
  if (list !== undefined && list > 0 && price > list && guard.mode !== "ignore") {
    if (guard.mode === "cap") {
      price = Math.max(cost, list);
      steps.push(`List price guard (cap): limited to list ${money(list)}${list < cost ? ", but not below cost" : ""} → ${money(price)}`);
    } else {
      const floor = cost + (price - cost) * (1 - guard.sacrificePct / 100);
      price = Math.max(list, floor);
      steps.push(`List price guard (sacrifice up to ${guard.sacrificePct}% of profit): floor ${money(floor)}, list ${money(list)} → ${money(price)}`);
    }
  }

  if (input.groupDiscountPct) {
    price = cost + (price - cost) * (1 - input.groupDiscountPct / 100);
    steps.push(`Price group discount ${input.groupDiscountPct}% off profit → ${money(price)}`);
  }

  if (price < cost) {
    price = cost;
    steps.push(`Raised to cost ${money(cost)}`);
  }

  let source: PriceResult["source"] = "rule";
  if (input.fixedPrice !== undefined) {
    price = input.fixedPrice;
    source = "fixed";
    steps.push(input.fixedPrice === 0 ? "Fixed price $0: price hidden (contact for quote)" : `Fixed price ${money(price)}`);
  }
  if (input.bidPrice !== undefined) {
    price = input.bidPrice;
    source = "bid";
    steps.push(`Bid price ${money(price)}`);
  }
  if (input.quotedPrice !== undefined && (source === "fixed" || input.quotedPrice > price)) {
    price = input.quotedPrice;
    source = "quoted";
    steps.push(`Previously quoted price ${money(price)}`);
  }

  const sellPrice = round2(price);
  const profit = round2(sellPrice - cost);
  return {
    cost: round2(cost),
    sellPrice,
    profit,
    marginPct: sellPrice > 0 ? round2((profit / sellPrice) * 100) : 0,
    source,
    rule: rule && { category: label(rule), marginPct: rule.marginPct, profitAmount: rule.profitAmount },
    steps,
  };
}

function label(r: MarginRule) {
  return r.category.length ? r.category.join(" > ") : "All products";
}
