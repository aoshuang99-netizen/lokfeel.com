# LokFeel Nexus - 工作记忆

## 项目路径
- **nexus-app**: `D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-app`
- **nexus-landing**: `D:\HongQiang-Project\HongQiang-Project\20260402202519\nexus-landing`
- 技术栈: Next.js 15 + React 19 + TypeScript + Tailwind CSS (OKLCH) + Framer Motion

## 已完成的UE修复 (P0-P3)
- **P0** (4项): 键盘适配、头像裁剪、举报按钮、进度保存
- **P1** (5项): CTA优化、tooltip、通知文案、匹配Tab、Quick Start
- **P2** (5项): 滚动帧率、内存优化、表单验证、加载统一、长按延迟
- **P3** (5项): 自动保存、过滤器简化、图片加载、搜索、手势冲突

## 本期会话修复 (2026-05-04 & 2026-05-05)

### 2026-05-04 任务
- matches/route.ts的POST处理器分析：确认不需要（已有/api/matches/request）
- profile/page.tsx的死代码：移除未使用的step1ValidationRules常量
- matches/page.tsx性能优化：使用useMemo缓存tab counts计算
- matches/page.tsx：添加缺失的toast导入
- .env.production：移除敏感凭证占位符，添加注释说明通过Vercel设置

### 2026-05-05 安全修复
#### 认证安全
- 移除硬编码API密钥 "lokfeel-admin-2024"（4个文件）
- Demo凭证仅在开发模式可用
- OAuth登录重构（统一使用signIn方法）

#### 支付安全
- Stripe Webhook签名验证修复
- 订阅周期从硬编码30天改为从Stripe提取
- 退款API创建：`/api/admin/subscriptions/[id]/refund`

#### 加密安全
- 聊天系统 Math.random() → crypto.randomInt()
- 在线状态随机值改为固定 false

#### 数据安全
- 敏感日志清理（验证码、令牌等）
- API错误响应格式统一（22个文件）
- 统一错误格式：`{ error: string }`

#### 功能完成
- 图库照片数量限制（前后端20张限制）
- 每周匹配限制强制执行
- 管理后台RBAC权限控制

### 验证通过
- TypeScript编译检查通过（无错误）
- 敏感信息检查通过（无硬编码密钥）
- .env.example 配置正确

## 新增Hooks清单
- `useAutoSave.ts` - 防抖自动保存 + 草稿恢复
- `use-real-time-validation.ts` - 表单实时验证 (防抖300ms)
- `use-memory-optimize.ts` - 内存优化工具集 (6个Hook)
- `use-foldable-layout.ts` - 折叠屏适配 + 长按280ms

## 新增组件
- `page-state.tsx` - 统一加载/空/错误状态 (PageLoading/SectionEmpty/SectionError/ListEmpty/ListLoading)
- `lazy-image.tsx` - Intersection Observer懒加载 + next/image格式协商

## 注意事项
- PowerShell默认工作目录是WorkBuddy workspace而非项目目录，需每次Set-Location
- profile页面有图片预压缩(preCompressImage)逻辑，限制2048px长边
- 之前会话出现过EBUSY文件锁错误，需要用PowerShell Set-Content绕过
- TypeScript编译使用完整路径：`C:\nodejs\node-v22.13.1-win-x64\node.exe node_modules\typescript\bin\tsc --noEmit`
