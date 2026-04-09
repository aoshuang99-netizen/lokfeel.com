import { db } from '@/lib/db';

/**
 * OAuth Profile Data Structure
 */
export interface OAuthProfileData {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string;
  image?: string;
  // LinkedIn specific
  headline?: string;
  industry?: string;
  location?: string;
  summary?: string;
  positions?: Array<{
    title: string;
    company: string;
    industry?: string;
  }>;
  // Google specific
  locale?: string;
  verified?: boolean;
  // Facebook specific
  birthday?: string;
  hometown?: string;
  gender?: string;
  // Discord specific
  username?: string;
  discriminator?: string;
  accentColor?: number;
  banner?: string;
}

/**
 * Extract relationship insights from OAuth profile
 */
export function extractRelationshipInsights(profile: OAuthProfileData) {
  const insights: {
    attachmentStyle?: string;
    communicationStyle?: string;
    lifePriorities?: string[];
    interests?: string[];
    location?: string;
    industry?: string;
    occupation?: string;
  } = {};

  // Extract location
  if (profile.location) {
    insights.location = profile.location;
  }

  // Extract industry/occupation from LinkedIn
  if (profile.industry) {
    insights.industry = profile.industry;
  }
  if (profile.positions && profile.positions.length > 0) {
    insights.occupation = profile.positions[0].title;
  }

  // Infer communication style from industry
  if (profile.industry) {
    const analyticalIndustries = ['Technology', 'Finance', 'Engineering', 'Science', 'Research'];
    const expressiveIndustries = ['Marketing', 'Media', 'Entertainment', 'Arts', 'Design'];
    const directIndustries = ['Sales', 'Business Development', 'Consulting', 'Management'];
    
    if (analyticalIndustries.some(i => profile.industry?.includes(i))) {
      insights.communicationStyle = 'Analytical';
    } else if (expressiveIndustries.some(i => profile.industry?.includes(i))) {
      insights.communicationStyle = 'Expressive';
    } else if (directIndustries.some(i => profile.industry?.includes(i))) {
      insights.communicationStyle = 'Direct';
    } else {
      insights.communicationStyle = 'Reflective';
    }
  }

  // Infer life priorities from industry and headline
  const priorities: string[] = [];
  
  if (profile.headline) {
    const headline = profile.headline.toLowerCase();
    if (headline.includes('founder') || headline.includes('ceo') || headline.includes('entrepreneur')) {
      priorities.push('Career', 'Growth');
    }
    if (headline.includes('travel') || headline.includes('digital nomad')) {
      priorities.push('Adventure', 'Freedom');
    }
    if (headline.includes('family') || headline.includes('parent')) {
      priorities.push('Family', 'Stability');
    }
  }

  if (profile.industry) {
    const industry = profile.industry.toLowerCase();
    if (industry.includes('tech') || industry.includes('startup')) {
      priorities.push('Innovation', 'Growth');
    }
    if (industry.includes('health') || industry.includes('wellness')) {
      priorities.push('Health', 'Wellness');
    }
    if (industry.includes('education') || industry.includes('nonprofit')) {
      priorities.push('Purpose', 'Impact');
    }
  }

  // Default priorities if none inferred
  if (priorities.length === 0) {
    priorities.push('Balance', 'Growth', 'Connection');
  }

  insights.lifePriorities = [...new Set(priorities)];

  return insights;
}

/**
 * Sync OAuth profile data to user profile
 */
export async function syncOAuthProfileToUser(
  userId: string,
  profile: OAuthProfileData
): Promise<void> {
  try {
    const insights = extractRelationshipInsights(profile);

    // Check if user has a profile
    const existingProfile = await db.profile.findUnique({
      where: { userId },
    });

    const profileData: Record<string, unknown> = {
      displayName: profile.name,
      avatar: profile.image,
    };

    // Add location if available
    if (insights.location) {
      profileData.city = insights.location;
    }

    // Add inferred communication style
    if (insights.communicationStyle && !existingProfile?.communicationStyle) {
      profileData.communicationStyle = insights.communicationStyle;
    }

    // Add inferred life priorities
    if (insights.lifePriorities && !existingProfile?.lifePriorities) {
      profileData.lifePriorities = JSON.stringify(insights.lifePriorities);
    }

    // Add bio from headline if no bio exists
    if (profile.headline && !existingProfile?.bio) {
      let bio = profile.headline;
      if (profile.industry) {
        bio += ` | ${profile.industry}`;
      }
      profileData.bio = bio;
    }

    if (existingProfile) {
      // Update existing profile with new data
      await db.profile.update({
        where: { userId },
        data: profileData,
      });
    } else {
      // Create new profile
      await db.profile.create({
        data: {
          userId,
          ...profileData,
          age: 25, // Default age, user should update
          gender: 'OTHER',
          sexuality: 'Questioning',
        } as any,
      });
    }

    // Store OAuth account link
    const existingAccount = await db.account.findFirst({
      where: {
        userId,
        provider: profile.provider,
      },
    });

    if (!existingAccount) {
      await db.account.create({
        data: {
          userId,
          type: 'oauth',
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      });
    }

    // Log analytics event
    await db.analyticsEvent.create({
      data: {
        userId,
        event: 'oauth.profile_synced',
        properties: JSON.stringify({
          provider: profile.provider,
          insightsExtracted: Object.keys(insights),
        }),
      },
    });

  } catch (error) {
    console.error('Failed to sync OAuth profile:', error);
    // Non-blocking: don't fail the login if sync fails
  }
}

/**
 * Get enriched user profile with OAuth data
 */
export async function getEnrichedUserProfile(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      accounts: {
        select: {
          provider: true,
          providerAccountId: true,
        },
      },
    },
  });

  if (!user) return null;

  return {
    ...user,
    connectedProviders: user.accounts.map(a => a.provider),
    hasOAuthData: user.accounts.length > 0,
  };
}
