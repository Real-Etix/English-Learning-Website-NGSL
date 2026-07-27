import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AiChat } from "@/components/chat/ai-chat";
import { SiteHeader } from "@/components/layout/site-header";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NGSL Mood Trainer",
  description:
    "Interactive vocabulary learning across NGSL, TOEIC, Business, Academic, and Fitness English with listening, practice modes, and real-world usage.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-sky-50 text-slate-900">
        <div className="relative flex min-h-full flex-col overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.35),_transparent_42%),radial-gradient(circle_at_bottom_right,_rgba(167,139,250,0.22),_transparent_38%),radial-gradient(circle_at_20%_80%,_rgba(251,191,36,0.12),_transparent_45%)]" />
          <SiteHeader />
          <main className="relative flex-1">{children}</main>
          <AiChat />
        </div>
      </body>
    </html>
  );
}
