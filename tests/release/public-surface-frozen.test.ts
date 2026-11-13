/**
 * GA T2 · 公开面冻结闸门的判定层单测
 *
 * 守两件事：
 *  1. **默认冻结**（未设置 env ⇒ 冻结）。事故的成因就是"默认开放 + 忘了标记"，
 *     所以这里必须能用负控证明"漏配不会导致公开"。
 *  2. **精确匹配**：`/product-xyz`、`/helps`、`/product/detail` 都不能被误伤/漏拦。
 */
import assert from 'node:assert/strict'

import {
  FROZEN_PUBLIC_ROUTES,
  isFrozenPublicRoute,
  isPublicLinkVisible,
  resolvePublicSurfaceFrozen,
  visiblePublicLinks,
} from '../../src/config/public-surface'

describe('GA T2 · resolvePublicSurfaceFrozen', () => {
  it('未设置 ⇒ 冻结（fail-closed，漏配不会变成对外承诺）', () => {
    assert.equal(resolvePublicSurfaceFrozen(undefined), true)
  })

  it("显式 'false' ⇒ 解冻（这是唯一的解冻方式）", () => {
    assert.equal(resolvePublicSurfaceFrozen('false'), false)
  })

  it("不做聪明解析：'0' / 'no' / 'FALSE' / '' 一律仍冻结", () => {
    for (const raw of ['0', 'no', 'off', 'FALSE', 'False', '']) {
      assert.equal(resolvePublicSurfaceFrozen(raw), true, `raw=${JSON.stringify(raw)} 必须仍冻结`)
    }
  })
})

describe('GA T2 · isFrozenPublicRoute', () => {
  it('五个路由全部命中', () => {
    for (const route of FROZEN_PUBLIC_ROUTES) {
      assert.equal(isFrozenPublicRoute(route), true, route)
    }
  })

  it('容忍尾斜杠（/product/ 与 /product 等价）', () => {
    assert.equal(isFrozenPublicRoute('/product/'), true)
    assert.equal(isFrozenPublicRoute('/help/'), true)
  })

  it('不做前缀匹配：相似路径不得被误伤', () => {
    for (const path of ['/product-xyz', '/helps', '/product/detail', '/solutions2', '/']) {
      assert.equal(isFrozenPublicRoute(path), false, path)
    }
  })
})

describe('GA T2 · 导航/页脚过滤', () => {
  it('冻结时：五个路由不可见，其它链接保留', () => {
    assert.equal(isPublicLinkVisible('/product', true), false)
    assert.equal(isPublicLinkVisible('/pricing', true), true)
    assert.equal(isPublicLinkVisible('/about', true), true)
  })

  it('解冻时：五个路由恢复可见', () => {
    assert.equal(isPublicLinkVisible('/product', false), true)
  })

  it('过滤保持原有顺序，且不产生重复', () => {
    const links = [
      { label: 'Product', href: '/product' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Help', href: '/help' },
      { label: 'About', href: '/about' },
    ]
    const visible = visiblePublicLinks(links, true)
    assert.deepEqual(
      visible.map((l) => l.href),
      ['/pricing', '/about'],
    )
    assert.equal(new Set(visible.map((l) => l.href)).size, visible.length)
  })

  it('负控：全冻结路由的列表在冻结时为空（不是"照旧显示"）', () => {
    const links = FROZEN_PUBLIC_ROUTES.map((href) => ({ label: href, href }))
    assert.equal(visiblePublicLinks(links, true).length, 0)
    assert.equal(visiblePublicLinks(links, false).length, FROZEN_PUBLIC_ROUTES.length)
  })
})
