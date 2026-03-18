import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DockerClient } from '../../src/clients/docker-client.js';

// Mock dockerode
vi.mock('dockerode', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      listContainers: vi.fn(),
      getContainer: vi.fn(),
    })),
  };
});

describe('DockerClient', () => {
  let client: DockerClient;
  let mockDocker: {
    listContainers: ReturnType<typeof vi.fn>;
    getContainer: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const Dockerode = (await import('dockerode')).default;
    client = new DockerClient('/var/run/docker.sock');
    // Access the internal docker instance
    mockDocker = (client as unknown as { docker: typeof mockDocker }).docker;
  });

  describe('listContainers', () => {
    it('returns simplified container list', async () => {
      mockDocker.listContainers.mockResolvedValue([
        {
          Id: 'abcdef1234567890',
          Names: ['/my-app'],
          Image: 'node:18',
          State: 'running',
          Status: 'Up 2 hours',
          Created: 1700000000,
        },
      ]);

      const result = await client.listContainers();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'abcdef123456',
        name: 'my-app',
        image: 'node:18',
        state: 'running',
        status: 'Up 2 hours',
        created: 1700000000,
      });
    });

    it('passes name filter to Docker API', async () => {
      mockDocker.listContainers.mockResolvedValue([]);
      await client.listContainers('nginx');
      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { name: ['nginx'] },
      });
    });

    it('passes status filter to Docker API', async () => {
      mockDocker.listContainers.mockResolvedValue([]);
      await client.listContainers(undefined, 'running');
      expect(mockDocker.listContainers).toHaveBeenCalledWith({
        all: true,
        filters: { status: ['running'] },
      });
    });
  });

  describe('getContainerStatus', () => {
    it('maps inspect result to ContainerStatus', async () => {
      const mockContainer = {
        inspect: vi.fn().mockResolvedValue({
          Id: 'abcdef1234567890',
          Name: '/my-app',
          Config: { Image: 'node:18' },
          State: {
            Status: 'running',
            Health: { Status: 'healthy' },
            ExitCode: 0,
            StartedAt: '2024-01-15T10:00:00Z',
            FinishedAt: '0001-01-01T00:00:00Z',
            OOMKilled: false,
          },
          RestartCount: 0,
          Platform: 'linux',
        }),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      const result = await client.getContainerStatus('abcdef123456');
      expect(result.name).toBe('my-app');
      expect(result.state).toBe('running');
      expect(result.health).toBe('healthy');
      expect(result.oomKilled).toBe(false);
    });
  });

  describe('getContainerStats', () => {
    it('parses stats snapshot correctly', async () => {
      const mockContainer = {
        stats: vi.fn().mockResolvedValue({
          memory_stats: { usage: 104857600, limit: 1073741824 },
          cpu_stats: {
            cpu_usage: { total_usage: 5000000000 },
            system_cpu_usage: 20000000000,
            online_cpus: 4,
          },
          precpu_stats: {
            cpu_usage: { total_usage: 4000000000 },
            system_cpu_usage: 19000000000,
          },
          networks: {
            eth0: { rx_bytes: 1024, tx_bytes: 2048 },
          },
          blkio_stats: {
            io_service_bytes_recursive: [
              { op: 'read', value: 4096 },
              { op: 'write', value: 8192 },
            ],
          },
          pids_stats: { current: 15 },
        }),
        inspect: vi.fn().mockResolvedValue({
          Name: '/my-app',
        }),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      const result = await client.getContainerStats('abcdef123456');
      expect(result.name).toBe('my-app');
      expect(result.memoryUsage).toBe(104857600);
      expect(result.memoryLimit).toBe(1073741824);
      expect(result.networkRx).toBe(1024);
      expect(result.networkTx).toBe(2048);
      expect(result.blockRead).toBe(4096);
      expect(result.blockWrite).toBe(8192);
      expect(result.pids).toBe(15);
    });
  });

  describe('error translation', () => {
    it('translates EACCES to permission message', async () => {
      const err = new Error('EACCES') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      mockDocker.listContainers.mockRejectedValue(err);

      await expect(client.listContainers()).rejects.toThrow('Permission denied');
    });

    it('translates ECONNREFUSED to Docker not running', async () => {
      const err = new Error('connect') as NodeJS.ErrnoException;
      err.code = 'ECONNREFUSED';
      mockDocker.listContainers.mockRejectedValue(err);

      await expect(client.listContainers()).rejects.toThrow('Cannot connect to Docker');
    });

    it('translates 404 to container not found', async () => {
      const err = new Error('not found') as NodeJS.ErrnoException & { statusCode?: number };
      err.statusCode = 404;
      const mockContainer = {
        inspect: vi.fn().mockRejectedValue(err),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      await expect(client.getContainerStatus('nonexistent')).rejects.toThrow('Container not found');
    });
  });

  describe('fetchLogs', () => {
    it('handles TTY logs (no demuxing needed)', async () => {
      const logContent = 'line 1\nline 2\nline 3';
      const mockContainer = {
        inspect: vi.fn().mockResolvedValue({ Config: { Tty: true } }),
        logs: vi.fn().mockResolvedValue(Buffer.from(logContent)),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      const result = await client.fetchLogs('abc', { tail: 10 });
      expect(result).toEqual(['line 1', 'line 2', 'line 3']);
    });

    it('handles non-TTY logs with 8-byte header framing', async () => {
      // Build a demuxed buffer: 8-byte header + payload
      const payload = Buffer.from('hello from container');
      const header = Buffer.alloc(8);
      header.writeUInt8(1, 0); // stdout
      header.writeUInt32BE(payload.length, 4);
      const demuxed = Buffer.concat([header, payload]);

      const mockContainer = {
        inspect: vi.fn().mockResolvedValue({ Config: { Tty: false } }),
        logs: vi.fn().mockResolvedValue(demuxed),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      const result = await client.fetchLogs('abc', { tail: 10 });
      expect(result).toContain('hello from container');
    });

    it('strips ANSI codes from logs', async () => {
      const logContent = '\x1b[32mGET\x1b[0m /api';
      const mockContainer = {
        inspect: vi.fn().mockResolvedValue({ Config: { Tty: true } }),
        logs: vi.fn().mockResolvedValue(Buffer.from(logContent)),
      };
      mockDocker.getContainer.mockReturnValue(mockContainer);

      const result = await client.fetchLogs('abc', { tail: 10 });
      expect(result[0]).toBe('GET /api');
    });
  });
});
