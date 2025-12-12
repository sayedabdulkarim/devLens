import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { detectDevices, getInstalledApps, getDeviceInfo } from '../android/devices.js';
import { streamLogs, LogStreamer } from '../android/logs.js';
import { readAllStorage } from '../android/storage.js';
import { readAlliOSStorage } from '../ios/storage.js';
import { getProxyInstance, getProxyCACertPath, NetworkRequest } from '../proxy/server.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

// Track proxy state per device
const proxyState: Map<string, boolean> = new Map();

function getLocalIP(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let io: Server;
let currentLogStreamer: LogStreamer | null = null;

export async function startServer(port: number, openBrowser: boolean = true): Promise<void> {
  const app = express();
  const server = createServer(app);
  io = new Server(server, {
    cors: {
      origin: '*',
    },
  });

  // Serve dashboard
  app.use(express.static(path.join(__dirname, '../../dashboard')));

  // API Routes
  app.get('/api/devices', async (req, res) => {
    const devices = await detectDevices();
    res.json(devices);
  });

  app.get('/api/devices/:id/apps', async (req, res) => {
    const { id } = req.params;
    const type = (req.query.type as 'android' | 'ios') || 'android';
    const apps = await getInstalledApps(id, type);
    res.json(apps);
  });

  app.get('/api/devices/:id/info', async (req, res) => {
    const { id } = req.params;
    const type = (req.query.type as 'android' | 'ios') || 'android';
    const info = await getDeviceInfo(id, type);
    res.json(info);
  });

  // Storage API
  app.get('/api/devices/:id/storage/:packageName', async (req, res) => {
    const { id, packageName } = req.params;
    const type = (req.query.type as 'android' | 'ios') || 'android';

    try {
      if (type === 'android') {
        const storage = await readAllStorage(id, packageName);
        res.json(storage);
      } else {
        const storage = await readAlliOSStorage(id, packageName);
        res.json(storage);
      }
    } catch (error) {
      res.status(500).json({ error: 'Failed to read storage' });
    }
  });

  // CA Certificate endpoint
  app.get('/api/ca-cert', (req, res) => {
    const certPath = getProxyCACertPath();
    if (certPath) {
      res.download(certPath, 'devlens-ca.crt');
    } else {
      res.status(404).json({ error: 'CA certificate not available' });
    }
  });

  app.get('/api/ca-cert/path', (req, res) => {
    const certPath = getProxyCACertPath();
    res.json({ path: certPath });
  });

  // WebSocket
  io.on('connection', (socket) => {
    console.log('Dashboard connected');

    // Start log streaming
    socket.on('start-logs', async ({ deviceId, packageName, deviceType }) => {
      if (currentLogStreamer) {
        currentLogStreamer.stop();
      }

      // Frida bypass disabled (requires root)
      // TODO: Re-enable when root detection is added

      currentLogStreamer = streamLogs(deviceId, packageName);

      currentLogStreamer.on('log', (entry) => {
        socket.emit('log', entry);
      });

      currentLogStreamer.on('error', (error) => {
        socket.emit('log-error', error);
      });

      await currentLogStreamer.start();
    });

    socket.on('stop-logs', () => {
      if (currentLogStreamer) {
        currentLogStreamer.stop();
        currentLogStreamer = null;
      }
    });

    // Fetch storage
    socket.on('get-storage', async ({ deviceId, packageName, type }) => {
      try {
        if (type === 'android') {
          const storage = await readAllStorage(deviceId, packageName);
          socket.emit('storage-data', storage);
        } else {
          const storage = await readAlliOSStorage(deviceId, packageName);
          socket.emit('storage-data', storage);
        }
      } catch (error) {
        socket.emit('storage-error', 'Failed to read storage');
      }
    });

    // Proxy events
    const proxy = getProxyInstance();
    if (proxy) {
      proxy.on('request', (req: NetworkRequest) => {
        socket.emit('network-request', req);
      });

      proxy.on('response', (req: NetworkRequest) => {
        socket.emit('network-response', req);
      });
    }

    // Toggle proxy on/off
    socket.on('toggle-proxy', async ({ deviceId, enabled }) => {
      // Emit loading state immediately
      socket.emit('proxy-loading', { deviceId, loading: true });

      try {
        if (enabled) {
          const ip = getLocalIP();
          await execAsync(`adb -s ${deviceId} shell settings put global http_proxy ${ip}:8080`);
          proxyState.set(deviceId, true);
          socket.emit('proxy-status', { deviceId, enabled: true });
          console.log(`⚠️  Proxy ENABLED on ${deviceId} - Turn OFF before disconnecting USB!`);
        } else {
          await execAsync(`adb -s ${deviceId} shell settings put global http_proxy :0`);
          proxyState.set(deviceId, false);
          socket.emit('proxy-status', { deviceId, enabled: false });
          console.log(`✓ Proxy disabled on ${deviceId} - Safe to disconnect USB`);
        }
      } catch (error) {
        socket.emit('proxy-error', 'Failed to toggle proxy');
      } finally {
        socket.emit('proxy-loading', { deviceId, loading: false });
      }
    });

    // Get current proxy status
    socket.on('get-proxy-status', async ({ deviceId }) => {
      const enabled = proxyState.get(deviceId) || false;
      socket.emit('proxy-status', { deviceId, enabled });
    });

    socket.on('disconnect', () => {
      console.log('Dashboard disconnected');
      if (currentLogStreamer) {
        currentLogStreamer.stop();
        currentLogStreamer = null;
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, async () => {
      if (openBrowser) {
        await open(`http://localhost:${port}`);
      }
      resolve();
    });
  });
}
