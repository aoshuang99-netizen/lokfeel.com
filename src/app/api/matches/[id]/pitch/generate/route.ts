import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/matches/[id]/pitch/generate
 * 
 * AI辅助生成Pitch Message
 * - 基于双方资料生成个性化申请信
 * - 提供3个不同风格的选项
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await params;
    const { user } = await requireAuth();
    const userId = user.id;
    const body = await request.json();
    const { tone = 'sincere' } = body;

    // 验证匹配存在且属于当前用户
    const match = await db.match.findFirst({
      where: {
        id: matchId,
        senderId: userId,
        status: 'PENDING',
      },
      include: {
        sender: {
          include: { profile: true }
        },
        receiver: {
          include: { profile: true }
        }
      }
    });

    if (!match) {
      return NextResponse.json(
        { error: 'Match not found or already processed' },
        { status: 404 }
      );
    }

    const senderProfile = match.sender.profile;
    const receiverProfile = match.receiver.profile;

    if (!senderProfile || !receiverProfile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // 构建AI提示词
    const prompt = buildPitchPrompt({
      sender: {
        name: senderProfile.displayName,
        age: senderProfile.age,
        bio: senderProfile.bio,
        interests: extractInterests(senderProfile),
        attachmentStyle: senderProfile.attachmentStyle,
        loveLanguage: senderProfile.loveLanguage,
        city: senderProfile.city,
        occupation: senderProfile.occupation,
      },
      receiver: {
        name: receiverProfile.displayName,
        age: receiverProfile.age,
        bio: receiverProfile.bio,
        interests: extractInterests(receiverProfile),
        attachmentStyle: receiverProfile.attachmentStyle,
        loveLanguage: receiverProfile.loveLanguage,
        city: receiverProfile.city,
        relationshipGoal: receiverProfile.relationshipGoal,
      },
      matchReason: match.matchReason,
      tone,
    });

    // 检查OpenAI API Key是否配置
    if (!process.env.OPENAI_API_KEY) {
      console.log('OpenAI API Key not configured, using fallback options');
      return NextResponse.json({
        success: true,
        options: getFallbackOptions(),
        tone,
        aiGenerated: false,
        fallback: true,
      });
    }

    // 动态导入OpenAI (可选依赖)
    let openai: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAI = require('openai');
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } catch {
      console.log('OpenAI module not installed, using fallback options');
      return NextResponse.json({
        success: true,
        options: getFallbackOptions(),
        tone,
        aiGenerated: false,
        fallback: true,
      });
    }

    // 调用OpenAI生成
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a dating app conversation assistant. Help users write engaging, personalized pitch messages for their matches.
          
Rules:
- Be genuine and specific, never generic
- Reference shared interests or compatibility points
- Keep it concise (80-150 characters ideally, max 200)
- Include one open-ended question
- Avoid pickup lines or overly flirty language
- Match the requested tone`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.8,
      max_tokens: 500,
    });

    const generatedContent = completion.choices[0]?.message?.content;
    
    if (!generatedContent) {
      return NextResponse.json(
        { error: 'Failed to generate pitch' },
        { status: 500 }
      );
    }

    // 解析生成的选项
    const options = parseGeneratedOptions(generatedContent);

    return NextResponse.json({
      success: true,
      options: options.slice(0, 3), // 最多返回3个选项
      tone,
      aiGenerated: true,
    });

  } catch (error) {
    console.error('AI pitch generation error:', error);
    
    // 如果OpenAI调用失败，返回备用模板
    return NextResponse.json({
      success: true,
      options: getFallbackOptions(),
      tone: 'sincere',
      aiGenerated: false,
      fallback: true,
    });
  }
}

/**
 * 构建AI提示词
 */
function buildPitchPrompt(params: {
  sender: any;
  receiver: any;
  matchReason: string;
  tone: string;
}): string {
  const { sender, receiver, matchReason, tone } = params;

  const toneInstructions: Record<string, string> = {
    casual: 'Keep it light, friendly, and easy-going. Like texting a friend.',
    sincere: 'Be genuine, thoughtful, and show you\'ve read their profile carefully.',
    playful: 'Be fun, use light humor, maybe a witty observation.',
    direct: 'Get straight to the point, confident but not arrogant.',
  };

  return `Help write a personalized pitch message for a dating app match.

SENDER (Me):
- Name: ${sender.name}
- Age: ${sender.age}
- Bio: ${sender.bio || 'Not provided'}
- Interests: ${sender.interests?.join(', ') || 'Not specified'}
- Attachment Style: ${sender.attachmentStyle || 'Not specified'}
- Love Language: ${sender.loveLanguage || 'Not specified'}
- City: ${sender.city || 'Not specified'}
- Occupation: ${sender.occupation || 'Not specified'}

RECEIVER (Match):
- Name: ${receiver.name}
- Age: ${receiver.age}
- Bio: ${receiver.bio || 'Not provided'}
- Interests: ${receiver.interests?.join(', ') || 'Not specified'}
- Attachment Style: ${receiver.attachmentStyle || 'Not specified'}
- Love Language: ${receiver.loveLanguage || 'Not specified'}
- City: ${receiver.city || 'Not specified'}
- Relationship Goal: ${receiver.relationshipGoal || 'Not specified'}

WHY WE MATCH (AI Analysis):
${matchReason}

TONE: ${tone}
${toneInstructions[tone] || toneInstructions.sincere}

Requirements:
1. Generate 3 different options
2. Each should be 80-150 characters (max 200)
3. Reference something specific from their profile
4. Include one engaging question
5. No generic compliments like "you're beautiful"
6. Format as:
   Option 1: [message]
   Option 2: [message]
   Option 3: [message]`;
}

/**
 * 从Profile提取兴趣
 */
function extractInterests(profile: any): string[] {
  const interests: string[] = [];
  
  // 从BotProfile获取兴趣
  if (profile.botProfile?.interests) {
    interests.push(...profile.botProfile.interests);
  }
  
  // 从personalityData解析
  if (profile.personalityData) {
    try {
      const data = JSON.parse(profile.personalityData);
      if (data.interests) {
        interests.push(...data.interests);
      }
    } catch {
      // Ignore parse error
    }
  }
  
  return [...new Set(interests)].slice(0, 5); // 去重并限制数量
}

/**
 * 解析AI生成的选项
 */
function parseGeneratedOptions(content: string): Array<{ text: string; style: string }> {
  const options: Array<{ text: string; style: string }> = [];
  
  // 尝试匹配 "Option X:" 格式
  const optionRegex = /Option\s*\d*[:：]\s*([^\n]+(?:\n(?!(Option|选项)\s*\d)[^\n]*)*)/gi;
  const matches = content.matchAll(optionRegex);
  
  for (const match of matches) {
    const text = match[1].trim();
    if (text.length >= 20 && text.length <= 300) {
      options.push({
        text,
        style: detectStyle(text),
      });
    }
  }
  
  // 如果没有匹配到，尝试按行分割
  if (options.length === 0) {
    const lines = content.split('\n').filter(line => 
      line.trim().length >= 20 && 
      line.trim().length <= 300 &&
      !line.includes('Option') &&
      !line.includes('选项')
    );
    
    for (const line of lines.slice(0, 3)) {
      options.push({
        text: line.trim(),
        style: detectStyle(line),
      });
    }
  }
  
  return options;
}

/**
 * 检测文本风格
 */
function detectStyle(text: string): string {
  const lower = text.toLowerCase();
  
  if (lower.includes('?') && (lower.includes('what') || lower.includes('how') || lower.includes('why'))) {
    return 'inquisitive';
  }
  if (lower.includes('!') && (lower.includes('love') || lower.includes('amazing') || lower.includes('awesome'))) {
    return 'enthusiastic';
  }
  if (lower.includes('haha') || lower.includes('lol') || lower.includes('😄') || lower.includes('😊')) {
    return 'playful';
  }
  
  return 'sincere';
}

/**
 * 备用选项 (当AI调用失败时)
 */
function getFallbackOptions(): Array<{ text: string; style: string }> {
  return [
    {
      text: "Hi! I noticed we both value meaningful connections. I'd love to hear more about what you're looking for in a relationship. What does your ideal weekend look like?",
      style: 'sincere'
    },
    {
      text: "Hey there! Our compatibility score caught my attention. I'm curious - what's one thing you're passionate about that most people don't know?",
      style: 'curious'
    },
    {
      text: "Hello! I read your profile and really appreciated your perspective on relationships. What made you decide to try LokFeel?",
      style: 'thoughtful'
    }
  ];
}
