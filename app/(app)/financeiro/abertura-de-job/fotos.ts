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
    conta_impostos_id: string | null;
    categoria_id: string | null;
    servico_id: string | null;
    competencias: JobCompetencia[];
    curva: LinhaPrevisaoFoto[];
    recebimento: LinhaPrevisaoFoto[];
    /** Cronograma de recolhimento de impostos (decisão 100). */
    impostos: LinhaPrevisaoFoto[];
    valorJob: number | null;
    faturamentoPrevisto: number | null;
    custoPrevisto: number | null;
    impostoPrevisto: number | null;
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
    conta_impostos_id: r.conta_impostos_id,
    categoria_id: r.categoria_id,
    servico_id: r.servico_id,
    competencias: ordenarCompetencias(r.competencias),
    curva: r.curva,
    recebimento: r.recebimento,
    impostos: r.impostos,
    valor_job: r.valorJob,
    faturamento_previsto: r.faturamentoPrevisto,
    custo_previsto: r.custoPrevisto,
    imposto_previsto: r.impostoPrevisto,
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
    new Set([
      ...ids("conta_recebimento_id"),
      ...ids("conta_pagamento_id"),
      ...ids("conta_impostos_id"),
    ]),
  );
  const dominioIds = Array.from(
    new Set([...ids("categoria_id"), ...ids("servico_id")]),
  );
  const perfilIds = ids("registrado_por");
  const temRevisao = linhas.some((l) => l.tipo === "revisao_errata");

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
      // Todas as erratas do job: cada revisão mostra as que aconteceram
      // entre a foto anterior e ela — não só a última, que é a única
      // que a coluna `errata_id` guarda.
      temRevisao
        ? supabase
            .from("jobs_erratas")
            .select("id, titulo, created_at")
            .eq("tenant_id", tenantId)
            .eq("job_id", jobId)
            .order("created_at", { ascending: true })
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
  const erratasDoJob = ((erratasRes.data ?? []) as any[]).map((e) => ({
    id: e.id as string,
    titulo: e.titulo as string,
    em: new Date(e.created_at as string).getTime(),
  }));
  /** As erratas que a foto `i` tratou: depois da foto anterior e até ela.
   *  Sem nenhuma na janela (dado anterior a esta regra), cai na única que
   *  a coluna guardou. */
  const erratasDaFoto = (i: number): { id: string; titulo: string }[] => {
    const l = linhas[i];
    if (l.tipo !== "revisao_errata") return [];
    const ate = new Date(l.registrado_em as string).getTime();
    const desde =
      i > 0 ? new Date(linhas[i - 1].registrado_em as string).getTime() : -Infinity;
    const naJanela = erratasDoJob
      .filter((e) => e.em > desde && e.em <= ate)
      .map(({ id, titulo }) => ({ id, titulo }));
    if (naJanela.length > 0) return naJanela;
    const guardada = erratasDoJob.find((e) => e.id === l.errata_id);
    return guardada ? [{ id: guardada.id, titulo: guardada.titulo }] : [];
  };

  const previsao = (v: unknown): LinhaPrevisaoFoto[] =>
    Array.isArray(v)
      ? v.map((l: any) => ({
          data_prevista: String(l.data_prevista ?? "").slice(0, 10),
          valor: Number(l.valor ?? 0),
        }))
      : [];

  return linhas.map((l, i) => ({
    id: l.id as string,
    numero: Number(l.numero),
    tipo: l.tipo as TipoFotoAbertura,
    reconstituida: l.reconstituida === true,
    registradoEm: l.registrado_em as string,
    registradoEmLabel: formatDataHoraBr(l.registrado_em as string),
    registradoPorNome: l.registrado_por
      ? (perfis.get(l.registrado_por) ?? null)
      : null,
    erratas: erratasDaFoto(i),
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
    contaImpostosLabel: l.conta_impostos_id
      ? (contas.get(l.conta_impostos_id) ?? null)
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
    // Nulo = foto anterior à previsão de impostos (decisão 100, 23/09/2026).
    impostos: l.impostos === null ? null : previsao(l.impostos),
    valorJob: l.valor_job === null ? null : Number(l.valor_job),
    faturamentoPrevisto:
      l.faturamento_previsto === null ? null : Number(l.faturamento_previsto),
    custoPrevisto: l.custo_previsto === null ? null : Number(l.custo_previsto),
    impostoPrevisto:
      l.imposto_previsto === null || l.imposto_previsto === undefined
        ? null
        : Number(l.imposto_previsto),
  }));
}
