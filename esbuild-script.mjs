// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
/* global process */
/* global console */

import botLayer from '@medplum/bot-layer/package.json' with { type: 'json' };
import esbuild from 'esbuild';
import fastGlob from 'fast-glob';

// Sólo los BOTS se empaquetan, no todo `src/`.
//
// El glob original (`./src/**/*.ts`) metía en el bundle los CLIs (migrate,
// bootstrap, el servidor MCP) y hasta `src/config.ts` del front-end. Eso rompe
// de dos formas:
//   · el servidor MCP arrastra el SDK, que depende de `ajv`, y esbuild no puede
//     resolverlo en formato cjs → el build entero falla;
//   · `config.ts` y `careplan-mapping/deploy.ts` usan `import.meta`, que no
//     existe en cjs → warnings y código que quedaría vacío.
//
// Convención: un bot vive en `src/bots/` o su archivo termina en `-bot.ts`.
// Si se agrega un bot fuera de eso, `deploy-bots.ts` falla al no encontrar su
// `dist/…js`, así que el error salta enseguida.
const entryPoints = fastGlob
  .sync(['./src/bots/**/*.ts', './src/**/*-bot.ts'])
  .filter((file) => !file.endsWith('test.ts'));

const botLayerDeps = Object.keys(botLayer.dependencies);

// Define the esbuild options
const esbuildOptions = {
  entryPoints: entryPoints,
  bundle: true, // Bundle imported functions
  outdir: './dist', // Output directory for compiled files
  platform: 'node', // or 'node', depending on your target platform
  loader: {
    '.ts': 'ts', // Load TypeScript files
  },
  resolveExtensions: ['.ts'],
  external: botLayerDeps,
  format: 'cjs', // Set output format as ECMAScript modules
  target: 'es2020', // Set the target ECMAScript version
  tsconfig: 'tsconfig.json',
  footer: { js: 'Object.assign(exports, module.exports);' }, // Required for VM Context Bots
};

// Build using esbuild
esbuild
  .build(esbuildOptions)
  .then(() => {
    console.log('Build completed successfully!');
  })
  .catch((error) => {
    console.error('Build failed:', JSON.stringify(error, null, 2));
    process.exit(1);
  });
