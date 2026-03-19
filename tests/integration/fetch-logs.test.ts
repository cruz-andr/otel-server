import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFetchLogs } from '../../src/tools/fetch-logs.js';
import type { DockerClient } from '../../src/clients/docker-client.js';
import type { Config } from '../../src/config.js';

describe('fetch_logs tool', () => {
  let server: McpServer;
  let mockDockerClient: DockerClient;
  let config: Config;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    server = {
      tool: vi.fn((name, _desc, _schema, _annotations, handler) => {
        toolHandler = handler as typeof toolHandler;
      }),
    } as unknown as McpServer;

    mockDockerClient = {
      fetchLogs: vi.fn(),
    } as unknown as DockerClient;

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

    registerFetchLogs(server, mockDockerClient, config);
  });

  it('returns XML-wrapped logs', async () => {
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
      '2024-01-15 10:00:00 INFO Server started',
      '2024-01-15 10:00:01 INFO Listening on port 3000',
    ]);

    const result = await toolHandler({ container_id: 'abc123', lines: 100 });
    expect(result.content[0].text).toContain('<container_logs id="abc123"');
    expect(result.content[0].text).toContain('Server started');
    expect(result.content[0].text).toContain('</container_logs>');
  });

  it('shows truncation notice when at limit', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue(lines);

    const result = await toolHandler({ container_id: 'abc123', lines: 100 });
    expect(result.content[0].text).toContain('truncated="true"');
    expect(result.content[0].text).toContain('Showing 100 of 100');
  });

  it('applies grep_pattern filter', async () => {
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
      '2024-01-15 10:00:00 INFO Request received',
      '2024-01-15 10:00:01 ERROR Failed to connect',
      '2024-01-15 10:00:02 INFO Request completed',
    ]);

    const result = await toolHandler({ container_id: 'abc123', lines: 100, grep_pattern: 'ERROR' });
    expect(result.content[0].text).toContain('Failed to connect');
    expect(result.content[0].text).not.toContain('Request received');
  });

  it('redacts secrets in logs', async () => {
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue([
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature',
      'password=mysecretpassword123',
      'User john@example.com logged in',
    ]);

    const result = await toolHandler({ container_id: 'abc123', lines: 100 });
    expect(result.content[0].text).toContain('[REDACTED_BEARER]');
    expect(result.content[0].text).toContain('[REDACTED_SECRET]');
    expect(result.content[0].text).toContain('[REDACTED_EMAIL]');
    expect(result.content[0].text).not.toContain('mysecretpassword123');
  });

  it('passes since/until to Docker client', async () => {
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await toolHandler({ container_id: 'abc123', lines: 100, since: '15m', until: '5m' });
    expect(mockDockerClient.fetchLogs).toHaveBeenCalledWith('abc123', {
      tail: 100,
      since: '15m',
      until: '5m',
    });
  });

  it('returns isError for invalid grep pattern', async () => {
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue(['line 1']);

    const result = await toolHandler({ container_id: 'abc123', lines: 100, grep_pattern: '[invalid' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid grep pattern');
  });

  it('caps lines at maxLogLines', async () => {
    (mockDockerClient.fetchLogs as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await toolHandler({ container_id: 'abc123', lines: 500 });
    expect(mockDockerClient.fetchLogs).toHaveBeenCalledWith('abc123', expect.objectContaining({ tail: 500 }));
  });
});
