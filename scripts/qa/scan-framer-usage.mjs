// 扫描 framer-motion 的真实使用点（WB19-45 性能专项）
// 只读；输出文件清单 + 每个文件用到的导出名
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src'];
const hits = [];

function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f.name)) {
      const s = fs.readFileSync(p, 'utf8');
      const m = s.match(/from\s+['"]framer-motion['"]/g);
      if (m) {
        const imports = [...s.matchAll(/import\s+([^;]+?)\s+from\s+['"]framer-motion['"]/g)]
          .map((x) => x[1].replace(/\s+/g, ' ').trim());
        hits.push({ file: p.replace(/^src\//, ''), imports });
      }
    }
  }
}

for (const r of ROOTS) walk(r);
console.log('framer-motion 使用文件数:', hits.length);
for (const h of hits) console.log('-', h.file, '=>', h.imports.join(' | '));
