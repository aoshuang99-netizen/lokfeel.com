/**
 * Admin Import Users API
 * 
 * 批量导入数字用户到数据库
 */

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const prisma = getDb();
import { hash } from "bcryptjs";

export const dynamic = "force-dynamic";

interface SeedUser {
  id: string;
  gender: string;
  profile: {
    name: string;
    firstName: string;
    lastName: string;
    age: number;
    city: string;
    country: string;
    profession: string;
    bio: string;
    avatarType?: string;
  };
  personality: {
    attachmentStyle: string;
    communicationStyle: string;
    conflictStyle: string;
    loveLanguages: string;
    lifePriorities: string[];
    personalityTraits: string[];
  };
  preferences: {
    relationshipGoal: string;
    ageRangePreference: { min: number; max: number };
    dealbreakers: string[];
  };
  interests: string[];
  lifestyle: {
    zodiacSign?: string;
    drinkingHabit?: string;
    smokingHabit?: string;
    hasChildren?: boolean;
  };
  dealbreakers: string[];
}

function mapRelationshipGoal(goal: string): string {
  const mapping: Record<string, string> = {
    'Serious Relationship': 'MONOGAMY',
    'Long Term': 'MONOGAMY',
    'Long-term Partner': 'MONOGAMY',
    'Marriage': 'MONOGAMY',
    'Casual Dating': 'CASUAL_DATING',
    'Casual': 'CASUAL_DATING',
    'Something Casual': 'CASUAL_DATING',
    'Friendship': 'FRIENDSHIP_FIRST',
    'Open Relationship': 'ETHICAL_NON_MONOGAMY',
    'Polyamory': 'POLYAMORY',
  };
  return mapping[goal] || 'CASUAL_DATING';
}

function mapAttachmentStyle(style: string): string {
  const mapping: Record<string, string> = {
    'Secure': 'Secure',
    'Anxious': 'Anxious',
    'Anxious-Preoccupied': 'Anxious',
    'Dismissive-Avoidant': 'Avoidant',
    'Avoidant': 'Avoidant',
    'Fearful-Avoidant': 'Fearful',
    'Fearful': 'Fearful',
  };
  return mapping[style] || 'Secure';
}

function mapConflictStyle(style: string): string {
  const mapping: Record<string, string> = {
    'Avoidant': 'Avoiding',
    'Collaborative': 'Collaborative',
    'Compromising': 'Compromising',
    'Accommodating': 'Accommodating',
    'Competitive': 'Competing',
  };
  return mapping[style] || 'Collaborative';
}

async function createBotUser(
  userData: SeedUser,
  password: string
): Promise<{ userId: string; profileId: string; botId: string }> {
  const userId = `bot_${userData.id}`;
  const profileId = `bot_profile_${userData.id}`;
  const botId = `bot_${userData.id}`;

  // 1. Create User
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: `${userData.id.toLowerCase()}@bot.lokfeel.com`,
      name: userData.profile.name,
      password,
      role: 'USER',
      emailVerified: new Date(),
      image: null,
    },
  });

  // Generate avatar based on gender and avatarType
  const avatarEmoji = userData.gender === 'female' 
    ? ['👩', '👱‍♀️', '👩‍🦰', '👩‍🦱', '👩‍🦳'][Math.floor(Math.random() * 5)]
    : ['👨', '👱', '👨‍🦰', '👨‍🦱', '👨‍🦳'][Math.floor(Math.random() * 5)];
  const avatarColor = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8'][Math.floor(Math.random() * 7)];
  const avatarUrl = `emoji:${avatarEmoji}:${avatarColor}`;

  // 2. Create Profile
  await prisma.profile.upsert({
    where: { id: profileId },
    update: {},
    create: {
      id: profileId,
      userId: userId,
      displayName: userData.profile.firstName,
      age: userData.profile.age,
      gender: userData.gender.toUpperCase() as 'MALE' | 'FEMALE',
      sexuality: 'Straight',
      bio: userData.profile.bio,
      avatar: avatarUrl,
      avatarType: userData.profile.avatarType || 'cartoon',
      city: userData.profile.city,
      country: userData.profile.country,
      relationshipGoal: mapRelationshipGoal(userData.preferences.relationshipGoal) as any,
      attachmentStyle: mapAttachmentStyle(userData.personality.attachmentStyle),
      communicationStyle: userData.personality.communicationStyle,
      conflictResolution: mapConflictStyle(userData.personality.conflictStyle),
      loveLanguage: Array.isArray(userData.personality.loveLanguages) 
        ? userData.personality.loveLanguages[0] 
        : userData.personality.loveLanguages,
      boundaries: JSON.stringify([]),
      dealbreakers: JSON.stringify(userData.dealbreakers.slice(0, 5)),
      lifePriorities: JSON.stringify(userData.personality.lifePriorities),
      emotionalAvailability: 'Fully Available',
      preferredAgeMin: userData.preferences.ageRangePreference.min,
      preferredAgeMax: userData.preferences.ageRangePreference.max,
      preferredDistance: 50,
      profileStatus: 'APPROVED',
      onboardingStep: 9,
      isApproved: true,
    },
  });

  // 3. Create BotProfile
  await prisma.botProfile.upsert({
    where: { id: botId },
    update: {},
    create: {
      id: botId,
      profileId: profileId,
      botType: 'SEED',
      activityLevel: 'LOW',
      ethnicity: 'CAUCASIAN',
      occupation: userData.profile.profession,
      interests: userData.interests.slice(0, 10),
      hobbies: userData.interests.slice(5, 15),
      musicGenres: [],
      movieGenres: [],
      onlinePattern: 'RANDOM',
      avatarStyle: userData.profile.avatarType || 'natural',
      isActive: true,
    },
  });

  return { userId, profileId, botId };
}

/**
 * POST /api/admin/import-users
 * 批量导入数字用户
 */
export async function POST(request: NextRequest) {
  try {
    // 检查认证
    const adminKey = request.headers.get("x-admin-key");
    const validAdminKey = process.env.ADMIN_API_KEY || "lokfeel-admin-2024";
    
    if (adminKey !== validAdminKey) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { users, batchSize = 100 } = body;

    if (!users || !Array.isArray(users) || users.length === 0) {
      return NextResponse.json(
        { error: "Invalid users data" },
        { status: 400 }
      );
    }

    const password = await hash('bot123456', 12);
    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // 分批处理
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      
      for (const user of batch) {
        try {
          await createBotUser(user, password);
          successCount++;
        } catch (error) {
          failCount++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${user.profile?.name || user.id}: ${errorMsg}`);
        }
      }

      // 每批次后小延迟，避免数据库压力
      if (i + batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // 获取最终统计
    const totalUsers = await prisma.user.count();
    const totalBots = await prisma.botProfile.count();

    return NextResponse.json({
      success: true,
      stats: {
        total: users.length,
        success: successCount,
        failed: failCount,
        elapsed: `${elapsed}s`,
      },
      database: {
        totalUsers,
        totalBots,
      },
      errors: errors.slice(0, 10), // 只返回前10个错误
    });

  } catch (error) {
    console.error("Import users error:", error);
    return NextResponse.json(
      { error: "Failed to import users", details: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
