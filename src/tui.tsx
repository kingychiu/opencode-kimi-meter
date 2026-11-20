/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import {
  fetchKimiDashboard,
  formatContext,
  formatMoney,
  formatPercent,
  formatRegion,
  formatReset,
  type KimiDashboard,
} from "./usage.ts";

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function quotaLine(label: string, entry: KimiDashboard["usage"]["fiveHour"]): string {
  const reset = formatReset(entry);
  return `${label} ${formatPercent(entry)} used${reset ? ` · ${reset}` : ""}`;
}

export default Plugin.define({
  id: "kimi.meter",
  setup(context) {
    const [dashboard, setDashboard] = createSignal<KimiDashboard>();
    const [error, setError] = createSignal<string>();
    const [loading, setLoading] = createSignal(true);
    const refreshSeconds = typeof context.options.refreshSeconds === "number"
      ? Math.max(15, context.options.refreshSeconds)
      : 60;
    let disposed = false;
    let refreshing = false;

    async function refresh() {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        const result = await fetchKimiDashboard({
          provider: stringOption(context.options.provider),
          authPath: stringOption(context.options.authPath),
          baseUrl: stringOption(context.options.baseUrl),
        });
        if (disposed) return;
        setDashboard(result);
        setError(undefined);
      } catch (cause) {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : "Kimi usage is unavailable");
      } finally {
        if (!disposed) setLoading(false);
        refreshing = false;
      }
    }

    const stop = context.data.on("session.execution.succeeded", () => {
      void refresh();
    });
    const interval = setInterval(() => void refresh(), refreshSeconds * 1000);
    void refresh();

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "kimi.meter.open",
          title: "Open Kimi meter",
          group: "Kimi",
          palette: true,
          suggested: true,
          slash: { name: "kimi" },
          run: async () => {
            await refresh();
            const opened = context.ui.panel.open("kimi.meter.dashboard");
            if (!opened) context.ui.toast.show({ message: "Open a session to use Kimi meter", variant: "info" });
          },
        },
        {
          id: "kimi.meter.refresh",
          title: "Refresh Kimi meter",
          group: "Kimi",
          palette: true,
          slash: { name: "kimi-refresh", aliases: ["kimi-quota"] },
          run: async () => {
            await refresh();
            context.ui.toast.show({
              message: error() ?? "Kimi meter refreshed",
              variant: error() ? "error" : "success",
            });
          },
        },
      ],
    }));

    function currentModel() {
      const selected = context.ui.model.current();
      if (!selected) return "No model selected";
      const model = dashboard()?.models.find((item) => item.id === selected.modelID);
      const effort = selected.variant ?? model?.defaultEffort;
      return `${model?.name ?? selected.modelID}${effort ? ` · ${effort}` : ""}${model ? ` · ${formatContext(model.context)}` : ""}`;
    }

    // Keep every renderable mounted. OpenTUI 0.9.5 can crash when a Show
    // fallback is replaced by a Fragment during the first usage refresh.
    const unregisterSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <box flexDirection="column">
          <text fg={context.theme.text.base}>{`Kimi${dashboard()?.profile?.plan ? ` ${dashboard()?.profile?.plan}` : ""}`}</text>
          <text fg={context.theme.text.base}>{dashboard() ? quotaLine("5h", dashboard()?.usage.fiveHour) : loading() ? "Loading…" : "Unavailable"}</text>
          <text fg={context.theme.text.base}>{dashboard() ? quotaLine("Month", dashboard()?.usage.month) : ""}</text>
          <text fg={context.theme.text.base}>{dashboard() ? currentModel() : ""}</text>
          <text fg={context.theme.text.base}>{error() && dashboard() ? "Refresh failed" : ""}</text>
        </box>
      ),
    });

    const unregisterPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => {
        if (panel.name !== "kimi.meter.dashboard") return null;
        const current = dashboard();
        const extra = current?.usage.extraUsage;
        const models = current?.models ?? [];
        return (
          <box flexDirection="column">
            <text fg={context.theme.text.base}>Kimi meter</text>
            <text fg={context.theme.text.base}>{current ? `${current.profile?.plan ?? "Kimi"}${formatRegion(current.profile?.region) ? ` · ${formatRegion(current.profile?.region)}` : ""}` : loading() ? "Loading…" : error() ?? "Unavailable"}</text>
            <text fg={context.theme.text.base}>{current ? `Current: ${currentModel()}` : ""}</text>
            <text fg={context.theme.text.base}>{current ? `${quotaLine("5-hour:", current.usage.fiveHour)}${formatReset(current.usage.fiveHour) ? "" : " · reset —"}` : ""}</text>
            <text fg={context.theme.text.base}>{current?.usage.week ? `${quotaLine("7-day:", current.usage.week)}${formatReset(current.usage.week) ? "" : " · reset —"}` : ""}</text>
            <text fg={context.theme.text.base}>{current ? `${quotaLine("Monthly coding:", current.usage.month)}${formatReset(current.usage.month) ? "" : " · reset —"}` : ""}</text>
            <text fg={context.theme.text.base}>{current?.usage.monthTotal ? `${quotaLine("Monthly total:", current.usage.monthTotal)}${formatReset(current.usage.monthTotal) ? "" : " · reset —"}` : ""}</text>
            <text fg={context.theme.text.base}>{extra ? `Extra Usage: ${formatMoney(extra.balanceCents, extra.currency)} available · ${formatMoney(extra.monthlyUsedCents, extra.currency)} used this month` : ""}</text>
            <text fg={context.theme.text.base}>{current ? `Models (${models.length})` : ""}</text>
            <text fg={context.theme.text.base}>{models.map((model) => `${model.name} · ${formatContext(model.context)}${model.efforts.length ? ` · ${model.efforts.join("/")}` : ""}`).join("\n")}</text>
            <text fg={context.theme.text.base}>{current ? "/kimi-refresh to refresh" : ""}</text>
          </box>
        );
      },
    });

    return () => {
      disposed = true;
      clearInterval(interval);
      stop();
      unregisterSidebar();
      unregisterPanel();
    };
  },
});
