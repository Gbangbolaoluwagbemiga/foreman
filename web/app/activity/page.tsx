import { redirect } from "next/navigation";

// Activity merged into the Dashboard ("Live economy"). Keep the route alive so
// old links land in the right place.
export default function ActivityPage() {
  redirect("/dashboard");
}
