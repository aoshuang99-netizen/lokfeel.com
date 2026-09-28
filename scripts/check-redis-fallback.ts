/**
 * Redis 降级路径回归检查（无需真实 Redis、无需数据库）
 *
 * 用法：`npm run check:redis`   （退出码 0 = 通过，1 = 有断言失败）
 *
 * ## 为什么需要它
 *
 * G-4（2026-09-27）修复的是一类**特别隐蔽**的缺陷：降级路径存在、日志也说
 * "using in-memory fallback"，但实际上是坏的 —— 每次调用新建空存储，于是
 * 令牌桶永远满、`incr` 恒为 1、在线状态写完即丢。**读代码几乎看不出来**
 * （单看每个函数都"对"），只有**跨调用**观察状态才能发现。
 *
 * 因此本检查的核心断言全部是"跨调用"的：
 *   · 两次 getRedis() 必须是同一实例
 *   · set 之后 get 必须读得到
 *   · incr 必须累加
 *   · hmset 必须支持对象形式且是合并语义
 *
 * 这类缺陷一旦重现，是**安全能力**（反骚扰限流、通用限流）的静默失效，
 * 所以放进回归脚本，改 Redis 层后随手跑一次。
 *
 * @module scripts/check-redis-fallback
 */

// 必须在 import 之前清空，确保走"未配置"分支
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? ` → ${String(extra)}` : ''}`);
  }
}

async function main() {
  const R = await import('../src/lib/im/redis');

  console.log('=== 1. 配置探测 ===');
  ok('isRedisConfigured() === false（未配置）', R.isRedisConfigured() === false);
  ok("getRedisBackend() === 'memory'", R.getRedisBackend() === 'memory');

  console.log('\n=== 2. 内存后端单例（核心回归断言） ===');
  const a = R.getRedis();
  const b = R.getRedis();
  ok('两次 getRedis() 返回同一实例', a === b);
  ok('redis 代理可用', typeof R.redis.get === 'function');

  console.log('\n=== 3. 写入后可跨调用回读 ===');
  await a.set('check:key', 'v1');
  ok("读到 'v1'", (await R.getRedis().get('check:key')) === 'v1');

  console.log('\n=== 4. incr 累加（限流的前提） ===');
  const seq = [
    await R.getRedis().incr('check:cnt'),
    await R.getRedis().incr('check:cnt'),
    await R.getRedis().incr('check:cnt'),
  ];
  ok('依次为 1,2,3', seq.join(',') === '1,2,3', seq.join(','));

  console.log('\n=== 5. 哈希：对象形式 + 合并语义 ===');
  // 与 PaceController 的真实调用形式一致（对象形式）
  await R.getRedis().hmset('check:hash', { tokens: '10', hourlyCount: '0' });
  await R.getRedis().hmset('check:hash', { tokens: '9' });
  const hm = await R.getRedis().hmget('check:hash', 'tokens', 'hourlyCount');
  ok('对象形式被正确解析且合并不覆盖', hm[0] === '9' && hm[1] === '0', JSON.stringify(hm));

  console.log('\n=== 6. 集合（在线连接映射） ===');
  await R.getRedis().sadd('check:set', 'c1', 'c2');
  await R.getRedis().srem('check:set', 'c1');
  const members = (await R.getRedis().smembers('check:set')) as string[];
  ok('sadd/srem/smembers 正常', members.length === 1 && members[0] === 'c2');

  console.log('\n=== 7. TTL ===');
  await R.getRedis().set('check:ttl', 'x', { ex: 100 });
  const ttl = await R.getRedis().ttl('check:ttl');
  ok('ttl 返回剩余秒数（~100）', ttl > 95 && ttl <= 100, ttl);

  console.log('\n=== 8. 熔断：已配置但不可达 → 降级为 memory ===');
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake';
  ok('配置后 backend 为 upstash', R.getRedisBackend() === 'upstash', R.getRedisBackend());

  R.markRedisUnavailable('check.injected');
  ok('熔断后 backend 为 memory', R.getRedisBackend() === 'memory', R.getRedisBackend());

  const st = R.getRedisStatus();
  ok('degraded === true', st.degraded === true);
  ok('configured === true（借此区分"自托管"与"故障"）', st.configured === true);
  ok('degradedReason 已记录', st.degradedReason === 'check.injected', st.degradedReason);
  ok('degradedForMs > 0', st.degradedForMs > 0, st.degradedForMs);

  // 冷却窗口内重复标记不应续期（否则持续故障 → 永不回切）
  const before = st.degradedForMs;
  R.markRedisUnavailable('check.injected.again');
  const after = R.getRedisStatus().degradedForMs;
  ok('窗口内重复标记不重置冷却时间', after <= before, `${before} → ${after}`);

  R.clearRedisDegradation();
  ok('clear 之后回切 upstash', R.getRedisBackend() === 'upstash', R.getRedisBackend());

  console.log(`\n${'─'.repeat(70)}`);
  if (fail === 0) {
    console.log(`✅ 通过 ${pass} 项 —— Redis 降级路径行为正确。`);
  } else {
    console.log(`🔴 失败 ${fail} 项 / 通过 ${pass} 项 —— 降级路径可能已损坏。`);
    console.log('   注意：这类缺陷会让限流与在线状态**静默失效**，务必修复后再上线。');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('检查脚本自身失败：', e);
  process.exitCode = 1;
});
