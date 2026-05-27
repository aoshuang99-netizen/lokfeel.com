// ============================================================
// Bot Avatar Generator (DiceBear Edition)
// 数字用户头像生成管道 — 使用 DiceBear API（可靠、免费、不被墙）
// ============================================================

import { getDb } from '../db';
import { isMaleGender } from '@/lib/gender-utils';

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
// DiceBear 风格映射
// ============================================================

const DICEBEAR_BASE = 'https://api.dicebear.com/9.x';

// 不同风格对应不同 DiceBear 风格
const STYLE_MAP: Record<AvatarStyle, string> = {
  professional: 'avataaars',   // 商务卡通风格
  casual: 'adventurer',       // 休闲冒险风格
  artistic: 'shapes',          // 艺术几何风格
  natural: 'lorelei',         // 自然真实风格
};

// 肤色映射（DiceBear 支持 backgroundColor 参数）
const ETHNICITY_BG: Record<Ethnicity, string> = {
  caucasian: 'f3d5b3,d2b48c,c19a6b',    // 浅肤色
  african: '8b4513,a0522d,6b3410',         // 深肤色
  asian: 'f5cba7,e8b894,d4a574',          // 亚洲肤色
  hispanic: 'd2b48c,b8860b,a0522d',       // 拉丁肤色
  south_asian: 'f7d794,e8b894,d4a574',    // 南亚肤色
  middle_eastern: 'e8b894,d2b48c,c19a6b',  // 中东肤色
};

// ============================================================
// BotAvatarGenerator 类
// ============================================================

export class BotAvatarGenerator {
  /**
   * 生成 DiceBear 头像 URL（确定性：同 seed = 同头像）
   */
  generateDiceBearUrl(config: AvatarConfig, seed: string): string {
    const style = STYLE_MAP[config.style] || 'avataaars';
    const bgColor = ETHNICITY_BG[config.ethnicity] || 'b6b5b0,8b5cf6,a78bfa';
    const isFemale = config.gender === 'female';

    // DiceBear 参数
    const params = new URLSearchParams({
      seed: seed,
      backgroundColor: bgColor,
      radius: '50',
    });

    // 女性/男性使用不同参数（某些风格支持）
    if (isFemale) {
      params.set('eyebrow', 'raised');
    }

    return `${DICEBEAR_BASE}/${style}/svg?${params.toString()}`;
  }

  /**
   * 生成 UI Avatars 备用 URL（首字母头像）
   */
  generateUIAvatars(name: string, gender: Gender): string {
    const bgColor = gender === 'female' ? 'ec4899' : '3b82f6';
    const encodedName = encodeURIComponent(name);
    return `https://ui-avatars.com/api/?name=${encodedName}&size=256&background=${bgColor}&color=fff&bold=true&font-size=0.4`;
  }

  /**
   * 主生成方法 — 使用 DiceBear（确定性，不需要下载）
   */
  async generateAvatar(config: AvatarConfig, displayName: string): Promise<string> {
    // 用 displayName + gender 作为确定性 seed
    const seed = `${displayName}-${config.gender}-${config.style}`;

    // 策略1：DiceBear（主要方案，100% 可靠）
    const diceBearUrl = this.generateDiceBearUrl(config, seed);

    try {
      // 验证 URL 可访问（HEAD 请求）
      const checkResponse = await fetch(diceBearUrl, { method: 'HEAD' });
      if (checkResponse.ok) {
        return diceBearUrl;
      }
    } catch {
      // 继续备用方案
    }

    // 策略2：UI Avatars（备用方案，首字母头像）
    return this.generateUIAvatars(displayName, config.gender);
  }

  /**
   * 批量生成头像 URL（不需要下载，直接返回 DiceBear URL）
   */
  async batchGenerate(
    bots: BotProfile[],
    options: BatchGenerateOptions = { parallel: 5, retryFailed: true }
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const failed: BotProfile[] = [];

    console.log(`[AvatarGenerator] Starting batch generation for ${bots.length} bots`);

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
            gender: isMaleGender(bot.profile.gender) ? 'male' : 'female',
            mood: 'friendly',
          };

          const avatarUrl = await this.generateAvatar(config, bot.profile.displayName);
          results.set(bot.id, avatarUrl);

          console.log(`[AvatarGenerator] ✓ Generated avatar for ${bot.profile.displayName}`);
        } catch (error) {
          console.error(`[AvatarGenerator] ✗ Failed for ${bot.profile.displayName}: ${error}`);
          failed.push(bot);
        }
      });

      await Promise.all(promises);

      console.log(`[AvatarGenerator] Progress: ${results.size}/${bots.length} (${failed.length} failed)`);
    }

    // 重试失败项
    if (options.retryFailed && failed.length > 0) {
      console.log(`[AvatarGenerator] Retrying ${failed.length} failed avatars...`);
      for (const bot of failed) {
        const fallbackUrl = this.generateUIAvatars(bot.profile.displayName, 'female');
        results.set(bot.id, fallbackUrl);
        console.log(`[AvatarGenerator] ✓ Fallback avatar for ${bot.profile.displayName}`);
      }
    }

    return results;
  }

  /**
   * 批量生成并保存到数据库
   */
  async batchGenerateAndSave(bots: BotProfile[]): Promise<GenerationResult[]> {
    const results: GenerationResult[] = [];
    const avatarMap = await this.batchGenerate(bots);

    for (const bot of bots) {
      const url = avatarMap.get(bot.id);

      if (url) {
        try {
          await prisma.botAvatar.upsert({
            where: { botId: bot.id },
            create: {
              botId: bot.id,
              originalUrl: url,
              style: bot.avatarStyle || 'natural',
              ethnicity: bot.ethnicity || 'caucasian',
              status: 'active',
            },
            update: {
              originalUrl: url,
              style: bot.avatarStyle || 'natural',
              ethnicity: bot.ethnicity || 'caucasian',
              status: 'active',
            },
          });

          results.push({
            botId: bot.id,
            success: true,
            url,
          });
        } catch (error) {
          results.push({
            botId: bot.id,
            success: false,
            url,
            error: `Database error: ${error}`,
          });
        }
      } else {
        results.push({
          botId: bot.id,
          success: false,
          error: 'No avatar URL generated',
        });
      }
    }

    return results;
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private mapEthnicity(ethnicity?: string): Ethnicity {
    const mapping: Record<string, Ethnicity> = {
      CAUCASIAN: 'caucasian',
      AFRICAN_AMERICAN: 'african',
      AFRICAN: 'african',
      ASIAN: 'asian',
      HISPANIC_LATINO: 'hispanic',
      HISPANIC: 'hispanic',
      SOUTH_ASIAN: 'south_asian',
      MIDDLE_EASTERN: 'middle_eastern',
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
}

// ============================================================
// 导出默认实例
// ============================================================

export const avatarGenerator = new BotAvatarGenerator();
