/** Leitura do SAVE — o crédito que passa de um job para outro.
 *
 *  Regra em `docs/decisions/023-save-entre-jobs.md`, com a nota de
 *  26/08/2026: o saldo é do JOB, não da linha. As linhas que geraram o
 *  saldo continuam sendo o detalhe (o pop-up mostra quais são), mas quem
 *  tem saldo é o job, e uma linha consumidora pode beber de vários.
 *
 *  Tudo aqui lê `vw_saves_por_job` e `vw_saves_linhas`, que já nascem com
 *  `security_invoker` — a RLS das tabelas de baixo vale normalmente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PontaDeSave, EstadoSaveDaLinha } from "@/app/(app)/_planilha/save-coluna";

/** Um job com saldo de save a oferecer. */
export interface SaldoDeSave {
  jobId: string;
  codigo: string;
  nome: string;
  /** Total gerado pelas linhas em save do job. */
  gerado: number;
  /** Já consumido por consumos firmes. */
  consumido: number;
  /** Segurado por rascunhos ainda não aprovados. Informativo: rascunho não
   *  segura saldo (decisão 023, nota de 26/08/2026). */
  reservado: number;
  /** gerado − consumido. É o que cabe consumir. */
  disponivel: number;
  /** As taxas da ORIGEM: quem calcula a receita que migra é o TypeScript,
   *  com a mesma `REGRAS_TIPO_CUSTO`. */
  percentualHonorarios: number;
  percentualImposto: number;
  /** As linhas que formaram o saldo — o detalhe do pop-up. */
  linhas: { descricao: string; tipoCusto: string; valor: number }[];
}

/**
 * Saldos de save disponíveis para um CLIENTE.
 *
 * O crédito é do cliente e vale mesmo em outro projeto (decisão 023 §8),
 * então o filtro é por cliente, não por projeto. `excluirJobId` tira o
 * próprio job da lista: ninguém consome o próprio saldo.
 */
export async function saldosDeSaveDoCliente(
  supabase: SupabaseClient,
  tenantId: string,
  clienteId: string,
  excluirJobId?: string | null,
): Promise<SaldoDeSave[]> {
  const [saldosRes, linhasRes] = await Promise.all([
    supabase
      .from("vw_saves_por_job")
      .select(
        "job_id, job_codigo, job_nome, saldo_gerado, consumido, reservado, disponivel, percentual_honorarios, percentual_imposto",
      )
      .eq("tenant_id", tenantId)
      .eq("cliente_id", clienteId)
      .order("job_codigo"),
    supabase
      .from("vw_saves_linhas")
      .select("job_id, descricao, tipo_custo, valor")
      .eq("tenant_id", tenantId),
  ]);

  if (saldosRes.error) {
    console.error("[saves.saldos]", saldosRes.error.message);
    return [];
  }

  const linhasPorJob = new Map<
    string,
    { descricao: string; tipoCusto: string; valor: number }[]
  >();
  for (const l of (linhasRes.data ?? []) as any[]) {
    const lista = linhasPorJob.get(l.job_id) ?? [];
    lista.push({
      descricao: l.descricao,
      tipoCusto: l.tipo_custo,
      valor: Number(l.valor ?? 0),
    });
    linhasPorJob.set(l.job_id, lista);
  }

  return ((saldosRes.data ?? []) as any[])
    .filter((s) => s.job_id !== excluirJobId)
    .map((s) => ({
      jobId: s.job_id,
      codigo: s.job_codigo,
      nome: s.job_nome,
      gerado: Number(s.saldo_gerado ?? 0),
      consumido: Number(s.consumido ?? 0),
      reservado: Number(s.reservado ?? 0),
      disponivel: Number(s.disponivel ?? 0),
      percentualHonorarios: Number(s.percentual_honorarios ?? 0),
      percentualImposto: Number(s.percentual_imposto ?? 0),
      linhas: linhasPorJob.get(s.job_id) ?? [],
    }));
}

/**
 * Estado do save de cada linha de UMA versão do orçamento, na forma que a
 * coluna consome.
 *
 * As duas pontas vêm de lugares diferentes:
 *
 *  - **origens** (esta linha é paga por fora) saem de `saves_consumos`
 *    apontando para o item da versão;
 *  - **destinos** (o crédito desta linha já foi gasto) só existem depois
 *    de a versão virar job: quem tem saldo é o job, então o caminho é
 *    item da versão → cópia no job → consumos daquele job de origem.
 */
export async function saveDaVersao(
  supabase: SupabaseClient,
  tenantId: string,
  versaoId: string,
  itens: { id: string; em_save: boolean; save_consumido: number }[],
): Promise<Record<string, EstadoSaveDaLinha>> {
  const ids = itens.map((i) => i.id);
  if (ids.length === 0) return {};

  const [consumosRes, copiaRes] = await Promise.all([
    // O que ESTAS linhas consomem de fora.
    supabase
      .from("saves_consumos")
      .select("item_versao_id, valor, job_origem_id, jobs!inner(id, codigo)")
      .eq("tenant_id", tenantId)
      .in("item_versao_id", ids)
      .is("substituido_em", null),
    // A cópia destas linhas no job, para achar o job de origem do crédito.
    supabase
      .from("jobs_itens_orcado")
      .select("item_versao_id, job_id")
      .eq("tenant_id", tenantId)
      .in("item_versao_id", ids)
      .eq("em_save", true),
  ]);

  const origensPorItem = new Map<string, PontaDeSave[]>();
  for (const c of (consumosRes.data ?? []) as any[]) {
    const lista = origensPorItem.get(c.item_versao_id) ?? [];
    lista.push({
      jobId: c.job_origem_id,
      codigo: c.jobs?.codigo ?? "—",
      valor: Number(c.valor ?? 0),
    });
    origensPorItem.set(c.item_versao_id, lista);
  }

  // Para as linhas em save que já viraram job: quem consumiu o SALDO
  // daquele job.
  //
  // Atenção ao que este número significa. Desde a nota de 26/08/2026 na
  // decisão 023 o saldo é do JOB, não da linha — não existe vínculo entre
  // "a Trilha sonora gerou R$ 6.000" e "o JB-0044 gastou R$ 6.000". O que
  // a coluna mostra na linha em save é o destino do saldo DO JOB a que ela
  // pertence, e é assim que o tooltip fala. Atribuir consumo a uma linha
  // específica seria inventar um vínculo que a operação não tem.
  const jobPorItem = new Map<string, string>();
  for (const o of (copiaRes.data ?? []) as any[]) {
    jobPorItem.set(o.item_versao_id, o.job_id);
  }

  const destinosPorJob = new Map<string, PontaDeSave[]>();
  const jobsOrigem = [...new Set(jobPorItem.values())];
  if (jobsOrigem.length > 0) {
    const { data: consumos } = await supabase
      .from("saves_consumos")
      .select("job_origem_id, valor, job_item_orcado_id, item_versao_id")
      .eq("tenant_id", tenantId)
      .in("job_origem_id", jobsOrigem);

    const linhas = (consumos ?? []) as any[];
    // Resolve o job CONSUMIDOR de cada consumo: pela cópia do job quando
    // ele já foi copiado, e pelo orçamento da versão enquanto não foi.
    const idsCopia = linhas.map((c) => c.job_item_orcado_id).filter(Boolean);
    const idsVersao = linhas.map((c) => c.item_versao_id).filter(Boolean);

    const [porCopia, porVersao] = await Promise.all([
      idsCopia.length
        ? supabase
            .from("jobs_itens_orcado")
            .select("id, job_id, jobs!inner(codigo)")
            .in("id", idsCopia)
        : Promise.resolve({ data: [] as any[] }),
      idsVersao.length
        ? supabase
            .from("versoes_orcamento_itens")
            .select(
              "id, versoes_orcamento!inner(orcamentos!inner(jobs(id, codigo)))",
            )
            .in("id", idsVersao)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const consumidor = new Map<string, { id: string; codigo: string }>();
    for (const r of ((porCopia as any).data ?? []) as any[]) {
      consumidor.set(r.id, { id: r.job_id, codigo: r.jobs?.codigo ?? "—" });
    }
    for (const r of ((porVersao as any).data ?? []) as any[]) {
      const job = r.versoes_orcamento?.orcamentos?.jobs?.[0];
      if (job) consumidor.set(r.id, { id: job.id, codigo: job.codigo });
    }

    for (const c of linhas) {
      const chave = c.job_item_orcado_id ?? c.item_versao_id;
      const alvo = consumidor.get(chave);
      if (!alvo) continue;
      const lista = destinosPorJob.get(c.job_origem_id) ?? [];
      const ja = lista.find((p) => p.jobId === alvo.id);
      if (ja) ja.valor += Number(c.valor ?? 0);
      else
        lista.push({
          jobId: alvo.id,
          codigo: alvo.codigo,
          valor: Number(c.valor ?? 0),
        });
      destinosPorJob.set(c.job_origem_id, lista);
    }
  }

  const destinosPorItem = new Map<string, PontaDeSave[]>();
  for (const [itemId, jobId] of jobPorItem) {
    const d = destinosPorJob.get(jobId);
    if (d && d.length > 0) destinosPorItem.set(itemId, d);
  }

  const saida: Record<string, EstadoSaveDaLinha> = {};
  for (const it of itens) {
    const origens = origensPorItem.get(it.id) ?? [];
    const destinos = destinosPorItem.get(it.id) ?? [];
    if (!it.em_save && origens.length === 0) continue;
    saida[it.id] = {
      emSave: it.em_save,
      saveConsumido: Number(it.save_consumido ?? 0),
      origens,
      destinos,
    };
  }
  return saida;
}
