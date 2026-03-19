# otel-server — Claude Code Instructions

This project includes the `otel-server` MCP server (auto-connected via `.mcp.json`).
Use these tools for runtime observability of Docker containers and distributed traces.

## Tools

| Tool | When to use |
| :--- | :--- |
| `list_containers` | First step for any container question. Discovers containers by name/status. |
| `get_container_status` | Check health, state, exit codes, restart loops for a specific container. |
| `get_container_stats` | Diagnose resource issues — CPU, memory, I/O. Flags >90% memory usage. |
| `fetch_logs` | Read container logs. Use `grep_pattern` to filter and `since`/`until` for time ranges. |
| `search_error_traces` | Find error traces in Jaeger for a service within a time window. |
| `get_trace_tree` | Drill into a specific trace — shows span hierarchy, durations, and errors. |

## Workflow Patterns

**Container debugging:**
1. `list_containers` — find the container name/ID
2. `get_container_status` — check state, health, exit code
3. `get_container_stats` — check for memory/CPU pressure
4. `fetch_logs` — read recent logs, filter with `grep_pattern` if needed

**Trace investigation:**
1. `search_error_traces` — find error traces for a service
2. `get_trace_tree` — drill into a specific trace ID for span-level detail

## MCP Prompts

Two guided prompts are available:
- **`diagnose_container`** — Step-by-step container health check (pass `container_id`)
- **`investigate_errors`** — Trace-based error investigation (pass `service` name and optional `timeframe`)

## Project Structure

- `src/clients/` — Docker and Jaeger API clients
- `src/tools/` — MCP tool definitions (one file per tool)
- `src/formatters/` — Output sanitization and XML wrapping for LLM safety
- `src/redact.ts` — PII/credential redaction
- `src/config.ts` — Environment variable configuration
