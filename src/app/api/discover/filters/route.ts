import { auth } from "@/lib/auth";
import { db as prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/discover/filters
 * 
 * Returns available filter options and user's current filter preferences
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's current preferences
    const profile = await prisma.profile.findUnique({
      where: { userId: session.user.id },
      select: {
        preferredGender: true,
        preferredAgeMin: true,
        preferredAgeMax: true,
        preferredDistance: true,
        relationshipGoal: true,
        attachmentStyle: true,
      },
    });

    // Get available cities (for location filter)
    const cities = await prisma.profile.findMany({
      where: {
        city: { not: null },
      },
      select: { city: true },
      distinct: ["city"],
      take: 100,
    });

    const availableCities = cities.map((c) => c.city).filter(Boolean);

    return NextResponse.json({
      currentFilters: {
        preferredGender: profile?.preferredGender || "EVERYONE",
        preferredAgeMin: profile?.preferredAgeMin || 18,
        preferredAgeMax: profile?.preferredAgeMax || 99,
        preferredDistance: profile?.preferredDistance || 50,
        relationshipGoal: profile?.relationshipGoal || null,
        attachmentStyle: profile?.attachmentStyle || null,
      },
      availableOptions: {
        genders: [
          { value: "WOMAN", label: "Women" },
          { value: "MAN", label: "Men" },
          { value: "NON_BINARY", label: "Non-binary" },
          { value: "EVERYONE", label: "Everyone" },
        ],
        ageRange: { min: 18, max: 100 },
        distanceRange: { min: 5, max: 500 },
        relationshipGoals: [
          { value: "LONG_TERM", label: "Long-Term Relationship" },
          { value: "DATING", label: "Dating & Exploring" },
          { value: "FRIENDSHIP", label: "Connection First" },
          { value: "NOT_SURE", label: "Figuring It Out" },
        ],
        attachmentStyles: [
          { value: "Secure", label: "Secure" },
          { value: "Anxious-Preoccupied", label: "Anxious" },
          { value: "Dismissive-Avoidant", label: "Avoidant" },
          { value: "Fearful-Avoidant", label: "Fearful" },
        ],
        cities: availableCities,
      },
    });
  } catch (error) {
    console.error("Get filters error:", error);
    return NextResponse.json(
      { error: "Failed to load filters" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/discover/filters
 * 
 * Update user's filter preferences
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      preferredGender,
      preferredAgeMin,
      preferredAgeMax,
      preferredDistance,
      relationshipGoal,
      attachmentStyle,
      city,
    } = body;

    // Validate age range
    if (preferredAgeMin !== undefined && preferredAgeMax !== undefined) {
      if (preferredAgeMin < 18) {
        return NextResponse.json(
          { error: "Minimum age must be at least 18" },
          { status: 400 }
        );
      }
      if (preferredAgeMin > preferredAgeMax) {
        return NextResponse.json(
          { error: "Minimum age cannot be greater than maximum age" },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: any = {};
    if (preferredGender !== undefined) updateData.preferredGender = preferredGender;
    if (preferredAgeMin !== undefined) updateData.preferredAgeMin = preferredAgeMin;
    if (preferredAgeMax !== undefined) updateData.preferredAgeMax = preferredAgeMax;
    if (preferredDistance !== undefined) updateData.preferredDistance = preferredDistance;
    if (relationshipGoal !== undefined) updateData.relationshipGoal = relationshipGoal;
    if (attachmentStyle !== undefined) updateData.attachmentStyle = attachmentStyle;
    if (city !== undefined) updateData.city = city;

    await prisma.profile.update({
      where: { userId: session.user.id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      message: "Filters updated successfully",
    });
  } catch (error) {
    console.error("Update filters error:", error);
    return NextResponse.json(
      { error: "Failed to update filters" },
      { status: 500 }
    );
  }
}
