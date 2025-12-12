import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Known app names mapping
const KNOWN_APPS: Record<string, string> = {
  'com.whatsapp': 'WhatsApp',
  'com.instagram.android': 'Instagram',
  'com.facebook.katana': 'Facebook',
  'com.twitter.android': 'Twitter',
  'com.snapchat.android': 'Snapchat',
  'com.spotify.music': 'Spotify',
  'com.netflix.mediaclient': 'Netflix',
  'com.amazon.mShop.android.shopping': 'Amazon Shopping',
  'in.amazon.mShop.android.shopping': 'Amazon India',
  'com.flipkart.android': 'Flipkart',
  'com.ubercab': 'Uber',
  'com.olacabs.customer': 'Ola',
  'com.rapido.passenger': 'Rapido',
  'in.swiggy.android': 'Swiggy',
  'in.swiggy.android.pop': 'Swiggy',
  'com.application.zomato': 'Zomato',
  'com.done.faasos': 'Faasos',
  'net.one97.paytm': 'Paytm',
  'com.phonepe.app': 'PhonePe',
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.linkedin.android': 'LinkedIn',
  'com.slack': 'Slack',
  'com.Slack': 'Slack',
  'com.microsoft.teams': 'Microsoft Teams',
  'com.google.android.youtube': 'YouTube',
  'com.google.android.gm': 'Gmail',
  'com.google.android.apps.maps': 'Google Maps',
  'com.google.android.apps.photos': 'Google Photos',
  'com.brave.browser': 'Brave Browser',
  'org.mozilla.firefox': 'Firefox',
  'com.android.chrome': 'Chrome',
  'com.openai.chatgpt': 'ChatGPT',
  'com.microsoft.office.outlook': 'Outlook',
  'com.google.android.apps.docs': 'Google Docs',
  'com.app.pepperfry': 'Pepperfry',
  'com.urbanladder.catalog': 'Urban Ladder',
  'com.bewakoof.bewakoof': 'Bewakoof',
};

function getReadableName(packageName: string): string {
  // Check known apps first
  if (KNOWN_APPS[packageName]) {
    return KNOWN_APPS[packageName];
  }

  // Extract name from package
  const parts = packageName.split('.');

  // Remove common prefixes
  const skipPrefixes = ['com', 'org', 'net', 'in', 'io', 'me', 'app', 'co'];
  const skipSuffixes = ['android', 'mobile', 'application', 'app', 'apps'];

  let meaningful: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase();

    // Skip common prefixes at start
    if (i === 0 && skipPrefixes.includes(part)) continue;
    // Skip common suffixes at end
    if (i === parts.length - 1 && skipSuffixes.includes(part)) continue;
    // Skip very short generic parts
    if (part.length <= 2 && ['v1', 'v2', 'v3'].includes(part)) continue;

    meaningful.push(parts[i]);
  }

  if (meaningful.length === 0) {
    return packageName;
  }

  // Format: capitalize each part, join with space or keep as is
  // e.g., ['google', 'android', 'videos'] -> 'Google Videos'
  // e.g., ['optum', 'mobile', 'optum', 'stage'] -> 'Optum Stage'

  // Remove duplicates while preserving order
  const seen = new Set<string>();
  const unique = meaningful.filter(p => {
    const lower = p.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  // Take max 3 parts for readable name
  const nameParts = unique.slice(0, 3);

  // Capitalize and join
  const name = nameParts
    .map(p => {
      // Handle camelCase or already capitalized
      if (p.match(/[A-Z]/)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(' ');

  return name || packageName;
}

export interface Device {
  id: string;
  type: 'android' | 'ios';
  name?: string;
  status: 'device' | 'offline' | 'unauthorized';
}

export interface InstalledApp {
  packageName: string;
  name?: string;
}

export async function detectDevices(): Promise<Device[]> {
  const devices: Device[] = [];

  // Detect Android devices
  try {
    const { stdout } = await execAsync('adb devices -l');
    const lines = stdout.trim().split('\n').slice(1); // Skip header

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(/\s+/);
      const id = parts[0];
      const status = parts[1] as Device['status'];

      // Extract device name from model:XXX
      const modelMatch = line.match(/model:(\S+)/);
      const name = modelMatch ? modelMatch[1].replace(/_/g, ' ') : undefined;

      if (id && status) {
        devices.push({
          id,
          type: 'android',
          name,
          status,
        });
      }
    }
  } catch (error) {
    // ADB not installed or no devices
  }

  // Detect iOS devices (if libimobiledevice is installed)
  try {
    const { stdout } = await execAsync('idevice_id -l');
    const ids = stdout.trim().split('\n').filter(Boolean);

    for (const id of ids) {
      // Get device name
      let name: string | undefined;
      try {
        const { stdout: nameOut } = await execAsync(`ideviceinfo -u ${id} -k DeviceName`);
        name = nameOut.trim();
      } catch {}

      devices.push({
        id,
        type: 'ios',
        name,
        status: 'device',
      });
    }
  } catch {
    // libimobiledevice not installed or no devices
  }

  return devices;
}

export async function getInstalledApps(deviceId: string, type: 'android' | 'ios'): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];

  if (type === 'android') {
    try {
      const { stdout } = await execAsync(`adb -s ${deviceId} shell pm list packages -3`);
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const packageName = line.replace('package:', '').trim();
        if (packageName) {
          // Create readable name from package
          const name = getReadableName(packageName);
          apps.push({ packageName, name });
        }
      }

      // Sort by name
      apps.sort((a, b) => (a.name || a.packageName).localeCompare(b.name || b.packageName));
    } catch (error) {
      console.error('Failed to get Android apps:', error);
    }
  } else if (type === 'ios') {
    try {
      const { stdout } = await execAsync(`ideviceinstaller -u ${deviceId} -l`);
      const lines = stdout.trim().split('\n').slice(1); // Skip header

      for (const line of lines) {
        const parts = line.split(',');
        if (parts[0]) {
          apps.push({
            packageName: parts[0].trim(),
            name: parts[1]?.trim(),
          });
        }
      }
    } catch {
      // libimobiledevice not installed
    }
  }

  return apps;
}

export async function getDeviceInfo(deviceId: string, type: 'android' | 'ios') {
  if (type === 'android') {
    try {
      const [model, version, sdk] = await Promise.all([
        execAsync(`adb -s ${deviceId} shell getprop ro.product.model`),
        execAsync(`adb -s ${deviceId} shell getprop ro.build.version.release`),
        execAsync(`adb -s ${deviceId} shell getprop ro.build.version.sdk`),
      ]);

      return {
        model: model.stdout.trim(),
        osVersion: version.stdout.trim(),
        sdkVersion: sdk.stdout.trim(),
      };
    } catch {
      return null;
    }
  }

  return null;
}
