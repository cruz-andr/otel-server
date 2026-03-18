export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
}

export interface ContainerStatus {
  id: string;
  name: string;
  image: string;
  state: string;
  health: string;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  restartCount: number;
  oomKilled: boolean;
  platform: string;
}

export interface ContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
}
