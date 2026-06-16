import "./globals.css";
import type { Metadata } from "next";
import { Nav } from "./components/Nav";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Foreman — agents that hire & pay agents on Arc",
  description:
    "Give your AI a budget and a goal. It hires a crew of specialist AIs, pays each per task in USDC on Arc, and returns the work plus a receipt.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-6xl px-5 pb-24">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
