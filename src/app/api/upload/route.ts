export const dynamic = 'force-dynamic';
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

// Allowed image MIME types for security
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png", 
  "image/webp",
] as const;

// Image dimension constraints
const MIN_WIDTH = 50;
const MIN_HEIGHT = 50;
const MAX_WIDTH = 8000;
const MAX_HEIGHT = 8000;

// Target dimensions after server-side resize
const AVATAR_MAX_SIZE = 1024;
const GALLERY_MAX_SIZE = 1024;
const JPEG_QUALITY = 82;

/**
 * Validates image using Sharp — basic size check only (no minimum MP for crop outputs)
 */
async function validateImage(buffer: Buffer): Promise<{ width: number; height: number }> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read image dimensions");
  }
  
  if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
    throw new Error(`Image too small. Minimum: ${MIN_WIDTH}x${MIN_HEIGHT}px`);
  }
  
  if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
    throw new Error(`Image too large. Maximum: ${MAX_WIDTH}x${MAX_HEIGHT}px`);
  }
  
  return { width: metadata.width, height: metadata.height };
}

type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

const uploadSchema = z.object({
  file: z.string(), // Base64 encoded file (with or without data: prefix)
  filename: z.string().optional(),
  type: z.enum(["avatar", "image", "document", "gallery"]).default("image"),
});

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth();
    const body = await request.json();

    const parseResult = uploadSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { file, type } = parseResult.data;

    // Validate base64 data
    const base64Data = file.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Validate file size (max 10MB raw — will be compressed down)
    const maxSize = 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return badRequest("File size exceeds 10MB limit");
    }

    // 🔐 Verify actual file content using file-type library
    const detectedType = await fileTypeFromBuffer(buffer);
    
    if (!detectedType) {
      return badRequest("Unable to verify file type. Please upload a valid image.");
    }

    // Strict MIME type validation
    if (!ALLOWED_MIME_TYPES.includes(detectedType.mime as AllowedMimeType)) {
      return badRequest(
        `Invalid file type: ${detectedType.mime}. Only JPEG, PNG, and WebP allowed.`
      );
    }

    // Validate image dimensions (basic check, no minimum MP requirement)
    const dimensions = await validateImage(buffer);

    // ─── Server-side resize + compress with Sharp ───
    // Vercel serverless has no persistent disk — return data URL instead of writing file
    const maxPx = type === "avatar" ? AVATAR_MAX_SIZE : type === "gallery" ? GALLERY_MAX_SIZE : GALLERY_MAX_SIZE;
    let processedBuffer: Buffer;
    let finalWidth = dimensions.width;
    let finalHeight = dimensions.height;

    try {
      // Avatar: force square output (cover) — prevents distortion in circular containers
      // Gallery: preserve aspect ratio (inside) — keeps original proportions for album
      const resizeOpts = type === "avatar"
        ? { fit: "cover" as const }
        : { fit: "inside" as const, withoutEnlargement: true as const };

      const pipeline = sharp(buffer)
        .resize(maxPx, maxPx, resizeOpts);

      processedBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();

      const processedMeta = await sharp(processedBuffer).metadata();
      finalWidth = processedMeta.width || finalWidth;
      finalHeight = processedMeta.height || finalHeight;
    } catch (sharpErr) {
      console.warn("Sharp processing failed, using original:", sharpErr);
      processedBuffer = buffer;
    }

    // Build data URL (no file system write — works in Vercel serverless)
    const dataUrl = `data:image/jpeg;base64,${processedBuffer.toString("base64")}`;

    // Update user profile avatar — ONLY if profile already exists
    // During onboarding, profile doesn't exist yet; the frontend stores avatarUrl
    // in React state and saves it to DB via PUT /api/profile on completion
    if (type === "avatar") {
      try {
        await db.profile.update({
          where: { userId: user.id },
          data: { avatar: dataUrl },
        });
      } catch {
        // Profile may not exist yet during onboarding — that's fine
        // The frontend stores avatarUrl in state and will save it on onboarding completion
        console.log(`[Upload] Profile not found for user ${user.id}, skipping DB avatar update (onboarding mode)`);
      }
    }

    // Append to gallery photos — ONLY if profile already exists
    if (type === "gallery") {
      try {
        await db.profile.update({
          where: { userId: user.id },
          data: {
            galleryPhotos: { push: dataUrl },
          },
        });
      } catch {
        console.log(`[Upload] Profile not found for user ${user.id}, skipping gallery update (onboarding mode)`);
      }
    }

    return success({
      url: dataUrl,
      size: processedBuffer.length,
      mimeType: "image/jpeg",
      width: finalWidth,
      height: finalHeight,
    }, 201);
  } catch (error) {
    console.error("Upload POST error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(`Upload failed: ${message}`);
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

    // Validate file size (max 10MB — will be compressed)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return badRequest("File size exceeds 10MB limit");
    }

    // Get file buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 🔐 Verify actual file content
    const detectedType = await fileTypeFromBuffer(buffer);
    
    if (!detectedType) {
      return badRequest("Unable to verify file type. Please upload a valid image.");
    }

    // Strict MIME type validation
    if (!ALLOWED_MIME_TYPES.includes(detectedType.mime as AllowedMimeType)) {
      return badRequest(
        `Invalid file type: ${detectedType.mime}. Only JPEG, PNG, and WebP allowed.`
      );
    }

    // Validate image dimensions
    const dimensions = await validateImage(buffer);

    // ─── Server-side resize + compress with Sharp ───
    const maxPx = type === "avatar" ? AVATAR_MAX_SIZE : type === "gallery" ? GALLERY_MAX_SIZE : GALLERY_MAX_SIZE;
    let processedBuffer: Buffer;
    let finalWidth = dimensions.width;
    let finalHeight = dimensions.height;

    try {
      const resizeOpts = type === "avatar"
        ? { fit: "cover" as const }
        : { fit: "inside" as const, withoutEnlargement: true as const };

      const pipeline = sharp(buffer)
        .resize(maxPx, maxPx, resizeOpts);

      processedBuffer = await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();

      const processedMeta = await sharp(processedBuffer).metadata();
      finalWidth = processedMeta.width || finalWidth;
      finalHeight = processedMeta.height || finalHeight;
    } catch (sharpErr) {
      console.warn("Sharp processing failed, using original:", sharpErr);
      processedBuffer = buffer;
    }

    // Build data URL (no file system write — works in Vercel serverless)
    const dataUrl = `data:image/jpeg;base64,${processedBuffer.toString("base64")}`;

    // Update user profile avatar (only if profile already exists)
    if (type === "avatar") {
      try {
        await db.profile.update({
          where: { userId: user.id },
          data: { avatar: dataUrl },
        });
      } catch (profileErr: unknown) {
        const msg = profileErr instanceof Error ? profileErr.message : String(profileErr);
        console.warn(`Profile not found for user ${user.id}, skipping DB update: ${msg}`);
      }
    }

    if (type === "gallery") {
      try {
        await db.profile.update({
          where: { userId: user.id },
          data: {
            galleryPhotos: { push: dataUrl },
          },
        });
      } catch (profileErr: unknown) {
        const msg = profileErr instanceof Error ? profileErr.message : String(profileErr);
        console.warn(`Profile not found for user ${user.id}, skipping gallery update: ${msg}`);
      }
    }

    return success({
      url: dataUrl,
      size: processedBuffer.length,
      mimeType: "image/jpeg",
      width: finalWidth,
      height: finalHeight,
    }, 201);
  } catch (error) {
    console.error("Upload PUT error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return serverError(`Upload failed: ${message}`);
  }
}
