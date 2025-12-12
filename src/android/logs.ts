import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export interface LogEntry {
  timestamp: string;
  level: 'VERBOSE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  tag: string;
  message: string;
  pid?: number;
}

export class LogStreamer extends EventEmitter {
  private process: ReturnType<typeof spawn> | null = null;
  private deviceId: string;
  private packageName?: string;

  constructor(deviceId: string, packageName?: string) {
    super();
    this.deviceId = deviceId;
    this.packageName = packageName;
  }

  async start(): Promise<void> {
    // Clear existing logcat
    await execAsync(`adb -s ${this.deviceId} logcat -c`).catch(() => {});

    const args = ['-s', this.deviceId, 'logcat', '-v', 'time'];
    let appPid: string | null = null;

    // If package name specified, filter by PID
    if (this.packageName) {
      try {
        const { stdout } = await execAsync(
          `adb -s ${this.deviceId} shell pidof -s ${this.packageName}`
        );
        appPid = stdout.trim();
        if (appPid) {
          args.push(`--pid=${appPid}`);
        } else {
          // App not running, emit warning
          this.emit('log', {
            timestamp: new Date().toLocaleTimeString(),
            level: 'WARN',
            tag: 'DevLens',
            message: `App "${this.packageName}" is not running. Start the app to see logs.`,
            pid: 0,
          });
        }
      } catch {
        // App not running
        this.emit('log', {
          timestamp: new Date().toLocaleTimeString(),
          level: 'WARN',
          tag: 'DevLens',
          message: `App "${this.packageName}" is not running. Start the app to see logs.`,
          pid: 0,
        });
      }
    }

    // Only start logcat if no specific app selected OR app is running
    if (!this.packageName || appPid) {
      this.process = spawn('adb', args);
    } else {
      // App selected but not running - poll for app start
      this.pollForAppStart();
      return;
    }

    this.process.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const entry = this.parseLine(line);
        if (entry) {
          this.emit('log', entry);
        }
      }
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('error', data.toString());
    });

    this.process.on('close', (code) => {
      this.emit('close', code);
    });
  }

  private pollInterval: ReturnType<typeof setInterval> | null = null;

  private pollForAppStart(): void {
    // Poll every 2 seconds to check if app started
    this.pollInterval = setInterval(async () => {
      if (!this.packageName) return;

      try {
        const { stdout } = await execAsync(
          `adb -s ${this.deviceId} shell pidof -s ${this.packageName}`
        );
        const pid = stdout.trim();

        if (pid) {
          // App started! Clear poll and start logcat
          if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
          }

          this.emit('log', {
            timestamp: new Date().toLocaleTimeString(),
            level: 'INFO',
            tag: 'DevLens',
            message: `App "${this.packageName}" started (PID: ${pid}). Streaming logs...`,
            pid: parseInt(pid),
          });

          // Start logcat with PID filter
          const args = ['-s', this.deviceId, 'logcat', '-v', 'time', `--pid=${pid}`];
          this.process = spawn('adb', args);

          this.process.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              const entry = this.parseLine(line);
              if (entry) {
                this.emit('log', entry);
              }
            }
          });

          this.process.stderr?.on('data', (data: Buffer) => {
            this.emit('error', data.toString());
          });

          this.process.on('close', (code) => {
            this.emit('close', code);
          });
        }
      } catch {
        // App still not running, continue polling
      }
    }, 2000);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private parseLine(line: string): LogEntry | null {
    // Format: MM-DD HH:MM:SS.mmm LEVEL/TAG(PID): MESSAGE
    const regex = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+([VDIWEF])\/([^(]+)\(\s*(\d+)\):\s*(.*)$/;
    const match = line.match(regex);

    if (!match) return null;

    const levelMap: Record<string, LogEntry['level']> = {
      V: 'VERBOSE',
      D: 'DEBUG',
      I: 'INFO',
      W: 'WARN',
      E: 'ERROR',
      F: 'FATAL',
    };

    return {
      timestamp: match[1],
      level: levelMap[match[2]] || 'INFO',
      tag: match[3].trim(),
      pid: parseInt(match[4]),
      message: match[5],
    };
  }
}

export function streamLogs(deviceId: string, packageName?: string): LogStreamer {
  return new LogStreamer(deviceId, packageName);
}
