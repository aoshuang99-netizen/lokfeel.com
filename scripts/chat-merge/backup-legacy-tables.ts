/**
 * P1-6 阶段 5 —— 三张 Legacy 表（Message / ChatRoomMember / ChatRoom）定点备份
 *
 * 在 DROP TABLE 之前执行，产出（backups/stage5-2026-09-28/）：
 *   · legacy-tables-schema.json   三表的 CREATE TABLE / 索引 / 外键快照
 *   · Message.json                全量行（JSON，含每表行数校验）
 *   · ChatRoomMember.json
 *   · ChatRoom.json
 *   · backup-manifest.json        行数 + 校验摘要
 *
 * 只读：本脚本对数据库零写入。
 * 用法：npx tsx scripts/chat-merge/backup-legacy-tables.ts
 */
import { createClient, type Client } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const AUTH_TOKEN = (process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '').trim();

if (!DATABASE_URL) {
  console.error('✗ 缺少 DATABASE_URL（请检查 .env）');
  process.exit(1);
}

const client: Client = createClient({
  url: DATABASE_URL,
  ...(AUTH_TOKEN ? { authToken: AUTH_TOKEN } : {}),
});

const OUT_DIR = path.join(__dirname, '..', '..', 'backups', 'stage5-2026-09-28');
const TABLES = ['Message', 'ChatRoomMember', 'ChatRoom'] as const;

type Row = Record<string, unknown>;

async function q(sql: string): Promise<Row[]> {
  const r = await client.execute({ sql, args: [] });
  return r.rows as unknown as Row[];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    database: DATABASE_URL.replace(/^[a-z]+:\/\/[^@]*@/, '$1***@'),
    tables: {} as Record<string, unknown>,
  };

  // 1) schema 快照（CREATE TABLE + 索引 + 外键），DROP 后靠它可以精确重建
  const schemaSnapshot: Record<string, unknown> = {};
  for (const t of TABLES) {
    const ddl = await q(`SELECT sql FROM sqlite_master WHERE tbl_name = '${t}' AND sql IS NOT NULL`);
    const fks = await q(`PRAGMA foreign_key_list(${t})`);
    schemaSnapshot[t] = { ddl: ddl.map(r => r.sql), foreignKeys: fks };
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'legacy-tables-schema.json'),
    JSON.stringify(schemaSnapshot, null, 2),
  );
  console.log('✓ schema 快照 → legacy-tables-schema.json');

  // 2) 全量数据导出 + 行数校验
  for (const t of TABLES) {
    const rows = await q(`SELECT * FROM ${t}`);
    fs.writeFileSync(path.join(OUT_DIR, `${t}.json`), JSON.stringify(rows, null, 2));
    const countRows = await q(`SELECT COUNT(*) AS n FROM ${t}`);
    const dbCount = Number(countRows[0].n);
    const match = rows.length === dbCount;
    console.log(`✓ ${t}: ${rows.length} 行（DB COUNT=${dbCount}，${match ? '一致' : '✗ 不一致！'}）`);
    (manifest.tables as Record<string, unknown>)[t] = { rows: rows.length, dbCount, match };
    if (!match) {
      console.error(`✗ ${t} 行数校验失败，中止（不要删表）`);
      process.exit(1);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'backup-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('✓ 备份完成 → backup-manifest.json');
  console.log(`\n备份目录：${OUT_DIR}`);
}

main()
  .catch(e => {
    console.error('✗ 备份失败：', e);
    process.exit(1);
  })
  .finally(() => {
    try {
      void client.close();
    } catch {
      /* close() 非 Promise，忽略 */
    }
  });
