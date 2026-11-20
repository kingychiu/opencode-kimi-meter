import assert from "node:assert/strict";
import test from "node:test";
import {
  formatContext,
  formatPercent,
  formatRegion,
  formatReset,
  parseModelsPayload,
  parseProfilePayload,
  parseUsagePayload,
} from "../src/usage.ts";

test("parses quotas, preferring coding quota, and Extra Usage", () => {
  const usage = parseUsagePayload({
    usages: {
      limit_5h: { used_ratio: 0.3982, reset_time: "2026-11-20T03:25:39Z" },
      limit_7d: { used_ratio: 0.2 },
      limit_month_code: { used_ratio: "0.3621", reset_time: "2026-12-19T00:00:00Z" },
      limit_month_total: { used_ratio: 0.3622 },
    },
    boosterWallet: {
      balance: { type: "BOOSTER", amountLeft: 25_000_000_000 },
      monthlyUsed: { priceInCents: 5_000_000_000, currency: "USD" },
    },
  });
  assert.equal(usage.fiveHour?.usedRatio, 0.3982);
  assert.equal(usage.week?.usedRatio, 0.2);
  assert.equal(usage.month?.usedRatio, 0.3621);
  assert.equal(usage.monthTotal?.usedRatio, 0.3622);
  assert.deepEqual(usage.extraUsage, { balanceCents: 25000, monthlyUsedCents: 5000, currency: "USD" });
});

test("falls back to total monthly quota and tolerates missing fields", () => {
  const usage = parseUsagePayload({ usages: { limit_month_total: { used_ratio: 0.25 } } });
  assert.equal(usage.fiveHour, undefined);
  assert.equal(usage.month?.usedRatio, 0.25);
  assert.deepEqual(parseUsagePayload(null), {});
});

test("parses only public plan metadata and model capabilities", () => {
  assert.deepEqual(parseProfilePayload({ user_level_name: "Max", region: "REGION_OVERSEA", email: "private@example.com" }), {
    plan: "Max",
    region: "REGION_OVERSEA",
  });
  const models = parseModelsPayload({
    data: [{
      id: "k3.1-pro",
      display_name: "K3.1 Pro",
      limit: { context: 1_048_576 },
      reasoning: { effort: { valid: ["low", "high", "max"], default: "high" } },
    }],
  });
  assert.deepEqual(models, [{ id: "k3.1-pro", name: "K3.1 Pro", context: 1_048_576, efforts: ["low", "high", "max"], defaultEffort: "high" }]);
});

test("formats percentages, resets, contexts, and regions", () => {
  assert.equal(formatPercent({ usedRatio: 0.3982 }), "40%");
  assert.equal(formatPercent({ usedRatio: 0.001 }), "<1%");
  assert.equal(formatPercent(undefined), "—");
  const now = Date.parse("2026-11-20T00:00:00Z");
  assert.equal(formatReset({ usedRatio: 0, resetAt: "2026-11-20T03:04:00Z" }, now), "3h 4m");
  assert.equal(formatReset({ usedRatio: 0, resetAt: "2026-12-19T00:00:00Z" }, now), "29d");
  assert.equal(formatContext(1_048_576), "1M");
  assert.equal(formatContext(262_144), "256K");
  assert.equal(formatRegion("REGION_OVERSEA"), "Global");
});
