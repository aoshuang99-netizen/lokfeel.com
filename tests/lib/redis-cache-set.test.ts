/**
 * Redis SET 命令形状 —— 钉住一次**已发生的生产事故**。
 *
 * ## 事故
 * `redisSet()` 曾把 `["<json>","EX",75]` 作为 body POST 到 `/set/{key}`。
 * Upstash 把这个数组**当成值本身**存下来，并**忽略 EX**：
 *   GET → `["{\"id\":\"...\",\"tokenVersion\":0}","EX",75]`
 *   TTL → -1（永不过期）
 * 读取方 `JSON.parse` 得到数组 ⇒ `user.tokenVersion === undefined` ⇒
 * `requireAuth()` 的版本校验 `undefined !== 0` 成立 ⇒ 抛 "Session expired"。
 * 结果：登录用户从**第二个**需要鉴权的 API 请求开始全部 401。
 * 因为写入时没带 TTL，坏键**永不消失**，所以影响是持续的而不是 60 秒。
 *
 * ## 这个测试为什么不能只断言「写对了」
 * 「写对了」很容易因为重构又写回 `/set/{key}`。所以除了正向形状，还必须：
 *   ① 断言**旧形状会被识别**（`unwrapLegacySetPayload` 认得出它），
 *      这样一旦有人回退写法，读取端的兼容层还能兜住；
 *   ② 用 `tokenVersion: 0` 当夹具 —— 它正是被 JSON 往返吃掉的字段，
 *      用 `id`/`email` 测试是测不出来的（真值恰好是 falsy）。
 */
import { buildSetCommand, unwrapLegacySetPayload } from "@/lib/redis-cache";

describe("buildSetCommand", () => {
  it("走命令数组（POST /），而不是 /set/{key} 的 body", () => {
    const { path, body } = buildSetCommand("auth:user:u1", { id: "u1" }, 60);

    expect(path).toBe("/");
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toBe("SET");
    expect(body[1]).toBe("auth:user:u1");
    expect(body[3]).toBe("EX");
  });

  it("值是 JSON 字符串，且往返后保真（含 tokenVersion: 0 这种 falsy 字段）", () => {
    const value = { id: "u1", email: "a@b.c", role: "USER", image: null, tokenVersion: 0 };
    const { body } = buildSetCommand("auth:user:u1", value, 60);

    expect(typeof body[2]).toBe("string");
    // 关键：0 不能被丢掉（旧写法读回来时 tokenVersion 就丢在这一步之后）
    expect(JSON.parse(body[2])).toEqual(value);
    expect(JSON.parse(body[2]).tokenVersion).toBe(0);
  });

  it("TTL 是数字字符串且至少 1 秒（0 会让 EX 变成非法参数）", () => {
    for (const ttl of [0, -5, 0.4, 1, 60]) {
      const { body } = buildSetCommand("k", { a: 1 }, ttl);
      expect(body[4]).toMatch(/^\d+$/);
      expect(Number(body[4])).toBeGreaterThanOrEqual(1);
    }
  });

  it("key 不被 URL 编码（命令数组里的 key 是参数，编码会写错键）", () => {
    const { body } = buildSetCommand("auth:user:a/b c", { a: 1 }, 60);
    expect(body[1]).toBe("auth:user:a/b c");
  });
});

describe("unwrapLegacySetPayload（旧写法的读侧兼容）", () => {
  it("能解开旧写法的坏值，并且字段一个不少", () => {
    const inner = { id: "u1", email: "a@b.c", tokenVersion: 0 };
    // 旧写法实际存下来的字符串形状
    const legacy = JSON.stringify([JSON.stringify(inner), "EX", 75]);

    expect(unwrapLegacySetPayload(legacy)).toEqual(inner);
    expect((unwrapLegacySetPayload(legacy) as { tokenVersion: number }).tokenVersion).toBe(0);
  });

  it("反向对照：正常的 JSON 对象**不会**被误当成坏值", () => {
    const normal = JSON.stringify({ id: "u1", tokenVersion: 0 });
    expect(unwrapLegacySetPayload(normal)).toBe(normal);
  });

  it("反向对照：三元素但第二项不是 EX 的数组不处理（避免误伤真实数组值）", () => {
    const notLegacy = JSON.stringify(["a", "b", 3]);
    expect(unwrapLegacySetPayload(notLegacy)).toBe(notLegacy);
  });

  it("非字符串原样返回（缓存里也可能是数字/布尔）", () => {
    expect(unwrapLegacySetPayload(42)).toBe(42);
    expect(unwrapLegacySetPayload(null)).toBe(null);
    expect(unwrapLegacySetPayload({ a: 1 })).toEqual({ a: 1 });
  });

  it("坏值里的内层不是 JSON 时，退化为返回内层字符串而不是抛错", () => {
    const legacy = JSON.stringify(["not-json", "EX", 10]);
    expect(unwrapLegacySetPayload(legacy)).toBe("not-json");
  });
});
