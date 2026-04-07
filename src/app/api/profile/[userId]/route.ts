export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, notFound, serverError, forbidden } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user } = await requireAuth();
    const { userId } = await params;

    const profile = await db.profile.findUnique({
      where: { userId },
      select: {
        id: true,
        displayName: true,
        age: true,
        gender: true,
        genderIdentity: true,
        sexuality: true,
        bio: true,
        avatar: true,
        city: true,
        country: true,
        relationshipGoal: true,
        attachmentStyle: true,
        communicationStyle: true,
        conflictResolution: true,
        loveLanguage: true,
        lifePriorities: true,
        emotionalAvailability: true,
        isVerified: true,
        createdAt: true,
        // Only include private fields if viewing own profile or admin
        boundaries: userId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
        dealbreakers: userId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
        preferredAgeMin: userId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
        preferredAgeMax: userId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
        preferredGender: userId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
        preferredDistance: userId === user.id || user.role === "ADMIN" || user.role === "SUPER_ADMIN",
      },
    });

    if (!profile) {
      return notFound("User profile not found");
    }

    // Get user's public info
    const userInfo = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        image: true,
      },
    });

    if (!userInfo) {
      return notFound("User not found");
    }

    return success({
      ...userInfo,
      profile,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return serverError("Failed to fetch user profile");
  }
}
