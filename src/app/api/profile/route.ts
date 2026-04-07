export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, notFound, serverError, badRequest } from "@/lib/api-response";
import type { ProfileUpdateInput } from "@/types";

export async function GET(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();

    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      return notFound("Profile not found");
    }

    return success(profile);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return serverError("Failed to fetch profile");
  }
}

const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  bio: z.string().max(2000).optional(),
  avatar: z.string().url().optional().nullable(),
  city: z.string().max(100).optional(),
  country: z.string().max(2).optional(),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "OTHER"]).optional(),
  genderIdentity: z.string().max(100).optional(),
  sexuality: z.string().max(100).optional(),
  relationshipGoal: z.enum(["LONG_TERM", "DATING", "FRIENDSHIP", "NOT_SURE"]).optional(),
  attachmentStyle: z.string().max(100).optional(),
  communicationStyle: z.string().max(100).optional(),
  conflictResolution: z.string().max(100).optional(),
  loveLanguage: z.string().max(100).optional(),
  boundaries: z.array(z.string()).optional(),
  dealbreakers: z.array(z.string()).optional(),
  lifePriorities: z.array(z.string()).optional(),
  emotionalAvailability: z.string().max(100).optional(),
  preferredAgeMin: z.number().min(18).max(100).optional(),
  preferredAgeMax: z.number().min(18).max(100).optional(),
  preferredGender: z.string().max(200).optional(),
  preferredDistance: z.number().min(1).max(500).optional(),
  preferredLocation: z.string().max(200).optional(),
});

export async function PUT(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = updateProfileSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const data = parseResult.data;

    // Check if profile exists
    const existingProfile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    if (!existingProfile) {
      return notFound("Profile not found. Please complete onboarding first.");
    }

    // Prepare update data
    const updateData: Record<string, unknown> = {};

    // Handle JSON arrays
    if (data.boundaries !== undefined) {
      updateData.boundaries = JSON.stringify(data.boundaries);
    }
    if (data.dealbreakers !== undefined) {
      updateData.dealbreakers = JSON.stringify(data.dealbreakers);
    }
    if (data.lifePriorities !== undefined) {
      updateData.lifePriorities = JSON.stringify(data.lifePriorities);
    }

    // Add other fields
    for (const [key, value] of Object.entries(data)) {
      if (!["boundaries", "dealbreakers", "lifePriorities"].includes(key)) {
        updateData[key] = value;
      }
    }

    // Update profile
    const profile = await db.profile.update({
      where: { userId: user.id },
      data: updateData,
    });

    return success(profile);
  } catch (error) {
    console.error("Error updating profile:", error);
    return serverError("Failed to update profile");
  }
}

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();

    // Get profile
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      return notFound("Profile not found");
    }

    // Check if profile is ready for submission
    if (!profile.displayName || !profile.gender || !profile.sexuality) {
      return badRequest("Profile must have displayName, gender, and sexuality before submission");
    }

    // Update profile status to pending review
    const updatedProfile = await db.profile.update({
      where: { userId: user.id },
      data: {
        profileStatus: "PENDING_REVIEW",
        onboardingStep: 5,
      },
    });

    // Create notification for admins
    const admins = await db.user.findMany({
      where: {
        role: { in: ["ADMIN", "SUPER_ADMIN"] },
      },
    });

    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin: any) => ({
          userId: admin.id,
          type: "SYSTEM_ANNOUNCEMENT",
          title: "新用户资料待审核",
          body: `用户 ${profile.displayName} 提交了资料审核`,
          data: JSON.stringify({ userId: user.id, profileId: profile.id }),
          actionUrl: `/admin/users/${user.id}`,
        })),
      });
    }

    return success({
      profile: updatedProfile,
      message: "Profile submitted for review",
    });
  } catch (error) {
    console.error("Error submitting profile:", error);
    return serverError("Failed to submit profile");
  }
}
