import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface iOSDevice {
  id: string;
  name: string;
  type: 'ios';
  status: 'device';
}

export async function detectiOSDevices(): Promise<iOSDevice[]> {
  const devices: iOSDevice[] = [];

  try {
    const { stdout } = await execAsync('idevice_id -l');
    const ids = stdout.trim().split('\n').filter(Boolean);

    for (const id of ids) {
      let name = id;
      try {
        const { stdout: nameOut } = await execAsync(`ideviceinfo -u ${id} -k DeviceName`);
        name = nameOut.trim();
      } catch {}

      devices.push({
        id,
        name,
        type: 'ios',
        status: 'device',
      });
    }
  } catch {
    // libimobiledevice not installed
  }

  return devices;
}

export async function getiOSApps(deviceId: string): Promise<{ bundleId: string; name: string }[]> {
  const apps: { bundleId: string; name: string }[] = [];

  try {
    const { stdout } = await execAsync(`ideviceinstaller -u ${deviceId} -l`);
    const lines = stdout.trim().split('\n').slice(1);

    for (const line of lines) {
      const match = line.match(/^(\S+)\s*,\s*"?([^"]+)"?/);
      if (match) {
        apps.push({
          bundleId: match[1],
          name: match[2],
        });
      }
    }
  } catch {}

  return apps;
}
