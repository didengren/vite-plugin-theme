import { defineConfig } from 'tsup';

export default defineConfig(() => ({
  entry: ['src/index.ts'],
  dts: true,
  format: ['cjs', 'esm', 'iife'],
  target: 'esnext',
  esbuildOptions: (options) => {
    options.external = ['path', 'fs', 'fs-extra', 'os', 'lightningcss'];
    options.platform = 'node';
  },
}));
