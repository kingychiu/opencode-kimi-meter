import { Plugin } from "@opencode/plugin/tui";
import { createSignal, For, Show } from "solid-js";
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

    const unregisterSidebar = context.ui.slot({
      append: "sidebar.content",
      render: () => {
        const current = dashboard();
        return (
          <box flexDirection="column">
            <text fg={context.theme.text.base}>Kimi{current?.profile?.plan ? ` ${current.profile.plan}` : ""}</text>
            <Show when={current} fallback={<text fg={context.theme.text.base}>{loading() ? "Loading…" : "Unavailable"}</text>}>
              {(value) => (
                <>
                  <text fg={context.theme.text.base}>
                    5h {formatPercent(value().usage.fiveHour)} used
                    {formatReset(value().usage.fiveHour) ? ` · ${formatReset(value().usage.fiveHour)}` : ""}
                  </text>
                  <text fg={context.theme.text.base}>
                    Month {formatPercent(value().usage.month)} used
                    {formatReset(value().usage.month) ? ` · ${formatReset(value().usage.month)}` : ""}
                  </text>
                  <text fg={context.theme.text.base}>{currentModel()}</text>
                  <Show when={value().usage.extraUsage}>
                    {(extra) => <text fg={context.theme.text.base}>Extra {formatMoney(extra().balanceCents, extra().currency)}</text>}
                  </Show>
                </>
              )}
            </Show>
            <Show when={error() && current}><text fg={context.theme.text.base}>Refresh failed</text></Show>
          </box>
        );
      },
    });

    const unregisterPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === "kimi.meter.dashboard"}>
          <box flexDirection="column">
            <text fg={context.theme.text.base}>Kimi meter</text>
            <Show when={dashboard()} fallback={<text fg={context.theme.text.base}>{loading() ? "Loading…" : (error() ?? "Unavailable")}</text>}>
              {(value) => (
                <>
                  <text fg={context.theme.text.base}>
                    {value().profile?.plan ?? "Kimi"}{formatRegion(value().profile?.region) ? ` · ${formatRegion(value().profile?.region)}` : ""}
                  </text>
                  <text fg={context.theme.text.base}>Current: {currentModel()}</text>
                  <text fg={context.theme.text.base}>5-hour: {formatPercent(value().usage.fiveHour)} used · reset {formatReset(value().usage.fiveHour) || "—"}</text>
                  <Show when={value().usage.week}>
                    {(week) => <text fg={context.theme.text.base}>7-day: {formatPercent(week())} used · reset {formatReset(week()) || "—"}</text>}
                  </Show>
                  <text fg={context.theme.text.base}>Monthly coding: {formatPercent(value().usage.month)} used · reset {formatReset(value().usage.month) || "—"}</text>
                  <Show when={value().usage.monthTotal}>
                    {(month) => <text fg={context.theme.text.base}>Monthly total: {formatPercent(month())} used · reset {formatReset(month()) || "—"}</text>}
                  </Show>
                  <Show when={value().usage.extraUsage}>
                    {(extra) => (
                      <text fg={context.theme.text.base}>
                        Extra Usage: {formatMoney(extra().balanceCents, extra().currency)} available · {formatMoney(extra().monthlyUsedCents, extra().currency)} used this month
                      </text>
                    )}
                  </Show>
                  <text fg={context.theme.text.base}>Models ({value().models.length})</text>
                  <For each={value().models}>
                    {(model) => (
                      <text fg={context.theme.text.base}>
                        {model.name} · {formatContext(model.context)}{model.efforts.length ? ` · ${model.efforts.join("/")}` : ""}
                      </text>
                    )}
                  </For>
                  <text fg={context.theme.text.base}>/kimi-refresh to refresh</text>
                </>
              )}
            </Show>
          </box>
        </Show>
      ),
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
