/**
 * Lazy-loaded Recharts components
 * 
 * ✅ OPTIMIZATION: Lazy load heavy chart library (T03.2)
 * Only loads recharts when charts are actually needed.
 * 
 * Usage:
 *   import { LineChart, BarChart } from '@/components/admin/charts/chart-lazy';
 */

'use client';

import dynamic from 'next/dynamic';
import { ComponentType } from 'react';

// Loading fallback for chart components
const ChartFallback = ({ height = 300 }: { height?: number }) => (
  <div 
    className="animate-pulse bg-foreground/5 rounded-lg flex items-center justify-center"
    style={{ height: `${height}px` }}
  >
    <div className="text-foreground-muted text-sm">Loading chart...</div>
  </div>
);

// Dynamically import Recharts components (client-side only)
const LineChart = dynamic(
  () => import('recharts').then((mod) => ({
    default: mod.LineChart,
  })),
  {
    ssr: false,
    loading: () => <ChartFallback />,
  }
);

const BarChart = dynamic(
  () => import('recharts').then((mod) => ({
    default: mod.BarChart,
  })),
  {
    ssr: false,
    loading: () => <ChartFallback />,
  }
);

const AreaChart = dynamic(
  () => import('recharts').then((mod) => ({
    default: mod.AreaChart,
  })),
  {
    ssr: false,
    loading: () => <ChartFallback />,
  }
);

const PieChart = dynamic(
  () => import('recharts').then((mod) => ({
    default: mod.PieChart,
  })),
  {
    ssr: false,
    loading: () => <ChartFallback />,
  }
);

const RadarChart = dynamic(
  () => import('recharts').then((mod) => ({
    default: mod.RadarChart,
  })),
  {
    ssr: false,
    loading: () => <ChartFallback height={400} />,
  }
);

// Export chart components
export { LineChart, BarChart, AreaChart, PieChart, RadarChart };

// Lazy load common Recharts components
export const LazyXAxis = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.XAxis })),
  { ssr: false, loading: () => null }
);

export const LazyYAxis = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.YAxis })),
  { ssr: false, loading: () => null }
);

export const LazyCartesianGrid = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.CartesianGrid })),
  { ssr: false, loading: () => null }
);

export const LazyTooltip = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Tooltip })),
  { ssr: false, loading: () => null }
);

export const LazyLegend = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Legend })),
  { ssr: false, loading: () => null }
);

export const LazyLine = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Line })),
  { ssr: false, loading: () => null }
);

export const LazyBar = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Bar })),
  { ssr: false, loading: () => null }
);

export const LazyArea = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Area })),
  { ssr: false, loading: () => null }
);

export const LazyPie = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Pie })),
  { ssr: false, loading: () => null }
);

export const LazyRadar = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.Radar })),
  { ssr: false, loading: () => null }
);

export const LazyRadarBasis = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.PolarGrid })),
  { ssr: false, loading: () => null }
);

export const LazyPolarAngleAxis = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.PolarAngleAxis })),
  { ssr: false, loading: () => null }
);

export const LazyPolarRadiusAxis = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.PolarRadiusAxis })),
  { ssr: false, loading: () => null }
);

export const LazyResponsiveContainer = dynamic(
  () => import('recharts').then((mod) => ({ default: mod.ResponsiveContainer })),
  { ssr: false, loading: () => null }
);
