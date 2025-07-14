#!/usr/bin/env bun

import { readFile, writeFile } from 'fs/promises';
import { glob } from 'glob';

async function cleanupPackage(filepath: string) {
  console.log(`Cleaning up ${filepath}`);
  
  const content = await readFile(filepath, 'utf-8');
  const pkg = JSON.parse(content);
  
  let modified = false;
  
  // Remove tsup from devDependencies
  if (pkg.devDependencies?.tsup) {
    delete pkg.devDependencies.tsup;
    modified = true;
  }
  
  // Remove vitest from devDependencies and update test scripts
  if (pkg.devDependencies?.vitest) {
    delete pkg.devDependencies.vitest;
    modified = true;
  }
  
  // Update test scripts that use vitest
  if (pkg.scripts?.test === 'vitest' || pkg.scripts?.test === 'vitest run') {
    pkg.scripts.test = 'bun test';
    modified = true;
  }
  if (pkg.scripts?.['test:watch'] === 'vitest') {
    pkg.scripts['test:watch'] = 'bun test --watch';
    modified = true;
  }
  
  // Add bun-types if not present
  if (pkg.devDependencies && !pkg.devDependencies['bun-types']) {
    pkg.devDependencies['bun-types'] = '^1.0.0';
    modified = true;
  }
  
  // Update tsx scripts to use bun
  if (pkg.scripts?.train && pkg.scripts.train.includes('tsx')) {
    pkg.scripts.train = pkg.scripts.train.replace('tsx', 'bun');
    modified = true;
  }
  if (pkg.scripts?.evaluate && pkg.scripts.evaluate.includes('tsx')) {
    pkg.scripts.evaluate = pkg.scripts.evaluate.replace('tsx', 'bun');
    modified = true;
  }
  
  // Remove tsx from devDependencies
  if (pkg.devDependencies?.tsx) {
    delete pkg.devDependencies.tsx;
    modified = true;
  }
  
  if (modified) {
    await writeFile(filepath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Updated ${filepath}`);
  } else {
    console.log(`✓ No changes needed for ${filepath}`);
  }
}

async function main() {
  const packageFiles = await glob('packages/**/package.json', {
    ignore: ['**/node_modules/**']
  });
  
  for (const file of packageFiles) {
    await cleanupPackage(file);
  }
  
  console.log('\n✨ Cleanup complete!');
}

main().catch(console.error);