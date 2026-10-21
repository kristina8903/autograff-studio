import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/dal";
import { FounderForm } from "../../forms";

export const metadata: Metadata = { title: "Add founder" };

export default async function NewFounderPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Add founder" description="You can invite them to sign in after saving." />
      <Card className="max-w-2xl">
        <FounderForm allTimeZones={Intl.supportedValuesOf("timeZone")} />
      </Card>
    </>
  );
}
