/**
 * LokFeel Bot Behavior Engine — Chat Templates
 *
 * Pre-built conversation templates for bot chat behavior.
 * Organized by message type and context for natural conversation flow.
 *
 * Each template can include placeholders: {name}, {time}, {city}, etc.
 * Templates are chosen based on personality type and conversation stage.
 */

// ═══════════════════════════════════════════════════════════════
// Greeting Templates (Conversation Starters)
// ═══════════════════════════════════════════════════════════════

export const GREETING_TEMPLATES = {
  /** Casual, low-pressure greetings */
  casual: [
    'Hey there! 👋 How\'s your day going?',
    'Hi! I saw we matched — thought I\'d say hello.',
    'Hey, nice to connect with you! What brings you to LokFee??',
    'Hello! 😊 I liked your profile. How are you?',
    'Hi there! Hope you\'re having a great day.',
    'Hey! I thought our match was interesting. Want to chat?',
    'Hi! I noticed we have some things in common.',
  ],
  /** Direct and confident greetings */
  direct: [
    'Hey, I really liked what you wrote about your communication style. Tell me more about that.',
    'Your profile stood out to me. I appreciate someone who\'s direct about what they want.',
    'Hi! I think we might have some great compatibility. What do you think?',
    'Hey! I don\'t usually message first, but your profile caught my attention.',
    'Our match score was pretty high — want to see if the chemistry is real?',
  ],
  /** Thoughtful, reference-specific greetings */
  thoughtful: [
    'I noticed we share similar views on {shared_topic}. I\'d love to hear more about your perspective.',
    'Your approach to relationships really resonates with me. What made you think about it that way?',
    'I found it interesting that we both value {shared_value}. What does that look like in your daily life?',
    'It\'s refreshing to meet someone who also prioritizes {shared_value}. How has that shaped your past relationships?',
  ],
  /** Playful, lighthearted greetings */
  playful: [
    'So... our match score was pretty impressive! Think we can live up to the algorithm? 😄',
    'Okay, the matching engine clearly knows what it\'s doing. Hi! 🙃',
    'I promise I\'m more interesting than my profile suggests. Probably.',
    'Roses are red, match scores are blue... okay I\'m not good at this. Hi! 😅',
    'Plot twist: I actually read your whole profile. Yes, all of it.',
  ],
  /** Warm, empathetic greetings */
  warm: [
    'Hi there! I hope you\'re doing well. I wanted to reach out because your profile felt really genuine.',
    'Hey! There was something about your profile that felt really honest. I appreciate that.',
    'Hello! I can tell you\'ve put thought into what you\'re looking for. That means a lot.',
    'Hi! I love that you were open about {topic}. That takes courage.',
  ],
};

// ═══════════════════════════════════════════════════════════════
// Response Templates (Replying to Messages)
// ═══════════════════════════════════════════════════════════════

export const RESPONSE_TEMPLATES = {
  /** Agreeing / validating */
  agree: [
    'I totally get that!',
    'That makes a lot of sense to me.',
    'Yeah, I feel the same way.',
    'Exactly! That\'s how I see it too.',
    'I couldn\'t agree more.',
    'That resonates with me a lot.',
  ],
  /** Showing interest / asking follow-up */
  interested: [
    'That\'s really interesting! Tell me more about that?',
    'Oh, I\'d love to hear more about your experience with that.',
    'That\'s cool! What made you get into that?',
    'Hmm, that\'s thought-provoking. How did you come to that realization?',
    'I find that really fascinating. Can you elaborate?',
  ],
  /** Sharing personal experience */
  share: [
    'I\'ve had a similar experience actually. For me, it was...',
    'That reminds me of something I went through. I found that...',
    'I can relate to that! In my case...',
    'I know exactly what you mean. I\'ve been there too.',
  ],
  /** Gentle disagreement / different perspective */
  differ: [
    'I see it a bit differently, but I respect your perspective. For me...',
    'That\'s an interesting take! I\'ve always thought about it more like...',
    'I appreciate you sharing that. I actually have a slightly different view — I think...',
    'Hmm, I\'m not sure I fully agree, but I love that we can discuss it openly.',
  ],
  /** Playful / humorous responses */
  playful: [
    'Haha, I love that! 😄',
    'You\'re funny! I didn\'t expect that.',
    'Okay, that made me smile. You get points for that.',
    'Well played! 🙌',
    'I\'m keeping that one in mind.',
  ],
  /** Empathetic / supportive responses */
  empathetic: [
    'I really appreciate you sharing that. It takes vulnerability to open up.',
    'That sounds like it was really meaningful for you.',
    'I can only imagine. Thank you for being so open about it.',
    'That\'s really admirable. I think emotional honesty is so important.',
  ],
};

// ═══════════════════════════════════════════════════════════════
// Follow-up Templates (When Partner Hasn't Responded)
// ═══════════════════════════════════════════════════════════════

export const FOLLOW_UP_TEMPLATES = [
  'Hey! Hope you\'re having a good week. 😊',
  'Just checking in — no pressure to respond right away!',
  'Hey, I know life gets busy. Still here if you want to chat!',
  'Hope everything\'s going well! I enjoyed our conversation.',
  'Hey there! Just wanted to say hi again.',
  'No worries if you\'re busy — I\'m around whenever you have time.',
];

// ═══════════════════════════════════════════════════════════════
// Question Templates (Keep Conversation Going)
// ═══════════════════════════════════════════════════════════════

export const QUESTION_TEMPLATES = {
  /** Getting to know them */
  getting_to_know: [
    'What do you usually do to unwind after a long day?',
    'If you could have dinner with anyone, dead or alive, who would it be?',
    'What\'s something you\'re really passionate about that not many people know?',
    'What\'s the best trip you\'ve ever taken?',
    'Do you have any hidden talents?',
    'What\'s your ideal weekend like?',
  ],
  /** Relationship-oriented questions */
  relationship: [
    'What does a healthy relationship look like to you?',
    'How do you usually handle disagreements with someone close to you?',
    'What\'s the most important thing you\'ve learned from past relationships?',
    'What makes you feel most loved and appreciated?',
    'How do you show someone you care about them?',
    'What\'s something you\'re working on in terms of personal growth?',
  ],
  /** Fun, lighthearted questions */
  fun: [
    'Okay, important question: coffee or tea?',
    'What\'s the last thing that made you laugh out loud?',
    'Do you have a favorite book or movie that you keep coming back to?',
    'What\'s your guilty pleasure TV show?',
    'If you could instantly become an expert at anything, what would it be?',
    'What\'s the most spontaneous thing you\'ve ever done?',
  ],
};

// ═══════════════════════════════════════════════════════════════
// Compliment Templates
// ═══════════════════════════════════════════════════════════════

export const COMPLIMENT_TEMPLATES = [
  'I really admire how self-aware you are about your needs.',
  'Your honesty about what you\'re looking for is really refreshing.',
  'I can tell you put a lot of thought into your profile. It shows.',
  'Your communication style is really great — clear and thoughtful.',
  'I love that you know yourself so well. That\'s attractive.',
  'You seem like someone who genuinely cares about building real connections.',
];

// ═══════════════════════════════════════════════════════════════
// Closing Templates (Ending Conversation Gracefully)
// ═══════════════════════════════════════════════════════════════

export const CLOSING_TEMPLATES = [
  'It\'s been great chatting with you! I should get going, but I\'d love to continue this later.',
  'I\'ve really enjoyed our conversation. Let\'s pick this up again soon!',
  'Thanks for the great chat! I need to head out, but I\'m glad we connected.',
  'This was fun! I\'m going to log off for now, but I\'m looking forward to talking more.',
  'I had a wonderful time chatting with you. Have a great rest of your day! 😊',
  'Take care! I\'ll message you again soon.',
];

// ═══════════════════════════════════════════════════════════════
// Topic Keywords for Template Placeholders
// ═══════════════════════════════════════════════════════════════

export const TOPIC_KEYWORDS = [
  'communication',
  'trust',
  'boundaries',
  'emotional availability',
  'family',
  'career',
  'adventure',
  'personal growth',
  'honesty',
  'vulnerability',
  'partnership',
  'independence',
];

export const VALUE_KEYWORDS = [
  'career',
  'family',
  'adventure',
  'stability',
  'personal growth',
  'creativity',
  'health',
  'community',
  'education',
  'experiences',
];
