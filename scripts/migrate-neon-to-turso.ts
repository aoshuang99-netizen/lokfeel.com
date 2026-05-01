/**
 * Neon PostgreSQL → Turso libSQL 数据迁移脚本
 * 
 * 使用方式：
 * 1. 确保 Neon DATABASE_URL 在 .env 中
 * 2. 运行: npx tsx scripts/migrate-neon-to-turso.ts
 * 3. 设置 Turso 环境变量后运行: npx tsx scripts/migrate-neon-to-turso.ts --import
 */

import { PrismaClient } from '../src/generated/client';

// ─── 表依赖顺序（按外键关系）────────────────────────────────
const TABLE_ORDER = [
  'Account',
  'Session',
  'VerificationToken',
  'User',
  'Profile',
  'BotProfile',
  'Subscription',
  'ChatRoom',
  'ChatRoomMember',
  'Message',
  'Conversation',
  'IMMessage',
  'Match',
  'Report',
  'Payment',
];

async function exportData() {
  console.log('📦 正在从 Neon PostgreSQL 导出数据...');
  
  const prisma = new PrismaClient();
  
  try {
    const exportData: Record<string, any[]> = {};
    
    for (const table of TABLE_ORDER) {
      try {
        // @ts-ignore - dynamic model access
        const records = await prisma[table.toLowerCase()].findMany();
        exportData[table] = records;
        console.log(`  ✅ ${table}: ${records.length} 条记录`);
      } catch (err: any) {
        console.log(`  ⚠️  ${table}: 跳过 (${err.message?.substring(0, 60)}...)`);
      }
    }
    
    // 写入JSON文件
    const fs = await import('fs');
    const path = await import('path');
    const outputPath = path.join(process.cwd(), 'migration-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
    console.log(`\n📁 数据已导出到: ${outputPath}`);
    console.log(`   总大小: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
    
  } finally {
    await prisma.$disconnect();
  }
}

async function importData() {
  console.log('📥 正在向 Turso libSQL 导入数据...');
  
  const fs = await import('fs');
  const path = await import('path');
  const inputPath = path.join(process.cwd(), 'migration-data.json');
  
  if (!fs.existsSync(inputPath)) {
    console.error('❌ migration-data.json 不存在，请先运行导出');
    process.exit(1);
  }
  
  const data: Record<string, any[]> = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const prisma = new PrismaClient();
  
  try {
    for (const table of TABLE_ORDER) {
      const records = data[table];
      if (!records || records.length === 0) {
        console.log(`  ⏭️  ${table}: 无数据`);
        continue;
      }
      
      console.log(`  📝 ${table}: 导入 ${records.length} 条记录...`);
      
      let imported = 0;
      let errors = 0;
      
      for (const record of records) {
        try {
          // 转换 String[] 字段为 JSON 字符串
          const converted = convertArraysToJson(record);
          // @ts-ignore
          await prisma[table.toLowerCase()].create({ data: converted });
          imported++;
        } catch (err: any) {
          errors++;
          if (errors <= 3) {
            console.error(`    ❌ ${table} 导入失败: ${err.message?.substring(0, 80)}`);
          }
        }
      }
      
      console.log(`    ✅ ${imported} 成功, ❌ ${errors} 失败`);
    }
    
    console.log('\n🎉 数据迁移完成！');
    
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * PostgreSQL String[] → SQLite String(JSON)
 * 将数组字段转为 JSON 字符串
 */
function convertArraysToJson(record: Record<string, any>): Record<string, any> {
  const ARRAY_FIELDS = new Set([
    'selectedTags', 'galleryPhotos', 'complianceTags',
    'interests', 'hobbies', 'musicGenres', 'movieGenres',
    'preferredEthnicities', 'preferredOccupations', 'preferredEducation',
  ]);
  
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(record)) {
    if (ARRAY_FIELDS.has(key) && Array.isArray(value)) {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

// ─── Main ──────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--import')) {
  importData().catch(console.error);
} else {
  exportData().catch(console.error);
}
