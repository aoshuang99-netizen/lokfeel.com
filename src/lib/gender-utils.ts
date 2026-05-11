/**
 * Gender utility functions — handles the dual naming convention in the database.
 *
 * The Prisma Gender enum has both:
 *   - Legacy values: MALE, FEMALE
 *   - Modern values: MAN, WOMAN, TRANSGENDER_MAN, TRANSGENDER_WOMAN
 *
 * All code should use these helpers to correctly identify gender regardless of
 * which naming convention the database row uses.
 */

/** Check if a gender value represents a male/man identity */
export function isMaleGender(gender: string | null | undefined): boolean {
  if (!gender) return false
  const g = gender.toUpperCase()
  return g === 'MALE' || g === 'MAN' || g === 'TRANSGENDER_MAN'
}

/** Check if a gender value represents a female/woman identity */
export function isFemaleGender(gender: string | null | undefined): boolean {
  if (!gender) return false
  const g = gender.toUpperCase()
  return g === 'FEMALE' || g === 'WOMAN' || g === 'TRANSGENDER_WOMAN'
}

/**
 * Normalize a gender value to the modern convention (MAN/WOMAN).
 * Legacy MALE → MAN, FEMALE → WOMAN.
 * Other values pass through unchanged.
 */
export function normalizeGender(gender: string | null | undefined): string {
  if (!gender) return 'OTHER'
  const map: Record<string, string> = {
    'MALE': 'MAN',
    'FEMALE': 'WOMAN',
  }
  const upper = gender.toUpperCase()
  return map[upper] || upper
}

/**
 * Get the opposite gender for matching purposes.
 * Returns both modern and legacy values for DB query compatibility.
 */
export function getOppositeGenders(gender: string | null | undefined): string[] {
  if (isMaleGender(gender)) {
    return ['FEMALE', 'WOMAN', 'TRANSGENDER_WOMAN']
  }
  if (isFemaleGender(gender)) {
    return ['MALE', 'MAN', 'TRANSGENDER_MAN']
  }
  // Non-binary / other — return all for inclusive matching
  return ['MALE', 'FEMALE', 'MAN', 'WOMAN', 'NON_BINARY', 'TRANSGENDER_MAN', 'TRANSGENDER_WOMAN']
}
