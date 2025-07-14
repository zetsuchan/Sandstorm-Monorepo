#!/usr/bin/env bun
/**
 * @license MIT
 * @copyright 2025 Sandstorm Contributors
 * 
 * Shared build script for all packages using Bun's bundler
 */

import { parseArgs } from "util";

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    entrypoints: {
      type: 'string',
      multiple: true,
      default: ['src/index.ts']
    },
    outdir: {
      type: 'string',
      default: 'dist'
    },
    external: {
      type: 'string',
      multiple: true,
      default: []
    },
    target: {
      type: 'string',
      default: 'bun'
    },
    format: {
      type: 'string',
      default: 'esm'
    }
  },
  strict: true,
  allowPositionals: true,
});

async function build() {
  const entrypoints = values.entrypoints || ['src/index.ts'];
  const outdir = values.outdir || 'dist';
  const external = values.external || [];
  const target = values.target || 'bun';
  const format = values.format || 'esm';

  console.log(`Building with Bun bundler...`);
  console.log(`Entrypoints: ${entrypoints.join(', ')}`);
  console.log(`Output: ${outdir}`);
  console.log(`Target: ${target}`);
  console.log(`Format: ${format}`);

  // Build for both CommonJS and ESM
  const builds = [];

  // ESM build
  if (format === 'esm' || format === 'both') {
    builds.push(
      Bun.build({
        entrypoints,
        outdir,
        target,
        format: 'esm',
        naming: '[dir]/[name].mjs',
        external: [
          ...external,
          '@sandstorm/core',
          'bun',
          'node:*'
        ],
        minify: false,
        splitting: false,
        sourcemap: 'external',
      })
    );
  }

  // CommonJS build
  if (format === 'cjs' || format === 'both') {
    builds.push(
      Bun.build({
        entrypoints,
        outdir,
        target,
        format: 'cjs',
        naming: '[dir]/[name].js',
        external: [
          ...external,
          '@sandstorm/core',
          'bun',
          'node:*'
        ],
        minify: false,
        splitting: false,
        sourcemap: 'external',
      })
    );
  }

  // TypeScript declarations
  // For now, we'll still use tsc for generating .d.ts files
  const tscProcess = Bun.spawn(['bunx', 'tsc', '--emitDeclarationOnly', '--outDir', outdir], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const results = await Promise.all([
    ...builds,
    tscProcess.exited
  ]);

  // Check for build errors
  const buildResults = results.slice(0, -1);
  for (const result of buildResults) {
    if (!result.success) {
      console.error('Build failed:', result.logs);
      process.exit(1);
    }
  }

  const tscExitCode = results[results.length - 1];
  if (tscExitCode !== 0) {
    console.error('TypeScript declaration generation failed');
    process.exit(1);
  }

  console.log('✅ Build completed successfully!');
}

// Run the build
build().catch(error => {
  console.error('Build error:', error);
  process.exit(1);
});