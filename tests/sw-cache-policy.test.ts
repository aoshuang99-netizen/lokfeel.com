/**
 * T03 · Service Worker 缓存策略守卫
 *
 * 为什么需要这个测试：
 *   `public/sw.js` 曾经对所有 `/api/` 请求走 **stale-while-revalidate** ——
 *   SW 会**先返回缓存副本**，再在后台更新缓存。这条策略制造了两个缺陷，
 *   而且**都不会报错**，只在特定操作序列下暴露：
 *
 *     1. 功能：「刚写完立刻读」必然拿到上一次的数据。
 *        用户把某字段从「组织者」收紧为「仅自己」后，披露预览仍显示旧范围，
 *        看起来像没保存成功；反向（放开授权）时更危险 —— 用户以为已经授权了。
 *        本任务是靠移动端 E2E 才把它抓出来（服务端日志里明明有请求、返回也是新的，
 *        但页面显示旧值 —— 因为调用方拿到的是缓存副本）。
 *
 *     2. 隐私：意图正文、披露配置、组织者视角的成员资料、会话响应都是**带身份的个人数据**。
 *        放进 Cache Storage 等于在设备上留一份可被后续会话/其他账号读取的副本；
 *        撤销披露后旧内容依然可读。
 *
 *   这类缺陷无法用类型系统拦截（sw.js 是纯 JS，不在 tsc 覆盖范围内），
 *   只能靠"源码断言"把它钉死。本测试就是那颗钉子。
 *
 * 断言被打破时的含义（即 CI 拦截的漂移）：
 *   · API 分支重新出现 `respondWith(...)` → "写完读旧值"与隐私泄露会**再次**出现
 *   · 调用 `API_CACHE` → 旧后门回来了
 *   · activate 不再清理 `api-` 前缀 → 设备上历史遗留的个人数据缓存永远不会被删
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')
const SW = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8')

describe('Service Worker —— API 响应不做持久化缓存', () => {
  test('API 分支必须直接放行（不得调用 respondWith）', () => {
    const m = SW.match(/if \(isApiRequest\(request\)\)\s*\{([\s\S]*?)\n\s*\}/)
    expect(m).not.toBeNull()
    // 去掉注释行后再看分支体：必须只剩一条 return
    const body = m![1]
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
      .join(' ')
    expect(body).toBe('return;')
  })

  test('任何 respondWith 都不得使用 API_CACHE', () => {
    const calls = [...SW.matchAll(/respondWith\(([^)]*)\)/g)].map((mm) => mm[1])
    expect(calls.length).toBeGreaterThan(0) // 兜底：至少要有策略存在，防止正则失效导致假绿
    for (const call of calls) {
      expect(call).not.toContain('API_CACHE')
    }
  })

  test('不得重新定义 API_CACHE 常量', () => {
    expect(SW).not.toMatch(/const\s+API_CACHE\s*=/)
  })

  test('activate 仍清理历史遗留的 api- 前缀缓存', () => {
    // 只停止写新缓存是不够的：旧版本留在设备上的那份 API 缓存（装着个人数据）必须被删掉。
    expect(SW).toMatch(/\.some\(\(prefix\)\s*=>\s*name\.startsWith\(prefix\)\)/)
    expect(SW).toMatch(/['"]api-['"]/)
  })

  test('isApiRequest 判定仍覆盖 /api/', () => {
    expect(SW).toMatch(/function isApiRequest[\s\S]{0,200}includes\(['"]\/api\/['"]\)/)
  })

  test('静态与图片策略保留（防止"顺手删干净"导致离线能力消失）', () => {
    expect(SW).toMatch(/cacheFirst\(request,\s*STATIC_CACHE\)/)
    expect(SW).toMatch(/staleWhileRevalidate\(request,\s*IMAGE_CACHE\)/)
  })

  test('CACHE_VERSION 为字符串字面量（版本不变则旧缓存不会被清理）', () => {
    expect(SW).toMatch(/const\s+CACHE_VERSION\s*=\s*['"][^'"]+['"]/)
  })
})
