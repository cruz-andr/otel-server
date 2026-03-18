import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JaegerClient } from '../../src/clients/jaeger-client.js';

describe('JaegerClient', () => {
  let client: JaegerClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new JaegerClient('http://localhost:16686', 5000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('searchErrorTraces', () => {
    it('returns trace summaries on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                traceID: 'abc123',
                spans: [
                  {
                    traceID: 'abc123',
                    spanID: 'span1',
                    operationName: 'HTTP GET',
                    startTime: 1700000000000,
                    duration: 150000,
                    tags: [{ key: 'error', type: 'bool', value: true }],
                    logs: [],
                    references: [],
                    processID: 'p1',
                  },
                ],
                processes: {
                  p1: { serviceName: 'checkout', tags: [] },
                },
              },
            ],
          }),
      });

      const result = await client.searchErrorTraces({ service: 'checkout' });
      expect(result).toHaveLength(1);
      expect(result[0].traceId).toBe('abc123');
      expect(result[0].rootService).toBe('checkout');
      expect(result[0].errorCount).toBe(1);
    });

    it('returns empty array when no traces found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await client.searchErrorTraces({ service: 'unknown' });
      expect(result).toEqual([]);
    });

    it('throws on timeout', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

      await expect(client.searchErrorTraces({ service: 'test' })).rejects.toThrow('timed out');
    });

    it('throws on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

      await expect(client.searchErrorTraces({ service: 'test' })).rejects.toThrow(
        'Cannot connect to Jaeger',
      );
    });
  });

  describe('getTrace', () => {
    it('returns trace on success', async () => {
      const trace = {
        traceID: 'abc123',
        spans: [
          {
            traceID: 'abc123',
            spanID: 'span1',
            operationName: 'GET /api',
            startTime: 1700000000000,
            duration: 50000,
            tags: [],
            logs: [],
            references: [],
            processID: 'p1',
          },
        ],
        processes: { p1: { serviceName: 'api', tags: [] } },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [trace] }),
      });

      const result = await client.getTrace('abc123');
      expect(result.traceID).toBe('abc123');
    });

    it('throws when trace not found', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      await expect(client.getTrace('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('buildSpanTree', () => {
    it('builds tree from parent references', () => {
      const trace = {
        traceID: 'abc123',
        spans: [
          {
            traceID: 'abc123',
            spanID: 'root',
            operationName: 'GET /api',
            startTime: 1000,
            duration: 500,
            tags: [],
            logs: [],
            references: [],
            processID: 'p1',
          },
          {
            traceID: 'abc123',
            spanID: 'child1',
            operationName: 'DB query',
            startTime: 1100,
            duration: 200,
            tags: [],
            logs: [],
            references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 'root' }],
            processID: 'p2',
          },
          {
            traceID: 'abc123',
            spanID: 'child2',
            operationName: 'cache lookup',
            startTime: 1050,
            duration: 30,
            tags: [],
            logs: [],
            references: [{ refType: 'CHILD_OF', traceID: 'abc123', spanID: 'root' }],
            processID: 'p1',
          },
        ],
        processes: {
          p1: { serviceName: 'api', tags: [] },
          p2: { serviceName: 'db', tags: [] },
        },
      };

      const roots = client.buildSpanTree(trace);
      expect(roots).toHaveLength(1);
      expect(roots[0].span.spanID).toBe('root');
      expect(roots[0].children).toHaveLength(2);
      // Children sorted by startTime
      expect(roots[0].children[0].span.spanID).toBe('child2');
      expect(roots[0].children[1].span.spanID).toBe('child1');
    });
  });
});
