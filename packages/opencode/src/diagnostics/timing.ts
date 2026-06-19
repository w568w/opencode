import { Schema } from "effect"

export const TimingSpan = Schema.Struct({
  id: Schema.Number,
  parentID: Schema.optional(Schema.Number),
  name: Schema.String,
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  duration: Schema.optional(Schema.Number),
  status: Schema.Literals(["running", "ok", "error"]),
  error: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
}).annotate({ identifier: "DiagnosticsTimingSpan" })
export type TimingSpan = Schema.Schema.Type<typeof TimingSpan>

export const TimingReport = Schema.Struct({
  origin: Schema.Number,
  now: Schema.Number,
  spans: Schema.Array(TimingSpan),
}).annotate({ identifier: "DiagnosticsTimingReport" })
export type TimingReport = Schema.Schema.Type<typeof TimingReport>

type TagValue = string | number | boolean

type Span = {
  id: number
  parentID?: number
  name: string
  startedAt: number
  endedAt?: number
  status: "running" | "ok" | "error"
  error?: string
  tags?: Record<string, TagValue>
}

const origin = Date.now() - performance.now()
let nextID = 1
const spans: Span[] = []
const stack: number[] = []

export function start(name: string, tags?: Record<string, TagValue>, parentID = stack.at(-1)) {
  const span: Span = {
    id: nextID++,
    parentID,
    name,
    startedAt: performance.now(),
    status: "running",
    tags,
  }
  spans.push(span)
  return span.id
}

export function current() {
  return stack.at(-1)
}

export function end(id: number, status: "ok" | "error" = "ok", error?: unknown) {
  const span = spans.find((item) => item.id === id)
  if (!span || span.endedAt !== undefined) return
  span.endedAt = performance.now()
  span.status = status
  if (error instanceof Error) span.error = error.message
  else if (typeof error === "string") span.error = error
  else if (error !== undefined) span.error = JSON.stringify(error)
}

export async function measure<T>(
  name: string,
  tags: Record<string, TagValue> | undefined,
  run: () => Promise<T>,
  parentID = stack.at(-1),
) {
  const id = start(name, tags, parentID)
  stack.push(id)
  try {
    const result = await run()
    end(id)
    return result
  } catch (error) {
    end(id, "error", error)
    throw error
  } finally {
    stack.pop()
  }
}

export function measureSync<T>(
  name: string,
  tags: Record<string, TagValue> | undefined,
  run: () => T,
  parentID = stack.at(-1),
) {
  const id = start(name, tags, parentID)
  stack.push(id)
  try {
    const result = run()
    end(id)
    return result
  } catch (error) {
    end(id, "error", error)
    throw error
  } finally {
    stack.pop()
  }
}

export function snapshot(): TimingReport {
  const current = performance.now()
  return {
    origin,
    now: current,
    spans: spans.map((span) => ({
      ...span,
      duration: (span.endedAt ?? current) - span.startedAt,
    })),
  }
}

export * as DiagnosticsTiming from "./timing"
