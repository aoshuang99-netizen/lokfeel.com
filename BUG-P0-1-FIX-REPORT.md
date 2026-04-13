# BUG-P0-1 头像上传安全漏洞修复报告

## 修复时间
2026-04-12 14:20

## 漏洞概述
- **漏洞ID**: BUG-P0-1
- **严重程度**: P0 (Critical)
- **影响组件**: `/api/upload` 路由
- **风险**: 攻击者可上传伪装成图片的可执行文件，导致RCE漏洞

## 修复内容

### 1. 文件签名验证 (已有 ✅)
- 使用 `file-type` 库验证实际文件内容
- 检测文件魔数 (magic bytes) 而非仅依赖MIME类型
- 返回错误：无法识别的文件类型

### 2. MIME类型白名单 (已有 ✅)
- 仅允许：`image/jpeg`, `image/png`, `image/webp`
- 拒绝所有其他文件类型

### 3. 文件大小限制 (已有 ✅)
- 最大：5MB (5 * 1024 * 1024 bytes)
- 返回错误：`File size exceeds 5MB limit`

### 4. 图片尺寸验证 (本次新增 ✅)
```typescript
// 新增常量
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;

// 新增验证函数
async function validateImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }>
```
- 使用 `sharp` 库读取图片元数据
- 验证最小尺寸：100x100px
- 验证最大尺寸：4000x4000px
- 返回错误：尺寸不符合要求

## 修复后验证顺序

```
1. 验证文件大小 (max 5MB)
2. 验证文件签名 (file-type库)
3. 验证MIME类型白名单
4. 验证图片尺寸 (sharp库)
5. 保存文件到磁盘
```

## 响应示例

成功响应 (201):
```json
{
  "success": true,
  "data": {
    "url": "/uploads/avatars/user123/abc.jpg",
    "filename": "abc.jpg",
    "size": 123456,
    "mimeType": "image/jpeg",
    "width": 800,
    "height": 600
  }
}
```

错误响应 (400):
```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Image dimensions too small. Minimum: 100x100px"
  }
}
```

## 影响范围

- `POST /api/upload` (Base64上传) - 已修复
- `PUT /api/upload` (FormData上传) - 已修复

## 依赖

| 库 | 用途 | 状态 |
|----|------|------|
| file-type@22.0.1 | 文件签名验证 | 已安装 |
| sharp@0.34.5 | 图片尺寸验证 | 已安装 (Next.js依赖) |

## 测试建议

1. **正常流程测试**:
   - 上传 100x100 到 4000x4000 尺寸的图片 ✅
   - 验证返回的 width/height 字段

2. **边界测试**:
   - 上传 99x99 尺寸 → 应拒绝 ❌
   - 上传 4001x4001 尺寸 → 应拒绝 ❌
   - 上传 1x100 尺寸 → 应拒绝 ❌

3. **安全测试**:
   - 上传 .exe 伪装成 .jpg → 应拒绝 ❌
   - 上传 .php 伪装成 .png → 应拒绝 ❌
   - 上传 6MB 文件 → 应拒绝 ❌
