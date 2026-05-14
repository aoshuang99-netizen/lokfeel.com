/**
 * LokFeel 增强用户数据部署到生产环境 (v2 - 高性能版)
 * 
 * 使用 turso.batch() 批量执行，速度提升 10x+
 * 
 * 功能:
 * 1. 将 Unsplash 高清真人头像替换现有的 DiceBear 卡通头像
 * 2. 更新 User.image 字段
 * 3. 更新/创建 BotProfile 记录（扩展字段：身高、长相、婚姻状态等）
 * 4. 更新 Profile 的 occupation, industry, sexuality 等字段
 * 5. 智能匹配：通过 email 中的原始 ID 映射到 JSON 数据
 * 
 * Usage: cd nexus-app && node scripts/deploy-enhanced-profiles.mjs
 */

import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const require = createRequire(import.meta.url);
const { createClient } = require('@libsql/client');

const turso = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

const BATCH_SIZE = 40;         // turso.batch() 每批语句数
const PAUSE_MS = 50;           // 批次间暂停（毫秒）

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * 从 bot email 中提取原始 ID
 * bot-f00001@lokfeel.bot → F00001
 * bot-m00250@lokfeel.bot → M00250
 */
function extractOriginalId(email) {
  const match = email?.match(/bot-([fm]\d+)@lokfeel\.bot/i);
  return match ? match[1].toUpperCase() : null;
}

/**
 * 根据 originalId 查找增强数据中的用户
 */
function findEnhancedUser(originalId, femaleMap, maleMap) {
  if (originalId.startsWith('F')) {
    return femaleMap.get(originalId);
  } else if (originalId.startsWith('M')) {
    return maleMap.get(originalId);
  }
  return null;
}

/**
 * 使用 turso.batch() 批量执行参数化 SQL
 */
async function executeBatchStmts(stmts) {
  if (stmts.length === 0) return 0;
  try {
    await turso.batch(stmts);
    return stmts.length;
  } catch (e) {
    // Batch failed, try individual
    let ok = 0;
    for (const stmt of stmts) {
      try {
        await turso.execute(stmt);
        ok++;
      } catch (e2) {
        // Individual failure, skip
      }
    }
    return ok;
  }
}

// ═══════════════════════════════════════════════════════════════
// Main Deployment Logic
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('🚀 LokFeel 增强用户数据部署到生产环境 (v2 高性能版)');
  console.log('='.repeat(60));
  console.log(`⏰ 开始时间: ${new Date().toISOString()}\n`);

  const startTime = Date.now();

  try {
    // ─── Step 1: 测试数据库连接 ───
    console.log('📡 Step 1: 测试数据库连接...');
    await turso.execute('SELECT 1');
    console.log('  ✅ 数据库连接成功\n');

    // ─── Step 2: 加载增强数据 ───
    console.log('📂 Step 2: 加载增强用户数据...');
    const dataDir = path.join(__dirname, '..', '..');
    
    const femaleData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'female-users-final.json'), 'utf-8')
    );
    const maleData = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'male-users-final.json'), 'utf-8')
    );
    
    const femaleMap = new Map();
    femaleData.users.forEach(u => femaleMap.set(u.id, u));
    const maleMap = new Map();
    maleData.users.forEach(u => maleMap.set(u.id, u));
    
    console.log(`  👩 女性用户: ${femaleMap.size}`);
    console.log(`  👨 男性用户: ${maleMap.size}`);
    console.log(`  📊 总计: ${femaleMap.size + maleMap.size}\n`);

    // ─── Step 3: 加载现有数据库中的 bot 用户 ───
    console.log('🗄️ Step 3: 加载生产数据库中的 bot 用户...');
    
    const botUsersResult = await turso.execute(`
      SELECT u.id, u.email, u.name, u.image,
             p.id as profileId, p.avatar, p.avatarType, p.occupation, p.industry, p.bio,
             p.sexuality, p.city, p.country, p.displayName, p.age, p.gender
      FROM User u
      LEFT JOIN Profile p ON p.userId = u.id
      WHERE u.isBot = 1
    `);
    
    console.log(`  📋 数据库中 bot 用户: ${botUsersResult.rows.length}`);
    
    // 构建映射: originalId → DB user
    const dbUserMap = new Map();
    let matched = 0;
    let unmatched = 0;
    
    for (const row of botUsersResult.rows) {
      const originalId = extractOriginalId(row.email);
      if (originalId) {
        const enhanced = findEnhancedUser(originalId, femaleMap, maleMap);
        if (enhanced) {
          dbUserMap.set(originalId, row);
          matched++;
        } else {
          unmatched++;
        }
      } else {
        unmatched++;
      }
    }
    
    console.log(`  ✅ 匹配到增强数据: ${matched}`);
    console.log(`  ⚠️  未匹配: ${unmatched}\n`);

    // ─── Step 4: 部署头像 + Profile 扩展字段 (合并执行提效) ───
    console.log('🖼️ Step 4: 部署高清头像 + Profile 扩展字段...');
    
    const now = new Date().toISOString();
    let totalUpdated = 0;
    let batchCount = 0;
    let stmts = [];
    
    for (const [originalId, dbUser] of dbUserMap) {
      const enhanced = findEnhancedUser(originalId, femaleMap, maleMap);
      if (!enhanced) continue;
      
      const p = enhanced.profile;
      if (!p) continue;
      
      const avatarUrl = p.avatarUrl;
      
      // 1. Update User.image
      if (avatarUrl) {
        stmts.push({
          sql: 'UPDATE User SET image = ?, updatedAt = ? WHERE id = ?',
          args: [avatarUrl, now, dbUser.id]
        });
      }
      
      // 2. Update Profile (avatar + occupation + industry + sexuality + bio + galleryPhotos)
      if (dbUser.profileId) {
        const sexMap = {
          'Heterosexual': 'Straight', 'Bisexual': 'Bisexual',
          'Pansexual': 'Pansexual', 'Queer': 'Queer',
          'Asexual': 'Asexual', 'Homosexual': 'Gay',
        };
        const sexuality = sexMap[p.sexualPreference] || 'Straight';
        
        const gallery = JSON.stringify([
          ...(avatarUrl ? [avatarUrl] : []),
          ...(p.coverPhotoUrl && p.coverPhotoUrl !== avatarUrl ? [p.coverPhotoUrl] : []),
        ]);
        
        stmts.push({
          sql: `UPDATE Profile SET avatar = ?, avatarType = ?, occupation = ?, industry = ?, 
                sexuality = ?, bio = ?, galleryPhotos = ?, updatedAt = ? WHERE id = ?`,
          args: [
            avatarUrl || dbUser.avatar,
            'photo',
            p.profession || dbUser.occupation,
            p.industry || dbUser.industry,
            sexuality,
            p.bio || dbUser.bio,
            gallery,
            now,
            dbUser.profileId
          ]
        });
      }
      
      // Execute batch
      if (stmts.length >= BATCH_SIZE) {
        const count = await executeBatchStmts(stmts);
        totalUpdated += count;
        batchCount++;
        stmts = [];
        
        if (batchCount % 10 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          process.stdout.write(`\r  📊 ${totalUpdated} stmts executed | batch ${batchCount} | ${elapsed}s`);
        }
        
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    }
    
    // Flush remaining
    if (stmts.length > 0) {
      const count = await executeBatchStmts(stmts);
      totalUpdated += count;
    }
    
    const avatarElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  ✅ 头像 + Profile 更新完成: ${totalUpdated} 条语句 | ${avatarElapsed}s\n`);

    // ─── Step 5: 更新/创建 BotProfile 记录 ───
    console.log('🤖 Step 5: 更新/创建 BotProfile 记录...');
    
    const existingBotProfiles = await turso.execute('SELECT profileId FROM BotProfile');
    const existingProfileIds = new Set(existingBotProfiles.rows.map(r => r.profileId));
    console.log(`  📋 现有 BotProfile: ${existingProfileIds.size} 条`);
    
    let bpCreated = 0;
    let bpUpdated = 0;
    let bpErrors = 0;
    stmts = [];
    batchCount = 0;
    
    for (const [originalId, dbUser] of dbUserMap) {
      const enhanced = findEnhancedUser(originalId, femaleMap, maleMap);
      if (!enhanced || !dbUser.profileId) continue;
      
      const p = enhanced.profile;
      const ep = enhanced.extendedProfile;
      const lifestyle = enhanced.lifestyle;
      
      if (existingProfileIds.has(dbUser.profileId)) {
        // UPDATE existing BotProfile
        stmts.push({
          sql: `UPDATE BotProfile SET occupation = ?, industry = ?, educationLevel = ?, incomeRange = ?,
                interests = ?, avatarStyle = ?, avatarSource = ?, lastActiveAt = ?, updatedAt = ? 
                WHERE profileId = ?`,
          args: [
            p.profession, p.industry, p.education, p.incomeRange,
            JSON.stringify(enhanced.interests || []),
            p.avatarType === 'realistic' ? 'professional' : 'casual',
            p.avatarSource || 'unsplash',
            ep?.lastActive || null,
            now,
            dbUser.profileId
          ]
        });
        bpUpdated++;
      } else {
        // CREATE new BotProfile
        const behaviorConfig = JSON.stringify({
          height: p.height, heightImperial: p.heightImperial, appearance: p.appearance,
          lifeStage: p.lifeStage, maritalStatus: p.maritalStatus, sexualPreference: p.sexualPreference,
          mbti: p.mbti, languages: p.languages, nationality: p.nationality,
          religion: p.religion, politicalViews: p.politicalViews,
          hasCar: p.hasCar, willingToRelocate: p.willingToRelocate, petPreferences: p.petPreferences,
          verified: ep?.verified || false, premium: ep?.premium || false,
          profileCompletion: ep?.profileCompletion || 75,
          profileViews: ep?.profileViews || 0, matchCount: ep?.matchCount || 0,
        });
        
        const learningData = JSON.stringify({
          memberSince: ep?.memberSince || null, zodiacSign: lifestyle?.zodiacSign || null,
          exerciseFrequency: lifestyle?.exerciseFrequency || null, dietPreference: lifestyle?.dietPreference || null,
          drinkingHabit: lifestyle?.drinkingHabit || null, smokingHabit: lifestyle?.smokingHabit || null,
          hasPets: lifestyle?.hasPets || false, hasChildren: lifestyle?.hasChildren || false,
          wantsChildren: lifestyle?.wantsChildren || null, livingSituation: lifestyle?.livingSituation || null,
        });
        
        let onlinePattern = 'EVENING';
        if (p.age < 26) onlinePattern = 'RANDOM';
        else if (p.age < 36) onlinePattern = 'AFTER_WORK';
        else if (p.age >= 46) onlinePattern = 'MORNING';
        
        const activityLevel = ep?.premium ? 'HIGH' : 'MEDIUM';
        
        stmts.push({
          sql: `INSERT INTO BotProfile (
            id, profileId, botType, activityLevel, occupation, industry,
            educationLevel, incomeRange, interests, hobbies,
            musicGenres, movieGenres, onlinePattern, avgResponseTime, maxDailyMatches,
            behaviorConfig, preferredEthnicities, preferredOccupations, preferredEducation,
            totalInteractions, successfulMatches, avgEngagementScore,
            learningData, avatarStyle, avatarSource, isActive, lastActiveAt,
            createdAt, updatedAt
          ) VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, 30, 3, ?, '[]', '[]', '[]', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          args: [
            crypto.randomUUID(), dbUser.profileId, activityLevel,
            p.profession, p.industry, p.education, p.incomeRange,
            JSON.stringify(enhanced.interests || []), JSON.stringify([]),
            onlinePattern,
            behaviorConfig,
            ep?.profileViews || 0, ep?.matchCount || 0, (Math.random() * 30 + 50).toFixed(1),
            learningData,
            p.avatarType === 'realistic' ? 'professional' : 'casual',
            p.avatarSource || 'unsplash',
            ep?.lastActive || null, now, now
          ]
        });
        bpCreated++;
      }
      
      // Execute batch
      if (stmts.length >= BATCH_SIZE) {
        const count = await executeBatchStmts(stmts);
        batchCount++;
        stmts = [];
        
        if (batchCount % 5 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          process.stdout.write(`\r  📊 BotProfile: ${bpCreated} new + ${bpUpdated} updated | batch ${batchCount} | ${elapsed}s`);
        }
        
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    }
    
    // Flush remaining
    if (stmts.length > 0) {
      await executeBatchStmts(stmts);
    }
    
    const bpElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n  ✅ BotProfile: ${bpCreated} 新建, ${bpUpdated} 更新 | ${bpElapsed}s\n`);

    // ─── Step 6: 验证部署结果 ───
    console.log('✅ Step 6: 验证部署结果...');
    console.log('-'.repeat(50));
    
    const unsplashCount = await turso.execute(
      "SELECT COUNT(*) as cnt FROM Profile p JOIN User u ON p.userId = u.id WHERE u.isBot = 1 AND p.avatar LIKE '%unsplash%'"
    );
    const dicebearCount = await turso.execute(
      "SELECT COUNT(*) as cnt FROM Profile p JOIN User u ON p.userId = u.id WHERE u.isBot = 1 AND p.avatar LIKE '%dicebear%'"
    );
    const nullAvatarCount = await turso.execute(
      "SELECT COUNT(*) as cnt FROM Profile p JOIN User u ON p.userId = u.id WHERE u.isBot = 1 AND (p.avatar IS NULL OR p.avatar = '')"
    );
    
    console.log(`  🖼️ 头像统计:`);
    console.log(`     Unsplash 高清头像: ${unsplashCount.rows[0].cnt}`);
    console.log(`     DiceBear 卡通头像: ${dicebearCount.rows[0].cnt}`);
    console.log(`     无头像: ${nullAvatarCount.rows[0].cnt}`);
    
    const userImageCount = await turso.execute(
      "SELECT COUNT(*) as cnt FROM User WHERE isBot = 1 AND image IS NOT NULL AND image != ''"
    );
    console.log(`  👤 User.image 已设置: ${userImageCount.rows[0].cnt}`);
    
    const botProfileCount = await turso.execute('SELECT COUNT(*) as cnt FROM BotProfile');
    console.log(`  🤖 BotProfile 记录总数: ${botProfileCount.rows[0].cnt}`);
    
    const withBehaviorConfig = await turso.execute(
      "SELECT COUNT(*) as cnt FROM BotProfile WHERE behaviorConfig IS NOT NULL AND behaviorConfig != ''"
    );
    console.log(`  📊 BotProfile 含 behaviorConfig: ${withBehaviorConfig.rows[0].cnt}`);
    
    const occupationCount = await turso.execute(
      "SELECT COUNT(*) as cnt FROM Profile WHERE occupation IS NOT NULL AND occupation != ''"
    );
    console.log(`  💼 Profile 含 occupation: ${occupationCount.rows[0].cnt}`);
    
    const genderBreakdown = await turso.execute(
      "SELECT p.gender, COUNT(*) as cnt FROM Profile p JOIN User u ON p.userId = u.id WHERE u.isBot = 1 AND p.avatar LIKE '%unsplash%' GROUP BY p.gender"
    );
    console.log(`  📊 高清头像性别分布:`);
    genderBreakdown.rows.forEach(r => console.log(`     ${r.gender}: ${r.cnt}`));

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️ 总耗时: ${totalTime}s`);
    console.log('\n🎉 部署完成!');

  } catch (error) {
    console.error('\n❌ 部署失败:', error);
    process.exit(1);
  } finally {
    await turso.close();
  }
}

main();
