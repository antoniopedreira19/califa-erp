/**
 * Os dados da aba Títulos da conciliação (pedido do Tiago em 02/10/2026):
 * tudo que aguarda baixa no financeiro, em Contas a Pagar e em Contas a
 * Receber — igual para todas as contas, porque a conta só se define na
 * baixa.
 *
 * Os títulos são lidos do MESMO jeito que as listas reais os leem: o
 * `select` de cada consulta e a montagem vêm de
 * `contas-a-pagar/dados-dos-titulos.ts` e `contas-a-receber/dados-dos-titulos.ts`.
 * O recorte é o do status padrão de cada lista:
 *
 * - **a pagar**: o que Títulos a Pagar mostra em "A pagar" (parciais
 *   inclusive) — os não cartão. O item no cartão espera a fatura, e a
 *   fatura fechada já é um título daqui;
 * - **a receber**: o que Títulos a Receber mostra como "Em aberto"
 *   (inadimplentes e parciais inclusive);
 * - **transferências** "A transferir" (decisão 195): na planilha nova elas
 *   entram, com o chip Transferências, porque mexem no saldo previsto das
 *   duas contas. A baixa delas é o "Registrar" de Contas a Receber.
 *
 * Diferenças de propósito em relação às páginas, todas só de recorte:
 * - sem o filtro de empresa do cabeçalho de Contas a Pagar — a conciliação
 *   não tem esse filtro, e a conta não pertence a empresa (decisão 064);
 * - o que já está pago nem é lido quando dá para cortar na consulta (PP
 *   fora de aprovada/paga, avulsa baixada, estorno de verba pago, fatura
 *   paga), porque daqui só sai o que está em aberto.
 *
 * Impostos a Pagar (módulo fiscal, entrega 2): os impostos em aberto entram
 * também, lidos pela MESMA leitura da aba Impostos a Pagar da seção Fiscal
 * (`fiscal/impostos/dados.ts`), e a baixa é a mesma de lá.
 *
 * Carregado SÓ quando a aba Títulos está aberta: o Extrato não paga nada.
 */

import type { createClient } from "@/lib/supabase/server";
import type {
  BandeiraCartao,
  ContaBancaria,
  PlanoContaSubtipo,
  PlanoContaTipo,
} from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import type { UltimaRetencao } from "@/components/financeiro/valor-da-baixa";
import { COLUNAS_DE_PAGAMENTO } from "@/lib/data/foto-pagamento-da-pp";
import { SELECT_ESTORNO_DE_BAIXA } from "@/lib/data/estornos-de-baixa";
import { mapearUltimasRetencoes } from "@/lib/data/baixas-do-documento";
import {
  ORIGENS_DA_BAIXA_A_PAGAR,
  ORIGENS_DO_ESTORNO_A_PAGAR,
  SELECT_AVULSA_A_PAGAR,
  SELECT_BAIXA_A_PAGAR,
  SELECT_DESEMBOLSO_DO_TITULO,
  SELECT_DEVOLUCAO_DE_VERBA,
  SELECT_FATURA_DO_TITULO,
  SELECT_ITEM_EM_REMESSA,
  SELECT_PP_DO_FINANCEIRO,
  mapearPPsDoFinanceiro,
  montarTitulosAPagar,
} from "../contas-a-pagar/dados-dos-titulos";
import type { TituloRow as TituloAPagar } from "../contas-a-pagar/titulos-pagar-list";
import {
  ORIGENS_DO_ESTORNO_A_RECEBER,
  SELECT_AVULSA_A_RECEBER,
  SELECT_BAIXA_DA_AVULSA_A_RECEBER,
  SELECT_BAIXA_DA_NOTA,
  SELECT_TITULO_A_RECEBER,
  SELECT_TRANSFERENCIA,
  consultarJobsDasNotas,
  listaDeClientes,
  listaDeFornecedores,
  montarTitulosAReceber,
  parcelasDasNotas,
} from "../contas-a-receber/dados-dos-titulos";
import type { TituloRow as TituloAReceber } from "../contas-a-receber/titulos-list";
import { lerImpostos, type ImpostoDaLista } from "../fiscal/impostos/dados";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { carregarFaturasNaBaixa } from "@/lib/data/faturas-na-baixa";
import type { FaturaDoCartaoNaBaixa } from "@/lib/financeiro/fatura-do-cartao";
import { carregarExtrasDaPlanilha, type ExtrasDaPlanilha } from "@/lib/data/planilha-de-titulos";
import { idsDaPlanilha } from "./linhas-da-aba";

export interface DadosDaAbaTitulos {
  /** O dia de hoje em Brasília: o vencido, o saldo previsto, os quadros. */
  hoje: string;
  /** Os títulos a pagar em aberto (não cartão), no tipo da lista real. */
  aPagar: TituloAPagar[];
  /** Os títulos a receber em aberto e as transferências a transferir, no
   *  tipo da lista real. */
  aReceber: TituloAReceber[];
  /** Regional, retenção da aprovação, centro da nota e itens da fatura
   *  (decisão 195). */
  extras: ExtrasDaPlanilha;
  /** Os impostos a pagar em aberto (módulo fiscal), como a aba Impostos a
   *  Pagar os lê. */
  impostos: ImpostoDaLista[];
  /** PJ (empresa contábil) → nome: o aviso da guia paga por conta de outra
   *  PJ. */
  nomesDasPJs: Record<string, string>;
  /** O tenant: o caminho do comprovante da guia no bucket `impostos`. */
  tenantId: string;
  /** Empresa → nome curto, para a coluna Empresa. */
  empresas: Record<string, string>;
  /** O que as duas baixas reais pedem — as mesmas listas que as páginas de
   *  Contas a Pagar e Contas a Receber passam a elas. */
  contas: ContaBancaria[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  cartoes: CartaoOption[];
  /** As faturas recentes dos cartões, para o campo Fatura (decisão 197). */
  faturasNaBaixa: FaturaDoCartaoNaBaixa[];
  ultimasRetencoesPagar: Record<string, UltimaRetencao>;
  ultimasRetencoesReceber: Record<string, UltimaRetencao>;
  /** Fornecedor ou cliente → CPF/CNPJ só com os dígitos: o motor da aba
   *  Banco reconhece o CNPJ no histórico do banco (decisão 199). */
  documentoDaParte: Record<string, string>;
}

export async function carregarTitulosDaConciliacao(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<DadosDaAbaTitulos> {
  // O "hoje" das avulsas a receber sem data, como a página de Contas a
  // Receber o calcula.
  const hoje = hojeEmSaoPauloIso();

  // Todas as leituras em paralelo — regra de performance do projeto.
  const [
    ppsRes,
    fornecedoresRes,
    avulsasPagarRes,
    baixasPagarRes,
    estornosRes,
    desembolsosRes,
    devolucoesRes,
    faturasRes,
    remessasItensRes,
    titulosReceberRes,
    baixasNotasRes,
    avulsasReceberRes,
    baixasAvulsasReceberRes,
    clientesRes,
    jobsRes,
    ultimasRetencoesRes,
    contasRes,
    tiposRes,
    subtiposRes,
    cartoesRes,
    empresasRes,
    impostosLidos,
    transferenciasRes,
    faturasNaBaixa,
  ] = await Promise.all([
    // ---- A pagar ----
    // Só aprovada e paga viram título; a paga entra porque uma parcela
    // dela pode ter voltado a aberto (baixa cancelada).
    supabase
      .from("pedidos_compra")
      .select(SELECT_PP_DO_FINANCEIRO)
      .eq("tenant_id", tenantId)
      .in("status", ["aprovada", "pago"])
      .not("enviada_financeiro_em", "is", null),
    // Fornecedores ativos: o nome na lista a receber e o asterisco da 067.
    supabase
      .from("fornecedores")
      .select(`id, nome, razao_social, cpf_cnpj, ${COLUNAS_DE_PAGAMENTO}`)
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("contas_avulsas")
      .select(SELECT_AVULSA_A_PAGAR)
      .eq("tenant_id", tenantId)
      .is("tipo_entrada", null)
      .neq("status", "baixada"),
    supabase
      .from("lancamentos_financeiros")
      .select(SELECT_BAIXA_A_PAGAR)
      .eq("tenant_id", tenantId)
      .in("origem", ORIGENS_DA_BAIXA_A_PAGAR)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true }),
    // Os estornos dos dois lados numa leitura só: o agrupamento é por
    // baixa, e cada montagem procura só as baixas dela.
    supabase
      .from("lancamentos_financeiros")
      .select(SELECT_ESTORNO_DE_BAIXA)
      .eq("tenant_id", tenantId)
      .in("origem", [...ORIGENS_DO_ESTORNO_A_PAGAR, ...ORIGENS_DO_ESTORNO_A_RECEBER])
      .not("estorno_de_lancamento_id", "is", null),
    supabase
      .from("desembolsos")
      .select(SELECT_DESEMBOLSO_DO_TITULO)
      .eq("tenant_id", tenantId)
      .in("status", ["aprovada", "pago"]),
    supabase
      .from("pp_verba_devolucoes")
      .select(SELECT_DEVOLUCAO_DE_VERBA)
      .eq("tenant_id", tenantId)
      .is("pago_em", null),
    // A paga já não espera baixa.
    supabase
      .from("faturas_cartao")
      .select(SELECT_FATURA_DO_TITULO)
      .eq("tenant_id", tenantId)
      .eq("status", "fechada"),
    supabase
      .from("cnab_remessas_itens")
      .select(SELECT_ITEM_EM_REMESSA)
      .eq("tenant_id", tenantId)
      .neq("remessa.status", "cancelado"),
    // ---- A receber ----
    // Todos os títulos: a contagem de parcelas de cada nota (o "1/3")
    // conta também os recebidos.
    supabase
      .from("titulos_receber")
      .select(SELECT_TITULO_A_RECEBER)
      .eq("tenant_id", tenantId)
      .order("data_vencimento", { ascending: true }),
    supabase
      .from("lancamentos_financeiros")
      .select(SELECT_BAIXA_DA_NOTA)
      .eq("tenant_id", tenantId)
      .eq("origem", "titulo_baixa")
      .not("titulo_receber_id", "is", null),
    supabase
      .from("contas_avulsas")
      .select(SELECT_AVULSA_A_RECEBER)
      .eq("tenant_id", tenantId)
      .not("tipo_entrada", "is", null)
      .neq("status", "baixada")
      .order("data_pagamento", { ascending: true }),
    supabase
      .from("lancamentos_financeiros")
      .select(SELECT_BAIXA_DA_AVULSA_A_RECEBER)
      .eq("tenant_id", tenantId)
      .eq("origem", "avulsa_baixa")
      .eq("natureza", "entrada")
      .not("conta_avulsa_id", "is", null),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social, cnpj")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    consultarJobsDasNotas(supabase, tenantId),
    // ---- As duas baixas ----
    // As alíquotas da última retenção de cada fornecedor (saída) e de cada
    // cliente (entrada), para o "Repetir as alíquotas" (decisão 125).
    supabase
      .from("vw_retencao_mais_recente")
      .select("natureza, parte_id, referencia, data_movimento, aliquotas")
      .eq("tenant_id", tenantId),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .neq("tipo", "cartao_credito")
      .returns<ContaBancaria[]>(),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("cartoes_credito")
      .select("id, nome, banco, bandeira, ultimos_4_digitos, dia_vencimento_fatura, dia_fechamento_fatura")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("nome"),
    // Todas, ativas ou não: o título antigo de uma empresa desativada
    // continua com o nome.
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", tenantId),
    // ---- Impostos a pagar em aberto (módulo fiscal) ----
    lerImpostos(supabase, tenantId, { soEmAberto: true }),
    // ---- Transferências a transferir (decisão 195) ----
    supabase
      .from("transferencias_contas")
      .select(SELECT_TRANSFERENCIA)
      .eq("tenant_id", tenantId)
      .eq("status", "a_transferir")
      .order("data_prevista", { ascending: true }),
    // ---- As faturas do campo Fatura da baixa no cartão (decisão 197) ----
    carregarFaturasNaBaixa(supabase, tenantId, hoje),
  ]);

  // ⚠️ O erro é LIDO: uma consulta quebrada faria a aba dizer "nenhum
  // título", que é indistinguível de não haver título.
  for (const [nome, res] of [
    ["pps", ppsRes],
    ["fornecedores", fornecedoresRes],
    ["avulsas_pagar", avulsasPagarRes],
    ["baixas_pagar", baixasPagarRes],
    ["estornos", estornosRes],
    ["desembolsos", desembolsosRes],
    ["devolucoes", devolucoesRes],
    ["faturas", faturasRes],
    ["remessas_itens", remessasItensRes],
    ["titulos_receber", titulosReceberRes],
    ["baixas_notas", baixasNotasRes],
    ["avulsas_receber", avulsasReceberRes],
    ["baixas_avulsas_receber", baixasAvulsasReceberRes],
    ["clientes", clientesRes],
    ["jobs", jobsRes],
    ["ultimas_retencoes", ultimasRetencoesRes],
    ["contas", contasRes],
    ["tipos", tiposRes],
    ["subtipos", subtiposRes],
    ["cartoes", cartoesRes],
    ["empresas", empresasRes],
    ["transferencias", transferenciasRes],
  ] as const) {
    if (res.error) console.error(`[conciliacao.titulos.${nome}]`, res.error.message);
  }

  const contas = contasRes.data ?? [];
  const tipos = tiposRes.data ?? [];

  // ---- A pagar: o recorte "A pagar" de Títulos a Pagar ----
  const aPagar = montarTitulosAPagar({
    pps: mapearPPsDoFinanceiro(ppsRes.data, fornecedoresRes.data),
    avulsas: avulsasPagarRes.data,
    baixas: baixasPagarRes.data,
    estornos: estornosRes.data,
    desembolsos: desembolsosRes.data,
    devolucoes: devolucoesRes.data,
    faturas: faturasRes.data,
    remessasItens: remessasItensRes.data,
    tipos,
  }).filter((t) => t.forma_pagamento !== "cartao_credito" && t.status === "a_pagar");

  // ---- A receber: o "Em aberto" de Títulos a Receber ----
  const aReceber = montarTitulosAReceber({
    titulos: titulosReceberRes.data,
    parcelasPorNota: parcelasDasNotas(titulosReceberRes.data),
    baixas: baixasNotasRes.data,
    estornos: estornosRes.data,
    avulsas: avulsasReceberRes.data,
    baixasAvulsas: baixasAvulsasReceberRes.data,
    transferencias: transferenciasRes.data,
    contas,
    clientes: listaDeClientes(clientesRes.data),
    fornecedores: listaDeFornecedores(fornecedoresRes.data),
    jobs: (jobsRes.data ?? []) as Array<{ id: string; codigo: string; nome: string }>,
    apenasVencidas: false,
    hoje,
  }).filter((t) => t.status === "em_aberto");

  // O que a planilha mostra e as listas não liam: uma leitura por fonte,
  // só dos títulos que ficaram.
  const extras = await carregarExtrasDaPlanilha(supabase, tenantId, idsDaPlanilha(aPagar, aReceber));

  const retencoes = (ultimasRetencoesRes.data ?? []) as Array<{ natureza: string }>;

  const empresas: Record<string, string> = {};
  for (const e of (empresasRes.data ?? []) as Array<{
    id: string;
    razao_social: string | null;
    nome_fantasia: string | null;
  }>) {
    empresas[e.id] = e.nome_fantasia ?? e.razao_social ?? "—";
  }

  const documentoDaParte: Record<string, string> = {};
  for (const p of [
    ...((fornecedoresRes.data ?? []) as Array<{ id: string; cpf_cnpj: string | null }>).map((f) => [f.id, f.cpf_cnpj] as const),
    ...((clientesRes.data ?? []) as Array<{ id: string; cnpj: string | null }>).map((c) => [c.id, c.cnpj] as const),
  ]) {
    const digitos = (p[1] ?? "").replace(/\D/g, "");
    if (digitos) documentoDaParte[p[0]] = digitos;
  }

  const cartoes: CartaoOption[] = (
    (cartoesRes.data ?? []) as Array<{
      id: string;
      nome: string;
      banco: string;
      bandeira: string;
      ultimos_4_digitos: string;
      dia_vencimento_fatura: number;
      dia_fechamento_fatura: number | null;
    }>
  ).map((c) => ({
    id: c.id,
    nome: c.nome,
    banco: c.banco,
    // O PostgREST devolve o enum como string — a coluna é do tipo
    // `bandeira_cartao`, que é `BandeiraCartao` no TS.
    bandeira: c.bandeira as BandeiraCartao,
    ultimos_4_digitos: c.ultimos_4_digitos,
    dia_vencimento_fatura: c.dia_vencimento_fatura,
    dia_fechamento_fatura: c.dia_fechamento_fatura ?? null,
  }));

  return {
    hoje,
    aPagar,
    aReceber,
    extras,
    impostos: impostosLidos.impostos,
    nomesDasPJs: Object.fromEntries(impostosLidos.pjs.map((p) => [p.id, p.nome])),
    tenantId,
    empresas,
    contas,
    tipos,
    subtipos: subtiposRes.data ?? [],
    cartoes,
    faturasNaBaixa,
    ultimasRetencoesPagar: mapearUltimasRetencoes(
      retencoes.filter((r) => r.natureza === "saida"),
    ),
    ultimasRetencoesReceber: mapearUltimasRetencoes(
      retencoes.filter((r) => r.natureza === "entrada"),
    ),
    documentoDaParte,
  };
}
