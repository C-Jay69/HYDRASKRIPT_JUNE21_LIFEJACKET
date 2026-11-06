import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { AuthSessionProvider } from "@/components/providers/AuthSessionProvider";
import RouteTransitionIndicator from "@/components/layout/RouteTransitionIndicator";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HydraSkript — AI-Powered Book Generation Platform",
  description: "Create full-length books with chapters, illustrations, and custom writing styles — all from a single prompt. Powered by AI.",
  keywords: ["AI", "book generation", "writing", "illustrations", "style training", "HydraSkript"],
  authors: [{ name: "HydraSkript Team" }],
  icons: {
    icon: "/HYDRASKRIPT_LOGO.png",
  },
  openGraph: {
    title: "HydraSkript — AI Book Generation",
    description: "Generate complete books with AI: chapters, illustrations, and custom styles.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-gray-100`}
        suppressHydrationWarning
      >
        <AuthSessionProvider>
          {children}
          <RouteTransitionIndicator />
          <Toaster />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
