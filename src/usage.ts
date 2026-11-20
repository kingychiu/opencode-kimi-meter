import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface QuotaEntry {
  usedRatio: number;
  resetAt?: string;
}

export interface ExtraUsage {
  balanceCents: number;
  monthlyUsedCents: number;
  currency: string;
}

export interface KimiUsage {
  fiveHour?: QuotaEntry;
  week?: QuotaEntry;
  month?: QuotaEntry;
  monthTotal?: QuotaEntry;
  extraUsage?: ExtraUsage;
}

export interface KimiProfile {
  plan: string;
  region: string;
}

export interface KimiModel {
  id: string;
  name: string;
  context: number;
  efforts: string[];
  defaultEffort?: string;
}

export interface KimiDashboard {
  usage: KimiUsage;
  profile?: KimiProfile;
  models: KimiModel[];
}

export interface FetchUsageOptions {
  provider?: string;
  authPath?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROVIDER = "kimi-code-plan-global";
const DEFAULT_BASE_URL = "https://api.kimi.ai/coding/v1";
const FIXED_POINT_CENTS = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseEntry(value: unknown): QuotaEntry | undefined {
  if (!isRecord(value)) return undefined;
  const usedRatio = numberValue(value.used_ratio);
  if (usedRatio === undefined) return undefined;
  const resetAt = value.reset_time;
  return {
    usedRatio,
    resetAt: typeof resetAt === "string" && resetAt.length > 0 ? resetAt : undefined,
  };
}

function parseExtraUsage(value: unknown): ExtraUsage | undefined {
  if (!isRecord(value) || !isRecord(value.balance) || value.balance.type !== "BOOSTER") return undefined;
  const amountLeft = numberValue(value.balance.amountLeft);
  if (amountLeft === undefined) return undefined;
  const monthlyUsed = isRecord(value.monthlyUsed) ? numberValue(value.monthlyUsed.priceInCents) : undefined;
  return {
    balanceCents: Math.max(0, Math.round(amountLeft / FIXED_POINT_CENTS)),
    monthlyUsedCents: Math.max(0, Math.round((monthlyUsed ?? 0) / FIXED_POINT_CENTS)),
    currency: (isRecord(value.monthlyUsed) && stringValue(value.monthlyUsed.currency)) || "USD",
  };
}

export function parseUsagePayload(value: unknown): KimiUsage {
  if (!isRecord(value) || !isRecord(value.usages)) return {};
  const monthCode = parseEntry(value.usages.limit_month_code);
  return {
    fiveHour: parseEntry(value.usages.limit_5h),
    week: parseEntry(value.usages.limit_7d),
    month: monthCode ?? parseEntry(value.usages.limit_month_total),
    monthTotal: parseEntry(value.usages.limit_month_total),
    extraUsage: parseExtraUsage(value.boosterWallet),
  };
}

export function parseProfilePayload(value: unknown): KimiProfile | undefined {
  if (!isRecord(value)) return undefined;
  const plan = stringValue(value.user_level_name);
  const region = stringValue(value.region);
  if (!plan && !region) return undefined;
  return { plan: plan ?? "Kimi", region: region ?? "" };
}

export function parseModelsPayload(value: unknown): KimiModel[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.flatMap((item): KimiModel[] => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const context = isRecord(item.limit) ? numberValue(item.limit.context) : undefined;
    const reasoning = isRecord(item.reasoning) ? item.reasoning : undefined;
    const effort = reasoning && isRecord(reasoning.effort) ? reasoning.effort : undefined;
    const efforts = effort && Array.isArray(effort.valid)
      ? effort.valid.filter((entry): entry is string => typeof entry === "string")
      : [];
    return [{
      id: item.id,
      name: stringValue(item.display_name) ?? item.id,
      context: context ?? 0,
      efforts,
      defaultEffort: effort ? stringValue(effort.default) : undefined,
    }];
  });
}

async function readApiKey(authPath: string, provider: string): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(authPath, "utf8"));
  } catch {
    throw new Error("OpenCode credentials are unavailable");
  }
  if (!isRecord(parsed) || !isRecord(parsed[provider])) {
    throw new Error(`No OpenCode credential for ${provider}`);
  }
  const credential = parsed[provider];
  const key = credential.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error(`No OpenCode API key for ${provider}`);
  }
  return key;
}

async function createRequester(options: FetchUsageOptions) {
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const authPath = options.authPath ?? join(homedir(), ".local", "share", "opencode", "auth.json");
  const baseUrl = (options.baseUrl ?? process.env.KIMI_CODE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = await readApiKey(authPath, provider);
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (path: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}/${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      });
    } catch {
      throw new Error(`Kimi ${path} request failed`);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Kimi rejected the saved credential");
      }
      throw new Error(`Kimi ${path} returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`Kimi ${path} returned an invalid response`);
    }
  };
}

export async function fetchKimiUsage(options: FetchUsageOptions = {}): Promise<KimiUsage> {
  const request = await createRequester(options);
  return parseUsagePayload(await request("usages"));
}

export async function fetchKimiDashboard(options: FetchUsageOptions = {}): Promise<KimiDashboard> {
  const request = await createRequester(options);
  const [usageResult, profileResult, modelsResult] = await Promise.allSettled([
    request("usages"),
    request("me"),
    request("models"),
  ]);
  if (usageResult.status === "rejected") throw usageResult.reason;
  return {
    usage: parseUsagePayload(usageResult.value),
    profile: profileResult.status === "fulfilled" ? parseProfilePayload(profileResult.value) : undefined,
    models: modelsResult.status === "fulfilled" ? parseModelsPayload(modelsResult.value) : [],
  };
}

export function formatPercent(entry: QuotaEntry | undefined): string {
  if (!entry) return "—";
  const percent = Math.max(0, entry.usedRatio) * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

export function formatReset(entry: QuotaEntry | undefined, now = Date.now()): string {
  if (!entry?.resetAt) return "";
  const timestamp = Date.parse(entry.resetAt);
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.ceil((timestamp - now) / 1000));
  if (seconds === 0) return "now";
  const days = Math.floor(seconds / 86_400);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.ceil((seconds % 3600) / 60));
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatContext(context: number): string {
  if (context >= 1_048_576) return `${Math.round(context / 1_048_576)}M`;
  if (context >= 1024) return `${Math.round(context / 1024)}K`;
  return context > 0 ? String(context) : "—";
}

export function formatRegion(region: string | undefined): string {
  if (region === "REGION_OVERSEA") return "Global";
  if (region === "REGION_MAINLAND") return "Mainland CN";
  return region || "";
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
