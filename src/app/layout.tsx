import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import RootShell from "@/components/RootShell";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Chicken Farm POS",
  description: "Farm POS for a chicken farm — bills, stock and credit, online or off.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full bg-ground text-ink">
        <RootShell>{children}</RootShell>
      </body>
    </html>
  );
}
