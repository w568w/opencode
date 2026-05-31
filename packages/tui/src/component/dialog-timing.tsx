import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Schema } from "effect"
import { createMemo, Show } from "solid-js"
import { useClipboard } from "../context/clipboard"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { getScrollAcceleration } from "../util/scroll"
import { useToast } from "../ui/toast"
import { useTuiConfig } from "../config"

const TimingSpan = Schema.Struct({
  id: Schema.Number,
  parentID: Schema.optional(Schema.Number),
  name: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
  status: Schema.Literals(["running", "ok", "error"]),
  error: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
})
type TimingSpan = Schema.Schema.Type<typeof TimingSpan>

const TimingReport = Schema.Struct({
  origin: Schema.Number,
  now: Schema.Number,
  spans: Schema.Array(TimingSpan),
})
type TimingReport = Schema.Schema.Type<typeof TimingReport>

export const decodeTimingReport = Schema.decodeUnknownSync(TimingReport)

export function normalizeTimingReport(input: unknown) {
  const spans = typeof input === "object" && input !== null ? Reflect.get(input, "spans") : undefined
  if (Array.isArray(spans)) {
    const report = input as Record<string, unknown>
    return decodeTimingReport({
      ...report,
      spans: spans.map((span) => {
        if (typeof span !== "object" || span === null) return span
        return {
          ...span,
          parentID: Reflect.get(span, "parentID") ?? undefined,
          endedAt: Reflect.get(span, "endedAt") ?? undefined,
          duration: Reflect.get(span, "duration") ?? undefined,
          error: Reflect.get(span, "error") ?? undefined,
          tags: Reflect.get(span, "tags") ?? undefined,
        }
      }),
    })
  }
  return decodeTimingReport(input)
}

function fmtMs(value: number | undefined) {
  if (value === undefined) return "running"
  if (value < 1000) return `${Math.round(value)}ms`
  return `${(value / 1000).toFixed(2)}s`
}

function timingRows(report: TimingReport) {
  const byParent = new Map<number | undefined, TimingSpan[]>()
  const ids = new Set(report.spans.map((span) => span.id))
  for (const span of report.spans) {
    const parentID = span.parentID !== undefined && ids.has(span.parentID) ? span.parentID : undefined
    byParent.set(parentID, [...(byParent.get(parentID) ?? []), span])
  }

  const rows: { text: string; error: boolean }[] = []
  const visit = (parentID: number | undefined, depth: number) => {
    for (const span of (byParent.get(parentID) ?? []).toSorted((a, b) => a.startedAt - b.startedAt)) {
      const tags = span.tags
        ? Object.entries(span.tags)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(" ")
        : ""
      const error = span.error ? ` error=${span.error}` : ""
      const suffix = [tags, error].filter(Boolean).join(" ")
      const indent = "  ".repeat(Math.min(depth, 6))
      rows.push({
        text: `${fmtMs(span.duration).padStart(8)}  ${indent}${span.status === "error" ? "! " : ""}${span.name}${suffix ? `  ${suffix}` : ""}`,
        error: span.status === "error",
      })
      visit(span.id, depth + 1)
    }
  }
  visit(undefined, 0)
  return rows
}

function formatTimingReport(report: TimingReport) {
  return [`${report.spans.length} spans. Parallel children show wall time.`, ...timingRows(report).map((row) => row.text), ""].join("\n")
}

export function DialogTiming(props: { report: TimingReport }) {
  const { theme } = useTheme()
  const toast = useToast()
  const clipboard = useClipboard()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  let scroll: ScrollBoxRenderable | undefined
  const rows = createMemo(() => timingRows(props.report))
  const text = createMemo(() => formatTimingReport(props.report))
  const maxHeight = createMemo(() => Math.max(8, dimensions().height - 10))
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const copyAll = () =>
    clipboard.write?.(text()).then(
      () => toast.show({ message: "Copied timing report", variant: "info" }),
      toast.error,
    )

  useBindings(() => ({
    mode: "modal",
    commands: [
      {
        title: "Scroll timing up",
        value: "diagnostics.time.scroll.up",
        category: "Dialog",
        hidden: true,
        run: () => scroll?.scrollBy(-1),
      },
      {
        title: "Scroll timing down",
        value: "diagnostics.time.scroll.down",
        category: "Dialog",
        hidden: true,
        run: () => scroll?.scrollBy(1),
      },
      {
        title: "Page timing up",
        value: "diagnostics.time.page.up",
        category: "Dialog",
        hidden: true,
        run: () => scroll?.scrollBy(-(scroll?.height ?? 1)),
      },
      {
        title: "Page timing down",
        value: "diagnostics.time.page.down",
        category: "Dialog",
        hidden: true,
        run: () => scroll?.scrollBy(scroll?.height ?? 1),
      },
      {
        title: "Timing top",
        value: "diagnostics.time.top",
        category: "Dialog",
        hidden: true,
        run: () => scroll?.scrollTo(0),
      },
      {
        title: "Timing bottom",
        value: "diagnostics.time.bottom",
        category: "Dialog",
        hidden: true,
        run: () => scroll?.scrollTo(scroll.scrollHeight),
      },
      {
        title: "Copy timing report",
        value: "diagnostics.time.copy",
        category: "Dialog",
        hidden: true,
        run: copyAll,
      },
    ],
    bindings: [
      { key: "up,k", cmd: "diagnostics.time.scroll.up", desc: "Scroll timing up" },
      { key: "down,j", cmd: "diagnostics.time.scroll.down", desc: "Scroll timing down" },
      { key: "pageup,ctrl+b", cmd: "diagnostics.time.page.up", desc: "Page timing up" },
      { key: "pagedown,ctrl+f,space", cmd: "diagnostics.time.page.down", desc: "Page timing down" },
      { key: "home,g", cmd: "diagnostics.time.top", desc: "Timing top" },
      { key: "end,G", cmd: "diagnostics.time.bottom", desc: "Timing bottom" },
      { key: "c", cmd: "diagnostics.time.copy", desc: "Copy timing report" },
    ],
  }))

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} height={maxHeight()}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Startup timing
        </text>
        <text fg={theme.accent} onMouseUp={copyAll}>
          Copy all
        </text>
      </box>
      <text fg={theme.textMuted}>
        {`${props.report.spans.length} spans. Scroll to view all; parallel children show wall time.`}
      </text>
      <scrollbox
        flexGrow={1}
        flexShrink={1}
        height={maxHeight() - 3}
        scrollAcceleration={scrollAcceleration()}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <Show when={rows().length > 0} fallback={<text fg={theme.textMuted}>No timing spans recorded.</text>}>
          {rows().map((row) => (
            <text fg={row.error ? theme.error : theme.text}>{row.text}</text>
          ))}
        </Show>
      </scrollbox>
    </box>
  )
}
