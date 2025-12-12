import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist',
  },
  {
    entry: ['src/bin/cli.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'node18',
    outDir: 'dist/bin',
  },
]);
