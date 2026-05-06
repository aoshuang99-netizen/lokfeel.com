/**
 * Fix prebuilt Vercel deployment: copy Linux libsql native module into
 * every serverless function that references @libsql/client.
 *
 * Problem: When building locally on macOS, Next.js tracer only includes
 * @libsql/darwin-x64 (Mac binary). On Vercel's Linux runtime, the serverless
 * function crashes with "Cannot find module '@libsql/linux-x64-gnu'".
 *
 * Solution: Find all .func directories that have @libsql/client in their
 * filePathMap, then add @libsql/linux-x64-gnu to the filePathMap.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function findFuncDirs(baseDir) {
  const dirs = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith('.func')) {
        dirs.push(fullPath);
      } else if (entry.isDirectory()) {
        walk(fullPath);
      }
    }
  }
  walk(baseDir);
  return dirs;
}

const outputDir = path.join(projectRoot, '.vercel', 'output');
const funcDirs = findFuncDirs(outputDir);

console.log(`Found ${funcDirs.length} serverless functions`);

const linuxNativeSource = path.join(projectRoot, 'node_modules', '@libsql', 'linux-x64-gnu');
const files = ['index.node', 'package.json', 'README.md'].filter(f => 
  fs.existsSync(path.join(linuxNativeSource, f))
);
const targetRelDir = 'node_modules/@libsql/linux-x64-gnu';

let fixedCount = 0;

for (const funcDir of funcDirs) {
  // Only fix functions that actually use @libsql/client
  const vcConfigPath = path.join(funcDir, '.vc-config.json');
  if (!fs.existsSync(vcConfigPath)) continue;

  const config = JSON.parse(fs.readFileSync(vcConfigPath, 'utf-8'));
  const filePathMap = config.filePathMap || {};
  
  const hasLibsql = Object.keys(filePathMap).some(k => k.includes('@libsql/client'));
  if (!hasLibsql) continue;

  // Check if already fixed
  const alreadyFixed = Object.keys(filePathMap).some(k => k.includes('linux-x64-gnu'));
  if (alreadyFixed) {
    console.log(`  ✅ Already fixed: ${path.basename(funcDir)}`);
    fixedCount++;
    continue;
  }

  // Add Linux native module files to filePathMap
  // filePathMap uses relative paths from project root
  for (const file of files) {
    const relKey = path.posix.join(targetRelDir, file);
    const relValue = path.posix.join('node_modules', '@libsql', 'linux-x64-gnu', file);
    filePathMap[relKey] = relValue;
  }

  fs.writeFileSync(vcConfigPath, JSON.stringify(config, null, 2));
  console.log(`  🔧 Fixed: ${path.basename(funcDir)}`);
  fixedCount++;
}

console.log(`\nFixed ${fixedCount}/${funcDirs.length} functions with Linux native module`);
