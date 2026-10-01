/**
 * 回归测试：请求的公开 origin 解析
 *
 * 覆盖 2026-10-01 在生产（Netlify）实测到的真实缺陷：
 *   request.url = https://<deploy-id>--lokfeel.netlify.app/api/...  （平台内部地址）
 *   request.nextUrl.origin = https://app.lokfeel.com                （访客真实地址）
 * 用 request.url 拼跳转会把已登录用户送到内部域名并丢掉会话 cookie。
 */
import {
  normalizeOrigin,
  resolvePublicOrigin,
  publicOriginOf,
  absoluteUrlFor,
  resolveSiteHosts,
  claimedHost,
  isSameSiteRequest,
} from '../src/lib/http/public-origin'

const DEPLOY = 'https://6abe6a55fe843a00084ff0dd--lokfeel.netlify.app'
const PUBLIC = 'https://app.lokfeel.com'

describe('normalizeOrigin', () => {
  it('保留 scheme + host，去掉路径与末尾斜杠', () => {
    expect(normalizeOrigin('https://app.lokfeel.com/')).toBe(PUBLIC)
    expect(normalizeOrigin('https://app.lokfeel.com/login?x=1#h')).toBe(PUBLIC)
    expect(normalizeOrigin('http://localhost:3000/')).toBe('http://localhost:3000')
  })

  it('拒绝非 http(s) 协议', () => {
    expect(normalizeOrigin('javascript:alert(1)')).toBe('')
    expect(normalizeOrigin('javascript://evil.com/%0aalert(1)')).toBe('')
    expect(normalizeOrigin('data:text/html,<script>')).toBe('')
    expect(normalizeOrigin('ftp://evil.com')).toBe('')
  })

  it('拒绝空值/非法值', () => {
    expect(normalizeOrigin('')).toBe('')
    expect(normalizeOrigin(null)).toBe('')
    expect(normalizeOrigin(undefined)).toBe('')
    expect(normalizeOrigin('not a url')).toBe('')
    expect(normalizeOrigin('//evil.com')).toBe('')
  })
})

describe('resolvePublicOrigin — 优先级', () => {
  it('NEXT_PUBLIC_APP_URL 最高优先', () => {
    expect(
      resolvePublicOrigin({
        env: { NEXT_PUBLIC_APP_URL: PUBLIC },
        nextUrlOrigin: 'https://from-nexturl.example',
        requestUrl: `${DEPLOY}/api/auth/oauth/google/callback`,
      }),
    ).toBe(PUBLIC)
  })

  it('★ 生产回归：缺少 env 时也不能返回部署专用域名', () => {
    const origin = resolvePublicOrigin({
      env: {},
      nextUrlOrigin: PUBLIC,
      requestUrl: `${DEPLOY}/api/auth/oauth/google/callback`,
    })
    expect(origin).toBe(PUBLIC)
    expect(origin).not.toContain('netlify.app')
  })

  it('AUTH_URL / NEXTAUTH_URL 依次兜底', () => {
    expect(resolvePublicOrigin({ env: { AUTH_URL: PUBLIC } })).toBe(PUBLIC)
    expect(resolvePublicOrigin({ env: { NEXTAUTH_URL: PUBLIC } })).toBe(PUBLIC)
    expect(
      resolvePublicOrigin({ env: { AUTH_URL: 'https://a.example', NEXTAUTH_URL: 'https://b.example' } }),
    ).toBe('https://a.example')
  })

  it('配置了非法值时跳过，继续向下兜底', () => {
    expect(
      resolvePublicOrigin({
        env: { NEXT_PUBLIC_APP_URL: 'not a url', AUTH_URL: PUBLIC },
        nextUrlOrigin: 'https://from-nexturl.example',
      }),
    ).toBe(PUBLIC)
  })

  it('全部缺失时用 requestUrl 兜底', () => {
    expect(resolvePublicOrigin({ env: {}, requestUrl: `${DEPLOY}/api/x` })).toBe(DEPLOY)
  })

  it('全部为空时返回空串（调用方退化为相对跳转）', () => {
    expect(resolvePublicOrigin({ env: {} })).toBe('')
    expect(resolvePublicOrigin({ env: {}, nextUrlOrigin: '', requestUrl: '' })).toBe('')
  })

  it('★ 不接受请求头来源的 origin（防开放重定向，接口本身就不读 header）', () => {
    // @ts-expect-error 刻意传入多余字段：必须被忽略
    const origin = resolvePublicOrigin({ env: {}, forwardedHost: 'evil.com', host: 'evil.com' })
    expect(origin).toBe('')
  })
})

describe('publicOriginOf', () => {
  it('从 NextRequest 形状的对象解析', () => {
    expect(
      publicOriginOf({ url: `${DEPLOY}/api/x`, nextUrl: { origin: PUBLIC } }, {}),
    ).toBe(PUBLIC)
  })

  it('nextUrl 缺失时不抛错', () => {
    expect(publicOriginOf({ url: `${DEPLOY}/api/x` }, {})).toBe(DEPLOY)
    expect(publicOriginOf({}, {})).toBe('')
  })
})

describe('resolveSiteHosts / isSameSiteRequest（同源判定）', () => {
  const NO_CONFIG = { configuredOrigins: [] as (string | null | undefined)[] }

  it('★ 发布窗口回归：nextUrl 是部署域名时，Host 仍应让真实登录通过', () => {
    const hosts = resolveSiteHosts(
      {
        host: 'app.lokfeel.com',
        forwardedHost: 'app.lokfeel.com, proxy.internal',
        nextUrlOrigin: DEPLOY,
        ...NO_CONFIG,
      },
      {},
    )
    expect(hosts).toContain('app.lokfeel.com')
    // 部署域名也会被收进来（它是 nextUrl 的来源），但不会让真实域名被排除
    expect(hosts).toContain(new URL(DEPLOY).host)

    expect(isSameSiteRequest('https://app.lokfeel.com', hosts)).toBe(true)
    expect(isSameSiteRequest('https://app.lokfeel.com/login', hosts)).toBe(true) // Referer 形态
  })

  it('★ 只给 nextUrl（部署域名）而 Host 缺失时，真实域名仍靠配置项通过', () => {
    const hosts = resolveSiteHosts(
      { nextUrlOrigin: DEPLOY, configuredOrigins: [PUBLIC] },
      {},
    )
    expect(isSameSiteRequest('https://app.lokfeel.com', hosts)).toBe(true)
  })

  it('外域一律不通过', () => {
    const hosts = resolveSiteHosts(
      { host: 'app.lokfeel.com', nextUrlOrigin: PUBLIC, ...NO_CONFIG },
      {},
    )
    for (const evil of [
      'https://evil.com',
      'https://app.lokfeel.com.evil.com',
      'https://evilapp.lokfeel.com',
      'https://lokfeel.com',
      'http://app.lokfeel.com', // 同 host 即通过（host 不含 scheme），见下方说明
    ]) {
      const result = isSameSiteRequest(evil, hosts)
      if (evil === 'http://app.lokfeel.com') {
        // 只比对 host，不比对 scheme —— 与修复前语义一致（降级到 http 不会跨站）
        expect(result).toBe(true)
      } else {
        expect(result).toBe(false)
      }
    }
  })

  it('缺失/不可解析的来源必须判为不匹配', () => {
    const hosts = resolveSiteHosts({ host: 'app.lokfeel.com', ...NO_CONFIG }, {})
    expect(isSameSiteRequest(null, hosts)).toBe(false)
    expect(isSameSiteRequest('', hosts)).toBe(false)
    expect(isSameSiteRequest('null', hosts)).toBe(false) // 沙箱 iframe 的不透明 Origin
    expect(isSameSiteRequest('not a url', hosts)).toBe(false)
  })

  it('裸 host 与完整 URL 都能解析；非法值不混入', () => {
    const hosts = resolveSiteHosts(
      {
        host: 'APP.LOKFEEL.COM:443', // 大写 + 默认端口都要归一化掉
        forwardedHost: 'evil.com/path', // 带路径的裸 host 视为非法
        nextUrlOrigin: 'https://from-nexturl.example',
        configuredOrigins: ['not a url', 'javascript:alert(1)'],
      },
      {},
    )
    expect(hosts).toEqual(['app.lokfeel.com', 'from-nexturl.example'])
    // 归一化后 Host(带:443) 与 Origin(不带端口) 能对上
    expect(isSameSiteRequest('https://app.lokfeel.com', hosts)).toBe(true)
  })

  it('claimedHost 归一化大小写与路径', () => {
    expect(claimedHost('https://App.LokFeel.com/login')).toBe('app.lokfeel.com')
    expect(claimedHost('null')).toBe('')
    expect(claimedHost(undefined)).toBe('')
  })

  it('默认从环境变量取配置域名', () => {
    const hosts = resolveSiteHosts({ nextUrlOrigin: DEPLOY }, { NEXT_PUBLIC_APP_URL: PUBLIC })
    expect(hosts).toContain('app.lokfeel.com')
  })
})

describe('absoluteUrlFor', () => {
  it('相对路径拼到公开 origin 上', () => {
    expect(absoluteUrlFor(PUBLIC, '/dashboard')).toBe(`${PUBLIC}/dashboard`)
    expect(absoluteUrlFor(PUBLIC, '/login?error=x')).toBe(`${PUBLIC}/login?error=x`)
  })

  it('origin 为空时退回相对路径（仍不会被解析到外域）', () => {
    expect(absoluteUrlFor('', '/dashboard')).toBe('/dashboard')
  })
})
