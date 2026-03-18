import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
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
