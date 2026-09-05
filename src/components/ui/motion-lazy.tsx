/**
 * Lazy-loaded Framer Motion components
 * 
 * ✅ OPTIMIZATION: Lazy load heavy animation library (T03.2)
 * Only loads framer-motion when animations are actually needed.
 * 
 * Usage:
 *   import { MotionDiv, MotionSection } from '@/components/ui/motion-lazy';
 */

'use client';

import dynamic from 'next/dynamic';
import { ComponentType } from 'react';

// Loading fallback for motion components
const MotionFallback = () => (
  <div className="animate-pulse bg-foreground/5 rounded-lg" />
);

// Dynamically import framer-motion (client-side only)
const MotionDiv = dynamic(
  () => import('framer-motion').then((mod) => {
    const Div = ({ children, ...props }: any) => {
      const MotionComponent = mod.motion.div;
      return <MotionComponent {...props}>{children}</MotionComponent>;
    };
    return { default: Div };
  }),
  {
    ssr: false,
    loading: () => <MotionFallback />,
  }
);

const MotionSection = dynamic(
  () => import('framer-motion').then((mod) => {
    const Section = ({ children, ...props }: any) => {
      const MotionComponent = mod.motion.section;
      return <MotionComponent {...props}>{children}</MotionComponent>;
    };
    return { default: Section };
  }),
  {
    ssr: false,
    loading: () => <MotionFallback />,
  }
);

const MotionArticle = dynamic(
  () => import('framer-motion').then((mod) => {
    const Article = ({ children, ...props }: any) => {
      const MotionComponent = mod.motion.article;
      return <MotionComponent {...props}>{children}</MotionComponent>;
    };
    return { default: Article };
  }),
  {
    ssr: false,
    loading: () => <MotionFallback />,
  }
);

// Lazy <motion.img> — used by the avatar lightbox. Null fallback (no pulse box
// around an image) to avoid a flash before framer-motion loads on first open.
const MotionImg = dynamic(
  () => import('framer-motion').then((mod) => {
    const Img = ({ children, ...props }: any) => {
      const MotionComponent = mod.motion.img;
      return <MotionComponent {...props}>{children}</MotionComponent>;
    };
    return { default: Img };
  }),
  {
    ssr: false,
    loading: () => null,
  }
);

// Export motion components
export { MotionDiv, MotionSection, MotionArticle, MotionImg };

// Lazy load AnimatePresence
export const LazyAnimatePresence = dynamic(
  () => import('framer-motion').then((mod) => ({
    default: mod.AnimatePresence,
  })),
  {
    ssr: false,
    loading: () => null,
  }
);

// Lazy load useInView
export function useLazyInView() {
  const useInView = dynamic(
    () => import('framer-motion').then((mod) => ({
      default: mod.useInView,
    })),
    { ssr: false, loading: () => null }
  );
  return useInView;
}
