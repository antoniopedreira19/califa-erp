"use server";

/**
 * Server action de geração de remessa CNAB Santander.
 *
 * Fluxo:
 *   1. Valida sessão + permissão
 *   2. Busca conta bancária (com convênio) + empresa contábil (endereço)
 *   3. Pra cada item da lista, resolve origem → destinatário → forma de pagamento
 *   4. Separa itens elegíveis dos rejeitados (motivo específico por item)
 *   5. Aloca sequencial via RPC atômica
 *   6. Monta arquivo via biblioteca lib/cnab/santander
 *   7. Grava cnab_remessas + cnab_remessas_itens (rastreio)
 *   8. Retorna arquivo em Base64 pro browser baixar
 *
 * Fora desta iteração:
 *   • Upload pro Supabase Storage (fica pra fase 6, quando tivermos
 *     histórico de arquivos)
 *   • Boleto (segmento J + J52) — a biblioteca ainda não gera
 *   • PIX QR Code (fase 2 pós-MVP)
 */

import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import { requireSession } from "@/lib/auth/session";
import { checarPermissao } from "@/lib/permissoes-server";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import {
  gerarArquivo,
  type FormaLancamento,
  type LoteInput,
} from "@/lib/cnab/santander/gerador";
import type {
  ContaDebito,
  EmpresaPagadora,
  MetadadosArquivo,
  Pagamento,
} from "@/lib/cnab/santander/tipos";

// ---------------------------------------------------------------------
// Tipos públicos da action
// ---------------------------------------------------------------------

export type CnabOrigemTipo =
  | "pp"
  | "avulsa"
  | "folha"
  | "recorrente"
  | "desembolso";

/** Escolha do usuário sobre como pagar este item específico.
 *  Se omitido, cai na regra padrão: PIX se cadastrado, senão banco. */
export type CnabFormaEscolhida = "pix" | "banco";

export interface CnabItemInput {
  origemTipo: CnabOrigemTipo;
  origemId: string;
  /** Se preenchido, força a forma escolhida. Se o destinatário não
   *  tem os dados exigidos por essa forma, o item vai pra rejeitados
   *  com motivo específico. */
  formaEscolhida?: CnabFormaEscolhida;
}

export interface GerarRemessaCnabInput {
  contaBancariaId: string;
  itens: CnabItemInput[];
  /** Data de pagamento aplicada a TODOS os itens do arquivo (YYYY-MM-DD). */
  dataPagamento: string;
}

export interface CnabItemRejeitado {
  origemTipo: CnabOrigemTipo;
  origemId: string;
  motivo: string;
}

export type GerarRemessaCnabResult =
  | {
      ok: true;
      remessaId: string;
      sequencial: number;
      /** Nome sugerido do arquivo: PE + sequencial em 6 dígitos + .TXT.
       *  Extensão .TXT casa com o padrão do ERP antigo da California
       *  (arquivo PE000013.TXT foi aceito pelo Santander em 2026-08-18)
       *  e abre no Notepad pra conferência manual. Santander lê o
       *  conteúdo, não a extensão. */
      nomeArquivo: string;
      /** Conteúdo do arquivo codificado em Base64 pra download no browser. */
      conteudoBase64: string;
      qtdItens: number;
      valorTotal: number;
      /** Itens que foram rejeitados na validação (ficam fora do arquivo). */
      itensRejeitados: CnabItemRejeitado[];
    }
  | {
      ok: false;
      message: string;
      itensRejeitados?: CnabItemRejeitado[];
    };

// ---------------------------------------------------------------------
// Estruturas internas
// ---------------------------------------------------------------------

interface OrigemResolvida {
  origemTipo: CnabOrigemTipo;
  origemId: string;
  valor: number;
  descricao: string;
  /** UUID do destinatário resolvido (fornecedor ou colaborador). */
  destinatarioId: string;
  destinatarioTipo: "fornecedor" | "colaborador" | "cliente";
}

interface DadosBancariosDestinatario {
  nome: string;
  documento: string; // dígitos apenas
  ehCnpj: boolean;
  bancoCodigo: string | null;
  agencia: string | null;
  agenciaDv: string | null;
  conta: string | null;
  contaDv: string | null;
  tipoConta: "corrente" | "poupanca" | "pagamento" | null;
  pixTipo:
    | "cpf"
    | "cnpj"
    | "email"
    | "telefone"
    | "aleatoria"
    | null;
  pixChave: string | null;
  endereco?: {
    logradouro?: string | null;
    cidade?: string | null;
    cep?: string | null;
    uf?: string | null;
  };
}

// ---------------------------------------------------------------------
// Action principal
// ---------------------------------------------------------------------

export async function gerarRemessaCnab(
  input: GerarRemessaCnabInput,
): Promise<GerarRemessaCnabResult> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "financeiro.contas_pagar");
  if (!gate.ok) return gate;

  if (!input.contaBancariaId || !input.dataPagamento) {
    return { ok: false, message: "Dados obrigatórios ausentes." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dataPagamento)) {
    return { ok: false, message: "Data de pagamento inválida." };
  }
  if (!Array.isArray(input.itens) || input.itens.length === 0) {
    return { ok: false, message: "Selecione ao menos um título." };
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // 1. Conta bancária + convênio
  const { data: contaRow, error: contaErr } = await supabase
    .from("contas_bancarias")
    .select(
      "id, tenant_id, empresa_contabil_id, banco, agencia, agencia_dv, numero_conta, numero_conta_dv, convenio_cnab_santander, sequencial_arquivo",
    )
    .eq("id", input.contaBancariaId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (contaErr || !contaRow) {
    return { ok: false, message: "Conta bancária não encontrada." };
  }
  const conta = contaRow as {
    id: string;
    tenant_id: string;
    empresa_contabil_id: string;
    banco: string;
    agencia: string | null;
    agencia_dv: string | null;
    numero_conta: string | null;
    numero_conta_dv: string | null;
    convenio_cnab_santander: string | null;
    sequencial_arquivo: number | null;
  };

  if (!conta.banco.toLowerCase().includes("santander")) {
    return {
      ok: false,
      message:
        "Só remessa Santander é suportada neste MVP. Selecione uma conta Santander.",
    };
  }
  if (
    !conta.convenio_cnab_santander ||
    !conta.agencia ||
    !conta.numero_conta ||
    !conta.numero_conta_dv
  ) {
    return {
      ok: false,
      message:
        "Conta bancária sem configuração CNAB completa. Configure convênio, agência, conta e DV antes de gerar remessa.",
    };
  }

  // 2. Empresa contábil (endereço fiscal + CNPJ)
  const { data: empresaRow, error: empresaErr } = await supabase
    .from("empresas_contabeis")
    .select(
      "id, razao_social, cnpj, endereco_logradouro, endereco_cidade, endereco_cep, endereco_uf",
    )
    .eq("id", conta.empresa_contabil_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (empresaErr || !empresaRow) {
    return { ok: false, message: "Empresa contábil não encontrada." };
  }

  const empresaPagadora: EmpresaPagadora = {
    cnpj: empresaRow.cnpj,
    razaoSocial: empresaRow.razao_social,
    enderecoLogradouro: empresaRow.endereco_logradouro,
    enderecoCidade: empresaRow.endereco_cidade,
    enderecoCep: empresaRow.endereco_cep,
    enderecoUf: empresaRow.endereco_uf,
  };
  const contaDebito: ContaDebito = {
    agencia: conta.agencia,
    agenciaDv: conta.agencia_dv,
    conta: conta.numero_conta,
    contaDv: conta.numero_conta_dv,
    convenio: conta.convenio_cnab_santander,
  };

  // 3. Resolver cada item: origem → destinatário → forma de pagamento
  const elegiveis: Array<{
    origem: OrigemResolvida;
    dados: DadosBancariosDestinatario;
    pagamento: Pagamento;
  }> = [];
  const rejeitados: CnabItemRejeitado[] = [];

  for (const item of input.itens) {
    const resolvido = await resolverOrigem(supabase, tenantId, item);
    if (!resolvido.ok) {
      rejeitados.push({
        origemTipo: item.origemTipo,
        origemId: item.origemId,
        motivo: resolvido.message,
      });
      continue;
    }
    const dados = await buscarDadosDestinatario(
      supabase,
      tenantId,
      resolvido.data.destinatarioTipo,
      resolvido.data.destinatarioId,
    );
    if (!dados.ok) {
      rejeitados.push({
        origemTipo: item.origemTipo,
        origemId: item.origemId,
        motivo: dados.message,
      });
      continue;
    }
    const pgto = montarPagamento(
      resolvido.data,
      dados.data,
      input.dataPagamento,
      item.formaEscolhida,
    );
    if (!pgto.ok) {
      rejeitados.push({
        origemTipo: item.origemTipo,
        origemId: item.origemId,
        motivo: pgto.message,
      });
      continue;
    }
    elegiveis.push({ origem: resolvido.data, dados: dados.data, pagamento: pgto.data });
  }

  if (elegiveis.length === 0) {
    return {
      ok: false,
      message:
        "Nenhum título elegível — verifique os cadastros bancários dos destinatários.",
      itensRejeitados: rejeitados,
    };
  }

  // 4. Alocar sequencial atomicamente
  const { data: sequencial, error: seqErr } = await supabase.rpc(
    "alocar_sequencial_cnab",
    {
      p_conta_bancaria_id: conta.id,
      p_tenant_id: tenantId,
    },
  );
  if (seqErr || typeof sequencial !== "number") {
    console.error("[cnab.sequencial]", seqErr?.message);
    return {
      ok: false,
      message: "Não foi possível alocar sequencial do arquivo.",
      itensRejeitados: rejeitados,
    };
  }

  // 5. Agrupar por forma de lançamento (um lote por forma)
  const lotes: LoteInput[] = agruparPorForma(elegiveis.map((e) => e.pagamento));

  // 6. Montar arquivo
  const meta: MetadadosArquivo = {
    sequencialArquivo: sequencial,
    dataGeracao: new Date(),
  };
  let conteudo: string;
  try {
    conteudo = gerarArquivo(empresaPagadora, contaDebito, meta, lotes);
  } catch (e: unknown) {
    console.error("[cnab.montar]", e);
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    return { ok: false, message: `Falha ao montar arquivo: ${msg}` };
  }

  // 7. Hash SHA256 do conteúdo (dedup + auditoria)
  const hash = createHash("sha256").update(conteudo, "ascii").digest("hex");
  const valorTotal = elegiveis.reduce(
    (acc, e) => acc + Number(e.origem.valor),
    0,
  );

  // 8. Grava cnab_remessas + itens
  const { data: remessaRow, error: remessaErr } = await supabase
    .from("cnab_remessas")
    .insert({
      tenant_id: tenantId,
      conta_bancaria_id: conta.id,
      sequencial_arquivo: sequencial,
      hash_arquivo: hash,
      path_storage: null, // Storage entra na fase 6
      qtd_itens: elegiveis.length,
      valor_total: valorTotal.toFixed(2),
      status: "gerado",
      gerado_por: session.profile.id,
    })
    .select("id")
    .single();
  if (remessaErr || !remessaRow) {
    console.error("[cnab.grava_remessa]", remessaErr?.message);
    return {
      ok: false,
      message: "Falha ao gravar registro da remessa.",
    };
  }

  const itensParaGravar = elegiveis.map((e) => ({
    tenant_id: tenantId,
    remessa_id: remessaRow.id,
    origem_tipo: e.origem.origemTipo,
    origem_id: e.origem.origemId,
    forma_pagamento: formaPagamentoParaPagamento(e.pagamento),
    destinatario_tipo: e.origem.destinatarioTipo,
    destinatario_id: e.origem.destinatarioId,
    valor: e.origem.valor.toFixed(2),
    data_pagamento: input.dataPagamento,
  }));
  const { error: itensErr } = await supabase
    .from("cnab_remessas_itens")
    .insert(itensParaGravar);
  if (itensErr) {
    console.error("[cnab.grava_itens]", itensErr.message);
    return { ok: false, message: "Falha ao gravar itens da remessa." };
  }

  await logAuditEvent({
    acao: "cnab.remessa_gerada",
    tenantId,
    entidadeTipo: "cnab_remessa",
    entidadeId: remessaRow.id,
    metadata: {
      sequencial,
      qtd_itens: elegiveis.length,
      valor_total: valorTotal.toFixed(2),
      conta_bancaria_id: conta.id,
      rejeitados: rejeitados.length,
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");

  return {
    ok: true,
    remessaId: remessaRow.id,
    sequencial,
    nomeArquivo: `PE${String(sequencial).padStart(6, "0")}.TXT`,
    conteudoBase64: Buffer.from(conteudo, "ascii").toString("base64"),
    qtdItens: elegiveis.length,
    valorTotal,
    itensRejeitados: rejeitados,
  };
}

// ---------------------------------------------------------------------
// Helpers de resolução
// ---------------------------------------------------------------------

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function resolverOrigem(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  item: CnabItemInput,
): Promise<Result<OrigemResolvida>> {
  if (
    item.origemTipo === "avulsa" ||
    item.origemTipo === "recorrente" ||
    item.origemTipo === "folha"
  ) {
    const { data, error } = await supabase
      .from("contas_avulsas")
      .select(
        "id, valor, descricao, natureza, status, pago_em, fornecedor_id, cliente_id, colaborador_id",
      )
      .eq("id", item.origemId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return { ok: false, message: "Título não encontrado." };
    if (data.natureza !== "saida") {
      return { ok: false, message: "Título de entrada não vai pra remessa." };
    }
    if (data.status !== "aprovada" || data.pago_em) {
      return { ok: false, message: "Título já baixado ou não aprovado." };
    }
    const dest = resolverDestinatario(data);
    if (!dest) return { ok: false, message: "Sem destinatário identificável." };
    return {
      ok: true,
      data: {
        origemTipo: item.origemTipo,
        origemId: data.id,
        valor: Number(data.valor),
        descricao: data.descricao,
        destinatarioId: dest.id,
        destinatarioTipo: dest.tipo,
      },
    };
  }
  if (item.origemTipo === "pp") {
    const { data, error } = await supabase
      .from("pedidos_compra_parcelas")
      .select(
        "id, valor, pago_em, pedido:pedidos_compra(id, status, servico, fornecedor_id)",
      )
      .eq("id", item.origemId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return { ok: false, message: "Parcela não encontrada." };
    // Supabase-js infere relação embed como array; pegamos o primeiro.
    const pedidoRaw = data.pedido as unknown;
    const pp = (Array.isArray(pedidoRaw) ? pedidoRaw[0] : pedidoRaw) as
      | {
          id: string;
          status: string;
          servico: string;
          fornecedor_id: string | null;
        }
      | null;
    if (!pp) return { ok: false, message: "PP não encontrada." };
    if (data.pago_em) return { ok: false, message: "Parcela já baixada." };
    if (pp.status !== "aprovada" && pp.status !== "pago") {
      return { ok: false, message: "PP não aprovada." };
    }
    if (!pp.fornecedor_id) {
      return { ok: false, message: "PP sem fornecedor." };
    }
    return {
      ok: true,
      data: {
        origemTipo: "pp",
        origemId: data.id,
        valor: Number(data.valor),
        descricao: `PP ${pp.servico.slice(0, 100)}`,
        destinatarioId: pp.fornecedor_id,
        destinatarioTipo: "fornecedor",
      },
    };
  }
  // desembolso
  const { data, error } = await supabase
    .from("desembolsos_parcelas")
    .select(
      "id, valor, pago_em, desembolso:desembolsos(id, status, descricao, fornecedor_id, cliente_id)",
    )
    .eq("id", item.origemId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "Desembolso não encontrado." };
  const desembolsoRaw = data.desembolso as unknown;
  const d = (Array.isArray(desembolsoRaw) ? desembolsoRaw[0] : desembolsoRaw) as
    | {
        id: string;
        status: string;
        descricao: string;
        fornecedor_id: string | null;
        cliente_id: string | null;
      }
    | null;
  if (!d) return { ok: false, message: "Desembolso não encontrado." };
  if (data.pago_em) return { ok: false, message: "Parcela já baixada." };
  if (d.status !== "aprovada" && d.status !== "pago") {
    return { ok: false, message: "Desembolso não aprovado." };
  }
  const dest = d.fornecedor_id
    ? { tipo: "fornecedor" as const, id: d.fornecedor_id }
    : d.cliente_id
      ? { tipo: "cliente" as const, id: d.cliente_id }
      : null;
  if (!dest) return { ok: false, message: "Desembolso sem destinatário." };
  return {
    ok: true,
    data: {
      origemTipo: "desembolso",
      origemId: data.id,
      valor: Number(data.valor),
      descricao: `Desembolso ${d.descricao.slice(0, 100)}`,
      destinatarioId: dest.id,
      destinatarioTipo: dest.tipo,
    },
  };
}

function resolverDestinatario(row: {
  fornecedor_id: string | null;
  cliente_id: string | null;
  colaborador_id: string | null;
}): { tipo: "fornecedor" | "colaborador" | "cliente"; id: string } | null {
  if (row.colaborador_id) return { tipo: "colaborador", id: row.colaborador_id };
  if (row.fornecedor_id) return { tipo: "fornecedor", id: row.fornecedor_id };
  if (row.cliente_id) return { tipo: "cliente", id: row.cliente_id };
  return null;
}

async function buscarDadosDestinatario(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  tipo: "fornecedor" | "colaborador" | "cliente",
  id: string,
): Promise<Result<DadosBancariosDestinatario>> {
  if (tipo === "fornecedor") {
    const { data, error } = await supabase
      .from("fornecedores")
      .select(
        "nome, cpf_cnpj, tipo_pessoa, banco_codigo, agencia, agencia_dv, conta, conta_dv, tipo_conta, pix_tipo, pix_chave, logradouro, cidade, cep, uf",
      )
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return { ok: false, message: "Fornecedor não encontrado." };
    if (!data.cpf_cnpj) return { ok: false, message: "Fornecedor sem CPF/CNPJ." };
    return {
      ok: true,
      data: {
        nome: data.nome,
        documento: data.cpf_cnpj,
        ehCnpj: data.tipo_pessoa === "juridica",
        bancoCodigo: data.banco_codigo,
        agencia: data.agencia,
        agenciaDv: data.agencia_dv,
        conta: data.conta,
        contaDv: data.conta_dv,
        tipoConta: data.tipo_conta,
        pixTipo: data.pix_tipo,
        pixChave: data.pix_chave,
        endereco: {
          logradouro: data.logradouro,
          cidade: data.cidade,
          cep: data.cep,
          uf: data.uf,
        },
      },
    };
  }
  if (tipo === "colaborador") {
    const { data, error } = await supabase
      .from("colaboradores")
      .select(
        "nome, cpf_cnpj, tipo_contratacao, banco_codigo, agencia, agencia_dv, conta, conta_dv, tipo_conta, pix_tipo, pix_chave",
      )
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return { ok: false, message: "Colaborador não encontrado." };
    if (!data.cpf_cnpj) return { ok: false, message: "Colaborador sem CPF/CNPJ." };
    const ehCnpj =
      data.tipo_contratacao === "pj" ||
      data.tipo_contratacao === "mei" ||
      data.tipo_contratacao === "clt_recibo";
    return {
      ok: true,
      data: {
        nome: data.nome,
        documento: data.cpf_cnpj,
        ehCnpj,
        bancoCodigo: data.banco_codigo,
        agencia: data.agencia,
        agenciaDv: data.agencia_dv,
        conta: data.conta,
        contaDv: data.conta_dv,
        tipoConta: data.tipo_conta,
        pixTipo: data.pix_tipo,
        pixChave: data.pix_chave,
      },
    };
  }
  // cliente
  return {
    ok: false,
    message: "Cliente como destinatário não está no MVP.",
  };
}

// ---------------------------------------------------------------------
// Escolha da forma de pagamento + montagem do Pagamento pra biblioteca
// ---------------------------------------------------------------------

function montarPagamento(
  origem: OrigemResolvida,
  dados: DadosBancariosDestinatario,
  dataPagamento: string,
  formaEscolhida?: CnabFormaEscolhida,
): Result<Pagamento> {
  const temPix = !!(dados.pixTipo && dados.pixChave);
  const temBanco = !!(
    dados.bancoCodigo &&
    dados.agencia &&
    dados.conta &&
    dados.contaDv
  );

  const seuNumero = origem.origemId.replace(/-/g, "").slice(0, 20);

  // Regra de decisão:
  //   • formaEscolhida="pix"   → força PIX; rejeita se sem chave
  //   • formaEscolhida="banco" → força TED/CC; rejeita se sem banco
  //   • formaEscolhida omitida → padrão: PIX se cadastrado, senão banco
  const usarPix =
    formaEscolhida === "pix"
      ? true
      : formaEscolhida === "banco"
        ? false
        : temPix;

  if (usarPix) {
    if (!temPix) {
      return {
        ok: false,
        message: "Forma PIX escolhida, mas destinatário não tem chave PIX cadastrada.",
      };
    }
    return {
      ok: true,
      data: {
        tipo: "pix_chave",
        tipoChave: dados.pixTipo!,
        chave: dados.pixChave!,
        seuNumero,
        dataPagamento,
        valor: origem.valor,
        nomeFavorecido: dados.nome,
        documentoFavorecido: dados.documento,
        favorecidoEhCnpj: dados.ehCnpj,
      },
    };
  }

  if (!temBanco) {
    return {
      ok: false,
      message:
        formaEscolhida === "banco"
          ? "Forma banco escolhida, mas destinatário não tem banco+agência+conta+DV cadastrados."
          : "Destinatário sem chave PIX nem dados bancários completos.",
    };
  }

  const bancoEhSantander = dados.bancoCodigo === "033";
  return {
    ok: true,
    data: {
      tipo: bancoEhSantander ? "credito_conta" : "ted",
      bancoFavorecido: dados.bancoCodigo!,
      agenciaFavorecida: dados.agencia!,
      agenciaFavorecidaDv: dados.agenciaDv,
      contaFavorecida: dados.conta!,
      contaFavorecidaDv: dados.contaDv!,
      tipoContaFavorecida: dados.tipoConta ?? "corrente",
      finalidadeTED: bancoEhSantander ? undefined : "00005", // Pagto Fornecedores
      seuNumero,
      dataPagamento,
      valor: origem.valor,
      nomeFavorecido: dados.nome,
      documentoFavorecido: dados.documento,
      favorecidoEhCnpj: dados.ehCnpj,
      favorecidoLogradouro: dados.endereco?.logradouro,
      favorecidoCidade: dados.endereco?.cidade,
      favorecidoCep: dados.endereco?.cep,
      favorecidoUf: dados.endereco?.uf,
    },
  };
}

function agruparPorForma(pagamentos: Pagamento[]): LoteInput[] {
  const grupos = new Map<FormaLancamento, Pagamento[]>();
  for (const p of pagamentos) {
    const forma = formaLancamentoDo(p);
    const arr = grupos.get(forma) ?? [];
    arr.push(p);
    grupos.set(forma, arr);
  }
  return Array.from(grupos.entries()).map(([forma, pgtos]) => ({
    formaLancamento: forma,
    tipoServico: "20",
    pagamentos: pgtos,
  }));
}

function formaLancamentoDo(p: Pagamento): FormaLancamento {
  switch (p.tipo) {
    case "credito_conta":
      return p.tipoContaFavorecida === "poupanca" ? "05" : "01";
    case "ted":
      return "03";
    case "pix_chave":
    case "pix_dados":
      return "45";
  }
}

function formaPagamentoParaPagamento(p: Pagamento): string {
  switch (p.tipo) {
    case "credito_conta":
      return "transferencia";
    case "ted":
      return "transferencia";
    case "pix_chave":
    case "pix_dados":
      return "pix";
  }
}
