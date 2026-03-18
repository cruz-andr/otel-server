import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchErrorTraces } from '../../src/tools/search-error-traces.js';
import type { JaegerClient } from '../../src/clients/jaeger-client.js';
import type { Config } from '../../src/config.js';

describe('search_error_traces tool', () => {
  let server: McpServer;
  let mockJaegerClient: JaegerClient;
  let config: Config;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    server = {
      tool: vi.fn((name, _desc, _schema, handler) => {
        toolHandler = handler as typeof toolHandler;
      }),
    } as unknown as McpServer;

    mockJaegerClient = {
      searchErrorTraces: vi.fn(),
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

    registerSearchErrorTraces(server, mockJaegerClient, config);
  });

  it('returns XML-wrapped trace list', async () => {
    (mockJaegerClient.searchErrorTraces as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        traceId: 'abc123def456',
        rootService: 'checkout',
        rootOperation: 'POST /order',
        spanCount: 12,
        duration: 2500000,
        errorCount: 2,
        startTime: 1700000000000000,
      },
    ]);

    const result = await toolHandler({ service: 'checkout', lookback: '1h', limit: 20 });
    expect(result.content[0].text).toContain('<trace_list service="checkout">');
    expect(result.content[0].text).toContain('abc123def456');
    expect(result.content[0].text).toContain('get_trace_tree');
    expect(result.content[0].text).toContain('</trace_list>');
  });

  it('shows instructional message for zero results', async () => {
    (mockJaegerClient.searchErrorTraces as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await toolHandler({ service: 'unknown-svc', lookback: '1h', limit: 20 });
    expect(result.content[0].text).toContain('No error traces found');
    expect(result.content[0].text).toContain('service names are case-sensitive');
    expect(result.content[0].text).toContain('Try a longer lookback window');
  });

  it('returns isError on failure', async () => {
    (mockJaegerClient.searchErrorTraces as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Cannot connect to Jaeger'),
    );

    const result = await toolHandler({ service: 'test', lookback: '1h', limit: 20 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot connect to Jaeger');
  });
});
