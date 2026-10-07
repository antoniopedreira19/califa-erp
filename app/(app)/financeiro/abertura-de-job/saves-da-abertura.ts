import { createClient } from "@/lib/supabase/server";
import type {
  CategoriaModeloPlanilha,
  SaveAprovacaoSituacao,
  TipoCusto,
} from "@/lib/types";
import { faturamentoDaLinhaEmSave, savesDaConferencia } from "./dados";

/**
 * Os saves que vieram com o job, como o formulário da abertura os mostra
 * (decisão 155, 07/10/2026). Na abertura o financeiro marca "Aprovar save
 * gerado" e "Aprovar consumo de save", e abrir o job aprova os pedidos. No
 * job aberto o mesmo bloco aparece em leitura, com a situação de cada um.
 */
export interface LinhaDeSaveDaAbertura {
  /** `jobs_itens_orcado.id`. */
  id: string;
  tipo: "gera" | "consome";
  /** No mensal, com o mês na frente (`grupoDoPedido`). */
  grupo: string | null;
  item: string;
  tipoCusto: TipoCusto | null;
  /** Gera: o crédito (orçado da linha). Consome: o consumido. */
  valor: number;
  /** Consome: de qual job vem o saldo, maior primeiro. Gera: []. */
  origens: { jobId: string; codigo: string; nome: string; valor: number }[];
  /** Gera: o que a nota cobra por causa da linha. Consome: null. */
  faturamentoDaLinha: number | null;
  /** O pedido de save da linha (momento `abertura` ou `reenvio`). Nulo
   *  antes de abrir, quando o pedido ainda não existe. */
  situacao: SaveAprovacaoSituacao | null;
}

export interface SavesDaAbertura {
  linhas: LinhaDeSaveDaAbertura[];
  clienteNome: string;
  /** Saldo de save disponível do cliente, somando os OUTROS jobs dele, como
   *  a `vw_saves_por_job` o dá: já descontado o consumo DESTE job (escolha do
   *  Tiago, 07/10/2026). O "depois" é ele + o crédito que o job gera. */
  saldoDoClienteAntes: number;
  /** Saldo de cada job de origem ANTES deste consumo: o disponível da view
   *  mais o que este job consome dele. */
  saldoDasOrigens: Record<string, number>;
  /** O orçamento inteiro num modo de save (decisão 154). */
  modoInteiro: { tipo: "gera" } | { tipo: "consome"; codigo: string } | null;
  /** Job aberto com todos os pedidos da abertura aprovados: quando e por
   *  quem. Nulo antes de abrir, ou se algum pedido não está aprovado. */
  aprovados: { em: string; porNome: string | null } | null;
}

const MOMENTOS_DA_ABERTURA = ["abertura", "reenvio"];

/**
 * Lê o que o bloco "Saves deste job" mostra. `null` quando o job não tem
 * linha com save — aí o bloco não aparece e a tela fica como era.
 *
 * Três leituras em paralelo (o job com a versão, as linhas com save e os
 * pedidos da abertura), e uma segunda onda que depende delas (saldos da
 * view e nomes dos jobs de origem e de quem aprovou), também em paralelo.
 */
export async function carregarSavesDaAbertura(
  tenantId: string,
  jobId: string,
): Promise<SavesDaAbertura | null> {
  const supabase = createClient();
  const [jobRes, porJob, tiposRes, pedidosRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, projeto:projetos(cliente_id, cliente:clientes(nome_fantasia)), " +
          "versao:versoes_orcamento!versao_orcamento_aprovada_id(percentual_honorarios, percentual_imposto, percentual_int_taxes, int_transaction_costs, moeda_estrangeira, cambio_compra, save_por_padrao, save_consumo_job_id), " +
          "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha))",
      )
      .eq("tenant_id", tenantId)
      .eq("id", jobId)
      .maybeSingle(),
    savesDaConferencia([jobId], tenantId),
    supabase
      .from("jobs_itens_orcado")
      .select("id, tipo_custo, em_save, cancelada_em")
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId),
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id, situacao, decidido_em, decidido_por")
      .eq("tenant_id", tenantId)
      .eq("job_id", jobId)
      .in("momento", MOMENTOS_DA_ABERTURA)
      .in("situacao", ["aguardando", "aprovado", "recusado"]),
  ]);

  const linhasDoJob = porJob.get(jobId) ?? [];
  if (linhasDoJob.length === 0) return null;
  if (jobRes.error) console.error("[abertura-job.saves.job]", jobRes.error.message);
  if (tiposRes.error) console.error("[abertura-job.saves.tipos]", tiposRes.error.message);
  if (pedidosRes.error) console.error("[abertura-job.saves.pedidos]", pedidosRes.error.message);

  const job = jobRes.data as any;
  const versao = job?.versao ?? null;
  const modelo = (job?.orcamento?.categoria?.modelo_planilha ?? null) as CategoriaModeloPlanilha | null;
  const clienteId = (job?.projeto?.cliente_id as string | null) ?? null;
  const clienteNome = (job?.projeto?.cliente?.nome_fantasia as string | null) ?? "o cliente";

  const tipos = new Map<string, TipoCusto>();
  let vivas = 0;
  let vivasEmSave = 0;
  for (const l of (tiposRes.data ?? []) as any[]) {
    tipos.set(l.id, l.tipo_custo as TipoCusto);
    if (!l.cancelada_em) {
      vivas += 1;
      if (l.em_save) vivasEmSave += 1;
    }
  }

  // O pedido mais recente de cada linha (um aguardando ou aprovado por
  // linha é o que o banco garante; o recusado fica até o GP arquivar).
  const pedidos = (pedidosRes.data ?? []) as any[];
  const situacaoPorLinha = new Map<string, SaveAprovacaoSituacao>();
  for (const p of pedidos) {
    if (!p.job_item_orcado_id) continue;
    const atual = situacaoPorLinha.get(p.job_item_orcado_id);
    if (!atual || p.situacao === "aprovado" || p.situacao === "aguardando") {
      situacaoPorLinha.set(p.job_item_orcado_id, p.situacao);
    }
  }

  const idsOrigem = [
    ...new Set(linhasDoJob.flatMap((l) => l.origens.map((o) => o.jobId))),
  ];
  const consumoJobId = (versao?.save_consumo_job_id as string | null) ?? null;
  const aprovadores = [
    ...new Set(pedidos.map((p) => p.decidido_por as string | null).filter(Boolean)),
  ] as string[];

  const [saldosRes, origensRes, pessoasRes] = await Promise.all([
    clienteId || idsOrigem.length > 0
      ? supabase
          .from("vw_saves_por_job")
          .select("job_id, cliente_id, disponivel")
          .eq("tenant_id", tenantId)
          .or(
            [
              clienteId ? `cliente_id.eq.${clienteId}` : null,
              idsOrigem.length > 0 ? `job_id.in.(${idsOrigem.join(",")})` : null,
            ]
              .filter(Boolean)
              .join(","),
          )
      : Promise.resolve({ data: [], error: null }),
    idsOrigem.length > 0 || consumoJobId
      ? supabase
          .from("jobs")
          .select("id, codigo, nome")
          .in("id", [...new Set([...idsOrigem, ...(consumoJobId ? [consumoJobId] : [])])])
      : Promise.resolve({ data: [], error: null }),
    aprovadores.length > 0
      ? supabase.from("profiles").select("id, nome").in("id", aprovadores)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (saldosRes.error) console.error("[abertura-job.saves.saldos]", saldosRes.error.message);
  if (origensRes.error) console.error("[abertura-job.saves.origens]", origensRes.error.message);

  const nomes = new Map<string, { codigo: string; nome: string }>(
    ((origensRes.data ?? []) as any[]).map((j) => [j.id, { codigo: j.codigo, nome: j.nome }]),
  );
  let saldoDoClienteAntes = 0;
  const disponivelPorJob = new Map<string, number>();
  for (const s of (saldosRes.data ?? []) as any[]) {
    const v = Number(s.disponivel ?? 0);
    disponivelPorJob.set(s.job_id, v);
    // O próprio job fica de fora: depois de aberto, o crédito que ele gerou
    // já está na view, e o "antes → depois" o contaria duas vezes.
    if (clienteId && s.cliente_id === clienteId && s.job_id !== jobId) {
      saldoDoClienteAntes += v;
    }
  }

  const linhas: LinhaDeSaveDaAbertura[] = linhasDoJob.map((l) => {
    const tipoCusto = tipos.get(l.id) ?? null;
    return {
      id: l.id,
      tipo: l.tipo,
      grupo: l.grupoNome,
      item: l.item,
      tipoCusto,
      valor: l.valor,
      origens: l.origens.map((o) => ({
        jobId: o.jobId,
        codigo: o.codigo,
        nome: nomes.get(o.jobId)?.nome ?? "",
        valor: o.valor,
      })),
      faturamentoDaLinha:
        l.tipo === "gera" ? faturamentoDaLinhaEmSave(l.valor, tipoCusto, versao, modelo) : null,
      situacao: situacaoPorLinha.get(l.id) ?? null,
    };
  });

  // Saldo de cada origem antes deste consumo: o disponível (que já
  // desconta este job) mais o que este job usa dela.
  const saldoDasOrigens: Record<string, number> = {};
  for (const id of idsOrigem) {
    const usado = linhas
      .flatMap((l) => l.origens)
      .filter((o) => o.jobId === id)
      .reduce((t, o) => t + o.valor, 0);
    saldoDasOrigens[id] = Math.round(((disponivelPorJob.get(id) ?? 0) + usado) * 100) / 100;
  }

  // Modo do orçamento inteiro (decisão 154): o consumo grava o job de
  // origem na versão; o "gera tudo" é a chave ligada com toda linha viva
  // em save.
  const modoInteiro: SavesDaAbertura["modoInteiro"] = consumoJobId
    ? { tipo: "consome", codigo: nomes.get(consumoJobId)?.codigo ?? "—" }
    : versao?.save_por_padrao === true && vivas > 0 && vivasEmSave === vivas
      ? { tipo: "gera" }
      : null;

  // Aprovados: só quando TODA linha tem pedido aprovado. Data e autor da
  // decisão mais recente (na abertura, todos têm os mesmos).
  const todosAprovados =
    linhas.length > 0 && linhas.every((l) => l.situacao === "aprovado");
  let aprovados: SavesDaAbertura["aprovados"] = null;
  if (todosAprovados) {
    const ultimo = pedidos
      .filter((p) => p.situacao === "aprovado" && p.decidido_em)
      .sort((a, b) => String(b.decidido_em).localeCompare(String(a.decidido_em)))[0];
    if (ultimo) {
      const pessoa = ((pessoasRes.data ?? []) as any[]).find((p) => p.id === ultimo.decidido_por);
      aprovados = { em: ultimo.decidido_em, porNome: pessoa?.nome ?? null };
    }
  }

  return {
    linhas,
    clienteNome,
    saldoDoClienteAntes: Math.round(saldoDoClienteAntes * 100) / 100,
    saldoDasOrigens,
    modoInteiro,
    aprovados,
  };
}

/** Quais tipos de save o job tem — o que a abertura exige marcar. */
export function tiposDeSaveDoJob(saves: SavesDaAbertura | null): {
  gera: boolean;
  consumo: boolean;
} {
  return {
    gera: !!saves?.linhas.some((l) => l.tipo === "gera"),
    consumo: !!saves?.linhas.some((l) => l.tipo === "consome"),
  };
}
