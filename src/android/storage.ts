import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface StorageItem {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}

export interface StorageData {
  sharedPreferences: Record<string, StorageItem[]>;
  asyncStorage: StorageItem[];
}

/**
 * Read SharedPreferences for a debuggable app
 * Only works for debug builds with android:debuggable="true"
 */
export async function readSharedPreferences(
  deviceId: string,
  packageName: string
): Promise<Record<string, StorageItem[]>> {
  const result: Record<string, StorageItem[]> = {};

  try {
    // List SharedPreferences files
    const { stdout: fileList } = await execAsync(
      `adb -s ${deviceId} shell run-as ${packageName} ls shared_prefs/ 2>/dev/null || echo ""`
    );

    const files = fileList.trim().split('\n').filter(f => f.endsWith('.xml'));

    for (const file of files) {
      const prefName = file.replace('.xml', '');
      try {
        const { stdout: content } = await execAsync(
          `adb -s ${deviceId} shell run-as ${packageName} cat shared_prefs/${file}`
        );

        const items = parseSharedPrefsXml(content);
        if (items.length > 0) {
          result[prefName] = items;
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch (error) {
    // App might not be debuggable or doesn't exist
  }

  return result;
}

/**
 * Read AsyncStorage for React Native apps
 */
export async function readAsyncStorage(
  deviceId: string,
  packageName: string
): Promise<StorageItem[]> {
  const items: StorageItem[] = [];

  try {
    // React Native AsyncStorage uses SQLite
    const dbPath = `databases/RKStorage`;

    // Try to read the database
    const { stdout } = await execAsync(
      `adb -s ${deviceId} shell run-as ${packageName} sqlite3 ${dbPath} "SELECT key, value FROM catalystLocalStorage;" 2>/dev/null || echo ""`
    );

    const lines = stdout.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const [key, ...valueParts] = line.split('|');
      const value = valueParts.join('|');

      if (key) {
        items.push({
          key,
          value,
          type: detectValueType(value),
        });
      }
    }
  } catch {
    // AsyncStorage not available or app not debuggable
  }

  // Also try MMKV storage (popular alternative)
  try {
    const { stdout: mmkvFiles } = await execAsync(
      `adb -s ${deviceId} shell run-as ${packageName} ls files/mmkv/ 2>/dev/null || echo ""`
    );

    if (mmkvFiles.trim()) {
      items.push({
        key: '__mmkv_detected__',
        value: 'MMKV storage detected but binary format not supported',
        type: 'string',
      });
    }
  } catch {
    // MMKV not present
  }

  return items;
}

/**
 * Read all storage data for an app
 */
export async function readAllStorage(
  deviceId: string,
  packageName: string
): Promise<StorageData> {
  const [sharedPreferences, asyncStorage] = await Promise.all([
    readSharedPreferences(deviceId, packageName),
    readAsyncStorage(deviceId, packageName),
  ]);

  return { sharedPreferences, asyncStorage };
}

/**
 * Parse Android SharedPreferences XML format
 */
function parseSharedPrefsXml(xml: string): StorageItem[] {
  const items: StorageItem[] = [];

  // Match string values
  const stringMatches = xml.matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g);
  for (const match of stringMatches) {
    items.push({ key: match[1], value: match[2], type: 'string' });
  }

  // Match int values
  const intMatches = xml.matchAll(/<int name="([^"]+)" value="([^"]+)" \/>/g);
  for (const match of intMatches) {
    items.push({ key: match[1], value: match[2], type: 'number' });
  }

  // Match long values
  const longMatches = xml.matchAll(/<long name="([^"]+)" value="([^"]+)" \/>/g);
  for (const match of longMatches) {
    items.push({ key: match[1], value: match[2], type: 'number' });
  }

  // Match float values
  const floatMatches = xml.matchAll(/<float name="([^"]+)" value="([^"]+)" \/>/g);
  for (const match of floatMatches) {
    items.push({ key: match[1], value: match[2], type: 'number' });
  }

  // Match boolean values
  const boolMatches = xml.matchAll(/<boolean name="([^"]+)" value="([^"]+)" \/>/g);
  for (const match of boolMatches) {
    items.push({ key: match[1], value: match[2], type: 'boolean' });
  }

  // Match set values
  const setMatches = xml.matchAll(/<set name="([^"]+)">([\s\S]*?)<\/set>/g);
  for (const match of setMatches) {
    const setValues = match[2].match(/<string>([^<]*)<\/string>/g);
    if (setValues) {
      const values = setValues.map(s => s.replace(/<\/?string>/g, ''));
      items.push({ key: match[1], value: JSON.stringify(values), type: 'array' });
    }
  }

  return items;
}

/**
 * Detect the type of a string value
 */
function detectValueType(value: string): StorageItem['type'] {
  if (value === 'true' || value === 'false') {
    return 'boolean';
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return 'number';
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return 'array';
    }
    if (typeof parsed === 'object') {
      return 'object';
    }
  } catch {
    // Not JSON
  }

  return 'string';
}
