import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';

const execAsync = promisify(exec);

// Frida version to use - MUST match the frida npm package version
const FRIDA_VERSION = '17.0.5';

// Cache directory for frida-server binaries
const CACHE_DIR = path.join(os.homedir(), '.devlens', 'frida');

// Proxy bypass script - hooks Settings.Global.getString to hide proxy
const PROXY_BYPASS_SCRIPT = `
Java.perform(function() {
    try {
        var Settings = Java.use("android.provider.Settings$Global");

        // Hook getString to return null for http_proxy
        Settings.getString.overload('android.content.ContentResolver', 'java.lang.String').implementation = function(resolver, name) {
            if (name === "http_proxy" || name === "global_http_proxy_host" || name === "global_http_proxy_port") {
                // console.log("[DevLens] Bypassing proxy detection for: " + name);
                return null;
            }
            return this.getString(resolver, name);
        };

        // Also hook System.getProperty for Java-level proxy settings
        var System = Java.use("java.lang.System");
        System.getProperty.overload('java.lang.String').implementation = function(key) {
            if (key === "http.proxyHost" || key === "http.proxyPort" ||
                key === "https.proxyHost" || key === "https.proxyPort") {
                return null;
            }
            return this.getProperty(key);
        };

        System.getProperty.overload('java.lang.String', 'java.lang.String').implementation = function(key, def) {
            if (key === "http.proxyHost" || key === "http.proxyPort" ||
                key === "https.proxyHost" || key === "https.proxyPort") {
                return def;
            }
            return this.getProperty(key, def);
        };

        console.log("[DevLens] Proxy bypass enabled!");

    } catch(e) {
        console.log("[DevLens] Could not enable proxy bypass: " + e);
    }
});
`;

interface FridaManager {
  isRunning: boolean;
  deviceId: string | null;
  sessions: Map<string, any>;
}

const state: FridaManager = {
  isRunning: false,
  deviceId: null,
  sessions: new Map(),
};

/**
 * Get the architecture of the connected Android device
 */
async function getDeviceArch(deviceId: string): Promise<string> {
  const { stdout } = await execAsync(`adb -s ${deviceId} shell getprop ro.product.cpu.abi`);
  const abi = stdout.trim();

  // Map Android ABI to Frida architecture
  const archMap: Record<string, string> = {
    'arm64-v8a': 'arm64',
    'armeabi-v7a': 'arm',
    'armeabi': 'arm',
    'x86_64': 'x86_64',
    'x86': 'x86',
  };

  return archMap[abi] || 'arm64';
}

/**
 * Download frida-server binary for the specified architecture
 */
async function downloadFridaServer(arch: string): Promise<string> {
  const fileName = `frida-server-${FRIDA_VERSION}-android-${arch}`;
  const cachedPath = path.join(CACHE_DIR, fileName);

  // Check if already cached
  if (fs.existsSync(cachedPath)) {
    return cachedPath;
  }

  // Create cache directory
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const url = `https://github.com/frida/frida/releases/download/${FRIDA_VERSION}/${fileName}.xz`;
  const xzPath = `${cachedPath}.xz`;

  console.log(`Downloading frida-server for ${arch}...`);

  // Download the .xz file
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(xzPath);

    const request = (url: string) => {
      https.get(url, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          request(response.headers.location!);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        const total = parseInt(response.headers['content-length'] || '0', 10);
        let downloaded = 0;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total > 0) {
            const percent = Math.round((downloaded / total) * 100);
            process.stdout.write(`\rDownloading frida-server... ${percent}%`);
          }
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('\nDownload complete!');
          resolve();
        });
      }).on('error', reject);
    };

    request(url);
  });

  // Extract .xz file
  console.log('Extracting frida-server...');
  await execAsync(`xz -d -k "${xzPath}"`);

  // Rename extracted file
  const extractedPath = xzPath.replace('.xz', '');
  if (extractedPath !== cachedPath) {
    fs.renameSync(extractedPath, cachedPath);
  }

  // Clean up .xz file
  fs.unlinkSync(xzPath);

  // Make executable
  fs.chmodSync(cachedPath, 0o755);

  return cachedPath;
}

/**
 * Push frida-server to device and start it
 */
async function startFridaServer(deviceId: string): Promise<boolean> {
  try {
    // Check if frida-server is already running
    try {
      const { stdout } = await execAsync(`adb -s ${deviceId} shell "pidof frida-server || echo ''"`);
      if (stdout.trim()) {
        console.log('Frida server already running');
        return true;
      }
    } catch {}

    // Get device architecture
    const arch = await getDeviceArch(deviceId);
    console.log(`Device architecture: ${arch}`);

    // Download frida-server if needed
    const fridaPath = await downloadFridaServer(arch);

    // Push to device
    console.log('Pushing frida-server to device...');
    await execAsync(`adb -s ${deviceId} push "${fridaPath}" /data/local/tmp/frida-server`);

    // Make executable
    await execAsync(`adb -s ${deviceId} shell chmod 755 /data/local/tmp/frida-server`);

    // Kill any existing frida-server
    await execAsync(`adb -s ${deviceId} shell "pkill -9 frida-server || true"`).catch(() => {});

    // Start frida-server in background
    console.log('Starting frida-server...');

    // Use spawn to run in background without waiting
    const proc = spawn('adb', ['-s', deviceId, 'shell', '/data/local/tmp/frida-server', '-D'], {
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();

    // Wait a bit for it to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify it's running
    const { stdout } = await execAsync(`adb -s ${deviceId} shell "pidof frida-server || echo ''"`);
    if (!stdout.trim()) {
      console.log('Warning: frida-server may not have started');
      return false;
    }

    console.log('Frida server started successfully!');
    state.isRunning = true;
    state.deviceId = deviceId;
    return true;

  } catch (error) {
    console.error('Failed to start frida-server:', error);
    return false;
  }
}

/**
 * Attach to a running app and inject proxy bypass script
 */
async function injectProxyBypass(deviceId: string, packageName: string): Promise<boolean> {
  try {
    // Dynamic import of frida
    const frida = await import('frida');

    // Get USB device
    const device = await frida.getUsbDevice();

    // Check if app is running
    let pid: number;
    try {
      const processes = await device.enumerateProcesses();
      const proc = processes.find(p => p.name.includes(packageName) || p.name === packageName);
      if (!proc) {
        console.log(`App ${packageName} not running yet`);
        return false;
      }
      pid = proc.pid;
    } catch (e) {
      console.log('Could not enumerate processes:', e);
      return false;
    }

    // Check if already attached
    if (state.sessions.has(packageName)) {
      return true;
    }

    console.log(`Attaching to ${packageName} (PID: ${pid})...`);

    // Attach to process
    const session = await device.attach(pid);

    // Create and load script
    const script = await session.createScript(PROXY_BYPASS_SCRIPT);

    script.message.connect((message: any) => {
      if (message.type === 'send') {
        console.log('[Frida]', message.payload);
      } else if (message.type === 'error') {
        console.error('[Frida Error]', message.stack);
      }
    });

    await script.load();

    state.sessions.set(packageName, { session, script });
    console.log(`Proxy bypass injected for ${packageName}!`);

    return true;

  } catch (error: any) {
    if (error.message?.includes('unable to find process')) {
      // App not running, will retry when it starts
      return false;
    }
    console.error('Failed to inject proxy bypass:', error.message || error);
    return false;
  }
}

/**
 * Stop frida-server and clean up
 */
async function stopFridaServer(deviceId: string): Promise<void> {
  try {
    // Detach all sessions
    for (const [name, { session }] of state.sessions) {
      try {
        await session.detach();
      } catch {}
    }
    state.sessions.clear();

    // Kill frida-server
    await execAsync(`adb -s ${deviceId} shell "pkill -9 frida-server || true"`).catch(() => {});

    state.isRunning = false;
    state.deviceId = null;

    console.log('Frida server stopped');
  } catch (error) {
    // Ignore errors during cleanup
  }
}

/**
 * Setup Frida for a device - downloads, pushes, and starts frida-server
 */
export async function setupFrida(deviceId: string): Promise<boolean> {
  return startFridaServer(deviceId);
}

/**
 * Enable proxy bypass for a specific app
 */
export async function enableProxyBypass(deviceId: string, packageName: string): Promise<boolean> {
  if (!state.isRunning) {
    const started = await setupFrida(deviceId);
    if (!started) return false;
  }

  return injectProxyBypass(deviceId, packageName);
}

/**
 * Cleanup Frida resources
 */
export async function cleanupFrida(deviceId: string): Promise<void> {
  await stopFridaServer(deviceId);
}

/**
 * Check if Frida is currently active
 */
export function isFridaActive(): boolean {
  return state.isRunning;
}
