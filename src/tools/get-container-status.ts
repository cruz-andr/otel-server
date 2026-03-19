import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DockerClient } from '../clients/docker-client.js';
import { wrapContainerStatus } from '../formatters/xml-output.js';

export function registerGetContainerStatus(server: McpServer, dockerClient: DockerClient): void {
  server.tool(
    'get_container_status',
    'Get detailed status of a Docker container including health, exit code, uptime, restart count, and OOM status.',
    {
      container_id: z.string().describe('Container ID or name'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ container_id }) => {
      try {
        const status = await dockerClient.getContainerStatus(container_id);

        const lines = [
          `Name:          ${status.name}`,
          `Image:         ${status.image}`,
          `State:         ${status.state}`,
          `Health:        ${status.health}`,
          `Exit Code:     ${status.exitCode}`,
          `Started At:    ${status.startedAt}`,
          `Finished At:   ${status.finishedAt}`,
          `Restart Count: ${status.restartCount}`,
          `OOM Killed:    ${status.oomKilled}`,
          `Platform:      ${status.platform}`,
        ];

        const warnings: string[] = [];
        if (status.oomKilled) {
          warnings.push('WARNING: Container was killed due to Out Of Memory (OOM). Check memory limits and usage patterns.');
        }
        if (status.restartCount > 0) {
          warnings.push(`WARNING: Container has restarted ${status.restartCount} time(s). Check logs for crash loops.`);
        }
        if (status.exitCode !== 0 && status.state === 'exited') {
          warnings.push(`WARNING: Container exited with non-zero exit code ${status.exitCode}.`);
        }

        const content = warnings.length > 0
          ? lines.join('\n') + '\n\n' + warnings.join('\n')
          : lines.join('\n');

        const text = wrapContainerStatus(content, container_id);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error getting container status: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
