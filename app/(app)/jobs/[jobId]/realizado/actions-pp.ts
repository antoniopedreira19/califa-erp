"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { bloqueioGeracaoPPPeloComite } from "@/lib/calculos/limites-orcamento";
import { carregarRegrasDoComite, ppAguardandoComite, valorAprovadoNoComite } from "@/lib/data/comite";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  COLUNAS_DA_FOTO_DO_TITULAR,
  COLUNAS_DE_PAGAMENTO,
  aplicarPagamentoForaDoCadastro,
  camposDoPagamentoForaDoCadastro,
  fotoDoPagamentoDoTitular,
  lerFoto,
  lerPagamentoForaDoCadastro,
  pagamentoDoTitularDaFoto,
  pagamentoDoTitularDaPP,
  resumoDoCadastroDePagamento,
  tirarFoto,
  type DadosDePagamento,
  type FotoDePagamentoDaPP,
  type PagamentoForaDoCadastro,
} from "@/lib/data/foto-pagamento-da-pp";
import type { PagamentoDoTitularNoPdf, SeloDaPP } from "@/lib/pdf/pedido-compra";
import { pagamentoForaDoCadastroSchema } from "@/lib/validations/pagamento-fora-do-cadastro";
import { pagamentoDoTitularSchema } from "@/lib/validations/pagamento-do-titular";
import { LINK_DA_COMPRA, LINK_DA_COMPRA_MAX, PLATAFORMA_MAX } from "@/lib/validations/cartao-corporativo";
import { checarPermissao } from "@/lib/permissoes-server";
import { formatCurrency } from "@/lib/utils";
import { enviaPPNoJob, pode, type JobParaEnvioDePP } from "@/lib/permissoes";
import {
  DOCUMENTO_TIPOS,
  DOCUMENTO_TIPOS_FISCAIS,
  PP_URGENTE_JUSTIFICATIVA_MIN,
  meioPeloAnexo,
  verbaDeResponsavel,
  type MeioPeloAnexo,
  type PagamentoDoTitular,
  type TipoVerba,
  type TitularDaVerbaTipo,
} from "@/lib/types";
import { gerarCodigoPP } from "@/lib/codigos/pedidos-compra";
import { carregarPessoasParaVerba, type PessoaParaVerba } from "@/lib/data/pessoas-para-verba";
import { linhasAlteradasNaRevisao } from "@/lib/data/linhas-da-revisao";
import {
  valorDaPPPorUnidade,
  somaDasPPsNaoCanceladas,
  passaDoPlanejado,
  exigeSomaIgualAoOrcado,
  faltaParaFecharOOrcado,
  parcelasFecham,
} from "@/lib/calculos/pps-item";
import { aplicarConclusaoDoItem } from "./conclusao-item";
import {
  DOCUMENTOS_EM_CNPJS_DIFERENTES,
  cnpjPadraoDaPP,
  documentoTemCnpj,
  emissoraDosDocumentos,
  empresaDoDocumento,
  type CnpjDoDocumento,
} from "@/lib/fiscal/cnpj-da-pp";
import { tomadoresPadrao } from "@/lib/fiscal/nf-da-pp";
import { listarPendencias, pendenciasDoCadastroFiscal } from "@/lib/fiscal/regime-do-fornecedor";
// NÃO importar renderPedidoCompraPDF estaticamente. O módulo pedido-compra.ts
// puxa pdfmake, que tem side-effects de inicialização que falham em runtime
// serverless Vercel. Se importarmos aqui, TODAS as actions do arquivo caem
// juntas (reservar, cancelar, signedUrl, etc) mesmo sem usar PDF. Usar
// `await import(...)` dentro de finalizarPedidoCompra isola o problema.
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
  podeCancelarPP,
  jobAceitaGerarPP,
  jobAceitaEnvioDePP,
  type PPStatus,
  type JobStatus,
  type TipoCusto,
} from "@/lib/types";
import {
  acomodarDatasDasParcelas,
  dataLimiteDeEnvio,
  ehJanelaDePagamento,
  ehQuarta,
  hojeEmSaoPauloIso,
  isoParaBr,
  ppSegueOPrazoDeEnvio,
  primeiraDataDaProximaParcela,
  ppAceitaQuarta,
  primeiraDataPossivelDoPrazo,
  primeiraJanelaComEnvioAberto,
  vencimentoAceitaEnvio,
} from "@/lib/calculos/janelas-pagamento";
import { carregarFeriadosNacionais } from "@/lib/data/feriados-nacionais";
import { travaDoJobDeMidia } from "@/lib/data/midia-do-job";
import { envioDispensaNf, midiaSystemDoJob } from "@/lib/calculos/midia-system";
import {
  DESGASTE_POR_KM_PADRAO,
  contaDosDeslocamentos,
  faltaNosComprovantesDoReembolso,
  faltaNosDeslocamentos,
  type DeslocamentosDoReembolso,
  type ReembolsoTipo,
} from "@/lib/calculos/reembolso";

const BUCKET = "pedidos-compra";
const PDF_TTL_SEGUNDOS = 3600;

/** R$ nas mensagens de erro — o usuário lê valor, não número solto. */
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Caminho do PDF da PP — um documento só, com todas as parcelas
 * (decisão 112, 28/09/2026).
 *
 * É o nome histórico da PP de parcela única (`pp-PP-00008.pdf`), que
 * agora vale também para a parcelada. De 17/08 a 28/09 a parcelada tinha
 * um documento por parcela (`pp-PP-00008-parcela-2de3.pdf`); as PPs
 * daquele período guardam esses arquivos até serem editadas ou
 * reenviadas, quando o documento único os substitui.
 */
function caminhoPdfDaPP(
  tenantId: string,
  jobId: string,
  ppId: string,
  codigo: string,
): string {
  return `${tenantId}/${jobId}/${ppId}/pp-${codigo}.pdf`;
}

type Ok<T = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = object> = Ok<T> | Err;

/** O tipo da verba nos dados do formulário (decisão 164); null fora da
 *  verba. A PP a emitir salva antes dela não tem o campo: é produção. */
function tipoDaVerbaDosDados(d: {
  verba_producao: boolean;
  tipo_verba?: TipoVerba | null;
}): TipoVerba | null {
  return d.verba_producao ? (d.tipo_verba ?? "producao") : null;
}

/** Decisão 209: a plataforma e o link da PP no cartão corporativo. */
type CartaoCorporativo = { plataforma: string; link: string };

/** Decisão 209: o cartão corporativo da PP comum, ou null. */
function cartaoDe(d: { verba_producao: boolean; cartao_corporativo?: CartaoCorporativo | null }): CartaoCorporativo | null {
  return d.verba_producao ? null : (d.cartao_corporativo ?? null);
}

/** Decisão 209: a PP do cartão não leva nota fiscal. A nota exige
 *  fornecedor (`notas_fiscais_fornecedor`), e anexá-la depois é com o
 *  financeiro, em fase futura (Tiago, 23/10/2026). */
function notaNoCartao(
  cartao: CartaoCorporativo | null,
  anexos: Array<{ documento_tipo?: string | null }>,
): string | null {
  if (!cartao || !anexos.some((a) => a.documento_tipo === "nota_fiscal")) return null;
  return "A PP no cartão corporativo não leva nota fiscal: anexe o comprovante com outro tipo, ou tire a nota.";
}

/** Decisão 209: o cartão corporativo da PP gravada, ou null. */
function cartaoDaLinha(pp: {
  cartao_corporativo: boolean | null;
  cartao_plataforma: string | null;
  cartao_link: string | null;
}): CartaoCorporativo | null {
  return pp.cartao_corporativo ? { plataforma: pp.cartao_plataforma ?? "", link: pp.cartao_link ?? "" } : null;
}

/** A PP paga um fornecedor: a de fornecedor e a verba de um terceiro
 *  (decisão 164; nas três verbas desde a 171), que usa o pagamento do
 *  fornecedor. A PP do cartão corporativo (decisão 209) não tem. */
function usaFornecedor(d: {
  verba_producao: boolean;
  tipo_verba?: TipoVerba | null;
  verba_titular_tipo?: TitularDaVerbaTipo | null;
  cartao_corporativo?: CartaoCorporativo | null;
}): boolean {
  if (!d.verba_producao) return !cartaoDe(d);
  return d.verba_titular_tipo === "fornecedor";
}

/**
 * O pagamento fora do cadastro que a PP vai gravar (decisão 127). A verba
 * paga a uma pessoa não tem (a do colaborador traz a conta do RH, decisão
 * 171); a verba de um terceiro usa o pagamento do fornecedor (decisão 164).
 */
function foraDoCadastroDe(d: {
  verba_producao: boolean;
  tipo_verba?: TipoVerba | null;
  verba_titular_tipo?: TitularDaVerbaTipo | null;
  cartao_corporativo?: CartaoCorporativo | null;
  pagamento_fora_do_cadastro?: PagamentoForaDoCadastro | null;
}): PagamentoForaDoCadastro | null {
  return usaFornecedor(d) ? (d.pagamento_fora_do_cadastro ?? null) : null;
}

/** As colunas da verba que a PP e a PP a emitir gravam (decisão 164).
 *  Desde a 171 as três verbas têm titular: o responsável (usuário) só
 *  existe na verba de produção gravada antes, e nada novo o grava. */
function colunasDaVerba(
  d: {
    verba_producao: boolean;
    tipo_verba?: TipoVerba | null;
    fornecedor_id?: string | null;
    verba_titular_tipo?: TitularDaVerbaTipo | null;
    verba_titular_id?: string | null;
    cartao_corporativo?: CartaoCorporativo | null;
  },
  titularNome: string | null,
) {
  const tipo = tipoDaVerbaDosDados(d);
  // Decisão 209: o cartão corporativo, na PP comum e sem fornecedor. As
  // CHECKs `pp_cartao_corporativo` e `chk_ppae_cartao_corporativo` repetem.
  const cartao = cartaoDe(d);
  const colunasDoCartao = {
    cartao_corporativo: !!cartao,
    cartao_plataforma: cartao?.plataforma ?? null,
    cartao_link: cartao?.link ?? null,
  };
  if (!tipo) {
    return {
      ...colunasDoCartao,
      verba_producao: false,
      tipo_verba: null,
      fornecedor_id: cartao ? null : (d.fornecedor_id ?? null),
      responsavel_verba_id: null,
      verba_titular_tipo: null,
      verba_colaborador_id: null,
      verba_freela_id: null,
      verba_titular_nome: null,
    };
  }
  const origem = d.verba_titular_tipo ?? null;
  return {
    ...colunasDoCartao,
    verba_producao: true,
    tipo_verba: tipo,
    fornecedor_id: origem === "fornecedor" ? (d.fornecedor_id ?? null) : null,
    responsavel_verba_id: null,
    verba_titular_tipo: origem,
    verba_colaborador_id: origem === "colaborador" ? (d.verba_titular_id ?? null) : null,
    verba_freela_id: origem === "freela" ? (d.verba_titular_id ?? null) : null,
    verba_titular_nome: titularNome,
  };
}

/**
 * O nome do titular da verba, conferido no servidor (decisões 164 e 171,
 * nas três verbas): o colaborador ou o freela tem de estar na lista de
 * `pessoas_para_verba` (a mesma do formulário), e o terceiro tem de ser um
 * fornecedor ativo do tenant. Null fora da verba. Decisão 193: diz também se
 * o titular paga pelo cadastro (o terceiro e a PP comum pagam pelo do
 * fornecedor).
 */
async function nomeDoTitularDaVerba(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  d: {
    verba_producao: boolean;
    tipo_verba?: TipoVerba | null;
    fornecedor_id?: string | null;
    verba_titular_tipo?: TitularDaVerbaTipo | null;
    verba_titular_id?: string | null;
  },
  fornecedorJaLido?: { nome?: string | null; razao_social?: string | null } | null,
): Promise<Result<{ nome: string | null; pagaPeloCadastro: boolean }>> {
  if (!tipoDaVerbaDosDados(d)) return { ok: true, nome: null, pagaPeloCadastro: true };
  if (d.verba_titular_tipo === "fornecedor") {
    const forn =
      fornecedorJaLido ??
      (
        await supabase
          .from("fornecedores")
          .select("nome, razao_social")
          .eq("id", d.fornecedor_id as string)
          .eq("tenant_id", tenantId)
          .eq("status", "ativo")
          .maybeSingle<{ nome: string; razao_social: string | null }>()
      ).data;
    if (!forn) return { ok: false, message: "Fornecedor inválido ou inativo." };
    return { ok: true, nome: (forn.razao_social ?? forn.nome ?? "").trim() || null, pagaPeloCadastro: true };
  }
  const pessoas = await carregarPessoasParaVerba(supabase, tenantId);
  const pessoa = pessoas.find(
    (p: PessoaParaVerba) => p.id === d.verba_titular_id && p.origem === d.verba_titular_tipo,
  );
  if (!pessoa) {
    return {
      ok: false,
      message: "O titular da verba não está mais na lista de colaboradores e freelas. Escolha de novo.",
    };
  }
  return { ok: true, nome: pessoa.nome, pagaPeloCadastro: pessoa.pagaPeloCadastro };
}

/**
 * O pagamento do titular que não paga pelo cadastro (decisão 193): o freela
 * sem PIX completo no cadastro de freelas e o colaborador sem conta nem PIX
 * na ficha do RH digitam o PIX ou a conta, e ele é obrigatório. Quem paga
 * pelo cadastro não leva o que veio da tela — a foto é do banco (gatilho
 * `trg_pp_foto_do_colaborador`). Null = nada a gravar.
 */
function pagamentoDoTitularNaGravacao(
  d: {
    verba_producao: boolean;
    tipo_verba?: TipoVerba | null;
    verba_titular_tipo?: TitularDaVerbaTipo | null;
    pagamento_do_titular?: PagamentoDoTitular | null;
  },
  pagaPeloCadastro: boolean,
): Result<{ pagamento: PagamentoDoTitular | null }> {
  if (!tipoDaVerbaDosDados(d) || pagaPeloCadastro) return { ok: true, pagamento: null };
  if (d.verba_titular_tipo !== "colaborador" && d.verba_titular_tipo !== "freela") {
    return { ok: true, pagamento: null };
  }
  if (!d.pagamento_do_titular) {
    return {
      ok: false,
      message:
        d.tipo_verba === "reembolso"
          ? "Informe o PIX ou a conta do titular do reembolso."
          : "Informe o PIX ou a conta do titular da verba.",
    };
  }
  return { ok: true, pagamento: d.pagamento_do_titular };
}

/** As colunas da foto com o pagamento digitado (decisão 193). Vazio quando
 *  não há: a foto fica com o que o gatilho tirar. */
function colunasDoPagamentoDoTitular(p: PagamentoDoTitular | null) {
  return p ? { ...fotoDoPagamentoDoTitular(p), dados_pagamento_congelados_em: new Date().toISOString() } : {};
}

/** O pagamento digitado como o PDF o imprime (a prévia, antes de gravar). O
 *  CPF sai na PP gravada, que o banco copia do cadastro. */
function pagamentoDigitadoNoPdf(p: PagamentoDoTitular | null): PagamentoDoTitularNoPdf | null {
  if (!p) return null;
  return {
    banco_codigo: p.banco_codigo,
    banco_nome: p.banco_nome,
    agencia: p.agencia,
    conta: p.conta,
    conta_dv: p.conta_dv,
    tipo_conta: p.tipo_conta,
    pix_tipo: p.pix_tipo,
    pix_chave: p.pix_chave,
    cpf: null,
  };
}

/**
 * O fornecedor que vai para o PDF: o cadastro, com só o meio escolhido
 * trocado. Regra do Tiago (29/09/2026): "o documento em si deverá
 * permanecer igual, apenas com a chave escolhida" — nada de faixa, aviso
 * ou motivo no documento, que o fornecedor assina.
 */
function fornecedorDoDocumento(
  fornecedor: Record<string, unknown> | null,
  fora: PagamentoForaDoCadastro | null,
): Record<string, unknown> | null {
  if (!fornecedor) return null;
  if (!fora) return fornecedor;
  return {
    ...fornecedor,
    ...aplicarPagamentoForaDoCadastro(fornecedor as unknown as DadosDePagamento, fora),
  };
}

/** O que a auditoria guarda do pagamento fora do cadastro — o dado inteiro:
 *  é o rastro de para onde o dinheiro foi mandado, e por quê. */
function auditoriaDoForaDoCadastro(fora: PagamentoForaDoCadastro | null) {
  if (!fora) return null;
  // Decisão 161: o boleto não tem dado digitado — o arquivo vai nos anexos.
  // A guia (decisão 227), também não.
  if (fora.meio === "boleto" || fora.meio === "guia") return { meio: fora.meio };
  return fora.meio === "pix"
    ? { meio: fora.meio, motivo: fora.motivo, pix_tipo: fora.pix_tipo, pix_chave: fora.pix_chave }
    : {
        meio: fora.meio,
        motivo: fora.motivo,
        banco_codigo: fora.banco_codigo,
        agencia: fora.agencia,
        agencia_dv: fora.agencia_dv,
        conta: fora.conta,
        conta_dv: fora.conta_dv,
        tipo_conta: fora.tipo_conta,
      };
}

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD");

/** Decisão 209: a plataforma e o link da compra no cartão corporativo — a
 *  régua de `lib/validations/cartao-corporativo.ts`, a mesma da tela. */
const cartaoCorporativoSchema = z.object({
  plataforma: z.string().trim().min(1, "Informe a plataforma").max(PLATAFORMA_MAX),
  link: z
    .string()
    .trim()
    .min(1, "Cole o link da compra")
    .max(LINK_DA_COMPRA_MAX)
    .refine((l) => LINK_DA_COMPRA.test(l), "O link da compra não parece um endereço de site"),
});

/** Teto de parcelas: 24 (decisão 077, pergunta 7a). O formulário oferece
 *  1 a 6 e "Mais de 6…" até 24; o maior parcelamento gravado até
 *  14/09/2026 tinha 12. Vale também contra payload sem fim. */
const MAX_PARCELAS = 24;

/** Decisão 187: os deslocamentos do reembolso de veículo próprio. O
 *  servidor refaz a conta (`conferirReembolso`). */
const deslocamentosSchema = z.object({
  consumo_km_l: z.number().positive().max(100),
  preco_litro: z.number().positive().max(100),
  desgaste_por_km: z.number().min(0).max(100),
  linhas: z
    .array(
      z.object({
        data: dataSchema,
        trajeto: z.string().trim().min(1).max(500),
        km_ida_volta: z.number().positive().max(10000),
        vezes: z.number().int().min(1).max(99),
      }),
    )
    .min(1, "Inclua pelo menos um deslocamento.")
    .max(200),
});

const dadosBaseSchema = z.object({
  // A empresa GERENCIAL. A geração grava a do job (decisão 156): o que vem
  // daqui só vale se o job não tiver empresa.
  empresa_id: z.string().uuid(),
  // O CNPJ da PP (decisão 156): quem contrata e paga. Sai no PDF e é o
  // tomador esperado da NF. Ausente na PP a emitir salva antes de 07/10/2026:
  // a geração usa o padrão do job.
  estabelecimento_id: z.string().uuid().nullable().optional(),
  // Vencimento da 1ª parcela. A parcela 1 SEMPRE repete esta data — o
  // campo continua existindo em `pedidos_compra` porque é o que o
  // financeiro e as views leem hoje.
  prazo_pagamento: dataSchema,
  servico: z.string().trim().min(1).max(500),
  // O trio que define o valor da PP, espelhando as colunas do item na
  // planilha (01/09/2026). Antes só vinha `quantidade` e o valor era
  // rateado do orçado — o que embutia o D/M dentro do "unitário". Agora
  // os três são do GP e o valor é o produto deles.
  valor_unitario: z.number().positive(),
  quantidade: z.number().positive(),
  dias_meses: z.number().positive(),
  especificacoes: z.string().max(2000).nullable().optional(),
  // Pagamento urgente (decisão 077). O mínimo da justificativa é checado
  // em `camposDeUrgencia`, e a constraint do banco repete a regra.
  urgente: z.boolean().default(false),
  urgente_justificativa: z.string().max(1000).nullable().optional(),
  // Uma linha por parcela, sempre — PP sem parcelamento manda 1.
  parcelas: z
    .array(z.object({ data_vencimento: dataSchema, valor: z.number().positive() }))
    .min(1, "Informe ao menos uma parcela.")
    .max(MAX_PARCELAS, `No máximo ${MAX_PARCELAS} parcelas.`),
}).and(
  // Union discriminada por verba_producao: OFF exige fornecedor; ON exige
  // o titular. O CHECK do banco é o backstop — este schema valida antes.
  z.discriminatedUnion("verba_producao", [
    z.object({
      verba_producao: z.literal(false),
      // Decisão 209: nulo só no cartão corporativo (ver o superRefine).
      fornecedor_id: z.string().uuid().nullable().optional(),
      responsavel_verba_id: z.null().optional(),
      // Decisão 127: o meio só nesta PP — desde a decisão 161, chave
      // aleatória ou boleto. Null = paga pelo cadastro.
      pagamento_fora_do_cadastro: pagamentoForaDoCadastroSchema.nullable().optional(),
      // Decisão 209: a compra que o financeiro paga no cartão da empresa —
      // a plataforma e o link no lugar do fornecedor.
      cartao_corporativo: cartaoCorporativoSchema.nullable().optional(),
    }),
    z.object({
      verba_producao: z.literal(true),
      // Decisão 164: produção, alimentação ou transporte. Ausente = produção
      // (a PP a emitir salva antes). As combinações estão no superRefine.
      tipo_verba: z.enum(["producao", "alimentacao", "transporte", "reembolso"]).nullable().optional(),
      // Decisão 187: o reembolso mora no campo da verba — despesas ou
      // veículo próprio, com os deslocamentos.
      reembolso_tipo: z.enum(["despesas", "veiculo_proprio"]).nullable().optional(),
      deslocamentos: deslocamentosSchema.nullable().optional(),
      // O titular (decisão 164; nas três verbas desde a 171) — colaborador
      // ou freela em verba_titular_id, ou o terceiro em fornecedor_id, com o
      // pagamento do fornecedor. `responsavel_verba_id` só chega da PP a
      // emitir de produção salva antes da 171, e é recusado no refine.
      fornecedor_id: z.string().uuid().nullable().optional(),
      responsavel_verba_id: z.string().uuid().nullable().optional(),
      verba_titular_tipo: z.enum(["colaborador", "freela", "fornecedor"]).nullable().optional(),
      verba_titular_id: z.string().uuid().nullable().optional(),
      pagamento_fora_do_cadastro: pagamentoForaDoCadastroSchema.nullable().optional(),
      // Decisão 193: o PIX ou a conta do titular que não paga pelo cadastro
      // (freela sem PIX completo, colaborador sem conta no RH). Quem paga
      // pelo cadastro ignora o que vier: a foto é do banco.
      pagamento_do_titular: pagamentoDoTitularSchema.nullable().optional(),
    }),
  ])
);

/** As combinações da verba (decisões 164 e 171). O CHECK do banco é o
 *  backstop. */
const dadosSchema = dadosBaseSchema.superRefine((d, ctx) => {
  const falha = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (!d.verba_producao) {
    // Decisão 209: o fornecedor, ou o cartão corporativo — nunca os dois.
    if (d.cartao_corporativo) {
      if (d.fornecedor_id) falha("O cartão corporativo não tem fornecedor");
      if (d.pagamento_fora_do_cadastro) falha("O cartão corporativo é pago pelo financeiro, no cartão da empresa");
    } else if (!d.fornecedor_id) {
      falha("Escolha o fornecedor");
    }
    return;
  }
  // Decisão 187: o reembolso vai para um colaborador ou freela — sem
  // terceiro — e diz se é de despesas ou de veículo próprio.
  if (d.tipo_verba === "reembolso") {
    if (!d.reembolso_tipo) {
      falha("Escolha o tipo do reembolso: despesas ou veículo próprio");
      return;
    }
    if (d.verba_titular_tipo === "fornecedor" || d.fornecedor_id || d.pagamento_fora_do_cadastro) {
      falha("O reembolso vai para um colaborador ou freela. Escolha o titular do reembolso");
      return;
    }
    if (!d.verba_titular_tipo || !d.verba_titular_id) {
      falha("Escolha o titular do reembolso");
      return;
    }
    if (d.reembolso_tipo === "veiculo_proprio" && !d.deslocamentos) {
      falha("Preencha os deslocamentos do veículo próprio");
    }
    return;
  }
  if (d.responsavel_verba_id) {
    falha("A verba de produção agora tem titular, como as outras. Escolha o titular da verba");
    return;
  }
  if (!d.verba_titular_tipo) {
    falha("Escolha o titular da verba");
    return;
  }
  if (d.verba_titular_tipo === "fornecedor") {
    if (!d.fornecedor_id) falha("Escolha o fornecedor");
    if (d.verba_titular_id) falha("O terceiro é o fornecedor escolhido");
  } else {
    if (!d.verba_titular_id) falha("Escolha o titular da verba");
    if (d.fornecedor_id || d.pagamento_fora_do_cadastro) falha("Só o terceiro tem fornecedor");
  }
});

/** Ver `PP_URGENTE_JUSTIFICATIVA_MIN` — a tela usa o mesmo número. */
const MIN_JUSTIFICATIVA_URGENTE = PP_URGENTE_JUSTIFICATIVA_MIN;

type CamposDeUrgencia = {
  urgente: boolean;
  urgente_justificativa: string | null;
  urgente_por: string | null;
  urgente_em: string | null;
};

/**
 * Os quatro campos de urgência a gravar, ou o erro (decisão 077).
 *
 * Quem MARCOU e quando só mudam na virada: a PP passa a ser urgente, ou
 * deixa de ser. Corrigir a justificativa de uma PP que já era urgente não
 * troca o autor da marca.
 */
function camposDeUrgencia(
  d: { urgente?: boolean; urgente_justificativa?: string | null },
  anterior: { urgente: boolean; urgente_por: string | null; urgente_em: string | null } | null,
  profileId: string,
): { ok: true; campos: CamposDeUrgencia } | { ok: false; message: string } {
  if (!d.urgente) {
    return {
      ok: true,
      campos: { urgente: false, urgente_justificativa: null, urgente_por: null, urgente_em: null },
    };
  }
  const justificativa = (d.urgente_justificativa ?? "").trim();
  if (justificativa.length < MIN_JUSTIFICATIVA_URGENTE) {
    return {
      ok: false,
      message: `Justifique o pagamento urgente (mín. ${MIN_JUSTIFICATIVA_URGENTE} caracteres).`,
    };
  }
  const jaEraUrgente = anterior?.urgente === true;
  return {
    ok: true,
    campos: {
      urgente: true,
      urgente_justificativa: justificativa,
      urgente_por: jaEraUrgente ? anterior.urgente_por : profileId,
      urgente_em: jaEraUrgente ? anterior.urgente_em : new Date().toISOString(),
    },
  };
}

/**
 * Prazo e parcelas só em janela de pagamento (decisão 077): dia 08 ou 20,
 * e fim de semana passa para a segunda. Nunca no passado. E o 1º
 * vencimento só numa janela que ainda aceita envio hoje (decisão 157).
 *
 * A data que já estava gravada e não mudou passa, mesmo fora da regra: é a
 * PP gerada antes de 14/09/2026, que só precisa obedecer quando alguém
 * trocar a data (pergunta 6a). Sem esta checagem aqui, a regra dependeria
 * só do calendário da tela.
 *
 * `quartaLiberada` vem de `ppAceitaQuarta`: a PP urgente (decisão 172) e,
 * desde 16/10/2026, a verba, urgente ou não.
 */
function validarVencimentosNasJanelas(
  datas: string[],
  gravadas: string[],
  feriados: string[],
  quartaLiberada: boolean,
): string | null {
  const hoje = hojeEmSaoPauloIso();
  for (let i = 0; i < datas.length; i++) {
    const data = datas[i].slice(0, 10);
    const br = data.split("-").reverse().join("/");
    // A quarta de exceções só vale na PP urgente e na verba (decisão 172) —
    // mesmo a gravada, quando a urgência ou a verba sai. As PPs de antes da
    // 077 com o prazo numa quarta são de setembro e já estão no financeiro.
    if (i === 0 && !quartaLiberada && ehQuarta(data) && !ehJanelaDePagamento(data) && data >= INICIO_DA_QUARTA) {
      return `A quarta de exceções (${br}) só vale para verba ou pagamento urgente. Marque a urgência ou escolha uma janela: a primeira possível hoje é ${isoParaBr(primeiraJanelaComEnvioAberto(hoje, feriados))}.`;
    }
    // A data gravada que não mudou passa (pergunta 6a da 077). Da 2ª parcela
    // em diante, só se a anterior também não mudou: com ela andando, a
    // distância entre as duas precisa valer de novo (decisão 172).
    const igual = gravadas[i]?.slice(0, 10) === data;
    const anteriorIgual = i === 0 || gravadas[i - 1]?.slice(0, 10) === datas[i - 1].slice(0, 10);
    if (igual && anteriorIgual) continue;
    if (data < hoje) {
      return `O vencimento ${br} já passou. Escolha uma janela de pagamento a partir de hoje.`;
    }
    if (i === 0) {
      const quarta = quartaLiberada && ehQuarta(data) && !ehJanelaDePagamento(data);
      if (!quarta && !ehJanelaDePagamento(data)) {
        return quartaLiberada
          ? `${br} não é uma janela de pagamento nem uma quarta de exceções. A California paga nos dias 08 e 20 — caindo em fim de semana, na segunda-feira seguinte — e, na verba e no pagamento urgente, nas quartas.`
          : `${br} não é uma janela de pagamento. A California paga nos dias 08 e 20 — caindo em fim de semana, na segunda-feira seguinte.`;
      }
      // O prazo de envio (decisão 157; na quarta, a sexta anterior) só pesa
      // no 1º vencimento: as parcelas seguintes vêm depois dele.
      const erroPrazo = erroDoPrazoDeEnvio(data, hoje, feriados, quartaLiberada);
      if (erroPrazo) return erroPrazo;
      continue;
    }
    // Da 2ª em diante (decisão 172): só janela, e nunca a janela logo
    // depois da anterior. Adiar é livre.
    if (!ehJanelaDePagamento(data)) {
      return `A ${i + 1}ª parcela (${br}) não está numa janela de pagamento. Só o 1º vencimento pode cair numa quarta de exceções.`;
    }
    const minima = primeiraDataDaProximaParcela(datas[i - 1]);
    if (data < minima) {
      return `A ${i + 1}ª parcela (${br}) precisa pular a janela logo depois da anterior: a primeira data possível é ${isoParaBr(minima)}.`;
    }
  }
  return null;
}

/** A regra da quarta de exceções entrou em 14/10/2026 (decisão 172). */
const INICIO_DA_QUARTA = "2026-10-14";

/**
 * O vencimento ainda aceita envio hoje (decisão 157)? A PP chega ao
 * financeiro até 15 dias corridos antes da janela (no dia útil anterior,
 * caindo em fim de semana ou feriado nacional); na quarta de exceções, até
 * a sexta anterior (decisão 172). Null = aceita.
 */
function erroDoPrazoDeEnvio(
  vencimento: string,
  hoje: string,
  feriados: string[],
  quartaLiberada: boolean,
): string | null {
  if (vencimentoAceitaEnvio(vencimento, hoje, feriados)) return null;
  const limite = dataLimiteDeEnvio(vencimento, feriados);
  const primeira = primeiraDataPossivelDoPrazo(hoje, feriados, quartaLiberada);
  if (limite && !ehJanelaDePagamento(vencimento)) {
    return `A quarta de exceções ${isoParaBr(vencimento)} fechou em ${isoParaBr(limite)}: ela só pode ser escolhida, e a PP enviada, até a sexta anterior. A primeira data possível hoje é ${isoParaBr(primeira)}.`;
  }
  return limite
    ? `O prazo de envio para o vencimento ${isoParaBr(vencimento)} terminou em ${isoParaBr(limite)}: o financeiro recebe a PP até 15 dias antes da janela. A primeira data possível hoje é ${isoParaBr(primeira)}.`
    : `${isoParaBr(vencimento)} não é uma janela de pagamento. A primeira data possível hoje é ${isoParaBr(primeira)}.`;
}

// ---------------------------------------------------------------------------
// Reembolso (decisão 187)
// ---------------------------------------------------------------------------

/** O desgaste por km do reembolso de veículo próprio: o valor da casa que
 *  só o financeiro altera (`financeiro_parametros`). Sem a linha, o da
 *  planilha (R$ 0,40). */
async function desgastePorKmVigente(supabase: ReturnType<typeof createClient>, tenantId: string): Promise<number> {
  const { data, error } = await supabase
    .from("financeiro_parametros")
    .select("valor")
    .eq("tenant_id", tenantId)
    .eq("chave", "reembolso_desgaste_por_km")
    .maybeSingle<{ valor: number | string }>();
  if (error) console.error("[reembolso.desgaste]", error.message);
  return data ? Number(data.valor) : DESGASTE_POR_KM_PADRAO;
}

/** O formulário pede o desgaste quando a pessoa escolhe "Veículo próprio". */
export async function desgastePorKmDoReembolso(): Promise<number> {
  const session = await requireSession();
  return desgastePorKmVigente(createClient(), session.activeTenant.id);
}

/**
 * O reembolso que a PP grava (decisão 187). Fora dele, as colunas nulas.
 * No veículo próprio, o servidor refaz a conta dos deslocamentos — ela é o
 * valor da PP — e o desgaste por km aceito é o vigente ou o que a PP (ou a
 * PP a emitir) já guardava: a PP fica com o desgaste da data em que nasceu.
 */
async function conferirReembolso(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  d: {
    verba_producao: boolean;
    tipo_verba?: TipoVerba | null;
    reembolso_tipo?: ReembolsoTipo | null;
    deslocamentos?: DeslocamentosDoReembolso | null;
    valor_unitario: number;
    quantidade: number;
    dias_meses: number;
  },
  desgasteJaGuardado: number | null,
): Promise<
  Result<{
    colunas: { reembolso_tipo: ReembolsoTipo | null; reembolso_deslocamentos: DeslocamentosDoReembolso | null };
  }>
> {
  if (tipoDaVerbaDosDados(d) !== "reembolso") {
    return { ok: true, colunas: { reembolso_tipo: null, reembolso_deslocamentos: null } };
  }
  if (!d.reembolso_tipo) return { ok: false, message: "Escolha o tipo do reembolso: despesas ou veículo próprio." };
  if (d.reembolso_tipo === "despesas") {
    return { ok: true, colunas: { reembolso_tipo: "despesas", reembolso_deslocamentos: null } };
  }
  const desl = d.deslocamentos;
  if (!desl) return { ok: false, message: "Preencha os deslocamentos do veículo próprio." };
  const falta = faltaNosDeslocamentos(desl);
  if (falta) return { ok: false, message: falta };
  const vigente = await desgastePorKmVigente(supabase, tenantId);
  const aceitos = [vigente, desgasteJaGuardado].filter((x): x is number => x !== null && Number.isFinite(x));
  if (!aceitos.some((a) => Math.abs(a - desl.desgaste_por_km) < 0.00005)) {
    return {
      ok: false,
      message: `O desgaste por km mudou para ${brl(vigente)}. Feche e abra o formulário de novo para refazer a conta.`,
    };
  }
  const conta = contaDosDeslocamentos(desl);
  const valor = valorDaPPPorUnidade(d.valor_unitario, d.quantidade, d.dias_meses);
  if (Math.abs(conta.total - valor) > 0.004) {
    return { ok: false, message: `O valor do reembolso é o da conta dos deslocamentos: ${brl(conta.total)}.` };
  }
  return {
    ok: true,
    colunas: {
      reembolso_tipo: "veiculo_proprio",
      reembolso_deslocamentos: {
        consumo_km_l: desl.consumo_km_l,
        preco_litro: desl.preco_litro,
        desgaste_por_km: desl.desgaste_por_km,
        linhas: desl.linhas.map((l) => ({
          data: l.data,
          trajeto: l.trajeto.trim(),
          km_ida_volta: l.km_ida_volta,
          vezes: l.vezes,
        })),
      },
    },
  };
}

/** Os anexos do envio de um reembolso, na regra dos comprovantes. */
function faltaNosAnexosDoReembolso(anexos: AnexoUploaded[], valor: number, tipo: ReembolsoTipo): string | null {
  return faltaNosComprovantesDoReembolso(
    anexos.map((a) => ({
      tipo: a.documento_tipo,
      numero: a.documento_numero,
      data: a.nf_data_emissao,
      valor: a.nf_valor,
    })),
    valor,
    tipo,
  );
}

const anexoUploadedSchema = z.object({
  anexo_id: z.string().uuid(),
  /** Que documento este arquivo é, e com que número (28/08/2026). O par
   *  anda junto: número sem tipo não identifica nada. */
  // O cupom fiscal (decisão 187) só aparece nos comprovantes do reembolso.
  documento_tipo: z.enum([...DOCUMENTO_TIPOS, "cupom_fiscal"]).nullable().default(null),
  documento_numero: z.string().trim().max(60).nullable().default(null),
  path: z.string().min(1),
  nome_original: z.string().min(1),
  tamanho_bytes: z.number().int().positive(),
  mimetype: z.enum(PP_ANEXO_MIMETYPES_ACEITOS),
  /** Decisão 152: na NF, os dados que a produção informou — o valor é o
   *  TOTAL da nota e `nf_valor_na_pp`, a parte desta PP (null = a nota
   *  inteira). Opcionais até o envio ao financeiro, que cobra todos. */
  nf_data_emissao: dataSchema.nullable().default(null),
  nf_valor: z.number().positive().nullable().default(null),
  nf_tomador_estabelecimento_id: z.string().uuid().nullable().default(null),
  nf_valor_na_pp: z.number().positive().nullable().default(null),
});

/**
 * O `created_at` de cada anexo gravado num lote, na ordem da lista (do mais
 * antigo ao mais novo). Gravados juntos, todos ganhariam o mesmo `now()` e a
 * ordem da tela — o anexo mais novo em cima (decisão 153) — se perderia.
 */
function horariosEmOrdem(quantos: number): string[] {
  const agora = Date.now();
  return Array.from({ length: quantos }, (_, i) => new Date(agora + i).toISOString());
}

/** Os dados da NF do anexo, só quando ele é do tipo NF. O CNPJ vale também
 *  para a fatura e o recibo (revisão da 156, 16/10/2026). */
function nfDoAnexo(a: AnexoUploaded) {
  const nf = a.documento_tipo === "nota_fiscal";
  // Decisão 187: o comprovante do reembolso guarda a data e o valor em
  // qualquer tipo (cupom, recibo…). Fora do reembolso a tela só os manda
  // na NF.
  const comValor = nf || a.nf_valor !== null;
  return {
    nf_data_emissao: comValor ? a.nf_data_emissao : null,
    nf_valor: comValor ? a.nf_valor : null,
    nf_tomador_estabelecimento_id: documentoTemCnpj(a.documento_tipo) ? a.nf_tomador_estabelecimento_id : null,
    nf_valor_na_pp: nf ? a.nf_valor_na_pp : null,
  };
}

type AnexoUploaded = z.infer<typeof anexoUploadedSchema>;

/**
 * A empresa emissora da PP com estes anexos (revisão da 156, 16/10/2026): o
 * CNPJ do documento (nota, fatura ou recibo), quando ele diz; sem documento,
 * o escolhido no formulário. Documentos em CNPJs diferentes barram.
 */
function emissoraPelosAnexos(
  anexos: AnexoUploaded[],
  escolhido: string | null,
): { ok: true; id: string | null } | { ok: false; message: string } {
  const pelosDocumentos = emissoraDosDocumentos(anexos);
  if (pelosDocumentos.tipo === "divergente") return { ok: false, message: DOCUMENTOS_EM_CNPJS_DIFERENTES };
  return { ok: true, id: pelosDocumentos.tipo === "documento" ? pelosDocumentos.estabelecimentoId : escolhido };
}

/**
 * Enviar (e reenviar) PP ao financeiro é do GP e do administrador (decisão
 * 136): o produtor gera, mas não envia — a não ser o Produtor Responsável
 * do job com a chave ligada pelo GP (decisão 174). As actions de envio
 * chamam este DEPOIS de `checarGatesRealizado`.
 */
async function barrarEnvioPeloPapel(
  session: Awaited<ReturnType<typeof requireSession>>,
  ppId: string,
  job: JobParaEnvioDePP,
): Promise<{ ok: false; message: string } | null> {
  if (enviaPPNoJob(session.activeRole, session.profile.id, job)) return null;
  await logAuditEvent({
    acao: "acao_negada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: ppId,
    metadata: {
      acao_tentada: "pedido_compra.enviada_financeiro",
      motivo: "papel_sem_permissao",
      papel: session.activeRole,
    },
  });
  return { ok: false, message: "Só o GP envia PP ao financeiro." };
}

/**
 * Gates comuns: sessao, tenant, job existe, status editavel e papel.
 * Retorna { ok, session, job, item, supabase } ou { ok:false, message }.
 */
async function checarGatesRealizado(itemRealizadoId: string): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      item: {
        id: string;
        tenant_id: string;
        job_id: string;
        item_id: string | null;
        /** A linha da planilha a que esta âncora pertence. */
        job_item_orcado_id: string;
        /** Linha vermelha: nasce com orçado e planejado zero para receber
         *  custo que o orçamento não previu. Toda PP dela passa do
         *  planejado, então todo envio dela passa pelo GP (02/09/2026). */
        linha_vermelha: boolean;
        /** PLANEJADO do item na cópia do job (`jobs_itens_orcado`) — a
         *  referência da PP desde 02/09/2026 (era o orçado). Vem da cópia,
         *  e não da versão aprovada, porque é a cópia que a errata altera. */
        total_planejado: number;
        total_realizado: number;
        total_orcado: number;
        quantidade_orcada: number;
        /** Tipo de custo NA CÓPIA do job — a errata pode tê-lo trocado, e
         *  a versão aprovada não acompanha de propósito. É ele que decide
         *  a trava do `AR` (decisão 062). */
        tipo_custo: TipoCusto;
        /** Linha em save não emite PP neste job (decisão 028 §9): fica
         *  fora da trava do `AR`, senão travaria para sempre. */
        em_save: boolean;
        /** Nome do item na planilha — o chat e a auditoria da marcação
         *  precisam dele para dizer de qual linha estão falando. */
        item_nome: string;
      };
      job: {
        id: string;
        /** Vai no PDF da PP no lugar do código do orçamento (29/09/2026). */
        codigo: string;
        tenant_id: string;
        status: string;
        responsavel_id: string | null;
        empresa_id: string | null;
        produto: string | null;
        nome: string;
        projeto_id: string | null;
        orcamento_id: string | null;
        /** Errata devolveu o job ao mural: a PP da linha que a errata
         *  mudou não sai para o financeiro até a revisão da abertura ser
         *  salva (decisões 040 e 185). */
        abertura_em_revisao: boolean;
        /** O início da janela da revisão, junto do último registro da
         *  abertura (decisão 185). */
        data_abertura_financeiro: string | null;
        /** A regional do job: decide o CNPJ padrão da PP (decisão 156). */
        regional_id: string | null;
        /** Quem envia PP do job além do GP (decisão 174). */
        produtor_id: string | null;
        produtor_envia_pp: boolean;
        /** Decisão 216: o job Mídia System em auditoria dispensa a NF no
         *  envio. */
        midia_system: boolean;
        midia_system_liberado_em: string | null;
      };
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: ancora, error: itemErr } = await supabase
    .from("jobs_itens_realizado")
    .select("id, tenant_id, job_id, item_id, job_item_orcado_id, total_realizado")
    .eq("id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (itemErr || !ancora) {
    return { ok: false, message: "Item realizado não encontrado." };
  }

  // A referência da PP é o PLANEJADO do item, e ele mora na cópia do job.
  // A busca é pela CÓPIA (27/08/2026). A chave antiga fica de rede para o
  // realizado que por algum motivo não tenha sido repontado; a linha
  // criada por errata só existe pela chave nova.
  const buscaOrcado = supabase
    .from("jobs_itens_orcado")
    .select(
      "id, item, total_orcado, total_planejado, quantidade_orcada, linha_vermelha, tipo_custo, em_save, cancelada_em",
    )
    .eq("tenant_id", session.activeTenant.id);

  const { data: orcado, error: orcadoErr } = ancora.job_item_orcado_id
    ? await buscaOrcado.eq("id", ancora.job_item_orcado_id).maybeSingle()
    : await buscaOrcado
        .eq("job_id", ancora.job_id)
        .eq("item_versao_id", ancora.item_id)
        .maybeSingle();

  if (orcadoErr || !orcado) {
    return {
      ok: false,
      message: "Item não encontrado na planilha do job.",
    };
  }

  // Linha cancelada por errata (decisão 151): saiu da conta do orçado e não
  // recebe Pedido de Produção. A tela nem oferece; aqui é a trava de verdade.
  if ((orcado as any).cancelada_em) {
    return {
      ok: false,
      message: `"${(orcado as any).item ?? "A linha"}" foi cancelada por errata e não recebe Pedido de Produção.`,
    };
  }

  const item = {
    id: ancora.id,
    tenant_id: ancora.tenant_id,
    job_id: ancora.job_id,
    item_id: ancora.item_id,
    job_item_orcado_id: (orcado as any).id as string,
    linha_vermelha: (orcado as any).linha_vermelha === true,
    item_nome: ((orcado as any).item as string) ?? "Item",
    total_planejado: Number((orcado as any).total_planejado ?? 0),
    total_orcado: Number(orcado.total_orcado ?? 0),
    total_realizado: Number(ancora.total_realizado ?? 0),
    quantidade_orcada: Number(orcado.quantidade_orcada ?? 0),
    tipo_custo: (orcado as any).tipo_custo as TipoCusto,
    em_save: (orcado as any).em_save === true,
  };

  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, codigo, tenant_id, status, responsavel_id, empresa_id, produto, nome, projeto_id, orcamento_id, abertura_em_revisao, data_abertura_financeiro, regional_id, produtor_id, produtor_envia_pp, midia_system, midia_system_liberado_em",
    )
    .eq("id", item.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !jobRow) {
    return { ok: false, message: "Job não encontrado." };
  }
  const job = {
    ...jobRow,
    abertura_em_revisao: (jobRow as any).abertura_em_revisao === true,
    produtor_envia_pp: (jobRow as any).produtor_envia_pp === true,
    midia_system: (jobRow as any).midia_system === true,
    midia_system_liberado_em: ((jobRow as any).midia_system_liberado_em as string | null) ?? null,
  };

  // ⚠️ Mudou em 08/09/2026 (decisão 056). Até aqui GERAR PP exigia o job
  // já aberto (`jobAceitaAcoesPlanilha`). Agora a pré-abertura entra: a
  // PP gerada não sai do job, não conta no realizado e o financeiro não a
  // vê. O que continua preso à abertura é o ENVIO — `barrarEnvioDePP`.
  //
  // Este gate serve a gerar, editar e cancelar; o envio e o reenvio
  // chamam este E o de envio, nessa ordem.
  if (!jobAceitaGerarPP(job.status as JobStatus)) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: null,
      metadata: {
        acao_tentada: "pedido_compra.gerada",
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "Job encerrado ou cancelado não gera PP — a aba de Pedidos de Produção guarda o histórico.",
    };
  }

  // Até 01/10/2026 só o GP responsável do job (ou o administrador) passava
  // daqui. Desde a decisão 136 qualquer GP age em qualquer job, e o
  // produtor GERA, edita e cancela a PP — o ENVIO ao financeiro é que fica
  // com o GP (`barrarEnvioPeloPapel`, nas actions de envio e reenvio).
  // Conferir o papel aqui também fecha a porta das três actions que não
  // chamavam `checarPermissao` e dependiam só da checagem de dono.
  if (!pode(session.activeRole, "jobs.emitir_pp")) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: null,
      metadata: {
        acao_tentada: "pedido_compra.gerada",
        motivo: "papel_sem_permissao",
        papel: session.activeRole,
      },
    });
    return {
      ok: false,
      message: "Você não tem permissão para gerar PP.",
    };
  }

  return { ok: true, session, item, job, supabase };
}

/**
 * O que o item já tem em PPs — a base do teste do planejado no envio
 * (02/09/2026), no mesmo recorte que a planilha mostra.
 *
 * Toda PP que existe pesa, a `gerada` inclusive: desde 11/09/2026
 * (decisão 074) é ela que monta o realizado do item, e o "tem certeza?"
 * do envio precisa olhar o mesmo número que o painel exibe — senão a tela
 * acende vermelho e o servidor deixa passar calado. Quem tira uma PP da
 * conta é só o cancelamento.
 *
 * `excetoPPId` é obrigatório sempre que a PP em questão JÁ EXISTE no
 * banco — o envio, o reenvio da rejeitada, a edição: ela já está na soma
 * e não pode competir consigo mesma. Só a geração, em que a PP ainda não
 * foi gravada, chama sem ele.
 */
async function somaDasPPsDoItem(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  itemRealizadoId: string,
  excetoPPId?: string,
): Promise<number> {
  const query = supabase
    .from("pedidos_compra")
    .select("valor, status")
    .eq("item_realizado_id", itemRealizadoId)
    .eq("tenant_id", tenantId);

  const { data } = excetoPPId ? await query.neq("id", excetoPPId) : await query;

  return somaDasPPsNaoCanceladas(
    (data ?? []).map((pp) => ({ valor: Number(pp.valor), status: pp.status })),
  );
}

/** Mesmo formato das mensagens de encerramento — o usuário lê os dois
 *  avisos no mesmo fluxo. */
function formatarBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * A trava do `A · Repasse`: enquanto a soma das PPs do item não cobre o
 * orçado, nenhuma PP dele sai para o financeiro e o item não pode ser
 * marcado como concluído (decisão 062, 08/09/2026).
 *
 * No `AR` o principal passa pela California e é REPASSADO ao fornecedor.
 * Fechar o item com PPs somando menos que o orçado deixaria a agência com
 * dinheiro que era do fornecedor — por isso a trava é sobre a FALTA, e
 * passar do orçado segue livre (quem cuida do excesso é a confirmação
 * acima do planejado, da decisão 039).
 *
 * Conta as NÃO CANCELADAS, a `gerada` inclusive: contar só as enviadas
 * seria esperar o que a própria trava impede.
 *
 * Devolve a mensagem de recusa, ou `null` quando o item pode seguir.
 * Fonte única das duas chamadas — envio e conclusão —, porque duas
 * implementações da mesma trava divergem no primeiro ajuste.
 */
async function barrarARComOrcadoEmAberto(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  item: {
    id: string;
    item_nome: string;
    tipo_custo: TipoCusto;
    em_save: boolean;
    total_orcado: number;
  },
): Promise<Err | null> {
  if (!exigeSomaIgualAoOrcado(item.tipo_custo, item.em_save)) return null;

  const { data } = await supabase
    .from("pedidos_compra")
    .select("valor, status")
    .eq("item_realizado_id", item.id)
    .eq("tenant_id", tenantId);

  const soma = somaDasPPsNaoCanceladas(
    (data ?? []).map((pp) => ({ valor: Number(pp.valor), status: pp.status })),
  );
  const falta = faltaParaFecharOOrcado(soma, item.total_orcado);
  if (falta <= 0) return null;

  return {
    ok: false,
    message:
      `Em custo A · Repasse as PPs precisam fechar o orçado do item antes de ir ao financeiro. ` +
      `"${item.item_nome}" tem ${formatarBRL(soma)} em PPs de um orçado de ` +
      `${formatarBRL(item.total_orcado)} — faltam ${formatarBRL(falta)}. ` +
      `Gere as PPs que faltam e envie todas juntas.`,
  };
}

/**
 * Linha com SAVE não gera PP (decisão 099, 22/09/2026).
 *
 * A linha que GERA save é faturada neste job e o serviço acontece em
 * outro: não há fornecedor a pagar aqui. Vale para a linha em save
 * (inclusive a que aguarda aprovação — a marca já está nela) e para a
 * recusada que o GP ainda não retirou: a recusa devolve a linha ao job,
 * mas ela fica travada para PP, BV e errata até alguém arquivar a recusa
 * no pop-up de save. O banco recusa o mesmo (`pp_recusa_linha_com_save`);
 * aqui a recusa chega antes, com o nome do item.
 *
 * A linha que CONSOME save continua aceitando PP e BV: o serviço dela
 * acontece neste job, só é pago com crédito de outro.
 *
 * Devolve a recusa, ou `null` quando a PP pode seguir.
 */
async function barrarPPEmLinhaComSave(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  item: { job_item_orcado_id: string; em_save: boolean; item_nome: string },
): Promise<Err | null> {
  if (item.em_save) {
    return {
      ok: false,
      message: `"${item.item_nome}" é save: o serviço não acontece neste job, então a linha não gera Pedido de Produção.`,
    };
  }
  const { data, error } = await supabase
    .from("saves_aprovacoes")
    .select("situacao")
    .eq("job_item_orcado_id", item.job_item_orcado_id)
    .eq("tenant_id", tenantId)
    .eq("tipo", "gera")
    .in("situacao", ["aguardando", "recusado"])
    .limit(1);
  if (error) {
    // Sem saber, não emite: é o lado seguro, e o banco recusaria de todo
    // jeito se a linha tivesse save.
    console.error("[pp.save_da_linha]", error.message);
    return {
      ok: false,
      message: "Não foi possível conferir o save desta linha. Tente de novo.",
    };
  }
  if ((data ?? []).length > 0) {
    return {
      ok: false,
      message: `"${item.item_nome}" teve o save recusado pelo financeiro, e a recusa ainda não foi retirada. A linha só volta a gerar Pedido de Produção depois de o GP retirar o save recusado, pelo pop-up da coluna Save.`,
    };
  }
  return null;
}

/**
 * O envio pediu confirmação: o item passaria do planejado.
 *
 * Não é erro de validação — é a regra de 02/09/2026: acima do planejado,
 * só o responsável do job ou administrador envia, e depois de ver o
 * quanto o item fica acima. O cliente mostra o "tem certeza?" com estes
 * números e chama de novo com `confirmarAcimaDoPlanejado = true`.
 */
export interface AcimaDoPlanejado {
  planejado: number;
  emPPsDepois: number;
  excedente: number;
}

/** A empresa emissora que mudou porque o documento estava em outro CNPJ
 *  (revisão da 156, 16/10/2026), com os nomes curtos para o aviso. */
export interface TrocaDeEmissora {
  de: string | null;
  para: string;
}

export type ResultadoEnvio =
  | { ok: true; codigo: string; emissora: TrocaDeEmissora | null }
  | { ok: false; message: string; acimaDoPlanejado?: AcimaDoPlanejado };

/**
 * O CNPJ da PP na geração (decisão 156): o escolhido no formulário ou, sem
 * ele, o padrão do job (regional → empresa gerencial → principal). Confere
 * que é um CNPJ ativo do cadastro de impostos e devolve os dados que o PDF
 * põe no cabeçalho.
 */
async function cnpjDaPPNaGeracao(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  job: { regional_id: string | null; empresa_id: string | null },
  escolhido: string | null,
): Promise<{ ok: true; id: string; empresa: ReturnType<typeof empresaDoDocumento> } | { ok: false; message: string }> {
  const [estabRes, empresasRes, regionalRes] = await Promise.all([
    supabase
      .from("fiscal_estabelecimentos")
      .select(
        "id, nome, cnpj, ativo, papel, ordem, municipio, uf, logradouro, numero, complemento, bairro, cep, telefone, email, inscricao_estadual, inscricao_municipal, contabil:empresas_contabeis(razao_social)",
      )
      .eq("tenant_id", tenantId),
    supabase.from("empresas").select("id, cnpj, principal").eq("tenant_id", tenantId),
    job.regional_id
      ? supabase
          .from("fiscal_cnpj_da_pp_por_regional")
          .select("estabelecimento_id")
          .eq("tenant_id", tenantId)
          .eq("regional_id", job.regional_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (estabRes.error) return { ok: false, message: "Não foi possível ler o cadastro de CNPJs." };
  type Estab = CnpjDoDocumento & {
    id: string;
    ativo: boolean;
    papel: string;
    ordem: number | null;
    contabil: { razao_social: string | null } | Array<{ razao_social: string | null }> | null;
  };
  const estabs = (estabRes.data ?? []) as unknown as Estab[];
  const ativos = estabs.filter((e) => e.ativo && (e.cnpj ?? "").replace(/\D/g, "").length === 14);
  const padrao = tomadoresPadrao(
    ativos.map((e) => ({ id: e.id, cnpj: e.cnpj, ativo: e.ativo, papel: e.papel, ordem: Number(e.ordem ?? 0) })),
    ((empresasRes.data ?? []) as Array<{ id: string; cnpj: string | null; principal: boolean | null }>),
  );
  const daRegional = (regionalRes.data as { estabelecimento_id: string } | null)?.estabelecimento_id;
  const id =
    escolhido ??
    cnpjPadraoDaPP(job, {
      porRegional: job.regional_id && daRegional ? { [job.regional_id]: daRegional } : {},
      porEmpresa: padrao.porEmpresa,
      geral: padrao.geral,
      ativos: new Set(ativos.map((e) => e.id)),
    });
  const estab = id ? ativos.find((e) => e.id === id) : undefined;
  if (!estab) {
    return { ok: false, message: "Escolha o CNPJ da PP entre os CNPJs ativos do cadastro de impostos." };
  }
  const contabil = Array.isArray(estab.contabil) ? estab.contabil[0] : estab.contabil;
  return { ok: true, id: estab.id, empresa: empresaDoDocumento(estab, contabil?.razao_social ?? null) };
}

/** O que o PDF da PP carrega além dela: projeto, orçamento, cliente e o
 *  responsável do projeto. Uma leitura só, usada pela geração, pela edição
 *  e pelo reenvio — os três documentos têm que sair iguais. */
interface ContextoPdf {
  projeto: { campanha: string | null };
  cliente: { nome_fantasia: string };
  responsavelNome: string;
  /** Revisão da 156 (16/10/2026): a empresa gerencial e a regional do job,
   *  embaixo do "Job:". Sempre as do job. */
  empresaGerencial: string | null;
  regional: string | null;
}

async function carregarContextoPdf(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  job: { id: string; projeto_id: string | null; empresa_id: string | null; regional_id: string | null },
): Promise<ContextoPdf> {
  const [projetoRes, clienteRes, empresaRes, regionalRes] = await Promise.all([
    supabase
      .from("projetos")
      .select("id, campanha, responsavel:profiles!responsavel_id(nome)")
      .eq("id", job.projeto_id ?? "")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    // O cliente do PDF é o do job (decisão 215): o do orçamento dele.
    supabase
      .from("jobs")
      .select("cliente:clientes!jobs_cliente_id_fkey(nome_fantasia)")
      .eq("id", job.id)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ cliente: { nome_fantasia: string } | null }>(),
    job.empresa_id
      ? supabase
          .from("empresas")
          .select("nome_fantasia, razao_social")
          .eq("id", job.empresa_id)
          .eq("tenant_id", tenantId)
          .maybeSingle<{ nome_fantasia: string | null; razao_social: string }>()
      : Promise.resolve({ data: null }),
    job.regional_id
      ? supabase
          .from("regionais")
          .select("nome")
          .eq("id", job.regional_id)
          .eq("tenant_id", tenantId)
          .maybeSingle<{ nome: string }>()
      : Promise.resolve({ data: null }),
  ]);
  const empresa = empresaRes.data as { nome_fantasia: string | null; razao_social: string } | null;
  const regional = regionalRes.data as { nome: string } | null;

  const projeto = projetoRes.data as {
    campanha: string | null;
    responsavel: { nome: string } | null;
  } | null;

  return {
    projeto: { campanha: projeto?.campanha ?? null },
    cliente: { nome_fantasia: clienteRes.data?.cliente?.nome_fantasia ?? "" },
    responsavelNome: projeto?.responsavel?.nome ?? "",
    empresaGerencial: empresa ? (empresa.nome_fantasia ?? empresa.razao_social) : null,
    regional: regional?.nome ?? null,
  };
}

/**
 * A conta e o PIX do colaborador titular da verba, lidos da PP já gravada
 * (decisão 171): quem copia da ficha do RH é o gatilho do banco, que a
 * tela não alcança. Null quando a ficha não tem conta nem PIX.
 */
async function fotoDoTitularDaPP(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ppId: string,
): Promise<PagamentoDoTitularNoPdf | null> {
  const { data, error } = await supabase
    .from("pedidos_compra")
    .select(COLUNAS_DA_FOTO_DO_TITULAR)
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) console.error("[pp.foto_do_titular]", error.message);
  return data ? pagamentoDoTitularDaPP(data as Parameters<typeof pagamentoDoTitularDaPP>[0]) : null;
}

/**
 * O documento da PP, com todas as parcelas, renderizado em memória
 * (decisão 112, 28/09/2026). Até ali era um documento por parcela.
 *
 * O financeiro aprova a PP inteira e as parcelas seguem juntas para
 * Títulos a Pagar, então um papel só, com o valor e o prazo de cada
 * parcela e o total do pedido, é o que o fornecedor e o financeiro leem.
 * A verba paga a uma pessoa também gera PDF, com layout adaptado — ver
 * `lib/pdf/pedido-compra.ts`.
 *
 * Quem chama decide o que fazer com o buffer: a geração desfaz a PP se o
 * upload falhar; a edição e o reenvio sobrescrevem o documento anterior.
 */
/** Decisão 190: o selo da PP gerada, ainda fora do financeiro. */
const SELO_NAO_ENVIADA: SeloDaPP = { tipo: "nao_enviada" };

/** Decisão 190: o selo que o status gravado pede. A PP gerada e a cancelada
 *  não valem para pagamento; as demais (em avaliação, aprovada, paga e a
 *  rejeitada, que já passou pelo financeiro) saem limpas. */
function seloPeloStatus(status: PPStatus, canceladaEm: string | null): SeloDaPP | null {
  if (status === "gerada") return SELO_NAO_ENVIADA;
  if (status === "cancelada") return { tipo: "cancelada", em: canceladaEm ?? new Date().toISOString() };
  return null;
}

/** Decisão 191: o nome do item da planilha, pela âncora do realizado, para
 *  quem relê a PP gravada e refaz o PDF. */
const ITEM_DA_PP = "realizado:jobs_itens_realizado(copia:jobs_itens_orcado(item))";
type ItemDaPPEmbutido = { copia: { item: string | null } | null } | null;
function nomeDoItemDaPP(realizado: ItemDaPPEmbutido): string {
  return realizado?.copia?.item ?? "Item";
}

async function renderizarDocumentoDaPP(args: {
  tenantId: string;
  jobId: string;
  ppId: string;
  codigo: string;
  pp: {
    servico: string;
    quantidade: number;
    especificacoes: string | null;
    valor: number;
    verba_producao: boolean;
    tipo_verba?: TipoVerba | null;
    /** Decisão 171: nulo na verba = verba de produção anterior (responsável). */
    verba_titular_tipo: TitularDaVerbaTipo | null;
    /** Decisão 187: o tipo do reembolso e, no veículo próprio, a conta que
     *  sai em tabela. Obrigatórios: um chamador que os esquecesse refaria o
     *  PDF do reembolso sem os deslocamentos. */
    reembolso_tipo: ReembolsoTipo | null;
    reembolso_deslocamentos: DeslocamentosDoReembolso | null;
  };
  empresa: unknown;
  fornecedor: unknown | null;
  /** Decisão 209: a plataforma e o link da PP no cartão corporativo, que
   *  não tem fornecedor. Obrigatório: um chamador que o esquecesse soltaria
   *  o documento do cartão com o bloco do fornecedor em branco. */
  cartao: CartaoCorporativo | null;
  responsavelVerbaNome: string | null;
  /** Decisão 171: a conta e o PIX do colaborador titular (da foto da PP). */
  pagamentoDoTitular: PagamentoDoTitularNoPdf | null;
  job: { codigo: string; nome: string; produto: string };
  /** Decisão 191: o nome do item da planilha, embaixo do Serviço. */
  itemNome: string;
  contexto: ContextoPdf;
  parcelas: Array<{ numero: number; data_vencimento: string; valor: number }>;
  /** A data de emissão impressa. Ausente = agora (a geração); o
   *  "Atualizar vencimento" (decisão 157) mantém a da PP. */
  emitidaEm?: string;
  /** Decisão 161: a PP paga por boleto — o PDF troca a linha do PIX por
   *  "Pagamento: Boleto"; na paga por guia (227), "Pagamento: Guia". */
  pagamentoPeloAnexo?: MeioPeloAnexo | null;
  /** Decisão 178: a prévia da conferência — marca d'água e sem gravar. */
  previa?: boolean;
  /** Decisão 190: o selo "não pague" da PP gerada e da cancelada; null na
   *  enviada. Obrigatório pelo mesmo motivo do `selo` do gerador. */
  selo: SeloDaPP | null;
}): Promise<{ path: string; buffer: Buffer }> {
  // Import dinâmico: só carrega pdfmake QUANDO vai gerar PDF, isolando
  // seus side-effects de inicialização do resto do módulo.
  const { renderPedidoCompraPDF } = await import("@/lib/pdf/pedido-compra");
  const parcelas = args.parcelas.slice().sort((a, b) => a.numero - b.numero);

  const buffer = await renderPedidoCompraPDF({
    pp: {
      codigo: args.codigo,
      servico: args.pp.servico,
      quantidade: args.pp.quantidade,
      especificacoes: args.pp.especificacoes,
      valor: args.pp.valor,
      prazo_pagamento: parcelas[0]?.data_vencimento ?? "",
      created_at: args.emitidaEm ?? new Date().toISOString(),
      verba_producao: args.pp.verba_producao,
      tipo_verba: args.pp.tipo_verba ?? null,
      verba_titular_tipo: args.pp.verba_titular_tipo,
      reembolso_tipo: args.pp.reembolso_tipo,
      reembolso_deslocamentos: args.pp.reembolso_deslocamentos,
    },
    pagamentoPeloAnexo: args.pagamentoPeloAnexo ?? null,
    previa: args.previa === true,
    selo: args.selo,
    empresa: args.empresa as never,
    fornecedor: (args.fornecedor ?? null) as never,
    cartaoCorporativo: args.cartao,
    responsavelVerbaNome: args.responsavelVerbaNome,
    pagamentoDoTitular: args.pagamentoDoTitular,
    job: args.job,
    empresaGerencial: args.contexto.empresaGerencial,
    regional: args.contexto.regional,
    projeto: args.contexto.projeto,
    cliente: args.contexto.cliente,
    responsavelNome: args.contexto.responsavelNome,
    itemNome: args.itemNome,
    parcelas: parcelas.map((p) => ({
      numero: p.numero,
      data_vencimento: p.data_vencimento,
      valor: p.valor,
    })),
  });

  return {
    path: caminhoPdfDaPP(args.tenantId, args.jobId, args.ppId, args.codigo),
    buffer,
  };
}

/**
 * A porta única do ENVIO de PP ao financeiro. Duas travas, um lugar só.
 *
 * 1. **O job ainda não foi aberto** (`aguardando_abertura` ou
 *    `rejeitado_financeiro`). Novo em 08/09/2026, decisão 056: gerar PP
 *    passou a valer na pré-abertura, então a trava que era do gate de
 *    gerar precisou nascer aqui — senão soltar a geração soltaria junto
 *    o envio, que é o que compromete dinheiro.
 * 2. **A errata mudou a linha da PP** e a revisão da abertura ainda não
 *    foi salva (decisão 040, 02/09/2026, revista pela 185 em 16/10/2026).
 *    Até a 185 a revisão fechava o envio de TODAS as PPs do job; agora
 *    fecha só o da linha que uma errata ainda não revisada mudou
 *    (`linhasAlteradasNaRevisao`). As outras linhas enviam normalmente.
 *
 * Nos dois casos gerar, editar e cancelar continuam liberados — é o
 * ENVIO que fecha. O faturamento segue fechado pelo job inteiro em
 * revisão: a errata muda o valor do job.
 *
 * ⚠️ Era `barrarEnvioEmRevisao`, com só a segunda trava (decisão 040 §4).
 */
async function barrarEnvioDePP(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ppId: string,
  job: {
    id: string;
    status: string;
    abertura_em_revisao: boolean;
    data_abertura_financeiro: string | null;
  },
  item: { job_item_orcado_id: string; item_nome: string },
): Promise<Err | null> {
  const negar = async (motivo: string, message: string): Promise<Err> => {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId,
      entidadeTipo: "pedido_compra",
      entidadeId: ppId,
      metadata: {
        acao_tentada: "pedido_compra.enviada_financeiro",
        motivo,
        job_id: job.id,
        status_atual: job.status,
      },
    });
    return { ok: false, message };
  };

  if (!jobAceitaEnvioDePP(job.status as JobStatus)) {
    return negar(
      "job_ainda_nao_aberto",
      job.status === "rejeitado_financeiro"
        ? "O financeiro devolveu este job e ele ainda não foi aberto. A PP fica gerada, no job — o envio ao financeiro volta com a abertura."
        : "O financeiro ainda não abriu este job. A PP fica gerada, no job — o envio ao financeiro volta com a abertura.",
    );
  }

  if (job.abertura_em_revisao) {
    const linhas = await linhasAlteradasNaRevisao(supabase, tenantId, job);
    // Sem conseguir ler as erratas, trava como antes da 185: o envio é o
    // passo que compromete dinheiro.
    if (linhas === null) {
      return negar(
        "abertura_em_revisao",
        "A abertura deste job está em revisão no financeiro e não foi possível conferir as linhas da errata. Tente de novo em instantes — a PP fica gerada, no job.",
      );
    }
    if (linhas.has(item.job_item_orcado_id)) {
      return negar(
        "linha_alterada_em_revisao",
        `A errata alterou "${item.item_nome}" e a abertura está em revisão no financeiro. O envio das PPs desta linha volta quando a revisão for salva — a PP fica gerada, no job.`,
      );
    }
  }

  return null;
}

/**
 * Acima do planejado, o envio pede confirmação explícita (02/09/2026).
 *
 * Devolve o pedido de confirmação com os números, ou null quando o envio
 * pode seguir — seja porque cabe no planejado, seja porque quem envia já
 * confirmou. Quem PODE confirmar é o mesmo gate de gerar: responsável do
 * job ou administrador (decisão do Tiago, 02/09/2026).
 */
function pedirConfirmacaoAcimaDoPlanejado(
  emPPsDepois: number,
  planejado: number,
  confirmado: boolean,
): ResultadoEnvio | null {
  if (!passaDoPlanejado(emPPsDepois, planejado)) return null;
  if (confirmado) return null;
  const excedente = Math.round((emPPsDepois - planejado) * 100) / 100;
  return {
    ok: false,
    // "Fica com", e não "passa a ter": desde 11/09/2026 a PP que está
    // sendo enviada já conta no item antes do envio, então o número não
    // muda quando ela vai ao financeiro — o que muda é quem responde
    // por ele.
    message: `Este item fica com ${brl(emPPsDepois)} em PPs, ${brl(excedente)} acima do planejado de ${brl(planejado)}. Confirme o envio.`,
    acimaDoPlanejado: { planejado, emPPsDepois, excedente },
  };
}

/**
 * Fase 1 do fluxo: reserva um pp_id UUID e retorna o path prefix para
 * client fazer upload direto dos anexos pro bucket. NAO persiste no DB.
 */
/**
 * O cadastro de pagamento do fornecedor numa linha, para o formulário da
 * PP mostrar o que vale quando nada é trocado (decisão 127). Só o resumo
 * atravessa para o cliente — não o cadastro inteiro.
 */
export async function resumoDoPagamentoDoFornecedor(
  fornecedorId: string,
): Promise<Result<{ resumo: string | null; semDadosPagamento: boolean }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.emitir_pp");
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(fornecedorId).success) {
    return { ok: false, message: "Fornecedor inválido." };
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select(`${COLUNAS_DE_PAGAMENTO}, sem_dados_pagamento`)
    .eq("id", fornecedorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (error) return { ok: false, message: "Não foi possível ler o cadastro do fornecedor." };
  const semDadosPagamento =
    (data as { sem_dados_pagamento?: boolean } | null)?.sem_dados_pagamento === true;
  return {
    ok: true,
    resumo: semDadosPagamento
      ? null
      : resumoDoCadastroDePagamento((data as DadosDePagamento | null) ?? null),
    // Decisão 161: o formulário tira "Cadastro do fornecedor" de quem não
    // tem conta nem PIX, e a PP precisa escolher chave aleatória ou boleto.
    semDadosPagamento,
  };
}

export async function reservarPedidoCompra(
  itemRealizadoId: string,
): Promise<Result<{ pp_id: string; upload_prefix: string }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.emitir_pp");
  if (!gate.ok) return gate;
  try {
    return await reservarPedidoCompraImpl(itemRealizadoId);
  } catch (err) {
    // Envelope defensivo: qualquer exceção não tratada retorna mensagem
    // amigável em vez de 500 silencioso que trava o drawer.
    console.error("[pp.reservar.exception]", err);
    return {
      ok: false,
      message: `Falha ao reservar PP: ${err instanceof Error ? err.message : "erro desconhecido"}.`,
    };
  }
}

async function reservarPedidoCompraImpl(
  itemRealizadoId: string,
): Promise<Result<{ pp_id: string; upload_prefix: string }>> {
  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;

  const { job, session, item, supabase } = gate;

  const travaMidia = await travaDoJobDeMidia(supabase, session.activeTenant.id, job.id, "pp");
  if (travaMidia) return { ok: false, message: travaMidia };

  // Linha com save não gera PP (decisão 099). Barrar já na reserva evita o
  // upload de anexos de uma PP que não vai existir.
  const comSave = await barrarPPEmLinhaComSave(supabase, session.activeTenant.id, item);
  if (comSave) return comSave;

  // Fora o save, nada barra a reserva desde 02/09/2026: o item aceita quantas PPs
  // forem necessárias, sem teto por PP. Passar do planejado não impede
  // gerar — muda quem pode ENVIAR, e isso se decide no envio. A linha
  // vermelha, que nasce zerada, finalmente ganha caminho para PP.
  const pp_id = crypto.randomUUID();
  const upload_prefix = `${session.activeTenant.id}/${job.id}/${pp_id}/anexos/`;

  return { ok: true, pp_id, upload_prefix };
}

/**
 * A geração da PP: anexos já no bucket, a action grava tudo e gera o PDF.
 *
 * ⚠️ Decisão 153 (07/10/2026): não é mais exportada. A PP só nasce da PP a
 * emitir, pelo "Gerar PP" da revisão (`gerarPPDaPPAEmitir`), que confere a
 * permissão, a trava da pré-abertura e a pergunta da última PP antes de
 * chegar aqui. A exportação antiga (`finalizarPedidoCompra`) deixaria gerar
 * por fora dessas travas.
 */
async function finalizarPedidoCompraImpl(
  pp_id: string,
  dados: z.input<typeof dadosSchema>,
  anexos: z.input<typeof anexoUploadedSchema>[],
  itemRealizadoId: string,
  ultimaPPDoItem: boolean,
): Promise<Result<{ codigo: string }>> {
  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;
  const { session, item, job, supabase } = gate;

  // Linha com save não gera PP (decisão 099) — de novo aqui, porque a
  // linha pode ter virado save entre a reserva e a gravação.
  const comSave = await barrarPPEmLinhaComSave(supabase, session.activeTenant.id, item);
  if (comSave) return comSave;

  // Valida dados
  const dadosParsed = dadosSchema.safeParse(dados);
  if (!dadosParsed.success) {
    return {
      ok: false,
      message: `Dados inválidos: ${dadosParsed.error.issues[0]?.message ?? "erro"}.`,
    };
  }
  const d = dadosParsed.data;

  // ---- Janelas de pagamento, prazo de envio e urgência (decisões 077 e 157) ----
  const erroJanela = validarVencimentosNasJanelas(
    d.parcelas.map((p) => p.data_vencimento),
    [],
    await carregarFeriadosNacionais(supabase, session.activeTenant.id),
    ppAceitaQuarta({ urgente: d.urgente === true, verba: d.verba_producao }),
  );
  if (erroJanela) return { ok: false, message: erroJanela };
  const urgencia = camposDeUrgencia(d, null, session.profile.id);
  if (!urgencia.ok) return urgencia;

  // ---- Valor da PP ----
  // O valor é o produto do trio que o GP digitou: R$ Unit. × QT × D/M. É
  // recalculado aqui de propósito — o cliente manda os três fatores, nunca
  // o total. A exceção do acumulado acima do orçado exige administrador
  // na geração (decisão 204), menos na linha vermelha (27/10/2026);
  // passar só do planejado mantém o envio. A quantidade
  // nunca limitou: 4 diárias a R$ 2.500 cabem num item de 2 a R$ 5.000.
  const valor = valorDaPPPorUnidade(
    d.valor_unitario,
    d.quantidade,
    d.dias_meses,
  );
  if (valor <= 0) {
    return {
      ok: false,
      message: "R$ Unit., QT e D/M inválidos: o valor da PP ficaria zerado.",
    };
  }

  // Decisão 223: o Comitê de Aprovações no lugar do "só o administrador"
  // da 204. A PP aprovada pelo Comitê (ou a que ela refaz) gera enquanto
  // não ficar mais cara. O gatilho `pp_confere_orcado_na_geracao` confere
  // de novo.
  const [regrasDoComite, valorAprovado] = await Promise.all([
    carregarRegrasDoComite(supabase, session.activeTenant.id),
    valorAprovadoNoComite(supabase, session.activeTenant.id, pp_id),
  ]);
  const bloqueioOrcado = bloqueioGeracaoPPPeloComite({
    papel: session.activeRole,
    regras: regrasDoComite,
    realizadoComAPP: Math.round((item.total_realizado + valor) * 100) / 100,
    orcado: item.total_orcado,
    linhaVermelha: item.linha_vermelha,
    valor,
    valorAprovado,
  });
  if (bloqueioOrcado) {
    await logAuditEvent({
      acao: "acao_negada", tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra", entidadeId: pp_id,
      metadata: { acao_tentada: "pedido_compra.gerada", motivo: "realizado_acima_do_orcado", realizado: item.total_realizado, valor, orcado: item.total_orcado },
    });
    return { ok: false, message: bloqueioOrcado };
  }

  // Só para o registro de auditoria: o envio refaz esta conta na hora.
  // Sem `exceto`: esta PP ainda não foi gravada, então não está na soma.
  const emPPsAntes = await somaDasPPsDoItem(
    supabase,
    session.activeTenant.id,
    itemRealizadoId,
  );

  if (!parcelasFecham(d.parcelas.map((p) => p.valor), valor)) {
    return {
      ok: false,
      message: `A soma das parcelas precisa fechar com o valor da PP (${brl(valor)}).`,
    };
  }

  // Valida anexos array.
  //
  // O anexo deixou de travar a GERAÇÃO em 02/09/2026: a PP pode nascer sem
  // nota e ficar no job. O que exige o anexo é o ENVIO ao financeiro
  // (`enviarPedidoCompraAoFinanceiro`). Verba de Produção segue sem anexo
  // nos dois momentos: é adiantamento, e as notas entram na prestação de
  // contas (27/08/2026).
  const anexosParsed = z.array(anexoUploadedSchema).safeParse(anexos);
  if (!anexosParsed.success) {
    return { ok: false, message: "Formato de anexo inválido." };
  }
  const nfNoCartao = notaNoCartao(cartaoDe(d), anexosParsed.data);
  if (nfNoCartao) return { ok: false, message: nfNoCartao };

  // Valida tamanhos + prefix
  const expectedPrefix = `${session.activeTenant.id}/${job.id}/${pp_id}/anexos/`;
  const somaBytes = anexosParsed.data.reduce((s, a) => s + a.tamanho_bytes, 0);
  if (somaBytes > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
    return { ok: false, message: "Anexos somam mais que 25 MB." };
  }
  for (const a of anexosParsed.data) {
    if (a.tamanho_bytes > PP_ANEXO_TAMANHO_MAX_BYTES) {
      return { ok: false, message: `Anexo ${a.nome_original} > 8 MB.` };
    }
    if (!a.path.startsWith(expectedPrefix)) {
      return { ok: false, message: "Anexo em path inválido." };
    }
  }

  // Verifica que arquivos existem no bucket (defense-in-depth contra metadata forjada)
  const { data: arquivosNoBucket, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(expectedPrefix.replace(/\/$/, ""));

  if (listErr) {
    return { ok: false, message: `Falha ao listar anexos: ${listErr.message}` };
  }
  const nomesNoBucket = new Set(
    (arquivosNoBucket ?? []).map((f) => `${expectedPrefix}${f.name}`),
  );
  for (const a of anexosParsed.data) {
    if (!nomesNoBucket.has(a.path)) {
      return {
        ok: false,
        message: `Anexo ${a.nome_original} não foi encontrado no bucket. Refaça o upload.`,
      };
    }
  }

  // Valida FKs (fornecedor ou titular + empresa pertencem ao tenant). A
  // verba valida o titular (decisões 164 e 171); a de um terceiro tem
  // fornecedor, como a PP comum.
  const tipoVerba = tipoDaVerbaDosDados(d);
  const pagaFornecedor = usaFornecedor(d);
  const [fornRes, empRes] = await Promise.all([
    !pagaFornecedor
      ? Promise.resolve({ data: null })
      : supabase
          .from("fornecedores")
          .select("*")
          .eq("id", d.fornecedor_id as string)
          .eq("tenant_id", session.activeTenant.id)
          .eq("status", "ativo")
          .maybeSingle(),
    // A gerencial é a do job (decisão 156); a do formulário só vale se o
    // job não tiver empresa.
    supabase
      .from("empresas")
      .select("id")
      .eq("id", job.empresa_id ?? d.empresa_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
  ]);

  if (pagaFornecedor && !fornRes.data)
    return { ok: false, message: "Fornecedor inválido ou inativo." };
  // Decisão 161: fornecedor sem conta nem PIX no cadastro só sai com chave
  // aleatória ou boleto — a tela já tira "Cadastro do fornecedor" dele.
  if (
    pagaFornecedor &&
    (fornRes.data as { sem_dados_pagamento?: boolean } | null)?.sem_dados_pagamento === true &&
    !foraDoCadastroDe(d)
  ) {
    return {
      ok: false,
      message: "Este fornecedor não tem conta nem PIX no cadastro: escolha chave aleatória ou boleto.",
    };
  }
  const titular = await nomeDoTitularDaVerba(
    supabase,
    session.activeTenant.id,
    d,
    fornRes.data as { nome?: string | null; razao_social?: string | null } | null,
  );
  if (!titular.ok) return titular;
  // Decisão 193: o PIX ou a conta digitados de quem não paga pelo cadastro.
  const pagTitular = pagamentoDoTitularNaGravacao(d, titular.pagaPeloCadastro);
  if (!pagTitular.ok) return pagTitular;
  if (!empRes.data)
    return { ok: false, message: "A empresa gerencial do job não foi encontrada." };
  // Decisão 187: os dados vêm da PP a emitir, já conferidos ao salvar — o
  // desgaste guardado nela vale. A conta é refeita aqui de novo.
  const reembolso = await conferirReembolso(
    supabase,
    session.activeTenant.id,
    d,
    d.verba_producao ? (d.deslocamentos?.desgaste_por_km ?? null) : null,
  );
  if (!reembolso.ok) return reembolso;

  // Decisão 156: o CNPJ da PP (o do PDF). Revisão de 16/10/2026: com
  // documento que diga o CNPJ, a empresa emissora é a dele.
  const emissora = emissoraPelosAnexos(anexosParsed.data, d.estabelecimento_id ?? null);
  if (!emissora.ok) return emissora;
  const cnpjDaPP = await cnpjDaPPNaGeracao(
    supabase,
    session.activeTenant.id,
    { regional_id: job.regional_id, empresa_id: job.empresa_id },
    emissora.id,
  );
  if (!cnpjDaPP.ok) return cnpjDaPP;

  // Gera codigo
  let codigo: string;
  try {
    codigo = await gerarCodigoPP(supabase, session.activeTenant.id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Falha ao gerar codigo.";
    return { ok: false, message: msg };
  }

  // Usa as datas validadas pelo Zod; não sobrescreve o que o user editou.
  const parcelasFinais = d.parcelas;

  // INSERT pedidos_compra (pdf_path = '' placeholder)
  const { error: insertErr } = await supabase.from("pedidos_compra").insert({
    id: pp_id,
    tenant_id: session.activeTenant.id,
    codigo,
    item_realizado_id: itemRealizadoId,
    job_id: job.id,
    // PP normal: o fornecedor. Verba: o titular (decisões 164 e 171) — o
    // terceiro também em fornecedor_id. Reembolso: o titular, o tipo e os
    // deslocamentos (decisão 187).
    ...colunasDaVerba(d, titular.nome),
    ...reembolso.colunas,
    empresa_id: job.empresa_id ?? d.empresa_id,
    estabelecimento_id: cnpjDaPP.id,
    servico: d.servico,
    valor_unitario: d.valor_unitario,
    quantidade: d.quantidade,
    dias_meses: d.dias_meses,
    especificacoes: d.especificacoes ?? null,
    ...urgencia.campos,
    valor,
    // Continua sendo o vencimento da 1ª parcela: é o que as views do
    // financeiro leem hoje, e o que a Tela 3.2 vai reorganizar.
    prazo_pagamento: parcelasFinais[0].data_vencimento,
    pdf_path: "",
    emitida_por: session.profile.id,
    // Nasce no job. O financeiro só a vê depois do envio (02/09/2026).
    status: "gerada",
    // A FOTO dos dados de pagamento (decisão 067). Ela sai do MESMO
    // `fornRes.data` que vai para o PDF logo abaixo — é o PDF que o
    // financeiro confere na hora de pagar, e foto e documento não podem
    // divergir. Editar a PP re-monta os dois; enviada, nenhum dos dois
    // muda mais, e é isso que "congelar" quer dizer.
    ...tirarFoto(fornRes.data as DadosDePagamento | null, foraDoCadastroDe(d)),
    dados_pagamento_congelados_em: fornRes.data ? new Date().toISOString() : null,
    // Decisão 127: a foto acima já traz o meio trocado; estas dizem qual.
    ...camposDoPagamentoForaDoCadastro(foraDoCadastroDe(d)),
    // Decisão 193: o pagamento digitado do titular sem cadastro usável.
    ...colunasDoPagamentoDoTitular(pagTitular.pagamento),
  });

  if (insertErr) {
    // Idempotência: se a duplicate key é a própria PK do pp_id que já foi
    // criada por este mesmo user com este mesmo item, é retry silencioso do
    // client (double-click, refresh no meio, etc). Retorna sucesso da PP
    // existente em vez de erro.
    const isDuplicatePk = insertErr.code === "23505";
    if (isDuplicatePk) {
      const { data: ppExistente } = await supabase
        .from("pedidos_compra")
        .select("codigo, emitida_por, item_realizado_id")
        .eq("id", pp_id)
        .eq("tenant_id", session.activeTenant.id)
        .maybeSingle();
      if (
        ppExistente &&
        ppExistente.emitida_por === session.profile.id &&
        ppExistente.item_realizado_id === itemRealizadoId
      ) {
        revalidatePath(`/jobs/${job.id}`);
        return { ok: true, codigo: ppExistente.codigo };
      }
    }
    // Rollback: apaga anexos que subiram sem row de dono.
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao salvar PP: ${insertErr.message}` };
  }

  // INSERT parcelas bulk (uma só ida ao banco, regra de PERFORMANCE.md).
  // PP sem parcelamento grava 1 parcela 1/1: nenhuma PP fica sem parcela,
  // e por isso as listas e o PDF tratam os dois casos do mesmo jeito.
  const { data: parcelasCriadas, error: parcelasErr } = await supabase
    .from("pedidos_compra_parcelas")
    .insert(
      parcelasFinais.map((p, i) => ({
        tenant_id: session.activeTenant.id,
        pedido_compra_id: pp_id,
        numero: i + 1,
        data_vencimento: p.data_vencimento,
        valor: p.valor,
        created_by: session.profile.id,
      })),
    )
    .select("id, numero, data_vencimento, valor");
  if (parcelasErr) {
    // Rollback: PP sem parcela seria PP invisível para o financeiro.
    await supabase
      .from("pedidos_compra")
      .delete()
      .eq("id", pp_id)
      .eq("tenant_id", session.activeTenant.id);
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return {
      ok: false,
      message: `Falha ao salvar as parcelas: ${parcelasErr.message}`,
    };
  }

  // INSERT anexos bulk
  const horariosDosAnexos = horariosEmOrdem(anexosParsed.data.length);
  const anexosRows = anexosParsed.data.map((a: AnexoUploaded, i: number) => ({
    id: a.anexo_id,
    tenant_id: session.activeTenant.id,
    pedido_compra_id: pp_id,
    arquivo_path: a.path,
    arquivo_nome_original: a.nome_original,
    arquivo_tamanho_bytes: a.tamanho_bytes,
    arquivo_mimetype: a.mimetype,
    documento_tipo: a.documento_tipo,
    documento_numero: a.documento_tipo ? a.documento_numero : null,
    ...nfDoAnexo(a),
    created_by: session.profile.id,
    created_at: horariosDosAnexos[i],
  }));
  const { error: anexosErr } = await supabase
    .from("pedidos_compra_anexos")
    .insert(anexosRows);
  if (anexosErr) {
    // Rollback: apaga row de pedidos_compra + anexos do bucket.
    await supabase
      .from("pedidos_compra")
      .delete()
      .eq("id", pp_id)
      .eq("tenant_id", session.activeTenant.id);
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return {
      ok: false,
      message: `Falha ao salvar anexos: ${anexosErr.message}`,
    };
  }

  // Carrega dados enriquecidos pro PDF. Na verba do colaborador e do freela,
  // a conta e o PIX vêm da foto da PP gravada: a que o banco acabou de tirar
  // do cadastro (decisões 171 e 193) ou a digitada — lida de volta, e não
  // da tela.
  const [contexto, pagamentoDoTitular] = await Promise.all([
    carregarContextoPdf(supabase, session.activeTenant.id, job),
    d.verba_producao && (d.verba_titular_tipo === "colaborador" || d.verba_titular_tipo === "freela")
      ? fotoDoTitularDaPP(supabase, session.activeTenant.id, pp_id)
      : Promise.resolve(null),
  ]);

  // ---- Um documento só, com todas as parcelas (decisão 112) ----
  // O financeiro aprova a PP inteira e as parcelas seguem juntas para
  // Títulos a Pagar: o papel é da PP, com o valor e o prazo de cada
  // parcela e o total do pedido.
  //
  // A verba paga a uma pessoa também gera PDF, com layout adaptado (bloco
  // do titular no lugar do fornecedor; dados bancários só do colaborador,
  // decisão 171) — ver `lib/pdf/pedido-compra.ts`.
  const parcelas = (parcelasCriadas ?? []).slice().sort((a, b) => a.numero - b.numero);
  let documento: { path: string; buffer: Buffer };

  try {
    documento = await renderizarDocumentoDaPP({
      tenantId: session.activeTenant.id,
      jobId: job.id,
      ppId: pp_id,
      codigo,
      pp: {
        servico: d.servico,
        quantidade: d.quantidade,
        especificacoes: d.especificacoes ?? null,
        valor,
        verba_producao: d.verba_producao,
        tipo_verba: tipoVerba,
        verba_titular_tipo: d.verba_producao ? (d.verba_titular_tipo ?? null) : null,
        ...reembolso.colunas,
      },
      // O cabeçalho é o do CNPJ da PP, não o da gerencial (decisão 156).
      empresa: cnpjDaPP.empresa,
      fornecedor: fornecedorDoDocumento(fornRes.data ?? null, foraDoCadastroDe(d)),
      pagamentoPeloAnexo: meioPeloAnexo(foraDoCadastroDe(d)?.meio),
      cartao: cartaoDe(d),
      responsavelVerbaNome: tipoVerba ? (titular.nome ?? "") : null,
      pagamentoDoTitular,
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      itemNome: item.item_nome,
      contexto,
      parcelas: parcelas.map((p) => ({
        numero: p.numero,
        data_vencimento: p.data_vencimento,
        valor: Number(p.valor),
      })),
      // Decisão 190: nasce gerada, ainda fora do financeiro.
      selo: SELO_NAO_ENVIADA,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("pedidos_compra")
      .delete()
      .eq("id", pp_id)
      .eq("tenant_id", session.activeTenant.id);
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao gerar PDF: ${msg}` };
  }

  {
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(documento.path, documento.buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadErr) {
      // Rollback inteiro: PP sem documento não vai para o fornecedor.
      await supabase
        .from("pedidos_compra")
        .delete()
        .eq("id", pp_id)
        .eq("tenant_id", session.activeTenant.id);
      await supabase.storage
        .from(BUCKET)
        .remove([documento.path, ...anexosParsed.data.map((a) => a.path)]);
      return {
        ok: false,
        message: `Falha ao subir PDF: ${uploadErr.message}`,
      };
    }
  }

  // Toda parcela aponta para o documento da PP: é o mesmo papel. O
  // `pdf_path` da parcela continua existindo por causa das PPs de 17/08 a
  // 28/09, que têm um documento por parcela.
  const pdfPath = documento.path;
  {
    const { error: errPath } = await supabase
      .from("pedidos_compra_parcelas")
      .update({ pdf_path: pdfPath })
      .eq("pedido_compra_id", pp_id)
      .eq("tenant_id", session.activeTenant.id);
    if (errPath) {
      // Documento existe no bucket; só o ponteiro falhou. Não desfaz a
      // PP por isso — avisa, que é o padrão das falhas parciais daqui. A
      // parcela sem ponteiro cai no documento da PP (`signedUrlPdfParcela`).
      console.error("[pp.parcela.pdf_path]", errPath.message);
    }
  }

  // Update pdf_path + fornecedor no realizado.
  // Verba de Produção não tem fornecedor — não sobrescreve o campo.
  const [updPP, updReal] = await Promise.all([
    supabase.from("pedidos_compra").update({ pdf_path: pdfPath }).eq("id", pp_id),
    d.verba_producao
      ? Promise.resolve({ error: null })
      : supabase
          .from("jobs_itens_realizado")
          .update({ fornecedor_id: d.fornecedor_id ?? null })
          .eq("id", itemRealizadoId)
          .eq("tenant_id", session.activeTenant.id),
  ]);

  if (updPP.error || updReal.error) {
    await supabase.storage
      .from(BUCKET)
      .remove([documento.path, ...anexosParsed.data.map((a) => a.path)]);
    await supabase
      .from("pedidos_compra")
      .delete()
      .eq("id", pp_id)
      .eq("tenant_id", session.activeTenant.id);
    return {
      ok: false,
      message: `Falha ao finalizar: ${updPP.error?.message ?? updReal.error?.message}`,
    };
  }

  // A resposta da pergunta obrigatória vale para o ITEM, não para a PP:
  // "sim" fecha o item, "não" o mantém (ou o devolve) em aberto. Falha
  // aqui não derruba a PP, que já existe — o botão do painel continua
  // sendo o caminho manual.
  const marcacao = await aplicarConclusaoDoItem(supabase, {
    tenantId: session.activeTenant.id,
    jobId: job.id,
    itemRealizadoId,
    profileId: session.profile.id,
    papel: session.activeRole,
    itemNome: item.item_nome,
    concluido: ultimaPPDoItem,
    origem: "formulario_pp",
  });
  if (!marcacao.ok) console.error("[pp.finalizar.marcacao]", marcacao.message);

  // Audit
  await logAuditEvent({
    acao: "pedido_compra.gerada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: codigo,
      valor,
      valor_unitario: d.valor_unitario,
      quantidade: d.quantidade,
      dias_meses: d.dias_meses,
      parcelas: parcelasFinais.length,
      planejado_do_item: item.total_planejado,
      em_pps_emitidas_antes: emPPsAntes,
      acima_do_planejado: passaDoPlanejado(emPPsAntes + valor, item.total_planejado),
      anexos: anexosParsed.data.length,
      ...colunasDaVerba(d, titular.nome),
      reembolso_tipo: reembolso.colunas.reembolso_tipo,
      pagamento_fora_do_cadastro: auditoriaDoForaDoCadastro(foraDoCadastroDe(d)),
      // Decisão 193: o meio digitado do titular (o dado fica na PP).
      pagamento_do_titular_digitado: pagTitular.pagamento?.meio ?? null,
      item_realizado_id: itemRealizadoId,
      job_id: job.id,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, codigo };
}

/**
 * Best-effort cleanup se user fechar drawer sem finalizar.
 * Nao persistiu nada no DB, so remove arquivos orfaos do bucket.
 */
export async function abortarReserva(
  pp_id: string,
  jobId: string,
): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.emitir_pp");
  if (!gate.ok) return gate;
  const supabase = createClient();

  // Guard: se pp_id ja esta persistido em pedidos_compra, e uma PP finalizada.
  // NAO deve ser tocada por abortarReserva (fix Critical #1 + #2 do final review).
  const { count: existente, error: countErr } = await supabase
    .from("pedidos_compra")
    .select("id", { count: "exact", head: true })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);
  if (countErr) {
    // Best-effort: se nao consegue checar, aborta operacao pra nao arriscar destruir dados
    return { ok: false, message: `Falha ao verificar PP: ${countErr.message}` };
  }
  if ((existente ?? 0) > 0) {
    return { ok: true }; // PP finalizada; nao remove nada
  }

  const prefix = `${session.activeTenant.id}/${jobId}/${pp_id}`;

  // Remove raiz do prefix (arquivos diretos)
  const { data: arquivos } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 100 });

  if (arquivos && arquivos.length > 0) {
    const paths = arquivos.map((f) => `${prefix}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
  }

  // Tambem verifica subpasta anexos/
  const { data: anexosLista } = await supabase.storage
    .from(BUCKET)
    .list(`${prefix}/anexos`, { limit: 100 });
  if (anexosLista && anexosLista.length > 0) {
    const paths = anexosLista.map((f) => `${prefix}/anexos/${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
  }

  return { ok: true };
}

export async function cancelarPedidoCompra(pp_id: string): Promise<Result> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.cancelar_pp");
  if (!gate.ok) return gate;
  const supabase = createClient();

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, tenant_id, codigo, job_id, item_realizado_id, status, jobs!inner(id, status, responsavel_id, produtor_id, produtor_envia_pp)",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };

  // PP gerada, em avaliação ou rejeitada pode ser cancelada. Paga, não: o
  // dinheiro já saiu, e desfazer isso é estorno, não cancelamento.
  // Aprovada também não: ela já é título a pagar (decisão 027), e quem
  // decide o que fazer com ela é o financeiro — a produção pede a ele
  // (Tiago, 14/09/2026).
  if (!podeCancelarPP(pp.status as PPStatus)) {
    return {
      ok: false,
      message:
        pp.status === "cancelada"
          ? "PP já está cancelada."
          : pp.status === "aprovada"
            ? "PP já foi aprovada pelo financeiro — é título a pagar. Para cancelar, fale com o financeiro."
            : "PP já foi paga — cancelar exigiria estorno pelo financeiro.",
    };
  }

  const job = (
    pp as unknown as {
      jobs: { status: string; responsavel_id: string | null; produtor_id: string | null; produtor_envia_pp: boolean };
    }
  ).jobs;
  // Mesmo gate de gerar (decisão 056): quem pôde gerar a PP na
  // pré-abertura precisa poder cancelá-la lá também — senão ela ficaria
  // presa no job até a abertura, sem caminho de volta.
  if (!jobAceitaGerarPP(job.status as JobStatus)) {
    return { ok: false, message: "Job não está em estado editável." };
  }

  // Decisão 136: qualquer GP (e o administrador) cancela — antes era só o
  // GP responsável do job. O produtor gera PP mas não a envia ao
  // financeiro; por isso cancela só a que ainda não foi enviada. Com a
  // chave do GP (decisão 174), o Produtor Responsável cancela como o GP.
  const podeCancelar =
    enviaPPNoJob(session.activeRole, session.profile.id, job) || pp.status === "gerada";
  if (!podeCancelar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: pp_id,
      metadata: {
        acao_tentada: "pedido_compra.cancelada",
        motivo: "produtor_so_cancela_pp_nao_enviada",
        status_atual: pp.status,
      },
    });
    return {
      ok: false,
      message: "O produtor só cancela PP que ainda não foi enviada ao financeiro. Peça a um GP.",
    };
  }

  // Soft delete: marca como cancelada. PDF e anexos ficam no bucket — o PDF
  // refeito com o selo "cancelada em …" (decisão 190).
  const agora = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "cancelada",
      cancelada_por: session.profile.id,
      cancelada_em: agora,
      motivo_cancelamento: null, // GP não justifica
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao cancelar PP: ${updErr.message}` };
  }

  // Zera fornecedor_id do realizado (permite gerar nova PP)
  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: null })
    .eq("id", pp.item_realizado_id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "pedido_compra.cancelada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      item_realizado_id: pp.item_realizado_id,
      job_id: pp.job_id,
      origem: "gp",
    },
  });

  // Decisão 190: a cópia baixada daqui em diante diz "cancelada · não pague".
  await trocarSeloDaPP(supabase, session.activeTenant.id, pp_id, pp.codigo);

  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

/**
 * Prefixo do bucket onde o client sobe anexos novos de uma PP existente.
 * O client não conhece o tenant_id, então quem monta o path é o server —
 * que de quebra revalida os gates antes de liberar upload.
 */
export async function prefixoAnexosPedidoCompra(
  pp_id: string,
): Promise<Result<{ upload_prefix: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: pp, error } = await supabase
    .from("pedidos_compra")
    .select("id, job_id, item_realizado_id, status")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (error || !pp) return { ok: false, message: "PP não encontrada." };
  // Gerada: a edição antes do envio (02/09/2026). Rejeitada: a correção
  // para reenvio. Nos dois casos o documento ainda não foi aceito.
  if (pp.status !== "rejeitada" && pp.status !== "gerada") {
    return {
      ok: false,
      message: "Só PP gerada ou rejeitada pode receber novos anexos.",
    };
  }

  const gate = await checarGatesRealizado(pp.item_realizado_id);
  if (!gate.ok) return gate;

  return {
    ok: true,
    upload_prefix: `${session.activeTenant.id}/${pp.job_id}/${pp_id}/anexos/`,
  };
}

// ⚠️ Decisão 153 (07/10/2026): a correção da PP rejeitada
// (`reenviarPedidoCompra`) saiu. A rejeitada não se edita mais: "Cancelar e
// refazer" (`cancelarERefazerPP`) a cancela e devolve uma PP a emitir com os
// mesmos dados, que gera outra PP, com outro código.

export async function signedUrlPdf(
  pp_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("pdf_path")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };

  if (!pp.pdf_path) {
    return { ok: false, message: "PDF ainda não disponível para esta PP." };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pp.pdf_path, PDF_TTL_SEGUNDOS);

  if (error || !data)
    return { ok: false, message: error?.message ?? "Falha URL" };
  return { ok: true, url: data.signedUrl };
}

/**
 * URL assinada do documento de UMA parcela (Tela 2.3).
 *
 * Desde a decisão 112 (28/09/2026) toda parcela aponta para o documento
 * único da PP. As PPs parceladas de 17/08 a 28/09 ainda têm um documento
 * por parcela, e é para elas que esta action continua existindo: cada
 * linha baixa o SEU papel. PP legada cai no `pdf_path` que a migration
 * backfillou; e se a parcela ainda não tiver caminho (falha no ponteiro
 * durante a emissão), cai no da PP, que existe.
 */
export async function signedUrlPdfParcela(
  parcela_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: parcela } = await supabase
    .from("pedidos_compra_parcelas")
    .select("pdf_path, pedido:pedidos_compra(pdf_path)")
    .eq("id", parcela_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ pdf_path: string | null; pedido: { pdf_path: string } | null }>();

  if (!parcela) return { ok: false, message: "Parcela não encontrada." };

  const caminho = parcela.pdf_path || parcela.pedido?.pdf_path;
  if (!caminho) {
    return { ok: false, message: "PDF ainda não disponível para esta parcela." };
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(caminho, PDF_TTL_SEGUNDOS);

  if (error || !data)
    return { ok: false, message: error?.message ?? "Falha URL" };
  return { ok: true, url: data.signedUrl };
}

export async function signedUrlAnexo(
  anexo_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("pedidos_compra_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!anexo) return { ok: false, message: "Anexo não encontrado." };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, PDF_TTL_SEGUNDOS);

  if (error || !data)
    return { ok: false, message: error?.message ?? "Falha URL" };
  return { ok: true, url: data.signedUrl };
}

/**
 * URL assinada de um anexo da PP a emitir (decisão 153, entrega 3): a
 * conferência lado a lado do formulário mostra os arquivos já salvos. Os
 * que acabaram de subir a tela mostra pelo próprio arquivo.
 */
export async function signedUrlAnexoAEmitir(
  anexo_id: string,
): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: anexo } = await supabase
    .from("pedidos_compra_a_emitir_anexos")
    .select("arquivo_path")
    .eq("id", anexo_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!anexo) return { ok: false, message: "Anexo não encontrado." };

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(anexo.arquivo_path, PDF_TTL_SEGUNDOS);

  if (error || !data)
    return { ok: false, message: error?.message ?? "Falha URL" };
  return { ok: true, url: data.signedUrl };
}

/**
 * A prévia do PDF da PP na conferência lado a lado do formulário (decisão
 * 178, 15/10/2026). É o documento que a geração vai imprimir, montado com
 * os dados do formulário como estão agora — fornecedor, valor, parcelas,
 * CNPJ da PP —, para conferir com o documento anexado antes de gerar.
 *
 * Sai SEM código ("PRÉVIA" no lugar dele) e com a marca d'água "PRÉVIA" em
 * toda página. Não grava nada, nem no banco nem no Storage: volta em base64
 * e a tela o abre num `blob:`, sem os botões de baixar e de abrir em outra
 * aba. A verba não passa por aqui: o formulário dela não tem a conferência.
 */
export async function previaDoPdfDaPP(
  itemRealizadoId: string,
  dados: z.input<typeof dadosSchema>,
): Promise<Result<{ pdf: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;
  const { item, job, supabase } = gate;
  const tenantId = session.activeTenant.id;

  const parsed = dadosSchema.safeParse(dados);
  if (!parsed.success) {
    return {
      ok: false,
      message: `A prévia aparece com o formulário preenchido: ${parsed.error.issues[0]?.message ?? "confira os campos"}.`,
    };
  }
  const d = parsed.data;
  const valor = valorDaPPPorUnidade(d.valor_unitario, d.quantidade, d.dias_meses);
  if (valor <= 0) {
    return { ok: false, message: "A prévia aparece quando R$ Unit., QT e D/M estiverem preenchidos." };
  }
  if (!parcelasFecham(d.parcelas.map((p) => p.valor), valor)) {
    return {
      ok: false,
      message: `A prévia aparece quando a soma das parcelas fechar com o valor da PP (${brl(valor)}).`,
    };
  }

  const tipoVerba = tipoDaVerbaDosDados(d);
  const pagaFornecedor = usaFornecedor(d);
  const fornRes = pagaFornecedor
    ? await supabase
        .from("fornecedores")
        .select("*")
        .eq("id", d.fornecedor_id as string)
        .eq("tenant_id", tenantId)
        .eq("status", "ativo")
        .maybeSingle()
    : { data: null };
  if (pagaFornecedor && !fornRes.data) {
    return { ok: false, message: "A prévia aparece quando o fornecedor estiver escolhido." };
  }
  const titular = await nomeDoTitularDaVerba(
    supabase,
    tenantId,
    d,
    fornRes.data as { nome?: string | null; razao_social?: string | null } | null,
  );
  if (!titular.ok) return titular;
  // Decisão 193: a prévia mostra o pagamento digitado; o do cadastro só sai
  // na PP gravada (o banco o copia, a tela não o vê).
  const pagTitularDaPrevia = titular.pagaPeloCadastro ? null : (d.verba_producao ? (d.pagamento_do_titular ?? null) : null);

  const [cnpjDaPP, contexto] = await Promise.all([
    cnpjDaPPNaGeracao(
      supabase,
      tenantId,
      { regional_id: job.regional_id, empresa_id: job.empresa_id },
      d.estabelecimento_id ?? null,
    ),
    carregarContextoPdf(supabase, tenantId, job),
  ]);
  if (!cnpjDaPP.ok) return cnpjDaPP;

  try {
    const { buffer } = await renderizarDocumentoDaPP({
      tenantId,
      jobId: job.id,
      ppId: "previa",
      codigo: "PRÉVIA",
      pp: {
        servico: d.servico,
        quantidade: d.quantidade,
        especificacoes: d.especificacoes ?? null,
        valor,
        verba_producao: d.verba_producao,
        tipo_verba: tipoVerba,
        verba_titular_tipo: d.verba_producao ? (d.verba_titular_tipo ?? null) : null,
        reembolso_tipo: d.verba_producao && tipoVerba === "reembolso" ? (d.reembolso_tipo ?? null) : null,
        reembolso_deslocamentos:
          d.verba_producao && tipoVerba === "reembolso" && d.reembolso_tipo === "veiculo_proprio"
            ? (d.deslocamentos ?? null)
            : null,
      },
      empresa: cnpjDaPP.empresa,
      fornecedor: fornecedorDoDocumento(fornRes.data ?? null, foraDoCadastroDe(d)),
      pagamentoPeloAnexo: meioPeloAnexo(foraDoCadastroDe(d)?.meio),
      cartao: cartaoDe(d),
      responsavelVerbaNome: tipoVerba ? (titular.nome ?? "") : null,
      pagamentoDoTitular: pagamentoDigitadoNoPdf(pagTitularDaPrevia),
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      itemNome: item.item_nome,
      contexto,
      parcelas: d.parcelas.map((p, i) => ({ numero: i + 1, data_vencimento: p.data_vencimento, valor: p.valor })),
      previa: true,
      // A prévia tem a marca dela ("PRÉVIA · Não vale como PP").
      selo: null,
    });
    return { ok: true, pdf: buffer.toString("base64") };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Não foi possível montar a prévia: ${msg}` };
  }
}

/**
 * O que falta nos anexos para enviar (decisão 152): pelo menos um arquivo;
 * o tipo de cada um; o número dos documentos; e, em cada NF, número,
 * emissão, valor, CNPJ tomador e a parte desta PP. A soma das partes vai
 * até o valor da PP (revisão da 152, 07/10/2026; o banco confere de novo em
 * `_conferir_partes_da_nota`). Null = nada.
 *
 * Decisão 161: a PP paga por boleto exige também o boleto (tipo Boleto) e a
 * nota (NF, recibo ou fatura — 178) — o boleto não substitui a nota.
 * Decisão 227: a PP paga por guia exige a guia (tipo Guia) e não pede nota:
 * taxa, licença ou alvará de órgão público não tem NF.
 */
function faltaNosAnexosDoEnvio(
  anexos: AnexoUploaded[],
  valorPP: number,
  pagaPeloAnexo: MeioPeloAnexo | null,
): string | null {
  if (anexos.length === 0) {
    return pagaPeloAnexo === "guia"
      ? "Anexe a guia do órgão público antes de enviar esta PP ao financeiro."
      : "Anexe a nota fiscal do fornecedor antes de enviar esta PP ao financeiro.";
  }
  if (pagaPeloAnexo === "guia" && !anexos.some((a) => a.documento_tipo === "guia")) {
    return "Esta PP é paga por guia: anexe a guia, com o tipo Guia.";
  }
  if (pagaPeloAnexo === "boleto") {
    if (!anexos.some((a) => !!a.documento_tipo && DOCUMENTO_TIPOS_FISCAIS.includes(a.documento_tipo))) {
      return "Anexe também a NF do fornecedor: o boleto não substitui a nota.";
    }
    if (!anexos.some((a) => a.documento_tipo === "boleto")) {
      return "Esta PP é paga por boleto: anexe o boleto, com o tipo Boleto.";
    }
  }
  for (const a of anexos) {
    if (!a.documento_tipo) return `Escolha o tipo de “${a.nome_original}”.`;
    const numero = (a.documento_numero ?? "").trim();
    if (a.documento_tipo !== "nota_fiscal") {
      if (!numero) return `Preencha o número do documento de “${a.nome_original}”.`;
      // Revisão da 156: fatura e recibo dizem contra qual CNPJ.
      if (documentoTemCnpj(a.documento_tipo) && !a.nf_tomador_estabelecimento_id) {
        return `Escolha contra qual CNPJ foi emitido “${a.nome_original}”.`;
      }
      continue;
    }
    if (!numero || !a.nf_data_emissao || !(a.nf_valor && a.nf_valor > 0) || !a.nf_tomador_estabelecimento_id) {
      return `Preencha a nota “${a.nome_original}”: número, data de emissão, valor e CNPJ tomador.`;
    }
    if (a.nf_data_emissao > hojeEmSaoPauloIso()) {
      return `A data de emissão da NF ${numero} está no futuro.`;
    }
    const parte = a.nf_valor_na_pp ?? a.nf_valor;
    if (!(parte > 0) || parte > a.nf_valor + 0.004) {
      return `O valor da NF ${numero} nesta PP precisa ser maior que zero e até o valor da nota.`;
    }
  }
  const chaves = anexos
    .filter((a) => a.documento_tipo === "nota_fiscal")
    .map((a) => (a.documento_numero ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^0+/, ""));
  if (chaves.some((c, i) => c !== "" && chaves.indexOf(c) !== i)) {
    return "A mesma NF aparece duas vezes nesta PP.";
  }
  const soma =
    Math.round(
      anexos
        .filter((a) => a.documento_tipo === "nota_fiscal")
        .reduce((s, a) => s + (a.nf_valor_na_pp ?? a.nf_valor ?? 0), 0) * 100,
    ) / 100;
  if (soma > valorPP + 0.004) {
    return `As NFs nesta PP somam ${formatCurrency(soma, "BRL")}, mais que o valor da PP (${formatCurrency(valorPP, "BRL")}). Em “Valor nesta PP”, informe só a parte desta PP.`;
  }
  if (emissoraDosDocumentos(anexos).tipo === "divergente") return DOCUMENTOS_EM_CNPJS_DIFERENTES;
  return null;
}

/**
 * Os anexos da PP gerada como o pop-up de envio os deixou: os que saíram da
 * lista somem (linha e arquivo), os novos entram e os que ficaram têm o
 * tipo, o número e a NF atualizados. Os novos precisam estar no lugar da PP
 * no bucket — subiram pelo `prefixoAnexosPedidoCompra`.
 */
/**
 * Confere a lista de anexos que a tela mandou para a PP, sem gravar nada:
 * o tamanho, e os arquivos novos no lugar da PP no bucket. A edição da PP
 * gerada (decisão 173) confere antes de mexer na PP; o envio, logo antes de
 * gravar os anexos.
 */
async function conferirAnexosDaPP(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  jobId: string,
  ppId: string,
  anexos: AnexoUploaded[],
): Promise<
  | { erro: string }
  | { erro: null; idsAtuais: Set<string>; novos: AnexoUploaded[]; saem: Array<{ id: string; arquivo_path: string }> }
> {
  const prefixo = `${tenantId}/${jobId}/${ppId}/anexos/`;
  const { data: atuais, error: atuaisErr } = await supabase
    .from("pedidos_compra_anexos")
    .select("id, arquivo_path")
    .eq("pedido_compra_id", ppId)
    .eq("tenant_id", tenantId);
  if (atuaisErr) return { erro: `Falha ao ler os anexos: ${atuaisErr.message}` };
  const idsAtuais = new Set((atuais ?? []).map((a) => a.id as string));
  const novos = anexos.filter((a) => !idsAtuais.has(a.anexo_id));
  const ficam = new Set(anexos.map((a) => a.anexo_id));
  const saem = (atuais ?? [])
    .filter((a) => !ficam.has(a.id as string))
    .map((a) => ({ id: a.id as string, arquivo_path: a.arquivo_path as string }));

  const somaBytes = anexos.reduce((s, a) => s + a.tamanho_bytes, 0);
  if (somaBytes > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) return { erro: "Anexos somam mais que 25 MB." };
  for (const a of novos) {
    if (a.tamanho_bytes > PP_ANEXO_TAMANHO_MAX_BYTES) return { erro: `Anexo ${a.nome_original} > 8 MB.` };
    if (!a.path.startsWith(prefixo)) return { erro: "Anexo em path inválido." };
  }
  if (novos.length > 0) {
    const { data: noBucket, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(prefixo.replace(/\/$/, ""));
    if (listErr) return { erro: `Falha ao listar anexos: ${listErr.message}` };
    const nomes = new Set((noBucket ?? []).map((f) => `${prefixo}${f.name}`));
    const faltando = novos.find((a) => !nomes.has(a.path));
    if (faltando) return { erro: `Anexo ${faltando.nome_original} não foi encontrado no bucket. Refaça o upload.` };
  }
  return { erro: null, idsAtuais, novos, saem };
}

async function gravarAnexosDoEnvio(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  profileId: string,
  jobId: string,
  ppId: string,
  anexos: AnexoUploaded[],
): Promise<string | null> {
  const prefixo = `${tenantId}/${jobId}/${ppId}/anexos/`;
  const conferencia = await conferirAnexosDaPP(supabase, tenantId, jobId, ppId, anexos);
  if (conferencia.erro !== null) return conferencia.erro;
  const { idsAtuais, novos, saem } = conferencia;

  if (saem.length > 0) {
    const { error } = await supabase
      .from("pedidos_compra_anexos")
      .delete()
      .in(
        "id",
        saem.map((a) => a.id as string),
      )
      .eq("tenant_id", tenantId);
    if (error) return `Falha ao remover anexos: ${error.message}`;
    const arquivos = saem.map((a) => a.arquivo_path as string).filter((p) => p.startsWith(prefixo));
    if (arquivos.length > 0) await supabase.storage.from(BUCKET).remove(arquivos);
  }
  if (novos.length > 0) {
    const horarios = horariosEmOrdem(novos.length);
    const { error } = await supabase.from("pedidos_compra_anexos").upsert(
      novos.map((a, i) => ({
        id: a.anexo_id,
        tenant_id: tenantId,
        pedido_compra_id: ppId,
        arquivo_path: a.path,
        arquivo_nome_original: a.nome_original,
        arquivo_tamanho_bytes: a.tamanho_bytes,
        arquivo_mimetype: a.mimetype,
        documento_tipo: a.documento_tipo,
        documento_numero: a.documento_tipo ? a.documento_numero : null,
        ...nfDoAnexo(a),
        created_by: profileId,
        created_at: horarios[i],
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) return `Falha ao salvar anexos: ${error.message}`;
  }
  for (const a of anexos.filter((x) => idsAtuais.has(x.anexo_id))) {
    const { error } = await supabase
      .from("pedidos_compra_anexos")
      .update({
        documento_tipo: a.documento_tipo,
        documento_numero: a.documento_tipo ? a.documento_numero : null,
        ...nfDoAnexo(a),
        ...(a.documento_tipo === "nota_fiscal" ? {} : { nota_fiscal_id: null }),
      })
      .eq("id", a.anexo_id)
      .eq("pedido_compra_id", ppId)
      .eq("tenant_id", tenantId);
    if (error) return `Falha ao salvar o anexo ${a.nome_original}: ${error.message}`;
  }
  return null;
}

/**
 * Refaz o PDF da PP a partir do que está gravado (revisão da 156,
 * 16/10/2026): a empresa emissora mudou porque o documento estava em outro
 * CNPJ. É o mesmo documento de antes — a data de emissão, as parcelas e o
 * pagamento da foto da PP (decisões 067 e 127) —, com o cabeçalho novo.
 * Null = deu certo.
 *
 * Decisão 190: é também quem troca o selo, porque lê o status gravado — a
 * PP gerada sai com "não enviada ao financeiro pelo sistema", a cancelada
 * com "cancelada em …", e as demais limpas. O envio ao financeiro e o
 * cancelamento a chamam depois de gravar o status novo.
 */
async function refazerPdfDaPP(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ppId: string,
): Promise<string | null> {
  const { data: ppBruta } = await supabase
    .from("pedidos_compra")
    .select(`*, parcelas:pedidos_compra_parcelas(id, numero, data_vencimento, valor), ${ITEM_DA_PP}`)
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!ppBruta) return "PP não encontrada.";
  const pp = ppBruta as unknown as FotoDePagamentoDaPP & {
    id: string;
    codigo: string;
    job_id: string;
    estabelecimento_id: string | null;
    verba_producao: boolean;
    fornecedor_id: string | null;
    responsavel_verba_id: string | null;
    tipo_verba: TipoVerba | null;
    verba_titular_nome: string | null;
    servico: string;
    especificacoes: string | null;
    quantidade: number | string;
    valor: number | string;
    pdf_path: string | null;
    created_at: string;
    dados_pagamento_congelados_em: string | null;
    verba_titular_tipo: TitularDaVerbaTipo | null;
    verba_titular_cpf: string | null;
    /** Decisão 187. */
    reembolso_tipo: ReembolsoTipo | null;
    reembolso_deslocamentos: DeslocamentosDoReembolso | null;
    pagamento_fora_do_cadastro_meio: string | null;
    /** Decisão 209. */
    cartao_corporativo: boolean | null;
    cartao_plataforma: string | null;
    cartao_link: string | null;
    parcelas: Array<{ id: string; numero: number; data_vencimento: string; valor: number | string }> | null;
    /** Decisão 191: o nome do item da planilha, para o PDF. */
    realizado: ItemDaPPEmbutido;
    /** Decisão 190: o selo sai do status gravado. */
    status: PPStatus;
    cancelada_em: string | null;
  };
  const { data: job } = await supabase
    .from("jobs")
    .select("id, codigo, nome, produto, projeto_id, empresa_id, regional_id")
    .eq("id", pp.job_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      codigo: string;
      nome: string;
      produto: string | null;
      projeto_id: string | null;
      empresa_id: string | null;
      regional_id: string | null;
    }>();
  if (!job) return "Job não encontrado.";
  const parcelas = (pp.parcelas ?? [])
    .slice()
    .sort((a, b) => a.numero - b.numero)
    .map((p) => ({ numero: p.numero, data_vencimento: p.data_vencimento.slice(0, 10), valor: Number(p.valor) }));
  if (parcelas.length === 0) return "Esta PP não tem parcelas gravadas.";

  const [fornRes, cnpjDaPP, responsavelRes, contexto] = await Promise.all([
    !pp.fornecedor_id
      ? Promise.resolve({ data: null })
      : supabase.from("fornecedores").select("*").eq("id", pp.fornecedor_id).eq("tenant_id", tenantId).maybeSingle(),
    cnpjDaPPNaGeracao(supabase, tenantId, job, pp.estabelecimento_id),
    verbaDeResponsavel(pp) && pp.responsavel_verba_id
      ? supabase.from("profiles").select("nome").eq("id", pp.responsavel_verba_id).maybeSingle()
      : Promise.resolve({ data: null }),
    carregarContextoPdf(supabase, tenantId, job),
  ]);
  if (!cnpjDaPP.ok) return cnpjDaPP.message;
  const cadastro = (fornRes.data ?? null) as Record<string, unknown> | null;
  const fornecedorDoPdf =
    cadastro && pp.dados_pagamento_congelados_em
      ? { ...cadastro, ...lerFoto(pp) }
      : fornecedorDoDocumento(
          cadastro,
          lerPagamentoForaDoCadastro(ppBruta as Parameters<typeof lerPagamentoForaDoCadastro>[0]),
        );

  let documento: { path: string; buffer: Buffer };
  try {
    documento = await renderizarDocumentoDaPP({
      tenantId,
      jobId: job.id,
      ppId: pp.id,
      codigo: pp.codigo,
      pp: {
        servico: pp.servico,
        quantidade: Number(pp.quantidade),
        especificacoes: pp.especificacoes ?? null,
        valor: Number(pp.valor),
        verba_producao: pp.verba_producao,
        tipo_verba: pp.tipo_verba,
        verba_titular_tipo: pp.verba_titular_tipo ?? null,
        reembolso_tipo: pp.reembolso_tipo ?? null,
        reembolso_deslocamentos: pp.reembolso_deslocamentos ?? null,
      },
      empresa: cnpjDaPP.empresa,
      fornecedor: fornecedorDoPdf,
      cartao: cartaoDaLinha(pp),
      pagamentoDoTitular: pagamentoDoTitularDaPP(pp),
      pagamentoPeloAnexo: meioPeloAnexo(pp.pagamento_fora_do_cadastro_meio),
      responsavelVerbaNome: !pp.verba_producao
        ? null
        : verbaDeResponsavel(pp)
          ? ((responsavelRes.data as { nome?: string } | null)?.nome ?? "")
          : (pp.verba_titular_nome ?? ""),
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      itemNome: nomeDoItemDaPP(pp.realizado),
      contexto,
      parcelas,
      emitidaEm: pp.created_at,
      selo: seloPeloStatus(pp.status, pp.cancelada_em),
    });
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(pp.pdf_path || documento.path, documento.buffer, { contentType: "application/pdf", upsert: true });
  return uploadErr ? uploadErr.message : null;
}

/**
 * Decisão 190: depois de o status mudar (envio ao financeiro, cancelamento),
 * refaz o PDF com o selo do status novo. O status já está gravado e não
 * volta atrás se o PDF falhar — a falha fica no log, e o PDF velho continua
 * dizendo "não pague", que é o lado seguro do erro.
 */
async function trocarSeloDaPP(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ppId: string,
  codigo: string,
): Promise<void> {
  const erro = await refazerPdfDaPP(supabase, tenantId, ppId);
  if (erro) console.error("[pp.selo]", codigo, erro);
}

/**
 * A empresa emissora segue o documento (revisão da 156, 16/10/2026). Lê os
 * anexos gravados da PP e, se a nota, a fatura ou o recibo estão em outro
 * CNPJ, passa a PP para ele e refaz o PDF — na PP ainda no job ou em
 * avaliação; a aprovada e a paga guardam o documento como estava. O gatilho
 * `trg_pp_registra_troca_de_emissora` põe a troca na linha do tempo.
 * Documentos em CNPJs diferentes barram: uma PP é paga por um CNPJ só.
 */
async function seguirDocumentoNaPP(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ppId: string,
  origem: "envio" | "pronta_para_envio" | "correcao_da_nf",
): Promise<{ ok: true; troca: TrocaDeEmissora | null } | { ok: false; message: string }> {
  const [ppRes, anexosRes] = await Promise.all([
    supabase
      .from("pedidos_compra")
      .select("id, codigo, status, estabelecimento_id, job_id")
      .eq("id", ppId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; codigo: string; status: PPStatus; estabelecimento_id: string | null; job_id: string }>(),
    supabase
      .from("pedidos_compra_anexos")
      .select("documento_tipo, nf_tomador_estabelecimento_id")
      .eq("pedido_compra_id", ppId)
      .eq("tenant_id", tenantId),
  ]);
  const pp = ppRes.data;
  if (!pp || anexosRes.error) return { ok: false, message: "Não foi possível ler os documentos da PP." };
  const pelosDocumentos = emissoraDosDocumentos(
    (anexosRes.data ?? []) as Array<{
      documento_tipo: (typeof DOCUMENTO_TIPOS)[number] | null;
      nf_tomador_estabelecimento_id: string | null;
    }>,
  );
  if (pelosDocumentos.tipo === "divergente") return { ok: false, message: DOCUMENTOS_EM_CNPJS_DIFERENTES };
  if (pelosDocumentos.tipo === "nenhum" || pelosDocumentos.estabelecimentoId === pp.estabelecimento_id) {
    return { ok: true, troca: null };
  }
  const para = pelosDocumentos.estabelecimentoId;

  const { data: estabs } = await supabase
    .from("fiscal_estabelecimentos")
    .select("id, nome, cnpj, ativo")
    .eq("tenant_id", tenantId)
    .in("id", [para, ...(pp.estabelecimento_id ? [pp.estabelecimento_id] : [])]);
  const lista = (estabs ?? []) as Array<{ id: string; nome: string; cnpj: string | null; ativo: boolean }>;
  const novo = lista.find((e) => e.id === para);
  if (!novo || !novo.ativo || (novo.cnpj ?? "").replace(/\D/g, "").length !== 14) {
    return {
      ok: false,
      message: "O CNPJ do documento não está ativo no cadastro de impostos. Peça ao financeiro para ativá-lo.",
    };
  }
  const nomeCurto = (nome: string) => nome.split(" · ")[0];
  const antigo = lista.find((e) => e.id === pp.estabelecimento_id) ?? null;

  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({ estabelecimento_id: para })
    .eq("id", ppId)
    .eq("tenant_id", tenantId);
  if (updErr) return { ok: false, message: `Não foi possível trocar a empresa emissora: ${updErr.message}` };

  if (pp.status === "gerada" || pp.status === "em_avaliacao") {
    const erroPdf = await refazerPdfDaPP(supabase, tenantId, ppId);
    if (erroPdf) {
      // Sem o PDF novo, a troca volta: PP e documento não podem divergir.
      await supabase
        .from("pedidos_compra")
        .update({ estabelecimento_id: pp.estabelecimento_id })
        .eq("id", ppId)
        .eq("tenant_id", tenantId);
      return { ok: false, message: `Não foi possível refazer o PDF com o CNPJ do documento: ${erroPdf}` };
    }
  }

  await logAuditEvent({
    acao: "pedido_compra.emissora_trocada",
    tenantId,
    entidadeTipo: "pedido_compra",
    entidadeId: ppId,
    metadata: {
      pp_codigo: pp.codigo,
      job_id: pp.job_id,
      de: pp.estabelecimento_id,
      para,
      origem,
      decisao: 156,
    },
  });
  return { ok: true, troca: { de: antigo ? nomeCurto(antigo.nome) : null, para: nomeCurto(novo.nome) } };
}

/**
 * Depois de "Corrigir a NF" (revisão da 156, 16/10/2026): a empresa emissora
 * segue o documento na PP corrigida e nas outras PPs com as mesmas notas — a
 * correção dos dados da nota vale para todas elas. A NF já está corrigida
 * quando isto roda: se a emissora não puder seguir, volta um aviso, sem
 * desfazer a correção.
 */
export async function seguirDocumentosDaNotaCorrigida(
  ppId: string,
): Promise<{ ok: true; troca: TrocaDeEmissora | null; aviso: string | null } | { ok: false; message: string }> {
  if (!z.string().uuid().safeParse(ppId).success) return { ok: false, message: "PP inválida." };
  const session = await requireSession();
  if (!pode(session.activeRole, "jobs.corrigir_nf_pp") && !pode(session.activeRole, "jobs.emitir_pp")) {
    return { ok: false, message: "Você não tem permissão para corrigir a NF da PP." };
  }
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: daPP } = await supabase
    .from("pedidos_compra_anexos")
    .select("nota_fiscal_id")
    .eq("pedido_compra_id", ppId)
    .eq("tenant_id", tenantId)
    .not("nota_fiscal_id", "is", null);
  const notas = [...new Set((daPP ?? []).map((a) => a.nota_fiscal_id as string))];
  let outras: string[] = [];
  if (notas.length > 0) {
    const { data: comAsNotas } = await supabase
      .from("pedidos_compra_anexos")
      .select("pedido_compra_id")
      .eq("tenant_id", tenantId)
      .in("nota_fiscal_id", notas);
    const ids = [...new Set((comAsNotas ?? []).map((a) => a.pedido_compra_id as string))].filter((id) => id !== ppId);
    if (ids.length > 0) {
      const { data: vivas } = await supabase
        .from("pedidos_compra")
        .select("id")
        .eq("tenant_id", tenantId)
        .in("id", ids)
        .neq("status", "cancelada");
      outras = (vivas ?? []).map((p) => p.id as string);
    }
  }

  const principal = await seguirDocumentoNaPP(supabase, tenantId, ppId, "correcao_da_nf");
  const falhas: string[] = [];
  for (const id of outras) {
    const r = await seguirDocumentoNaPP(supabase, tenantId, id, "correcao_da_nf");
    if (!r.ok) falhas.push(r.message);
  }
  if (!principal.ok) {
    return { ok: true, troca: null, aviso: `A NF foi corrigida, mas a empresa emissora não mudou: ${principal.message}` };
  }
  return {
    ok: true,
    troca: principal.troca,
    aviso: falhas.length > 0 ? `A NF foi corrigida, mas outra PP com ela não mudou de empresa emissora: ${falhas[0]}` : null,
  };
}

/**
 * Envia ao financeiro uma PP que está GERADA (02/09/2026, decisão 039).
 *
 * É a metade que "Gerar PP" perdeu: até aqui gerar e enviar eram o mesmo
 * clique. Agora a PP nasce no job e só entra em avaliação quando alguém a
 * envia — esta action. O que ela confere:
 *
 *   1. O job aceita ação de planilha e quem envia é o responsável do job
 *      ou administrador (mesmo gate de gerar).
 *   2. A linha da PP não foi alterada por uma errata que a revisão da
 *      abertura ainda não conferiu (decisão 040, revista pela 185).
 *   3. PP que não é verba de produção tem pelo menos um anexo — o anexo
 *      deixou de travar a geração e passou a travar o envio.
 *   4. Se, com esta PP, o item passa do PLANEJADO, o envio exige
 *      `confirmarAcimaDoPlanejado`. Sem o flag a action devolve os
 *      números para o "tem certeza?" da tela. Linha vermelha tem
 *      planejado zero, então toda PP dela cai aqui — regra literal.
 *   5. Em item `A · Repasse`, a soma das PPs precisa cobrir o ORÇADO
 *      (decisão 062). Diferente da 4, esta BARRA: não há confirmação que
 *      libere repassar menos do que se recebeu para repassar.
 *
 * Decisões 152 e 153 (07/10/2026): o envio é o pop-up do painel, com os
 * anexos da PP. Ele manda a lista inteira (os que ficaram, os novos e o
 * que mudou em cada um) e TODO campo é obrigatório: o tipo de cada arquivo,
 * o número dos documentos e, em cada NF, número, emissão, valor e CNPJ
 * tomador. Só depois das travas do envio os anexos são gravados e cada NF é
 * ligada à sua nota do cadastro (`ligar_notas_fiscais_da_pp`) — a nota que
 * já existe (mesmo fornecedor + número) só se liga, sem mudar os dados.
 */
export async function enviarPedidoCompraAoFinanceiro(
  pp_id: string,
  confirmarAcimaDoPlanejado = false,
  anexosDoEnvio?: z.input<typeof anexoUploadedSchema>[],
): Promise<ResultadoEnvio> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: ppRow, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, codigo, job_id, item_realizado_id, status, valor, verba_producao, tipo_verba, reembolso_tipo, fornecedor_id, estabelecimento_id, prazo_pagamento, urgente, created_at, pagamento_fora_do_cadastro_meio, cartao_corporativo, anexos:pedidos_compra_anexos(id)",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      codigo: string;
      job_id: string;
      item_realizado_id: string;
      status: PPStatus;
      valor: number | string;
      verba_producao: boolean;
      tipo_verba: TipoVerba | null;
      reembolso_tipo: ReembolsoTipo | null;
      fornecedor_id: string | null;
      estabelecimento_id: string | null;
      prazo_pagamento: string;
      urgente: boolean;
      created_at: string;
      pagamento_fora_do_cadastro_meio: string | null;
      cartao_corporativo: boolean;
      anexos: Array<{ id: string }> | null;
    }>();

  if (ppErr || !ppRow) return { ok: false, message: "PP não encontrada." };

  if (ppRow.status !== "gerada") {
    return {
      ok: false,
      message:
        ppRow.status === "cancelada"
          ? "PP cancelada não pode ser enviada."
          : `${ppRow.codigo} já está no financeiro.`,
    };
  }

  const gate = await checarGatesRealizado(ppRow.item_realizado_id);
  if (!gate.ok) return gate;
  const barradoNoEnvio = await barrarEnvioPeloPapel(gate.session, ppRow.id, gate.job);
  if (barradoNoEnvio) return barradoNoEnvio;
  const { item, job } = gate;
  const bloqueioEnvio = await barrarEnvioDePP(
    supabase,
    session.activeTenant.id,
    pp_id,
    job,
    item,
  );
  if (bloqueioEnvio) return bloqueioEnvio;

  // Prazo de envio (decisão 157): o financeiro recebe a PP até 15 dias
  // antes da janela do vencimento. Vale também para a PP que esperou a
  // abertura do job — o atalho "Atualizar vencimento" do painel resolve.
  // A gerada antes de 08/10/2026 passa como está.
  if (ppSegueOPrazoDeEnvio(ppRow.created_at)) {
    const hoje = hojeEmSaoPauloIso();
    const feriados = await carregarFeriadosNacionais(supabase, session.activeTenant.id);
    const prazo = ppRow.prazo_pagamento.slice(0, 10);
    // A quarta de exceções só sai com a PP urgente ou de verba (decisão
    // 172); a quarta tem a sua data-limite, a sexta anterior, na conta de
    // baixo.
    const quartaLiberada = ppAceitaQuarta({ urgente: ppRow.urgente, verba: ppRow.verba_producao });
    if (!quartaLiberada && ehQuarta(prazo) && !ehJanelaDePagamento(prazo)) {
      return {
        ok: false,
        message: `O vencimento ${isoParaBr(prazo)} é uma quarta de exceções, que só vale para verba ou pagamento urgente. Edite a ${ppRow.codigo} e escolha uma janela.`,
      };
    }
    if (!vencimentoAceitaEnvio(prazo, hoje, feriados)) {
      const limite = dataLimiteDeEnvio(prazo, feriados);
      await logAuditEvent({
        acao: "acao_negada",
        tenantId: session.activeTenant.id,
        entidadeTipo: "pedido_compra",
        entidadeId: pp_id,
        metadata: {
          acao_tentada: "pedido_compra.enviada_financeiro",
          motivo: "prazo_de_envio_encerrado",
          job_id: job.id,
          vencimento: prazo,
          data_limite: limite,
        },
      });
      return {
        ok: false,
        message: `O prazo de envio para o vencimento ${isoParaBr(prazo)} terminou${limite ? ` em ${isoParaBr(limite)}` : ""}. Atualize o vencimento da ${ppRow.codigo} — a primeira data possível hoje é ${isoParaBr(primeiraDataPossivelDoPrazo(hoje, feriados, quartaLiberada))}.`,
      };
    }
  }

  // Verba de Produção é adiantamento: sai antes de existir nota, e as
  // notas entram na prestação de contas. Nas demais, a nota do fornecedor
  // é o que justifica o pedido — e é ela que o financeiro vai conferir.
  // Decisão 152: todo campo de todo anexo é obrigatório no envio.
  // Decisão 187: o reembolso é "não fornecedor" como a verba, mas leva os
  // comprovantes — obrigatórios aqui, no envio, e não na geração.
  const reembolsoNoEnvio = ppRow.tipo_verba === "reembolso" ? (ppRow.reembolso_tipo ?? "despesas") : null;
  let anexosDoPedido: AnexoUploaded[] = [];
  // Decisão 209: o cartão corporativo vai sem nota, como a verba — os
  // anexos que a PP já tem ficam como estão.
  const comDocumentosNoEnvio = (!ppRow.verba_producao && !ppRow.cartao_corporativo) || reembolsoNoEnvio;
  // Decisão 216: com o job Mídia System em auditoria, a PP comum pode ir
  // sem anexo nenhum. O que for anexado segue as regras de sempre.
  const semNfPermitido = !reembolsoNoEnvio && envioDispensaNf(midiaSystemDoJob(job));
  if (comDocumentosNoEnvio) {
    const parsed = z.array(anexoUploadedSchema).safeParse(anexosDoEnvio ?? []);
    if (!parsed.success) return { ok: false, message: "Formato de anexo inválido." };
    anexosDoPedido = parsed.data;
    const falta = reembolsoNoEnvio
      ? faltaNosAnexosDoReembolso(anexosDoPedido, Number(ppRow.valor ?? 0), reembolsoNoEnvio)
      : faltaNosAnexosDoEnvio(
          anexosDoPedido,
          Number(ppRow.valor ?? 0),
          meioPeloAnexo(ppRow.pagamento_fora_do_cadastro_meio),
        );
    if (falta && !(semNfPermitido && anexosDoPedido.length === 0)) return { ok: false, message: falta };
  }
  const vaiSemNf = comDocumentosNoEnvio && semNfPermitido && anexosDoPedido.length === 0;

  // Revisão da 156 (16/10/2026): nota em outro CNPJ não pede mais "tem
  // certeza?" — a empresa emissora segue o documento, depois de gravar os
  // anexos (`seguirDocumentoNaPP`). Documentos em CNPJs diferentes já
  // barraram em `faltaNosAnexosDoEnvio`.

  // A trava do AR vem ANTES da conta do planejado: ela barra de vez, e
  // deixar o "tem certeza?" aparecer primeiro faria o usuário confirmar
  // um envio que vai ser recusado logo em seguida.
  const bloqueioAR = await barrarARComOrcadoEmAberto(
    supabase,
    session.activeTenant.id,
    item,
  );
  if (bloqueioAR) return bloqueioAR;

  // A PP que está sendo enviada já está no item desde que foi gerada
  // (decisão 074), então ela sai da soma aqui e volta uma linha abaixo —
  // contá-la nas duas pontas dobraria o valor dela no teste do planejado.
  const valor = Number(ppRow.valor ?? 0);
  const emPPsSemEsta = await somaDasPPsDoItem(
    supabase,
    session.activeTenant.id,
    ppRow.item_realizado_id,
    pp_id,
  );
  const emPPsDepois = Math.round((emPPsSemEsta + valor) * 100) / 100;
  const pedidoDeConfirmacao = pedirConfirmacaoAcimaDoPlanejado(
    emPPsDepois,
    item.total_planejado,
    confirmarAcimaDoPlanejado,
  );
  if (pedidoDeConfirmacao) return pedidoDeConfirmacao;

  // Decisões 152 e 153: os anexos como o pop-up mandou, e cada NF ligada à
  // sua nota do cadastro. Depois das travas, para o "tem certeza?" acima do
  // planejado não deixar meio envio gravado. O reembolso grava os
  // comprovantes, mas não liga nota de fornecedor (decisão 187).
  if (reembolsoNoEnvio) {
    const erroAnexos = await gravarAnexosDoEnvio(
      supabase,
      session.activeTenant.id,
      session.profile.id,
      job.id,
      pp_id,
      anexosDoPedido,
    );
    if (erroAnexos) return { ok: false, message: erroAnexos };
  }
  if (!ppRow.verba_producao && !ppRow.cartao_corporativo) {
    const erroAnexos = await gravarAnexosDoEnvio(
      supabase,
      session.activeTenant.id,
      session.profile.id,
      job.id,
      pp_id,
      anexosDoPedido,
    );
    if (erroAnexos) return { ok: false, message: erroAnexos };
    const notas = anexosDoPedido
      .filter((a) => a.documento_tipo === "nota_fiscal")
      .map((a) => ({
        anexo_id: a.anexo_id,
        numero: (a.documento_numero ?? "").trim(),
        data_emissao: a.nf_data_emissao,
        valor: a.nf_valor,
        tomador_estabelecimento_id: a.nf_tomador_estabelecimento_id,
        valor_na_pp: a.nf_valor_na_pp ?? a.nf_valor,
      }));
    const { error: notasErr } = await supabase.rpc("ligar_notas_fiscais_da_pp", {
      p_pp_id: pp_id,
      p_notas: notas,
    });
    if (notasErr) {
      console.error("[pp.envio.notas]", notasErr.message);
      const limpa = notasErr.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
      return {
        ok: false,
        message: limpa && !/[_"]/.test(limpa) ? limpa : "Não foi possível registrar as notas fiscais. Tente novamente.",
      };
    }
  }

  // Revisão da 156: a empresa emissora segue o documento, com o PDF refeito.
  const seguiu = await seguirDocumentoNaPP(supabase, session.activeTenant.id, pp_id, "envio");
  if (!seguiu.ok) return seguiu;

  // `.eq("status", "gerada")` é a trava de corrida: dois envios ao mesmo
  // tempo, só um passa. O `select` diz se ESTE passou.
  const agora = new Date().toISOString();
  const { data: atualizada, error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "em_avaliacao",
      enviada_financeiro_em: agora,
      enviada_financeiro_por: session.profile.id,
      // Decisão 216: a marca que leva a PP à prestação de contas depois da
      // liberação das NFs. O gatilho confere que o job está em auditoria.
      ...(vaiSemNf ? { sem_nf_na_auditoria: true } : {}),
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "gerada")
    .select("id");

  if (updErr) {
    return { ok: false, message: `Falha ao enviar PP: ${updErr.message}` };
  }
  if (!atualizada || atualizada.length === 0) {
    return { ok: false, message: `${ppRow.codigo} já tinha saído de gerada.` };
  }

  await logAuditEvent({
    acao: "pedido_compra.enviada_financeiro",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: ppRow.codigo,
      valor,
      job_id: job.id,
      item_realizado_id: ppRow.item_realizado_id,
      planejado_do_item: item.total_planejado,
      em_pps_emitidas_depois: emPPsDepois,
      acima_do_planejado: passaDoPlanejado(emPPsDepois, item.total_planejado),
      confirmado_acima_do_planejado: confirmarAcimaDoPlanejado,
      verba_producao: ppRow.verba_producao,
      sem_nf_na_auditoria: vaiSemNf,
      anexos: anexosDoPedido.length,
      notas_fiscais: anexosDoPedido.filter((a) => a.documento_tipo === "nota_fiscal").length,
      // Revisão da 156: a empresa emissora que o documento definiu no envio.
      emissora_seguiu_documento: seguiu.troca !== null,
      cnpj_da_pp_antes: ppRow.estabelecimento_id,
    },
  });

  // Decisão 190: chegou ao financeiro pelo sistema — o PDF perde o selo.
  await trocarSeloDaPP(supabase, session.activeTenant.id, pp_id, ppRow.codigo);

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath(`/financeiro/jobs/${job.id}`);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro");
  return { ok: true, codigo: ppRow.codigo, emissora: seguiu.troca };
}

/**
 * "Deixar pronta para envio" (decisão 160, 09/10/2026).
 *
 * O produtor e o freelancer geram a PP mas não a enviam (decisão 136). Com
 * esta action eles conferem os documentos no MESMO pop-up do envio, com as
 * mesmas regras — o tipo de cada arquivo e os dados de cada NF obrigatórios
 * (decisão 152) —, e em vez de mandar ao financeiro deixam a PP pronta: os
 * anexos ficam gravados como o pop-up mandou, e a PP ganha a marca
 * `pronta_para_envio_em/por`. O GP a vê na aba Pedidos de Produção e envia
 * com o pop-up já preenchido.
 *
 * A PP continua "gerada", e quem preparou pode reabrir e gravar de novo até
 * o GP enviar. Ficam para o envio, que é quando o GP decide: o "tem
 * certeza?" acima do planejado, o prazo de envio (decisão 157), a abertura
 * em revisão (decisão 040) e a ligação das NFs ao cadastro de notas
 * (`ligar_notas_fiscais_da_pp`). A empresa emissora já segue o documento
 * aqui (revisão da 156, 16/10/2026).
 *
 * Quem e quando são gravados pelo gatilho `trg_pp_carimba_pronta_para_envio`
 * com o usuário da sessão; o gatilho também recusa a marca fora da PP gerada.
 */
export async function deixarPPProntaParaEnvio(
  pp_id: string,
  anexosDoEnvio?: z.input<typeof anexoUploadedSchema>[],
): Promise<Result<{ codigo: string }>> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: ppRow, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select("id, codigo, job_id, item_realizado_id, status, valor, verba_producao, tipo_verba, reembolso_tipo, pagamento_fora_do_cadastro_meio, cartao_corporativo")
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      codigo: string;
      job_id: string;
      item_realizado_id: string;
      status: PPStatus;
      valor: number | string;
      verba_producao: boolean;
      tipo_verba: TipoVerba | null;
      reembolso_tipo: ReembolsoTipo | null;
      pagamento_fora_do_cadastro_meio: string | null;
      cartao_corporativo: boolean;
    }>();

  if (ppErr || !ppRow) return { ok: false, message: "PP não encontrada." };
  if (ppRow.status !== "gerada") {
    return {
      ok: false,
      message:
        ppRow.status === "cancelada"
          ? "PP cancelada não fica pronta para envio."
          : `${ppRow.codigo} já está no financeiro.`,
    };
  }

  // Os mesmos gates de gerar, editar e cancelar: job aceita PP e o papel
  // emite PP (`jobs.emitir_pp`).
  const gate = await checarGatesRealizado(ppRow.item_realizado_id);
  if (!gate.ok) return gate;
  const { job } = gate;

  // Os documentos, com as regras do envio (decisão 152). A verba de
  // produção sai sem nota: só a marca. O reembolso leva os comprovantes,
  // com as regras dele (decisão 187).
  const reembolsoNoEnvio = ppRow.tipo_verba === "reembolso" ? (ppRow.reembolso_tipo ?? "despesas") : null;
  let anexosDoPedido: AnexoUploaded[] = [];
  // Decisão 209: o cartão corporativo vai sem nota, como a verba — os
  // anexos que a PP já tem ficam como estão.
  const comDocumentosNoEnvio = (!ppRow.verba_producao && !ppRow.cartao_corporativo) || reembolsoNoEnvio;
  // Decisão 216: com o job Mídia System em auditoria, a PP comum pode ir
  // sem anexo nenhum. O que for anexado segue as regras de sempre.
  const semNfPermitido = !reembolsoNoEnvio && envioDispensaNf(midiaSystemDoJob(job));
  if (comDocumentosNoEnvio) {
    const parsed = z.array(anexoUploadedSchema).safeParse(anexosDoEnvio ?? []);
    if (!parsed.success) return { ok: false, message: "Formato de anexo inválido." };
    anexosDoPedido = parsed.data;
    const falta = reembolsoNoEnvio
      ? faltaNosAnexosDoReembolso(anexosDoPedido, Number(ppRow.valor ?? 0), reembolsoNoEnvio)
      : faltaNosAnexosDoEnvio(
          anexosDoPedido,
          Number(ppRow.valor ?? 0),
          meioPeloAnexo(ppRow.pagamento_fora_do_cadastro_meio),
        );
    if (falta && !(semNfPermitido && anexosDoPedido.length === 0)) return { ok: false, message: falta };
    const erroAnexos = await gravarAnexosDoEnvio(
      supabase,
      session.activeTenant.id,
      session.profile.id,
      job.id,
      pp_id,
      anexosDoPedido,
    );
    if (erroAnexos) return { ok: false, message: erroAnexos };
    // Revisão da 156: a empresa emissora segue o documento, com o PDF refeito.
    const seguiu = await seguirDocumentoNaPP(supabase, session.activeTenant.id, pp_id, "pronta_para_envio");
    if (!seguiu.ok) return seguiu;
  }

  // `.eq("status", "gerada")`: se o GP enviou no meio, nada muda aqui.
  const { data: marcada, error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      pronta_para_envio_em: new Date().toISOString(),
      pronta_para_envio_por: session.profile.id,
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .eq("status", "gerada")
    .select("id");

  if (updErr) {
    console.error("[pp.pronta_para_envio]", updErr.message);
    return { ok: false, message: "Não foi possível deixar a PP pronta para envio. Tente de novo." };
  }
  if (!marcada || marcada.length === 0) {
    return { ok: false, message: `${ppRow.codigo} já tinha saído de gerada.` };
  }

  await logAuditEvent({
    acao: "pedido_compra.pronta_para_envio",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: ppRow.codigo,
      job_id: job.id,
      item_realizado_id: ppRow.item_realizado_id,
      papel: session.activeRole,
      verba_producao: ppRow.verba_producao,
      anexos: anexosDoPedido.length,
      notas_fiscais: anexosDoPedido.filter((a) => a.documento_tipo === "nota_fiscal").length,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, codigo: ppRow.codigo };
}

// ⚠️ Decisão 153 (07/10/2026): a edição da PP gerada
// (`editarPedidoCompraGerada`) saiu. Depois de gerada, a PP não se edita
// mais; para mudar algo, cancela e gera outra a partir de uma PP a emitir.

// ---------------------------------------------------------------------------
// PP a emitir (decisão 153, 07/10/2026)
// ---------------------------------------------------------------------------
//
// O caminho passou a ser: PP a emitir → PP gerada → enviada. A PP a emitir é
// o formulário inteiro, salvo e editável (não é rascunho, não fica
// incompleta); "Gerar PP" passa sempre pela revisão e a transforma na PP,
// que daí em diante não se edita mais. O id da PP a emitir é o id que a PP
// vai ter: os anexos sobem uma vez para `<tenant>/<job>/<id>/anexos/`.

/** O texto da trava de gerar na pré-abertura (decisão 153). */
function geracaoTravadaPeloJob(status: string): string | null {
  if (status === "aguardando_abertura") {
    return "O financeiro ainda não abriu este job: por enquanto, só PP a emitir. Gerar a PP volta com a abertura.";
  }
  if (status === "rejeitado_financeiro") {
    return "O financeiro devolveu este job e ele ainda não foi aberto: por enquanto, só PP a emitir. Gerar a PP volta com a abertura.";
  }
  return null;
}

/** Os anexos da PP a emitir, gravados como a lista da tela: os que saíram
 *  da lista somem (linha e arquivo); os novos entram; os que ficaram têm o
 *  tipo, o número e a NF atualizados. */
async function sincronizarAnexosDaPPAEmitir(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  profileId: string,
  aEmitirId: string,
  prefixo: string,
  anexos: AnexoUploaded[],
): Promise<string | null> {
  const { data: atuais, error: atuaisErr } = await supabase
    .from("pedidos_compra_a_emitir_anexos")
    .select("id, arquivo_path")
    .eq("a_emitir_id", aEmitirId)
    .eq("tenant_id", tenantId);
  if (atuaisErr) return `Falha ao ler os anexos: ${atuaisErr.message}`;
  const ficam = new Set(anexos.map((a) => a.anexo_id));
  const saem = (atuais ?? []).filter((a) => !ficam.has(a.id as string));
  if (saem.length > 0) {
    const { error } = await supabase
      .from("pedidos_compra_a_emitir_anexos")
      .delete()
      .in(
        "id",
        saem.map((a) => a.id as string),
      )
      .eq("tenant_id", tenantId);
    if (error) return `Falha ao remover anexos: ${error.message}`;
    // Só o arquivo que é desta PP a emitir sai do bucket.
    const arquivos = saem.map((a) => a.arquivo_path as string).filter((p) => p.startsWith(prefixo));
    if (arquivos.length > 0) await supabase.storage.from(BUCKET).remove(arquivos);
  }
  const idsAtuais = new Set((atuais ?? []).map((a) => a.id as string));
  const novos = anexos.filter((a) => !idsAtuais.has(a.anexo_id));
  if (novos.length > 0) {
    const horarios = horariosEmOrdem(novos.length);
    const { error } = await supabase.from("pedidos_compra_a_emitir_anexos").upsert(
      novos.map((a, i) => ({
        id: a.anexo_id,
        tenant_id: tenantId,
        a_emitir_id: aEmitirId,
        arquivo_path: a.path,
        arquivo_nome_original: a.nome_original,
        arquivo_tamanho_bytes: a.tamanho_bytes,
        arquivo_mimetype: a.mimetype,
        documento_tipo: a.documento_tipo,
        documento_numero: a.documento_tipo ? a.documento_numero : null,
        ...nfDoAnexo(a),
        criado_por: profileId,
        created_at: horarios[i],
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) return `Falha ao salvar os anexos: ${error.message}`;
  }
  for (const a of anexos.filter((x) => idsAtuais.has(x.anexo_id))) {
    const { error } = await supabase
      .from("pedidos_compra_a_emitir_anexos")
      .update({
        documento_tipo: a.documento_tipo,
        documento_numero: a.documento_tipo ? a.documento_numero : null,
        ...nfDoAnexo(a),
      })
      .eq("id", a.anexo_id)
      .eq("a_emitir_id", aEmitirId)
      .eq("tenant_id", tenantId);
    if (error) return `Falha ao salvar o anexo ${a.nome_original}: ${error.message}`;
  }
  return null;
}

/**
 * Salva a PP a emitir — nova ou em edição (decisão 153). O formulário é
 * inteiro e passa pelas mesmas regras da geração (dados, janelas de
 * pagamento, urgência, parcelas e a pergunta da última PP); os anexos são
 * opcionais aqui e cobrados só no envio ao financeiro. Vale também com o
 * job aguardando abertura ou devolvido pelo financeiro: é o que esses jobs
 * aceitam.
 */
export async function salvarPPAEmitir(
  id: string,
  itemRealizadoId: string,
  dados: z.input<typeof dadosSchema>,
  anexos: z.input<typeof anexoUploadedSchema>[],
  ultimaPPDoItem: boolean,
): Promise<Result<{ id: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, message: "PP a emitir inválida. Feche o formulário e tente de novo." };
  }
  if (typeof ultimaPPDoItem !== "boolean") {
    return { ok: false, message: "Responda se esta é a última PP deste item." };
  }

  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;
  const { item, job, supabase } = gate;
  const tenantId = session.activeTenant.id;

  // Aguardando o Comitê (decisão 223): ele decide sobre a PP que viu.
  if (await ppAguardandoComite(supabase, tenantId, id)) {
    return { ok: false, message: "A PP está aguardando aprovação do Comitê. Cancele o envio para editar." };
  }

  const travaMidia = await travaDoJobDeMidia(supabase, tenantId, job.id, "pp");
  if (travaMidia) return { ok: false, message: travaMidia };

  const comSave = await barrarPPEmLinhaComSave(supabase, tenantId, item);
  if (comSave) return comSave;

  const dadosParsed = dadosSchema.safeParse(dados);
  if (!dadosParsed.success) {
    return {
      ok: false,
      message: `Dados inválidos: ${dadosParsed.error.issues[0]?.message ?? "erro"}.`,
    };
  }
  const d = dadosParsed.data;

  const { data: existente } = await supabase
    .from("pedidos_compra_a_emitir")
    .select("id, item_realizado_id, pp_id, excluida_em, dados")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      item_realizado_id: string;
      pp_id: string | null;
      excluida_em: string | null;
      dados: { parcelas?: Array<{ data_vencimento: string }> } | null;
    }>();
  if (existente && (existente.pp_id || existente.excluida_em)) {
    return {
      ok: false,
      message: existente.pp_id
        ? "Esta PP a emitir já virou PP. Recarregue a página."
        : "Esta PP a emitir foi excluída. Recarregue a página.",
    };
  }
  if (existente && existente.item_realizado_id !== itemRealizadoId) {
    return { ok: false, message: "Esta PP a emitir é de outro item. Recarregue a página." };
  }

  // As datas já salvas passam como estão (a regra só vale para a data que
  // muda); o resto segue as janelas de pagamento (decisão 077) e o prazo de
  // envio (decisão 157). A data salva que perdeu o prazo barra na geração.
  const gravadas = (existente?.dados?.parcelas ?? []).map((p) => p.data_vencimento);
  const erroJanela = validarVencimentosNasJanelas(
    d.parcelas.map((p) => p.data_vencimento),
    gravadas,
    await carregarFeriadosNacionais(supabase, tenantId),
    ppAceitaQuarta({ urgente: d.urgente === true, verba: d.verba_producao }),
  );
  if (erroJanela) return { ok: false, message: erroJanela };
  const urgencia = camposDeUrgencia(d, null, session.profile.id);
  if (!urgencia.ok) return urgencia;

  const valor = valorDaPPPorUnidade(d.valor_unitario, d.quantidade, d.dias_meses);
  if (valor <= 0) {
    return { ok: false, message: "R$ Unit., QT e D/M inválidos: o valor da PP ficaria zerado." };
  }
  if (!parcelasFecham(d.parcelas.map((p) => p.valor), valor)) {
    return {
      ok: false,
      message: `A soma das parcelas precisa fechar com o valor da PP (${brl(valor)}).`,
    };
  }

  const anexosParsed = z.array(anexoUploadedSchema).safeParse(anexos);
  if (!anexosParsed.success) return { ok: false, message: "Formato de anexo inválido." };
  const nfNoCartao = notaNoCartao(cartaoDe(d), anexosParsed.data);
  if (nfNoCartao) return { ok: false, message: nfNoCartao };
  const prefixo = `${tenantId}/${job.id}/${id}/anexos/`;
  const somaBytes = anexosParsed.data.reduce((s, a) => s + a.tamanho_bytes, 0);
  if (somaBytes > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
    return { ok: false, message: "Anexos somam mais que 25 MB." };
  }
  for (const a of anexosParsed.data) {
    if (a.tamanho_bytes > PP_ANEXO_TAMANHO_MAX_BYTES) {
      return { ok: false, message: `Anexo ${a.nome_original} > 8 MB.` };
    }
    if (!a.path.startsWith(prefixo)) return { ok: false, message: "Anexo em path inválido." };
  }
  if (anexosParsed.data.length > 0) {
    const { data: noBucket, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(prefixo.replace(/\/$/, ""));
    if (listErr) return { ok: false, message: `Falha ao listar anexos: ${listErr.message}` };
    const nomes = new Set((noBucket ?? []).map((f) => `${prefixo}${f.name}`));
    const faltando = anexosParsed.data.find((a) => !nomes.has(a.path));
    if (faltando) {
      return {
        ok: false,
        message: `Anexo ${faltando.nome_original} não foi encontrado no bucket. Refaça o upload.`,
      };
    }
  }

  // Decisão 164: o nome do titular entra já na PP a emitir (o painel o
  // mostra), conferido contra a mesma lista do formulário.
  const titular = await nomeDoTitularDaVerba(supabase, tenantId, d);
  if (!titular.ok) return titular;
  // Decisão 193: quem não paga pelo cadastro digita o PIX ou a conta, já ao
  // salvar. Quem paga não guarda nada da tela.
  const pagTitular = pagamentoDoTitularNaGravacao(d, titular.pagaPeloCadastro);
  if (!pagTitular.ok) return pagTitular;
  const titularPessoa =
    d.verba_producao && (d.verba_titular_tipo === "colaborador" || d.verba_titular_tipo === "freela");
  // Decisão 187: no veículo próprio, a conta dos deslocamentos fecha o
  // valor. O desgaste aceito é o vigente ou o que esta PP a emitir já
  // guardava (salva antes de o financeiro mudar o valor).
  const reembolso = await conferirReembolso(
    supabase,
    tenantId,
    d,
    (existente?.dados as { deslocamentos?: { desgaste_por_km?: number } } | null)?.deslocamentos?.desgaste_por_km ?? null,
  );
  if (!reembolso.ok) return reembolso;

  // Revisão da 156: com documento que diga o CNPJ, a empresa emissora é a
  // dele — a PP a emitir guarda já a que a geração vai usar.
  const emissora = emissoraPelosAnexos(anexosParsed.data, d.estabelecimento_id ?? null);
  if (!emissora.ok) return emissora;

  const linha = {
    empresa_id: d.empresa_id,
    ...colunasDaVerba(d, titular.nome),
    servico: d.servico,
    valor,
    // O formulário como veio (já validado): a geração o valida de novo, e
    // o valor normalizado pelo schema não precisa passar duas vezes por ele.
    dados: {
      ...(emissora.id && emissora.id !== (d.estabelecimento_id ?? null) ? { ...dados, estabelecimento_id: emissora.id } : dados),
      // Decisão 193: o pagamento digitado (normalizado) e se o titular paga
      // pelo cadastro — a revisão lê daqui.
      pagamento_do_titular: pagTitular.pagamento,
      titular_paga_pelo_cadastro: titularPessoa ? titular.pagaPeloCadastro : null,
    },
    ultima_pp_do_item: ultimaPPDoItem,
    atualizada_por: session.profile.id,
  };
  const { error: gravarErr } = existente
    ? await supabase
        .from("pedidos_compra_a_emitir")
        .update(linha)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .is("pp_id", null)
        .is("excluida_em", null)
    : await supabase.from("pedidos_compra_a_emitir").insert({
        ...linha,
        id,
        tenant_id: tenantId,
        job_id: job.id,
        item_realizado_id: itemRealizadoId,
        criada_por: session.profile.id,
      });
  if (gravarErr) return { ok: false, message: `Falha ao salvar: ${gravarErr.message}` };

  const erroAnexos = await sincronizarAnexosDaPPAEmitir(
    supabase,
    tenantId,
    session.profile.id,
    id,
    prefixo,
    anexosParsed.data,
  );
  if (erroAnexos) return { ok: false, message: erroAnexos };

  await logAuditEvent({
    acao: existente ? "pedido_compra.a_emitir.editada" : "pedido_compra.a_emitir.salva",
    tenantId,
    entidadeTipo: "pedido_compra_a_emitir",
    entidadeId: id,
    metadata: {
      valor,
      anexos: anexosParsed.data.length,
      verba_producao: d.verba_producao,
      tipo_verba: linha.tipo_verba,
      fornecedor_id: linha.fornecedor_id,
      verba_titular_tipo: linha.verba_titular_tipo,
      // Decisão 209.
      cartao_corporativo: linha.cartao_corporativo,
      cartao_plataforma: linha.cartao_plataforma,
      item_realizado_id: itemRealizadoId,
      job_id: job.id,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, id };
}

/** O lugar dos anexos da PP a emitir no bucket, para o formulário de edição. */
export async function prefixoAnexosPPAEmitir(
  id: string,
): Promise<Result<{ upload_prefix: string }>> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: linha } = await supabase
    .from("pedidos_compra_a_emitir")
    .select("id, job_id, item_realizado_id, pp_id, excluida_em")
    .eq("id", id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      job_id: string;
      item_realizado_id: string;
      pp_id: string | null;
      excluida_em: string | null;
    }>();
  if (!linha) return { ok: false, message: "PP a emitir não encontrada." };
  if (linha.pp_id || linha.excluida_em) {
    return { ok: false, message: "Esta PP a emitir não está mais aberta. Recarregue a página." };
  }
  const gate = await checarGatesRealizado(linha.item_realizado_id);
  if (!gate.ok) return gate;
  return { ok: true, upload_prefix: `${session.activeTenant.id}/${linha.job_id}/${linha.id}/anexos/` };
}

/** Exclui a PP a emitir (some do painel; os arquivos dela saem do bucket). */
export async function excluirPPAEmitir(id: string): Promise<Result> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: linha } = await supabase
    .from("pedidos_compra_a_emitir")
    .select("id, job_id, item_realizado_id, pp_id, excluida_em, valor, anexos:pedidos_compra_a_emitir_anexos(arquivo_path)")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      job_id: string;
      item_realizado_id: string;
      pp_id: string | null;
      excluida_em: string | null;
      valor: number | string;
      anexos: Array<{ arquivo_path: string }> | null;
    }>();
  if (!linha) return { ok: false, message: "PP a emitir não encontrada." };
  if (linha.pp_id) return { ok: false, message: "Esta PP a emitir já virou PP. Recarregue a página." };
  if (linha.excluida_em) return { ok: true };
  if (await ppAguardandoComite(supabase, tenantId, id)) {
    return { ok: false, message: "A PP está aguardando aprovação do Comitê. Cancele o envio antes de excluir." };
  }

  const gate = await checarGatesRealizado(linha.item_realizado_id);
  if (!gate.ok) return gate;

  const { error } = await supabase
    .from("pedidos_compra_a_emitir")
    .update({ excluida_em: new Date().toISOString(), excluida_por: session.profile.id })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("pp_id", null);
  if (error) return { ok: false, message: `Falha ao excluir: ${error.message}` };

  const prefixo = `${tenantId}/${linha.job_id}/${id}/anexos/`;
  const arquivos = (linha.anexos ?? []).map((a) => a.arquivo_path).filter((p) => p.startsWith(prefixo));
  if (arquivos.length > 0) await supabase.storage.from(BUCKET).remove(arquivos);

  await logAuditEvent({
    acao: "pedido_compra.a_emitir.excluida",
    tenantId,
    entidadeTipo: "pedido_compra_a_emitir",
    entidadeId: id,
    metadata: { valor: Number(linha.valor), item_realizado_id: linha.item_realizado_id, job_id: linha.job_id },
  });

  revalidatePath(`/jobs/${linha.job_id}`);
  return { ok: true };
}

/**
 * Quem pode ser titular da verba de alimentação ou de transporte (decisão
 * 164): colaboradores ativos do RH e freelas ativos. O formulário pede a
 * lista quando a verba nova é escolhida — ela não viaja com a página do job.
 */
/**
 * "Solicitar aprovação" da PP (decisão 223): a PP a emitir, já salva, leva o
 * realizado do item acima do orçado e quem gera não aprova direto. O pedido
 * guarda o motivo e o retrato da PP; aprovado, a produção gera a PP.
 */
export async function solicitarAprovacaoDaPP(aEmitirId: string, motivo: string): Promise<Result<{ id: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  const texto = motivo.trim();
  if (!texto) return { ok: false, message: "Escreva o motivo para enviar." };
  if (texto.length > 2000) return { ok: false, message: "O motivo passou de 2.000 caracteres." };
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: linha } = await supabase
    .from("pedidos_compra_a_emitir")
    .select("id, job_id, item_realizado_id, pp_id, excluida_em, valor")
    .eq("id", aEmitirId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; job_id: string; item_realizado_id: string; pp_id: string | null; excluida_em: string | null; valor: number | string }>();
  if (!linha || linha.excluida_em) return { ok: false, message: "PP a emitir não encontrada. Recarregue a página." };
  if (linha.pp_id) return { ok: false, message: "Esta PP a emitir já virou PP. Recarregue a página." };

  const gate = await checarGatesRealizado(linha.item_realizado_id);
  if (!gate.ok) return gate;
  const { item } = gate;
  const valor = Number(linha.valor);
  const [regrasDoComite, valorAprovado] = await Promise.all([
    carregarRegrasDoComite(supabase, tenantId),
    valorAprovadoNoComite(supabase, tenantId, aEmitirId),
  ]);
  const precisa = bloqueioGeracaoPPPeloComite({
    papel: session.activeRole,
    regras: regrasDoComite,
    realizadoComAPP: Math.round((item.total_realizado + valor) * 100) / 100,
    orcado: item.total_orcado,
    linhaVermelha: item.linha_vermelha,
    valor,
    valorAprovado,
  });
  if (!precisa) {
    return { ok: false, message: "Esta PP não precisa do Comitê. Recarregue a página e gere a PP." };
  }

  const { data: pedido, error } = await supabase
    .from("comite_pedidos")
    .insert({
      tenant_id: tenantId,
      tipo: "pp",
      // O job, a linha, o retrato e quem enviou, o banco preenche
      // (`comite_pedido_guarda`).
      pp_a_emitir_id: aEmitirId,
      job_id: linha.job_id,
      item_realizado_id: linha.item_realizado_id,
      motivo: texto,
      enviado_por: session.profile.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !pedido) {
    console.error("[comite.solicitar.pp]", error?.message);
    return {
      ok: false,
      message: error?.code === "23505"
        ? "Esta PP já está aguardando o Comitê."
        : "Não foi possível solicitar a aprovação.",
    };
  }
  await logAuditEvent({
    acao: "comite.pedido_enviado",
    tenantId,
    entidadeTipo: "comite_pedido",
    entidadeId: pedido.id,
    metadata: { tipo: "pp", pp_a_emitir_id: aEmitirId, job_id: linha.job_id, valor },
  });
  revalidatePath(`/jobs/${linha.job_id}`);
  revalidatePath("/comite");
  return { ok: true, id: pedido.id };
}

export async function listarPessoasParaVerba(): Promise<Result<{ pessoas: PessoaParaVerba[] }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  const pessoas = await carregarPessoasParaVerba(createClient(), session.activeTenant.id);
  return { ok: true, pessoas };
}

/**
 * Gera a PP a partir da PP a emitir — o "Gerar PP" da revisão (decisão
 * 153). A geração é a de sempre (`finalizarPedidoCompraImpl`): código, PDF,
 * parcelas, anexos (com a NF de cada um) e a marca da última PP do item. O
 * job aguardando abertura ou devolvido pelo financeiro não gera.
 *
 * Decisão 166: nem a PP de fornecedor pessoa jurídica sem regime
 * tributário ou sem CNAE. A PP a emitir fica salva, esperando o cadastro.
 */
/**
 * O pagamento digitado de uma PP gerada, para o formulário de edição
 * (decisões 173 e 193). Só devolve quando o titular não paga pelo cadastro:
 * o PIX e a conta que o banco copiou do cadastro nunca vão para a tela.
 */
export async function pagamentoDigitadoDaPP(ppId: string): Promise<Result<{ pagamento: PagamentoDoTitular | null }>> {
  const session = await requireSession();
  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const { data } = await supabase
    .from("pedidos_compra")
    .select(`verba_producao, verba_colaborador_id, verba_freela_id, ${COLUNAS_DA_FOTO_DO_TITULAR}`)
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const pp = data as
    | (FotoDePagamentoDaPP & {
        verba_producao: boolean;
        verba_titular_tipo: TitularDaVerbaTipo | null;
        verba_colaborador_id: string | null;
        verba_freela_id: string | null;
      })
    | null;
  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (!pp.verba_producao || (pp.verba_titular_tipo !== "colaborador" && pp.verba_titular_tipo !== "freela")) {
    return { ok: true, pagamento: null };
  }
  const pessoa = (await carregarPessoasParaVerba(supabase, tenantId)).find(
    (p) => p.id === (pp.verba_colaborador_id ?? pp.verba_freela_id),
  );
  if (!pessoa || pessoa.pagaPeloCadastro) return { ok: true, pagamento: null };
  return { ok: true, pagamento: pagamentoDoTitularDaFoto(pp) };
}

export async function gerarPPDaPPAEmitir(id: string): Promise<Result<{ codigo: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: linha } = await supabase
    .from("pedidos_compra_a_emitir")
    .select(
      "id, job_id, item_realizado_id, pp_id, excluida_em, dados, ultima_pp_do_item, refaz_pp_id, " +
        "anexos:pedidos_compra_a_emitir_anexos(id, arquivo_path, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype, " +
        "documento_tipo, documento_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_valor_na_pp, created_at)",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      job_id: string;
      item_realizado_id: string;
      pp_id: string | null;
      excluida_em: string | null;
      dados: z.input<typeof dadosSchema>;
      ultima_pp_do_item: boolean | null;
      refaz_pp_id: string | null;
      anexos: Array<{
        id: string;
        arquivo_path: string;
        arquivo_nome_original: string;
        arquivo_tamanho_bytes: number | string;
        arquivo_mimetype: string;
        documento_tipo: (typeof DOCUMENTO_TIPOS)[number] | null;
        documento_numero: string | null;
        nf_data_emissao: string | null;
        nf_valor: number | string | null;
        nf_tomador_estabelecimento_id: string | null;
        nf_valor_na_pp: number | string | null;
        created_at: string;
      }> | null;
    }>();
  if (!linha) return { ok: false, message: "PP a emitir não encontrada." };
  if (linha.excluida_em) return { ok: false, message: "Esta PP a emitir foi excluída. Recarregue a página." };
  if (!linha.pp_id && (await ppAguardandoComite(supabase, tenantId, id))) {
    return { ok: false, message: "A PP está aguardando aprovação do Comitê." };
  }
  if (linha.pp_id) {
    const { data: pp } = await supabase
      .from("pedidos_compra")
      .select("codigo")
      .eq("id", linha.pp_id)
      .maybeSingle<{ codigo: string }>();
    return pp ? { ok: true, codigo: pp.codigo } : { ok: false, message: "Recarregue a página." };
  }

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("status")
    .eq("id", linha.job_id)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ status: string }>();
  const travada = geracaoTravadaPeloJob(jobRow?.status ?? "");
  if (travada) return { ok: false, message: travada };
  if (typeof linha.ultima_pp_do_item !== "boolean") {
    return { ok: false, message: "Abra a PP a emitir e responda se esta é a última PP deste item." };
  }

  // Decisão 166: o cadastro do fornecedor precisa do regime e do CNAE.
  // Vale para a PP comum e para a verba de um terceiro (decisão 164).
  const fornecedorDaPP = usaFornecedor(linha.dados) ? linha.dados.fornecedor_id ?? null : null;
  if (fornecedorDaPP) {
    const { data: cadastro } = await supabase
      .from("fornecedores")
      .select("nome, tipo_pessoa, regime_tributario, cnae")
      .eq("id", fornecedorDaPP)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ nome: string; tipo_pessoa: string; regime_tributario: string | null; cnae: string | null }>();
    const falta = pendenciasDoCadastroFiscal(cadastro);
    if (falta.length > 0) {
      const completa =
        pode(session.activeRole, "cadastros.fornecedores.editar") ||
        pode(session.activeRole, "cadastros.fornecedores.inline");
      return {
        ok: false,
        message: `O cadastro de ${cadastro?.nome ?? "fornecedor"} está incompleto: falta ${listarPendencias(falta)}. ${
          completa
            ? "Clique em Editar e no lápis ao lado do fornecedor para completar."
            : "Peça ao financeiro para completar o cadastro."
        }`,
      };
    }
  }

  const num = (v: number | string | null) => (v === null || v === "" ? null : Number(v));
  const anexos = (linha.anexos ?? [])
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((a) => ({
      anexo_id: a.id,
      documento_tipo: a.documento_tipo,
      documento_numero: a.documento_numero,
      path: a.arquivo_path,
      nome_original: a.arquivo_nome_original,
      tamanho_bytes: Number(a.arquivo_tamanho_bytes),
      mimetype: a.arquivo_mimetype as (typeof PP_ANEXO_MIMETYPES_ACEITOS)[number],
      nf_data_emissao: a.nf_data_emissao,
      nf_valor: num(a.nf_valor),
      nf_tomador_estabelecimento_id: a.nf_tomador_estabelecimento_id,
      nf_valor_na_pp: num(a.nf_valor_na_pp),
    }));

  let res: Result<{ codigo: string }>;
  try {
    res = await finalizarPedidoCompraImpl(
      id,
      linha.dados,
      anexos,
      linha.item_realizado_id,
      linha.ultima_pp_do_item,
    );
  } catch (err) {
    console.error("[pp.a_emitir.gerar.exception]", err);
    return {
      ok: false,
      message: `Falha ao gerar a PP: ${err instanceof Error ? err.message : "erro desconhecido"}.`,
    };
  }
  if (!res.ok) return res;

  const { error: marcaErr } = await supabase
    .from("pedidos_compra_a_emitir")
    .update({ pp_id: id, gerada_em: new Date().toISOString(), atualizada_por: session.profile.id })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("pp_id", null);
  if (marcaErr) console.error("[pp.a_emitir.gerar.marca]", marcaErr.message);

  await logAuditEvent({
    acao: "pedido_compra.a_emitir.gerada",
    tenantId,
    entidadeTipo: "pedido_compra_a_emitir",
    entidadeId: id,
    metadata: {
      pp_codigo: res.codigo,
      refaz_pp_id: linha.refaz_pp_id,
      item_realizado_id: linha.item_realizado_id,
      job_id: linha.job_id,
    },
  });

  revalidatePath(`/jobs/${linha.job_id}`);
  return res;
}

/**
 * "Editar e Reemitir PP" (até 19/10/2026, "Cancelar e refazer") da PP rejeitada
 * pelo financeiro (decisão 153). A PP não se edita: ela é cancelada (fica
 * no histórico) e volta como PP a
 * emitir, com os mesmos dados e os mesmos documentos — os arquivos são
 * copiados para o lugar da PP nova, que nasce com outro código ao gerar.
 * A PP a emitir lembra qual PP refaz (`refaz_pp_id`): o formulário mostra o
 * motivo da rejeição, e a PP nova, "Substitui a PP-…".
 */
export async function cancelarERefazerPP(
  ppId: string,
): Promise<Result<{ aEmitirId: string; codigo: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.cancelar_pp");
  if (!permissao.ok) return permissao;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select(
      "*, parcelas:pedidos_compra_parcelas(numero, data_vencimento, valor), " +
        "anexos:pedidos_compra_anexos(id, arquivo_path, arquivo_nome_original, arquivo_tamanho_bytes, arquivo_mimetype, " +
        "documento_tipo, documento_numero, nf_data_emissao, nf_valor, nf_tomador_estabelecimento_id, nf_valor_na_pp, created_at, " +
        "nota:notas_fiscais_fornecedor(numero, data_emissao, valor, tomador_estabelecimento_id))",
    )
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!pp) return { ok: false, message: "PP não encontrada." };
  const linhaPP = pp as unknown as Record<string, unknown> & {
    codigo: string;
    status: PPStatus;
    job_id: string;
    item_realizado_id: string;
    empresa_id: string;
    estabelecimento_id: string | null;
    verba_producao: boolean;
    fornecedor_id: string | null;
    responsavel_verba_id: string | null;
    tipo_verba: TipoVerba | null;
    verba_titular_tipo: TitularDaVerbaTipo | null;
    verba_colaborador_id: string | null;
    verba_freela_id: string | null;
    verba_titular_nome: string | null;
    reembolso_tipo: ReembolsoTipo | null;
    reembolso_deslocamentos: DeslocamentosDoReembolso | null;
    /** Decisão 209. */
    cartao_corporativo: boolean | null;
    cartao_plataforma: string | null;
    cartao_link: string | null;
    servico: string;
    especificacoes: string | null;
    valor_unitario: number | string;
    quantidade: number | string;
    dias_meses: number | string;
    valor: number | string;
    prazo_pagamento: string;
    urgente: boolean | null;
    urgente_justificativa: string | null;
    parcelas: Array<{ numero: number; data_vencimento: string; valor: number | string }> | null;
    anexos: Array<{
      id: string;
      arquivo_path: string;
      arquivo_nome_original: string;
      arquivo_tamanho_bytes: number | string;
      arquivo_mimetype: string;
      documento_tipo: (typeof DOCUMENTO_TIPOS)[number] | null;
      documento_numero: string | null;
      nf_data_emissao: string | null;
      nf_valor: number | string | null;
      nf_tomador_estabelecimento_id: string | null;
      nf_valor_na_pp: number | string | null;
      created_at: string;
      nota: {
        numero: string;
        data_emissao: string;
        valor: number | string;
        tomador_estabelecimento_id: string;
      } | null;
    }> | null;
  };
  if (linhaPP.status !== "rejeitada") {
    return {
      ok: false,
      message: "Só a PP rejeitada pelo financeiro se cancela para refazer.",
    };
  }

  const gate = await checarGatesRealizado(linhaPP.item_realizado_id);
  if (!gate.ok) return gate;
  // A rejeitada já esteve no financeiro: quem a refaz é quem envia (decisão 136).
  const barrado = await barrarEnvioPeloPapel(gate.session, ppId, gate.job);
  if (barrado) return barrado;

  // "Esta é a última PP deste item?" volta respondida como da primeira vez
  // (Tiago, 19/10/2026): a resposta da PP a emitir que gerou a rejeitada.
  // A PP gerada antes da decisão 153 não tem PP a emitir; o rastro da
  // resposta é o item marcado como concluído.
  const [{ data: origem }, { data: itemDaPP }] = await Promise.all([
    supabase
      .from("pedidos_compra_a_emitir")
      .select("ultima_pp_do_item")
      .eq("pp_id", ppId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("jobs_itens_realizado")
      .select("pps_concluidas_em")
      .eq("id", linhaPP.item_realizado_id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const ultimaDaPrimeiraVez =
    typeof origem?.ultima_pp_do_item === "boolean"
      ? origem.ultima_pp_do_item
      : itemDaPP
        ? itemDaPP.pps_concluidas_em != null
        : null;

  // Decisão 193: o pagamento digitado volta com o resto, para quem não paga
  // pelo cadastro. O do cadastro fica no banco: a PP nova tira a foto de novo.
  const titularPessoaDaPP =
    linhaPP.verba_producao && (linhaPP.verba_titular_tipo === "colaborador" || linhaPP.verba_titular_tipo === "freela");
  const pagaPeloCadastroHoje = titularPessoaDaPP
    ? ((await carregarPessoasParaVerba(supabase, tenantId)).find(
        (p) => p.id === (linhaPP.verba_colaborador_id ?? linhaPP.verba_freela_id),
      )?.pagaPeloCadastro ?? false)
    : null;

  // Os mesmos dados, no formato do formulário.
  const fora = lerPagamentoForaDoCadastro(linhaPP as Parameters<typeof lerPagamentoForaDoCadastro>[0]);
  const parcelas = (linhaPP.parcelas ?? [])
    .slice()
    .sort((a, b) => a.numero - b.numero)
    .map((p) => ({ data_vencimento: p.data_vencimento.slice(0, 10), valor: Number(p.valor) }));
  const dados = {
    empresa_id: linhaPP.empresa_id,
    estabelecimento_id: linhaPP.estabelecimento_id ?? null,
    prazo_pagamento: (parcelas[0]?.data_vencimento ?? linhaPP.prazo_pagamento).slice(0, 10),
    servico: linhaPP.servico,
    valor_unitario: Number(linhaPP.valor_unitario),
    quantidade: Number(linhaPP.quantidade),
    dias_meses: Number(linhaPP.dias_meses),
    especificacoes: linhaPP.especificacoes ?? null,
    urgente: linhaPP.urgente === true,
    urgente_justificativa: linhaPP.urgente_justificativa ?? null,
    parcelas: parcelas.length
      ? parcelas
      : [{ data_vencimento: linhaPP.prazo_pagamento.slice(0, 10), valor: Number(linhaPP.valor) }],
    verba_producao: linhaPP.verba_producao,
    // Decisão 164: o tipo e o titular voltam como estavam. Decisão 187: o
    // reembolso, com o tipo e os deslocamentos.
    tipo_verba: linhaPP.verba_producao ? (linhaPP.tipo_verba ?? "producao") : null,
    reembolso_tipo: linhaPP.reembolso_tipo ?? null,
    deslocamentos: linhaPP.reembolso_deslocamentos ?? null,
    fornecedor_id:
      !linhaPP.verba_producao || linhaPP.verba_titular_tipo === "fornecedor" ? linhaPP.fornecedor_id : null,
    // A verba de produção anterior à 171 volta com o responsável que tinha;
    // o formulário pede o titular antes de gerar de novo.
    responsavel_verba_id: verbaDeResponsavel(linhaPP) ? linhaPP.responsavel_verba_id : null,
    verba_titular_tipo: linhaPP.verba_titular_tipo ?? null,
    verba_titular_id: linhaPP.verba_colaborador_id ?? linhaPP.verba_freela_id ?? null,
    pagamento_fora_do_cadastro: fora
      ? {
          meio: fora.meio,
          motivo: fora.motivo,
          pix_tipo: fora.pix_tipo,
          pix_chave: fora.pix_chave,
          banco_codigo: fora.banco_codigo,
          agencia: fora.agencia,
          agencia_dv: fora.agencia_dv,
          conta: fora.conta,
          conta_dv: fora.conta_dv,
          tipo_conta: fora.tipo_conta,
        }
      : null,
    pagamento_do_titular:
      pagaPeloCadastroHoje === false
        ? pagamentoDoTitularDaFoto(linhaPP as Parameters<typeof pagamentoDoTitularDaFoto>[0])
        : null,
    titular_paga_pelo_cadastro: pagaPeloCadastroHoje,
    // Decisão 209: o cartão corporativo volta com a plataforma e o link.
    cartao_corporativo: cartaoDaLinha(linhaPP),
  };

  // A PP a emitir nova, com os documentos copiados para o lugar dela.
  const novoId = crypto.randomUUID();
  const prefixo = `${tenantId}/${linhaPP.job_id}/${novoId}/anexos/`;
  const copiados: string[] = [];
  const anexosNovos: Array<Record<string, unknown>> = [];
  const horariosDosAnexos = horariosEmOrdem((linhaPP.anexos ?? []).length);
  const desfazerArquivos = async () => {
    if (copiados.length > 0) await supabase.storage.from(BUCKET).remove(copiados);
  };
  for (const a of (linhaPP.anexos ?? []).slice().sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const anexoId = crypto.randomUUID();
    const destino = `${prefixo}${anexoId}-${a.arquivo_nome_original.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100)}`;
    const { error: copiaErr } = await supabase.storage.from(BUCKET).copy(a.arquivo_path, destino);
    if (copiaErr) {
      await desfazerArquivos();
      return { ok: false, message: `Falha ao copiar ${a.arquivo_nome_original}: ${copiaErr.message}` };
    }
    copiados.push(destino);
    const nf = a.documento_tipo === "nota_fiscal";
    anexosNovos.push({
      id: anexoId,
      tenant_id: tenantId,
      a_emitir_id: novoId,
      arquivo_path: destino,
      arquivo_nome_original: a.arquivo_nome_original,
      arquivo_tamanho_bytes: Number(a.arquivo_tamanho_bytes),
      arquivo_mimetype: a.arquivo_mimetype,
      documento_tipo: a.documento_tipo,
      documento_numero: a.nota?.numero ?? a.documento_numero,
      // Decisão 187: o comprovante do reembolso leva a data e o valor em
      // qualquer tipo.
      nf_data_emissao: nf ? (a.nota?.data_emissao ?? a.nf_data_emissao) : a.nf_valor !== null ? a.nf_data_emissao : null,
      nf_valor: nf ? (a.nota?.valor ?? a.nf_valor) : a.nf_valor,
      // A fatura e o recibo levam o CNPJ também (revisão da 156).
      nf_tomador_estabelecimento_id: nf
        ? (a.nota?.tomador_estabelecimento_id ?? a.nf_tomador_estabelecimento_id)
        : documentoTemCnpj(a.documento_tipo)
          ? a.nf_tomador_estabelecimento_id
          : null,
      nf_valor_na_pp: nf ? a.nf_valor_na_pp : null,
      criado_por: session.profile.id,
      created_at: horariosDosAnexos[anexosNovos.length],
    });
  }

  const { error: insertErr } = await supabase.from("pedidos_compra_a_emitir").insert({
    id: novoId,
    tenant_id: tenantId,
    job_id: linhaPP.job_id,
    item_realizado_id: linhaPP.item_realizado_id,
    empresa_id: dados.empresa_id,
    ...colunasDaVerba(dados, linhaPP.verba_titular_nome ?? null),
    // A verba de produção anterior à 171 não tem titular: a PP a emitir
    // guarda o responsável que ela tinha, a única forma que a `chk_ppae_verba`
    // aceita sem titular, e o formulário pede o titular antes de gerar. Sem
    // isso a reemissão falhava na checagem (PP-00127, 19/10/2026).
    ...(verbaDeResponsavel(linhaPP) && linhaPP.responsavel_verba_id
      ? { responsavel_verba_id: linhaPP.responsavel_verba_id, verba_titular_nome: null }
      : {}),
    servico: dados.servico,
    valor: Number(linhaPP.valor),
    dados,
    // Até 19/10/2026 a pergunta voltava em branco; agora volta como foi
    // respondida, e a produção troca se o item mudou.
    ultima_pp_do_item: ultimaDaPrimeiraVez,
    refaz_pp_id: ppId,
    criada_por: session.profile.id,
    atualizada_por: session.profile.id,
  });
  if (insertErr) {
    await desfazerArquivos();
    return { ok: false, message: `Falha ao refazer: ${insertErr.message}` };
  }
  if (anexosNovos.length > 0) {
    const { error: anexosErr } = await supabase.from("pedidos_compra_a_emitir_anexos").insert(anexosNovos);
    if (anexosErr) {
      await supabase.from("pedidos_compra_a_emitir").delete().eq("id", novoId).eq("tenant_id", tenantId);
      await desfazerArquivos();
      return { ok: false, message: `Falha ao refazer: ${anexosErr.message}` };
    }
  }

  // Só agora a PP rejeitada sai: sem a PP a emitir no lugar, nada se cancela.
  const { data: cancelada, error: cancelErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "cancelada",
      cancelada_por: session.profile.id,
      cancelada_em: new Date().toISOString(),
      motivo_cancelamento: "Rejeitada pelo financeiro e reemitida (Editar e Reemitir PP).",
    })
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .eq("status", "rejeitada")
    .select("id");
  if (cancelErr || !cancelada || cancelada.length === 0) {
    await supabase.from("pedidos_compra_a_emitir").delete().eq("id", novoId).eq("tenant_id", tenantId);
    await desfazerArquivos();
    return {
      ok: false,
      message: cancelErr ? `Falha ao cancelar a PP: ${cancelErr.message}` : `${linhaPP.codigo} já tinha saído de rejeitada.`,
    };
  }

  // Como no cancelamento comum: o fornecedor do item volta a ficar livre.
  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: null })
    .eq("id", linhaPP.item_realizado_id)
    .eq("tenant_id", tenantId);

  await logAuditEvent({
    acao: "pedido_compra.cancelada",
    tenantId,
    entidadeTipo: "pedido_compra",
    entidadeId: ppId,
    metadata: {
      pp_codigo: linhaPP.codigo,
      item_realizado_id: linhaPP.item_realizado_id,
      job_id: linhaPP.job_id,
      origem: "cancelar_e_refazer",
      pp_a_emitir_id: novoId,
    },
  });

  // Decisão 190: a PP rejeitada que sai também ganha o selo de cancelada.
  await trocarSeloDaPP(supabase, tenantId, ppId, linhaPP.codigo);

  revalidatePath(`/jobs/${linhaPP.job_id}`);
  return { ok: true, aEmitirId: novoId, codigo: linhaPP.codigo };
}

// ---------------------------------------------------------------------------
// Atualizar vencimento (decisão 157)
// ---------------------------------------------------------------------------

/**
 * Os feriados nacionais do cadastro, para a tela calcular a data-limite de
 * envio com a mesma conta do servidor (decisão 157): o calendário do
 * prazo, o "envie até" e o atalho "Atualizar vencimento".
 */
export async function feriadosNacionaisParaPP(): Promise<string[]> {
  const session = await requireSession();
  return carregarFeriadosNacionais(createClient(), session.activeTenant.id);
}

/**
 * "Atualizar vencimento" da PP gerada que perdeu o prazo de envio
 * (decisão 157). Pedido do Tiago em 07/10/2026: em vez de "Cancelar e
 * refazer", escolher a nova janela e apertar um botão.
 *
 * A PP continua a mesma — código, documentos, valores e dados de pagamento.
 * Mudam o 1º vencimento, as parcelas seguintes (onde estavam, se ainda
 * couberem; senão, a primeira data possível — decisão 172 —, com os mesmos
 * valores) e o PDF, refeito com as datas novas e a data de emissão de antes.
 * Na PP urgente e na de verba, a data nova pode ser uma quarta de exceções.
 *
 * Só vale para a PP ainda no job (`gerada`) e só quando o vencimento atual
 * já não aceita envio. Desde a decisão 173 a PP gerada também se edita
 * inteira (`editarPPGerada`); este atalho continua para quem só precisa da
 * data nova.
 */
export async function atualizarVencimentoDaPP(
  ppId: string,
  novoVencimento: string,
): Promise<Result<{ codigo: string; vencimento: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  if (!z.string().uuid().safeParse(ppId).success || !dataSchema.safeParse(novoVencimento).success) {
    return { ok: false, message: "Escolha um vencimento válido." };
  }
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: ppBruta } = await supabase
    .from("pedidos_compra")
    .select(`*, parcelas:pedidos_compra_parcelas(id, numero, data_vencimento, valor), ${ITEM_DA_PP}`)
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!ppBruta) return { ok: false, message: "PP não encontrada." };
  const pp = ppBruta as unknown as FotoDePagamentoDaPP & {
    id: string;
    codigo: string;
    status: PPStatus;
    job_id: string;
    item_realizado_id: string;
    estabelecimento_id: string | null;
    verba_producao: boolean;
    fornecedor_id: string | null;
    responsavel_verba_id: string | null;
    tipo_verba: TipoVerba | null;
    verba_titular_nome: string | null;
    servico: string;
    especificacoes: string | null;
    quantidade: number | string;
    valor: number | string;
    prazo_pagamento: string;
    urgente: boolean;
    pdf_path: string | null;
    created_at: string;
    dados_pagamento_congelados_em: string | null;
    /** Decisão 171: a origem do titular e o CPF do colaborador (da foto). */
    verba_titular_tipo: TitularDaVerbaTipo | null;
    verba_titular_cpf: string | null;
    /** Decisão 187. */
    reembolso_tipo: ReembolsoTipo | null;
    reembolso_deslocamentos: DeslocamentosDoReembolso | null;
    /** Decisão 209. */
    cartao_corporativo: boolean | null;
    cartao_plataforma: string | null;
    cartao_link: string | null;
    parcelas: Array<{ id: string; numero: number; data_vencimento: string; valor: number | string }> | null;
    /** Decisão 191: o nome do item da planilha, para o PDF. */
    realizado: ItemDaPPEmbutido;
  };
  if (pp.status !== "gerada") {
    return {
      ok: false,
      message: `${pp.codigo} já saiu do job: o vencimento só se atualiza antes do envio ao financeiro.`,
    };
  }

  const gate = await checarGatesRealizado(pp.item_realizado_id);
  if (!gate.ok) return gate;
  const { job } = gate;

  const hoje = hojeEmSaoPauloIso();
  const feriados = await carregarFeriadosNacionais(supabase, tenantId);
  const atual = pp.prazo_pagamento.slice(0, 10);
  if (vencimentoAceitaEnvio(atual, hoje, feriados)) {
    return {
      ok: false,
      message: `O vencimento ${isoParaBr(atual)} ainda aceita envio até ${isoParaBr(dataLimiteDeEnvio(atual, feriados) ?? atual)}. Envie a PP como está.`,
    };
  }
  const novo = novoVencimento.slice(0, 10);
  // Na PP urgente e na de verba, a data nova pode ser uma quarta de
  // exceções (decisão 172).
  const erroJanela = validarVencimentosNasJanelas(
    [novo],
    [],
    feriados,
    ppAceitaQuarta({ urgente: pp.urgente === true, verba: pp.verba_producao === true }),
  );
  if (erroJanela) return { ok: false, message: erroJanela };

  // As parcelas na ordem; a PP sem linha de parcela (anterior a 17/08) vira
  // uma só, com o valor da PP.
  const parcelasAntes = (pp.parcelas ?? [])
    .slice()
    .sort((a, b) => a.numero - b.numero)
    .map((p) => ({ id: p.id, numero: p.numero, data_vencimento: p.data_vencimento.slice(0, 10), valor: Number(p.valor) }));
  if (parcelasAntes.length === 0) {
    return { ok: false, message: "Esta PP não tem parcelas gravadas. Cancele e gere outra." };
  }
  // Decisão 172: as parcelas seguintes ficam onde estão se ainda couberem
  // (pulando a janela logo depois da anterior); senão, vão para a primeira
  // data possível. Os valores não mudam.
  const datasNovas = acomodarDatasDasParcelas(
    novo,
    parcelasAntes.map((p) => ({ data: p.data_vencimento, ajustada: true })),
  );
  const parcelasNovas = parcelasAntes.map((p, i) => ({ ...p, data_vencimento: datasNovas[i].data }));

  // ---- O PDF com as datas novas, antes de gravar ----
  // Mesmo documento de antes: o pagamento sai da foto que a PP tirou na
  // geração (cadastro + meio escolhido, decisões 067 e 127), não do
  // cadastro de agora.
  const [fornRes, cnpjDaPP, responsavelRes, contexto] = await Promise.all([
    !pp.fornecedor_id
      ? Promise.resolve({ data: null })
      : supabase.from("fornecedores").select("*").eq("id", pp.fornecedor_id).eq("tenant_id", tenantId).maybeSingle(),
    // O cabeçalho é o do CNPJ da PP (decisão 156), o mesmo da geração.
    cnpjDaPPNaGeracao(supabase, tenantId, job, pp.estabelecimento_id),
    verbaDeResponsavel(pp) && pp.responsavel_verba_id
      ? supabase.from("profiles").select("nome").eq("id", pp.responsavel_verba_id).maybeSingle()
      : Promise.resolve({ data: null }),
    carregarContextoPdf(supabase, tenantId, job),
  ]);
  if (!cnpjDaPP.ok) return cnpjDaPP;
  const cadastro = (fornRes.data ?? null) as Record<string, unknown> | null;
  const fornecedorDoPdf =
    cadastro && pp.dados_pagamento_congelados_em
      ? { ...cadastro, ...lerFoto(pp) }
      : fornecedorDoDocumento(
          cadastro,
          lerPagamentoForaDoCadastro(ppBruta as Parameters<typeof lerPagamentoForaDoCadastro>[0]),
        );

  let documento: { path: string; buffer: Buffer };
  try {
    documento = await renderizarDocumentoDaPP({
      tenantId,
      jobId: job.id,
      ppId: pp.id,
      codigo: pp.codigo,
      pp: {
        servico: pp.servico,
        quantidade: Number(pp.quantidade),
        especificacoes: pp.especificacoes ?? null,
        valor: Number(pp.valor),
        verba_producao: pp.verba_producao,
        tipo_verba: pp.tipo_verba,
        verba_titular_tipo: pp.verba_titular_tipo ?? null,
        reembolso_tipo: pp.reembolso_tipo ?? null,
        reembolso_deslocamentos: pp.reembolso_deslocamentos ?? null,
      },
      empresa: cnpjDaPP.empresa,
      fornecedor: fornecedorDoPdf,
      cartao: cartaoDaLinha(pp),
      // Decisão 171: o pagamento do colaborador sai da foto da PP.
      pagamentoDoTitular: pagamentoDoTitularDaPP(pp),
      pagamentoPeloAnexo: meioPeloAnexo(
        (ppBruta as { pagamento_fora_do_cadastro_meio?: string | null }).pagamento_fora_do_cadastro_meio,
      ),
      responsavelVerbaNome: !pp.verba_producao
        ? null
        : verbaDeResponsavel(pp)
          ? ((responsavelRes.data as { nome?: string } | null)?.nome ?? "")
          : (pp.verba_titular_nome ?? ""),
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      itemNome: nomeDoItemDaPP(pp.realizado),
      contexto,
      parcelas: parcelasNovas,
      emitidaEm: pp.created_at,
      // Só a PP gerada atualiza o vencimento (decisão 157): segue com o selo.
      selo: SELO_NAO_ENVIADA,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Falha ao refazer o PDF: ${msg}` };
  }

  // ---- Grava: a PP (só se ainda gerada — trava de corrida) e as parcelas ----
  const { data: atualizada, error: ppErr } = await supabase
    .from("pedidos_compra")
    .update({ prazo_pagamento: novo })
    .eq("id", pp.id)
    .eq("tenant_id", tenantId)
    .eq("status", "gerada")
    .select("id");
  if (ppErr || !atualizada || atualizada.length === 0) {
    return {
      ok: false,
      message: ppErr ? `Falha ao atualizar o vencimento: ${ppErr.message}` : "A PP mudou de situação. Recarregue a página.",
    };
  }

  const desfazer = async () => {
    await supabase.from("pedidos_compra").update({ prazo_pagamento: atual }).eq("id", pp.id).eq("tenant_id", tenantId);
    for (const p of parcelasAntes) {
      await supabase
        .from("pedidos_compra_parcelas")
        .update({ data_vencimento: p.data_vencimento })
        .eq("id", p.id)
        .eq("tenant_id", tenantId);
    }
  };

  for (const p of parcelasNovas) {
    const { error } = await supabase
      .from("pedidos_compra_parcelas")
      .update({ data_vencimento: p.data_vencimento })
      .eq("id", p.id)
      .eq("tenant_id", tenantId);
    if (error) {
      await desfazer();
      return { ok: false, message: `Falha ao atualizar a parcela ${p.numero}: ${error.message}` };
    }
  }

  // O PDF por cima do anterior, no mesmo caminho.
  const caminho = pp.pdf_path || documento.path;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(caminho, documento.buffer, { contentType: "application/pdf", upsert: true });
  if (uploadErr) {
    await desfazer();
    return { ok: false, message: `Falha ao subir o PDF: ${uploadErr.message}` };
  }

  await logAuditEvent({
    acao: "pedido_compra.vencimento_atualizado",
    tenantId,
    entidadeTipo: "pedido_compra",
    entidadeId: pp.id,
    metadata: {
      pp_codigo: pp.codigo,
      job_id: job.id,
      de: parcelasAntes.map((p) => p.data_vencimento),
      para: parcelasNovas.map((p) => p.data_vencimento),
      data_limite_anterior: dataLimiteDeEnvio(atual, feriados),
      data_limite_nova: dataLimiteDeEnvio(novo, feriados),
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, codigo: pp.codigo, vencimento: novo };
}

/**
 * Edita a PP que ainda está no job — status "gerada" (decisão 173,
 * 13/10/2026). Revê a 153, que tinha congelado a PP na geração: duas
 * produtoras travaram em quatro dias (anexar a NF de uma PP já gerada, mudar
 * o parcelamento), e o Tiago decidiu que a PP gerada se edita inteira, no
 * lugar.
 *
 * - O formulário é o mesmo da PP a emitir, com as mesmas regras da geração
 *   (dados, janelas e prazo de envio, urgência, parcelas, cadastro do
 *   fornecedor, CNPJ da PP, titular da verba). As datas que já estavam
 *   gravadas passam como estão: a regra vale para a data que muda.
 * - O código fica. O PDF é refeito por cima do anterior, com a data de
 *   emissão de antes, e os dados de pagamento do fornecedor são congelados
 *   de novo (decisão 067), como na geração.
 * - Os anexos vêm na lista inteira, como no envio: os que saíram somem, os
 *   novos entram, e os que ficaram têm o tipo e a NF atualizados. A NF só se
 *   liga ao cadastro de notas no envio, como antes.
 * - A marca "Pronta para envio" cai: quem preparou confere de novo.
 * - A pergunta "Esta é a última PP deste item?" vale de novo para o item.
 * - A linha do tempo ganha "Editada" pelo gatilho (`editada_em`).
 *
 * Enviada ao financeiro, a PP não muda mais: o update só pega a gerada.
 */
export async function editarPPGerada(
  ppId: string,
  dados: z.input<typeof dadosSchema>,
  anexos: z.input<typeof anexoUploadedSchema>[],
  ultimaPPDoItem: boolean,
): Promise<Result<{ codigo: string }>> {
  if (!z.string().uuid().safeParse(ppId).success) {
    return { ok: false, message: "PP inválida. Feche o formulário e tente de novo." };
  }
  if (typeof ultimaPPDoItem !== "boolean") {
    return { ok: false, message: "Responda se esta é a última PP deste item." };
  }
  try {
    return await editarPPGeradaImpl(ppId, dados, anexos, ultimaPPDoItem);
  } catch (err) {
    console.error("[pp.editar.exception]", err);
    return {
      ok: false,
      message: `Falha ao salvar a PP: ${err instanceof Error ? err.message : "erro desconhecido"}.`,
    };
  }
}

async function editarPPGeradaImpl(
  ppId: string,
  dados: z.input<typeof dadosSchema>,
  anexos: z.input<typeof anexoUploadedSchema>[],
  ultimaPPDoItem: boolean,
): Promise<Result<{ codigo: string }>> {
  const session = await requireSession();
  const permissao = await checarPermissao(session, "jobs.emitir_pp");
  if (!permissao.ok) return permissao;
  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  const { data: ppRow } = await supabase
    .from("pedidos_compra")
    .select(
      "id, codigo, job_id, item_realizado_id, status, pdf_path, created_at, valor, fornecedor_id, " +
        "urgente, urgente_por, urgente_em, pronta_para_envio_em, reembolso_deslocamentos, " +
        "parcelas:pedidos_compra_parcelas(id, numero, data_vencimento, valor, pdf_path)",
    )
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      id: string;
      codigo: string;
      job_id: string;
      item_realizado_id: string;
      status: PPStatus;
      pdf_path: string | null;
      created_at: string;
      valor: number | string;
      fornecedor_id: string | null;
      urgente: boolean;
      urgente_por: string | null;
      urgente_em: string | null;
      pronta_para_envio_em: string | null;
      reembolso_deslocamentos: DeslocamentosDoReembolso | null;
      parcelas: Array<{
        id: string;
        numero: number;
        data_vencimento: string;
        valor: number | string;
        pdf_path: string | null;
      }> | null;
    }>();
  if (!ppRow) return { ok: false, message: "PP não encontrada." };
  if (ppRow.status !== "gerada") {
    return {
      ok: false,
      message: `${ppRow.codigo} já saiu do job: depois do envio ao financeiro, a PP não se edita mais.`,
    };
  }

  const gate = await checarGatesRealizado(ppRow.item_realizado_id);
  if (!gate.ok) return gate;
  const { item, job } = gate;

  // As mesmas portas da geração: o job na pré-abertura ou devolvido só
  // aceita PP a emitir, o job de mídia não tem PP pela planilha, e a linha
  // com save não recebe PP (decisão 099).
  const travada = geracaoTravadaPeloJob(job.status);
  if (travada) return { ok: false, message: travada };
  const travaMidia = await travaDoJobDeMidia(supabase, tenantId, job.id, "pp");
  if (travaMidia) return { ok: false, message: travaMidia };
  const comSave = await barrarPPEmLinhaComSave(supabase, tenantId, item);
  if (comSave) return comSave;

  const dadosParsed = dadosSchema.safeParse(dados);
  if (!dadosParsed.success) {
    return {
      ok: false,
      message: `Dados inválidos: ${dadosParsed.error.issues[0]?.message ?? "erro"}.`,
    };
  }
  const d = dadosParsed.data;

  // ---- Janelas, prazo de envio e urgência (decisões 077 e 157) ----
  // As datas gravadas passam como estão; a data que muda segue a regra.
  const feriados = await carregarFeriadosNacionais(supabase, tenantId);
  const parcelasAntes = (ppRow.parcelas ?? [])
    .slice()
    .sort((a, b) => a.numero - b.numero)
    .map((p) => ({ ...p, data_vencimento: p.data_vencimento.slice(0, 10), valor: Number(p.valor) }));
  const erroJanela = validarVencimentosNasJanelas(
    d.parcelas.map((p) => p.data_vencimento),
    parcelasAntes.map((p) => p.data_vencimento),
    feriados,
    ppAceitaQuarta({ urgente: d.urgente === true, verba: d.verba_producao }),
  );
  if (erroJanela) return { ok: false, message: erroJanela };
  const urgencia = camposDeUrgencia(
    d,
    { urgente: ppRow.urgente, urgente_por: ppRow.urgente_por, urgente_em: ppRow.urgente_em },
    session.profile.id,
  );
  if (!urgencia.ok) return urgencia;

  const valor = valorDaPPPorUnidade(d.valor_unitario, d.quantidade, d.dias_meses);
  if (valor <= 0) {
    return { ok: false, message: "R$ Unit., QT e D/M inválidos: o valor da PP ficaria zerado." };
  }
  // Decisão 223: a edição que deixa a PP mais cara que o aprovado pelo
  // Comitê (ou o realizado acima do orçado sem aprovação) volta ao Comitê.
  // A PP gerada não vai ao Comitê: o pedido nasce da PP a emitir.
  const [regrasDoComite, valorAprovado] = await Promise.all([
    carregarRegrasDoComite(supabase, tenantId),
    valorAprovadoNoComite(supabase, tenantId, ppId),
  ]);
  const bloqueioOrcado = bloqueioGeracaoPPPeloComite({
    papel: session.activeRole,
    regras: regrasDoComite,
    realizadoComAPP: Math.round((item.total_realizado + valor - Number(ppRow.valor)) * 100) / 100,
    orcado: item.total_orcado,
    linhaVermelha: item.linha_vermelha,
    valor,
    valorAprovado,
  })
    ? "Esta edição leva a PP acima do orçado do item sem a aprovação do Comitê de Aprovações (ou acima do valor que ele aprovou). Para solicitar a aprovação, cancele a PP e refaça-a como PP a emitir."
    : null;
  if (bloqueioOrcado) {
    await logAuditEvent({
      acao: "acao_negada", tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra", entidadeId: ppId,
      metadata: { acao_tentada: "pedido_compra.editada", motivo: "realizado_acima_do_orcado", realizado: item.total_realizado, valor, orcado: item.total_orcado },
    });
    return { ok: false, message: bloqueioOrcado };
  }

  if (!parcelasFecham(d.parcelas.map((p) => p.valor), valor)) {
    return {
      ok: false,
      message: `A soma das parcelas precisa fechar com o valor da PP (${brl(valor)}).`,
    };
  }

  // ---- Anexos: conferidos antes de mexer em qualquer coisa ----
  const anexosParsed = z.array(anexoUploadedSchema).safeParse(anexos);
  if (!anexosParsed.success) return { ok: false, message: "Formato de anexo inválido." };
  const nfNoCartao = notaNoCartao(cartaoDe(d), anexosParsed.data);
  if (nfNoCartao) return { ok: false, message: nfNoCartao };
  const conferencia = await conferirAnexosDaPP(supabase, tenantId, job.id, ppId, anexosParsed.data);
  if (conferencia.erro !== null) return { ok: false, message: conferencia.erro };

  // ---- Quem recebe, a empresa e o CNPJ da PP, como na geração ----
  const tipoVerba = tipoDaVerbaDosDados(d);
  const pagaFornecedor = usaFornecedor(d);
  const [fornRes, empRes] = await Promise.all([
    !pagaFornecedor
      ? Promise.resolve({ data: null })
      : supabase
          .from("fornecedores")
          .select("*")
          .eq("id", d.fornecedor_id as string)
          .eq("tenant_id", tenantId)
          .eq("status", "ativo")
          .maybeSingle(),
    supabase
      .from("empresas")
      .select("id")
      .eq("id", job.empresa_id ?? d.empresa_id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  if (pagaFornecedor && !fornRes.data) return { ok: false, message: "Fornecedor inválido ou inativo." };
  const cadastro = fornRes.data as
    | ({ nome: string; tipo_pessoa: string; regime_tributario: string | null; cnae: string | null; sem_dados_pagamento?: boolean } & Record<string, unknown>)
    | null;
  // Decisão 161: fornecedor sem conta nem PIX só sai com chave aleatória ou boleto.
  if (pagaFornecedor && cadastro?.sem_dados_pagamento === true && !foraDoCadastroDe(d)) {
    return {
      ok: false,
      message: "Este fornecedor não tem conta nem PIX no cadastro: escolha chave aleatória ou boleto.",
    };
  }
  // Decisão 166: o cadastro do fornecedor precisa do regime e do CNAE.
  if (pagaFornecedor) {
    const falta = pendenciasDoCadastroFiscal(cadastro);
    if (falta.length > 0) {
      const completa =
        pode(session.activeRole, "cadastros.fornecedores.editar") ||
        pode(session.activeRole, "cadastros.fornecedores.inline");
      return {
        ok: false,
        message: `O cadastro de ${cadastro?.nome ?? "fornecedor"} está incompleto: falta ${listarPendencias(falta)}. ${
          completa
            ? "Clique no lápis ao lado do fornecedor para completar."
            : "Peça ao financeiro para completar o cadastro."
        }`,
      };
    }
  }
  const titular = await nomeDoTitularDaVerba(
    supabase,
    tenantId,
    d,
    fornRes.data as { nome?: string | null; razao_social?: string | null } | null,
  );
  if (!titular.ok) return titular;
  // Decisão 193: o PIX ou a conta digitados de quem não paga pelo cadastro.
  const pagTitular = pagamentoDoTitularNaGravacao(d, titular.pagaPeloCadastro);
  if (!pagTitular.ok) return pagTitular;
  if (!empRes.data) return { ok: false, message: "A empresa gerencial do job não foi encontrada." };
  // Decisão 187: a PP editada mantém o desgaste com que foi feita (ou usa o
  // vigente, se ainda não era de veículo próprio).
  const reembolso = await conferirReembolso(supabase, tenantId, d, ppRow.reembolso_deslocamentos?.desgaste_por_km ?? null);
  if (!reembolso.ok) return reembolso;
  // Revisão da 156: com documento que diga o CNPJ, a empresa emissora é a dele.
  const emissora = emissoraPelosAnexos(anexosParsed.data, d.estabelecimento_id ?? null);
  if (!emissora.ok) return emissora;
  const cnpjDaPP = await cnpjDaPPNaGeracao(
    supabase,
    tenantId,
    { regional_id: job.regional_id, empresa_id: job.empresa_id },
    emissora.id,
  );
  if (!cnpjDaPP.ok) return cnpjDaPP;

  // ---- O PDF novo, antes de gravar: se ele falhar, nada mudou ----
  const parcelasNovas = d.parcelas.map((p, i) => ({
    numero: i + 1,
    data_vencimento: p.data_vencimento,
    valor: Number(p.valor),
  }));
  const contexto = await carregarContextoPdf(supabase, tenantId, job);
  const argsDoDocumento = {
    tenantId,
    jobId: job.id,
    ppId,
    codigo: ppRow.codigo,
    pp: {
      servico: d.servico,
      quantidade: d.quantidade,
      especificacoes: d.especificacoes ?? null,
      valor,
      verba_producao: d.verba_producao,
      tipo_verba: tipoVerba,
      verba_titular_tipo: d.verba_producao ? (d.verba_titular_tipo ?? null) : null,
      ...reembolso.colunas,
    },
    empresa: cnpjDaPP.empresa,
    fornecedor: fornecedorDoDocumento(fornRes.data ?? null, foraDoCadastroDe(d)),
    pagamentoPeloAnexo: meioPeloAnexo(foraDoCadastroDe(d)?.meio),
    cartao: cartaoDe(d),
    // Decisão 171: a verba tem titular nas três; nada novo grava responsável.
    responsavelVerbaNome: tipoVerba ? (titular.nome ?? "") : null,
    job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
    itemNome: item.item_nome,
    contexto,
    parcelas: parcelasNovas,
    // A PP é a mesma: a emissão continua a da geração.
    emitidaEm: ppRow.created_at,
    // Só a PP gerada se edita (decisão 173): segue com o selo (decisão 190).
    selo: SELO_NAO_ENVIADA,
  };
  // Decisões 171 e 193: na verba do colaborador e do freela, a conta e o
  // PIX são a foto que o banco tira do cadastro AO GRAVAR (mantida se o
  // titular é o mesmo, tirada de novo se mudou), ou a digitada. Este
  // documento só confere que o PDF sai; o que sobe é refeito depois do
  // UPDATE, com a foto lida de volta.
  const titularColaborador =
    d.verba_producao && (d.verba_titular_tipo === "colaborador" || d.verba_titular_tipo === "freela");
  let documento: { path: string; buffer: Buffer };
  try {
    documento = await renderizarDocumentoDaPP({ ...argsDoDocumento, pagamentoDoTitular: null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Falha ao refazer o PDF: ${msg}` };
  }
  const caminhoDoPdf = ppRow.pdf_path || documento.path;

  // ---- Grava a PP — só se ainda gerada (trava de corrida) ----
  // A foto do pagamento é tirada de novo, junto do PDF novo (decisão 067).
  const { data: atualizada, error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      ...colunasDaVerba(d, titular.nome),
      ...reembolso.colunas,
      empresa_id: job.empresa_id ?? d.empresa_id,
      estabelecimento_id: cnpjDaPP.id,
      servico: d.servico,
      valor_unitario: d.valor_unitario,
      quantidade: d.quantidade,
      dias_meses: d.dias_meses,
      especificacoes: d.especificacoes ?? null,
      ...urgencia.campos,
      valor,
      prazo_pagamento: parcelasNovas[0].data_vencimento,
      pdf_path: caminhoDoPdf,
      ...tirarFoto(fornRes.data as DadosDePagamento | null, foraDoCadastroDe(d)),
      dados_pagamento_congelados_em: fornRes.data ? new Date().toISOString() : null,
      ...camposDoPagamentoForaDoCadastro(foraDoCadastroDe(d)),
      // Decisão 193: o pagamento digitado do titular sem cadastro usável.
      ...colunasDoPagamentoDoTitular(pagTitular.pagamento),
      // Decisão 173: editar desfaz o "Pronta para envio" — quem preparou
      // confere os documentos de novo. Quem e quando da edição, o gatilho
      // grava pela sessão.
      pronta_para_envio_em: null,
      editada_em: new Date().toISOString(),
    })
    .eq("id", ppId)
    .eq("tenant_id", tenantId)
    .eq("status", "gerada")
    .select("id");
  if (updErr) return { ok: false, message: `Falha ao salvar a PP: ${updErr.message}` };
  if (!atualizada || atualizada.length === 0) {
    return { ok: false, message: `${ppRow.codigo} mudou de situação enquanto você editava. Recarregue a página.` };
  }
  if (titularColaborador) {
    try {
      documento = await renderizarDocumentoDaPP({
        ...argsDoDocumento,
        pagamentoDoTitular: await fotoDoTitularDaPP(supabase, tenantId, ppId),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `A PP foi salva, mas o PDF novo falhou: ${msg}. Abra a PP e salve de novo.` };
    }
  }

  // ---- Parcelas no lugar: a PP nunca fica sem parcela ----
  // As que continuam mudam de data e valor; as que sobram saem; as novas
  // entram. A gerada não tem título nem baixa, então pode ser refeita.
  for (const nova of parcelasNovas) {
    const antes = parcelasAntes.find((p) => p.numero === nova.numero);
    const { error } = antes
      ? await supabase
          .from("pedidos_compra_parcelas")
          .update({ data_vencimento: nova.data_vencimento, valor: nova.valor, pdf_path: caminhoDoPdf })
          .eq("id", antes.id)
          .eq("tenant_id", tenantId)
      : await supabase.from("pedidos_compra_parcelas").insert({
          tenant_id: tenantId,
          pedido_compra_id: ppId,
          numero: nova.numero,
          data_vencimento: nova.data_vencimento,
          valor: nova.valor,
          pdf_path: caminhoDoPdf,
          created_by: session.profile.id,
        });
    if (error) {
      return {
        ok: false,
        message: `A PP foi salva, mas a parcela ${nova.numero} falhou: ${error.message}. Abra a PP e salve de novo.`,
      };
    }
  }
  const sobram = parcelasAntes.filter((p) => p.numero > parcelasNovas.length);
  if (sobram.length > 0) {
    const { error } = await supabase
      .from("pedidos_compra_parcelas")
      .delete()
      .in("id", sobram.map((p) => p.id))
      .eq("tenant_id", tenantId);
    if (error) {
      return {
        ok: false,
        message: `A PP foi salva, mas as parcelas antigas não saíram: ${error.message}. Abra a PP e salve de novo.`,
      };
    }
  }

  // ---- O PDF por cima do anterior, no mesmo caminho ----
  {
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(caminhoDoPdf, documento.buffer, { contentType: "application/pdf", upsert: true });
    if (uploadErr) {
      return {
        ok: false,
        message: `A PP foi salva, mas o PDF novo não subiu: ${uploadErr.message}. Abra a PP e salve de novo.`,
      };
    }
  }
  // O documento por parcela de antes da decisão 112 sai do bucket: o
  // documento único da PP o substitui.
  const orfaos = Array.from(
    new Set(parcelasAntes.map((p) => p.pdf_path).filter((c): c is string => Boolean(c) && c !== caminhoDoPdf)),
  );
  if (orfaos.length > 0) await supabase.storage.from(BUCKET).remove(orfaos);

  // ---- Os anexos, como a tela os deixou ----
  const erroAnexos = await gravarAnexosDoEnvio(
    supabase,
    tenantId,
    session.profile.id,
    job.id,
    ppId,
    anexosParsed.data,
  );
  if (erroAnexos) return { ok: false, message: `A PP foi salva, mas os anexos não: ${erroAnexos}` };

  if (!d.verba_producao) {
    await supabase
      .from("jobs_itens_realizado")
      .update({ fornecedor_id: d.fornecedor_id ?? null })
      .eq("id", ppRow.item_realizado_id)
      .eq("tenant_id", tenantId);
  }

  // A resposta da pergunta obrigatória vale para o ITEM (decisão 052).
  const marcacao = await aplicarConclusaoDoItem(supabase, {
    tenantId,
    jobId: job.id,
    itemRealizadoId: ppRow.item_realizado_id,
    profileId: session.profile.id,
    papel: session.activeRole,
    itemNome: item.item_nome,
    concluido: ultimaPPDoItem,
    origem: "formulario_pp",
  });
  if (!marcacao.ok) console.error("[pp.editar.marcacao]", marcacao.message);

  // Sem esta PP: o metadata soma o valor novo por cima.
  const emPPsSemEsta = await somaDasPPsDoItem(supabase, tenantId, ppRow.item_realizado_id, ppId);
  await logAuditEvent({
    acao: "pedido_compra.editada",
    tenantId,
    entidadeTipo: "pedido_compra",
    entidadeId: ppId,
    metadata: {
      pp_codigo: ppRow.codigo,
      decisao: 173,
      valor_antes: Number(ppRow.valor),
      valor,
      valor_unitario: d.valor_unitario,
      quantidade: d.quantidade,
      dias_meses: d.dias_meses,
      parcelas_antes: parcelasAntes.map((p) => ({ data: p.data_vencimento, valor: p.valor })),
      parcelas: parcelasNovas.map((p) => ({ data: p.data_vencimento, valor: p.valor })),
      fornecedor_antes: ppRow.fornecedor_id,
      ...colunasDaVerba(d, titular.nome),
      pagamento_fora_do_cadastro: auditoriaDoForaDoCadastro(foraDoCadastroDe(d)),
      // Decisão 193: o meio digitado do titular (o dado fica na PP).
      pagamento_do_titular_digitado: pagTitular.pagamento?.meio ?? null,
      anexos: anexosParsed.data.length,
      anexos_novos: conferencia.novos.length,
      anexos_removidos: conferencia.saem.length,
      pronta_desfeita: ppRow.pronta_para_envio_em !== null,
      planejado_do_item: item.total_planejado,
      acima_do_planejado: passaDoPlanejado(emPPsSemEsta + valor, item.total_planejado),
      item_realizado_id: ppRow.item_realizado_id,
      job_id: job.id,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true, codigo: ppRow.codigo };
}
