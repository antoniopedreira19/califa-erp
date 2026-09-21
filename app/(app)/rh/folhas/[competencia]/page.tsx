import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
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
  const [linhasRes, empresasRes, regionaisRes, linhasPrevRes] = await Promise.all(
    [
      supabase
        .from("folhas_pagamento")
        .select(
          "id, salario_base, status, motivo_pendencia, colaborador_id",
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
    ],
  );

  if (linhasRes.error) {
    console.error("[folha.competencia.linhas]", linhasRes.error.message);
  }

  const folhasRaw = (linhasRes.data ?? []) as {
    id: string;
    salario_base: string | number;
    status: FolhaLinhaStatus;
    motivo_pendencia: string | null;
    colaborador_id: string;
  }[];

  const folhaIds = folhasRaw.map((f) => f.id);
  const colaboradorIds = Array.from(
    new Set(folhasRaw.map((f) => f.colaborador_id)),
  );

  // Passo 2: colaboradores + alocacoes em paralelo.
  const [colaboradoresRes, alocacoesRes] = await Promise.all([
    colaboradorIds.length > 0
      ? supabase
          .from("colaboradores")
          .select(
            "id, nome, funcao, tipo_contratacao, nivel:niveis(codigo)",
          )
          .in("id", colaboradorIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    folhaIds.length > 0
      ? supabase
          .from("folhas_pagamento_alocacoes")
          .select("id, folha_id, empresa_id, regional_id, percentual")
          .in("folha_id", folhaIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);

  const colaboradorPorId = new Map<
    string,
    {
      id: string;
      nome: string;
      funcao: string;
      tipo_contratacao: string;
      nivel_codigo: string | null;
    }
  >();
  for (const c of ((colaboradoresRes.data ?? []) as any[])) {
    colaboradorPorId.set(c.id, {
      id: c.id,
      nome: c.nome,
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

  const linhas: FolhaLinha[] = folhasRaw.map((l) => {
    const c = colaboradorPorId.get(l.colaborador_id);
    return {
      id: l.id,
      salario_base: String(l.salario_base),
      status: l.status,
      motivo_pendencia: l.motivo_pendencia,
      colaborador: {
        id: c?.id ?? "",
        nome: c?.nome ?? "—",
        funcao: c?.funcao ?? "—",
        tipo_contratacao: (c?.tipo_contratacao ?? "clt") as any,
        nivel_codigo: c?.nivel_codigo ?? null,
      },
      alocacoes: alocacoesPorFolha.get(l.id) ?? [],
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

  return (
    <div className="space-y-6">
      <Link
        href="/rh/folhas"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar para folhas
      </Link>

      <PageHeader
        eyebrow={`RH · FOLHA MENSAL`}
        title={nomeCompetencia}
        description={descricao}
        icon={Receipt}
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
  if (total === 0) return "Nenhuma linha nesta competência.";
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
