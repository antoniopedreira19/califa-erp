import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Empresa, Nivel } from "@/lib/types";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { FormNovaContratacao } from "./form-nova-contratacao";

export const dynamic = "force-dynamic";

export default async function NovaContratacaoPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const [empresasRes, regionaisRes, niveisRes, lideresRes] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome_fantasia"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("niveis")
      .select("id, codigo, descricao")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true),
    // Membros ativos do tenant pro Combobox de líder direto. Sem embed
    // porque não há FK direta entre tenant_members.user_id e profiles.id
    // (ambos apontam pra auth.users; PostgREST não segue transitiva).
    // Nomes vêm na próxima query.
    supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
  ]);

  const empresas = (empresasRes.data ?? []) as Pick<
    Empresa,
    "id" | "nome_fantasia"
  >[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];
  const niveis = ((niveisRes.data ?? []) as Pick<
    Nivel,
    "id" | "codigo" | "descricao"
  >[])
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR"));

  const memberIds = ((lideresRes.data ?? []) as { user_id: string }[]).map(
    (m) => m.user_id,
  );
  const lideresRawRes =
    memberIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", memberIds)
      : { data: [] as { id: string; nome: string }[] };
  const lideres = ((lideresRawRes.data ?? []) as { id: string; nome: string }[])
    .slice()
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <BotaoVoltar reserva="/rh/contratacoes" />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Nova contratação
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Define a proposta (o que o candidato vê) e os dados internos
          (empresa, regional, tipo). Após criar, você envia o link para
          o candidato aceitar e preencher os dados dele.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <FormNovaContratacao
          empresas={empresas}
          regionais={regionais}
          niveis={niveis}
          lideres={lideres}
        />
      </div>
    </div>
  );
}
