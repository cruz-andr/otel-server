import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerListContainers } from '../../src/tools/list-containers.js';
import type { DockerClient } from '../../src/clients/docker-client.js';

describe('list_containers tool', () => {
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
      listContainers: vi.fn(),
    } as unknown as DockerClient;

    registerListContainers(server, mockDockerClient);
  });

  it('registers the tool', () => {
    expect(server.tool).toHaveBeenCalledWith('list_containers', expect.any(String), expect.any(Object), expect.any(Object), expect.any(Function));
  });

  it('returns container list wrapped in XML', async () => {
    (mockDockerClient.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'abcdef123456',
        name: 'my-app',
        image: 'node:18',
        state: 'running',
        status: 'Up 2 hours',
        created: 1700000000,
      },
    ]);

    const result = await toolHandler({ status: 'all' });
    expect(result.content[0].text).toContain('<container_list count="1">');
    expect(result.content[0].text).toContain('my-app');
    expect(result.content[0].text).toContain('</container_list>');
  });

  it('handles empty results', async () => {
    (mockDockerClient.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await toolHandler({ status: 'all' });
    expect(result.content[0].text).toContain('<container_list count="0">');
    expect(result.content[0].text).toContain('No containers found');
  });

  it('filters by name', async () => {
    (mockDockerClient.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await toolHandler({ name_filter: 'nginx', status: 'all' });
    expect(mockDockerClient.listContainers).toHaveBeenCalledWith('nginx', 'all');
  });

  it('filters by status', async () => {
    (mockDockerClient.listContainers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await toolHandler({ status: 'running' });
    expect(mockDockerClient.listContainers).toHaveBeenCalledWith(undefined, 'running');
  });

  it('returns isError on failure', async () => {
    (mockDockerClient.listContainers as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Docker not running'));

    const result = await toolHandler({ status: 'all' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Docker not running');
  });
});
