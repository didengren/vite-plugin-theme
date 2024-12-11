import type { BuildOptions } from 'esbuild';
import type { Format } from 'tsup';
import { defineConfig } from 'tsup';

export default defineConfig(() => ({
  entry: ['src/index.ts'],
  dts: true,
  format: ['cjs', 'esm', 'iife'],
  target: 'esnext',
  esbuildOptions: (options: BuildOptions, context: { format: Format }) => {
    options.external = ['path', 'fs', 'fs-extra', 'os', 'lightningcss'];
    options.platform = 'node';
    if (context.format === "esm") {
      options.banner = {
        // https://github.com/egoist/tsup/discussions/505
        js: `import {createRequire as __createRequire} from 'module';var require=__createRequire(import.meta.url);`,
      };
    }
  },
}));
