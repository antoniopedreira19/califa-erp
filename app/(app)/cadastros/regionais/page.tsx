import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Regional } from "@/lib/types";
import { RegionaisList } from "./regionais-list";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function RegionaisPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("regionais")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true })
    .returns<Regional[]>();

  if (error) console.error("[regionais.page]", error.message);

  const rows = data ?? [];
  const isAdmin = session.activeRole === "administrador";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/cadastros"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para cadastros
        </Link>
        <PageHeader
          eyebrow="CADASTROS"
          title="Regionais"
          description="Vocabulário de regionais compartilhado pelo tenant. Usado ao criar jobs."
          icon={MapPin}
        />
      </div>

      <RegionaisList regionais={rows} isAdmin={isAdmin} />
    </div>
  );
}
