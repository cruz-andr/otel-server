import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetContainerStatus } from '../../src/tools/get-container-status.js';
import type { DockerClient } from '../../src/clients/docker-client.js';

describe('get_container_status tool', () => {
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
      getContainerStatus: vi.fn(),
    } as unknown as DockerClient;

    registerGetContainerStatus(server, mockDockerClient);
  });

  it('returns XML-wrapped status', async () => {
    (mockDockerClient.getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abc123',
      name: 'my-app',
      image: 'node:18',
      state: 'running',
      health: 'healthy',
      exitCode: 0,
      startedAt: '2024-01-15T10:00:00Z',
      finishedAt: '0001-01-01T00:00:00Z',
      restartCount: 0,
      oomKilled: false,
      platform: 'linux',
    });

    const result = await toolHandler({ container_id: 'abc123' });
    expect(result.content[0].text).toContain('<container_status id="abc123">');
    expect(result.content[0].text).toContain('State:         running');
    expect(result.content[0].text).toContain('Health:        healthy');
    expect(result.content[0].text).toContain('</container_status>');
    expect(result.isError).toBeUndefined();
  });

  it('shows warning for OOM killed container', async () => {
    (mockDockerClient.getContainerStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abc123',
      name: 'my-app',
      image: 'node:18',
      state: 'exited',
      health: 'none',
      exitCode: 137,
      startedAt: '2024-01-15T10:00:00Z',
      finishedAt: '2024-01-15T11:00:00Z',
      restartCount: 3,
      oomKilled: true,
      platform: 'linux',
    });

    const result = await toolHandler({ container_id: 'abc123' });
    expect(result.content[0].text).toContain('WARNING: Container was killed due to Out Of Memory');
    expect(result.content[0].text).toContain('WARNING: Container has restarted 3 time(s)');
    expect(result.content[0].text).toContain('WARNING: Container exited with non-zero exit code 137');
  });
});
