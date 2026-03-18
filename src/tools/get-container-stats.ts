import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DockerClient } from '../clients/docker-client.js';
import { wrapContainerStats } from '../formatters/xml-output.js';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(2)} ${units[i]}`;
}

export function registerGetContainerStats(server: McpServer, dockerClient: DockerClient): void {
  server.tool(
    'get_container_stats',
    'Get a resource snapshot of a Docker container: CPU, memory, network I/O, block I/O, and PIDs. Useful for diagnosing OOM kills and memory leaks.',
    {
      container_id: z.string().describe('Container ID or name'),
    },
    async ({ container_id }) => {
      try {
        const stats = await dockerClient.getContainerStats(container_id);

        const lines = [
          `Name:        ${stats.name}`,
          `CPU Usage:   ${stats.cpuPercent.toFixed(2)}%`,
          `Memory:      ${formatBytes(stats.memoryUsage)} / ${formatBytes(stats.memoryLimit)} (${stats.memoryPercent.toFixed(1)}%)`,
          `Network I/O: ${formatBytes(stats.networkRx)} rx / ${formatBytes(stats.networkTx)} tx`,
          `Block I/O:   ${formatBytes(stats.blockRead)} read / ${formatBytes(stats.blockWrite)} write`,
          `PIDs:        ${stats.pids}`,
        ];

        const warnings: string[] = [];
        if (stats.memoryPercent > 90) {
          warnings.push(`WARNING: Memory at ${stats.memoryPercent.toFixed(1)}% — possible memory leak or OOM risk.`);
        }
        if (stats.cpuPercent > 90) {
          warnings.push(`WARNING: CPU at ${stats.cpuPercent.toFixed(1)}% — container may be CPU-throttled.`);
        }

        const content = warnings.length > 0
          ? lines.join('\n') + '\n\n' + warnings.join('\n')
          : lines.join('\n');

        const text = wrapContainerStats(content, container_id);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error getting container stats: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
