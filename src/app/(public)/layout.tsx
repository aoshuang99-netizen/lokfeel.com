import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LokFee! — Find Real Love. No Swiping.",
  description:
    "Relationship matching that connects you based on who you truly are. Join 500K+ members finding meaningful connections.",
  keywords: ["dating", "relationships", "matchmaking", "connection", "compatibility", "lokfee"],
  openGraph: {
    title: "LokFee! — Find Real Love. No Swiping.",
    description:
      "Relationship matching that connects you based on who you truly are.",
    type: "website",
    url: "https://lokfee.com",
  },
};

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The landing page renders its own video bg, nav, and footer
  return <>{children}</>;
}
