import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

export interface iOSStorageItem {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'data';
}

export interface iOSStorageData {
  userDefaults: iOSStorageItem[];
  asyncStorage: iOSStorageItem[];
  keychain: iOSStorageItem[];
}

/**
 * Read UserDefaults for an iOS app
 * Requires the app to be debuggable and ifuse to be installed
 */
export async function readUserDefaults(
  deviceId: string,
  bundleId: string
): Promise<iOSStorageItem[]> {
  const items: iOSStorageItem[] = [];
  const mountPoint = path.join(os.tmpdir(), `devlens-${deviceId}-${Date.now()}`);

  try {
    // Create mount point
    fs.mkdirSync(mountPoint, { recursive: true });

    // Mount app container using ifuse
    await execAsync(
      `ifuse --udid ${deviceId} --container ${bundleId} "${mountPoint}" 2>/dev/null`
    );

    // Look for plist files in Library/Preferences
    const prefsPath = path.join(mountPoint, 'Library', 'Preferences');

    if (fs.existsSync(prefsPath)) {
      const files = fs.readdirSync(prefsPath).filter(f => f.endsWith('.plist'));

      for (const file of files) {
        const plistPath = path.join(prefsPath, file);
        try {
          // Convert plist to JSON using plutil
          const { stdout } = await execAsync(
            `plutil -convert json -o - "${plistPath}" 2>/dev/null`
          );

          const data = JSON.parse(stdout);
          for (const [key, value] of Object.entries(data)) {
            items.push({
              key,
              value: typeof value === 'object' ? JSON.stringify(value) : String(value),
              type: detectValueType(value),
            });
          }
        } catch {
          // Skip files we can't parse
        }
      }
    }

    // Unmount
    await execAsync(`umount "${mountPoint}" 2>/dev/null || fusermount -u "${mountPoint}" 2>/dev/null`).catch(() => {});
  } catch (error) {
    // ifuse not installed or app not accessible
  } finally {
    // Cleanup mount point
    try {
      fs.rmdirSync(mountPoint);
    } catch {}
  }

  return items;
}

/**
 * Read AsyncStorage for React Native iOS apps
 */
export async function readiOSAsyncStorage(
  deviceId: string,
  bundleId: string
): Promise<iOSStorageItem[]> {
  const items: iOSStorageItem[] = [];
  const mountPoint = path.join(os.tmpdir(), `devlens-${deviceId}-${Date.now()}`);

  try {
    fs.mkdirSync(mountPoint, { recursive: true });

    await execAsync(
      `ifuse --udid ${deviceId} --container ${bundleId} "${mountPoint}" 2>/dev/null`
    );

    // React Native AsyncStorage on iOS uses SQLite
    const dbPath = path.join(mountPoint, 'Documents', 'RCTAsyncLocalStorage_V1');

    if (fs.existsSync(dbPath)) {
      // Find the manifest file
      const manifestPath = path.join(dbPath, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        for (const [key, value] of Object.entries(manifest)) {
          items.push({
            key,
            value: String(value),
            type: detectValueType(value),
          });
        }
      }
    }

    await execAsync(`umount "${mountPoint}" 2>/dev/null || fusermount -u "${mountPoint}" 2>/dev/null`).catch(() => {});
  } catch {
    // Not accessible
  } finally {
    try {
      fs.rmdirSync(mountPoint);
    } catch {}
  }

  return items;
}

/**
 * Read Keychain items (limited, requires special entitlements)
 */
export async function readKeychain(
  deviceId: string,
  bundleId: string
): Promise<iOSStorageItem[]> {
  // Keychain access is very restricted
  // This is a placeholder - real keychain access requires jailbreak or special entitlements
  return [
    {
      key: '__keychain_notice__',
      value: 'Keychain access requires jailbreak or special entitlements',
      type: 'string',
    },
  ];
}

/**
 * Read all iOS storage for an app
 */
export async function readAlliOSStorage(
  deviceId: string,
  bundleId: string
): Promise<iOSStorageData> {
  const [userDefaults, asyncStorage, keychain] = await Promise.all([
    readUserDefaults(deviceId, bundleId),
    readiOSAsyncStorage(deviceId, bundleId),
    readKeychain(deviceId, bundleId),
  ]);

  return { userDefaults, asyncStorage, keychain };
}

function detectValueType(value: unknown): iOSStorageItem['type'] {
  if (typeof value === 'boolean') {
    return 'boolean';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'object' && value !== null) {
    return 'object';
  }

  if (typeof value === 'string') {
    // Check if it's base64 data
    if (/^[A-Za-z0-9+/=]{20,}$/.test(value)) {
      return 'data';
    }
  }

  return 'string';
}
