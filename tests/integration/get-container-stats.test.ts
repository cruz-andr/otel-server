import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetContainerStats } from '../../src/tools/get-container-stats.js';
import type { DockerClient } from '../../src/clients/docker-client.js';

describe('get_container_stats tool', () => {
  let server: McpServer;
  let mockDockerClient: DockerClient;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    server = {
      tool: vi.fn((name, _desc, _schema, _annotations, handler) => {
        toolHandler = handler as typeof toolHandler;
      }),
    } as unknown as McpServer;

    mockDockerClient = {
      getContainerStats: vi.fn(),
    } as unknown as DockerClient;

    registerGetContainerStats(server, mockDockerClient);
  });

  it('returns XML-wrapped stats', async () => {
    (mockDockerClient.getContainerStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abc123',
      name: 'my-app',
      cpuPercent: 25.5,
      memoryUsage: 104857600,
      memoryLimit: 1073741824,
      memoryPercent: 9.77,
      networkRx: 1048576,
      networkTx: 2097152,
      blockRead: 4096,
      blockWrite: 8192,
      pids: 15,
    });

    const result = await toolHandler({ container_id: 'abc123' });
    expect(result.content[0].text).toContain('<container_stats id="abc123">');
    expect(result.content[0].text).toContain('CPU Usage:   25.50%');
    expect(result.content[0].text).toContain('PIDs:        15');
    expect(result.content[0].text).toContain('</container_stats>');
  });

  it('shows high memory warning', async () => {
    (mockDockerClient.getContainerStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abc123',
      name: 'my-app',
      cpuPercent: 10,
      memoryUsage: 966367641,
      memoryLimit: 1073741824,
      memoryPercent: 95.0,
      networkRx: 0,
      networkTx: 0,
      blockRead: 0,
      blockWrite: 0,
      pids: 50,
    });

    const result = await toolHandler({ container_id: 'abc123' });
    expect(result.content[0].text).toContain('WARNING: Memory at 95.0%');
    expect(result.content[0].text).toContain('possible memory leak or OOM risk');
  });

  it('shows high CPU warning', async () => {
    (mockDockerClient.getContainerStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abc123',
      name: 'my-app',
      cpuPercent: 98.5,
      memoryUsage: 104857600,
      memoryLimit: 1073741824,
      memoryPercent: 9.77,
      networkRx: 0,
      networkTx: 0,
      blockRead: 0,
      blockWrite: 0,
      pids: 10,
    });

    const result = await toolHandler({ container_id: 'abc123' });
    expect(result.content[0].text).toContain('WARNING: CPU at 98.5%');
  });

  it('returns isError on failure', async () => {
    (mockDockerClient.getContainerStats as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Container not found'));

    const result = await toolHandler({ container_id: 'nonexistent' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Container not found');
  });
});
