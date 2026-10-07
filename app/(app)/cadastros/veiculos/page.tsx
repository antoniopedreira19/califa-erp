import Link from "next/link";
import { Plus, Radio } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Fornecedor } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { VeiculosList, type VeiculoDaTela } from "./veiculos-list";

export const dynamic = "force-dynamic";

/**
 * Cadastros › Veículos (decisão 150): os fornecedores marcados como veículo
 * de mídia (`veiculos_midia`), com os meios em que já foram usados nas
 * planilhas (`vw_veiculos_meios_usados`). O cadastro é o do fornecedor.
 */
export default async function VeiculosPage() {
  const session = await requireSession();
  const supabase = createClient();

  const [veiculosRes, usoRes] = await Promise.all([
    supabase
      .from("veiculos_midia")
      .select("fornecedor:fornecedores!inner(*)")
      .eq("tenant_id", session.activeTenant.id)
      .returns<{ fornecedor: Fornecedor }[]>(),
    supabase
      .from("vw_veiculos_meios_usados")
      .select("fornecedor_id, meio")
      .eq("tenant_id", session.activeTenant.id)
      .returns<{ fornecedor_id: string; meio: string }[]>(),
  ]);

  if (veiculosRes.error) console.error("[cadastros.veiculos]", veiculosRes.error.message);
  if (usoRes.error) console.error("[cadastros.veiculos.uso]", usoRes.error.message);

  const usadoEm = new Map<string, string[]>();
  for (const u of usoRes.data ?? []) {
    usadoEm.set(u.fornecedor_id, [...(usadoEm.get(u.fornecedor_id) ?? []), u.meio]);
  }
  const veiculos: VeiculoDaTela[] = (veiculosRes.data ?? [])
    .map(({ fornecedor }) => ({
      fornecedor,
      usadoEm: (usadoEm.get(fornecedor.id) ?? []).sort((a, b) => a.localeCompare(b, "pt-BR")),
    }))
    .sort((a, b) => a.fornecedor.nome.localeCompare(b.fornecedor.nome, "pt-BR"));

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/cadastros" className="mb-3" />
        <PageHeader
          eyebrow="CADASTROS"
          title="Veículos"
          description="Emissoras, exibidores e portais que vendem espaço nos planos de Mídia Off. Cada veículo é um fornecedor: o PI, a nota e a PP do repasse saem deste cadastro."
          icon={Radio}
          actions={
            <Link
              href="/cadastros/veiculos/novo"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all"
            >
              <Plus className="h-4 w-4" />
              Novo veículo
            </Link>
          }
        />
      </div>

      {veiculos.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="Nenhum veículo cadastrado"
          description="Cadastre os veículos para escolhê-los nas linhas dos planos de Mídia Off."
          action={
            <Link
              href="/cadastros/veiculos/novo"
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
            >
              <Plus className="h-4 w-4" />
              Criar veículo
            </Link>
          }
        />
      ) : (
        <VeiculosList veiculos={veiculos} />
      )}
    </div>
  );
}
