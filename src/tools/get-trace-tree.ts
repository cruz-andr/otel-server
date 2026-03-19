import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { JaegerClient } from '../clients/jaeger-client.js';
import type { Config } from '../config.js';
import type { SpanNode } from '../types/jaeger.js';
import { redact } from '../redact.js';
import { wrapTraceTree, truncationNotice } from '../formatters/xml-output.js';

function formatDuration(microseconds: number): string {
  if (microseconds < 1000) return `${microseconds}µs`;
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toFixed(1)}ms`;
  return `${(microseconds / 1_000_000).toFixed(2)}s`;
}

export function registerGetTraceTree(
  server: McpServer,
  jaegerClient: JaegerClient,
  config: Config,
): void {
  server.tool(
    'get_trace_tree',
    'Render a trace as an indented span tree. Shows service, operation, duration, and errors at each level. Content is redacted for PII/credentials.',
    {
      trace_id: z.string().describe('The trace ID to retrieve and render'),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(10)
        .describe('Maximum tree depth to render (max 20)'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ trace_id, max_depth }) => {
      try {
        const trace = await jaegerClient.getTrace(trace_id);
        const totalSpans = trace.spans.length;
        const roots = jaegerClient.buildSpanTree(trace);

        const lines: string[] = [];
        let spanCount = 0;
        const errorSpans: string[] = [];

        const render = (node: SpanNode, depth: number): void => {
          if (depth > max_depth || spanCount >= config.maxTraceSpans) return;
          spanCount++;

          const indent = '  '.repeat(depth);
          const hasError = node.span.tags.some(
            (t) => t.key === 'error' && (t.value === true || t.value === 'true'),
          );
          const errorMarker = hasError ? ' [ERROR]' : '';
          const duration = formatDuration(node.span.duration);

          lines.push(
            `${indent}${node.serviceName} > ${node.span.operationName} (${duration})${errorMarker}`,
          );

          if (hasError) {
            // Include error tags and logs for error spans
            const errorTags = node.span.tags
              .filter((t) => t.key === 'error.message' || t.key === 'error.kind' || t.key === 'error.object')
              .map((t) => `${indent}  [tag] ${t.key}: ${t.value}`);
            lines.push(...errorTags);

            const errorLogs = node.span.logs
              .flatMap((log) =>
                log.fields
                  .filter((f) => f.key === 'message' || f.key === 'stack' || f.key === 'event')
                  .map((f) => `${indent}  [log] ${f.key}: ${f.value}`),
              );
            lines.push(...errorLogs);

            errorSpans.push(`${node.serviceName} > ${node.span.operationName}: ${duration}`);
          }

          for (const child of node.children) {
            render(child, depth + 1);
          }
        };

        for (const root of roots) {
          render(root, 0);
        }

        const truncated = spanCount >= config.maxTraceSpans && totalSpans > config.maxTraceSpans;

        let content = lines.join('\n');

        if (truncated) {
          content += truncationNotice(
            config.maxTraceSpans,
            totalSpans,
            'Use max_depth to limit tree depth and focus on specific subtrees.',
          );
        }

        if (errorSpans.length > 0) {
          content += '\n\n--- Error Summary ---\n' + errorSpans.map((e) => `• ${e}`).join('\n');
        }

        if (config.redactPatterns) {
          content = redact(content);
        }

        const text = wrapTraceTree(content, trace_id);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error getting trace tree: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
