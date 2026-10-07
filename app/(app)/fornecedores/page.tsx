import Link from "next/link";
import { Building2, Plus, } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Fornecedor } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { FornecedoresList } from "./fornecedores-list";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function FornecedoresPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [{ data: fornecedores, error }, veiculosRes] = await Promise.all([
    supabase
      .from("fornecedores")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("nome", { ascending: true })
      .returns<Fornecedor[]>(),
    // Quem também é veículo de mídia ganha o selo (decisão 150).
    supabase
      .from("veiculos_midia")
      .select("fornecedor_id")
      .eq("tenant_id", session.activeTenant.id)
      .returns<{ fornecedor_id: string }[]>(),
  ]);

  if (error) console.error("[fornecedores.page]", error.message);
  if (veiculosRes.error) console.error("[fornecedores.page.veiculos]", veiculosRes.error.message);
  const rows = fornecedores ?? [];
  const veiculoIds = (veiculosRes.data ?? []).map((v) => v.fornecedor_id);

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/cadastros" className="mb-3" />
        <PageHeader
          eyebrow="COMERCIAL"
          title="Fornecedores"
          description="Pessoas físicas ou jurídicas que aparecem como custo nos itens da versão do orçamento."
          icon={Building2}
          actions={
            <Link
              href="/fornecedores/novo"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
            >
              <Plus className="h-4 w-4" />
              Novo fornecedor
            </Link>
          }
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Nenhum fornecedor cadastrado"
          description="Cadastre fornecedores para uso nas versões de orçamento."
          action={
            <Link
              href="/fornecedores/novo"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar fornecedor
            </Link>
          }
        />
      ) : (
        <FornecedoresList fornecedores={rows} veiculoIds={veiculoIds} />
      )}
    </div>
  );
}
