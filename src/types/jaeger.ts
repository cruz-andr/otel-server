export interface JaegerKeyValue {
  key: string;
  type: string;
  value: string | number | boolean;
}

export interface JaegerLog {
  timestamp: number;
  fields: JaegerKeyValue[];
}

export interface JaegerSpanReference {
  refType: string;
  traceID: string;
  spanID: string;
}

export interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  startTime: number;
  duration: number;
  tags: JaegerKeyValue[];
  logs: JaegerLog[];
  references: JaegerSpanReference[];
  processID: string;
}

export interface JaegerProcess {
  serviceName: string;
  tags: JaegerKeyValue[];
}

export interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, JaegerProcess>;
}

export interface JaegerSearchResult {
  data: JaegerTrace[];
  errors?: Array<{ code: number; msg: string }>;
}

export interface TraceSummary {
  traceId: string;
  rootService: string;
  rootOperation: string;
  spanCount: number;
  duration: number;
  errorCount: number;
  startTime: number;
}

export interface SpanNode {
  span: JaegerSpan;
  serviceName: string;
  children: SpanNode[];
}

export interface SearchErrorTracesParams {
  service: string;
  lookback?: string;
  limit?: number;
  operation?: string;
  minDuration?: string;
}
