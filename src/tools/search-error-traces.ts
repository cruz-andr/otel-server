import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { JaegerClient } from '../clients/jaeger-client.js';
import type { Config } from '../config.js';
import { wrapTraceList } from '../formatters/xml-output.js';

function formatDuration(microseconds: number): string {
  if (microseconds < 1000) return `${microseconds}µs`;
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toFixed(1)}ms`;
  return `${(microseconds / 1_000_000).toFixed(2)}s`;
}

function formatTimestamp(microseconds: number): string {
  return new Date(microseconds / 1000).toISOString();
}

export function registerSearchErrorTraces(
  server: McpServer,
  jaegerClient: JaegerClient,
  config: Config,
): void {
  server.tool(
    'search_error_traces',
    'Search for error traces in Jaeger by service name. Returns a summary table of traces with errors.',
    {
      service: z.string().describe('Service name to search for error traces'),
      lookback: z
        .string()
        .optional()
        .default('1h')
        .describe('Time window to search (e.g., "1h", "30m", "2d")'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(20)
        .describe('Maximum number of traces to return (max 50)'),
      operation: z
        .string()
        .optional()
        .describe('Filter by operation name'),
      min_duration: z
        .string()
        .optional()
        .describe('Minimum duration filter (e.g., "100ms", "1s")'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ service, lookback, limit, operation, min_duration }) => {
      try {
        const traces = await jaegerClient.searchErrorTraces({
          service,
          lookback: lookback ?? config.defaultLookback,
          limit,
          operation,
          minDuration: min_duration,
        });

        if (traces.length === 0) {
          const hints = [
            `No error traces found for service "${service}" in the last ${lookback}.`,
            '',
            'Possible reasons:',
            '- The service name may be different (service names are case-sensitive)',
            '- Traces may not have been flushed yet (check collector buffering)',
            '- Try a longer lookback window (e.g., "6h", "1d")',
            '- The service may not be instrumented with OpenTelemetry',
          ];
          const text = wrapTraceList(hints.join('\n'), service);
          return { content: [{ type: 'text', text }] };
        }

        const header = 'Trace ID          | Service       | Operation          | Spans | Errors | Duration  | Time';
        const separator = '------------------|---------------|--------------------|----- -|--------|-----------|-------------------------';
        const rows = traces.map(
          (t) =>
            `${t.traceId.substring(0, 16)} | ${t.rootService.substring(0, 13).padEnd(13)} | ${t.rootOperation.substring(0, 18).padEnd(18)} | ${String(t.spanCount).padStart(5)} | ${String(t.errorCount).padStart(6)} | ${formatDuration(t.duration).padStart(9)} | ${formatTimestamp(t.startTime)}`,
        );

        const table = [header, separator, ...rows].join('\n');
        const text = wrapTraceList(
          `${table}\n\nUse get_trace_tree with a trace ID to drill into span details.`,
          service,
        );
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error searching traces: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
