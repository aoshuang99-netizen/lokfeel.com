"use client";

import { useMemo } from "react";

interface DynamicWatermarkProps {
  userId: string;
  username: string;
}

export function DynamicWatermark({ userId, username }: DynamicWatermarkProps) {
  const watermarkText = useMemo(() => {
    const timestamp = new Date().toISOString().slice(0, 10);
    return `LOKFEEL • ${username} • ${userId.slice(-8)} • ${timestamp}`;
  }, [userId, username]);

  // Generate repeating pattern
  const pattern = useMemo(() => {
    const items = [];
    for (let i = 0; i < 20; i++) {
      items.push(watermarkText);
    }
    return items;
  }, [watermarkText]);

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[9999] overflow-hidden"
      style={{
        opacity: 0.06,
      }}
    >
      <div
        className="absolute inset-0 flex flex-wrap content-center justify-center gap-x-16 gap-y-8"
        style={{
          transform: "rotate(-30deg) scale(1.5)",
        }}
      >
        {pattern.map((text, index) => (
          <span
            key={index}
            className="text-white text-sm font-medium whitespace-nowrap select-none"
            style={{
              textShadow: "0 0 2px rgba(0,0,0,0.5)",
            }}
          >
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
