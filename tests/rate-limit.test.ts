/**
 * 限流桶隔离 · 回归测试（2026-10-17）
 *
 * ── 为什么单独立这个文件 ────────────────────────────────────────────
 * 缺陷本身是「**两个互不相关的限流器共用一个桶**」，它的错法是**静默的**：
 * 额度多给或少给都不报错、不抛异常、日志也正常。唯一的检出方式就是
 * 「把两个限流器放在一起，看它们会不会互相吃额度」—— 也就是本文件第 1 组用例。
 *
 * 第 2 组钉住「同名必须同配置」：光靠"记得传 name"挡不住下一个人，
 * 而「同一个名字配两套额度」是可确定性检出的（注册期抛错）。
 *
 * ── 前提：本测试**不得**写生产 Redis ────────────────────────────────
 * `getRedis()` 在后端为 upstash 时会真的发网络请求。若 CI 或本机 shell 里
 * 注入了 `UPSTASH_REDIS_REST_URL`，这些用例会去生产库上计数（免费档 10k 命令/天）。
 * 所以最后一条用例**先断言后端是 memory** —— 先证前提，再谈结论。
 */
import { rateLimit, retryAfterSeconds, clientIpOf } from '@/lib/rate-limit'
import { getRedisBackend } from '@/lib/im/redis'

let seq = 0
/** 每个用例一个独立桶名，避免 `registeredBuckets` 的跨用例干扰。 */
const uniq = (prefix: string) => `${prefix}:${++seq}`

function req(ip = '203.0.113.7'): Request {
  return new Request('http://localhost/api/probe', { headers: { 'x-forwarded-for': ip } })
}

describe('限流桶按 name 隔离', () => {
  it('两个限流器即使同一个 IP 也互不吃额度（原缺陷的直接回归）', async () => {
    const a = rateLimit({ name: uniq('iso:a'), windowMs: 60_000, max: 2 })
    const b = rateLimit({ name: uniq('iso:b'), windowMs: 60_000, max: 2 })
    const ip = '198.51.100.11'

    expect((await a(req(ip))).success).toBe(true)
    expect((await a(req(ip))).success).toBe(true)
    expect((await a(req(ip))).success).toBe(false) // A 已到顶

    // B 换了自己的桶 ⇒ 不受 A 的影响。若两者共用 `ratelimit:<ip>`，这里必红。
    const b1 = await b(req(ip))
    expect(b1.success).toBe(true)
    expect(b1.remaining).toBe(1)
    expect((await b(req(ip))).success).toBe(true)
    expect((await b(req(ip))).success).toBe(false)
  })

  it('同名同配置共享同一计数（等同"同一个限流器"）', async () => {
    const name = uniq('shared')
    const l1 = rateLimit({ name, windowMs: 60_000, max: 2 })
    const l2 = rateLimit({ name, windowMs: 60_000, max: 2 })
    const ip = '198.51.100.12'

    expect((await l1(req(ip))).success).toBe(true)
    expect((await l2(req(ip))).success).toBe(true)
    expect((await l2(req(ip))).success).toBe(false)
  })

  it('同名不同额度 → 注册期抛错（把"配置漂移"变成启动期失败，而不是运行期错算）', () => {
    const name = uniq('conflict')
    rateLimit({ name, windowMs: 60_000, max: 5 })
    expect(() => rateLimit({ name, windowMs: 60_000, max: 6 })).toThrow(/已被注册/)
    expect(() => rateLimit({ name, windowMs: 30_000, max: 5 })).toThrow(/已被注册/)
    // 同配置重复注册是允许的（模块被重新求值的场景）
    expect(() => rateLimit({ name, windowMs: 60_000, max: 5 })).not.toThrow()
  })
})

describe('参数校验', () => {
  it('缺 name / name 非法 → 抛错（缺 name 会让所有调用共用 ratelimit:undefined:<ip>）', () => {
    expect(() => rateLimit({ name: '', windowMs: 1000, max: 1 })).toThrow(/桶名/)
    expect(() => rateLimit({ name: 'Has Space', windowMs: 1000, max: 1 })).toThrow(/桶名/)
    expect(() => rateLimit({ name: 'UPPER', windowMs: 1000, max: 1 })).toThrow(/桶名/)
    // @ts-expect-error 运行期兜住 JS 调用方漏传 name
    expect(() => rateLimit({ windowMs: 1000, max: 1 })).toThrow(/桶名/)
  })

  it('windowMs / max 非正数 → 抛错', () => {
    expect(() => rateLimit({ name: uniq('bad-w'), windowMs: 0, max: 1 })).toThrow(/windowMs/)
    expect(() => rateLimit({ name: uniq('bad-m'), windowMs: 1000, max: 0 })).toThrow(/max/)
  })
})

describe('取键与窗口', () => {
  it('keyOverride 优先于请求头 IP（已登录场景按 userId 计数，不需要伪造请求头）', async () => {
    const limiter = rateLimit({ name: uniq('override'), windowMs: 60_000, max: 1 })

    expect((await limiter(req('198.51.100.20'), 'u:user-1')).success).toBe(true)
    expect((await limiter(req('198.51.100.21'), 'u:user-1')).success).toBe(false) // 换 IP 也不行
    expect((await limiter(req('198.51.100.22'))).success).toBe(true) // 无 override ⇒ 换回 IP 维度
  })

  it('窗口到期后额度重置', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-17T00:00:00Z') })
    try {
      const limiter = rateLimit({ name: uniq('window'), windowMs: 1_000, max: 1 })
      const ip = '198.51.100.30'

      expect((await limiter(req(ip))).success).toBe(true)
      expect((await limiter(req(ip))).success).toBe(false)

      jest.advanceTimersByTime(1_100)

      expect((await limiter(req(ip))).success).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('clientIpOf 取首个转发段并去空白；缺失时回 anonymous', () => {
    expect(clientIpOf(req('  10.1.2.3 '))).toBe('10.1.2.3')
    expect(clientIpOf(new Request('http://localhost/'))).toBe('anonymous')
    expect(
      clientIpOf(new Request('http://localhost/', { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } }))
    ).toBe('10.0.0.1')
  })

  it('retryAfterSeconds 至少为 1（0 会被客户端理解成"立刻重试"）', () => {
    expect(retryAfterSeconds({ success: false, remaining: 0, resetAt: Date.now() - 5_000 })).toBe(1)
    expect(
      retryAfterSeconds({ success: false, remaining: 0, resetAt: Date.now() + 45_000 })
    ).toBeGreaterThanOrEqual(44)
  })
})

describe('测试环境前提', () => {
  it('Redis 后端必须是 memory —— 否则本套用例会去真正的 Upstash 上计数', () => {
    expect(getRedisBackend()).toBe('memory')
  })
})
