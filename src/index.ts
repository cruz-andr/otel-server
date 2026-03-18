import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { DockerClient } from './clients/docker-client.js';
import { JaegerClient } from './clients/jaeger-client.js';
import { registerListContainers } from './tools/list-containers.js';
import { registerGetContainerStatus } from './tools/get-container-status.js';
import { registerGetContainerStats } from './tools/get-container-stats.js';
import { registerFetchLogs } from './tools/fetch-logs.js';
import { registerSearchErrorTraces } from './tools/search-error-traces.js';
import { registerGetTraceTree } from './tools/get-trace-tree.js';

async function main(): Promise<void> {
  const config = loadConfig();

  const dockerClient = new DockerClient(config.dockerSocketPath);
  const jaegerClient = new JaegerClient(config.jaegerBaseUrl, config.jaegerTimeoutMs);

  const server = new McpServer({
    name: 'otel-server',
    version: '1.0.0',
  });

  // Register all tools
  registerListContainers(server, dockerClient);
  registerGetContainerStatus(server, dockerClient);
  registerGetContainerStats(server, dockerClient);
  registerFetchLogs(server, dockerClient, config);
  registerSearchErrorTraces(server, jaegerClient, config);
  registerGetTraceTree(server, jaegerClient, config);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('otel-server MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
