import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { DockerClient } from '../clients/docker-client.js';
import type { Config } from '../config.js';
import { redact } from '../redact.js';
import { wrapLogs, truncationNotice } from '../formatters/xml-output.js';

export function registerFetchLogs(
  server: McpServer,
  dockerClient: DockerClient,
  config: Config,
): void {
  server.tool(
    'fetch_logs',
    'Fetch logs from a Docker container. Supports tail count, time range filtering, and regex grep. Logs are redacted for PII/credentials.',
    {
      container_id: z.string().describe('Container ID or name'),
      lines: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .default(100)
        .describe('Number of log lines to fetch (max 500)'),
      grep_pattern: z
        .string()
        .optional()
        .describe('Regex pattern to filter log lines'),
      since: z
        .string()
        .optional()
        .describe('Show logs since this time (relative like "15m", "1h", "2d" or Unix timestamp)'),
      until: z
        .string()
        .optional()
        .describe('Show logs until this time (relative like "15m", "1h", "2d" or Unix timestamp)'),
    },
    async ({ container_id, lines, grep_pattern, since, until }) => {
      try {
        const tail = Math.min(lines, config.maxLogLines);
        let logLines = await dockerClient.fetchLogs(container_id, { tail, since, until });

        if (grep_pattern) {
          try {
            const regex = new RegExp(grep_pattern, 'i');
            logLines = logLines.filter((line) => regex.test(line));
          } catch {
            return {
              content: [{ type: 'text', text: `Invalid grep pattern: "${grep_pattern}"` }],
              isError: true,
            };
          }
        }

        const truncated = logLines.length >= tail;
        let content = logLines.join('\n');

        if (truncated) {
          content += truncationNotice(
            tail,
            tail,
            'Use "since"/"until" to navigate or "grep_pattern" to filter.',
          );
        }

        if (config.redactPatterns) {
          content = redact(content);
        }

        const text = wrapLogs(content, container_id, truncated);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error fetching logs: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
