export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const uploadSchema = z.object({
  file: z.string(), // Base64 encoded file
  filename: z.string().optional(),
  type: z.enum(["avatar", "image", "document"]).default("image"),
});

export async function POST(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = uploadSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { file, filename, type } = parseResult.data;

    // Validate base64 data
    const base64Data = file.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return badRequest("File size exceeds 5MB limit");
    }

    // Determine file extension
    const mimeTypeMatch = file.match(/^data:([^;]+);base64,/);
    const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "application/octet-stream";

    const extensionMap: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
    };

    const extension = extensionMap[mimeType] || ".bin";
    const originalName = filename || "upload";
    const uniqueFilename = `${randomUUID()}-${originalName.replace(/[^a-zA-Z0-9.-]/g, "_")}${extension}`;

    // Create uploads directory structure
    const uploadsDir = join(process.cwd(), "public", "uploads", type);

    try {
      await mkdir(uploadsDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // For avatars, save to user's avatar folder
    const saveDir = type === "avatar"
      ? join(process.cwd(), "public", "uploads", "avatars", user.id)
      : uploadsDir;

    try {
      await mkdir(saveDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    const filePath = join(saveDir, uniqueFilename);

    // Write file
    await writeFile(filePath, buffer);

    // Generate URL
    const url = `/uploads/${type === "avatar" ? `avatars/${user.id}/${uniqueFilename}` : `${type}/${uniqueFilename}`}`;

    // If avatar, update user profile
    if (type === "avatar") {
      await db.profile.update({
        where: { userId: user.id },
        data: { avatar: url },
      });
    }

    return success({
      url,
      filename: uniqueFilename,
      size: buffer.length,
      mimeType,
    }, 201);
  } catch (error) {
    console.error("Error uploading file:", error);
    return serverError("Failed to upload file");
  }
}

// Handle multipart form data upload
export async function PUT(request: NextRequest) {
  try {
    

    const { user } = await requireAuth();
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const type = (formData.get("type") as string) || "image";

    if (!file) {
      return badRequest("No file provided");
    }

    // Validate file size
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return badRequest("File size exceeds 5MB limit");
    }

    // Get file buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate mime type
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    if (!allowedTypes.includes(file.type)) {
      return badRequest("Invalid file type. Allowed: JPEG, PNG, GIF, WebP, PDF");
    }

    // Generate unique filename
    const extension = file.name.split(".").pop() || "bin";
    const uniqueFilename = `${randomUUID()}.${extension}`;

    // Create uploads directory
    const uploadsDir = join(process.cwd(), "public", "uploads", type);
    await mkdir(uploadsDir, { recursive: true });

    // For avatars, save to user's avatar folder
    const saveDir = type === "avatar"
      ? join(process.cwd(), "public", "uploads", "avatars", user.id)
      : uploadsDir;

    await mkdir(saveDir, { recursive: true });

    const filePath = join(saveDir, uniqueFilename);

    // Write file
    await writeFile(filePath, buffer);

    // Generate URL
    const url = `/uploads/${type === "avatar" ? `avatars/${user.id}/${uniqueFilename}` : `${type}/${uniqueFilename}`}`;

    // If avatar, update user profile
    if (type === "avatar") {
      await db.profile.update({
        where: { userId: user.id },
        data: { avatar: url },
      });
    }

    return success({
      url,
      filename: uniqueFilename,
      size: buffer.length,
      mimeType: file.type,
    }, 201);
  } catch (error) {
    console.error("Error uploading file:", error);
    return serverError("Failed to upload file");
  }
}
