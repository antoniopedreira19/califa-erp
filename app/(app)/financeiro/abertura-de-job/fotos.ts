/**
 * As fotos da abertura — gravar uma e listar todas (decisão 059).
 *
 * Módulo comum, sem `"use server"`: quem grava é a Server Action da
 * abertura e a da edição/revisão (`actions.ts`), e quem lê é a página do
 * job no financeiro. Em arquivo `"use server"` toda export viraria Server
 * Action, e a leitura não é uma.
 *
 * A foto é imutável por desenho — a tabela não tem policy nem grant de
 * UPDATE/DELETE. Errou, registra outra.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FotoDaAbertura,
  JobCompetencia,
  LinhaPrevisaoFoto,
  TipoFotoAbertura,
} from "@/lib/types";
import { ordenarCompetencias } from "@/lib/types";
import { formatDataHoraBr } from "./formatos";

export interface RegistrarFotoArgs {
  tenantId: string;
  jobId: string;
  tipo: TipoFotoAbertura;
  errataId: string | null;
  profileId: string;
  registro: {
    nome_financeiro: string;
    projeto_financeiro_id: string | null;
    conta_recebimento_id: string | null;
    conta_pagamento_id: string | null;
    categoria_id: string | null;
    servico_id: string | null;
    competencias: JobCompetencia[];
    curva: LinhaPrevisaoFoto[];
    recebimento: LinhaPrevisaoFoto[];
    valorJob: number | null;
    faturamentoPrevisto: number | null;
    custoPrevisto: number | null;
  };
}

/**
 * Grava a foto seguinte do job. O número é o próximo livre — lido na
 * hora, e o `unique (job_id, numero)` recusa a corrida de duas gravações
 * simultâneas em vez de deixar duas fotos com o mesmo número.
 *
 * Devolve a mensagem do erro, ou null. Quem chama decide o que fazer:
 * a abertura já aconteceu quando a foto falha, e o registro principal
 * não pode ser desfeito por causa dela.
 */
export async function registrarFotoDaAbertura(
  supabase: SupabaseClient,
  args: RegistrarFotoArgs,
): Promise<string | null> {
  const { data: ultima } = await supabase
    .from("jobs_aberturas")
    .select("numero")
    .eq("tenant_id", args.tenantId)
    .eq("job_id", args.jobId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle<{ numero: number }>();

  const numero = (ultima?.numero ?? 0) + 1;
  const r = args.registro;

  const { error } = await supabase.from("jobs_aberturas").insert({
    tenant_id: args.tenantId,
    job_id: args.jobId,
    numero,
    tipo: args.tipo,
    errata_id: args.errataId,
    registrado_por: args.profileId,
    nome_financeiro: r.nome_financeiro,
    projeto_financeiro_id: r.projeto_financeiro_id,
    conta_recebimento_id: r.conta_recebimento_id,
    conta_pagamento_id: r.conta_pagamento_id,
    categoria_id: r.categoria_id,
    servico_id: r.servico_id,
    competencias: ordenarCompetencias(r.competencias),
    curva: r.curva,
    recebimento: r.recebimento,
    valor_job: r.valorJob,
    faturamento_previsto: r.faturamentoPrevisto,
    custo_previsto: r.custoPrevisto,
  });

  if (error) {
    console.error("[abertura-job.foto]", error.message);
    return error.message;
  }
  return null;
}

/** "Itaú · c/c 56789-0" — o mesmo rótulo do seletor de contas. */
function rotuloDaConta(c: {
  nome: string | null;
  banco: string | null;
  numero_conta: string | null;
  tipo: string | null;
}): string {
  const tipo =
    c.tipo === "corrente"
      ? "c/c"
      : c.tipo === "poupanca"
        ? "c/p"
        : c.tipo === "investimento"
          ? "c/inv"
          : "";
  const conta = c.numero_conta ? `${tipo} ${c.numero_conta}`.trim() : null;
  return [c.banco, conta].filter(Boolean).join(" · ") || (c.nome ?? "—");
}

/**
 * Todas as fotos do job, da abertura à última revisão, com os nomes
 * resolvidos. Os ids são resolvidos AGORA, e não guardados na foto: se a
 * conta foi renomeada, a foto mostra o nome atual — o que importa dela é
 * qual conta era, não como se escrevia.
 */
export async function fotosDaAbertura(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<FotoDaAbertura[]> {
  const { data, error } = await supabase
    .from("jobs_aberturas")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .order("numero", { ascending: true });

  if (error) {
    console.error("[abertura-job.fotos]", error.message);
    return [];
  }
  const linhas = (data ?? []) as any[];
  if (linhas.length === 0) return [];

  const ids = (campo: string) =>
    Array.from(
      new Set(linhas.map((l) => l[campo] as string | null).filter(Boolean)),
    ) as string[];

  const projetoIds = ids("projeto_financeiro_id");
  const contaIds = Array.from(
    new Set([...ids("conta_recebimento_id"), ...ids("conta_pagamento_id")]),
  );
  const dominioIds = Array.from(
    new Set([...ids("categoria_id"), ...ids("servico_id")]),
  );
  const perfilIds = ids("registrado_por");
  const errataIds = ids("errata_id");

  const vazio = Promise.resolve({ data: [] as any[], error: null });
  const [projetosRes, contasRes, dominioRes, perfisRes, erratasRes] =
    await Promise.all([
      projetoIds.length
        ? supabase
            .from("projetos_financeiro")
            .select("id, codigo, nome")
            .in("id", projetoIds)
        : vazio,
      contaIds.length
        ? supabase
            .from("contas_bancarias")
            .select("id, nome, banco, numero_conta, tipo")
            .in("id", contaIds)
        : vazio,
      dominioIds.length
        ? supabase
            .from("categorias_dominio")
            .select("id, nome")
            .in("id", dominioIds)
        : vazio,
      perfilIds.length
        ? supabase.from("profiles").select("id, nome").in("id", perfilIds)
        : vazio,
      errataIds.length
        ? supabase.from("jobs_erratas").select("id, titulo").in("id", errataIds)
        : vazio,
    ]);

  const projetos = new Map(
    ((projetosRes.data ?? []) as any[]).map((p) => [
      p.id as string,
      `${p.codigo} · ${p.nome}`,
    ]),
  );
  const contas = new Map(
    ((contasRes.data ?? []) as any[]).map((c) => [
      c.id as string,
      rotuloDaConta(c),
    ]),
  );
  const dominio = new Map(
    ((dominioRes.data ?? []) as any[]).map((d) => [d.id as string, d.nome as string]),
  );
  const perfis = new Map(
    ((perfisRes.data ?? []) as any[]).map((p) => [p.id as string, p.nome as string]),
  );
  const erratas = new Map(
    ((erratasRes.data ?? []) as any[]).map((e) => [e.id as string, e.titulo as string]),
  );

  const previsao = (v: unknown): LinhaPrevisaoFoto[] =>
    Array.isArray(v)
      ? v.map((l: any) => ({
          data_prevista: String(l.data_prevista ?? "").slice(0, 10),
          valor: Number(l.valor ?? 0),
        }))
      : [];

  return linhas.map((l) => ({
    id: l.id as string,
    numero: Number(l.numero),
    tipo: l.tipo as TipoFotoAbertura,
    reconstituida: l.reconstituida === true,
    registradoEm: l.registrado_em as string,
    registradoEmLabel: formatDataHoraBr(l.registrado_em as string),
    registradoPorNome: l.registrado_por
      ? (perfis.get(l.registrado_por) ?? null)
      : null,
    errata: l.errata_id
      ? { id: l.errata_id as string, titulo: erratas.get(l.errata_id) ?? "" }
      : null,
    nomeFinanceiro: (l.nome_financeiro as string | null) ?? null,
    projetoLabel: l.projeto_financeiro_id
      ? (projetos.get(l.projeto_financeiro_id) ?? null)
      : null,
    contaRecebimentoLabel: l.conta_recebimento_id
      ? (contas.get(l.conta_recebimento_id) ?? null)
      : null,
    contaPagamentoLabel: l.conta_pagamento_id
      ? (contas.get(l.conta_pagamento_id) ?? null)
      : null,
    categoriaNome: l.categoria_id ? (dominio.get(l.categoria_id) ?? null) : null,
    servicoNome: l.servico_id ? (dominio.get(l.servico_id) ?? null) : null,
    competencias: Array.isArray(l.competencias)
      ? ordenarCompetencias(
          (l.competencias as any[]).map((c) => ({
            trimestre: Number(c.trimestre),
            ano: Number(c.ano),
            percentual: Number(c.percentual ?? 0),
          })),
        )
      : [],
    curva: previsao(l.curva),
    recebimento: previsao(l.recebimento),
    valorJob: l.valor_job === null ? null : Number(l.valor_job),
    faturamentoPrevisto:
      l.faturamento_previsto === null ? null : Number(l.faturamento_previsto),
    custoPrevisto: l.custo_previsto === null ? null : Number(l.custo_previsto),
  }));
}
