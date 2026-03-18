import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DockerClient } from '../clients/docker-client.js';
import { wrapContainerList } from '../formatters/xml-output.js';

export function registerListContainers(server: McpServer, dockerClient: DockerClient): void {
  server.tool(
    'list_containers',
    'Discover Docker containers by name or status. Use this first to find container IDs before inspecting them.',
    {
      name_filter: z.string().optional().describe('Filter containers by name (substring match)'),
      status: z
        .enum(['running', 'exited', 'paused', 'all'])
        .optional()
        .default('all')
        .describe('Filter by container status'),
    },
    async ({ name_filter, status }) => {
      try {
        const containers = await dockerClient.listContainers(name_filter, status);

        if (containers.length === 0) {
          const text = wrapContainerList('No containers found matching the given filters.', 0);
          return { content: [{ type: 'text', text }] };
        }

        const header = 'ID           | Name                 | Image                | State    | Status';
        const separator = '-------------|----------------------|----------------------|----------|------------------';
        const rows = containers.map(
          (c) =>
            `${c.id} | ${c.name.padEnd(20)} | ${c.image.substring(0, 20).padEnd(20)} | ${c.state.padEnd(8)} | ${c.status}`,
        );

        const table = [header, separator, ...rows].join('\n');
        const text = wrapContainerList(table, containers.length);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error listing containers: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
