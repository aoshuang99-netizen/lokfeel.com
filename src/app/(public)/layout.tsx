export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The landing page renders its own video bg, nav, and footer
  return <>{children}</>;
}
