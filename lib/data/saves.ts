/** Leitura do SAVE — o crédito que passa de um job para outro.
 *
 *  Regra em `docs/decisions/028-save-entre-jobs.md`, com a nota de
 *  26/08/2026: o saldo é do JOB, não da linha. As linhas que geraram o
 *  saldo continuam sendo o detalhe (o pop-up mostra quais são), mas quem
 *  tem saldo é o job, e uma linha consumidora pode beber de vários.
 *
 *  Tudo aqui lê `vw_saves_por_job` e `vw_saves_linhas`, que já nascem com
 *  `security_invoker` — a RLS das tabelas de baixo vale normalmente.
 *
 *  Desde a decisão 099 (22/09/2026) o saldo é só de save APROVADO pelo
 *  financeiro, e as linhas do job carregam os pedidos de aprovação
 *  (`saves_aprovacoes`), que o pop-up de save mostra.
 *
 *  Desde a decisão 247 (09/11/2026) a origem de um consumo pode ser também
 *  um SAVE AVULSO (`saves_avulsos`, saldo em `vw_saves_avulsos`): o save
 *  faturado sem job pelo financeiro. Ele entra na lista de saldos ao lado
 *  dos jobs, com `avulso: true`, o id dele no lugar do `jobId` e o nome
 *  dele no lugar do código.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PontaDeSave,
  EstadoSaveDaLinha,
  PedidoDeSave,
  PedidosDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import type {
  OrigemDeSave,
  SaveAprovacaoMomento,
  SaveAprovacaoSituacao,
  SaveAprovacaoTipo,
} from "@/lib/types";
import { jobCanceladoAntesDaAbertura } from "@/lib/types";
import type { PedidoParaFinanceiro } from "@/lib/calculos/save-financeiro";
import { rotuloMes } from "@/lib/calculos/meses-trimestre";

/** Um saldo de save a oferecer: um job, ou um save avulso (decisão 247). */
export interface SaldoDeSave {
  /** O id da origem: o job, ou o save avulso quando `avulso`. */
  jobId: string;
  /** O código do job, ou o nome do save avulso. */
  codigo: string;
  /** O nome do job, ou "NF 4410 · 15/10/2026" no save avulso. */
  nome: string;
  /** A origem é um save avulso (decisão 247), não um job. */
  avulso: boolean;
  /** Total gerado pelas linhas em save do job. */
  gerado: number;
  /** Já consumido por consumos firmes. */
  consumido: number;
  /** Segurado por rascunhos ainda não aprovados. Informativo: rascunho não
   *  segura saldo (decisão 028, nota de 26/08/2026). */
  reservado: number;
  /** Parte do saldo presa em pedidos de consumo que ainda aguardam o
   *  financeiro (decisão 099). Já sai do `disponivel`. */
  reservadoAprovacao: number;
  /** Aprovado − (consumido + reservado por pedido). É o que cabe consumir. */
  disponivel: number;
  /** As taxas da ORIGEM: quem calcula a receita que migra é o TypeScript,
   *  com a mesma `REGRAS_TIPO_CUSTO`. */
  percentualHonorarios: number;
  percentualImposto: number;
  /** As linhas que formaram o saldo — o detalhe do pop-up. */
  linhas: { descricao: string; tipoCusto: string; valor: number }[];
}

/**
 * O grupo do pedido de save como a tela mostra (24/09/2026). No modelo
 * mensal (decisão 078) os mesmos grupos se repetem mês a mês, e o pedido
 * sai com o mês na frente: "Outubro de 2026 · Agrupamento 1". Fora do
 * mensal `mes` é nulo e o grupo fica como está. O mês vem do campo
 * calculado `mes_do_pedido` de `saves_aprovacoes`.
 */
export function grupoDoPedido(
  grupoNome: string | null,
  mes: string | null,
): string | null {
  if (!mes) return grupoNome;
  const rotulo = rotuloMes(mes);
  return grupoNome ? `${rotulo} · ${grupoNome}` : rotulo;
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
  const [saldosRes, linhasRes, avulsosRes] = await Promise.all([
    supabase
      .from("vw_saves_por_job")
      .select(
        "job_id, job_codigo, job_nome, saldo_gerado, consumido, reservado, reservado_aprovacao, disponivel, percentual_honorarios, percentual_imposto",
      )
      .eq("tenant_id", tenantId)
      .eq("cliente_id", clienteId)
      .order("job_codigo"),
    supabase
      .from("vw_saves_linhas")
      .select("job_id, descricao, tipo_custo, valor")
      .eq("tenant_id", tenantId),
    // Os saves avulsos do cliente (decisão 247), depois dos jobs.
    supabase
      .from("vw_saves_avulsos")
      .select(
        "id, nome, numero_nf, data_emissao, credito, consumido, reservado, reservado_aprovacao, disponivel, percentual_honorarios, percentual_imposto",
      )
      .eq("tenant_id", tenantId)
      .eq("cliente_id", clienteId)
      .order("data_emissao"),
  ]);
  if (avulsosRes.error) {
    console.error("[saves.saldos_avulsos]", avulsosRes.error.message);
  }

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

  const deJobs: SaldoDeSave[] = ((saldosRes.data ?? []) as any[])
    .filter((s) => s.job_id !== excluirJobId)
    .map((s) => ({
      jobId: s.job_id,
      codigo: s.job_codigo,
      nome: s.job_nome,
      avulso: false,
      gerado: Number(s.saldo_gerado ?? 0),
      consumido: Number(s.consumido ?? 0),
      reservado: Number(s.reservado ?? 0),
      reservadoAprovacao: Number(s.reservado_aprovacao ?? 0),
      disponivel: Number(s.disponivel ?? 0),
      percentualHonorarios: Number(s.percentual_honorarios ?? 0),
      percentualImposto: Number(s.percentual_imposto ?? 0),
      linhas: linhasPorJob.get(s.job_id) ?? [],
    }));
  const avulsos: SaldoDeSave[] = ((avulsosRes.data ?? []) as any[]).map((a) => ({
    jobId: a.id,
    codigo: a.nome,
    nome: detalheDoSaveAvulso(a.numero_nf, a.data_emissao),
    avulso: true,
    gerado: Number(a.credito ?? 0),
    consumido: Number(a.consumido ?? 0),
    reservado: Number(a.reservado ?? 0),
    reservadoAprovacao: Number(a.reservado_aprovacao ?? 0),
    disponivel: Number(a.disponivel ?? 0),
    percentualHonorarios: Number(a.percentual_honorarios ?? 0),
    percentualImposto: Number(a.percentual_imposto ?? 0),
    linhas: [
      {
        descricao: a.numero_nf ? `NF ${a.numero_nf} · save avulso` : "Save avulso",
        tipoCusto: "—",
        valor: Number(a.credito ?? 0),
      },
    ],
  }));
  return [...deJobs, ...avulsos];
}

/** "NF 4410 · 15/10/2026": o detalhe do save avulso nas listas (decisão 247). */
export function detalheDoSaveAvulso(numeroNf: string | null, dataEmissao: string | null): string {
  const data = dataEmissao ? dataEmissao.slice(0, 10).split("-").reverse().join("/") : null;
  return [numeroNf ? `NF ${numeroNf}` : null, data].filter(Boolean).join(" · ") || "Save avulso";
}

/** As colunas de `saves_consumos` que dizem de onde vem o consumo: o job de
 *  origem ou o save avulso (decisão 247), já com o código ou o nome. */
const COLUNAS_ORIGEM = "valor, job_origem_id, save_avulso_id, jobs(codigo), saves_avulsos(nome)";

/** A origem de um consumo lido com `COLUNAS_ORIGEM`. `null` para a origem
 *  que é job e não está à vista (o embed com `jobs!inner` a tirava da lista
 *  antes da decisão 247; o comportamento continua o mesmo). */
function pontaDoConsumo(c: any): PontaDeSave | null {
  if (c.save_avulso_id) {
    return {
      jobId: c.save_avulso_id,
      codigo: c.saves_avulsos?.nome ?? "Save avulso",
      valor: Number(c.valor ?? 0),
      avulso: true,
    };
  }
  if (!c.jobs) return null;
  return { jobId: c.job_origem_id, codigo: c.jobs.codigo ?? "—", valor: Number(c.valor ?? 0), avulso: false };
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
      .select(`item_versao_id, ${COLUNAS_ORIGEM}`)
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
    const ponta = pontaDoConsumo(c);
    if (!ponta) return;
    const lista = origensPorItem.get(itemVersaoId) ?? [];
    lista.push(ponta);
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
      .select(`job_item_orcado_id, ${COLUNAS_ORIGEM}`)
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
            // `!orcamento_id`: há duas FKs entre `versoes_orcamento` e
            // `orcamentos`, e sem a dica o PostgREST recusa a consulta por
            // ambiguidade (300) — o destino do consumo sumia em silêncio.
            .select(
              "id, versoes_orcamento!inner(orcamentos!orcamento_id(jobs(id, codigo, status, data_abertura_financeiro)))",
            )
            .in("id", idsVersao)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const consumidor = new Map<string, { id: string; codigo: string }>();
    for (const r of ((porCopia as any).data ?? []) as any[]) {
      consumidor.set(r.id, { id: r.job_id, codigo: r.jobs?.codigo ?? "—" });
    }
    for (const r of ((porVersao as any).data ?? []) as any[]) {
      // O job vivo do orçamento. O cancelado antes da abertura não é mais
      // job (decisão 113): sem esta volta, o orçamento que teve o envio
      // cancelado citava o código do cancelado — e, com um job novo ao
      // lado, citava um dos dois ao acaso.
      const jobs = (r.versoes_orcamento?.orcamentos?.jobs ?? []) as Array<{
        id: string;
        codigo: string;
        status: string;
        data_abertura_financeiro: string | null;
      }>;
      const job = jobs.find((j) => !jobCanceladoAntesDaAbertura(j));
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
          avulso: false,
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
      // O orçamento não passa por aprovação de save (decisão 099).
      pedidos: null,
      marcadoPor: null,
      marcadoEm: null,
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

  const [origensRes, destinosRes, aprovacao] = await Promise.all([
    // De onde vem o dinheiro que paga estas linhas.
    supabase
      .from("saves_consumos")
      .select(`job_item_orcado_id, ${COLUNAS_ORIGEM}`)
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", orcadoIds),
    // Quem consumiu o saldo DESTE job. O saldo é do job, então o destino
    // vale para todas as linhas em save dele (decisão 028, nota de 26/08).
    supabase
      .from("saves_consumos")
      .select("valor, job_item_orcado_id, item_versao_id")
      .eq("tenant_id", tenantId)
      .eq("job_origem_id", jobId),
    // Pedidos de aprovação e quem marcou (decisão 099).
    pedidosEMarcasDasLinhas(supabase, tenantId, orcadoIds),
  ]);

  const origensPorOrcado = new Map<string, PontaDeSave[]>();
  for (const c of (origensRes.data ?? []) as any[]) {
    const ponta = pontaDoConsumo(c);
    if (!ponta) continue;
    const lista = origensPorOrcado.get(c.job_item_orcado_id) ?? [];
    lista.push(ponta);
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
        { jobId: r.job_id as string, codigo: (r.jobs as any)?.codigo ?? "—", avulso: false },
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
    const pedidos = aprovacao.pedidos.get(it.orcado_id) ?? PEDIDOS_VAZIOS;
    // A linha recusada já voltou a ser comum, mas continua na coluna Save
    // até o GP arquivar a recusa (decisão 099).
    if (!it.em_save && origens.length === 0 && !pedidos.recusado) continue;
    const marca = aprovacao.marcas.get(it.orcado_id);
    saida[it.id] = {
      emSave: it.em_save,
      saveConsumido: Number(it.save_consumido ?? 0),
      origens,
      destinos: it.em_save ? destinos : [],
      pedidos,
      marcadoPor: marca?.por ?? null,
      marcadoEm: marca?.em ?? null,
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

  const [origensRes, destinosRes, aprovacao] = await Promise.all([
    // De onde vem o dinheiro que paga estas linhas.
    supabase
      .from("saves_consumos")
      .select(`job_item_orcado_id, ${COLUNAS_ORIGEM}`)
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", orcadoIds),
    // Quem consumiu o saldo de QUALQUER um destes jobs.
    supabase
      .from("saves_consumos")
      .select("valor, job_item_orcado_id, job_origem_id")
      .eq("tenant_id", tenantId)
      .in("job_origem_id", jobIds),
    // Pedidos de aprovação e quem marcou (decisão 099).
    pedidosEMarcasDasLinhas(supabase, tenantId, orcadoIds),
  ]);

  const origensPorOrcado = new Map<string, PontaDeSave[]>();
  for (const c of (origensRes.data ?? []) as any[]) {
    const ponta = pontaDoConsumo(c);
    if (!ponta) continue;
    const lista = origensPorOrcado.get(c.job_item_orcado_id) ?? [];
    lista.push(ponta);
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
        { jobId: r.job_id as string, codigo: (r.jobs as any)?.codigo ?? "—", avulso: false },
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
    const pedidos = aprovacao.pedidos.get(it.orcado_id) ?? PEDIDOS_VAZIOS;
    if (!it.em_save && origens.length === 0 && !pedidos.recusado) continue;
    const marca = aprovacao.marcas.get(it.orcado_id);
    saida[it.id] = {
      emSave: it.em_save,
      saveConsumido: Number(it.save_consumido ?? 0),
      origens,
      destinos: it.em_save ? (destinosPorJobOrigem.get(it.jobId) ?? []) : [],
      pedidos,
      marcadoPor: marca?.por ?? null,
      marcadoEm: marca?.em ?? null,
    };
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Aprovação de save (decisão 099)
// ---------------------------------------------------------------------------

const PEDIDOS_VAZIOS: PedidosDaLinha = {
  aguardando: null,
  aprovado: null,
  recusado: null,
  historico: [],
};

const COLUNAS_PEDIDO =
  "id, job_id, job_item_orcado_id, tipo, situacao, momento, valor, origens, origens_antes, substitui_id, enviado_por, enviado_em, decidido_por, decidido_em, justificativa, retirado_por, retirado_em, valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois";

/**
 * Pedidos de aprovação de save e a marca (quem marcou, quando) de cada
 * linha do job, chaveados por `jobs_itens_orcado.id`.
 *
 * Os nomes e os códigos dos jobs de origem saem em consultas separadas, em
 * paralelo: `saves_aprovacoes` tem quatro FKs para `profiles`, e o embed
 * sem dica é ambíguo (HTTP 300 — o dado some calado).
 */
export async function pedidosEMarcasDasLinhas(
  supabase: SupabaseClient,
  tenantId: string,
  orcadoIds: string[],
): Promise<{
  pedidos: Map<string, PedidosDaLinha>;
  marcas: Map<string, { por: string | null; em: string | null }>;
}> {
  const pedidos = new Map<string, PedidosDaLinha>();
  const marcas = new Map<string, { por: string | null; em: string | null }>();
  if (orcadoIds.length === 0) return { pedidos, marcas };

  const [pedidosRes, marcasRes] = await Promise.all([
    supabase
      .from("saves_aprovacoes")
      .select(COLUNAS_PEDIDO)
      .eq("tenant_id", tenantId)
      .in("job_item_orcado_id", orcadoIds)
      .order("enviado_em", { ascending: true }),
    supabase
      .from("jobs_itens_orcado")
      .select("id, save_marcado_por, save_marcado_em")
      .eq("tenant_id", tenantId)
      .in("id", orcadoIds)
      .not("save_marcado_por", "is", null),
  ]);
  if (pedidosRes.error) {
    console.error("[saves.pedidos]", pedidosRes.error.message);
  }
  if (marcasRes.error) {
    console.error("[saves.marcas]", marcasRes.error.message);
  }

  const linhas = (pedidosRes.data ?? []) as any[];
  const linhasMarca = (marcasRes.data ?? []) as any[];

  const idsPessoas = new Set<string>();
  const idsJobs = new Set<string>();
  const idsAvulsos = new Set<string>();
  for (const p of linhas) {
    for (const k of ["enviado_por", "decidido_por", "retirado_por"]) {
      if (p[k]) idsPessoas.add(p[k]);
    }
    for (const o of [...(p.origens ?? []), ...(p.origens_antes ?? [])] as OrigemDeSave[]) {
      if (o?.job_origem_id) idsJobs.add(o.job_origem_id);
      if (o?.save_avulso_id) idsAvulsos.add(o.save_avulso_id);
    }
  }
  for (const m of linhasMarca) if (m.save_marcado_por) idsPessoas.add(m.save_marcado_por);

  const [pessoasRes, jobsRes, avulsosRes] = await Promise.all([
    idsPessoas.size
      ? supabase.from("profiles").select("id, nome").in("id", [...idsPessoas])
      : Promise.resolve({ data: [] as any[], error: null }),
    idsJobs.size
      ? supabase.from("jobs").select("id, codigo").in("id", [...idsJobs])
      : Promise.resolve({ data: [] as any[], error: null }),
    idsAvulsos.size
      ? supabase.from("saves_avulsos").select("id, nome").in("id", [...idsAvulsos])
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const nome = new Map<string, string>(
    ((pessoasRes.data ?? []) as any[]).map((r) => [r.id, r.nome ?? ""]),
  );
  const codigo = new Map<string, string>(
    ((jobsRes.data ?? []) as any[]).map((r) => [r.id, r.codigo ?? "—"]),
  );
  const nomeDoAvulso = new Map<string, string>(
    ((avulsosRes.data ?? []) as any[]).map((r) => [r.id, r.nome ?? "Save avulso"]),
  );
  const pontas = (lista: OrigemDeSave[] | null): PontaDeSave[] =>
    (lista ?? []).map((o) =>
      o.save_avulso_id
        ? {
            jobId: o.save_avulso_id,
            codigo: nomeDoAvulso.get(o.save_avulso_id) ?? "Save avulso",
            valor: Number(o.valor ?? 0),
            avulso: true,
          }
        : {
            jobId: o.job_origem_id ?? "",
            codigo: codigo.get(o.job_origem_id ?? "") ?? "—",
            valor: Number(o.valor ?? 0),
            avulso: false,
          },
    );
  const numOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  for (const p of linhas) {
    const pedido: PedidoDeSave = {
      id: p.id,
      tipo: p.tipo as SaveAprovacaoTipo,
      situacao: p.situacao as SaveAprovacaoSituacao,
      momento: p.momento as SaveAprovacaoMomento,
      valor: Number(p.valor ?? 0),
      origens: pontas(p.origens),
      origensAntes: pontas(p.origens_antes),
      substituiId: p.substitui_id ?? null,
      enviadoEm: p.enviado_em,
      enviadoPor: p.enviado_por ? (nome.get(p.enviado_por) ?? null) : null,
      decididoEm: p.decidido_em ?? null,
      decididoPor: p.decidido_por ? (nome.get(p.decidido_por) ?? null) : null,
      justificativa: p.justificativa ?? null,
      retiradoEm: p.retirado_em ?? null,
      retiradoPor: p.retirado_por ? (nome.get(p.retirado_por) ?? null) : null,
      valorJobAntes: numOuNulo(p.valor_job_antes),
      valorJobDepois: numOuNulo(p.valor_job_depois),
      faturamentoPrevistoAntes: numOuNulo(p.faturamento_previsto_antes),
      faturamentoPrevistoDepois: numOuNulo(p.faturamento_previsto_depois),
    };
    const atual = pedidos.get(p.job_item_orcado_id) ?? {
      aguardando: null,
      aprovado: null,
      recusado: null,
      historico: [],
    };
    atual.historico.push(pedido);
    if (pedido.situacao === "aguardando") atual.aguardando = pedido;
    else if (pedido.situacao === "aprovado") atual.aprovado = pedido;
    else if (pedido.situacao === "recusado") atual.recusado = pedido;
    pedidos.set(p.job_item_orcado_id, atual);
  }

  for (const m of linhasMarca) {
    marcas.set(m.id, {
      por: nome.get(m.save_marcado_por) ?? null,
      em: m.save_marcado_em ?? null,
    });
  }

  return { pedidos, marcas };
}

/**
 * Os pedidos de um job na forma que `itensParaOFinanceiro` usa para calcular
 * os números do financeiro (espelhos do job). Todo escritor de
 * `jobs.valor_total`, `faturamento_previsto` e `faturamento_save_previsto`
 * passa por aqui: sem isso, uma errata comum gravaria nos espelhos um save
 * que o financeiro ainda não aprovou.
 */
export async function pedidosParaFinanceiroDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
): Promise<PedidoParaFinanceiro[]> {
  const { data, error } = await supabase
    .from("saves_aprovacoes")
    .select("id, job_item_orcado_id, tipo, situacao, momento, origens_antes")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .eq("situacao", "aguardando");
  if (error) {
    // Sem os pedidos a conta sairia errada em silêncio: melhor parar.
    throw new Error(`[saves.pedidos_financeiro] ${error.message}`);
  }
  return ((data ?? []) as any[]).map(paraPedidoDoFinanceiro);
}

/** Uma linha de `saves_aprovacoes` no formato da conta do financeiro. */
function paraPedidoDoFinanceiro(p: any): PedidoParaFinanceiro {
  return {
    id: p.id,
    jobItemOrcadoId: p.job_item_orcado_id ?? null,
    tipo: p.tipo as SaveAprovacaoTipo,
    situacao: p.situacao as SaveAprovacaoSituacao,
    momento: p.momento as SaveAprovacaoMomento,
    origensAntes: ((p.origens_antes ?? []) as OrigemDeSave[]).map((o) => ({
      ...(o.save_avulso_id ? { save_avulso_id: o.save_avulso_id } : { job_origem_id: o.job_origem_id }),
      valor: Number(o.valor ?? 0),
    })),
  };
}

/**
 * Os pedidos de save que aguardam, de TODOS os jobs do tenant, por job — a
 * leitura em lote de `pedidosParaFinanceiroDoJob`, para a lista de jobs do
 * financeiro fechar a conta de cada job sem uma consulta por linha
 * (`docs/PERFORMANCE.md`). Mesmo filtro e mesmo formato.
 */
export async function pedidosParaFinanceiroDoTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Map<string, PedidoParaFinanceiro[]>> {
  const { data, error } = await supabase
    .from("saves_aprovacoes")
    .select("id, job_id, job_item_orcado_id, tipo, situacao, momento, origens_antes")
    .eq("tenant_id", tenantId)
    .eq("situacao", "aguardando");
  if (error) {
    throw new Error(`[saves.pedidos_financeiro_tenant] ${error.message}`);
  }
  const porJob = new Map<string, PedidoParaFinanceiro[]>();
  for (const p of (data ?? []) as any[]) {
    const lista = porJob.get(p.job_id) ?? [];
    lista.push(paraPedidoDoFinanceiro(p));
    porJob.set(p.job_id, lista);
  }
  return porJob;
}

/**
 * A revisão da abertura que o job tem pendente foi causada SÓ por pedidos
 * de save (decisão 099)?
 *
 * Pendente é toda errata registrada depois do último registro de abertura
 * ou revisão (`jobs_aberturas.registrado_em`). A errata de save que nasce
 * com um pedido (`saves_aprovacoes.errata_id`) é "de save"; qualquer outra
 * (errata comum, retirada de save aprovado, cancelamento de pedido que o
 * financeiro já contava) é errata de verdade e pede a revisão normal.
 *
 * Quem pergunta:
 *  - a fila: o job cuja revisão é só de save aparece SÓ na faixa Saves;
 *  - a recusa e o cancelamento: se o pedido era a única pendência, a
 *    revisão se encerra sozinha (`p_revisao = 'fechar'`).
 *
 * `ignorar` é o pedido que está sendo decidido ou cancelado agora: conta
 * como já resolvido.
 */
export async function revisaoPendenteDoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  ignorar: string | null = null,
): Promise<{
  emRevisao: boolean;
  /** Toda errata pendente nasceu de um pedido de save. */
  soDeSave: boolean;
  /** Pedidos de save que seguram a revisão (aguardando), fora `ignorar`. */
  pedidosAguardando: number;
  /** A revisão pode se encerrar sozinha: só de save e nada mais aguardando. */
  podeFechar: boolean;
}> {
  const [jobRes, aberturaRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("abertura_em_revisao")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ abertura_em_revisao: boolean }>(),
    supabase
      .from("jobs_aberturas")
      .select("registrado_em")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .order("registrado_em", { ascending: false })
      .limit(1)
      .maybeSingle<{ registrado_em: string }>(),
  ]);
  const emRevisao = jobRes.data?.abertura_em_revisao === true;
  if (!emRevisao) {
    return { emRevisao, soDeSave: false, pedidosAguardando: 0, podeFechar: false };
  }

  let erratasQ = supabase
    .from("jobs_erratas")
    .select("id")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId);
  if (aberturaRes.data?.registrado_em) {
    erratasQ = erratasQ.gt("created_at", aberturaRes.data.registrado_em);
  }
  const { data: erratas, error: erratasErr } = await erratasQ;
  if (erratasErr) {
    console.error("[saves.revisao.erratas]", erratasErr.message);
    // Sem saber, trata como revisão normal: nunca fecha sozinha.
    return { emRevisao, soDeSave: false, pedidosAguardando: 0, podeFechar: false };
  }
  const idsErratas = ((erratas ?? []) as { id: string }[]).map((e) => e.id);
  if (idsErratas.length === 0) {
    return { emRevisao, soDeSave: false, pedidosAguardando: 0, podeFechar: false };
  }

  const { data: pedidos, error: pedidosErr } = await supabase
    .from("saves_aprovacoes")
    .select("id, errata_id, situacao")
    .eq("tenant_id", tenantId)
    .eq("job_id", jobId)
    .in("errata_id", idsErratas);
  if (pedidosErr) {
    console.error("[saves.revisao.pedidos]", pedidosErr.message);
    return { emRevisao, soDeSave: false, pedidosAguardando: 0, podeFechar: false };
  }
  const lista = (pedidos ?? []) as { id: string; errata_id: string; situacao: string }[];
  const erratasDeSave = new Set(lista.map((p) => p.errata_id));
  const soDeSave = idsErratas.every((id) => erratasDeSave.has(id));
  const pedidosAguardando = lista.filter(
    (p) => p.situacao === "aguardando" && p.id !== ignorar,
  ).length;
  return {
    emRevisao,
    soDeSave,
    pedidosAguardando,
    podeFechar: soDeSave && pedidosAguardando === 0,
  };
}

// ---------------------------------------------------------------------------
// Origens dos pedidos: job ou save avulso (decisão 247)
// ---------------------------------------------------------------------------

/** O id de uma origem guardada nos pedidos: o job, ou o save avulso. */
export function idDaOrigem(o: OrigemDeSave): string {
  return o.save_avulso_id ?? o.job_origem_id ?? "";
}

/**
 * O código do job, ou o nome do save avulso, de cada origem, pelo id. Duas
 * consultas em paralelo, só das que aparecem.
 */
export async function rotulosDasOrigens(
  supabase: SupabaseClient,
  origens: OrigemDeSave[],
): Promise<Map<string, { codigo: string; avulso: boolean }>> {
  const idsJobs = [...new Set(origens.map((o) => o.job_origem_id).filter((v): v is string => Boolean(v)))];
  const idsAvulsos = [...new Set(origens.map((o) => o.save_avulso_id).filter((v): v is string => Boolean(v)))];
  const [jobsRes, avulsosRes] = await Promise.all([
    idsJobs.length
      ? supabase.from("jobs").select("id, codigo").in("id", idsJobs)
      : Promise.resolve({ data: [] as any[], error: null }),
    idsAvulsos.length
      ? supabase.from("saves_avulsos").select("id, nome").in("id", idsAvulsos)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const saida = new Map<string, { codigo: string; avulso: boolean }>();
  for (const j of (jobsRes.data ?? []) as any[]) saida.set(j.id, { codigo: j.codigo ?? "—", avulso: false });
  for (const a of (avulsosRes.data ?? []) as any[]) saida.set(a.id, { codigo: a.nome ?? "Save avulso", avulso: true });
  return saida;
}

/**
 * As origens escolhidas no pop-up de save, na forma que o banco grava: o id
 * de cada uma é classificado como save avulso (decisão 247) ou job. O
 * pop-up trata as duas pelo mesmo campo (`jobOrigemId`), como a lista de
 * saldos; só aqui, antes da RPC, elas se separam. Uma entrada por origem,
 * valores positivos somados.
 */
export async function origensParaOBanco(
  supabase: SupabaseClient,
  tenantId: string,
  escolhidas: { jobOrigemId: string; valor: number }[],
): Promise<OrigemDeSave[]> {
  const porOrigem = new Map<string, number>();
  for (const o of escolhidas) {
    const valor = Number(o.valor || 0);
    if (!o.jobOrigemId || !(valor > 0)) continue;
    porOrigem.set(o.jobOrigemId, (porOrigem.get(o.jobOrigemId) ?? 0) + valor);
  }
  const ids = [...porOrigem.keys()];
  const avulsos = new Set<string>();
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("saves_avulsos")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", ids);
    if (error) throw new Error(`[saves.origens_para_o_banco] ${error.message}`);
    for (const a of (data ?? []) as { id: string }[]) avulsos.add(a.id);
  }
  return ids.map((id) => {
    const valor = Math.round((porOrigem.get(id) ?? 0) * 100) / 100;
    return avulsos.has(id) ? { save_avulso_id: id, valor } : { job_origem_id: id, valor };
  });
}

/**
 * O consumo de SAVE AVULSO (decisão 247) cabe no crédito? A mesma conferência
 * que a aprovação da versão e o envio para abertura fazem para os jobs de
 * origem, com o saldo de `vw_saves_avulsos`. `jaDescontado`: o consumo já
 * segura saldo (versão aprovada, cópia do job devolvido) e já está no
 * `usado` da view — então cabe quando o disponível não fica negativo. Sem
 * ele (rascunho que vai ser aprovado), cabe quando não passa do disponível.
 * Devolve a recusa, ou `null`.
 */
export async function recusaDoConsumoDeSaveAvulso(
  supabase: SupabaseClient,
  tenantId: string,
  consumos: { save_avulso_id: string | null; valor: number | string }[],
  jaDescontado: boolean,
  quem: string,
): Promise<string | null> {
  const porAvulso = new Map<string, number>();
  for (const c of consumos) {
    if (!c.save_avulso_id) continue;
    porAvulso.set(c.save_avulso_id, (porAvulso.get(c.save_avulso_id) ?? 0) + Number(c.valor ?? 0));
  }
  if (porAvulso.size === 0) return null;
  const { data, error } = await supabase
    .from("vw_saves_avulsos")
    .select("id, nome, disponivel")
    .eq("tenant_id", tenantId)
    .in("id", [...porAvulso.keys()]);
  if (error) {
    console.error("[saves.consumo_avulso]", error.message);
    return "Não foi possível conferir o saldo do save avulso. Tente de novo.";
  }
  const saldo = new Map(((data ?? []) as { id: string; nome: string; disponivel: number | string }[]).map((a) => [a.id, a]));
  for (const [id, consome] of porAvulso) {
    if (consome <= 0.004) continue;
    const a = saldo.get(id);
    const disp = Number(a?.disponivel ?? (jaDescontado ? -consome : 0));
    const cabe = jaDescontado ? disp >= -0.005 : consome <= disp + 0.005;
    if (cabe) continue;
    const livre = Math.max(0, jaDescontado ? disp + consome : disp);
    const nome = a?.nome ?? "save avulso";
    const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return (
      `${quem} consome ${brl(consome)} do save avulso “${nome}”, ` +
      `e o crédito disponível dele é de ${brl(livre)}. Ajuste o consumo.`
    );
  }
  return null;
}
