import Link from "next/link";
import { ChevronRight, ListTree } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { TiposList } from "./tipos-list";
import { SubtiposList } from "./subtipos-list";

export const dynamic = "force-dynamic";

export default async function PlanoDeContasPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [tiposRes, subtiposRes, lancamentosPorTipoRes] = await Promise.all([
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .order("nome", { ascending: true })
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("ordem", { ascending: true })
      .order("nome", { ascending: true })
      .returns<PlanoContaSubtipo[]>(),
    // Quais tipos já têm lançamento (para bloquear edição de código na UI)
    supabase
      .from("lancamentos_financeiros")
      .select("plano_conta_tipo_id")
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (tiposRes.error) console.error("[plano_contas_tipos.page]", tiposRes.error.message);
  if (subtiposRes.error) console.error("[plano_contas_subtipos.page]", subtiposRes.error.message);
  // lancamentosPorTipoRes pode falhar se a tabela ainda não existir — silenciar

  const tipos = tiposRes.data ?? [];
  const subtipos = subtiposRes.data ?? [];
  // Se lancamentos_financeiros não existir ainda, .data será null → Set vazio
  const tiposComLancamento = new Set(
    (lancamentosPorTipoRes.data ?? []).map(
      (r: { plano_conta_tipo_id: string }) => r.plano_conta_tipo_id,
    ),
  );

  const canEdit =
    session.activeRole === "administrador" ||
    session.activeRole === "financeiro";

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <nav className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
          <Link href="/cadastros" className="hover:text-foreground">
            Cadastros
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span>Plano de contas</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <ListTree className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Plano de contas</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Tipos e subtipos usados para classificar cada lançamento. Base do DRE.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Tipos</h2>
        <TiposList
          tipos={tipos}
          tiposComLancamento={Array.from(tiposComLancamento)}
          canEdit={canEdit}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Subtipos</h2>
        <SubtiposList subtipos={subtipos} tipos={tipos} canEdit={canEdit} />
      </section>
    </div>
  );
}
