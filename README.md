# OpenTelemetry & Docker MCP Server (otel-server)

An intelligent Model Context Protocol (MCP) server that gives autonomous AI agents (like Claude) the ability to act as a Site Reliability Engineer (SRE).

This server bridges the gap between static code analysis and runtime observability. It allows LLMs to autonomously discover Docker containers, monitor resource utilization (OOM risks), tail logs, and drill down into OpenTelemetry distributed traces (via Jaeger)—all safely and securely.

## Key Features

Built specifically for how LLMs "think" and navigate:

* **LLM Context Bounding:** All tool outputs are wrapped in strict XML tags (e.g., `<container_logs>`, `<trace_tree>`) to prevent the LLM from hallucinating raw logs or trace data as prompt instructions.
* **Built-in PII & Credential Redaction:** Production logs and traces often contain sensitive data. This server automatically scrubs JWTs, Bearer tokens, emails, credit cards, and password fields before returning data to the LLM (e.g., replacing tokens with `[REDACTED_BEARER]`).
* **Context Window Protection:** Hard caps on log tails (max 500 lines) and trace trees (max 200 spans) prevent "wall of text" context window blowouts. Tools include `grep_pattern` and `since`/`until` parameters so the agent can scrub through time iteratively.
* **Graceful Degradation:** The server catches all API and socket exceptions, returning them as structured text (`isError: true`) rather than crashing the MCP process, allowing the agent to troubleshoot its own connection issues.

## The Tools

This server registers 6 specialized tools with the MCP client:

| Tool | Description |
| :--- | :--- |
| `list_containers` | Discovers local Docker containers by name or status. Essential for agents to map the environment without guessing Compose naming conventions. |
| `get_container_status` | Returns container state, health status, exit codes, and restart loops. |
| `get_container_stats` | Captures CPU, Memory, and I/O snapshots. Flags warnings when memory exceeds 90% to help diagnose `OOMKilled` containers that leave no crash logs. |
| `fetch_logs` | Tails container logs with ANSI stripping. Supports `grep` filtering and time-range navigation (`since`/`until`). |
| `search_error_traces` | Queries Jaeger for traces flagged with errors within a specific timeframe. |
| `get_trace_tree` | Recursively builds and formats a distributed trace into a highly readable, depth-first Markdown list showing span durations and error tags. |

## Installation & Setup

### Prerequisites

* **Node.js**: v22 or higher
* **Docker**: Running locally (Docker Desktop, OrbStack, or Rancher Desktop)
* **Jaeger**: (Optional) Running locally or accessible via HTTP API

### Build Instructions

```bash
# Clone the repository
git clone https://github.com/cruz-andr/otel-server.git
cd otel-server

# Install dependencies
npm install

# Build the TypeScript project
npm run build
```

### Configuration

The server is configured via environment variables. Copy `.env.example` to `.env` or pass them directly through your MCP client.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `DOCKER_SOCKET_PATH` | Path to Docker socket | `/var/run/docker.sock` |
| `JAEGER_BASE_URL` | Jaeger HTTP API url | `http://localhost:16686` |
| `JAEGER_TIMEOUT_MS` | Timeout for Jaeger API requests (ms) | `10000` |
| `MAX_LOG_LINES` | Maximum number of log lines returned | `500` |
| `DEFAULT_LOG_LINES` | Default number of log lines when not specified | `100` |
| `MAX_TRACE_SPANS` | Maximum number of spans in a trace tree | `200` |
| `DEFAULT_LOOKBACK` | Default time window for trace searches | `1h` |
| `REDACT_PATTERNS` | Enable/disable PII scrubbing (set to `"false"` to disable) | `true` |

## Connecting to Claude Code

To use this server with Claude Code, run the following command in your terminal:

```bash
claude mcp add otel-server -- node /absolute/path/to/otel-server/build/index.js
```

(Optional) If you need to override the Docker socket path (e.g., for OrbStack users), pass the environment variable:

```bash
claude mcp add otel-server --env DOCKER_SOCKET_PATH=unix:///Users/yourname/.orbstack/run/docker.sock -- node /absolute/path/to/otel-server/build/index.js
```

## Architecture

This project uses a strict 3-layer architecture to ensure testability and safety:

```
src/
├── clients/                  # Layer 1: Raw I/O & API interaction
│   ├── docker-client.ts
│   └── jaeger-client.ts
├── tools/                    # Layer 2: MCP protocol schemas → client layer
│   ├── list-containers.ts
│   ├── get-container-status.ts
│   ├── get-container-stats.ts
│   ├── fetch-logs.ts
│   ├── search-error-traces.ts
│   └── get-trace-tree.ts
├── formatters/               # Layer 3: Sanitize, strip & wrap data for LLM ingestion
│   ├── xml-output.ts
│   └── ansi.ts
├── redact.ts                 # PII & credential redaction
├── types/                    # Shared type definitions
│   ├── docker.ts
│   └── jaeger.ts
├── config.ts                 # Environment variable loading
└── index.ts                  # Entry point
```

**Clients** (`src/clients/`) handle all raw I/O and API interaction with Docker and Jaeger.

**Tools** (`src/tools/`) connect the MCP protocol schemas to the client layer. Each tool is registered independently with the MCP server.

**Formatters** (`src/formatters/`) are pure functions that sanitize, strip, and wrap data for optimal LLM ingestion. The redaction module (`src/redact.ts`) scrubs PII and credentials from all output.
