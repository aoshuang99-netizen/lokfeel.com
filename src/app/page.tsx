import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LokFeel — Real Matches. Real Connection.",
  description:
    "LokFeel is a relationship structure matching engine. Get 5 AI-curated matches per week with explanations of why you connect. Safe, private, and designed for meaningful relationships.",
  alternates: {
    canonical: "https://lokfeel.com",
  },
};

export default function Home() {
  redirect("/login");
}
