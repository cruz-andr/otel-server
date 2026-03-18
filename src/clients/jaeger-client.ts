import type {
  JaegerSearchResult,
  JaegerTrace,
  TraceSummary,
  SearchErrorTracesParams,
  SpanNode,
} from '../types/jaeger.js';

export class JaegerClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async searchErrorTraces(params: SearchErrorTracesParams): Promise<TraceSummary[]> {
    const url = new URL(`${this.baseUrl}/api/traces`);
    url.searchParams.set('service', params.service);
    url.searchParams.set('tags', JSON.stringify({ error: 'true' }));
    url.searchParams.set('lookback', params.lookback ?? '1h');
    url.searchParams.set('limit', String(params.limit ?? 20));

    if (params.operation) {
      url.searchParams.set('operation', params.operation);
    }
    if (params.minDuration) {
      url.searchParams.set('minDuration', params.minDuration);
    }

    const data = await this.fetchJson<JaegerSearchResult>(url.toString());

    if (!data.data || data.data.length === 0) {
      return [];
    }

    return data.data.map((trace) => this.summarizeTrace(trace));
  }

  async getTrace(traceId: string): Promise<JaegerTrace> {
    const url = `${this.baseUrl}/api/traces/${encodeURIComponent(traceId)}`;
    const data = await this.fetchJson<JaegerSearchResult>(url);

    if (!data.data || data.data.length === 0) {
      throw new Error(`Trace ${traceId} not found. It may have expired or the ID may be incorrect.`);
    }

    return data.data[0];
  }

  buildSpanTree(trace: JaegerTrace): SpanNode[] {
    const spanMap = new Map<string, SpanNode>();

    // Create nodes for all spans
    for (const span of trace.spans) {
      const process = trace.processes[span.processID];
      spanMap.set(span.spanID, {
        span,
        serviceName: process?.serviceName ?? 'unknown',
        children: [],
      });
    }

    const roots: SpanNode[] = [];

    // Build tree from CHILD_OF references
    for (const span of trace.spans) {
      const node = spanMap.get(span.spanID)!;
      const parentRef = span.references.find((r) => r.refType === 'CHILD_OF');

      if (parentRef) {
        const parent = spanMap.get(parentRef.spanID);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    // Sort children by start time
    const sortChildren = (node: SpanNode): void => {
      node.children.sort((a, b) => a.span.startTime - b.span.startTime);
      node.children.forEach(sortChildren);
    };
    roots.sort((a, b) => a.span.startTime - b.span.startTime);
    roots.forEach(sortChildren);

    return roots;
  }

  private summarizeTrace(trace: JaegerTrace): TraceSummary {
    const spans = trace.spans;
    const rootSpan = spans.reduce((earliest, span) =>
      span.startTime < earliest.startTime ? span : earliest
    );

    const rootProcess = trace.processes[rootSpan.processID];
    const errorCount = spans.filter((s) =>
      s.tags.some((t) => t.key === 'error' && (t.value === true || t.value === 'true'))
    ).length;

    const endTimes = spans.map((s) => s.startTime + s.duration);
    const totalDuration = Math.max(...endTimes) - rootSpan.startTime;

    return {
      traceId: trace.traceID,
      rootService: rootProcess?.serviceName ?? 'unknown',
      rootOperation: rootSpan.operationName,
      spanCount: spans.length,
      duration: totalDuration,
      errorCount,
      startTime: rootSpan.startTime,
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Jaeger returned HTTP ${response.status}: ${response.statusText}`);
      }
      return (await response.json()) as T;
    } catch (err) {
      const error = err as Error;
      if (error.name === 'AbortError') {
        throw new Error(
          `Jaeger request timed out after ${this.timeoutMs}ms. Check JAEGER_BASE_URL and ensure Jaeger is accessible.`,
        );
      }
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED')) {
        throw new Error(
          `Cannot connect to Jaeger at ${this.baseUrl}. Is Jaeger running? Check JAEGER_BASE_URL.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
