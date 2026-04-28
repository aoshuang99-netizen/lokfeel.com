import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { success, badRequest, serverError } from '@/lib/api-response'
import { hash } from 'bcryptjs'

/**
 * POST /api/admin/generate-test-users
 * 批量生成测试用户（用于E2E测试）
 * 
 * Body:
 *   {
 *     count: number,          // 生成数量 (1-200)
 *     type: 'new' | 'existing', // new=全新注册用户, existing=带完整profile的已有用户
 *     prefix?: string,        // 邮箱前缀 (默认 'e2e-test')
 *     gender?: 'MALE' | 'FEMALE', // 性别分布
 *     withProfile?: boolean,  // 是否创建profile (existing模式默认true)
 *     withAvatar?: boolean,   // 是否分配头像
 *   }
 * 
 * 注意: 测试用户标记 isBot=true，方便后续清理
 */

// RandomUser.me头像URL模板
const AVATAR_BASE = 'https://randomuser.me/api/portraits'

function randomAvatarUrl(gender: string): string {
  const g = gender === 'FEMALE' ? 'women' : 'men'
  const id = Math.floor(Math.random() * 99) + 1
  return `${AVATAR_BASE}/${g}/${id}.jpg`
}

// 女性名字池
const FEMALE_NAMES = [
  'Emma', 'Sophia', 'Isabella', 'Olivia', 'Ava', 'Mia', 'Luna', 'Chloe',
  'Aria', 'Scarlett', 'Violet', 'Hazel', 'Ivy', 'Willow', 'Grace', 'Lily',
  'Ella', 'Stella', 'Zoe', 'Nora', 'Riley', 'Maya', 'Aurora', 'Penelope',
  'Layla', 'Lillian', 'Addison', 'Eleanor', 'Natalie', 'Savannah', 'Brooklyn', 'Leah',
  'Zoey', 'Audrey', 'Claire', 'Bella', 'Lucy', 'Anna', 'Caroline', 'Sarah',
  'Aria', 'Ellie', 'Mila', 'Paisley', 'Hailey', 'Violet', 'Aria', 'Nova',
  'Genesis', 'Emilia', 'Kennedy', 'Samantha', 'Maya', 'Willow', 'Kinsley', 'Naomi',
  'Aaliyah', 'Elena', 'Sarah', 'Ariana', 'Allison', 'Madeline', 'Alice', 'Sadie',
  'Hailey', 'Eva', 'Emilia', 'Autumn', 'Quinn', 'Neveah', 'Piper', 'Ruby',
  'Nora', 'Hannah', 'Lillian', 'Addison', 'Isabelle', 'Athena', 'Camila', 'Aria',
  'Luna', 'Chloe', 'Penelope', 'Layla', 'Riley', 'Zoey', 'Nora', 'Lily',
  'Eleanor', 'Hannah', 'Lillian', 'Addison', 'Aubrey', 'Ellie', 'Stella', 'Natalie',
  'Zoe', 'Leah', 'Hazel', 'Violet', 'Aurora', 'Savannah', 'Audrey', 'Brooklyn',
]

// 男性名字池
const MALE_NAMES = [
  'Liam', 'Noah', 'Oliver', 'Elijah', 'William', 'James', 'Benjamin', 'Lucas',
  'Henry', 'Alexander', 'Mason', 'Michael', 'Daniel', 'Jackson', 'Sebastian', 'Jack',
  'Aiden', 'Owen', 'Samuel', 'Ryan', 'Nathan', 'Leo', 'Adam', 'Dylan',
  'Owen', 'Ethan', 'Matthew', 'Joseph', 'David', 'Luke', 'Andrew', 'Calvin',
  'Maxwell', 'Marcus', 'Theodore', 'Ezra', 'Asher', 'Hudson', 'Kai', 'Finn',
  'Miles', 'Dominic', 'Austin', 'Grayson', 'Cameron', 'Blake', 'Carson', 'Jace',
  'Ryder', 'Brody', 'Tristan', 'Grant', 'Chase', 'Parker', 'Cole', 'Eli',
  'Jaxon', 'Gavin', 'Nolan', 'Brayden', 'Ryker', 'Easton', 'Cash', 'Tucker',
  'Beckett', 'Blake', 'Hayes', 'Walker', 'Harrison', 'Bennett', 'Connor', 'Cooper',
  'Luke', 'Gael', 'River', 'Thiago', 'Oscar', 'Brooks', 'Maverick', 'Emerson',
  'Liam', 'Noah', 'Oliver', 'Elijah', 'William', 'James', 'Benjamin', 'Lucas',
  'Henry', 'Alexander', 'Mason', 'Michael', 'Daniel', 'Jackson', 'Sebastian', 'Jack',
  'Aiden', 'Owen', 'Samuel', 'Ryan', 'Nathan', 'Leo', 'Adam', 'Dylan',
]

// 兴趣标签池
const INTERESTS = [
  'Photography', 'Cooking', 'Hiking', 'Reading', 'Yoga', 'Travel', 'Music',
  'Art', 'Dancing', 'Wine', 'Fitness', 'Movies', 'Gaming', 'Fashion',
  'Coffee', 'Dogs', 'Cats', 'Beach', 'Camping', 'Surfing', 'Writing',
  'Meditation', 'Running', 'Cycling', 'Gardening', 'Craft Beer', 'Sushi',
  'Podcasts', 'Tech', 'Design', 'Brunch', 'Concerts', 'Museums', 'Volunteering',
]

// 职业池
const OCCUPATIONS = [
  'Software Engineer', 'Product Designer', 'Marketing Manager', 'Data Scientist',
  'UX Researcher', 'Project Manager', 'Content Creator', 'Teacher',
  'Nurse', 'Financial Analyst', 'Graphic Designer', 'Consultant',
  'Photographer', 'Entrepreneur', 'Writer', 'Architect',
  'Lawyer', 'Doctor', 'Psychologist', 'Real Estate Agent',
  'Chef', 'Musician', 'Artist', 'Social Worker',
]

// 个人简介模板
const BIO_TEMPLATES_F = [
  "Looking for someone who shares my love for {interest} and isn't afraid to try new things. I believe the best relationships start with genuine connection.",
  "Passionate about {interest} and {interest2}. I value deep conversations, spontaneous adventures, and someone who can make me laugh.",
  "Coffee addict and {interest} enthusiast. Looking for a kind, ambitious partner who enjoys both cozy nights in and exciting nights out.",
  "When I'm not {interest}ing, you'll find me exploring the city or trying new restaurants. Looking for my partner in crime.",
  "Dog mom, {interest} lover, and firm believer that the best dates involve great food and even better conversation.",
]

const BIO_TEMPLATES_M = [
  "Adventure seeker who loves {interest} and good conversation. Looking for someone genuine who doesn't take themselves too seriously.",
  "I'm passionate about {interest} and {interest2}. Looking for a meaningful connection with someone who values honesty and humor.",
  "Fitness enthusiast and {interest} fan. I believe in working hard and playing harder. Looking for someone to share life's adventures.",
  "When I'm not {interest}ing, I'm probably cooking or exploring new places. Looking for someone real and down to earth.",
  "Tech professional by day, {interest} enthusiast by night. Looking for a genuine connection with someone who enjoys both deep talks and silly moments.",
]

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function generateBio(gender: string): string {
  const interest1 = randomFrom(INTERESTS)
  const interest2 = randomFrom(INTERESTS.filter(i => i !== interest1))
  const templates = gender === 'FEMALE' ? BIO_TEMPLATES_F : BIO_TEMPLATES_M
  return randomFrom(templates)
    .replace('{interest}', interest1.toLowerCase())
    .replace('{interest2}', interest2.toLowerCase())
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const count = Math.min(Math.max(body.count || 1, 1), 200)
    const type = body.type || 'new'
    const prefix = body.prefix || 'e2e-test'
    const genderRatio = body.genderRatio || 0.6 // 60% female by default
    const withProfile = type === 'existing' ? true : (body.withProfile ?? false)
    const withAvatar = body.withAvatar ?? true

    const results: Array<{
      id: string
      email: string
      password: string
      displayName: string
      gender: string
      type: 'new' | 'existing'
    }> = []

    const hashedPassword = await hash('E2eTest123!', 12)
    const timestamp = Date.now()

    for (let i = 0; i < count; i++) {
      const gender = Math.random() < genderRatio ? 'FEMALE' : 'MALE'
      const names = gender === 'FEMALE' ? FEMALE_NAMES : MALE_NAMES
      const displayName = randomFrom(names)
      const email = `${prefix}-${timestamp}-${i}@test.lokfeel.com`
      const age = randomBetween(22, 38)
      const avatar = withAvatar ? randomAvatarUrl(gender) : null

      try {
        // 创建User
        const user = await db.user.create({
          data: {
            email,
            name: displayName,
            password: hashedPassword,
            isBot: true, // 标记为bot，方便清理
            emailVerified: new Date(),
          },
        })

        // 创建Profile (existing模式或有头像)
        if (withProfile || withAvatar) {
          const bio = generateBio(gender)
          const userInterests = Array.from(
            { length: randomBetween(3, 6) },
            () => randomFrom(INTERESTS)
          ).filter((v, i, a) => a.indexOf(v) === i) // 去重

          await db.profile.create({
            data: {
              userId: user.id,
              displayName,
              age,
              gender,
              sexuality: randomFrom(['STRAIGHT', 'BISEXUAL', 'HETEROSEXUAL']),
              bio,
              occupation: randomFrom(OCCUPATIONS),
              city: randomFrom(['New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'San Francisco, CA', 'Seattle, WA', 'Austin, TX', 'Denver, CO', 'Miami, FL', 'Boston, MA', 'Portland, OR']),
              avatar,
              avatarType: avatar ? 'photo' : null,
              selectedTags: userInterests,
              relationshipGoal: randomFrom(['MONOGAMY', 'ETHICAL_NON_MONOGAMY', 'CASUAL_DATING', 'POLYAMORY']),
              profileStatus: 'APPROVED',
              isApproved: true,
            },
          })

          // 女性用户自动分配LADY_FREE订阅
          if (gender === 'FEMALE') {
            await db.subscription.create({
              data: {
                userId: user.id,
                plan: 'LADY_FREE',
                startsAt: new Date(),
                status: 'ACTIVE',
              },
            })
          }
        }

        results.push({
          id: user.id,
          email,
          password: 'E2eTest123!',
          displayName,
          gender,
          type,
        })
      } catch (error) {
        console.error(`Failed to create test user ${email}:`, error)
      }
    }

    return success({
      created: results.length,
      requested: count,
      users: results,
      summary: {
        female: results.filter(r => r.gender === 'FEMALE').length,
        male: results.filter(r => r.gender === 'MALE').length,
        withProfile: withProfile ? results.length : 0,
        withAvatar: withAvatar ? results.length : 0,
      },
    }, 201)
  } catch (error) {
    console.error('Generate test users error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return serverError(`Test user generation failed: ${message}`)
  }
}

/**
 * DELETE /api/admin/generate-test-users
 * 清理所有测试用户
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const prefix = body.prefix || 'e2e-test'

    // 查找测试用户
    const testUsers = await db.user.findMany({
      where: {
        email: { startsWith: prefix },
        isBot: true,
      },
      select: { id: true },
    })

    if (testUsers.length === 0) {
      return success({ deleted: 0, message: 'No test users found' })
    }

    // 批量删除 (Profile和Subscription会级联删除)
    const result = await db.user.deleteMany({
      where: {
        id: { in: testUsers.map(u => u.id) },
      },
    })

    return success({
      deleted: result.count,
      message: `Deleted ${result.count} test users`,
    })
  } catch (error) {
    console.error('Delete test users error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return serverError(`Test user cleanup failed: ${message}`)
  }
}
