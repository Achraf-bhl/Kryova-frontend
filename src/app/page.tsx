import { redirect } from "next/navigation";

export default function Home() {
  // The product's front door. `src/proxy.ts` gates /dashboard and bounces to
  // /login when there is no session, so this single redirect serves both the
  // signed-in and signed-out cases — and gives the desktop shell, which opens
  // the site root, somewhere useful to land.
  redirect("/dashboard");
}
