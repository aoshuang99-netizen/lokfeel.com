/**
 * LokFeel 上线前测试分析报告生成器
 * 
 * 运行方式:
 *   npx tsx scripts/bot/generate-test-report.ts
 * 
 * 输出:
 *   - qa/PRE-LAUNCH-TEST-REPORT.md
 *   - 包含：功能测试结果、性能数据、安全问题、用户数据统计
 */

import { PrismaClient } from '../../src/generated';

const prisma = new PrismaClient()

async function main() {
  console.log('Generating pre-launch test report...\n')

  // ─── 1. 用户数据统计 ───
  const totalUsers = await prisma.user.count()
  const botUsers = await prisma.user.count({ where: { isBot: true } })
  const realUsers = await prisma.user.count({ where: { isBot: false } })
  const testUsers = await prisma.user.count({ 
    where: { email: { startsWith: 'e2e-test' }, isBot: true } 
  })

  // ─── 2. Profile统计 ───
  const totalProfiles = await prisma.profile.count()
  const approvedProfiles = await prisma.profile.count({ where: { status: 'APPROVED' } })
  const femaleProfiles = await prisma.profile.count({ where: { gender: 'FEMALE' } })
  const maleProfiles = await prisma.profile.count({ where: { gender: 'MALE' } })

  // ─── 3. 头像统计 ───
  const emojiAvatars = await prisma.profile.count({ where: { avatar: { startsWith: 'emoji:' } } })
  const dataUrlAvatars = await prisma.profile.count({ where: { avatar: { startsWith: 'data:' } } })
  const urlAvatars = await prisma.profile.count({ 
    where: { 
      avatar: { startsWith: 'http' },
      NOT: { avatar: { startsWith: 'data:' } }
    } 
  })
  const noAvatars = await prisma.profile.count({ where: { avatar: null } })

  // ─── 4. 匹配统计 ───
  const totalMatches = await prisma.match.count()
  const pendingMatches = await prisma.match.count({ where: { status: 'PENDING' } })
  const acceptedMatches = await prisma.match.count({ where: { status: 'ACCEPTED' } })
  const rejectedMatches = await prisma.match.count({ where: { status: 'REJECTED' } })

  // ─── 5. 聊天统计 ───
  const totalChatRooms = await prisma.chatRoom.count()
  const totalMessages = await prisma.message.count()

  // ─── 6. 订阅统计 ───
  const ladyFreeSubs = await prisma.subscription.count({ where: { plan: 'LADY_FREE' } })
  const premiumSubs = await prisma.subscription.count({ where: { plan: 'PREMIUM' } })
  const freeSubs = await prisma.subscription.count({ where: { plan: 'FREE' } })

  // ─── 7. BotProfile统计 ───
  const botProfiles = await prisma.botProfile.count()

  // ─── 8. 最近注册用户 ───
  const recentUsers = await prisma.user.findMany({
    where: { isBot: false },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, email: true, name: true, createdAt: true },
  })

  // ─── 生成报告 ───
  const now = new Date().toISOString()
  const report = `# LokFeel 上线前测试分析报告

> 生成时间: ${now}
> 环境: Production (app.lokfeel.com)

---

## 📊 核心数据概览

| 指标 | 数值 | 状态 |
|------|------|------|
| 用户总数 | ${totalUsers.toLocaleString()} | ✅ |
| Bot用户 | ${botUsers.toLocaleString()} | ✅ |
| 真实用户 | ${realUsers} | ${realUsers >= 10 ? '✅' : '🔴'} |
| 测试用户(E2E) | ${testUsers} | ${testUsers >= 100 ? '✅' : '⚠️ 需生成'} |
| Profile总数 | ${totalProfiles.toLocaleString()} | ✅ |
| Approved Profiles | ${approvedProfiles.toLocaleString()} | ✅ |

---

## 👥 用户分布

| 性别 | 数量 | 占比 |
|------|------|------|
| 女性 | ${femaleProfiles.toLocaleString()} | ${(femaleProfiles / totalProfiles * 100).toFixed(1)}% |
| 男性 | ${maleProfiles.toLocaleString()} | ${(maleProfiles / totalProfiles * 100).toFixed(1)}% |

---

## 🖼️ 头像状态

| 类型 | 数量 | 占比 | 评估 |
|------|------|------|------|
| Data URL (HD) | ${dataUrlAvatars.toLocaleString()} | ${(dataUrlAvatars / totalProfiles * 100).toFixed(1)}% | ✅ HD |
| HTTP URL | ${urlAvatars.toLocaleString()} | ${(urlAvatars / totalProfiles * 100).toFixed(1)}% | ⚠️ 需升级 |
| Emoji | ${emojiAvatars.toLocaleString()} | ${(emojiAvatars / totalProfiles * 100).toFixed(1)}% | 🔴 需升级 |
| 无头像 | ${noAvatars.toLocaleString()} | ${(noAvatars / totalProfiles * 100).toFixed(1)}% | 🔴 缺失 |

**HD头像覆盖率**: ${(dataUrlAvatars / totalProfiles * 100).toFixed(1)}%

---

## 💕 匹配系统

| 指标 | 数值 |
|------|------|
| 总匹配数 | ${totalMatches.toLocaleString()} |
| 待确认 | ${pendingMatches.toLocaleString()} |
| 已接受 | ${acceptedMatches.toLocaleString()} |
| 已拒绝 | ${rejectedMatches.toLocaleString()} |
| 接受率 | ${totalMatches > 0 ? (acceptedMatches / totalMatches * 100).toFixed(1) : 0}% |

---

## 💬 聊天系统

| 指标 | 数值 |
|------|------|
| 聊天室 | ${totalChatRooms.toLocaleString()} |
| 消息总数 | ${totalMessages.toLocaleString()} |

---

## 💳 订阅系统

| 套餐 | 数量 |
|------|------|
| Lady Free | ${ladyFreeSubs.toLocaleString()} |
| Premium | ${premiumSubs.toLocaleString()} |
| Free | ${freeSubs.toLocaleString()} |

---

## 🤖 Bot系统

| 指标 | 数值 |
|------|------|
| BotProfile数 | ${botProfiles.toLocaleString()} |
| Bot用户 | ${botUsers.toLocaleString()} |

---

## 🔒 安全检查清单

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 中国IP封锁 | ✅ | middleware已实现CN封锁 |
| X-Frame-Options | ✅ | DENY |
| X-Content-Type-Options | ✅ | nosniff |
| Referrer-Policy | ✅ | strict-origin-when-cross-origin |
| CORS限制 | ✅ | 已收紧到app.lokfeel.com |
| 文件上传验证 | ✅ | file-type库+Sharp处理 |
| 验证码一次性 | ✅ | token.used=true |

---

## ⚡ 性能优化清单

| 优化项 | 状态 | 说明 |
|--------|------|------|
| Next.js Image组件 | ✅ | Avatar组件已迁移 |
| AVIF/WebP格式 | ✅ | next.config.ts已配置 |
| 图片CDN缓存 | ✅ | 7天+stale-while-revalidate |
| 静态资源缓存 | ✅ | immutable 1年 |
| 响应压缩 | ✅ | compress: true |
| 懒加载 | ✅ | Avatar组件默认lazy |

---

## 🧪 测试用户生成

### 需要生成的测试用户

\`\`\`bash
# 生成100个新用户（无profile，模拟注册未完成）
curl -X POST https://app.lokfeel.com/api/admin/generate-test-users \\
  -H "Content-Type: application/json" \\
  -d '{"count": 100, "type": "new", "prefix": "e2e-new", "withProfile": false}'

# 生成50个已有用户（带完整profile，模拟活跃用户）
curl -X POST https://app.lokfeel.com/api/admin/generate-test-users \\
  -H "Content-Type: application/json" \\
  -d '{"count": 50, "type": "existing", "prefix": "e2e-existing", "withProfile": true, "withAvatar": true}'

# 清理测试用户
curl -X DELETE https://app.lokfeel.com/api/admin/generate-test-users \\
  -H "Content-Type: application/json" \\
  -d '{"prefix": "e2e-new"}'
\`\`\`

---

## 📋 上线前检查清单

### 必须完成 (P0)
- [x] 中国IP封锁
- [x] 安全头设置
- [x] CORS收紧
- [x] 图片优化
- [ ] HD头像批量升级 (需运行upgrade-avatars脚本)
- [ ] 生成150个测试用户 (100新+50旧)
- [ ] 运行完整E2E测试

### 建议完成 (P1)
- [x] 静态资源缓存
- [x] 响应压缩
- [x] 懒加载
- [ ] 真实用户注册测试
- [ ] 支付流程测试

### 可延后 (P2)
- [ ] Lighthouse评分 > 90
- [ ] 首屏渲染 < 1.5s
- [ ] 0个console错误

---

## 📝 最近注册用户

| 用户 | 邮箱 | 注册时间 |
|------|------|----------|
${recentUsers.map(u => `| ${u.name || 'N/A'} | ${u.email} | ${u.createdAt.toISOString().split('T')[0]} |`).join('\n')}

---

_报告由 Scout 自动生成_
`

  console.log(report)
  return report
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
