"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { getAdminStatus, isVerified } from "@/lib/engine";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/run", label: "Run a job" },
  { href: "/connect", label: "Connect" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/register", label: "Earn" },
];

export function Nav() {
  const path = usePathname();
  const { address } = useAccount();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const check = () => {
      // Only trust the admin flag if the *currently connected* wallet is the one
      // that holds the session — otherwise a stale token could show the link to
      // a different wallet. No verified session for this address → never admin.
      if (!address || !isVerified(address)) {
        setIsAdmin(false);
        return;
      }
      getAdminStatus().then((s) => setIsAdmin(s.admin)).catch(() => setIsAdmin(false));
    };
    check();
    // Re-check when the SIWE session changes (verify / clear fires this event).
    window.addEventListener("foreman-session", check);
    return () => window.removeEventListener("foreman-session", check);
  }, [address]);

  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <header className="sticky top-0 z-50 border-b border-edge bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent/15 text-accent">▦</span>
          Foreman
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  active ? "bg-panel2 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <span className="ml-2">
            <ConnectButton />
          </span>
        </nav>
      </div>
    </header>
  );
}
