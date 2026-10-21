/**
 * Os dados da aba Banco da conciliação de uma conta (task 029, fase 3,
 * decisões 198 e 199): o extrato importado do banco e o que o motor de
 * correspondência precisa do lado do sistema.
 *
 * - **as linhas do banco**: as pendentes de qualquer data (sem lançamento
 *   ligado e não ignoradas) e as resolvidas do período aberto, pela view
 *   `vw_extrato_linhas` (o `conciliada` calculado);
 * - **a última importação** (o cabeçalho, o saldo do banco e o dia em
 *   andamento) e os períodos de todas (os dias que o extrato cobre);
 * - **os lançamentos da conta ainda sem linha**, agrupados como o banco os
 *   mostra: a baixa e os juros dela (decisão 196), as partes de uma guia de
 *   imposto (decisão 141) e as baixas dos itens de uma remessa no mesmo dia
 *   são um débito só;
 * - **as remessas** da conta, para o passo 4 (a soma centavo a centavo);
 * - **as regras do histórico** ativas da conta e as de todas.
 *
 * Os títulos em aberto vêm da leitura da aba Títulos
 * (`carregarTitulosDaConciliacao`), que a página lê junto.
 *
 * Duas rodadas de leituras em paralelo: a segunda depende das datas que a
 * primeira devolve (as linhas e os períodos importados).
 */

import type { createClient } from "@/lib/supabase/server";
import type { ConciliadaComo, ExtratoLinhaComSituacao, ResolucaoSozinha } from "@/lib/types";
import type { LancamentoDoMotor, RegraDoMotor } from "@/lib/conciliacao/motor";
import { somaDias } from "@/lib/conciliacao/motor";
import { contaTemNumero } from "@/lib/conciliacao/ofx";
import { calcularSaldoAnterior } from "@/lib/calculos/saldo-conta";
import { diaIsoBr, formatDiaBr } from "@/lib/formatar-data-hora";

type Supabase = ReturnType<typeof createClient>;

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Os tipos
// ---------------------------------------------------------------------------

export interface ImportacaoDoBanco {
  id: string;
  arquivo: string;
  bancoId: string | null;
  conta: string | null;
  inicio: string | null;
  fim: string | null;
  /** Quando o banco gerou o arquivo (DTSERVER), ISO. */
  geradoEm: string | null;
  /** O dia e a hora da geração em Brasília ("2026-10-20", "09:19"). */
  geradoDia: string | null;
  geradoHora: string | null;
  saldoBanco: number | null;
  saldoEm: string | null;
  movimentos: number;
  novos: number;
  importadaEm: string;
}

/** Uma linha do extrato do banco, como a aba a mostra. */
export interface LinhaDoBanco {
  id: string;
  digital: string;
  data: string;
  /** Com sinal: o que sai é negativo. */
  valor: number;
  historico: string;
  tipo: string | null;
  documento: string | null;
  ordem: number;
  conciliada: boolean;
  ignorada: { em: string; motivo: string | null } | null;
  resolvidaSozinha: ResolucaoSozinha | null;
  /** Alguém desfez: não se resolve mais sozinha (decisão 201). */
  semAuto: boolean;
  /** Os lançamentos ligados (na conciliada). */
  ligados: Array<{ id: string; descricao: string; valor: number; origem: string }>;
  /** Como se conciliou (decisão 200). */
  conciliadaComo: ConciliadaComo | null;
  /** As linhas que se desfazem juntas. */
  grupo: string | null;
  /** As baixas que mudaram para a data do banco. */
  datasTrocadas: Array<{ id: string; de: string }>;
  /** A correção da baixa, quando a linha se conciliou corrigindo. */
  correcao: { de: number; para: number; motivo: string } | null;
  /** A regra que lançou a linha. */
  regraId: string | null;
}

/** O que a tela cancela para tirar uma baixa sem linha no banco: o tipo e o
 *  id que `cancelarBaixa` recebe (o imposto vai por `cancelarBaixaImposto`). */
export type CancelamentoDaBaixa = { tipo: "baixa" | "desembolso" | "pp_devolucao_verba" | "fatura_cartao" | "transferencia" | "imposto"; id: string };

/** Um débito ou crédito do sistema ainda sem linha do banco. */
export interface LancamentoSemLinha extends LancamentoDoMotor {
  /** Todos os lançamentos que ele junta (a baixa e os juros, as partes da
   *  guia, as baixas da remessa): a conciliação liga todos. */
  ids: string[];
  origem: string;
  fornecedor: string | null;
  /** A forma da baixa (a correção: a diferença vira juros só no boleto). */
  forma: string | null;
  /** A baixa de um documento só, que se corrige pela linha do banco
   *  (PP, avulsa e nota a receber; a remessa e a guia, não). */
  corrigivel: boolean;
  /** Como cancelar a baixa ("sem linha no banco"); `null` não se cancela
   *  por aqui (lançamento manual, estorno). */
  cancelamento: CancelamentoDaBaixa | null;
}

/** Uma remessa CNAB da conta, com o que cada item pagou. */
export interface RemessaDaConta {
  id: string;
  nome: string;
  descricao: string;
  itens: Array<{ origemTipo: string; origemId: string; valor: number }>;
}

/** A regra com o que o lançamento dela leva. */
export interface RegraDaConta extends RegraDoMotor {
  id: string;
  empresa: string;
  tipoId: string;
  subtipoId: string;
  empresaId: string;
  /** `null` vale para todas as contas. */
  contaId: string | null;
}

export interface DadosDaAbaBanco {
  conta: {
    id: string;
    nome: string;
    banco: string;
    agencia: string | null;
    numero: string | null;
    /** Tem agência e número para reconhecer o arquivo. */
    temNumero: boolean;
  };
  ultima: ImportacaoDoBanco | null;
  /** Os períodos de todas as importações: os dias que o extrato cobre. */
  periodos: Array<{ inicio: string | null; fim: string | null; geradoDia: string | null }>;
  linhas: LinhaDoBanco[];
  lancamentos: LancamentoSemLinha[];
  remessas: RemessaDaConta[];
  regras: RegraDaConta[];
  /** O saldo do sistema no fim do último dia do extrato. */
  saldoSistemaNoFim: number | null;
}

// ---------------------------------------------------------------------------
// Os dias que o extrato cobre
// ---------------------------------------------------------------------------

/**
 * O último dia completo de uma importação: o arquivo gerado no mesmo dia do
 * último movimento ainda não tinha o dia inteiro (Tiago, 20/10/2026), então
 * vai até a véspera (`diaCompleto` do protótipo).
 */
export function diaCompleto(p: { fim: string | null; geradoDia: string | null }): string | null {
  if (!p.fim) return null;
  return p.geradoDia && p.geradoDia > p.fim ? p.fim : somaDias(p.fim, -1);
}

/** O dia está num período já importado e completo? */
export function diaCoberto(dia: string, periodos: DadosDaAbaBanco["periodos"]): boolean {
  return periodos.some((p) => {
    const ate = diaCompleto(p);
    return !!p.inicio && !!ate && dia >= p.inicio && dia <= ate;
  });
}

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------

/** O PostgREST devolve no máximo um teto de linhas por consulta: lê de
 *  página em página até a última. */
async function todasAsPaginas<T>(
  ler: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  rotulo: string,
): Promise<T[]> {
  const PAGINA = 1000;
  const saida: T[] = [];
  for (let de = 0; de < 50_000; de += PAGINA) {
    const { data, error } = await ler(de, de + PAGINA - 1);
    if (error) {
      console.error(`[conciliacao.banco.${rotulo}]`, error.message);
      break;
    }
    saida.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return saida;
}

export type LancamentoCru = {
  id: string;
  data_movimento: string;
  descricao: string;
  natureza: "entrada" | "saida";
  valor: string | number;
  origem: string;
  forma_pagamento: string | null;
  juros_de_lancamento_id: string | null;
  imposto_a_pagar_id: string | null;
  conta_avulsa_id: string | null;
  pedido_compra_parcela_id: string | null;
  titulo_receber_id: string | null;
  desembolso_parcela_id: string | null;
  pp_verba_devolucao_id: string | null;
  fatura_cartao_id: string | null;
  transferencia_id: string | null;
  extrato_linha_id: string | null;
  fornecedores: { nome: string | null; razao_social: string | null } | null;
};

const SELECT_LANCAMENTO =
  "id, data_movimento, descricao, natureza, valor, origem, forma_pagamento, juros_de_lancamento_id, imposto_a_pagar_id, " +
  "conta_avulsa_id, pedido_compra_parcela_id, titulo_receber_id, desembolso_parcela_id, pp_verba_devolucao_id, " +
  "fatura_cartao_id, transferencia_id, extrato_linha_id, fornecedores(nome, razao_social)";

/** A mesma tradução da RPC `_cancelamento_da_baixa`. */
function cancelamentoDe(l: LancamentoCru): CancelamentoDaBaixa | null {
  switch (l.origem) {
    case "pp_baixa":
      return l.pedido_compra_parcela_id ? { tipo: "baixa", id: l.id } : null;
    case "avulsa_baixa":
    case "titulo_baixa":
      return { tipo: "baixa", id: l.id };
    case "desembolso_baixa":
      return l.desembolso_parcela_id ? { tipo: "desembolso", id: l.desembolso_parcela_id } : null;
    case "pp_devolucao_verba":
      return l.pp_verba_devolucao_id ? { tipo: "pp_devolucao_verba", id: l.pp_verba_devolucao_id } : null;
    case "fatura_cartao_baixa":
      return l.fatura_cartao_id ? { tipo: "fatura_cartao", id: l.fatura_cartao_id } : null;
    case "transferencia_saida":
    case "transferencia_entrada":
      return l.transferencia_id ? { tipo: "transferencia", id: l.transferencia_id } : null;
    case "imposto_baixa":
      return l.imposto_a_pagar_id ? { tipo: "imposto", id: l.imposto_a_pagar_id } : null;
    default:
      return null;
  }
}

const assinado = (l: LancamentoCru) => (l.natureza === "entrada" ? Number(l.valor) : -Number(l.valor));

export async function carregarBancoDaConciliacao(
  supabase: Supabase,
  args: { tenantId: string; contaId: string; dataDe: string; dataAte: string },
): Promise<DadosDaAbaBanco> {
  const { tenantId, contaId, dataDe, dataAte } = args;

  // ---- Rodada 1: a conta, as importações, as linhas, as remessas e as regras ----
  const [contaRes, importacoesRes, linhasCruas, itensRes, regrasRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("id, nome, banco, agencia, numero_conta, numero_conta_dv")
      .eq("tenant_id", tenantId)
      .eq("id", contaId)
      .maybeSingle(),
    supabase
      .from("extrato_importacoes")
      .select(
        "id, arquivo_nome, banco_id, conta_no_arquivo, periodo_inicio, periodo_fim, gerado_em, saldo_banco, saldo_em, qtd_movimentos, qtd_novos, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("conta_bancaria_id", contaId)
      .order("created_at", { ascending: true }),
    // As pendentes de qualquer data e as resolvidas do período aberto.
    todasAsPaginas<ExtratoLinhaComSituacao>(
      (de, ate) =>
        supabase
          .from("vw_extrato_linhas")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("conta_bancaria_id", contaId)
          .or(`and(conciliada.is.false,ignorada_em.is.null),and(data.gte.${dataDe},data.lte.${dataAte})`)
          .order("data", { ascending: true })
          .order("ordem", { ascending: true })
          .order("id", { ascending: true })
          .range(de, ate),
      "linhas",
    ),
    // Os itens das remessas vivas da conta. Embed pelo nome da FK: o par
    // de tabelas só tem uma.
    supabase
      .from("cnab_remessas_itens")
      .select("remessa_id, origem_tipo, origem_id, valor, remessa:cnab_remessas!inner(sequencial_arquivo, data_geracao, status, conta_bancaria_id)")
      .eq("tenant_id", tenantId)
      .eq("remessa.status", "gerado")
      .eq("remessa.conta_bancaria_id", contaId),
    supabase
      .from("extrato_regras")
      .select(
        "id, conta_bancaria_id, padrao, usos, created_at, empresa_id, plano_conta_tipo_id, plano_conta_subtipo_id, " +
          "tipo:plano_contas_tipos(codigo, nome), subtipo:plano_contas_subtipos(nome), empresa:empresas(nome_fantasia, razao_social)",
      )
      .eq("tenant_id", tenantId)
      .eq("ativa", true)
      .or(`conta_bancaria_id.is.null,conta_bancaria_id.eq.${contaId}`),
  ]);
  for (const [nome, res] of [
    ["conta", contaRes],
    ["importacoes", importacoesRes],
    ["remessas", itensRes],
    ["regras", regrasRes],
  ] as const) {
    if (res.error) console.error(`[conciliacao.banco.${nome}]`, res.error.message);
  }

  const c = contaRes.data as {
    id: string;
    nome: string;
    banco: string;
    agencia: string | null;
    numero_conta: string | null;
    numero_conta_dv: string | null;
  } | null;
  const conta: DadosDaAbaBanco["conta"] = {
    id: contaId,
    nome: c?.nome ?? "Conta",
    banco: c?.banco ?? "",
    agencia: c?.agencia ?? null,
    numero: c?.numero_conta ? `${c.numero_conta}${c.numero_conta_dv ? `-${c.numero_conta_dv}` : ""}` : null,
    temNumero: c ? contaTemNumero(c) : false,
  };

  const importacoes: ImportacaoDoBanco[] = (
    (importacoesRes.data ?? []) as Array<{
      id: string;
      arquivo_nome: string;
      banco_id: string | null;
      conta_no_arquivo: string | null;
      periodo_inicio: string | null;
      periodo_fim: string | null;
      gerado_em: string | null;
      saldo_banco: string | number | null;
      saldo_em: string | null;
      qtd_movimentos: number;
      qtd_novos: number;
      created_at: string;
    }>
  ).map((i) => ({
    id: i.id,
    arquivo: i.arquivo_nome,
    bancoId: i.banco_id,
    conta: i.conta_no_arquivo,
    inicio: i.periodo_inicio,
    fim: i.periodo_fim,
    geradoEm: i.gerado_em,
    geradoDia: i.gerado_em ? diaIsoBr(i.gerado_em) : null,
    geradoHora: i.gerado_em
      ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(
          new Date(i.gerado_em),
        )
      : null,
    saldoBanco: i.saldo_banco === null ? null : Number(i.saldo_banco),
    saldoEm: i.saldo_em,
    movimentos: i.qtd_movimentos,
    novos: i.qtd_novos,
    importadaEm: i.created_at,
  }));
  const ultima = importacoes.length ? importacoes[importacoes.length - 1] : null;
  const periodos = importacoes.map((i) => ({ inicio: i.inicio, fim: i.fim, geradoDia: i.geradoDia }));

  // ---- As remessas: os itens por remessa, e de cada documento a remessa
  // mais nova em que ele está ----
  type ItemCru = {
    remessa_id: string;
    origem_tipo: string;
    origem_id: string;
    valor: string | number;
    remessa: { sequencial_arquivo: number; data_geracao: string } | null;
  };
  const porRemessa = new Map<string, RemessaDaConta & { geradaEm: string }>();
  for (const i of (itensRes.data ?? []) as unknown as ItemCru[]) {
    const r =
      porRemessa.get(i.remessa_id) ??
      {
        id: i.remessa_id,
        nome: `remessa nº ${i.remessa?.sequencial_arquivo ?? "—"}`,
        descricao: `Remessa Santander nº ${i.remessa?.sequencial_arquivo ?? "—"} · ${formatDiaBr(i.remessa?.data_geracao ?? null)}`,
        geradaEm: i.remessa?.data_geracao ?? "",
        itens: [],
      };
    r.itens.push({ origemTipo: i.origem_tipo, origemId: i.origem_id, valor: Number(i.valor) });
    porRemessa.set(i.remessa_id, r);
  }
  const remessaDoDocumento = new Map<string, { id: string; geradaEm: string }>();
  for (const r of porRemessa.values()) {
    for (const i of r.itens) {
      const atual = remessaDoDocumento.get(i.origemId);
      if (!atual || r.geradaEm > atual.geradaEm) remessaDoDocumento.set(i.origemId, { id: r.id, geradaEm: r.geradaEm });
    }
  }
  const remessas: RemessaDaConta[] = [...porRemessa.values()]
    .sort((a, b) => b.geradaEm.localeCompare(a.geradaEm))
    .map(({ geradaEm: _g, ...r }) => r);

  // ---- As regras: as da conta antes das de todas, e o padrão mais longo
  // antes do mais curto (o mais específico ganha) ----
  type RegraCrua = {
    id: string;
    conta_bancaria_id: string | null;
    padrao: string;
    usos: number;
    created_at: string;
    empresa_id: string;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    tipo: { codigo: string; nome: string } | null;
    subtipo: { nome: string } | null;
    empresa: { nome_fantasia: string | null; razao_social: string | null } | null;
  };
  const regras: RegraDaConta[] = ((regrasRes.data ?? []) as unknown as RegraCrua[])
    .map((g) => ({
      id: g.id,
      padrao: g.padrao,
      centro: [g.tipo ? `${g.tipo.codigo} · ${g.tipo.nome}` : null, g.subtipo?.nome].filter(Boolean).join(" · "),
      criadaEm: formatDiaBr(g.created_at),
      usos: g.usos,
      empresa: g.empresa?.nome_fantasia ?? g.empresa?.razao_social ?? "—",
      tipoId: g.plano_conta_tipo_id,
      subtipoId: g.plano_conta_subtipo_id,
      empresaId: g.empresa_id,
      contaId: g.conta_bancaria_id,
    }))
    .sort((a, b) => (a.contaId ? 0 : 1) - (b.contaId ? 0 : 1) || b.padrao.length - a.padrao.length);

  // ---- Rodada 2: os lançamentos sem linha, os ligados e o saldo ----
  const pendentes = linhasCruas.filter((l) => !l.conciliada && !l.ignorada_em);
  const conciliadas = linhasCruas.filter((l) => l.conciliada);
  // A janela dos lançamentos sem linha: os dias das linhas pendentes, com
  // os 3 dias do passo 1, e os dias que o extrato cobre (o "sem linha no
  // banco"). Sem importação nenhuma, não há o que ler.
  const dias = [
    ...pendentes.map((l) => l.data),
    ...periodos.flatMap((p) => [p.inicio, p.fim]).filter((d): d is string => !!d),
  ].sort();
  const janela = dias.length ? { de: somaDias(dias[0], -3), ate: somaDias(dias[dias.length - 1], 3) } : null;

  const corrigidas = conciliadas.filter((l) => l.conciliada_como === "correcao").map((l) => l.id);
  const [semLinhaCrus, ligadosRes, saldoNoFim, correcoesRes] = await Promise.all([
    janela
      ? todasAsPaginas<LancamentoCru>(
          (de, ate) =>
            supabase
              .from("lancamentos_financeiros")
              .select(SELECT_LANCAMENTO)
              .eq("tenant_id", tenantId)
              .eq("conta_bancaria_id", contaId)
              .is("extrato_linha_id", null)
              .gte("data_movimento", janela.de)
              .lte("data_movimento", janela.ate)
              .order("data_movimento", { ascending: true })
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(de, ate)
              .returns<LancamentoCru[]>(),
          "sem_linha",
        )
      : Promise.resolve([] as LancamentoCru[]),
    conciliadas.length
      ? supabase
          .from("lancamentos_financeiros")
          .select(SELECT_LANCAMENTO)
          .eq("tenant_id", tenantId)
          .in(
            "extrato_linha_id",
            conciliadas.map((l) => l.id),
          )
          .returns<LancamentoCru[]>()
      : Promise.resolve({ data: [] as LancamentoCru[], error: null }),
    ultima?.fim
      ? calcularSaldoAnterior(supabase, { tenantId, contaId, dataDe: somaDias(ultima.fim, 1) }).then((s) => s.saldoAnterior)
      : Promise.resolve(null),
    corrigidas.length
      ? supabase
          .from("baixa_correcoes")
          .select("extrato_linha_id, de, para, motivo")
          .eq("tenant_id", tenantId)
          .in("extrato_linha_id", corrigidas)
          .is("desfeita_em", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ligadosRes.error) console.error("[conciliacao.banco.ligados]", ligadosRes.error.message);
  if (correcoesRes.error) console.error("[conciliacao.banco.correcoes]", correcoesRes.error.message);
  const correcaoDaLinha = new Map(
    ((correcoesRes.data ?? []) as Array<{ extrato_linha_id: string; de: { total: number }; para: { total: number }; motivo: string }>).map(
      (c) => [c.extrato_linha_id, { de: Number(c.de.total), para: Number(c.para.total), motivo: c.motivo }],
    ),
  );

  // ---- Os lançamentos sem linha, agrupados como o banco os mostra ----
  const lancamentos = agruparComoNoBanco(semLinhaCrus, remessaDoDocumento);

  // ---- As linhas ----
  const ligadosPorLinha = new Map<string, LinhaDoBanco["ligados"]>();
  for (const l of ligadosRes.data ?? []) {
    if (!l.extrato_linha_id) continue;
    const lista = ligadosPorLinha.get(l.extrato_linha_id) ?? [];
    lista.push({ id: l.id, descricao: l.descricao, valor: assinado(l), origem: l.origem });
    ligadosPorLinha.set(l.extrato_linha_id, lista);
  }
  const linhas: LinhaDoBanco[] = linhasCruas.map((l) => ({
    id: l.id,
    digital: l.digital,
    data: l.data,
    valor: Number(l.valor),
    historico: l.historico,
    tipo: l.tipo,
    documento: l.documento,
    ordem: l.ordem,
    conciliada: l.conciliada,
    ignorada: l.ignorada_em ? { em: l.ignorada_em, motivo: l.motivo_ignorada } : null,
    resolvidaSozinha: l.resolvida_sozinha,
    semAuto: l.sem_auto,
    ligados: ligadosPorLinha.get(l.id) ?? [],
    conciliadaComo: l.conciliada_como,
    grupo: l.grupo,
    datasTrocadas: l.desfazer?.datas ?? [],
    correcao: correcaoDaLinha.get(l.id) ?? null,
    regraId: l.desfazer?.regra_id ?? null,
  }));

  return {
    conta,
    ultima,
    periodos,
    linhas,
    lancamentos,
    remessas,
    regras,
    saldoSistemaNoFim: saldoNoFim === null ? null : r2(saldoNoFim),
  };
}

/**
 * Os lançamentos sem linha do banco, juntados como o banco os mostra:
 *
 * - a baixa e os juros dela (`juros_de_lancamento_id`, decisão 196);
 * - as partes de uma guia de imposto (`imposto_a_pagar_id`, decisão 141);
 * - as baixas dos itens de uma mesma remessa no mesmo dia: o banco debita
 *   a remessa inteira numa linha só.
 *
 * Exportada para o teste.
 */
export function agruparComoNoBanco(
  crus: LancamentoCru[],
  remessaDoDocumento: Map<string, { id: string }>,
): LancamentoSemLinha[] {
  const ids = new Set(crus.map((l) => l.id));
  // A chave de cada lançamento: o grupo a que ele pertence.
  const chave = (l: LancamentoCru): string => {
    if (l.origem === "juros_baixa" && l.juros_de_lancamento_id && ids.has(l.juros_de_lancamento_id)) {
      const baixa = crus.find((x) => x.id === l.juros_de_lancamento_id);
      return baixa ? chave(baixa) : `l:${l.id}`;
    }
    if (l.origem === "imposto_baixa" && l.imposto_a_pagar_id) return `g:${l.imposto_a_pagar_id}:${l.data_movimento}`;
    const doc = l.pedido_compra_parcela_id ?? l.conta_avulsa_id;
    const remessa = doc && (l.origem === "pp_baixa" || l.origem === "avulsa_baixa") ? remessaDoDocumento.get(doc) : undefined;
    if (remessa) return `r:${remessa.id}:${l.data_movimento}`;
    return `l:${l.id}`;
  };
  const grupos = new Map<string, LancamentoCru[]>();
  for (const l of crus) {
    const k = chave(l);
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const saida: LancamentoSemLinha[] = [];
  for (const [k, membros] of grupos) {
    const base = membros.find((m) => m.origem !== "juros_baixa") ?? membros[0];
    const juros = r2(membros.filter((m) => m.origem === "juros_baixa").reduce((s, m) => s + Number(m.valor), 0));
    const remessa = k.startsWith("r:") && membros.length > 1;
    const principais = membros.filter((m) => m.origem !== "juros_baixa");
    saida.push({
      id: base.id,
      ids: membros.map((m) => m.id),
      data: base.data_movimento,
      valor: r2(membros.reduce((s, m) => s + assinado(m), 0)),
      juros: juros || undefined,
      descricao: remessa ? `${membros.length} baixas da remessa, no mesmo dia` : base.descricao,
      origem: base.origem,
      fornecedor: remessa ? null : base.fornecedores?.razao_social ?? base.fornecedores?.nome ?? null,
      forma: base.forma_pagamento,
      corrigivel:
        principais.length === 1 &&
        (base.origem === "avulsa_baixa" || base.origem === "titulo_baixa" || (base.origem === "pp_baixa" && !!base.pedido_compra_parcela_id)),
      cancelamento: principais.length === 1 ? cancelamentoDe(base) : null,
    });
  }
  return saida.sort((a, b) => a.data.localeCompare(b.data));
}
