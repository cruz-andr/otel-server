import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetTraceTree } from '../../src/tools/get-trace-tree.js';
import type { JaegerClient } from '../../src/clients/jaeger-client.js';
import type { Config } from '../../src/config.js';
import type { SpanNode } from '../../src/types/jaeger.js';

describe('get_trace_tree tool', () => {
  let server: McpServer;
  let mockJaegerClient: JaegerClient;
  let config: Config;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    server = {
      tool: vi.fn((name, _desc, _schema, _annotations, handler) => {
        toolHandler = handler as typeof toolHandler;
      }),
    } as unknown as McpServer;

    mockJaegerClient = {
      getTrace: vi.fn(),
      buildSpanTree: vi.fn(),
    } as unknown as JaegerClient;

    config = {
      dockerSocketPath: '/var/run/docker.sock',
      jaegerBaseUrl: 'http://localhost:16686',
      jaegerTimeoutMs: 10000,
      maxLogLines: 500,
      defaultLogLines: 100,
      maxTraceSpans: 200,
      defaultLookback: '1h',
      redactPatterns: true,
    };

    registerGetTraceTree(server, mockJaegerClient, config);
  });

  it('renders span tree with XML wrapping', async () => {
    const trace = {
      traceID: 'abc123',
      spans: [
        {
          traceID: 'abc123',
          spanID: 'root',
          operationName: 'GET /api',
          startTime: 1000,
          duration: 500000,
          tags: [],
          logs: [],
          references: [],
          processID: 'p1',
        },
      ],
      processes: { p1: { serviceName: 'api', tags: [] } },
    };

    const tree: SpanNode[] = [
      {
        span: trace.spans[0],
        serviceName: 'api',
        children: [],
      },
    ];

    (mockJaegerClient.getTrace as ReturnType<typeof vi.fn>).mockResolvedValue(trace);
    (mockJaegerClient.buildSpanTree as ReturnType<typeof vi.fn>).mockReturnValue(tree);

    const result = await toolHandler({ trace_id: 'abc123', max_depth: 10 });
    expect(result.content[0].text).toContain('<trace_tree trace_id="abc123">');
    expect(result.content[0].text).toContain('api > GET /api');
    expect(result.content[0].text).toContain('</trace_tree>');
  });

  it('shows error summary for error spans', async () => {
    const trace = {
      traceID: 'abc123',
      spans: [
        {
          traceID: 'abc123',
          spanID: 'root',
          operationName: 'GET /api',
          startTime: 1000,
          duration: 500000,
          tags: [{ key: 'error', type: 'bool', value: true }],
          logs: [
            {
              timestamp: 1001,
              fields: [{ key: 'message', type: 'string', value: 'connection refused' }],
            },
          ],
          references: [],
          processID: 'p1',
        },
      ],
      processes: { p1: { serviceName: 'api', tags: [] } },
    };

    const tree: SpanNode[] = [
      {
        span: trace.spans[0],
        serviceName: 'api',
        children: [],
      },
    ];

    (mockJaegerClient.getTrace as ReturnType<typeof vi.fn>).mockResolvedValue(trace);
    (mockJaegerClient.buildSpanTree as ReturnType<typeof vi.fn>).mockReturnValue(tree);

    const result = await toolHandler({ trace_id: 'abc123', max_depth: 10 });
    expect(result.content[0].text).toContain('[ERROR]');
    expect(result.content[0].text).toContain('connection refused');
    expect(result.content[0].text).toContain('Error Summary');
  });

  it('redacts secrets in span content', async () => {
    const trace = {
      traceID: 'abc123',
      spans: [
        {
          traceID: 'abc123',
          spanID: 'root',
          operationName: 'GET /api',
          startTime: 1000,
          duration: 500000,
          tags: [{ key: 'error', type: 'bool', value: true }],
          logs: [
            {
              timestamp: 1001,
              fields: [{ key: 'message', type: 'string', value: 'Auth failed for user@example.com' }],
            },
          ],
          references: [],
          processID: 'p1',
        },
      ],
      processes: { p1: { serviceName: 'api', tags: [] } },
    };

    const tree: SpanNode[] = [
      {
        span: trace.spans[0],
        serviceName: 'api',
        children: [],
      },
    ];

    (mockJaegerClient.getTrace as ReturnType<typeof vi.fn>).mockResolvedValue(trace);
    (mockJaegerClient.buildSpanTree as ReturnType<typeof vi.fn>).mockReturnValue(tree);

    const result = await toolHandler({ trace_id: 'abc123', max_depth: 10 });
    expect(result.content[0].text).toContain('[REDACTED_EMAIL]');
    expect(result.content[0].text).not.toContain('user@example.com');
  });

  it('truncates at maxTraceSpans', async () => {
    // Create a trace with 201+ spans
    const spans = Array.from({ length: 250 }, (_, i) => ({
      traceID: 'abc123',
      spanID: `span${i}`,
      operationName: `op${i}`,
      startTime: 1000 + i,
      duration: 100,
      tags: [],
      logs: [],
      references: i === 0 ? [] : [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 'span0' }],
      processID: 'p1',
    }));

    const trace = {
      traceID: 'abc123',
      spans,
      processes: { p1: { serviceName: 'api', tags: [] } },
    };

    // Build a flat tree (all children of root) to trigger truncation
    const root: SpanNode = {
      span: spans[0],
      serviceName: 'api',
      children: spans.slice(1).map((s) => ({
        span: s,
        serviceName: 'api',
        children: [],
      })),
    };

    (mockJaegerClient.getTrace as ReturnType<typeof vi.fn>).mockResolvedValue(trace);
    (mockJaegerClient.buildSpanTree as ReturnType<typeof vi.fn>).mockReturnValue([root]);

    const result = await toolHandler({ trace_id: 'abc123', max_depth: 10 });
    expect(result.content[0].text).toContain('Showing 200 of 250');
  });

  it('returns isError on failure', async () => {
    (mockJaegerClient.getTrace as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Trace not found'),
    );

    const result = await toolHandler({ trace_id: 'nonexistent', max_depth: 10 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Trace not found');
  });
});
