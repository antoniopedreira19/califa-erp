import { MapPin } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Cidade } from "@/lib/types";
import { CidadesList } from "./cidades-list";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function CidadesPage() {
  // Só do Admin desde 10/11/2026, como o resto de Configurações.
  const session = await requireAdmin();
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
        <BotaoVoltar reserva="/admin" className="mb-3" />
        <PageHeader
          eyebrow="CONFIGURAÇÕES"
          title="Cidades"
          description="Vocabulário de cidades compartilhado pelo tenant. Usado ao criar projetos."
          icon={MapPin}
        />
      </div>

      <CidadesList cidades={rows} isAdmin={isAdmin} />
    </div>
  );
}
