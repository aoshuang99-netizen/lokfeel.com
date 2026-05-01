/**
 * JSON Array Helper Library
 * 
 * SQLite/libSQL doesn't support native array types.
 * All String[] fields are stored as JSON strings.
 * This library provides type-safe read/write helpers.
 * 
 * Usage:
 *   // Read
 *   const tags = jsonArr(profile.selectedTags)        // string[]
 *   const tags = jsonArrOr(profile.selectedTags, [])   // string[] with fallback
 *   
 *   // Write
 *   profile.selectedTags = toJson([])                  // "[]"
 *   profile.selectedTags = toJson(["A", "B"])          // '["A","B"]'
 *   
 *   // Push to array (replaces Prisma's { push: [...] })
 *   profile.galleryPhotos = pushJson(profile.galleryPhotos, newUrl)
 */

/**
 * Parse a JSON string field into a typed array.
 * Returns empty array on null/undefined/parse error.
 */
export function jsonArr<T = string>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Parse a JSON string field with explicit fallback.
 */
export function jsonArrOr<T = string>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Serialize an array to JSON string for storage.
 */
export function toJson(value: unknown[]): string {
  return JSON.stringify(value);
}

/**
 * Push items to a JSON array field (replaces Prisma's { push: [...] }).
 * Returns the new JSON string value.
 */
export function pushJson(currentValue: string | null | undefined, ...items: string[]): string {
  const arr = jsonArr(currentValue);
  arr.push(...items);
  return JSON.stringify(arr);
}

/**
 * Remove items from a JSON array field.
 * Returns the new JSON string value.
 */
export function removeFromJson(currentValue: string | null | undefined, ...items: string[]): string {
  const arr = jsonArr(currentValue);
  const filtered = arr.filter(item => !items.includes(item));
  return JSON.stringify(filtered);
}

/**
 * Parse a JSON string field into an object.
 * Returns null on parse error.
 */
export function jsonObj<T = Record<string, unknown>>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Serialize an object to JSON string for storage.
 */
export function toJsonObj(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Check if a JSON array contains an item.
 */
export function jsonIncludes(currentValue: string | null | undefined, item: string): boolean {
  return jsonArr(currentValue).includes(item);
}

/**
 * Set a JSON array to a specific set of items.
 * Useful for tag updates.
 */
export function setJsonArr(items: string[]): string {
  return JSON.stringify(items);
}
