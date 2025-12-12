#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { startServer } from '../server/index.js';
import { detectDevices, Device } from '../android/devices.js';
import { startProxy } from '../proxy/server.js';

const execAsync = promisify(exec);

// Track connected devices for cleanup
let connectedDevices: Device[] = [];

const program = new Command();

program
  .name('devlens')
  .description('Debug any mobile app - logs, network, storage. No SDK required.')
  .version('0.0.1');

program
  .option('-p, --port <port>', 'Dashboard port', '3000')
  .option('--proxy-port <port>', 'Proxy port', '8080')
  .option('--no-open', 'Do not open browser automatically')
  .action(async (options) => {
    console.log(chalk.cyan(`
    ██████╗ ███████╗██╗   ██╗██╗     ███████╗███╗   ██╗███████╗
    ██╔══██╗██╔════╝██║   ██║██║     ██╔════╝████╗  ██║██╔════╝
    ██║  ██║█████╗  ██║   ██║██║     █████╗  ██╔██╗ ██║███████╗
    ██║  ██║██╔══╝  ╚██╗ ██╔╝██║     ██╔══╝  ██║╚██╗██║╚════██║
    ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗██║ ╚████║███████║
    ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝╚═╝  ╚═══╝╚══════╝
    `));
    console.log(chalk.gray('                                        by Sayed Abdul Karim\n'));

    const spinner = ora('Starting DevLens...').start();

    try {
      // Start proxy server
      spinner.text = 'Starting proxy server...';
      await startProxy(parseInt(options.proxyPort));
      spinner.succeed(`Proxy started on port ${options.proxyPort}`);

      // Detect devices
      spinner.start('Detecting devices...');
      const devices = await detectDevices();
      connectedDevices = devices;

      if (devices.length > 0) {
        spinner.succeed(`Found ${devices.length} device(s)`);
        devices.forEach(d => console.log(chalk.green(`  • ${d.id} (${d.type})`)));

        // Auto-setup proxy on Android devices
        const localIP = getLocalIP();
        const proxyPort = options.proxyPort;

        for (const device of devices) {
          if (device.type === 'android' && device.status === 'device') {
            // Clean up any leftover proxy from previous session
            try {
              await execAsync(`adb -s ${device.id} shell settings put global http_proxy :0`);
            } catch {}

            // Kill any leftover frida-server
            try {
              await execAsync(`adb -s ${device.id} shell pkill -9 frida-server`);
            } catch {}

            spinner.succeed(`Logs enabled on ${device.id}`);
            console.log(chalk.yellow(`      Network capture: Toggle from dashboard`));
          }
        }
      } else {
        spinner.warn('No devices connected. Connect a device via USB.');
      }

      // Start dashboard server
      spinner.start('Starting dashboard...');
      await startServer(parseInt(options.port), options.open);
      spinner.succeed(`Dashboard running at ${chalk.cyan(`http://localhost:${options.port}`)}`);

      console.log(chalk.green('\n✓ Ready! Network capture is automatic.'));
      console.log(chalk.gray('   Press Ctrl+C to stop\n'));

      // Setup cleanup on exit
      setupCleanup();

    } catch (error) {
      spinner.fail('Failed to start DevLens');
      console.error(chalk.red(error));
      process.exit(1);
    }
  });

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

async function setupDeviceProxy(deviceId: string, ip: string, port: string): Promise<void> {
  // Set global proxy on device - that's it, no certificate needed
  await execAsync(`adb -s ${deviceId} shell settings put global http_proxy ${ip}:${port}`);
}

async function cleanupDeviceProxy(deviceId: string): Promise<void> {
  try {
    // Remove proxy setting
    await execAsync(`adb -s ${deviceId} shell settings put global http_proxy :0`);
  } catch {
    // Device may be disconnected
  }
}

function setupCleanup(): void {
  let isCleaningUp = false;

  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    console.log(chalk.yellow('\n\nCleaning up...'));

    // Remove proxy from all devices
    for (const device of connectedDevices) {
      if (device.type === 'android') {
        await cleanupDeviceProxy(device.id);
      }
    }

    console.log(chalk.green('Proxy removed. Safe to disconnect USB!'));
    process.exit(0);
  };

  // Handle all possible exit scenarios
  process.on('SIGINT', cleanup);  // Ctrl+C
  process.on('SIGTERM', cleanup); // kill command
  process.on('SIGHUP', cleanup);  // terminal closed
  process.on('exit', cleanup);    // normal exit
  process.on('uncaughtException', async (err) => {
    console.error(chalk.red('Error:'), err.message);
    await cleanup();
  });
  process.on('unhandledRejection', async (err) => {
    console.error(chalk.red('Error:'), err);
    await cleanup();
  });
}

program.parse();
