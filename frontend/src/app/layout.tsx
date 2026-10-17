import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
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
  title: "Job Application Tracker",
  description: "Organise your job applications, interviews, and next steps.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Suspense
          fallback={
            <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
              <p role="status" className="text-sm text-slate-600">
                Loading your workspace...
              </p>
            </main>
          }
        >
          <ClerkProvider afterSignOutUrl="/sign-in">{children}</ClerkProvider>
        </Suspense>
      </body>
    </html>
  );
}
