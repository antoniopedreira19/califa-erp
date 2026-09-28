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
  // Sem embed em regional/empresa (contratacoes tem duas FKs pra
  // regionais → embed ambíguo do PostgREST). Resolvo por mapa.
  const [contratacoesRes, empresasRes, regionaisRes] = await Promise.all([
    supabase
      .from("contratacoes")
      .select(
        "id, nome, cargo, tipo_contratacao, status, created_at, empresa_id, regional_id",
      )
      .eq("tenant_id", session.activeTenant.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (contratacoesRes.error) {
    console.error("[rh.contratacoes.page]", contratacoesRes.error.message);
  }

  const empresaNomePorId = new Map<string, string>(
    ((empresasRes.data ?? []) as { id: string; nome_fantasia: string }[]).map(
      (e) => [e.id, e.nome_fantasia],
    ),
  );
  const regionalNomePorId = new Map<string, string>(
    ((regionaisRes.data ?? []) as { id: string; nome: string }[]).map((r) => [
      r.id,
      r.nome,
    ]),
  );

  const linhas: ContratacaoRow[] = ((contratacoesRes.data ?? []) as any[]).map(
    (c) => ({
      id: c.id,
      nome: c.nome,
      cargo: c.cargo,
      tipo_contratacao: c.tipo_contratacao,
      status: c.status,
      created_at: c.created_at,
      empresa_nome: empresaNomePorId.get(c.empresa_id) ?? null,
      regional_nome: c.regional_id
        ? regionalNomePorId.get(c.regional_id) ?? null
        : null,
    }),
  );

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
