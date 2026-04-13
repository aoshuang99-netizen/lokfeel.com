// ============================================================
// Bot Avatar Generator
// 数字用户头像生成管道
// 基于 bot-architect 的架构设计
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { getDb } from '../db';

const prisma = getDb();

// ============================================================
// 类型定义
// ============================================================

type AvatarStyle = 'professional' | 'casual' | 'artistic' | 'natural';
type Ethnicity = 'caucasian' | 'african' | 'asian' | 'hispanic' | 'south_asian' | 'middle_eastern';
type Gender = 'male' | 'female';

interface AvatarConfig {
  style: AvatarStyle;
  ethnicity: Ethnicity;
  age: number;
  gender: Gender;
  mood: 'happy' | 'friendly' | 'serious' | 'playful';
}

interface BotProfile {
  id: string;
  profileId: string;
  avatarStyle?: string;
  ethnicity?: string;
  profile: {
    age: number;
    gender: string;
    displayName: string;
  };
}

interface BatchGenerateOptions {
  parallel: number;
  retryFailed: boolean;
}

interface GenerationResult {
  botId: string;
  success: boolean;
  url?: string;
  error?: string;
}

// ============================================================
// BotAvatarGenerator 类
// ============================================================

export class BotAvatarGenerator {
  private services = {
    thispersondoesnotexist: 'https://thispersondoesnotexist.com/image',
    randomuser: 'https://randomuser.me/api/portraits',
    uiavatars: 'https://ui-avatars.com/api'
  };

  private downloadDir: string;

  constructor(downloadDir: string = './public/avatars/bots') {
    this.downloadDir = downloadDir;
    // 确保目录存在
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  // ============================================================
  // 策略1：This Person Does Not Exist (推荐)
  // ============================================================

  async generateFromTPDNE(config: AvatarConfig): Promise<string> {
    const seed = this.hashConfig(config);

    try {
      // 生成随机种子URL
      const imageUrl = `${this.services.thispersondoesnotexist}?t=${seed}`;

      // 下载并验证
      const imageBuffer = await this.downloadImage(imageUrl);
      const isValid = await this.validateImage(imageBuffer);

      if (isValid) {
        // 保存到本地
        const filename = `bot_${seed}.jpg`;
        const filepath = path.join(this.downloadDir, filename);
        fs.writeFileSync(filepath, imageBuffer);

        // 上传到存储
        return await this.uploadToStorage(filepath, filename);
      }

      // 验证失败则回退到其他方案
      console.log(`[TPDNE] Validation failed for ${seed}, trying RandomUser`);
      return await this.generateFromRandomUser(config);
    } catch (error) {
      console.log(`[TPDNE] Error: ${error}, falling back to RandomUser`);
      return await this.generateFromRandomUser(config);
    }
  }

  // ============================================================
  // 策略2：RandomUser.me API
  // ============================================================

  async generateFromRandomUser(config: AvatarConfig): Promise<string> {
    const gender = config.gender === 'male' ? 'men' : 'women';

    const ethnicityMap: Record<Ethnicity, string> = {
      caucasian: 'us',
      african: 'za',
      asian: 'jp',
      hispanic: 'mx',
      south_asian: 'in',
      middle_eastern: 'eg'
    };

    const nationality = ethnicityMap[config.ethnicity] || 'us';

    // 随机选择1-99的头像编号
    const imgId = Math.floor(Math.random() * 99) + 1;

    // 构建URL（使用多个备选 nationality 增加多样性）
    const nationalities = Object.values(ethnicityMap);
    const randomNat = nationalities[Math.floor(Math.random() * nationalities.length)];

    return `https://randomuser.me/api/portraits/${gender}/${imgId}.jpg`;
  }

  // ============================================================
  // 策略3：UI Avatars（最后备选）
  // ============================================================

  generateFromUIAvatars(name: string, background?: string): string {
    const encodedName = encodeURIComponent(name);
    const bg = background || this.randomBackgroundColor();
    return `https://ui-avatars.com/api/?name=${encodedName}&size=200&background=${bg}&color=fff&bold=true&font-size=0.4`;
  }

  // ============================================================
  // 主生成方法（智能选择策略）
  // ============================================================

  async generateAvatar(config: AvatarConfig): Promise<string> {
    // 优先尝试 TPDNE（完全AI生成，无法反向搜索）
    try {
      const url = await this.generateFromTPDNE(config);
      if (url) return url;
    } catch {
      // 继续尝试其他方案
    }

    // 回退到 RandomUser
    try {
      const url = await this.generateFromRandomUser(config);
      if (url) return url;
    } catch {
      // 继续
    }

    // 最后备选：UI Avatars
    return this.generateFromUIAvatars('Bot User');
  }

  // ============================================================
  // 批量生成头像
  // ============================================================

  async batchGenerate(
    bots: BotProfile[],
    options: BatchGenerateOptions = { parallel: 5, retryFailed: true }
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const failed: BotProfile[] = [];

    console.log(`[AvatarGenerator] Starting batch generation for ${bots.length} bots`);
    console.log(`[AvatarGenerator] Parallel: ${options.parallel}, RetryFailed: ${options.retryFailed}`);

    // 分块处理（控制并发）
    const chunks = this.chunkArray(bots, options.parallel);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[AvatarGenerator] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} bots)`);

      const promises = chunk.map(async (bot) => {
        try {
          const config: AvatarConfig = {
            style: (bot.avatarStyle as AvatarStyle) || 'natural',
            ethnicity: this.mapEthnicity(bot.ethnicity),
            age: bot.profile.age,
            gender: bot.profile.gender === 'MALE' ? 'male' : 'female',
            mood: 'friendly'
          };

          const avatarUrl = await this.generateAvatar(config);
          results.set(bot.id, avatarUrl);

          console.log(`[AvatarGenerator] ✓ Generated avatar for ${bot.profile.displayName}`);
        } catch (error) {
          console.error(`[AvatarGenerator] ✗ Failed for ${bot.profile.displayName}: ${error}`);
          failed.push(bot);
        }
      });

      await Promise.all(promises);

      // 进度报告
      console.log(`[AvatarGenerator] Progress: ${results.size}/${bots.length} (${failed.length} failed)`);
    }

    // 重试失败项
    if (options.retryFailed && failed.length > 0) {
      console.log(`[AvatarGenerator] Retrying ${failed.length} failed avatars...`);

      for (const bot of failed) {
        const avatarUrl = this.generateFromUIAvatars(bot.profile.displayName);
        results.set(bot.id, avatarUrl);
        console.log(`[AvatarGenerator] ✓ Fallback avatar for ${bot.profile.displayName}`);
      }
    }

    return results;
  }

  // ============================================================
  // 批量生成并保存到数据库
  // ============================================================

  async batchGenerateAndSave(bots: BotProfile[]): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];
    const avatarMap = await this.batchGenerate(bots);

    for (const bot of bots) {
      const url = avatarMap.get(bot.id);

      if (url) {
        try {
          // 保存到 BotAvatar 表
          await prisma.botAvatar.upsert({
            where: { botId: bot.id },
            create: {
              botId: bot.id,
              originalUrl: url,
              style: bot.avatarStyle || 'natural',
              ethnicity: bot.ethnicity || 'caucasian',
              status: 'active'
            },
            update: {
              originalUrl: url,
              style: bot.avatarStyle || 'natural',
              ethnicity: bot.ethnicity || 'caucasian',
              status: 'active'
            }
          });

          results.push({
            botId: bot.id,
            success: true,
            url
          });
        } catch (error) {
          results.push({
            botId: bot.id,
            success: false,
            url,
            error: `Database error: ${error}`
          });
        }
      } else {
        results.push({
          botId: bot.id,
          success: false,
          error: 'No avatar URL generated'
        });
      }
    }

    return results;
  }

  // ============================================================
  // 图片验证
  // ============================================================

  private async validateImage(buffer: Buffer): Promise<boolean> {
    // 1. 检查文件类型
    const fileType = await fileTypeFromBuffer(buffer);
    if (!fileType || !['image/jpeg', 'image/png', 'image/webp'].includes(fileType.mime)) {
      console.log(`[Validate] Invalid file type: ${fileType?.mime}`);
      return false;
    }

    // 2. 检查文件大小 (50KB - 5MB)
    const sizeKB = buffer.length / 1024;
    if (sizeKB < 50 || sizeKB > 5000) {
      console.log(`[Validate] Invalid file size: ${sizeKB}KB`);
      return false;
    }

    return true;
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async uploadToStorage(filepath: string, filename: string): Promise<string> {
    // TODO: 实现实际上传到 Vercel Blob / Cloudflare CDN
    // 目前返回本地路径
    return `/avatars/bots/${filename}`;
  }

  private hashConfig(config: AvatarConfig): string {
    const str = JSON.stringify(config);
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
  }

  private mapEthnicity(ethnicity?: string): Ethnicity {
    const mapping: Record<string, Ethnicity> = {
      CAUCASIAN: 'caucasian',
      AFRICAN_AMERICAN: 'african',
      AFRICAN: 'african',
      ASIAN: 'asian',
      HISPANIC_LATINO: 'hispanic',
      HISPANIC: 'hispanic',
      SOUTH_ASIAN: 'south_asian',
      MIDDLE_EASTERN: 'middle_eastern'
    };

    return mapping[ethnicity || ''] || 'caucasian';
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private randomBackgroundColor(): string {
    const colors = [
      '1abc9c', '2ecc71', '3498db', '9b59b6', 'f39c12',
      'e74c3c', '16a085', '27ae60', '2980b9', '8e44ad'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

// ============================================================
// 导出默认实例
// ============================================================

export const avatarGenerator = new BotAvatarGenerator();
