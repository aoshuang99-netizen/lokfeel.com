/**
 * LokFeel Bot Avatar Generation Script
 * 
 * 为数字用户生成AI头像
 * - 女性用户：使用卡通头像（8种风格）
 * - 男性用户：使用真实风格头像
 * 
 * 使用 Pollinations AI 生成头像
 * Usage: npx ts-node scripts/generate-bot-avatars.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '../src/generated';
import fetch from 'node-fetch';

const prisma = new PrismaClient();

// Avatar generation configuration
const CONFIG = {
  // Female cartoon avatar styles
  FEMALE_AVATAR_STYLES: [
    'cute anime girl with {hairColor} hair, friendly smile, soft lighting, pastel colors, portrait, white background, digital art',
    'stylized cartoon woman with {hairColor} hair, confident expression, modern illustration style, clean lines, portrait',
    'friendly female character with {hairColor} hair, warm smile, flat design illustration, minimal background',
    'professional woman avatar with {hairColor} hair, approachable look, vector art style, solid color background',
    'young woman illustration with {hairColor} hair, cheerful expression, contemporary art style, soft shadows',
    'modern female portrait with {hairColor} hair, natural look, digital illustration, gradient background',
    'elegant woman avatar with {hairColor} hair, gentle smile, artistic illustration, muted colors',
    'casual female character with {hairColor} hair, relaxed vibe, cartoon style, simple background',
  ],
  
  // Male realistic avatar styles
  MALE_AVATAR_STYLES: [
    'professional headshot of a {age}-year-old man with {hairColor} hair, friendly expression, studio lighting, neutral background, high quality portrait photography style',
    'casual portrait of a {age}-year-old man with {hairColor} hair, confident smile, natural lighting, blurred background, realistic photo style',
    'friendly man in his {age}s with {hairColor} hair, approachable look, soft studio lighting, clean background, photorealistic',
    'professional man {age} years old with {hairColor} hair, warm smile, corporate headshot style, neutral gray background',
    'natural portrait of {age}-year-old man with {hairColor} hair, genuine expression, outdoor lighting, bokeh background, realistic',
    'modern headshot of man in his {age}s with {hairColor} hair, relaxed pose, professional lighting, solid background, high resolution',
    'casual photo of {age}-year-old man with {hairColor} hair, friendly demeanor, natural light, simple background, portrait photography',
    'confident man {age} years old with {hairColor} hair, professional look, studio portrait, neutral background, sharp focus',
  ],
  
  HAIR_COLORS: ['brown', 'black', 'blonde', 'dark brown', 'light brown', 'auburn'],
  
  // Pollinations AI API
  POLLINATIONS_URL: 'https://image.pollinations.ai/prompt/',
  
  // Output directory (relative to project root)
  OUTPUT_DIR: '../public/bot-avatars',
  
  // Batch settings
  BATCH_SIZE: 10,
  DELAY_MS: 2000, // 2 seconds between requests to avoid rate limiting
};

/**
 * Generate avatar prompt based on user profile
 */
function generatePrompt(gender: string, age: number, styleIndex: number): string {
  const hairColor = CONFIG.HAIR_COLORS[Math.floor(Math.random() * CONFIG.HAIR_COLORS.length)];
  
  if (gender === 'female') {
    const template = CONFIG.FEMALE_AVATAR_STYLES[styleIndex % CONFIG.FEMALE_AVATAR_STYLES.length];
    return template.replace('{hairColor}', hairColor);
  } else {
    const template = CONFIG.MALE_AVATAR_STYLES[styleIndex % CONFIG.MALE_AVATAR_STYLES.length];
    return template.replace('{age}', age.toString()).replace('{hairColor}', hairColor);
  }
}

/**
 * Download image from URL
 */
async function downloadImage(url: string, outputPath: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const buffer = await response.buffer();
    fs.writeFileSync(outputPath, buffer);
    return true;
  } catch (error) {
    console.error(`  ❌ Download failed:`, error);
    return false;
  }
}

/**
 * Generate avatar using Pollinations AI
 */
async function generateAvatar(prompt: string, seed: string): Promise<string | null> {
  try {
    // Pollinations AI format: URL encode prompt and add seed
    const encodedPrompt = encodeURIComponent(prompt);
    const url = `${CONFIG.POLLINATIONS_URL}${encodedPrompt}?seed=${seed}&width=512&height=512&nologo=true`;
    
    return url;
  } catch (error) {
    console.error('  ❌ Generation failed:', error);
    return null;
  }
}

/**
 * Process a batch of users
 */
async function processBatch(
  users: Array<{ id: string; email: string; profile: { gender: string; age: number } | null }>,
  batchNumber: number,
  totalBatches: number
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  console.log(`\n📝 Processing Batch ${batchNumber}/${totalBatches} (${users.length} users)`);

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const progress = ((batchNumber - 1) * CONFIG.BATCH_SIZE) + i + 1;
    
    if (!user.profile) {
      console.log(`  ⚠️ User ${user.email} has no profile, skipping`);
      failed++;
      continue;
    }

    const gender = user.profile.gender === 'FEMALE' ? 'female' : 'male';
    const age = user.profile.age;
    const styleIndex = Math.floor(Math.random() * 8);
    
    // Generate prompt
    const prompt = generatePrompt(gender, age, styleIndex);
    
    // Generate avatar URL
    const avatarUrl = await generateAvatar(prompt, user.id);
    
    if (avatarUrl) {
      // Update user profile with new avatar
      try {
        await prisma.profile.update({
          where: { userId: user.id },
          data: { avatar: avatarUrl },
        });
        success++;
        process.stdout.write(`\r  ✅ Generated ${progress}/${users.length * totalBatches}`);
      } catch (error) {
        console.error(`\n  ❌ Failed to update ${user.email}:`, error);
        failed++;
      }
    } else {
      failed++;
    }

    // Delay between requests
    if (i < users.length - 1) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_MS));
    }
  }

  return { success, failed };
}

/**
 * Main function
 */
async function main() {
  console.log('🎨 LokFeel Bot Avatar Generation Script');
  console.log('=======================================\n');

  try {
    // Get all bot users
    console.log('🔍 Fetching bot users from database...');
    const botUsers = await prisma.user.findMany({
      where: { isBot: true },
      select: {
        id: true,
        email: true,
        profile: {
          select: {
            gender: true,
            age: true,
          },
        },
      },
    });

    console.log(`  ✅ Found ${botUsers.length} bot users\n`);

    if (botUsers.length === 0) {
      console.log('⚠️ No bot users found. Please run import-bot-users.ts first.');
      return;
    }

    // Confirm before proceeding
    console.log(`⚠️ This will generate AI avatars for ${botUsers.length} users.`);
    console.log(`⏱️ Estimated time: ${Math.ceil((botUsers.length * CONFIG.DELAY_MS) / 1000 / 60)} minutes\n`);
    
    // Process in batches
    const totalBatches = Math.ceil(botUsers.length / CONFIG.BATCH_SIZE);
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < botUsers.length; i += CONFIG.BATCH_SIZE) {
      const batch = botUsers.slice(i, i + CONFIG.BATCH_SIZE);
      const batchNumber = Math.floor(i / CONFIG.BATCH_SIZE) + 1;

      const result = await processBatch(batch, batchNumber, totalBatches);
      totalSuccess += result.success;
      totalFailed += result.failed;

      // Delay between batches
      if (i + CONFIG.BATCH_SIZE < botUsers.length) {
        console.log(`\n  ⏳ Waiting before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log('\n\n✅ Avatar Generation Complete!');
    console.log('==============================');
    console.log(`  📊 Total Users: ${botUsers.length}`);
    console.log(`  ✅ Success: ${totalSuccess}`);
    console.log(`  ❌ Failed: ${totalFailed}`);
    console.log(`  📈 Success Rate: ${((totalSuccess / botUsers.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('\n❌ Generation failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main();
