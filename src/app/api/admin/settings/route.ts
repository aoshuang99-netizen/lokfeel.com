export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminAuth as requireAdmin } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";

const settingsSchema = z.object({
  weeklyMatchLimit: z.number().min(1).max(20).optional(),
  matchExpirationDays: z.number().min(1).max(30).optional(),
  maxProfilePhotos: z.number().min(1).max(10).optional(),
  enableMatching: z.boolean().optional(),
  enableChat: z.boolean().optional(),
  requireProfileApproval: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  supportEmail: z.string().email().optional(),
  socialLinks: z.record(z.string(), z.string()).optional(),
});

export async function GET() {
  try {
    

    // Get all system settings
    const settings = await db.systemConfig.findMany();

    const settingsMap: Record<string, string> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return success(settingsMap);
  } catch (error) {
    console.error("Error fetching settings:", error);
    return serverError("Failed to fetch settings");
  }
}

export async function PUT(request: NextRequest) {
  try {
    

    const { user: adminUser } = await requireAdmin();
    const body = await request.json();

    const parseResult = settingsSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid settings", parseResult.error.issues);
    }

    const updates = parseResult.data;

    // Update each setting
    for (const [key, value] of Object.entries(updates)) {
      const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);

      await db.systemConfig.upsert({
        where: { key },
        create: {
          key,
          value: stringValue,
          description: `Admin configured: ${key}`,
          updatedBy: adminUser?.id,
        },
        update: {
          value: stringValue,
          updatedBy: adminUser?.id,
        },
      });
    }

    // Log admin action
    await db.adminLog.create({
      data: {
        authorId: adminUser?.id,
        action: "system.config",
        targetType: "SystemConfig",
        details: JSON.stringify(Object.keys(updates)),
      },
    });

    // Get updated settings
    const updatedSettings = await db.systemConfig.findMany();

    const settingsMap: Record<string, string> = {};
    for (const setting of updatedSettings) {
      settingsMap[setting.key] = setting.value;
    }

    return success(settingsMap);
  } catch (error) {
    console.error("Error updating settings:", error);
    return serverError("Failed to update settings");
  }
}
