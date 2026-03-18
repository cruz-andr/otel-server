function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function wrapContainerList(content: string, count: number): string {
  return `<container_list count="${count}">\n${content}\n</container_list>`;
}

export function wrapContainerStatus(content: string, id: string): string {
  return `<container_status id="${escapeXmlAttr(id)}">\n${content}\n</container_status>`;
}

export function wrapContainerStats(content: string, id: string): string {
  return `<container_stats id="${escapeXmlAttr(id)}">\n${content}\n</container_stats>`;
}

export function wrapLogs(content: string, id: string, truncated: boolean): string {
  return `<container_logs id="${escapeXmlAttr(id)}" truncated="${truncated}">\n${content}\n</container_logs>`;
}

export function wrapTraceList(content: string, service: string): string {
  return `<trace_list service="${escapeXmlAttr(service)}">\n${content}\n</trace_list>`;
}

export function wrapTraceTree(content: string, traceId: string): string {
  return `<trace_tree trace_id="${escapeXmlAttr(traceId)}">\n${content}\n</trace_tree>`;
}

export function truncationNotice(shown: number, total: number, hint: string): string {
  return `\n⚠ Showing ${shown} of ${total}. ${hint}`;
}
