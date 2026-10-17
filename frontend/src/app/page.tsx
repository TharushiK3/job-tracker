import { auth } from "@clerk/nextjs/server";
import ApplicationDashboard from "@/components/application-dashboard";

export default async function HomePage() {
  await auth.protect();

  return <ApplicationDashboard />;
}
