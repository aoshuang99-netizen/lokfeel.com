-- Add galleryPhotos column to Profile table
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "galleryPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[];
