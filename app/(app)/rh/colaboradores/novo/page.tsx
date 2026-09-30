import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Empresa, Nivel } from "@/lib/types";
import { ColaboradorFormNovo } from "../colaborador-form-novo";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function NovoColaboradorPage() {
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
    // Membros ativos do tenant pro Combobox de líder direto.
    supabase
      .from("tenant_members")
      .select("user_id, profile:profiles(id, nome)")
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

  const lideres = ((lideresRes.data ?? []) as unknown as Array<{
    user_id: string;
    profile: { id: string; nome: string } | null;
  }>)
    .flatMap((tm) => (tm.profile ? [tm.profile] : []))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <BotaoVoltar reserva="/rh/colaboradores" />
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Novo colaborador
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastra dados fixos + primeira alocação (100% em empresa/regional) +
          salário inicial. Rateio, mudanças de alocação e mudanças salariais
          são feitas depois na página do colaborador.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ColaboradorFormNovo
          empresas={empresas}
          regionais={regionais}
          niveis={niveis}
          lideres={lideres}
        />
      </div>
    </div>
  );
}
