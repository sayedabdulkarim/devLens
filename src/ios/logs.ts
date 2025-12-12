import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export interface iOSLogEntry {
  timestamp: string;
  process: string;
  message: string;
}

export class iOSLogStreamer extends EventEmitter {
  private process: ReturnType<typeof spawn> | null = null;
  private deviceId: string;

  constructor(deviceId: string) {
    super();
    this.deviceId = deviceId;
  }

  start(): void {
    this.process = spawn('idevicesyslog', ['-u', this.deviceId]);

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

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private parseLine(line: string): iOSLogEntry | null {
    // Format: Mon DD HH:MM:SS DeviceName ProcessName[PID]: Message
    const regex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+\S+\s+(\S+)\[\d+\]:\s*(.*)$/;
    const match = line.match(regex);

    if (!match) return null;

    return {
      timestamp: match[1],
      process: match[2],
      message: match[3],
    };
  }
}

export function streamiOSLogs(deviceId: string): iOSLogStreamer {
  return new iOSLogStreamer(deviceId);
}
