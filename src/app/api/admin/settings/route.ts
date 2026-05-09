export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withPermission } from "@/lib/with-permission";
import { success, badRequest, serverError } from "@/lib/api-response";
import { auditSystemChange } from "@/lib/admin-audit";

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

export const GET = withPermission('system.config.view')(async (request: NextRequest, { userId }) => {
  const settings = await db.systemConfig.findMany({
    select: { key: true, value: true, updatedAt: true },
  });

  const settingsMap: Record<string, string> = {};
  for (const setting of settings) {
    settingsMap[setting.key] = setting.value;
  }

  return success(settingsMap);
});

export const PUT = withPermission('system.config.edit', { dangerous: true })(async (request: NextRequest, { userId: adminId }) => {
  const body = await request.json();

  const parseResult = settingsSchema.safeParse(body);
  if (!parseResult.success) {
    return badRequest("Invalid settings", parseResult.error.issues);
  }

  const updates = parseResult.data;

  // Capture before state
  const beforeSettings: Record<string, string> = {};
  const afterSettings: Record<string, string> = {};

  // Update each setting
  for (const [key, value] of Object.entries(updates)) {
    // Get before value
    const existing = await db.systemConfig.findUnique({ where: { key } });
    if (existing) {
      beforeSettings[key] = existing.value;
    }

    const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);
    afterSettings[key] = stringValue;

    await db.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: stringValue,
        description: `Admin configured: ${key}`,
        updatedBy: adminId,
      },
      update: {
        value: stringValue,
        updatedBy: adminId,
      },
    });
  }

  // Unified audit log
  await auditSystemChange(
    adminId,
    "system.config.edit",
    Object.keys(updates).join(", "),
    { before: beforeSettings, after: afterSettings },
    undefined,
    request
  );

  // Get updated settings
  const updatedSettings = await db.systemConfig.findMany();

  const settingsMap: Record<string, string> = {};
  for (const setting of updatedSettings) {
    settingsMap[setting.key] = setting.value;
  }

  return success(settingsMap);
});
