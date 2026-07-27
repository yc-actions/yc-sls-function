// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

/**
 * CommonJS dependencies in this graph (@yandex-cloud/nodejs-sdk, @grpc/grpc-js,
 * archiver) reference `require`, `__filename`, and `__dirname`, which do not
 * exist in an ES module. Define them from import.meta.url.
 *
 * @grpc/grpc-js additionally resolves `${__dirname}/../../proto` when channelz
 * or ORCA load reporting is enabled. Neither is reachable for a client-only
 * action - channelz.setup() merely registers a callback - so those .proto files
 * are not shipped. With __dirname defined, that path fails as a plain ENOENT if
 * it is ever reached.
 *
 * @yandex-cloud/nodejs-sdk also has a plain `require('./service-endpoints-map.json')`.
 * Rollup has no built-in JSON loader, so without @rollup/plugin-json that require
 * target reaches the parser as raw JSON text and fails to parse as JS.
 */
const banner = [
    "import { createRequire as __createRequire } from 'node:module'",
    "import { dirname as __pathDirname } from 'node:path'",
    "import { fileURLToPath as __fileURLToPath } from 'node:url'",
    'const require = __createRequire(import.meta.url)',
    'const __filename = __fileURLToPath(import.meta.url)',
    'const __dirname = __pathDirname(__filename)'
].join('\n')

const config = {
    input: 'src/index.ts',
    output: {
        banner,
        esModule: true,
        file: 'dist/index.js',
        format: 'es',
        inlineDynamicImports: true,
        sourcemap: true
    },
    plugins: [typescript(), nodeResolve({ preferBuiltins: true }), commonjs(), json()]
}

export default config
