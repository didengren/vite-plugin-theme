import { Plugin, ResolvedConfig } from 'vite';
import path from 'path';
import fs from 'fs-extra';
import { default as Debug } from 'debug';
import { extractVariable, minifyCSS } from './utils';
import { VITE_CLIENT_ENTRY, cssLangRE, cssVariableString, CLIENT_PUBLIC_PATH } from './constants';
import { createFileHash, formatCss } from './utils';
import chalk from 'chalk';
import { injectClientPlugin } from './injectClientPlugin';

export * from '../client/colorUtils';

export { antdDarkThemePlugin } from './antdDarkThemePlugin';

export type ResolveSelector = (selector: string) => string;

export type InjectTo = 'head' | 'body' | 'body-prepend';

export interface ViteThemeOptions {
  isProd: boolean; // 必须传递环境标识
  colorVariables: string[];
  wrapperCssSelector?: string;
  resolveSelector?: ResolveSelector;
  customerExtractVariable?: (code: string) => string;
  fileName?: string;
  injectTo?: InjectTo;
  verbose?: boolean;
  /**
   * 默认值与vite的build.assetsDir一致
   * @default 'assets'
   */
  assetsDir?: string;
}

const debug = Debug('@trinapower/vite-plugin-theme');

export function viteThemePlugin(opt: ViteThemeOptions): Plugin[] {
  let isServer = false;
  let config: ResolvedConfig;
  let clientPath = '';
  const styleMap = new Map<string, string>();

  const extCssSet = new Set<string>();

  const emptyPlugin = {
    name: 'vite:theme',
  } as Plugin;

  const options: ViteThemeOptions = Object.assign(
    {
      isProd: true, // 默认为 true，切换主题只在生产环境生效。
      colorVariables: [],
      wrapperCssSelector: '',
      fileName: 'app-theme-style',
      injectTo: 'body',
      verbose: true,
    },
    opt
  );
  options.assetsDir = options.assetsDir || 'assets';

  debug('plugin options:', options);

  const {
    colorVariables,
    wrapperCssSelector,
    resolveSelector,
    customerExtractVariable,
    fileName,
    verbose,
    assetsDir,
  } = options;

  if (!colorVariables || colorVariables.length === 0) {
    console.error('colorVariables is not empty!');
    return [emptyPlugin];
  }

  const resolveSelectorFn = resolveSelector || ((s: string) => `${wrapperCssSelector} ${s}`);

  const cssOutputName = `${fileName}.${createFileHash()}.css`;

  let needSourcemap = false;
  return [
    injectClientPlugin('colorPlugin', {
      colorPluginCssOutputName: cssOutputName,
      colorPluginOptions: options,
      assetsDir,
    }),
    {
      ...emptyPlugin,
      enforce: options.isProd ? undefined : 'post', // 生产环境不设置 enforce；开发环境设置为 post，切换主题才会都生效。
      config(config) {
        if (config.build) config.build.assetsDir = options.assetsDir;
        return config;
      },
      configResolved(resolvedConfig) {
        config = resolvedConfig;
        isServer = resolvedConfig.command === 'serve';
        clientPath = JSON.stringify(path.posix.join(config.base, CLIENT_PUBLIC_PATH));
        needSourcemap = !!resolvedConfig.build.sourcemap;
        debug('plugin config:', resolvedConfig);
      },

      async transform(code, id) {
        if (!cssLangRE.test(id)) {
          return null;
        }
        const getResult = (content: string) => {
          return {
            map: needSourcemap ? this.getCombinedSourcemap() : null,
            code: content,
          };
        };

        const clientCode = isServer
          ? await getClientStyleString(code)
          : code.replace('export default', '').replace('"', '');

        // Used to extract the relevant color configuration in css, you can pass in the function to override
        const extractCssCodeTemplate =
          typeof customerExtractVariable === 'function'
            ? customerExtractVariable(clientCode)
            : extractVariable(clientCode, colorVariables, resolveSelectorFn);

        debug('extractCssCodeTemplate:', id, extractCssCodeTemplate);

        if (!extractCssCodeTemplate) {
          return null;
        }

        // dev-server
        if (isServer) {
          const retCode = [
            `import { addCssToQueue } from ${clientPath}`,
            `const themeCssId = ${JSON.stringify(id)}`,
            `const themeCssStr = ${JSON.stringify(formatCss(extractCssCodeTemplate))}`,
            `addCssToQueue(themeCssId, themeCssStr)`,
            code,
          ];

          return getResult(retCode.join('\n'));
        } else {
          if (!styleMap.has(id)) {
            extCssSet.add(extractCssCodeTemplate);
          }
          styleMap.set(id, extractCssCodeTemplate);
        }

        return null;
      },

      // @ts-ignore
      async writeBundle() {
        const {
          root,
          build: { outDir, assetsDir, minify },
        } = config;
        let extCssString = '';
        for (const css of extCssSet) {
          extCssString += css;
        }
        if (minify) {
          extCssString = await minifyCSS(extCssString, config);
        }
        const cssOutputPath = path.resolve(root, outDir, assetsDir, cssOutputName);
        fs.mkdirSync(path.dirname(cssOutputPath), { recursive: true });
        fs.writeFileSync(cssOutputPath, extCssString);
      },

      closeBundle() {
        if (verbose && !isServer) {
          const {
            build: { outDir, assetsDir },
          } = config;
          console.log(
            chalk.cyan('\n✨ [vite-plugin-theme]') + ` - extract css code file is successfully:`
          );
          try {
            const { size } = fs.statSync(path.join(outDir, assetsDir, cssOutputName));
            console.log(
              chalk.dim(outDir + '/') +
                chalk.magentaBright(`${assetsDir}/${cssOutputName}`) +
                `\t\t${chalk.dim((size / 1024).toFixed(2) + 'kb')}` +
                '\n'
            );
          // eslint-disable-next-line no-empty, @typescript-eslint/no-unused-vars
          } catch (error) {}
        }
      },
    },
  ];
}

// Intercept the css code embedded in js
async function getClientStyleString(code: string) {
  if (!code.includes(VITE_CLIENT_ENTRY)) {
    return code;
  }
  code = code.replace(/\\n/g, '');
  const cssPrefix = cssVariableString;
  const cssPrefixLen = cssPrefix.length;

  const cssPrefixIndex = code.indexOf(cssPrefix);
  const len = cssPrefixIndex + cssPrefixLen;
  const cssLastIndex = code.indexOf('\n', len + 1);

  if (cssPrefixIndex !== -1) {
    code = code.slice(len, cssLastIndex);
  }
  return code;
}
