/**
 * ✅ [P1-6 阶段 5 — TARGET/KEEP] Bot 回复文案模板（单一数据源）
 *
 * 为什么这个文件必须存在（G-3 / G-6 的修复）：
 *
 *   改造前，同一套 8 分类模板 + 关键词表 + `categorizeMessage` + `getRandomResponse`
 *   在仓库里存在 **3 份逐字重复的副本**：
 *
 *     1. `src/lib/im/bot-reply.ts`（IM 原生路径，`/api/im/send` 调用）
 *     2. `src/app/api/chat/[id]/messages/route.ts` → Legacy ChatRoom 分支
 *     3. 同文件 → IM Conversation 分支
 *
 *   副本的代价不是"代码丑"，而是**行为会漂移**：改一处必漏另外两处。
 *   审计文档 §11.3 G-3 记录了这个风险，G-6 指出阶段 4 前端换源后 IM 路径
 *   已成为线上主发送路径，暴露面进一步扩大。
 *
 * 本模块是**纯函数 + 纯数据**，不碰数据库、不碰网络 —— 因此可以被任何一侧安全引用。
 * 数据库写入与 gating 分别由 `lib/im/bot-reply.ts`（IM 侧）与
 * `lib/im/bot-gate.ts`（两侧共用的"是否该回复"判定）负责。
 *
 * @module lib/im/bot-templates
 */

/** Bot 回复文案池，按语义分类 */
export const BOT_RESPONSES: Record<string, readonly string[]> = {
  greeting: [
    "Hey! 👋 Nice to hear from you!",
    "Hi there! How's your day going?",
    "Hello! 😊 Thanks for reaching out!",
    "Hey! Great to match with you!",
    "Hi! I was hoping you'd message me!",
  ],
  question: [
    "That's a great question! Let me think...",
    "Hmm, interesting! I'd say...",
    "Good point! I think...",
    "Oh, I love that question! ",
    "You know, I've been wondering about that too!",
  ],
  interest: [
    "That sounds amazing! Tell me more! ✨",
    "Wow, I'm really interested in that too!",
    "No way! I love that as well!",
    "We should definitely talk more about this!",
    "You're speaking my language! 😄",
  ],
  casual: [
    "Haha, totally! 😄",
    "I know what you mean!",
    "Right? I was just thinking that!",
    "Exactly! Couldn't agree more.",
    "For sure! 💯",
  ],
  weekend: [
    "I'm thinking of checking out some local spots. You?",
    "Probably going to relax and maybe grab coffee with friends. How about you?",
    "I might go hiking if the weather's nice! 🥾",
    "There's a new restaurant I've been wanting to try!",
    "Just taking it easy, maybe some Netflix and wine. 🍷",
  ],
  food: [
    "I love trying new cuisines! Any recommendations? 🍜",
    "Italian is my weakness, especially pasta!",
    "I'm always down for good sushi! 🍣",
    "Have you tried that new place downtown?",
    "I'm a bit of a foodie, always hunting for hidden gems!",
  ],
  travel: [
    "I just got back from a trip actually! ✈️",
    "Japan is at the top of my bucket list!",
    "I love spontaneous weekend getaways!",
    "Beach or mountains? I'm a beach person! 🏖️",
    "Traveling is my favorite thing to do when I have time off!",
  ],
  fallback: [
    "That's interesting! Tell me more about yourself?",
    "I'd love to hear more about what you're into!",
    "So what brings you to this app? 😊",
    "I'm curious, what's your ideal weekend like?",
    "What kind of things are you passionate about?",
  ],
} as const;

/**
 * 关键词表 —— 顺序即优先级。
 *
 * ⚠️ 顺序敏感：`Object.entries` 的遍历顺序就是这里的书写顺序，
 *    而 `categorizeMessage` 返回**首个命中**的分类。
 *    例如 "hi, what do you like to eat?" 会命中 greeting（先于 question/food）。
 *    调整顺序会改变线上 Bot 的回复风格 —— 不要随手重排。
 */
export const BOT_KEYWORDS: Record<string, readonly string[]> = {
  greeting: ["hi", "hello", "hey", "howdy", "good morning", "good evening", "what's up", "sup"],
  question: ["?", "what", "how", "why", "when", "where", "who", "which", "can you", "do you"],
  interest: ["love", "like", "enjoy", "favorite", "into", "passion", "hobby", "hobbies"],
  weekend: ["weekend", "saturday", "sunday", "plans", "doing this weekend", "free time"],
  food: ["food", "eat", "restaurant", "cooking", "dinner", "lunch", "breakfast", "cuisine", "sushi", "pizza"],
  travel: ["travel", "trip", "vacation", "country", "place", "visited", "going to", "flying"],
};

/** 兜底分类名 */
export const BOT_FALLBACK_CATEGORY = "fallback";

/**
 * 按关键词把来信归类。首个命中的分类胜出。
 *
 * @param content 来信原文
 * @returns 分类名；无命中时返回 `"fallback"`
 */
export function categorizeMessage(content: string): string {
  const lower = (content ?? "").toLowerCase();

  for (const [category, words] of Object.entries(BOT_KEYWORDS)) {
    if (words.some((word) => lower.includes(word))) {
      return category;
    }
  }

  return BOT_FALLBACK_CATEGORY;
}

/**
 * 从指定分类里随机取一条文案。
 *
 * @param category 分类名，未知分类回退到 `fallback`
 */
export function getRandomResponse(category: string): string {
  const responses = BOT_RESPONSES[category] || BOT_RESPONSES[BOT_FALLBACK_CATEGORY];
  return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * 一步到位：来信内容 → 回复文案（含分类，供审计日志使用）。
 *
 * 这是三个调用点（`/api/im/send`、分发器 IM 分支、分发器 Legacy 分支）
 * 唯一应当调用的入口。
 */
export function generateBotResponse(incoming: string): {
  content: string;
  category: string;
} {
  const category = categorizeMessage(incoming);
  return { content: getRandomResponse(category), category };
}
