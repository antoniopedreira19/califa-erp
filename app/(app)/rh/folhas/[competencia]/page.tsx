import { notFound, redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { pode } from "@/lib/permissoes";
import type {
  Empresa,
  FolhaLinhaStatus,
} from "@/lib/types";
import {
  FolhaCompetenciaView,
  type FolhaLinha,
  type ContagemStatus,
} from "./folha-competencia-view";
import { CardsResumoFolha } from "./cards-resumo-folha";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { ChecklistCompetencia } from "../_components/checklist-competencia";
import type { FolhaOrigem } from "@/lib/types";
import {
  obterFechamentoVigenteDaCompetencia,
  temAvulsaPaga,
} from "@/lib/queries/beneficios";

export const dynamic = "force-dynamic";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function parseCompetencia(chave: string): { ano: number; mes: number } | null {
  const m = chave.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2020 || ano > 2099) return null;
  return { ano, mes };
}

function competenciaAnterior(ano: number, mes: number): { ano: number; mes: number } {
  if (mes === 1) return { ano: ano - 1, mes: 12 };
  return { ano, mes: mes - 1 };
}

export default async function FolhaCompetenciaPage({
  params,
}: {
  params: { competencia: string };
}) {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.folhas.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }

  const competencia = parseCompetencia(params.competencia);
  if (!competencia) notFound();
  const { ano, mes } = competencia;
  const prev = competenciaAnterior(ano, mes);

  const supabase = createClient();

  // Passo 1: linhas da competência + empresas + regionais + linhas da competência
  // anterior (só valor + status, pro card com delta). Empresas (4) e regionais (9)
  // do tenant são pequenas — vira Map local pra hidratar o snapshot de alocação
  // sem embed aninhado (docs/PERFORMANCE.md §C).
  const [linhasRes, empresasRes, regionaisRes, linhasPrevRes, rateiosRes] = await Promise.all(
    [
      supabase
        .from("folhas_pagamento")
        .select(
          "id, salario_base, desconto_beneficios, status, motivo_pendencia, colaborador_id, origem",
        )
        .eq("tenant_id", session.activeTenant.id)
        .eq("competencia_ano", ano)
        .eq("competencia_mes", mes)
        .order("created_at", { ascending: true }),
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
        .from("folhas_pagamento")
        .select("salario_base")
        .eq("tenant_id", session.activeTenant.id)
        .eq("competencia_ano", prev.ano)
        .eq("competencia_mes", prev.mes),
      // Rateio padrão por empresa do ANO da competência. Usado pra detectar
      // "Hub" quando a alocação de uma linha bate exatamente com o padrão.
      supabase
        .from("empresas_rateios_regionais")
        .select("empresa_id, regional_id, percentual")
        .eq("tenant_id", session.activeTenant.id)
        .eq("ano_vigencia", ano),
    ],
  );

  if (linhasRes.error) {
    console.error("[folha.competencia.linhas]", linhasRes.error.message);
  }

  const folhasRaw = (linhasRes.data ?? []) as {
    id: string;
    salario_base: string | number;
    desconto_beneficios: string | number | null;
    status: FolhaLinhaStatus;
    motivo_pendencia: string | null;
    colaborador_id: string;
    origem: FolhaOrigem;
  }[];

  const folhaIds = folhasRaw.map((f) => f.id);
  const colaboradorIds = Array.from(
    new Set(folhasRaw.map((f) => f.colaborador_id)),
  );

  // Passo 2: colaboradores + alocacoes em paralelo.
  const [colaboradoresRes, alocacoesRes, nfsAnexadasRes] = await Promise.all([
    colaboradorIds.length > 0
      ? supabase
          .from("colaboradores")
          .select(
            "id, nome, cpf, funcao, tipo_contratacao, nivel:niveis(codigo)",
          )
          .in("id", colaboradorIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    folhaIds.length > 0
      ? supabase
          .from("folhas_pagamento_alocacoes")
          .select("id, folha_id, empresa_id, regional_id, percentual")
          .in("folha_id", folhaIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    // NFs anexadas pra essa competência — pra badge "NF ✓" na listagem RH.
    colaboradorIds.length > 0
      ? supabase
          .from("colaboradores_nf_anexos")
          .select("colaborador_id")
          .eq("tenant_id", session.activeTenant.id)
          .eq("competencia_ano", ano)
          .eq("competencia_mes", mes)
          .in("colaborador_id", colaboradorIds)
      : Promise.resolve({ data: [] as { colaborador_id: string }[], error: null }),
  ]);

  const colabsComNf = new Set(
    (nfsAnexadasRes.data ?? []).map((n) => n.colaborador_id),
  );

  const colaboradorPorId = new Map<
    string,
    {
      id: string;
      nome: string;
      cpf: string | null;
      funcao: string;
      tipo_contratacao: string;
      nivel_codigo: string | null;
    }
  >();
  for (const c of ((colaboradoresRes.data ?? []) as any[])) {
    colaboradorPorId.set(c.id, {
      id: c.id,
      nome: c.nome,
      cpf: c.cpf ?? null,
      funcao: c.funcao,
      tipo_contratacao: c.tipo_contratacao,
      nivel_codigo: c.nivel?.codigo ?? null,
    });
  }

  const empresaNomePorId = new Map<string, string>();
  for (const e of ((empresasRes.data ?? []) as any[])) {
    empresaNomePorId.set(e.id, e.nome_fantasia);
  }
  const regionalNomePorId = new Map<string, string>();
  for (const r of ((regionaisRes.data ?? []) as any[])) {
    regionalNomePorId.set(r.id, r.nome);
  }

  const alocacoesPorFolha = new Map<
    string,
    {
      id: string;
      empresa_id: string;
      regional_id: string;
      percentual: string;
      empresa_nome: string;
      regional_nome: string;
    }[]
  >();
  for (const a of ((alocacoesRes.data ?? []) as any[])) {
    const lista = alocacoesPorFolha.get(a.folha_id) ?? [];
    lista.push({
      id: a.id,
      empresa_id: a.empresa_id,
      regional_id: a.regional_id,
      percentual: String(a.percentual),
      empresa_nome: empresaNomePorId.get(a.empresa_id) ?? "",
      regional_nome: regionalNomePorId.get(a.regional_id) ?? "",
    });
    alocacoesPorFolha.set(a.folha_id, lista);
  }

  // Rateio padrão por empresa (ano = ano da folha). Usado pra detectar quando
  // as alocações de uma linha batem com o padrão → mostra "Hub" em vez da lista.
  // Chave do Set: `${regional_id}:${percentual_normalizado}` ordenado por
  // regional_id. Comparação é por igualdade de conjuntos.
  const rateioPadraoPorEmpresa = new Map<string, string>();
  for (const r of ((rateiosRes.data ?? []) as {
    empresa_id: string;
    regional_id: string;
    percentual: string | number;
  }[])) {
    const pct = Number(r.percentual).toFixed(2);
    const key = `${r.regional_id}:${pct}`;
    const existente = rateioPadraoPorEmpresa.get(r.empresa_id) ?? "";
    rateioPadraoPorEmpresa.set(
      r.empresa_id,
      existente ? `${existente}|${key}` : key,
    );
  }
  // Ordena os pares pra ter comparação estável.
  for (const [emp, raw] of rateioPadraoPorEmpresa) {
    const ordenado = raw.split("|").sort().join("|");
    rateioPadraoPorEmpresa.set(emp, ordenado);
  }

  function computaAlocacoesDisplay(
    alocs: { empresa_id: string; regional_id: string; percentual: string; empresa_nome: string; regional_nome: string }[],
  ) {
    // Agrupa por empresa; pra cada empresa, decide "Hub" (bate com padrão) ou lista individual.
    const porEmpresa = new Map<string, typeof alocs>();
    for (const a of alocs) {
      const lista = porEmpresa.get(a.empresa_id) ?? [];
      lista.push(a);
      porEmpresa.set(a.empresa_id, lista);
    }
    const display: Array<
      | { tipo: "hub"; empresa_nome: string }
      | { tipo: "regional"; empresa_nome: string; regional_nome: string; percentual: string }
    > = [];
    for (const [empresaId, lista] of porEmpresa) {
      const chaveLinha = lista
        .map((a) => `${a.regional_id}:${Number(a.percentual).toFixed(2)}`)
        .sort()
        .join("|");
      const padrao = rateioPadraoPorEmpresa.get(empresaId);
      if (padrao && padrao === chaveLinha) {
        display.push({ tipo: "hub", empresa_nome: lista[0].empresa_nome });
      } else {
        for (const a of lista) {
          display.push({
            tipo: "regional",
            empresa_nome: a.empresa_nome,
            regional_nome: a.regional_nome,
            percentual: a.percentual,
          });
        }
      }
    }
    return display;
  }

  const linhas: FolhaLinha[] = folhasRaw.map((l) => {
    const c = colaboradorPorId.get(l.colaborador_id);
    const alocs = alocacoesPorFolha.get(l.id) ?? [];
    return {
      id: l.id,
      salario_base: String(l.salario_base),
      desconto_beneficios: String(l.desconto_beneficios ?? "0"),
      status: l.status,
      origem: l.origem,
      motivo_pendencia: l.motivo_pendencia,
      colaborador: {
        id: c?.id ?? "",
        nome: c?.nome ?? "—",
        cpf: c?.cpf ?? null,
        funcao: c?.funcao ?? "—",
        tipo_contratacao: (c?.tipo_contratacao ?? "clt") as any,
        nivel_codigo: c?.nivel_codigo ?? null,
      },
      alocacoes: alocs,
      alocacoes_display: computaAlocacoesDisplay(alocs),
      tem_nf: colabsComNf.has(l.colaborador_id),
    };
  });

  const empresas = (empresasRes.data ?? []) as Pick<Empresa, "id" | "nome_fantasia">[];
  const regionais = (regionaisRes.data ?? []) as {
    id: string;
    nome: string;
    empresa_id: string;
  }[];

  const podeEditar = pode(session.activeRole, "rh.folhas.editar_rh");

  const totalGeral = linhas.reduce((acc, l) => acc + Number(l.salario_base), 0);
  const contagem: ContagemStatus = {
    rascunho: 0,
    enviada: 0,
    aprovada: 0,
    pendente_correcao: 0,
    paga: 0,
  };
  for (const l of linhas) contagem[l.status] += 1;

  const linhasPrev = (linhasPrevRes.data ?? []) as {
    salario_base: string | number;
  }[];
  const totalPrev = linhasPrev.reduce(
    (acc, l) => acc + Number(l.salario_base),
    0,
  );
  const colaboradoresPrev = linhasPrev.length;

  const nomeCompetencia = `${NOMES_MES[mes - 1]}/${ano}`;
  const nomeCompetenciaAnterior = `${NOMES_MES[prev.mes - 1].slice(0, 3)}/${prev.ano}`;

  const descricao = descreverEstadoFolha(linhas.length, contagem);

  // Totais por origem para o checklist PJ / CLT.
  const linhasPj = folhasRaw.filter((l) => l.origem === "california");
  const linhasClt = folhasRaw.filter((l) => l.origem === "contabilidade");
  const rascunhosAEnviar = folhasRaw.filter((l) => l.status === "rascunho").length;

  // Fase 3: estado do checkpoint "Benefícios aplicados"
  const fechamentoVigente = await obterFechamentoVigenteDaCompetencia({
    tenantId: session.activeTenant.id,
    ano,
    mes,
  });
  const avulsaPaga = fechamentoVigente
    ? await temAvulsaPaga({ fechamentoId: fechamentoVigente.id })
    : false;
  const beneficiosProp = {
    aplicado: Boolean(fechamentoVigente),
    fechamentoId: fechamentoVigente?.id ?? null,
    qtdVinculos: fechamentoVigente?.qtd_vinculos ?? 0,
    totalEmpresa: fechamentoVigente?.total_empresa ?? 0,
    totalColaborador: fechamentoVigente?.total_colaborador ?? 0,
    totalIntegral: fechamentoVigente?.valor_integral ?? 0,
    avulsaPaga,
  };

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/rh/folhas" />

      <PageHeader
        eyebrow={`RH · FOLHA MENSAL`}
        title={nomeCompetencia}
        description={descricao}
        icon={Receipt}
      />

      <ChecklistCompetencia
        ano={ano}
        mes={mes}
        pj={{
          linhas: linhasPj.length,
          total: linhasPj.reduce((a, l) => a + Number(l.salario_base), 0),
        }}
        clt={{
          linhas: linhasClt.length,
          total: linhasClt.reduce((a, l) => a + Number(l.salario_base), 0),
        }}
        beneficios={beneficiosProp}
        rascunhosAEnviar={rascunhosAEnviar}
        podeEditar={podeEditar}
      />

      {linhas.length > 0 && (
        <CardsResumoFolha
          totalAtual={totalGeral}
          totalAnterior={totalPrev}
          colaboradoresAtual={linhas.length}
          colaboradoresAnterior={colaboradoresPrev}
          contagem={contagem}
          nomeCompetenciaAnterior={nomeCompetenciaAnterior}
          temMesAnterior={linhasPrev.length > 0}
        />
      )}

      <FolhaCompetenciaView
        linhas={linhas}
        empresas={empresas}
        regionais={regionais}
        contagem={contagem}
        podeEditar={podeEditar}
      />
    </div>
  );
}

function descreverEstadoFolha(
  total: number,
  contagem: ContagemStatus,
): string {
  if (total === 0) {
    return "Competência aberta. Gere o PJ e importe o CLT da contabilidade para começar.";
  }
  if (contagem.pendente_correcao > 0) {
    return `${total} colaboradores · ${contagem.pendente_correcao} linha${contagem.pendente_correcao === 1 ? "" : "s"} com pendência a corrigir antes de reenviar ao financeiro.`;
  }
  if (contagem.paga === total) {
    return `${total} colaboradores · folha inteira paga.`;
  }
  if (contagem.rascunho === total) {
    return `${total} colaboradores · em rascunho, aguardando envio ao financeiro.`;
  }
  return `${total} colaboradores · fluxo em andamento com o financeiro.`;
}
