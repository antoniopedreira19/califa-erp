import { notFound, redirect } from "next/navigation";
import { Users, Briefcase, DollarSign } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { tipoContratacaoLabel } from "@/lib/types";
import type {
  Colaborador,
  ColaboradorAlocacao,
  ColaboradorSalario,
  Empresa,
  Nivel,
} from "@/lib/types";
import { CardDados } from "./card-dados";
import { CardAlocacoes } from "./card-alocacoes";
import { CardSalarios } from "./card-salarios";
import { CardDadosBancarios } from "./card-dados-bancarios";
import { CardAcesso } from "./card-acesso";
import { BannerPendencias } from "./banner-pendencias";
import { carregarAcessoColaborador } from "@/lib/auth/acesso-colaborador";
import { createServiceClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";
import {
  avaliarPendencias,
  separarPendenciasPorCard,
} from "@/lib/rh/pendencias";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";

export const dynamic = "force-dynamic";

export default async function ColaboradorDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const anoRateio = new Date().getFullYear();
  const [
    colabRes,
    alocacoesRes,
    salariosRes,
    empresasRes,
    regionaisRes,
    niveisRes,
    rateiosRes,
    lideresRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("*, nivel:niveis(id, codigo, descricao), lider:profiles!lider_id(id, nome)")
      .eq("id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("colaboradores_alocacoes")
      .select(
        // regional:regionais precisa desambiguar o FK — colaboradores_alocacoes
        // tem 2 FKs pra regionais: a simples `regional_id` e uma composta
        // (regional_id, empresa_id) que garante que a regional pertence à
        // empresa. Sem o `!nome_da_fk` o PostgREST não sabe qual usar e
        // devolve o embed como null/erro silencioso — o que fazia a página
        // do detalhe achar que não havia alocação e disparava a pendência
        // crítica "Alocação vigente" mesmo com alocação real no banco.
        "*, empresa:empresas(id, nome_fantasia), regional:regionais!colaboradores_alocacoes_regional_id_fkey(id, nome)",
      )
      .eq("colaborador_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_inicio", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("colaboradores_salarios")
      .select("*")
      .eq("colaborador_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_inicio", { ascending: false })
      .order("created_at", { ascending: false }),
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
    supabase
      .from("empresas_rateios_regionais")
      .select("empresa_id, percentual, regional:regionais(id, nome)")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ano_vigencia", anoRateio),
    // Membros ativos do tenant pro Combobox de líder direto no drawer.
    // Não usa embed `profile:profiles(...)` porque não há FK direta entre
    // tenant_members.user_id e profiles.id — ambos referenciam auth.users,
    // relação transitiva que o PostgREST não segue. Trazemos os user_ids
    // aqui e resolvemos os nomes na próxima query.
    supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
  ]);

  if (!colabRes.data) {
    notFound();
  }

  const colab = colabRes.data as unknown as Colaborador & {
    nivel: Pick<Nivel, "id" | "codigo" | "descricao"> | null;
    lider: { id: string; nome: string } | null;
  };

  const alocacoes = (alocacoesRes.data ?? []) as (ColaboradorAlocacao & {
    empresa: Pick<Empresa, "id" | "nome_fantasia">;
    regional: { id: string; nome: string } | null;
  })[];

  // Agrega rateios por empresa pra passar ao card de alocação. Só entram as
  // regionais com % > 0 no ano corrente (tabela não guarda 0%).
  const rateiosDoAno = (() => {
    const mapa = new Map<
      string,
      { regional_id: string; regional_nome: string; percentual: number }[]
    >();
    for (const r of ((rateiosRes.data ?? []) as any[])) {
      if (!r.regional) continue;
      const lista = mapa.get(r.empresa_id) ?? [];
      lista.push({
        regional_id: r.regional.id,
        regional_nome: r.regional.nome,
        percentual: Number(r.percentual),
      });
      mapa.set(r.empresa_id, lista);
    }
    return Array.from(mapa.entries()).map(([empresa_id, regionais]) => ({
      empresa_id,
      regionais: regionais.sort((a, b) =>
        a.regional_nome.localeCompare(b.regional_nome, "pt-BR"),
      ),
    }));
  })();

  const salarios = (salariosRes.data ?? []) as ColaboradorSalario[];

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

  const isAdmin = session.activeRole === "administrador";

  const pendencias = avaliarPendencias({
    colaborador: {
      tipo_contratacao: colab.tipo_contratacao,
      cpf: colab.cpf,
      cnpj: colab.cnpj,
      email: colab.email,
      telefone: colab.telefone,
      nivel_id: colab.nivel_id,
      data_nascimento: colab.data_nascimento,
      area: colab.area,
      banco_codigo: colab.banco_codigo,
      agencia: colab.agencia,
      conta: colab.conta,
      conta_dv: colab.conta_dv,
      tipo_conta: colab.tipo_conta,
      pix_chave: colab.pix_chave,
    },
    temSalarioVigente: salarios.some((s) => s.data_fim === null),
    temAlocacaoVigente: alocacoes.some((a) => a.data_fim === null),
  });
  const pendenciasPorCard = separarPendenciasPorCard(pendencias);

  // Dados de acesso ao sistema (card CardAcesso).
  // Faz 2 round-trips via service client — não cabe em RLS do server client.
  // Só carrega se o colaborador já tem user_id vinculado.
  let acesso = null;
  let roleAtual: AppRole | null = null;
  let profileNome: string | null = null;
  if (colab.user_id) {
    const service = createServiceClient();
    const [acessoRes, membershipRes] = await Promise.all([
      carregarAcessoColaborador(colab.user_id),
      service
        .from("tenant_members")
        .select("role, profiles:profiles!user_id(nome)")
        .eq("tenant_id", session.activeTenant.id)
        .eq("user_id", colab.user_id)
        .maybeSingle(),
    ]);
    acesso = acessoRes;
    const m = membershipRes.data as
      | { role: AppRole; profiles: { nome: string } | null }
      | null;
    roleAtual = (m?.role as AppRole | undefined) ?? null;
    profileNome = m?.profiles?.nome ?? null;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <BotaoVoltar reserva="/rh/colaboradores" />
        <header className="mt-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold tracking-tight">
                  {colab.nome}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                    colab.status === "ativo"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      colab.status === "ativo"
                        ? "bg-emerald-500"
                        : "bg-muted-foreground"
                    }`}
                  />
                  {colab.status === "ativo" ? "Ativo" : "Inativo"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {colab.funcao}
                {colab.nivel ? ` · ${colab.nivel.codigo}` : ""} ·{" "}
                {tipoContratacaoLabel(colab.tipo_contratacao)}
              </p>
            </div>
          </div>
        </header>
      </div>

      <BannerPendencias pendencias={pendencias} />

      <div className="grid gap-4">
        <CardDados
          colaborador={colab}
          empresas={empresas}
          regionais={regionais}
          niveis={niveis}
          lideres={lideres}
          pendencia={pendenciasPorCard.dados}
        />

        <CardAcesso
          colaborador={{
            id: colab.id,
            nome: colab.nome,
            email: colab.email,
            user_id: colab.user_id,
          }}
          acesso={acesso}
          roleAtual={roleAtual}
          profileNome={profileNome}
        />

        <CardDadosBancarios
          colaborador={colab}
          pendencia={pendenciasPorCard.bancario}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <CardAlocacoes
            colaboradorId={colab.id}
            alocacoes={alocacoes}
            empresas={empresas}
            regionais={regionais}
            rateiosDoAno={rateiosDoAno}
            anoRateio={anoRateio}
            pendencia={pendenciasPorCard.alocacao}
          />
          <CardSalarios
            colaboradorId={colab.id}
            salarios={salarios}
            isAdmin={isAdmin}
            pendencia={pendenciasPorCard.salario}
          />
        </div>
      </div>
    </div>
  );
}
