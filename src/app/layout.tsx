import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LA Coffee Community",
  description: "A community for baristas, owners and coffee lovers, centred on cafes.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geist.variable}>
      <body className="min-h-dvh font-sans antialiased">
        <Header />
        <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-4">{children}</main>
      </body>
    </html>
  );
}
