import { redirect } from "next/navigation";
import { FileSignature } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { ContratacoesList, type ContratacaoRow } from "./contratacoes-list";
import { expirarContratacoesVencidas } from "@/app/proposta/[token]/actions";

export const dynamic = "force-dynamic";

export default async function ContratacoesPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  // Marca as vencidas antes de listar — v1 sem cron, atualização lazy.
  await expirarContratacoesVencidas(session.activeTenant.id);

  const supabase = createClient();
  const { data, error } = await supabase
    .from("contratacoes")
    .select(
      "id, nome, cargo, tipo_contratacao, status, created_at, empresa:empresas(id, nome_fantasia), regional:regionais(id, nome)",
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[rh.contratacoes.page]", error.message);
  }

  const linhas: ContratacaoRow[] = ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    cargo: c.cargo,
    tipo_contratacao: c.tipo_contratacao,
    status: c.status,
    created_at: c.created_at,
    empresa_nome: c.empresa?.nome_fantasia ?? null,
    regional_nome: c.regional?.nome ?? null,
  }));

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/rh" />

      <PageHeader
        eyebrow="RH"
        title="Contratações"
        description="Pipeline dos candidatos: da proposta ao contrato assinado. Ao efetivar, vira colaborador ativo."
        icon={FileSignature}
      />

      <ContratacoesList contratacoes={linhas} />
    </div>
  );
}
