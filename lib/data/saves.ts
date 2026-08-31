/** Leitura do SAVE — o crédito que passa de um job para outro.
 *
 *  Regra em `docs/decisions/028-save-entre-jobs.md`, com a nota de
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
   *  segura saldo (decisão 028, nota de 26/08/2026). */
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
 * O crédito é do cliente e vale mesmo em outro projeto (decisão 028 §8),
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
 *    apontando para o item da versão enquanto o orçamento é rascunho, e
 *    para a cópia do job depois da abertura — o consumo muda de ponta lá;
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
    // A cópia destas linhas no job. Serve para duas coisas: achar o job de
    // origem do crédito (destinos) e reencontrar os consumos que MUDARAM
    // DE PONTA na abertura (origens) — ver abaixo.
    supabase
      .from("jobs_itens_orcado")
      .select("id, item_versao_id, job_id, em_save")
      .eq("tenant_id", tenantId)
      .in("item_versao_id", ids),
  ]);

  const copias = (copiaRes.data ?? []) as any[];

  const origensPorItem = new Map<string, PontaDeSave[]>();
  const empilhaOrigem = (itemVersaoId: string, c: any) => {
    const lista = origensPorItem.get(itemVersaoId) ?? [];
    lista.push({
      jobId: c.job_origem_id,
      codigo: c.jobs?.codigo ?? "—",
      valor: Number(c.valor ?? 0),
    });
    origensPorItem.set(itemVersaoId, lista);
  };

  for (const c of (consumosRes.data ?? []) as any[]) {
    empilhaOrigem(c.item_versao_id, c);
  }

  // Depois da abertura o consumo deixa de apontar para a linha da versão e
  // passa a apontar para a cópia do job (`chk_save_consumo_uma_ponta` só
  // admite uma ponta). A versão aprovada continua tendo que mostrar de
  // onde veio o crédito, então o caminho aqui é o mesmo dos destinos:
  // item da versão → cópia no job → consumos daquela cópia.
  const copiaPorItemVersao = new Map<string, string>();
  for (const o of copias) copiaPorItemVersao.set(o.item_versao_id, o.id);
  const idsCopiaConsumidora = [...copiaPorItemVersao.values()];
  if (idsCopiaConsumidora.length > 0) {
    const { data: consumosDaCopia } = await supabase
      .from("saves_consumos")
      .select("job_item_orcado_id, valor, job_origem_id, jobs!inner(codigo)")
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", idsCopiaConsumidora);

    const versaoPorCopia = new Map<string, string>();
    for (const [itemVersaoId, copiaId] of copiaPorItemVersao) {
      versaoPorCopia.set(copiaId, itemVersaoId);
    }
    for (const c of (consumosDaCopia ?? []) as any[]) {
      const itemVersaoId = versaoPorCopia.get(c.job_item_orcado_id);
      if (itemVersaoId) empilhaOrigem(itemVersaoId, c);
    }
  }

  // Para as linhas em save que já viraram job: quem consumiu o SALDO
  // daquele job.
  //
  // Atenção ao que este número significa. Desde a nota de 26/08/2026 na
  // decisão 028 o saldo é do JOB, não da linha — não existe vínculo entre
  // "a Trilha sonora gerou R$ 6.000" e "o JB-0044 gastou R$ 6.000". O que
  // a coluna mostra na linha em save é o destino do saldo DO JOB a que ela
  // pertence, e é assim que o tooltip fala. Atribuir consumo a uma linha
  // específica seria inventar um vínculo que a operação não tem.
  const jobPorItem = new Map<string, string>();
  for (const o of copias) {
    if (o.em_save === true) jobPorItem.set(o.item_versao_id, o.job_id);
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

/**
 * Estado do save de cada linha de UM job, chaveado pelo id do item da
 * VERSÃO — que é a chave que a Planilha Interna usa em toda a tela.
 *
 * Aqui as duas pontas são mais simples que no orçamento: o job existe, o
 * saldo dele existe, e os consumos apontam direto para a cópia do job.
 */
export async function saveDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  itens: {
    id: string;
    orcado_id: string;
    em_save: boolean;
    save_consumido: number;
  }[],
): Promise<Record<string, EstadoSaveDaLinha>> {
  const orcadoIds = itens.map((i) => i.orcado_id).filter(Boolean);
  if (orcadoIds.length === 0) return {};

  const [origensRes, destinosRes] = await Promise.all([
    // De onde vem o dinheiro que paga estas linhas.
    supabase
      .from("saves_consumos")
      .select("job_item_orcado_id, valor, job_origem_id, jobs!inner(codigo)")
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", orcadoIds),
    // Quem consumiu o saldo DESTE job. O saldo é do job, então o destino
    // vale para todas as linhas em save dele (decisão 028, nota de 26/08).
    supabase
      .from("saves_consumos")
      .select("valor, job_item_orcado_id, item_versao_id")
      .eq("tenant_id", tenantId)
      .eq("job_origem_id", jobId),
  ]);

  const origensPorOrcado = new Map<string, PontaDeSave[]>();
  for (const c of (origensRes.data ?? []) as any[]) {
    const lista = origensPorOrcado.get(c.job_item_orcado_id) ?? [];
    lista.push({
      jobId: c.job_origem_id,
      codigo: (c.jobs as any)?.codigo ?? "—",
      valor: Number(c.valor ?? 0),
    });
    origensPorOrcado.set(c.job_item_orcado_id, lista);
  }

  // Resolve o job consumidor de cada consumo para nomear o destino.
  const destinos: PontaDeSave[] = [];
  const linhas = (destinosRes.data ?? []) as any[];
  if (linhas.length > 0) {
    const idsCopia = linhas.map((c) => c.job_item_orcado_id).filter(Boolean);
    const { data: copias } = idsCopia.length
      ? await supabase
          .from("jobs_itens_orcado")
          .select("id, job_id, jobs!inner(codigo)")
          .in("id", idsCopia)
      : { data: [] as any[] };

    const porId = new Map(
      ((copias ?? []) as any[]).map((r) => [
        r.id,
        { jobId: r.job_id as string, codigo: (r.jobs as any)?.codigo ?? "—" },
      ]),
    );
    for (const c of linhas) {
      const alvo = porId.get(c.job_item_orcado_id);
      if (!alvo) continue;
      const ja = destinos.find((d) => d.jobId === alvo.jobId);
      if (ja) ja.valor += Number(c.valor ?? 0);
      else destinos.push({ ...alvo, valor: Number(c.valor ?? 0) });
    }
  }

  const saida: Record<string, EstadoSaveDaLinha> = {};
  for (const it of itens) {
    const origens = origensPorOrcado.get(it.orcado_id) ?? [];
    if (!it.em_save && origens.length === 0) continue;
    saida[it.id] = {
      emSave: it.em_save,
      saveConsumido: Number(it.save_consumido ?? 0),
      origens,
      destinos: it.em_save ? destinos : [],
    };
  }
  return saida;
}

/**
 * Igual ao `saveDoJob`, mas para VÁRIOS jobs de uma vez — a visão agregada
 * do projeto mostra um bloco por job, e chamar aquele por job custaria
 * três consultas para cada um.
 *
 * São três consultas no total, independente de quantos jobs entrarem: as
 * origens de todas as linhas, os consumos que saíram de qualquer um dos
 * jobs, e a resolução dos jobs que consumiram. `docs/PERFORMANCE.md` é
 * explícito sobre isto — esta tela já custou uma regressão de navegação.
 *
 * O `destinos` continua sendo do JOB, e não da linha (decisão 028, nota de
 * 26/08/2026): todas as linhas em save de um job compartilham a mesma
 * lista de quem gastou aquele saldo.
 */
export async function saveDosJobs(
  supabase: SupabaseClient,
  tenantId: string,
  itens: {
    /** Chave do mapa de saída — o id que a tela usa para a linha. */
    id: string;
    /** Id da cópia no job (`jobs_itens_orcado.id`), por onde
     *  `saves_consumos` aponta. */
    orcado_id: string;
    /** Job dono da linha: o saldo é dele. */
    jobId: string;
    em_save: boolean;
    save_consumido: number;
  }[],
): Promise<Record<string, EstadoSaveDaLinha>> {
  const orcadoIds = itens.map((i) => i.orcado_id).filter(Boolean);
  const jobIds = [...new Set(itens.map((i) => i.jobId).filter(Boolean))];
  if (orcadoIds.length === 0 || jobIds.length === 0) return {};

  const [origensRes, destinosRes] = await Promise.all([
    // De onde vem o dinheiro que paga estas linhas.
    supabase
      .from("saves_consumos")
      .select("job_item_orcado_id, valor, job_origem_id, jobs!inner(codigo)")
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", orcadoIds),
    // Quem consumiu o saldo de QUALQUER um destes jobs.
    supabase
      .from("saves_consumos")
      .select("valor, job_item_orcado_id, job_origem_id")
      .eq("tenant_id", tenantId)
      .in("job_origem_id", jobIds),
  ]);

  const origensPorOrcado = new Map<string, PontaDeSave[]>();
  for (const c of (origensRes.data ?? []) as any[]) {
    const lista = origensPorOrcado.get(c.job_item_orcado_id) ?? [];
    lista.push({
      jobId: c.job_origem_id,
      codigo: (c.jobs as any)?.codigo ?? "—",
      valor: Number(c.valor ?? 0),
    });
    origensPorOrcado.set(c.job_item_orcado_id, lista);
  }

  // Resolve, numa consulta só, o job consumidor de cada consumo.
  const linhas = (destinosRes.data ?? []) as any[];
  const destinosPorJobOrigem = new Map<string, PontaDeSave[]>();
  if (linhas.length > 0) {
    const idsCopia = [
      ...new Set(linhas.map((c) => c.job_item_orcado_id).filter(Boolean)),
    ];
    const { data: copias } = idsCopia.length
      ? await supabase
          .from("jobs_itens_orcado")
          .select("id, job_id, jobs!inner(codigo)")
          .in("id", idsCopia)
      : { data: [] as any[] };

    const porId = new Map(
      ((copias ?? []) as any[]).map((r) => [
        r.id,
        { jobId: r.job_id as string, codigo: (r.jobs as any)?.codigo ?? "—" },
      ]),
    );
    for (const c of linhas) {
      const alvo = porId.get(c.job_item_orcado_id);
      if (!alvo) continue;
      const lista = destinosPorJobOrigem.get(c.job_origem_id) ?? [];
      const ja = lista.find((d) => d.jobId === alvo.jobId);
      if (ja) ja.valor += Number(c.valor ?? 0);
      else lista.push({ ...alvo, valor: Number(c.valor ?? 0) });
      destinosPorJobOrigem.set(c.job_origem_id, lista);
    }
  }

  const saida: Record<string, EstadoSaveDaLinha> = {};
  for (const it of itens) {
    const origens = origensPorOrcado.get(it.orcado_id) ?? [];
    if (!it.em_save && origens.length === 0) continue;
    saida[it.id] = {
      emSave: it.em_save,
      saveConsumido: Number(it.save_consumido ?? 0),
      origens,
      destinos: it.em_save ? (destinosPorJobOrigem.get(it.jobId) ?? []) : [],
    };
  }
  return saida;
}
