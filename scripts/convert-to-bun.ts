#!/usr/bin/env bun
/**
 * Script to convert all packages from tsup to Bun
 */

import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';

const packagesDir = join(import.meta.dir, '..', 'packages');
const adaptersDir = join(packagesDir, 'adapters');
const servicesDir = join(import.meta.dir, '..', 'services');

async function updatePackageJson(filepath: string) {
  const content = await readFile(filepath, 'utf-8');
  const pkg = JSON.parse(content);
  
  // Calculate relative path to scripts
  const depth = filepath.split('/packages/')[1]?.split('/').length - 1 || 0;
  const scriptPath = depth === 2 ? '../../../scripts/build.ts' : '../../scripts/build.ts';
  
  // Update scripts
  if (pkg.scripts) {
    if (pkg.scripts.build === 'tsup') {
      pkg.scripts.build = `bun ${scriptPath} --format both`;
    }
    if (pkg.scripts.dev === 'tsup --watch') {
      pkg.scripts.dev = `bun --watch ${scriptPath} --format both`;
    }
    // Add test script if not present
    if (!pkg.scripts.test) {
      pkg.scripts.test = 'bun test';
    }
  }
  
  // Update devDependencies
  if (pkg.devDependencies) {
    // Remove tsup
    delete pkg.devDependencies.tsup;
    
    // Remove vitest if present
    delete pkg.devDependencies.vitest;
    
    // Add bun-types if not present
    if (!pkg.devDependencies['bun-types']) {
      pkg.devDependencies['bun-types'] = '^1.0.0';
    }
  }
  
  await writeFile(filepath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✅ Updated ${filepath}`);
}

async function removeFile(filepath: string) {
  try {
    await unlink(filepath);
    console.log(`🗑️  Removed ${filepath}`);
  } catch (error) {
    // File doesn't exist, ignore
  }
}

async function processDirectory(dir: string, depth = 0) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Process nested packages (like adapters)
        if (depth === 0 && (entry.name === 'adapters' || await hasPackageJson(fullPath))) {
          await processDirectory(fullPath, depth + 1);
        } else if (depth === 1 && await hasPackageJson(fullPath)) {
          await processPackage(fullPath);
        }
      } else if (depth === 0 && await hasPackageJson(dir)) {
        // Process root level packages
        await processPackage(dir);
        break;
      }
    }
  } catch (error) {
    console.error(`Error processing directory ${dir}:`, error);
  }
}

async function hasPackageJson(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, 'package.json'));
    return true;
  } catch {
    return false;
  }
}

async function processPackage(packageDir: string) {
  console.log(`\n📦 Processing ${packageDir}`);
  
  // Update package.json
  await updatePackageJson(join(packageDir, 'package.json'));
  
  // Remove tsup.config.ts if exists
  await removeFile(join(packageDir, 'tsup.config.ts'));
  
  // Remove vitest.config.ts if exists
  await removeFile(join(packageDir, 'vitest.config.ts'));
}

async function main() {
  console.log('🚀 Converting packages to use Bun...\n');
  
  // Process packages directory
  await processDirectory(packagesDir);
  
  // Process services directory
  // Note: Rust services don't need conversion, but check anyway
  await processDirectory(servicesDir);
  
  console.log('\n✨ Conversion complete!');
  console.log('\nNext steps:');
  console.log('1. Run "bun install" to update dependencies');
  console.log('2. Run "bun run build" to test the build');
  console.log('3. Update CI/CD workflows');
}

main().catch(console.error);