# LokFeel 数字用户头像生成系统方案

**版本**: v1.0
**日期**: 2026-04-12
**作者**: avatar-engineer
**状态**: 待评审

---

## 1. 执行摘要

为 2,271 名数字用户生成高质量、多样化、符合品牌调性的头像图片。本方案推荐采用 **AI 生成 + 风格化处理混合方案**，兼顾真实感、多样性和成本效益。

### 核心指标

| 指标 | 数值 |
|------|------|
| 用户数量 | 2,271 人 |
| 推荐分辨率 | 400×400px |
| 预计成本 | $45-180 |
| 预计生成时间 | 3-8 小时 |
| 多样性覆盖 | 5+ 种族 × 4+ 年龄组 × 2 性别 |

---

## 2. 技术方案对比与推荐

### 2.1 三种方案对比

| 维度 | AI生成 (推荐) | This Person Not Exist | 风格化头像 |
|------|--------------|------------------------|------------|
| **真实度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **多样性** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **品牌一致性** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **版权风险** | 低 | 低 | 中 |
| **单张成本** | $0.02-0.08 | 免费 | $0.01-0.03 |
| **总成本(2271张)** | $45-180 | $0 | $23-68 |
| **生成速度** | 中等 | 快 | 快 |
| **可定制性** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ |

### 2.2 推荐方案：AI生成 + 品牌风格优化

**推荐理由**：
1. ✅ **完全可控**：种族、年龄、发型、服装均可精确控制
2. ✅ **品牌一致**：可统一调色和滤镜，保持 LokFeel 高端感
3. ✅ **版权安全**：使用 Replicate/SD API 生成，无版权纠纷
4. ✅ **成本合理**：$0.02-0.08/张，2,271张约 $45-180

### 2.3 成本估算（详细）

```
方案A: Replicate API (SDXL)
- 基础模型: $0.02/张 × 2,271 = $45.42
- 额外增强: $0.01/张 × 2,271 = $22.71
- 合计: ~$68

方案B: OpenAI DALL-E 3
- $0.04/张 × 2,271 = $90.84
- 无需额外处理

方案C: 混合方案（推荐）
- 80% SDXL: 1,817张 × $0.02 = $36.34
- 20% DALL-E 3 精选: 454张 × $0.04 = $18.16
- 后期处理: $20
- 合计: ~$75
```

---

## 3. 头像风格指南

### 3.1 品牌调性定义

LokFeel 头像风格关键词：
- **核心**: 女性友好、高端感、自然真实
- **色彩**: 柔和暖色调，避免过于饱和
- **光影**: 自然光效，避免过曝或过暗
- **背景**: 简洁虚化或纯色，避免杂乱

### 3.2 多样性矩阵

```
种族: Caucasian, African, Asian, Hispanic, South Asian, Middle Eastern
年龄组: Young Adult (18-25), Adult (26-35), Middle (36-45), Mature (46-55)
性别: Male, Female
风格变体: Casual, Professional, Artistic, Outdoor, Indoor
```

### 3.3 基础 Prompt 模板

#### 女性头像模板
```markdown
A beautiful [AGE]-year-old [ETHNICITY] woman, natural headshot photo,
soft warm lighting, shallow depth of field, looking at camera with a gentle
smile, [STYLE] fashion, clean [BACKGROUND], Instagram-worthy, shot on iPhone,
natural skin texture, realistic, high quality portrait photography
```

#### 男性头像模板
```markdown
An attractive [AGE]-year-old [ETHNICITY] man, natural headshot photo,
soft warm lighting, shallow depth of field, confident but approachable
expression, looking at camera, [STYLE] fashion, clean [BACKGROUND],
Instagram-worthy, shot on iPhone, natural skin texture, realistic,
high quality portrait photography
```

### 3.4 Prompt 变量替换表

| 变量 | 可选值 |
|------|--------|
| `[AGE]` | 22, 25, 28, 32, 35, 38, 42, 45, 48, 52 |
| `[ETHNICITY]` | Caucasian, African American, East Asian, Hispanic/Latino, South Asian, Middle Eastern |
| `[STYLE]` | casual everyday, smart casual, outdoor adventure, coffee shop vibe, professional business |
| `[BACKGROUND]` | bokeh city lights, nature park, neutral studio, home interior, beach sunset |

### 3.5 负面 Prompt（必填）

```markdown
ugly, deformed, disfigured, bad anatomy, bad proportions,
low quality, blurry, cartoon, anime, illustration, painting,
artwork, text overlay, watermark, logo, branded content,
filter: Instagram filter,过度美颜,过度磨皮,
nsfw, nude, inappropriate clothing
```

---

## 4. 批量生成脚本设计

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    AvatarGenerator                          │
├─────────────────────────────────────────────────────────────┤
│  Config: 用户配置文件 (gender, ethnicity, age distribution)  │
├─────────────────────────────────────────────────────────────┤
│  DiversityMatrix: 多样性矩阵生成器                          │
├─────────────────────────────────────────────────────────────┤
│  PromptBuilder: Prompt模板 + 变量替换                        │
├─────────────────────────────────────────────────────────────┤
│  ImageGenerator: API调用 (Replicate/OpenAI)                │
├─────────────────────────────────────────────────────────────┤
│  PostProcessor: 统一尺寸、格式、CDN上传                      │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 核心代码实现

#### 4.2.1 多样性矩阵生成器

```typescript
// src/scripts/avatar/diversity-matrix.ts

interface AvatarConfig {
  userId: string;
  gender: 'male' | 'female';
  ethnicity: Ethnicity;
  age: number;
  style: Style;
}

type Ethnicity = 'caucasian' | 'african' | 'asian' | 'hispanic' | 'south_asian' | 'middle_eastern';
type Style = 'casual' | 'professional' | 'outdoor' | 'artistic' | 'indoor';

const DIVERSITY_CONFIG = {
  genderRatio: { male: 0.45, female: 0.55 },
  ethnicityDistribution: {
    caucasian: 0.35,
    african: 0.15,
    asian: 0.25,
    hispanic: 0.12,
    south_asian: 0.08,
    middle_eastern: 0.05
  },
  ageDistribution: {
    youngAdult: 0.30,    // 18-25
    adult: 0.40,         // 26-35
    middle: 0.22,       // 36-45
    mature: 0.08        // 46-55
  },
  styles: ['casual', 'professional', 'outdoor', 'artistic', 'indoor']
};

function generateDiversityMatrix(count: number): AvatarConfig[] {
  const configs: AvatarConfig[] = [];
  const usedCombinations = new Set<string>();

  for (let i = 0; i < count; i++) {
    const gender = weightedRandom(DIVERSITY_CONFIG.genderRatio);
    const ethnicity = weightedRandom(DIVERSITY_CONFIG.ethnicityDistribution);
    const ageGroup = weightedRandom(DIVERSITY_CONFIG.ageDistribution);
    const age = getAgeInGroup(ageGroup);
    const style = randomChoice(DIVERSITY_CONFIG.styles);

    // 避免完全重复的组合
    const combo = `${gender}-${ethnicity}-${ageGroup}`;
    if (usedCombinations.has(combo)) {
      i--; // 重试
      continue;
    }
    usedCombinations.add(combo);

    configs.push({
      userId: `bot_${i.toString().padStart(4, '0')}`,
      gender,
      ethnicity,
      age,
      style
    });
  }

  return configs;
}
```

#### 4.2.2 Prompt 构建器

```typescript
// src/scripts/avatar/prompt-builder.ts

interface PromptConfig {
  gender: 'male' | 'female';
  ethnicity: string;
  age: number;
  style: string;
}

function buildAvatarPrompt(config: PromptConfig): { positive: string; negative: string } {
  const ethnicityPrompts: Record<string, string> = {
    caucasian: 'white',
    african: 'African descent, rich dark skin',
    asian: 'East Asian features',
    hispanic: 'Hispanic/Latino features',
    south_asian: 'South Asian features',
    middle_eastern: 'Middle Eastern features'
  };

  const stylePrompts: Record<string, string> = {
    casual: 'casual everyday wear, comfortable clothing, relaxed vibe',
    professional: 'smart casual attire, business casual, polished look',
    outdoor: 'outdoor adventure style, nature backdrop, energetic',
    artistic: 'creative artistic expression, unique style, bohemian',
    indoor: 'cozy indoor setting, coffee shop aesthetic, warm ambiance'
  };

  const backgroundPrompts: Record<string, string> = {
    casual: 'urban street background',
    professional: 'clean neutral background',
    outdoor: 'bokeh nature lights',
    artistic: 'colorful artistic background',
    indoor: 'cozy cafe interior'
  };

  const genderPrompt = config.gender === 'female'
    ? `A beautiful ${config.age}-year-old ${ethnicityPrompts[config.ethnicity]} woman`
    : `An attractive ${config.age}-year-old ${ethnicityPrompts[config.ethnicity]} man`;

  const positive = `${genderPrompt}, natural headshot photo, soft warm lighting,
    shallow depth of field, looking at camera with a gentle smile,
    ${stylePrompts[config.style]}, ${backgroundPrompts[config.style]},
    Instagram-worthy, shot on iPhone, natural skin texture,
    realistic, high quality portrait photography, 8k uhd, high resolution`;

  const negative = `ugly, deformed, disfigured, bad anatomy, bad proportions,
    low quality, blurry, cartoon, anime, illustration, painting, artwork,
    text overlay, watermark, logo, branded content, oversaturated,
    excessive smoothing, plastic skin, doll-like, synthetic,
    nsfw, nude, inappropriate clothing`;

  return { positive, negative };
}
```

#### 4.2.3 图像生成器

```typescript
// src/scripts/avatar/image-generator.ts

import Replicate from 'replicate';

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

interface GenerationResult {
  userId: string;
  success: boolean;
  imageUrl?: string;
  error?: string;
}

async function generateAvatar(
  config: AvatarConfig
): Promise<GenerationResult> {
  const { positive, negative } = buildAvatarPrompt(config);

  try {
    const output = await replicate.run(
      'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1f35c527e5b05f',
      {
        input: {
          prompt: positive,
          negative_prompt: negative,
          width: 1024,
          height: 1024,
          num_inference_steps: 30,
          guidance_scale: 7.5,
          seed: Math.floor(Math.random() * 9999999999)
        }
      }
    );

    return {
      userId: config.userId,
      success: true,
      imageUrl: output[0]
    };
  } catch (error) {
    return {
      userId: config.userId,
      success: false,
      error: error.message
    };
  }
}

// 批量生成（带并发控制）
async function batchGenerate(
  configs: AvatarConfig[],
  concurrency: number = 5
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  const queue = [...configs];

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const config = queue.shift();
      const result = await generateAvatar(config);
      results.push(result);
      console.log(`Progress: ${results.length}/${configs.length}`);
    }
  });

  await Promise.all(workers);
  return results;
}
```

#### 4.2.4 完整批处理脚本

```typescript
// src/scripts/avatar/generate-all-avatars.ts

#!/usr/bin/env npx tsx

import * as fs from 'fs';
import * as path from 'path';
import { generateDiversityMatrix } from './diversity-matrix';
import { batchGenerate } from './image-generator';
import { uploadToCDN } from './cdn-uploader';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const OUTPUT_DIR = path.join(__dirname, '../../public/avatars');
const BATCH_SIZE = 50;
const CONCURRENCY = 5;

interface GenerationResult {
  userId: string;
  success: boolean;
  imageUrl?: string;
  localPath?: string;
  error?: string;
}

async function main() {
  console.log('🎨 LokFeel Avatar Generation Starting...');
  console.log(`📁 Output Directory: ${OUTPUT_DIR}`);

  // 1. 读取需要生成头像的用户
  const users = await prisma.user.findMany({
    where: { avatarUrl: null },
    select: { id: true }
  });

  console.log(`👥 Users needing avatars: ${users.length}`);

  // 2. 生成多样性矩阵
  const diversityMatrix = generateDiversityMatrix(users.length);

  // 3. 批量生成头像
  const allResults: GenerationResult[] = [];

  for (let i = 0; i < diversityMatrix.length; i += BATCH_SIZE) {
    const batch = diversityMatrix.slice(i, i + BATCH_SIZE);
    console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(diversityMatrix.length / BATCH_SIZE)}`);

    const batchResults = await batchGenerate(batch, CONCURRENCY);
    allResults.push(...batchResults);

    // 保存中间结果
    saveIntermediateResults(allResults, i + BATCH_SIZE);
  }

  // 4. 上传到 CDN
  console.log('\n☁️ Uploading to CDN...');
  const cdnResults = await uploadResultsToCDN(allResults);

  // 5. 更新数据库
  console.log('\n💾 Updating database...');
  await updateDatabaseWithAvatars(cdnResults);

  // 6. 生成报告
  generateReport(allResults, cdnResults);
}

main()
  .then(() => {
    console.log('\n✅ Avatar generation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
```

---

## 5. 头像存储与 CDN 方案

### 5.1 存储架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Vercel Blob│ ──► │   Images    │ ──► │   CDN Edge  │
│  (Primary)   │     │  Processing │     │   (Global)  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Fallback:  │     │   WebP      │     │  Auto-OPT   │
│  Local FS   │     │  Conversion │     │  (Responsive)│
└─────────────┘     └─────────────┘     └─────────────┘
```

### 5.2 推荐方案：Vercel Blob + Cloudflare CDN

| 组件 | 方案 | 成本 |
|------|------|------|
| 主存储 | Vercel Blob | $0.01/GB |
| CDN | Cloudflare Images | 免费 (50GB/月) |
| 备份 | Local Filesystem | $0 |
| **总计** | | **$0-5/月** |

### 5.3 CDN 上传脚本

```typescript
// src/scripts/avatar/cdn-uploader.ts

import { put } from '@vercel/blob';

interface UploadResult {
  userId: string;
  success: boolean;
  cdnUrl?: string;
  error?: string;
}

async function uploadToCDN(
  userId: string,
  imageData: Buffer
): Promise<UploadResult> {
  const filename = `avatars/${userId}.webp`;

  try {
    const blob = await put(filename, imageData, {
      contentType: 'image/webp',
      access: 'public',
    });

    return {
      userId,
      success: true,
      cdnUrl: blob.url
    };
  } catch (error) {
    return {
      userId,
      success: false,
      error: error.message
    };
  }
}

async function uploadResultsToCDN(
  results: GenerationResult[]
): Promise<UploadResult[]> {
  const uploads: UploadResult[] = [];

  for (const result of results) {
    if (!result.success || !result.localPath) continue;

    const imageData = fs.readFileSync(result.localPath);
    const uploadResult = await uploadToCDN(result.userId, imageData);
    uploads.push(uploadResult);

    console.log(`📤 Uploaded: ${result.userId} -> ${uploadResult.cdnUrl}`);
  }

  return uploads;
}
```

### 5.4 图像后处理流水线

```typescript
// src/scripts/avatar/post-processor.ts

import sharp from 'sharp';

interface ProcessedImage {
  userId: string;
  originalPath: string;
  processedPath: string;
  webpPath: string;
}

async function processAvatar(
  inputPath: string,
  userId: string
): Promise<ProcessedImage> {
  const outputDir = path.join(OUTPUT_DIR, 'processed');
  const webpPath = path.join(outputDir, `${userId}.webp`);

  await sharp(inputPath)
    .resize(400, 400, {
      fit: 'cover',
      position: 'center'
    })
    .webp({ quality: 85 })
    .toFile(webpPath);

  return {
    userId,
    originalPath: inputPath,
    processedPath: webpPath.replace('.webp', '.jpg'),
    webpPath
  };
}
```

---

## 6. 质量保证流程

### 6.1 自动质量检查

```typescript
// src/scripts/avatar/quality-checker.ts

interface QualityResult {
  userId: string;
  passed: boolean;
  issues: string[];
  score: number;
}

async function checkImageQuality(
  imagePath: string,
  userId: string
): Promise<QualityResult> {
  const issues: string[] = [];
  let score = 100;

  // 1. 检查文件大小
  const stats = fs.statSync(imagePath);
  if (stats.size < 5000) {
    issues.push('File too small - may be corrupted');
    score -= 30;
  }
  if (stats.size > 5000000) {
    issues.push('File too large - optimization needed');
    score -= 10;
  }

  // 2. 检查图像尺寸
  const metadata = await sharp(imagePath).metadata();
  if (metadata.width < 200 || metadata.height < 200) {
    issues.push('Image too small');
    score -= 40;
  }
  if (Math.abs((metadata.width || 0) - (metadata.height || 0)) > 50) {
    issues.push('Image not square');
    score -= 20;
  }

  // 3. 检查颜色分布（避免全黑/全白）
  const { dominant } = await sharp(imagePath)
    .resize(1, 1)
    .raw()
    .toBuffer()
    .then(buf => {
      const r = buf[0];
      const g = buf[1];
      const b = buf[2];
      const brightness = (r + g + b) / 3;
      return { dominant: { r, g, b, brightness } };
    });

  if (dominant.brightness < 20) {
    issues.push('Image too dark');
    score -= 30;
  }
  if (dominant.brightness > 235) {
    issues.push('Image too bright');
    score -= 30;
  }

  return {
    userId,
    passed: score >= 70 && issues.length === 0,
    issues,
    score
  };
}
```

### 6.2 人工抽检流程

- **自动抽检率**: 100%（所有图片）
- **人工抽检率**: 随机 5% 抽检
- **重生成阈值**: 通过率 < 95% 时触发

---

## 7. 执行时间表

| 阶段 | 任务 | 时长 | 状态 |
|------|------|------|------|
| 1 | 环境准备（API Keys 配置） | 10 min | ⏳ 待执行 |
| 2 | 多样性矩阵生成 | 5 min | ⏳ 待执行 |
| 3 | 头像批量生成（2,271张） | 3-4 hours | ⏳ 待执行 |
| 4 | 质量检查 | 15 min | ⏳ 待执行 |
| 5 | CDN 上传 | 30 min | ⏳ 待执行 |
| 6 | 数据库更新 | 10 min | ⏳ 待执行 |
| **总计** | | **~4.5 小时** | |

---

## 8. 附录

### 8.1 环境变量配置

```bash
# .env.local
REPLICATE_API_TOKEN=r8_xxxxxxx
OPENAI_API_KEY=sk-xxxxxxx
VERCEL_BLOB_TOKEN=Axxxxxxx
```

### 8.2 依赖安装

```bash
npm install replicate sharp @vercel/blob
npm install -D @types/sharp
```

### 8.3 执行命令

```bash
# 开发环境测试（生成10张）
npx tsx src/scripts/avatar/generate-all-avatars.ts --limit 10

# 生产环境全量生成
npx tsx src/scripts/avatar/generate-all-avatars.ts

# 仅检查质量
npx tsx src/scripts/avatar/quality-checker.ts --batch all
```

---

**文档状态**: ✅ 已实现
**实现日期**: 2026-04-12

## 实现文件

| 文件 | 说明 |
|------|------|
| `src/lib/bot/avatar-generator.ts` | BotAvatarGenerator 类 |
| `scripts/bot/generate-avatars.ts` | 批量生成 CLI 脚本 |

## 与 bot-architect 架构的集成

- ✅ 实现了 `generateFromTPDNE(config)` - ThisPersonDoesNotExist
- ✅ 实现了 `generateFromRandomUser(config)` - RandomUser.me API
- ✅ 实现了 `generateFromUIAvatars(name)` - UI Avatars 备选
- ✅ 实现了 `batchGenerate(bots, options)` - 批量生成
- ✅ 内置图片验证（文件类型、大小）
- ✅ 集成 BotAvatar 模型保存记录

## 下一步行动

1. 等待 BotProfile 表迁移完成
2. 执行 `npx tsx scripts/bot/generate-avatars.ts --dry-run` 预览
3. 执行 `npx tsx scripts/bot/generate-avatars.ts` 开始生成
