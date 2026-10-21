import { redirect } from "next/navigation";
import { getViewer, homePathFor } from "@/lib/auth/dal";

export default async function Home() {
  const viewer = await getViewer();
  redirect(viewer ? homePathFor(viewer.role) : "/sign-in");
}
