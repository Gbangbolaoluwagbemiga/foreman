"use client";

import { useEffect, useState } from "react";
import { isVerified } from "@/lib/engine";

/** Live "is this wallet a verified owner?" — re-checks on session change. */
export function useVerified(address?: string): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    const update = () => setV(isVerified(address));
    update();
    window.addEventListener("foreman-session", update);
    window.addEventListener("storage", update);
    const t = setInterval(update, 30_000); // catch session expiry
    return () => {
      window.removeEventListener("foreman-session", update);
      window.removeEventListener("storage", update);
      clearInterval(t);
    };
  }, [address]);
  return v;
}
