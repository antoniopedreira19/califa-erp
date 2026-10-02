/**
 * Os títulos de Contas a Receber, montados num lugar só (02/10/2026).
 *
 * Até aqui as consultas e a montagem moravam dentro de `page.tsx`. A aba
 * Títulos da conciliação (pedido do Tiago em 02/10/2026) mostra os MESMOS
 * títulos em aberto, e por isso elas saíram da página sem mudar nada: o
 * `select` de cada consulta e as regras de cada origem (nota, recebimento
 * avulso, rendimento e transferência) são os mesmos para a lista de
 * Títulos a Receber e para a aba da conciliação. Mudou aqui, muda nas duas.
 *
 * Módulo do servidor, sem "use client". O tipo `TituloRow` continua na
 * lista, que é de quem o desenha.
 */

import { agruparEstornosPorBaixa } from "@/lib/data/estornos-de-baixa";
import {
  SELECT_BAIXA_DO_DOCUMENTO,
  agruparBaixasPorDocumento,
  totalBaixado,
} from "@/lib/data/baixas-do-documento";
import type { createClient } from "@/lib/supabase/server";
import type { ContaBancaria, TituloReceberStatus } from "@/lib/types";
import type { TituloRow } from "./titulos-list";
import { formatarCnpj } from "@/lib/fiscal/cadastro";

// ---------------------------------------------------------------------------
// As consultas — o `select` de cada uma. Os filtros ficam com quem consulta:
// a página tem o atalho "vencidas" da Home; a conciliação, nenhum.
// ---------------------------------------------------------------------------

/** `titulos_receber`, com a nota (e os itens dela) de cada um. */
export const SELECT_TITULO_A_RECEBER = `
          id, numero_parcela, valor, data_vencimento, status,
          data_previsao_recebimento, data_previsao_recebimento_primeira,
          inadimplente_desde, pago_em, empresa_id, faturamento_id,
          faturamento:faturamentos!inner(
            id, numero_nf, data_emissao, descricao, status, origem_tipo,
            cliente_id, fornecedor_id,
            cliente:clientes(id, nome_fantasia, razao_social),
            fornecedor:fornecedores(id, nome, razao_social),
            itens:faturamento_itens(origem_tipo, origem_id, envio_parcela_id, valor),
            estabelecimento:fiscal_estabelecimentos(nome, cnpj)
          )
`;

/** `lancamentos_financeiros` de origem `titulo_baixa`: as baixas das notas. */
export const SELECT_BAIXA_DA_NOTA = `titulo_receber_id, ${SELECT_BAIXA_DO_DOCUMENTO}`;

/** As origens dos estornos das baixas a receber (decisão 120). */
export const ORIGENS_DO_ESTORNO_A_RECEBER = ["titulo_estorno", "avulsa_estorno"];

/** `contas_avulsas` com `tipo_entrada`: recebimento avulso e rendimento
 *  (decisão 124). */
export const SELECT_AVULSA_A_RECEBER = `
        id, codigo, descricao, valor, status, tipo_entrada, empresa_id,
        data_prevista_pagamento, data_pagamento, pago_em,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        conta_bancaria_prevista_id, competencia, cliente_id, fornecedor_id
`;

/** `lancamentos_financeiros` de origem `avulsa_baixa` e natureza entrada:
 *  as baixas do recebimento avulso e do rendimento. */
export const SELECT_BAIXA_DA_AVULSA_A_RECEBER = `conta_avulsa_id, ${SELECT_BAIXA_DO_DOCUMENTO}`;

/** `transferencias_contas` (decisão 124). Duas FKs para contas_bancarias:
 *  o embed precisa dizer qual é qual. */
export const SELECT_TRANSFERENCIA = `
        id, codigo, valor, data_prevista, descricao, status, transferida_em,
        origem:contas_bancarias!conta_origem_id(nome, banco),
        destino:contas_bancarias!conta_destino_id(nome, banco)
`;

/**
 * Códigos dos jobs cobertos pelas notas. Limite alto o bastante para o
 * histórico e baixo o bastante para não virar varredura. Ordem de criação,
 * e não a do código: desde a decisão 114 o código começa pela sigla do
 * cliente, e o texto não diz mais a ordem.
 */
export function consultarJobsDasNotas(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
) {
  return supabase
    .from("jobs")
    .select("id, codigo, nome")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);
}

// ---------------------------------------------------------------------------
// Nomes e parcelas
// ---------------------------------------------------------------------------

/** Clientes ativos (`id, nome_fantasia, razao_social`) → id e nome. */
export function listaDeClientes(data: unknown[] | null): Array<{ id: string; nome: string }> {
  return ((data ?? []) as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }>).map(
    (c) => ({
      id: c.id,
      nome: c.razao_social ?? c.nome_fantasia ?? "",
    }),
  );
}

/** Fornecedores ativos (`id, nome, razao_social`) → id e nome. */
export function listaDeFornecedores(data: unknown[] | null): Array<{ id: string; nome: string }> {
  return ((data ?? []) as Array<{ id: string; nome: string; razao_social: string | null }>).map(
    (f) => ({
      id: f.id,
      nome: f.razao_social ?? f.nome,
    }),
  );
}

export type ParcelasPorNota = Map<
  string,
  {
    qtd: number;
    primeiroVenc: string | null;
    parcelas: Array<{ numero: number; valor: number; data_vencimento: string }>;
  }
>;

/** As parcelas de cada nota, a partir dos títulos (`SELECT_TITULO_A_RECEBER`). */
export function parcelasDasNotas(titulos: unknown[] | null): ParcelasPorNota {
  // Quantas parcelas de recebimento cada nota tem, e qual a 1ª a vencer —
  // as duas colunas que a linha verde mostra.
  // Guardamos as parcelas em si, e não só a contagem: o formulário em
  // modo leitura precisa listar valor e vencimento de cada uma
  // (18/08/2026 — antes ele inventava uma parcela com o total da nota).
  const parcelasPorNota: ParcelasPorNota = new Map<
    string,
    {
      qtd: number;
      primeiroVenc: string | null;
      parcelas: Array<{ numero: number; valor: number; data_vencimento: string }>;
    }
  >();
  for (const t of (titulos ?? []) as unknown as Array<{
    faturamento_id: string;
    numero_parcela: number;
    valor: string | number;
    data_vencimento: string;
    status: TituloReceberStatus;
  }>) {
    if (t.status === "cancelado") continue;
    const atual =
      parcelasPorNota.get(t.faturamento_id) ??
      { qtd: 0, primeiroVenc: null, parcelas: [] };
    atual.qtd += 1;
    if (!atual.primeiroVenc || t.data_vencimento < atual.primeiroVenc) {
      atual.primeiroVenc = t.data_vencimento;
    }
    atual.parcelas.push({
      numero: t.numero_parcela,
      valor: Number(t.valor),
      data_vencimento: t.data_vencimento,
    });
    parcelasPorNota.set(t.faturamento_id, atual);
  }
  for (const p of parcelasPorNota.values()) {
    p.parcelas.sort((a, b) => a.numero - b.numero);
  }
  return parcelasPorNota;
}

// ---------------------------------------------------------------------------
// Os títulos
// ---------------------------------------------------------------------------

/**
 * Os títulos a receber de todas as origens e de todos os status, por
 * vencimento — quem chama recorta (a lista filtra por status; a conciliação
 * fica com os em aberto).
 */
export function montarTitulosAReceber(e: {
  /** `titulos_receber` com `SELECT_TITULO_A_RECEBER`. */
  titulos: unknown[] | null;
  /** `parcelasDasNotas(titulos)`. */
  parcelasPorNota: ParcelasPorNota;
  /** Baixas com `SELECT_BAIXA_DA_NOTA`. */
  baixas: unknown[] | null;
  /** Estornos com `SELECT_ESTORNO_DE_BAIXA`, de `ORIGENS_DO_ESTORNO_A_RECEBER`. */
  estornos: unknown[] | null;
  /** `contas_avulsas` com `SELECT_AVULSA_A_RECEBER`. */
  avulsas: unknown[] | null;
  /** Baixas com `SELECT_BAIXA_DA_AVULSA_A_RECEBER`. */
  baixasAvulsas: unknown[] | null;
  /** `transferencias_contas` com `SELECT_TRANSFERENCIA`. */
  transferencias: unknown[] | null;
  /** Contas ativas: o nome da conta de aplicação do rendimento. */
  contas: ContaBancaria[];
  clientes: Array<{ id: string; nome: string }>;
  fornecedores: Array<{ id: string; nome: string }>;
  jobs: Array<{ id: string; codigo: string; nome: string }>;
  /** O atalho "vencidas" da Home. */
  apenasVencidas: boolean;
  /** Hoje, AAAA-MM-DD. */
  hoje: string;
}): TituloRow[] {
  const nomeCliente = new Map(e.clientes.map((c) => [c.id, c.nome]));
  const nomeFornecedor = new Map(e.fornecedores.map((f) => [f.id, f.nome]));
  const jobPorId = new Map(e.jobs.map((j) => [j.id, j]));

  // --- Aba Títulos a Receber ----------------------------------------------

  // Centro de custo e subtipo saem SEPARADOS (08/09/2026). Concatenados,
  // viravam "01 · Geral (provisório)" — o código do TIPO colado no nome do
  // SUBTIPO, com "Receita" fora da tela. Quem conferia a baixa lia só o
  // subtipo e achava que era o centro de custo inteiro.
  const estornosPorBaixa = agruparEstornosPorBaixa(e.estornos);
  const baixasPorTitulo = agruparBaixasPorDocumento(
    e.baixas,
    "titulo_receber_id",
    estornosPorBaixa,
  );

  const titulosRows: TituloRow[] = ((e.titulos ?? []) as unknown as Array<{
    id: string;
    numero_parcela: number;
    valor: string | number;
    data_vencimento: string;
    data_previsao_recebimento: string | null;
    data_previsao_recebimento_primeira: string | null;
    inadimplente_desde: string | null;
    status: TituloReceberStatus;
    pago_em: string | null;
    empresa_id: string;
    faturamento_id: string;
    faturamento: {
      numero_nf: string;
      data_emissao: string;
      descricao: string;
      status: "emitido" | "cancelado";
      origem_tipo: "job" | "bv" | "avulso";
      cliente_id: string | null;
      fornecedor_id: string | null;
      cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
      fornecedor: { nome: string | null; razao_social: string | null } | null;
      /** O CNPJ que emitiu a nota (módulo fiscal); nulo nas notas de antes. */
      estabelecimento: { nome: string; cnpj: string | null } | null;
      itens: Array<{
        origem_tipo: "job" | "bv" | "avulso" | "save";
        origem_id: string | null;
        envio_parcela_id: string | null;
        valor: string | number;
      }>;
    };
  }>).map((r) => {
    const baixas = baixasPorTitulo.get(r.id) ?? [];
    const itens = r.faturamento.itens ?? [];
    // Um job por vez, na ordem em que aparece nos itens. O Set é o que
    // impede o job de sair duas vezes quando a nota tem item de save ou
    // dois faturamentos parciais dele.
    const vistos = new Set<string>();
    const jobsDaNota: Array<{ id: string; codigo: string; nome: string }> = [];
    for (const i of itens) {
      if (!i.origem_id || vistos.has(i.origem_id)) continue;
      const job = jobPorId.get(i.origem_id);
      if (!job) continue;
      vistos.add(i.origem_id);
      jobsDaNota.push(job);
    }
    return {
      id: r.id,
      numero_parcela: r.numero_parcela,
      total_parcelas: e.parcelasPorNota.get(r.faturamento_id)?.qtd ?? 1,
      valor: Number(r.valor),
      data_vencimento: r.data_vencimento,
      data_previsao_recebimento: r.data_previsao_recebimento ?? r.data_vencimento,
      data_previsao_recebimento_primeira:
        r.data_previsao_recebimento_primeira ?? r.data_vencimento,
      status: r.status,
      pago_em: r.pago_em,
      empresa_id: r.empresa_id,
      faturamento_id: r.faturamento_id,
      fat_numero_nf: r.faturamento.numero_nf,
      fat_data_emissao: r.faturamento.data_emissao,
      fat_descricao: r.faturamento.descricao,
      fat_cnpj_emissor: r.faturamento.estabelecimento
        ? `${r.faturamento.estabelecimento.nome} · ${formatarCnpj(r.faturamento.estabelecimento.cnpj)}`
        : null,
      contraparte_nome:
        r.faturamento.fornecedor?.razao_social ??
        r.faturamento.fornecedor?.nome ??
        r.faturamento.cliente?.razao_social ??
        r.faturamento.cliente?.nome_fantasia ??
        "—",
      // Os jobs DISTINTOS da nota, uma vez cada. A nota com save e a com
      // dois faturamentos parciais têm mais de um item do MESMO job, e
      // listá-lo duas vezes lia como erro na tela (31/08/2026). A parte que
      // virou crédito do cliente aparece no botão `i`, em "Composição do
      // valor" — não mais nesta coluna.
      jobs_cobertos: jobsDaNota.length
        ? jobsDaNota.map((j) => `${j.codigo} ${j.nome}`)
        : [
            itens.length === 0 || itens[0]?.origem_tipo === "avulso"
              ? `Avulso · ${r.faturamento.descricao}`
              : `BV · ${r.faturamento.descricao}`,
          ],
      jobs: jobsDaNota.map((j) => ({ job_id: j.id, codigo: j.codigo })),
      inadimplente_desde: r.inadimplente_desde ?? null,
      baixas,
      baixado: totalBaixado(baixas),
      // Quem paga a nota: o cliente, ou o fornecedor na nota de BV.
      parte_id: r.faturamento.cliente_id ?? r.faturamento.fornecedor_id ?? null,
      origem: "nf" as const,
      conta_avulsa_id: null,
      codigo_avulsa: null,
      plano_conta_tipo_id: null,
      plano_conta_subtipo_id: null,
      conta_prevista_id: null,
    };
  });

  // Recebimento avulso e rendimento (decisão 124), na mesma lista. Não têm
  // nota: a coluna Nota fiscal mostra o código AV, e a de jobs, a
  // descrição — eles não se vinculam a job.
  const baixasPorAvulsa = agruparBaixasPorDocumento(
    e.baixasAvulsas,
    "conta_avulsa_id",
    estornosPorBaixa,
  );
  const contaPorId = new Map(e.contas.map((c) => [c.id, c]));
  const todasAvulsasReceber = (e.avulsas ?? []) as unknown as Array<{
    id: string;
    codigo: string | null;
    descricao: string;
    valor: string | number;
    status: "aprovada" | "baixada";
    tipo_entrada: "recebimento_avulso" | "rendimento";
    empresa_id: string;
    data_prevista_pagamento: string | null;
    data_pagamento: string | null;
    pago_em: string | null;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
    conta_bancaria_prevista_id: string | null;
    competencia: string | null;
    cliente_id: string | null;
    fornecedor_id: string | null;
  }>;
  const avulsasReceber = todasAvulsasReceber.filter(
    // O atalho "vencidas" da Home vale para eles também.
    (a) =>
      !e.apenasVencidas ||
      (a.status === "aprovada" && (a.data_pagamento ?? a.data_prevista_pagamento ?? "") < e.hoje),
  );
  const linhasAvulsas: TituloRow[] = avulsasReceber.map((a) => {
    const baixas = baixasPorAvulsa.get(a.id) ?? [];
    const data = a.data_pagamento ?? a.data_prevista_pagamento ?? e.hoje;
    const contaPrevista = a.conta_bancaria_prevista_id
      ? contaPorId.get(a.conta_bancaria_prevista_id)
      : undefined;
    return {
      id: a.id,
      numero_parcela: 1,
      total_parcelas: 1,
      valor: Number(a.valor),
      data_vencimento: a.data_prevista_pagamento ?? data,
      data_previsao_recebimento: data,
      data_previsao_recebimento_primeira: data,
      status: a.status === "baixada" ? "pago" : "em_aberto",
      pago_em: a.pago_em,
      empresa_id: a.empresa_id,
      faturamento_id: "",
      fat_numero_nf: "",
      fat_data_emissao: "",
      fat_descricao: a.descricao,
      fat_cnpj_emissor: null,
      contraparte_nome:
        (a.cliente_id ? nomeCliente.get(a.cliente_id) : undefined) ??
        (a.fornecedor_id ? nomeFornecedor.get(a.fornecedor_id) : undefined) ??
        (contaPrevista ? `${contaPrevista.nome} · ${contaPrevista.banco}` : "—"),
      jobs_cobertos: [a.descricao],
      jobs: [],
      inadimplente_desde: null,
      baixas,
      baixado: totalBaixado(baixas),
      parte_id: a.cliente_id ?? a.fornecedor_id ?? null,
      origem: a.tipo_entrada,
      conta_avulsa_id: a.id,
      codigo_avulsa: a.codigo,
      plano_conta_tipo_id: a.plano_conta_tipo_id,
      plano_conta_subtipo_id: a.plano_conta_subtipo_id,
      conta_prevista_id: a.conta_bancaria_prevista_id,
    };
  });
  // A transferência é título (D16), mas sem empresa, sem plano e sem
  // estorno: o olho só mostra as duas contas e o cancelamento.
  const linhasTransferencias: TituloRow[] = ((e.transferencias ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    valor: string | number;
    data_prevista: string;
    descricao: string | null;
    status: "a_transferir" | "transferida";
    transferida_em: string | null;
    origem: { nome: string; banco: string } | null;
    destino: { nome: string; banco: string } | null;
  }>)
    .filter(
      (t) =>
        !e.apenasVencidas ||
        (t.status === "a_transferir" && t.data_prevista < e.hoje),
    )
    .map((t) => {
      const contas = `${t.origem ? `${t.origem.nome} · ${t.origem.banco}` : "—"} → ${
        t.destino ? `${t.destino.nome} · ${t.destino.banco}` : "—"
      }`;
      const descricao = t.descricao?.trim() || "Transferência entre contas";
      return {
        id: t.id,
        numero_parcela: 1,
        total_parcelas: 1,
        valor: Number(t.valor),
        data_vencimento: t.data_prevista,
        data_previsao_recebimento: t.data_prevista,
        data_previsao_recebimento_primeira: t.data_prevista,
        status: t.status === "transferida" ? "pago" : "em_aberto",
        pago_em: t.transferida_em,
        empresa_id: "",
        faturamento_id: "",
        fat_numero_nf: "",
        fat_data_emissao: "",
        fat_descricao: descricao,
        fat_cnpj_emissor: null,
        contraparte_nome: contas,
        jobs_cobertos: [descricao],
        jobs: [],
        inadimplente_desde: null,
        // Uma baixa só, sem lançamento único (duas pernas): o popup cancela
        // pela transferência.
        baixas:
          t.status === "transferida"
            ? [
                {
                  lancamentoId: null,
                  data: t.transferida_em,
                  contaNome: contas,
                  contaBancariaId: null,
                  centroNome: "Transferência entre contas",
                  subtipoNome: "fora do DRE",
                  movimentado: Number(t.valor),
                  retencoes: [],
                  estornos: [],
                  antesDaNf: false,
                },
              ]
            : [],
        baixado: t.status === "transferida" ? Number(t.valor) : 0,
        parte_id: null,
        origem: "transferencia" as const,
        conta_avulsa_id: null,
        codigo_avulsa: t.codigo,
        plano_conta_tipo_id: null,
        plano_conta_subtipo_id: null,
        conta_prevista_id: null,
      };
    });
  return [...titulosRows, ...linhasAvulsas, ...linhasTransferencias].sort((a, b) =>
    a.data_vencimento.localeCompare(b.data_vencimento),
  );
}
