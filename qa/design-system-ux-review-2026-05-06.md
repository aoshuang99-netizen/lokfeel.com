# LokFeel Nexus Design System & UI/UX Code Review

**Date:** 2026-05-06
**Reviewer:** general-purpose-3 (Automated)
**Scope:** Design system implementation quality, UI consistency, accessibility, responsive design, performance

---

## Executive Summary

LokFeel Nexus demonstrates a **well-structured design system** built on modern web standards (OKLCH color space, Tailwind v4, CSS custom properties). The visual identity is cohesive with a warm "Terra Cotta" palette that aligns with the female-friendly dating app positioning. However, there are notable issues in **auth page design drift**, **hardcoded colors bypassing the design tokens**, and **accessibility gaps** that need attention.

### Overall Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Design System Implementation Quality | **7/10** | Solid token architecture, but auth pages diverge significantly |
| UI Component Consistency | **6/10** | Two parallel styling approaches (CSS classes vs inline styles) |
| Accessibility | **5/10** | Basic ARIA on tabs/dialog; many gaps in forms and interactive elements |
| Responsive Design | **7/10** | Good mobile-first patterns; some desktop gaps in chat layout |
| Performance Optimization | **6/10** | framer-motion concerns; mixed next/image usage; large inline styles |

---

## 1. Design System Implementation Quality (7/10)

### Strengths

- **OKLCH Color System**: Comprehensive `:root` CSS variable definitions with perceptually uniform OKLCH colors. Well-organized into semantic categories (background, foreground, primary, secondary, card, input, semantic, glow, shadows).
- **Tailwind v4 Integration**: Proper `@theme inline` block maps CSS variables to Tailwind utilities (`--color-primary`, `--color-background`, etc.), enabling `bg-primary`, `text-foreground` etc.
- **Dark Mode**: Complete dark mode override via `.dark` / `[data-theme="dark"]` selectors. All major tokens have dark equivalents.
- **Shadcn/ui Compatibility**: Includes legacy tokens (`--color-accent`, `--color-muted`, `--color-ring`, etc.) for shadcn/ui component compatibility.
- **Typography**: Dual font system — Outfit (UI) + Sora (Display) with proper fallback chains.
- **Glass Morphism Utilities**: Three glass variants (`.glass`, `.glass-strong`, `.glass-card`) with warm sand tones.
- **Animation Library**: Rich set of CSS keyframe animations (fade-in, slide-up, pulse-glow, shimmer, float, breathe, ken-burns, heartbeat, sparkle) with proper `prefers-reduced-motion` support for chat-specific animations.

### Issues

- **No `tailwind.config.ts`/`postcss.config.js`**: Tailwind v4 approach is valid but unconventional. No config file means no custom `extend` section — all customization via CSS `@theme inline`.
- **Radar chart tokens use `rgba()` instead of OKLCH**: The radar chart variables (`--radar-grid-fill`, `--radar-data-fill`, etc.) break the OKLCH consistency.
- **Match score classes use hardcoded Tailwind colors**: `match-score-high` uses `#16a34a`, `match-score-medium` uses `#d97706`, `match-score-low` uses `#dc2626` — should use `--success`, `--warning`, `--error`.
- **Gradient hardcoded values in CSS**: `.conversation-active::before` uses `#b4643c` and `#c8785a` directly.

---

## 2. UI Component Consistency (6/10)

### Strengths

- **UI Component Library** (`src/components/ui/`): 20 components including Button, Card, Input, Dialog, Avatar, Badge, Tabs, Toast, Tooltip, Skeleton, Checkbox, DataTable, etc.
- **CVA (class-variance-authority)**: Button and Badge use `cva` for variant management — clean pattern.
- **`cn()` utility**: Consistent class merging via `@/lib/utils`.
- **Avatar Component**: Smart `useNextImage()` hook that detects data URLs, emojis, SVGs, and blob URLs, falling back to native `<img>` when `next/image` optimization isn't applicable. Well-documented with performance rationale.
- **Skeleton System**: Comprehensive skeleton variants (text, circular, rectangular, rounded) with wave and pulse animations.

### Issues

- **Two Parallel Styling Approaches**: The design system defines `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input-feeld`, `.card-feeld`, `.glass-card` in `globals.css`, but the UI component library also exports `Button`, `Card`, `Input` with shadcn-style Tailwind classes. Pages use both inconsistently:
  - Dashboard pages (discover, matches, profile) use `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input-feeld`
  - Chat page imports `Button`, `Input` from `@/components/ui/button` and `@/components/ui/input`
  - **Login/Register/Forgot-Password pages use entirely inline `style={}` objects** — completely bypassing the design system.

- **Auth Page Design Drift**: The login inner client (`login-inner-client.tsx`) defines its own `colors` object with hardcoded hex values (`#1a1a2e`, `#e8a038`, `#dc2626`, etc.) and applies all styling via inline `style={}` props. This creates a completely separate visual language from the design system. The same issue exists in `register/page.tsx`, `forgot-password-client.tsx`, and `reset-password-client.tsx`.

- **Glass card hover uses hardcoded rgba**: `.glass-card:hover` in CSS uses `rgba(180, 100, 60, 0.15)` rather than referencing CSS variables.

- **`index.ts` barrel exports incomplete**: Only exports Skeleton, EmptyState, and InlineError. Key components like Button, Card, Input, Dialog, Avatar, Badge, Tabs, Toast, Tooltip are NOT exported — consumers must import directly from individual files.

---

## 3. Accessibility (5/10)

### Strengths

- **Tab component** (`tabs.tsx`): Uses `role="tablist"`, `role="tab"`, `aria-selected`, and `role="tabpanel"` correctly.
- **Dialog close button**: Has `<span className="sr-only">Close</span>` for screen readers.
- **Focus ring utility**: `.focus-ring` class with `focus-visible` outline.
- **`prefers-reduced-motion`**: Chat animations respect reduced motion preference.
- **Form labels**: Profile page uses `<label>` elements with `htmlFor` attributes.

### Issues

- **No ARIA labels on icon-only buttons**: Discover page has filter (`<Filter>`) and refresh (`<RefreshCw>`) buttons with no `aria-label`. Matches page filter button lacks `aria-label`. Subscription page close error button (`✕`) has no accessible label.
- **Chat search input**: Uses native `<input>` without `<label>` — only has a placeholder.
- **Swipe cards**: The `SwipeCard` in discover page has no keyboard accessibility — drag-only interaction. No `role`, `aria-label`, or keyboard alternative for like/pass.
- **Color contrast concerns**: `--foreground-faint: oklch(78% 0.012 40)` on `--background: oklch(98% 0.005 55)` may fail WCAG AA for small text. Several `text-foreground-subtle` usages need verification.
- **No skip navigation link**: No visible skip-to-content link for keyboard users.
- **Dialog lacks focus trapping**: The custom Dialog component (`dialog.tsx`) does not implement focus trap or `aria-modal="true"`. When opened, Tab key can escape to background content.
- **No `aria-live` regions**: Toast notifications and dynamic content updates (match counts, new messages) lack `aria-live` announcements.
- **Login form**: Password toggle button has `tabIndex={-1}` making it unreachable by keyboard. No `aria-describedby` for error messages.

---

## 4. Responsive Design (7/10)

### Strengths

- **Mobile-first patterns**: Pages use responsive utilities like `grid-cols-2 gap-3` (square), `md:grid-cols-2 lg:grid-cols-3` (matches grid).
- **Chat responsive split**: Chat layout shows list on mobile, splits to sidebar+content on `md:` breakpoint. Properly hides/shows panels with `hidden md:flex`.
- **Section spacing**: Responsive padding with `@media (min-width: 768px)` and `1024px` breakpoints.
- **Aspect ratio cards**: Discover uses `aspect-[3/4]` for proper card proportions across screen sizes.
- **Sticky headers**: Square page header uses `sticky top-0 z-40` with backdrop blur for mobile scroll.

### Issues

- **Chat layout hardcoded height**: `h-[calc(100vh-4rem)]` assumes a fixed 4rem header height — fragile if navigation changes.
- **Profile step indicators**: Step progress circles don't adapt well to very small screens (<360px). The `w-12 sm:w-20` connector bars may overflow.
- **Square page max-width constraint**: `max-w-md mx-auto` limits the grid to ~448px even on large screens — wasted horizontal space on tablets/desktop.
- **Discover page negative margins**: `-mx-4 -mt-6 lg:mx-0 lg:mt-0` creates a full-bleed effect that may cause horizontal scroll on certain viewport widths.
- **Subscription page**: Three-column pricing grid (`md:grid-cols-3`) may be tight on medium tablets. No horizontal scroll fallback.

---

## 5. Performance Optimization (6/10)

### Strengths

- **Avatar component**: Smart `next/image` vs native `<img>` decision logic. Lazy loading with `decoding="async"` on native fallback. `priority` prop for above-fold avatars.
- **Client component scoping**: Login page uses server component for session check + client component for interactive form. Good pattern.
- **Skeleton loading states**: Comprehensive skeleton system used across pages (discover, square, matches, stats).
- **`will-change: transform`**: Glow orbs have proper GPU layer hints.

### Issues

- **framer-motion imports**: 32 files import from framer-motion (2 files with single quotes, 30 with double quotes). This is a significant bundle size concern (~30KB+ gzipped). Key offenders:
  - `tabs.tsx` and `tooltip.tsx` use framer-motion for simple fade/slide animations that could be CSS-only
  - `discover/page.tsx`, `square/page.tsx`, `chat/page.tsx` all import motion/AnimatePresence
  - Multiple animation keyframes already exist in CSS — opportunity to consolidate

- **next/image vs native `<img>` ratio**: 5 `next/image` imports vs 6 native `<img>` tags in page components. Many avatar/image usages in discover, matches, square, and profile pages use raw `<img>` instead of the optimized `Avatar` component or `next/image`.

- **Inline styles on login page**: The entire login form uses inline `style={}` objects, preventing CSS optimization and increasing JS bundle size. Every render creates new style objects.

- **No image optimization on profile gallery**: `profile/page.tsx` gallery photos use raw `<img>` tags with external URLs — no lazy loading, no `decoding="async"`, no `sizes` attribute.

- **No dynamic imports**: All framer-motion imports are static. Pages like `discover`, `square`, `chat` could benefit from `next/dynamic` with `ssr: false` for the motion library.

- **CSS animation duplication**: `shimmer` keyframes are defined both in `globals.css` AND injected at runtime in `skeleton.tsx` via `document.createElement("style")`.

---

## 6. Hardcoded Color Analysis

**Total hardcoded color instances (hex + rgba):** 333 across `src/`

### Breakdown by area:

| Area | Count | Severity |
|------|-------|----------|
| Auth pages (login, register, forgot-password, reset-password) | ~60 | **High** — Entirely separate color system |
| CSS utilities (glass, scrollbar, animations, match scores) | ~40 | **Medium** — Should use CSS variables |
| Discover page (gradient overlays, swipe indicators) | ~10 | **Low** — Visual overlay effects |
| Chat layout | ~5 | **Low** |
| Square page | ~5 | **Low** |
| Third-party SVG fills (Google, Discord icons) | ~10 | **Acceptable** — Brand colors |

### Recommended fixes:
1. **Auth pages**: Replace inline `colors` objects with CSS variable references (`var(--foreground)`, `var(--primary)`, etc.)
2. **CSS utilities**: Replace `rgba(180, 100, 60, ...)` with OKLCH-based CSS variables
3. **Match score classes**: Use `var(--success)`, `var(--warning)`, `var(--error)` instead of hex

---

## 7. Data Model (Prisma Schema) — UI Relevance

- **Profile model**: Comprehensive relationship blueprint fields (attachmentStyle, communicationStyle, conflictResolution, loveLanguage, boundaries, dealbreakers, lifePriorities, emotionalAvailability) — well-aligned with the multi-step profile form.
- **Gender/Sexuality enums**: Support for NON_BINARY, OTHER genders and diverse sexual orientations — inclusive design.
- **Gallery photos**: `galleryPhotos` stored as JSON string array — supports the photo gallery feature in profile.
- **Vault system**: Full implementation with expiry, extension, revocation — reflected in chat UI.
- **Subscription model**: FREE, LADY_FREE, PREMIUM_MONTHLY, PREMIUM_YEARLY, LIFETIME — matches subscription page UI.

---

## 8. Recommendations (Priority Order)

### P0 — Critical
1. **Unify auth page styling**: Migrate login, register, forgot-password, and reset-password from inline styles to the design system's CSS variables and Tailwind classes.
2. **Dialog focus trap**: Add focus trapping and `aria-modal` to the Dialog component. Consider using `@radix-ui/react-dialog` or similar.

### P1 — High
3. **Consolidate component exports**: Update `src/components/ui/index.ts` to export all UI components for consistent imports.
4. **Add ARIA labels**: Add `aria-label` to all icon-only buttons across all pages.
5. **Replace hardcoded match-score colors**: Use `var(--success)`, `var(--warning)`, `var(--error)` instead of hex values.

### P2 — Medium
6. **Reduce framer-motion usage**: Replace simple fade/slide animations in `tabs.tsx` and `tooltip.tsx` with CSS transitions. Use `next/dynamic` for pages that need motion.
7. **Image optimization**: Use the `Avatar` component or `next/image` consistently in discover, matches, square, and profile pages.
8. **Fix CSS animation duplication**: Remove runtime style injection from `skeleton.tsx` since `shimmer` already exists in `globals.css`.

### P3 — Low
9. **Square page desktop layout**: Consider expanding `max-w-md` to `max-w-2xl` or `max-w-4xl` on larger screens with more columns.
10. **Color contrast audit**: Run automated WCAG contrast checks on all foreground/background combinations, especially `foreground-faint` and `foreground-subtle`.
11. **Add skip navigation**: Implement a skip-to-content link for keyboard accessibility.

---

## File Inventory

### Files Reviewed
- `src/app/globals.css` (1063 lines) — Design system foundation
- `src/components/ui/button.tsx` — CVA-based button
- `src/components/ui/card.tsx` — Standard card components
- `src/components/ui/input.tsx` — Input component
- `src/components/ui/dialog.tsx` — Custom dialog (no focus trap)
- `src/components/ui/avatar.tsx` — Smart avatar with next/image detection
- `src/components/ui/badge.tsx` — CVA-based badge
- `src/components/ui/tabs.tsx` — Animated tabs with framer-motion
- `src/components/ui/toast.tsx` — Toast system (react-hot-toast)
- `src/components/ui/tooltip.tsx` — Custom tooltip with framer-motion
- `src/components/ui/checkbox.tsx` — Checkbox component
- `src/components/ui/skeleton.tsx` — Comprehensive skeleton system
- `src/app/(dashboard)/dashboard/discover/page.tsx` — Swipe card UI
- `src/app/(dashboard)/dashboard/chat/page.tsx` — Chat entry page
- `src/app/(dashboard)/dashboard/chat/layout.tsx` — Chat list sidebar
- `src/app/(dashboard)/dashboard/matches/page.tsx` — Matches grid
- `src/app/(dashboard)/dashboard/profile/page.tsx` — Multi-step profile form
- `src/app/(dashboard)/dashboard/square/page.tsx` — Matching square grid
- `src/app/(dashboard)/dashboard/subscription/page.tsx` — Pricing/subscription
- `src/app/(auth)/login/page.tsx` — Login server component
- `src/app/(auth)/login/login-inner-client.tsx` — Login client (inline styles)
- `prisma/schema.prisma` (1651 lines) — Data model

### Grep Analysis
- **framer-motion imports**: 32 files
- **Hardcoded colors (hex/rgba)**: 333 instances
- **next/image imports**: 5 files
- **Native `<img>` tags**: 6 instances in pages
