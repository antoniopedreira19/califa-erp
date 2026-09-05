import Link from "next/link";
import { ArrowLeft, ListTree } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { PlanoContaTipo, PlanoContaSubtipo } from "@/lib/types";
import { PlanoContasTree } from "./plano-contas-tree";

export const dynamic = "force-dynamic";

export default async function PlanoDeContasPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [tiposRes, subtiposRes, lancTipoRes, lancSubtipoRes] =
    await Promise.all([
      supabase
        .from("plano_contas_tipos")
        .select("*")
        .eq("tenant_id", session.activeTenant.id)
        .order("codigo", { ascending: true })
        .returns<PlanoContaTipo[]>(),
      supabase
        .from("plano_contas_subtipos")
        .select("*")
        .eq("tenant_id", session.activeTenant.id)
        .order("codigo", { ascending: true })
        .returns<PlanoContaSubtipo[]>(),
      // Ids de tipos que já têm lançamento — bloqueia edição de código na UI
      supabase
        .from("lancamentos_financeiros")
        .select("plano_conta_tipo_id")
        .eq("tenant_id", session.activeTenant.id),
      // Ids de subtipos que já têm lançamento
      supabase
        .from("lancamentos_financeiros")
        .select("plano_conta_subtipo_id")
        .eq("tenant_id", session.activeTenant.id),
    ]);

  if (tiposRes.error)
    console.error("[plano_contas_tipos.page]", tiposRes.error.message);
  if (subtiposRes.error)
    console.error("[plano_contas_subtipos.page]", subtiposRes.error.message);
  // lancamentos_financeiros pode não existir ainda — falha silenciosa

  const tipos = tiposRes.data ?? [];
  const subtipos = subtiposRes.data ?? [];
  const tiposComLancamento = Array.from(
    new Set(
      (lancTipoRes.data ?? []).map(
        (r: { plano_conta_tipo_id: string }) => r.plano_conta_tipo_id,
      ),
    ),
  );
  const subtiposComLancamento = Array.from(
    new Set(
      (lancSubtipoRes.data ?? []).map(
        (r: { plano_conta_subtipo_id: string | null }) =>
          r.plano_conta_subtipo_id,
      ),
    ),
  ).filter((id): id is string => id !== null);

  const canEdit =
    session.activeRole === "administrador" ||
    session.activeRole === "financeiro";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/financeiro/cadastros"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para cadastros do financeiro
        </Link>
        <header className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-california-red/10 p-2">
              <ListTree className="h-5 w-5 text-california-red" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Plano de contas</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Estrutura hierárquica de tipos e subtipos usada para classificar cada
            lançamento. Base do DRE.
          </p>
        </header>
      </div>

      <PlanoContasTree
        tipos={tipos}
        subtipos={subtipos}
        tiposComLancamento={tiposComLancamento}
        subtiposComLancamento={subtiposComLancamento}
        canEdit={canEdit}
      />
    </div>
  );
}
