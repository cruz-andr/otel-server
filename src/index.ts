import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { loadConfig, Config } from './config.js';
import { DockerClient } from './clients/docker-client.js';
import { JaegerClient } from './clients/jaeger-client.js';
import { registerListContainers } from './tools/list-containers.js';
import { registerGetContainerStatus } from './tools/get-container-status.js';
import { registerGetContainerStats } from './tools/get-container-stats.js';
import { registerFetchLogs } from './tools/fetch-logs.js';
import { registerSearchErrorTraces } from './tools/search-error-traces.js';
import { registerGetTraceTree } from './tools/get-trace-tree.js';

function createMcpServer(
  dockerClient: DockerClient,
  jaegerClient: JaegerClient,
  config: Config,
): McpServer {
  const server = new McpServer({
    name: 'otel-server',
    version: '1.0.0',
  });

  registerListContainers(server, dockerClient);
  registerGetContainerStatus(server, dockerClient);
  registerGetContainerStats(server, dockerClient);
  registerFetchLogs(server, dockerClient, config);
  registerSearchErrorTraces(server, jaegerClient, config);
  registerGetTraceTree(server, jaegerClient, config);

  server.prompt(
    'diagnose_container',
    'Step-by-step diagnostic workflow for a Docker container',
    { container_id: z.string().describe('Container ID or name to diagnose') },
    async ({ container_id }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Diagnose the Docker container "${container_id}":\n\n1. Use get_container_status to check state, health, and restart count\n2. Use get_container_stats to check CPU, memory, and I/O\n3. Use fetch_logs with lines=50 to check recent output\n4. If memory > 80%, flag OOM risk\n5. If restart count > 0, search logs for crash patterns\n6. Summarize findings and recommend next steps`,
        },
      }],
    })
  );

  server.prompt(
    'investigate_errors',
    'Investigate error traces for a service using Jaeger',
    {
      service: z.string().describe('Service name to investigate'),
      lookback: z.string().optional().default('1h').describe('Time window (e.g., "1h", "6h", "1d")'),
    },
    async ({ service, lookback }) => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: `Investigate errors for service "${service}" over the last ${lookback}:\n\n1. Use search_error_traces to find recent error traces\n2. Pick the trace with the most errors or longest duration\n3. Use get_trace_tree to render the full span tree\n4. Identify the root cause span and summarize the error chain\n5. Suggest remediation steps`,
        },
      }],
    })
  );

  server.resource(
    'server-info',
    'otel://info',
    { description: 'Server capabilities and available tools', mimeType: 'application/json' },
    async () => ({
      contents: [{
        uri: 'otel://info',
        mimeType: 'application/json',
        text: JSON.stringify({
          name: 'otel-server',
          version: '1.0.0',
          description: 'Docker container inspection and OpenTelemetry trace querying via Jaeger',
          tools: ['list_containers', 'get_container_status', 'get_container_stats', 'fetch_logs', 'search_error_traces', 'get_trace_tree'],
          prompts: ['diagnose_container', 'investigate_errors'],
        }, null, 2),
      }],
    })
  );

  return server;
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

async function startHttpTransport(config: Config): Promise<void> {
  const dockerClient = new DockerClient(config.dockerSocketPath);
  const jaegerClient = new JaegerClient(config.jaegerBaseUrl, config.jaegerTimeoutMs);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    try {
      if (req.method === 'POST') {
        const body = await readRequestBody(req);
        const message = JSON.parse(body);

        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createMcpServer(dockerClient, jaegerClient, config);
        await server.connect(transport);
        await transport.handleRequest(req, res, message);

        res.on('close', () => {
          transport.close();
          server.close();
        });
      } else {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      }
    } catch (err) {
      console.error('Error handling request:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  httpServer.listen(config.port, () => {
    console.error(`otel-server MCP server running on http://localhost:${config.port}/mcp`);
  });

  process.on('SIGINT', () => {
    console.error('Shutting down...');
    httpServer.close();
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.transport === 'http') {
    await startHttpTransport(config);
    return;
  }

  const dockerClient = new DockerClient(config.dockerSocketPath);
  const jaegerClient = new JaegerClient(config.jaegerBaseUrl, config.jaegerTimeoutMs);

  const server = createMcpServer(dockerClient, jaegerClient, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('otel-server MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
