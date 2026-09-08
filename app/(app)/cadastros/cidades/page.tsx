import Link from "next/link";
import { ArrowLeft, MapPin } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Cidade } from "@/lib/types";
import { CidadesList } from "./cidades-list";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function CidadesPage() {
  const session = await requireSession();
  const supabase = createClient();

  const { data, error } = await supabase
    .from("cidades")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .order("nome", { ascending: true })
    .returns<Cidade[]>();

  if (error) console.error("[cidades.page]", error.message);

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
          title="Cidades"
          description="Vocabulário de cidades compartilhado pelo tenant. Usado ao criar projetos."
          icon={MapPin}
        />
      </div>

      <CidadesList cidades={rows} isAdmin={isAdmin} />
    </div>
  );
}
