export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, serverError } from "@/lib/api-response";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

// Turbopack: scope filesystem operations to public/uploads
/* eslint-disable @typescript-eslint/no-require-imports */
const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

// Allowed image MIME types for security
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png", 
  "image/webp",
] as const;

// Image dimension constraints
const MIN_WIDTH = 100;
const MIN_HEIGHT = 100;
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;
const MIN_MEGAPIXELS = 1.0; // 1 megapixel minimum

/**
 * Validates image dimensions using Sharp
 * @returns { width: number, height: number } or throws error
 */
async function validateImageDimensions(buffer: Buffer): Promise<{ width: number; height: number }> {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to read image dimensions");
  }
  
  // Check minimum dimensions
  if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
    throw new Error(`Image dimensions too small. Minimum: ${MIN_WIDTH}x${MIN_HEIGHT}px`);
  }
  
  // Check maximum dimensions
  if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
    throw new Error(`Image dimensions too large. Maximum: ${MAX_WIDTH}x${MAX_HEIGHT}px`);
  }

  // Check minimum megapixels (1MP = 100万像素)
  const megapixels = (metadata.width * metadata.height) / 1000000;
  if (megapixels < MIN_MEGAPIXELS) {
    throw new Error(
      `Photo too blurry (${metadata.width}x${metadata.height} = ${megapixels.toFixed(1)}MP). ` +
      `Please upload a clearer photo — at least ${MIN_MEGAPIXELS}MP (e.g., 1280x800 or higher).`
    );
  }
  
  return { width: metadata.width, height: metadata.height };
}

type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

const uploadSchema = z.object({
  file: z.string(), // Base64 encoded file
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

    const { file, filename, type } = parseResult.data;

    // Validate base64 data
    const base64Data = file.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return badRequest("File size exceeds 5MB limit");
    }

    // 🔐 BUG-P0-1 FIX: Verify actual file content using file-type library
    // This prevents attacks where malicious files are disguised with fake MIME types
    const detectedType = await fileTypeFromBuffer(buffer);
    
    if (!detectedType) {
      return badRequest("Unable to verify file type. Please upload a valid image.");
    }

    // Strict MIME type validation - only allow explicitly safe image formats
    if (!ALLOWED_MIME_TYPES.includes(detectedType.mime as AllowedMimeType)) {
      return badRequest(
        `Invalid file type detected: ${detectedType.mime}. Only JPEG, PNG, and WebP images are allowed.`
      );
    }

    // 🔐 BUG-P0-1 FIX: Validate image dimensions (min 100x100, max 4000x4000)
    let dimensions: { width: number; height: number };
    try {
      dimensions = await validateImageDimensions(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image dimension validation failed";
      return badRequest(message);
    }

    // Use the detected MIME type and extension from actual file content
    const mimeType = detectedType.mime;
    const detectedExtension = detectedType.ext;

    // Map to our allowed extensions only
    const extensionMap: Record<string, string> = {
      "jpeg": ".jpg",
      "png": ".png",
      "webp": ".webp",
    };

    const extension = extensionMap[detectedExtension] || ".bin";
    const originalName = filename || "upload";
    const uniqueFilename = `${randomUUID()}-${originalName.replace(/[^a-zA-Z0-9.-]/g, "_")}${extension}`;

    // Create uploads directory structure
    const uploadsDir = join(process.cwd(), "public", "uploads", type);

    try {
      await mkdir(uploadsDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // For avatars/gallery, save to user's folder
    const saveDir = type === "avatar" || type === "gallery"
      ? join(process.cwd(), "public", "uploads", type === "avatar" ? "avatars" : "gallery", user.id)
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
    const url = `/uploads/${type === "avatar" ? `avatars/${user.id}/${uniqueFilename}` : type === "gallery" ? `gallery/${user.id}/${uniqueFilename}` : `${type}/${uniqueFilename}`}`;

    // If avatar, update user profile
    if (type === "avatar") {
      await db.profile.update({
        where: { userId: user.id },
        data: { avatar: url },
      });
    }

    // If gallery, append to galleryPhotos array
    if (type === "gallery") {
      await db.profile.update({
        where: { userId: user.id },
        data: {
          galleryPhotos: { push: url },
        },
      });
    }

    return success({
      url,
      filename: uniqueFilename,
      size: buffer.length,
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
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

    // 🔐 BUG-P0-1 FIX: Verify actual file content using file-type library
    // This prevents attacks where malicious files are disguised with fake MIME types
    const detectedType = await fileTypeFromBuffer(buffer);
    
    if (!detectedType) {
      return badRequest("Unable to verify file type. Please upload a valid image.");
    }

    // Strict MIME type validation - only allow explicitly safe image formats
    if (!ALLOWED_MIME_TYPES.includes(detectedType.mime as AllowedMimeType)) {
      return badRequest(
        `Invalid file type detected: ${detectedType.mime}. Only JPEG, PNG, and WebP images are allowed.`
      );
    }

    // 🔐 BUG-P0-1 FIX: Validate image dimensions (min 100x100, max 4000x4000)
    let dimensions: { width: number; height: number };
    try {
      dimensions = await validateImageDimensions(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image dimension validation failed";
      return badRequest(message);
    }

    // Generate unique filename using the detected extension
    const extensionMap: Record<string, string> = {
      "jpeg": ".jpg",
      "png": ".png",
      "webp": ".webp",
    };
    const extension = extensionMap[detectedType.ext] || ".bin";
    const uniqueFilename = `${randomUUID()}${extension}`;

    // Create uploads directory
    const uploadsDir = join(process.cwd(), "public", "uploads", type);
    await mkdir(uploadsDir, { recursive: true });

    // For avatars/gallery, save to user's folder
    const saveDir = type === "avatar" || type === "gallery"
      ? join(process.cwd(), "public", "uploads", type === "avatar" ? "avatars" : "gallery", user.id)
      : uploadsDir;

    await mkdir(saveDir, { recursive: true });

    const filePath = join(saveDir, uniqueFilename);

    // Write file
    await writeFile(filePath, buffer);

    // Generate URL
    const url = `/uploads/${type === "avatar" ? `avatars/${user.id}/${uniqueFilename}` : type === "gallery" ? `gallery/${user.id}/${uniqueFilename}` : `${type}/${uniqueFilename}`}`;

    // If avatar, update user profile
    if (type === "avatar") {
      await db.profile.update({
        where: { userId: user.id },
        data: { avatar: url },
      });
    }

    // If gallery, append to galleryPhotos array
    if (type === "gallery") {
      await db.profile.update({
        where: { userId: user.id },
        data: {
          galleryPhotos: { push: url },
        },
      });
    }

    return success({
      url,
      filename: uniqueFilename,
      size: buffer.length,
      mimeType: file.type,
      width: dimensions.width,
      height: dimensions.height,
    }, 201);
  } catch (error) {
    console.error("Error uploading file:", error);
    return serverError("Failed to upload file");
  }
}
