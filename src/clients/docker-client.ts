import Dockerode from 'dockerode';
import { stripAnsi } from '../formatters/ansi.js';
import type { ContainerSummary, ContainerStatus, ContainerStats } from '../types/docker.js';

export class DockerClient {
  private docker: Dockerode;

  constructor(socketPath: string) {
    this.docker = new Dockerode({ socketPath });
  }

  async listContainers(
    nameFilter?: string,
    status?: string,
  ): Promise<ContainerSummary[]> {
    try {
      const filters: Record<string, string[]> = {};
      if (nameFilter) {
        filters.name = [nameFilter];
      }
      if (status && status !== 'all') {
        filters.status = [status];
      }

      const containers = await this.docker.listContainers({
        all: true,
        filters,
      });

      return containers.map((c) => ({
        id: c.Id.substring(0, 12),
        name: (c.Names[0] ?? '').replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
        created: c.Created,
      }));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getContainerStatus(id: string): Promise<ContainerStatus> {
    try {
      const container = this.docker.getContainer(id);
      const info = await container.inspect();

      return {
        id: info.Id.substring(0, 12),
        name: info.Name.replace(/^\//, ''),
        image: info.Config.Image,
        state: info.State.Status,
        health: info.State.Health?.Status ?? 'none',
        exitCode: info.State.ExitCode,
        startedAt: info.State.StartedAt,
        finishedAt: info.State.FinishedAt,
        restartCount: info.RestartCount,
        oomKilled: info.State.OOMKilled,
        platform: info.Platform,
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async getContainerStats(id: string): Promise<ContainerStats> {
    try {
      const container = this.docker.getContainer(id);
      const stats = (await container.stats({ stream: false })) as unknown as Record<string, unknown>;

      const memoryStats = stats.memory_stats as Record<string, number>;
      const memUsage = memoryStats?.usage ?? 0;
      const memLimit = memoryStats?.limit ?? 1;
      const memPercent = (memUsage / memLimit) * 100;

      const cpuStats = stats.cpu_stats as Record<string, unknown>;
      const preCpuStats = stats.precpu_stats as Record<string, unknown>;
      const cpuPercent = this.calculateCpuPercent(cpuStats, preCpuStats);

      const networks = stats.networks as Record<string, Record<string, number>> | undefined;
      let networkRx = 0;
      let networkTx = 0;
      if (networks) {
        for (const iface of Object.values(networks)) {
          networkRx += iface.rx_bytes ?? 0;
          networkTx += iface.tx_bytes ?? 0;
        }
      }

      const blkioStats = stats.blkio_stats as Record<string, Array<Record<string, unknown>>> | undefined;
      let blockRead = 0;
      let blockWrite = 0;
      const ioEntries = blkioStats?.io_service_bytes_recursive;
      if (Array.isArray(ioEntries)) {
        for (const entry of ioEntries) {
          if (entry.op === 'read' || entry.op === 'Read') blockRead += entry.value as number;
          if (entry.op === 'write' || entry.op === 'Write') blockWrite += entry.value as number;
        }
      }

      const pidsStats = stats.pids_stats as Record<string, number> | undefined;

      const info = await container.inspect();
      const name = info.Name.replace(/^\//, '');

      return {
        id: id.substring(0, 12),
        name,
        cpuPercent,
        memoryUsage: memUsage,
        memoryLimit: memLimit,
        memoryPercent: memPercent,
        networkRx,
        networkTx,
        blockRead,
        blockWrite,
        pids: pidsStats?.current ?? 0,
      };
    } catch (err) {
      throw this.translateError(err);
    }
  }

  async fetchLogs(
    id: string,
    opts: { tail?: number; since?: string; until?: string },
  ): Promise<string[]> {
    try {
      const container = this.docker.getContainer(id);
      const info = await container.inspect();
      const isTty = info.Config.Tty;

      const logOpts: Record<string, unknown> = {
        stdout: true,
        stderr: true,
        tail: opts.tail ?? 100,
        follow: false,
      };

      if (opts.since) {
        logOpts.since = this.parseRelativeTime(opts.since);
      }
      if (opts.until) {
        logOpts.until = this.parseRelativeTime(opts.until);
      }

      const stream = await container.logs(logOpts);
      const buffer = Buffer.isBuffer(stream) ? stream : await this.streamToBuffer(stream as NodeJS.ReadableStream);

      let lines: string[];
      if (isTty) {
        lines = buffer.toString('utf-8').split('\n');
      } else {
        lines = this.demuxDockerStream(buffer);
      }

      return lines.map((line) => stripAnsi(line));
    } catch (err) {
      throw this.translateError(err);
    }
  }

  private calculateCpuPercent(
    cpuStats: Record<string, unknown>,
    preCpuStats: Record<string, unknown>,
  ): number {
    const cpuUsage = cpuStats.cpu_usage as Record<string, number> | undefined;
    const preCpuUsage = preCpuStats.cpu_usage as Record<string, number> | undefined;
    const systemCpu = cpuStats.system_cpu_usage as number | undefined;
    const preSystemCpu = preCpuStats.system_cpu_usage as number | undefined;

    if (!cpuUsage || !preCpuUsage || systemCpu == null || preSystemCpu == null) {
      return 0;
    }

    const cpuDelta = (cpuUsage.total_usage ?? 0) - (preCpuUsage.total_usage ?? 0);
    const systemDelta = systemCpu - preSystemCpu;
    const onlineCpus = (cpuStats.online_cpus as number) ?? 1;

    if (systemDelta <= 0 || cpuDelta < 0) return 0;

    return (cpuDelta / systemDelta) * onlineCpus * 100;
  }

  private demuxDockerStream(buffer: Buffer): string[] {
    const lines: string[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      if (offset + 8 > buffer.length) break;
      const size = buffer.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size > buffer.length) break;
      const chunk = buffer.subarray(offset, offset + size).toString('utf-8');
      lines.push(...chunk.split('\n'));
      offset += size;
    }

    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines;
  }

  private parseRelativeTime(input: string): number {
    const match = input.match(/^(\d+)([smhd])$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
      const seconds = value * (multipliers[unit] ?? 1);
      return Math.floor(Date.now() / 1000) - seconds;
    }
    // Assume Unix timestamp
    const num = parseInt(input, 10);
    return isNaN(num) ? Math.floor(Date.now() / 1000) : num;
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  private translateError(err: unknown): Error {
    const error = err as NodeJS.ErrnoException & { statusCode?: number };
    if (error.code === 'EACCES') {
      return new Error(
        'Permission denied accessing Docker socket. Run with sudo or add your user to the docker group.',
      );
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') {
      return new Error(
        'Cannot connect to Docker daemon. Is Docker running? Check DOCKER_SOCKET_PATH.',
      );
    }
    if (error.statusCode === 404) {
      return new Error('Container not found. Use list_containers to discover available containers.');
    }
    return new Error(error.message ?? String(err));
  }
}
