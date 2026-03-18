import { describe, it, expect } from 'vitest';
import {
  wrapContainerList,
  wrapContainerStatus,
  wrapContainerStats,
  wrapLogs,
  wrapTraceList,
  wrapTraceTree,
  truncationNotice,
} from '../../src/formatters/xml-output.js';

describe('xml-output', () => {
  it('wraps container list with count', () => {
    const result = wrapContainerList('content', 3);
    expect(result).toBe('<container_list count="3">\ncontent\n</container_list>');
  });

  it('wraps container status with id', () => {
    const result = wrapContainerStatus('content', 'abc123');
    expect(result).toBe('<container_status id="abc123">\ncontent\n</container_status>');
  });

  it('wraps container stats with id', () => {
    const result = wrapContainerStats('content', 'abc123');
    expect(result).toBe('<container_stats id="abc123">\ncontent\n</container_stats>');
  });

  it('wraps logs with id and truncated flag', () => {
    const result = wrapLogs('log lines', 'abc123', true);
    expect(result).toBe('<container_logs id="abc123" truncated="true">\nlog lines\n</container_logs>');
  });

  it('wraps trace list with service', () => {
    const result = wrapTraceList('traces', 'my-service');
    expect(result).toBe('<trace_list service="my-service">\ntraces\n</trace_list>');
  });

  it('wraps trace tree with trace id', () => {
    const result = wrapTraceTree('tree', 'abc123def456');
    expect(result).toBe('<trace_tree trace_id="abc123def456">\ntree\n</trace_tree>');
  });

  it('escapes XML special characters in attributes', () => {
    const result = wrapContainerStatus('content', 'id<with>"special&chars');
    expect(result).toContain('id="id&lt;with&gt;&quot;special&amp;chars"');
  });

  it('generates truncation notice', () => {
    const result = truncationNotice(100, 500, 'Use grep_pattern to filter.');
    expect(result).toContain('Showing 100 of 500');
    expect(result).toContain('Use grep_pattern to filter.');
  });
});
