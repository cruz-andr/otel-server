export interface Config {
  dockerSocketPath: string;
  jaegerBaseUrl: string;
  jaegerTimeoutMs: number;
  maxLogLines: number;
  defaultLogLines: number;
  maxTraceSpans: number;
  defaultLookback: string;
  redactPatterns: boolean;
  transport: 'stdio' | 'http';
  port: number;
}

export function loadConfig(): Config {
  return {
    dockerSocketPath: process.env.DOCKER_SOCKET_PATH ?? '/var/run/docker.sock',
    jaegerBaseUrl: process.env.JAEGER_BASE_URL ?? 'http://localhost:16686',
    jaegerTimeoutMs: parseInt(process.env.JAEGER_TIMEOUT_MS ?? '10000', 10),
    maxLogLines: parseInt(process.env.MAX_LOG_LINES ?? '500', 10),
    defaultLogLines: parseInt(process.env.DEFAULT_LOG_LINES ?? '100', 10),
    maxTraceSpans: parseInt(process.env.MAX_TRACE_SPANS ?? '200', 10),
    defaultLookback: process.env.DEFAULT_LOOKBACK ?? '1h',
    redactPatterns: (process.env.REDACT_PATTERNS ?? 'true') !== 'false',
    transport: (process.env.TRANSPORT === 'http' ? 'http' : 'stdio') as 'stdio' | 'http',
    port: parseInt(process.env.PORT ?? '3000', 10),
  };
}
