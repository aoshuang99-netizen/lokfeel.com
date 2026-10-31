/**
 * 软删除过滤 · 回归测试（B-20 / B-13）
 * ═══════════════════════════════════════════════════════════════════════
 * 这个模块的失败模式不是"崩"，而是**静默算错数**：
 *   · 营收 `payment.aggregate(_sum.amount)` 把软删的支付也加起来 ⇒ 报表虚高、与明细对不上；
 *   · 未读徽章 `conversation.aggregate(_sum.unreadCount)` 算进已删会话 ⇒ "5 条未读"点进去 0 条；
 *   · 匹配均分 `match.aggregate(_avg.matchScore)` 被已删样本污染。
 * 全都不报错、不告警，只有人肉对账才会发现 —— 所以这里全部用**反例**钉住。
 *
 * 另一类失败是**清单漂移**：schema 加了 `deletedAt`，扩展清单没跟上，
 * 于是新表的软删从第一天起就不生效。第 1 组用例读真实 schema 来守这件事。
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  SOFT_DELETE_EXEMPT_MODELS,
  SOFT_DELETE_MODELS,
  SOFT_DELETE_OPERATIONS,
  applySoftDeleteFilter,
  withSoftDelete,
} from '@/lib/soft-delete-filter';

const SCHEMA_DIR = join(process.cwd(), 'prisma', 'schema');

/** 从真实的 .prisma 文件里抽出「带 `deletedAt DateTime?` 的模型名」 */
function modelsWithDeletedAt(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
    const text = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    for (const block of text.match(/model\s+\w+\s*\{[\s\S]*?\n\}/g) || []) {
      const name = block.match(/model\s+(\w+)/)![1];
      if (/^\s*deletedAt\s+DateTime\?/m.test(block)) found.push(name);
    }
  }
  return found.sort();
}

describe('清单与 schema 不漂移', () => {
  it('schema 中每个带 deletedAt 的模型，要么被扩展过滤、要么显式豁免', () => {
    const covered = new Set<string>([
      ...SOFT_DELETE_MODELS,
      ...Object.keys(SOFT_DELETE_EXEMPT_MODELS),
    ]);

    const uncovered = modelsWithDeletedAt().filter((m) => !covered.has(m));
    // 反例：新增/改名一个带 deletedAt 的模型却忘了登记 ⇒ 该表的软删静默失效
    expect(uncovered).toEqual([]);
  });

  it('清单里不留 schema 已删除的死模型（如 ChatRoom）', () => {
    const actual = new Set(modelsWithDeletedAt());
    const dead = SOFT_DELETE_MODELS.filter((m) => !actual.has(m));
    // 反例：模型删了、条目留着 ⇒ 死配置，看起来像"已经处理了"
    expect(dead).toEqual([]);
  });

  it('豁免必须写清理由（不许空字符串糊过去）', () => {
    for (const [model, reason] of Object.entries(SOFT_DELETE_EXEMPT_MODELS)) {
      expect(`${model}: ${reason.length > 10}`).toBe(`${model}: true`);
    }
  });
});

describe('操作覆盖：漏一个就是一条绕过软删的读路径', () => {
  const REQUIRED = [
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'findUnique',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ];

  it.each(REQUIRED)('覆盖 %s', (op) => {
    expect(SOFT_DELETE_OPERATIONS as readonly string[]).toContain(op);
  });

  it('聚合类是 B-20 的修复点，必须显式在列', () => {
    // 反例（改前状态）：只有 find*/count ⇒ 这条断言会红
    expect(SOFT_DELETE_OPERATIONS).toContain('aggregate');
    expect(SOFT_DELETE_OPERATIONS).toContain('groupBy');
  });
});

describe('applySoftDeleteFilter · 条件合并', () => {
  it('aggregate 保留业务条件（营收口径 status=SUCCEEDED 不能被吃掉）', () => {
    const out = applySoftDeleteFilter('aggregate', {
      where: { status: 'SUCCEEDED' },
      _sum: { amount: true },
    });

    expect(out.where).toEqual({ deletedAt: null, status: 'SUCCEEDED' });
    // 聚合参数必须原样带下去，否则 _sum 变空对象 ⇒ 结果 null
    expect(out._sum).toEqual({ amount: true });
  });

  it('groupBy 保留 by，并补 deletedAt', () => {
    const out = applySoftDeleteFilter('groupBy', {
      by: ['plan'],
      where: { status: 'ACTIVE' },
    });

    expect(out.by).toEqual(['plan']);
    expect(out.where).toEqual({ deletedAt: null, status: 'ACTIVE' });
  });

  it('count 补 deletedAt（徽章数口径）', () => {
    const out = applySoftDeleteFilter('count', { where: { userId: 'u1' } });
    expect(out.where).toEqual({ deletedAt: null, userId: 'u1' });
  });

  it('findMany 无 where 时也补上（此前会退化成读全表）', () => {
    expect(applySoftDeleteFilter('findMany', {}).where).toEqual({ deletedAt: null });
  });
});

describe('显式 where 优先 · 管理端回收站依赖这条', () => {
  it('where.deletedAt = { not: null } 不被覆盖成 null', () => {
    const out = applySoftDeleteFilter('findMany', {
      where: { deletedAt: { not: null } },
    });

    // 反例：若展开顺序写反（用户条件在前、默认值在后），回收站永远返回空列表且不报错
    expect(out.where).toEqual({ deletedAt: { not: null } });
  });

  it('aggregate 同样遵守显式优先', () => {
    const out = applySoftDeleteFilter('aggregate', {
      where: { deletedAt: { gte: new Date('2026-01-01') } },
      _count: true,
    });

    expect(out.where?.deletedAt).toEqual({ gte: new Date('2026-01-01') });
  });
});

describe('findUnique 系 · 唯一键不能被弄丢', () => {
  it('findUnique 合并 deletedAt 且保留唯一键', () => {
    const out = applySoftDeleteFilter('findUnique', { where: { id: 'p1' } });
    expect(out.where).toEqual({ id: 'p1', deletedAt: null });
  });

  it('findUniqueOrThrow 同语义（漏包会读到已删记录）', () => {
    const out = applySoftDeleteFilter('findUniqueOrThrow', { where: { id: 'p1' } });
    expect(out.where).toEqual({ id: 'p1', deletedAt: null });
  });

  it('复合唯一键也保留', () => {
    const out = applySoftDeleteFilter('findUnique', {
      where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
    });
    expect(out.where?.conversationId_userId).toEqual({ conversationId: 'c1', userId: 'u1' });
  });
});

describe('不污染入参', () => {
  it('applySoftDeleteFilter 不改原 args', () => {
    const input = { where: { status: 'SUCCEEDED' } };
    applySoftDeleteFilter('aggregate', input);
    expect(input.where).toEqual({ status: 'SUCCEEDED' });
  });

  it('withSoftDelete 不改原 where 对象', () => {
    const args = { where: { status: 'SUCCEEDED' } };
    withSoftDelete(args);
    expect(args.where).toEqual({ status: 'SUCCEEDED' });
  });
});
