"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import {
  COLUNAS_DE_PAGAMENTO,
  aplicarPagamentoForaDoCadastro,
  camposDoPagamentoForaDoCadastro,
  lerFoto,
  lerPagamentoForaDoCadastro,
  resumoDoCadastroDePagamento,
  tirarFoto,
  type DadosDePagamento,
  type FotoDePagamentoDaPP,
  type PagamentoForaDoCadastro,
} from "@/lib/data/foto-pagamento-da-pp";
import { pagamentoForaDoCadastroSchema } from "@/lib/validations/pagamento-fora-do-cadastro";
import { checarPermissao } from "@/lib/permissoes-server";
import { formatCurrency } from "@/lib/utils";
import { pode } from "@/lib/permissoes";
import { DOCUMENTO_TIPOS, PP_URGENTE_JUSTIFICATIVA_MIN } from "@/lib/types";
import { gerarCodigoPP } from "@/lib/codigos/pedidos-compra";
import { listActiveMembers } from "@/lib/data/members";
import {
  valorDaPPPorUnidade,
  somaDasPPsNaoCanceladas,
  passaDoPlanejado,
  exigeSomaIgualAoOrcado,
  faltaParaFecharOOrcado,
  parcelasFecham,
} from "@/lib/calculos/pps-item";
import { aplicarConclusaoDoItem } from "./conclusao-item";
import { cnpjPadraoDaPP, empresaDoDocumento, type CnpjDoDocumento } from "@/lib/fiscal/cnpj-da-pp";
import { tomadoresPadrao } from "@/lib/fiscal/nf-da-pp";
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
  dataLimiteDeEnvio,
  ehJanelaDePagamento,
  hojeEmSaoPauloIso,
  isoParaBr,
  ppSegueOPrazoDeEnvio,
  primeiraJanelaComEnvioAberto,
  vencimentoAceitaEnvio,
  vencimentosNasJanelas,
} from "@/lib/calculos/janelas-pagamento";
import { carregarFeriadosNacionais } from "@/lib/data/feriados-nacionais";

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

/**
 * O pagamento fora do cadastro que a PP vai gravar (decisão 127). Verba
 * não tem: paga o responsável interno.
 */
function foraDoCadastroDe(d: {
  verba_producao: boolean;
  pagamento_fora_do_cadastro?: PagamentoForaDoCadastro | null;
}): PagamentoForaDoCadastro | null {
  return d.verba_producao ? null : (d.pagamento_fora_do_cadastro ?? null);
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

/** Teto de parcelas: 24 (decisão 077, pergunta 7a). O formulário oferece
 *  1 a 6 e "Mais de 6…" até 24; o maior parcelamento gravado até
 *  14/09/2026 tinha 12. Vale também contra payload sem fim. */
const MAX_PARCELAS = 24;

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
  // responsável. O CHECK do banco é o backstop — este schema valida antes.
  z.discriminatedUnion("verba_producao", [
    z.object({
      verba_producao: z.literal(false),
      fornecedor_id: z.string().uuid(),
      responsavel_verba_id: z.null().optional(),
      // Decisão 127: outro PIX ou outra conta só nesta PP. Null = paga
      // pelo cadastro, como toda PP até 29/09/2026.
      pagamento_fora_do_cadastro: pagamentoForaDoCadastroSchema.nullable().optional(),
    }),
    z.object({
      verba_producao: z.literal(true),
      fornecedor_id: z.null().optional(),
      responsavel_verba_id: z.string().uuid(),
      // Verba paga o responsável interno: não há cadastro a contornar.
      pagamento_fora_do_cadastro: z.null().optional(),
    }),
  ])
);

const dadosSchema = dadosBaseSchema;

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
 */
function validarVencimentosNasJanelas(
  datas: string[],
  gravadas: string[],
  feriados: string[],
): string | null {
  const hoje = hojeEmSaoPauloIso();
  for (let i = 0; i < datas.length; i++) {
    const data = datas[i].slice(0, 10);
    if (gravadas[i]?.slice(0, 10) === data) continue;
    const br = data.split("-").reverse().join("/");
    if (data < hoje) {
      return `O vencimento ${br} já passou. Escolha uma janela de pagamento a partir de hoje.`;
    }
    if (!ehJanelaDePagamento(data)) {
      return `${br} não é uma janela de pagamento. A California paga nos dias 08 e 20 — caindo em fim de semana, na segunda-feira seguinte.`;
    }
    // O prazo de envio (decisão 157) só pesa no 1º vencimento: as parcelas
    // seguintes caem em janelas depois dele, com data-limite depois.
    if (i === 0) {
      const erroPrazo = erroDoPrazoDeEnvio(data, hoje, feriados);
      if (erroPrazo) return erroPrazo;
    }
  }
  return null;
}

/**
 * O vencimento ainda aceita envio hoje (decisão 157)? A PP chega ao
 * financeiro até 15 dias corridos antes da janela (no dia útil anterior,
 * caindo em fim de semana ou feriado nacional). Null = aceita.
 */
function erroDoPrazoDeEnvio(vencimento: string, hoje: string, feriados: string[]): string | null {
  if (vencimentoAceitaEnvio(vencimento, hoje, feriados)) return null;
  const limite = dataLimiteDeEnvio(vencimento, feriados);
  const primeira = primeiraJanelaComEnvioAberto(hoje, feriados);
  return limite
    ? `O prazo de envio para o vencimento ${isoParaBr(vencimento)} terminou em ${isoParaBr(limite)}: o financeiro recebe a PP até 15 dias antes da janela. A primeira janela possível hoje é ${isoParaBr(primeira)}.`
    : `${isoParaBr(vencimento)} não é uma janela de pagamento. A primeira janela possível hoje é ${isoParaBr(primeira)}.`;
}

const anexoUploadedSchema = z.object({
  anexo_id: z.string().uuid(),
  /** Que documento este arquivo é, e com que número (28/08/2026). O par
   *  anda junto: número sem tipo não identifica nada. */
  documento_tipo: z.enum(DOCUMENTO_TIPOS).nullable().default(null),
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

/** Os dados da NF do anexo, só quando ele é do tipo NF. */
function nfDoAnexo(a: AnexoUploaded) {
  const nf = a.documento_tipo === "nota_fiscal";
  return {
    nf_data_emissao: nf ? a.nf_data_emissao : null,
    nf_valor: nf ? a.nf_valor : null,
    nf_tomador_estabelecimento_id: nf ? a.nf_tomador_estabelecimento_id : null,
    nf_valor_na_pp: nf ? a.nf_valor_na_pp : null,
  };
}

type AnexoUploaded = z.infer<typeof anexoUploadedSchema>;

/**
 * Enviar (e reenviar) PP ao financeiro é do GP e do administrador (decisão
 * 136): o produtor gera, mas não envia. As actions de envio chamam este
 * DEPOIS de `checarGatesRealizado`.
 */
async function barrarEnvioPeloPapel(
  session: Awaited<ReturnType<typeof requireSession>>,
  ppId: string,
): Promise<{ ok: false; message: string } | null> {
  if (pode(session.activeRole, "jobs.enviar_pp")) return null;
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
        /** Errata devolveu o job ao mural: nenhuma PP sai para o
         *  financeiro até a revisão da abertura ser salva (decisão 040). */
        abertura_em_revisao: boolean;
        /** A regional do job: decide o CNPJ padrão da PP (decisão 156). */
        regional_id: string | null;
      };
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: ancora, error: itemErr } = await supabase
    .from("jobs_itens_realizado")
    .select("id, tenant_id, job_id, item_id, job_item_orcado_id")
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
    quantidade_orcada: Number(orcado.quantidade_orcada ?? 0),
    tipo_custo: (orcado as any).tipo_custo as TipoCusto,
    em_save: (orcado as any).em_save === true,
  };

  const { data: jobRow, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, codigo, tenant_id, status, responsavel_id, empresa_id, produto, nome, projeto_id, orcamento_id, abertura_em_revisao, regional_id",
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

/** As NFs cujo CNPJ tomador não é o CNPJ da PP (decisão 156): o envio
 *  pede "tem certeza?" e o financeiro decide na aprovação. */
export interface TomadorDiferente {
  /** O CNPJ da PP (`fiscal_estabelecimentos.id`). */
  cnpjDaPP: string | null;
  notas: Array<{ numero: string; tomador: string }>;
}

export type ResultadoEnvio =
  | { ok: true; codigo: string }
  | { ok: false; message: string; acimaDoPlanejado?: AcimaDoPlanejado; tomadorDiferente?: TomadorDiferente };

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
}

async function carregarContextoPdf(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  job: { projeto_id: string | null },
): Promise<ContextoPdf> {
  const [projetoRes] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, campanha, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)",
      )
      .eq("id", job.projeto_id ?? "")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const projeto = projetoRes.data as {
    campanha: string | null;
    cliente: { nome_fantasia: string } | null;
    responsavel: { nome: string } | null;
  } | null;

  return {
    projeto: { campanha: projeto?.campanha ?? null },
    cliente: { nome_fantasia: projeto?.cliente?.nome_fantasia ?? "" },
    responsavelNome: projeto?.responsavel?.nome ?? "",
  };
}

/**
 * O documento da PP, com todas as parcelas, renderizado em memória
 * (decisão 112, 28/09/2026). Até ali era um documento por parcela.
 *
 * O financeiro aprova a PP inteira e as parcelas seguem juntas para
 * Títulos a Pagar, então um papel só, com o valor e o prazo de cada
 * parcela e o total do pedido, é o que o fornecedor e o financeiro leem.
 * Verba de Produção também gera PDF, com layout adaptado — ver
 * `lib/pdf/pedido-compra.ts`.
 *
 * Quem chama decide o que fazer com o buffer: a geração desfaz a PP se o
 * upload falhar; a edição e o reenvio sobrescrevem o documento anterior.
 */
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
  };
  empresa: unknown;
  fornecedor: unknown | null;
  responsavelVerbaNome: string | null;
  job: { codigo: string; nome: string; produto: string };
  contexto: ContextoPdf;
  parcelas: Array<{ numero: number; data_vencimento: string; valor: number }>;
  /** A data de emissão impressa. Ausente = agora (a geração); o
   *  "Atualizar vencimento" (decisão 157) mantém a da PP. */
  emitidaEm?: string;
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
    },
    empresa: args.empresa as never,
    fornecedor: (args.fornecedor ?? null) as never,
    responsavelVerbaNome: args.responsavelVerbaNome,
    job: args.job,
    projeto: args.contexto.projeto,
    cliente: args.contexto.cliente,
    responsavelNome: args.contexto.responsavelNome,
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
 * 2. **A errata devolveu o job ao mural** (`abertura_em_revisao`) e a
 *    revisão ainda não foi salva (decisão 040, 02/09/2026).
 *
 * Nos dois casos gerar, editar e cancelar continuam liberados — é o
 * ENVIO que fecha, junto com o faturamento, que já fechava desde a 030.
 *
 * ⚠️ Era `barrarEnvioEmRevisao`, com só a segunda trava (decisão 040 §4).
 */
async function barrarEnvioDePP(
  tenantId: string,
  ppId: string,
  job: { id: string; status: string; abertura_em_revisao: boolean },
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
    return negar(
      "abertura_em_revisao",
      "A abertura deste job está em revisão no financeiro desde a última errata. Nenhuma PP pode ser enviada até a revisão ser salva — a PP fica gerada, no job.",
    );
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
): Promise<Result<{ resumo: string | null }>> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.emitir_pp");
  if (!gate.ok) return gate;
  if (!z.string().uuid().safeParse(fornecedorId).success) {
    return { ok: false, message: "Fornecedor inválido." };
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fornecedores")
    .select(COLUNAS_DE_PAGAMENTO)
    .eq("id", fornecedorId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (error) return { ok: false, message: "Não foi possível ler o cadastro do fornecedor." };
  return {
    ok: true,
    resumo: resumoDoCadastroDePagamento((data as DadosDePagamento | null) ?? null),
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
  );
  if (erroJanela) return { ok: false, message: erroJanela };
  const urgencia = camposDeUrgencia(d, null, session.profile.id);
  if (!urgencia.ok) return urgencia;

  // ---- Valor da PP ----
  // O valor é o produto do trio que o GP digitou: R$ Unit. × QT × D/M. É
  // recalculado aqui de propósito — o cliente manda os três fatores, nunca
  // o total. Nada limita o valor na geração (02/09/2026): o teto por PP
  // saiu, e passar do planejado só muda quem pode enviar. A quantidade
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

  // Valida FKs (fornecedor OU responsável + empresa pertencem ao tenant).
  // Verba de Produção não tem fornecedor — valida o responsável no lugar.
  const [fornRes, empRes, responsavelRes] = await Promise.all([
    d.verba_producao
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
    // O responsável precisa ser membro ATIVO do tenant, e a checagem usa a
    // MESMA fonte que a tela usa para montar a lista — senão o formulário
    // oferece nomes que o servidor recusa.
    //
    // ⚠️ Corrigido em 01/09/2026: filtrava `profiles.tenant_id`, coluna que
    // não existe. O PostgREST devolvia erro, `data` vinha nulo e TODA PP de
    // Verba de Produção morria em "Responsável inválido ou não encontrado".
    // O vínculo com o tenant mora em `tenant_members`.
    d.verba_producao
      ? listActiveMembers(session.activeTenant.id).then((membros) => ({
          data: membros.find((m) => m.id === d.responsavel_verba_id) ?? null,
        }))
      : Promise.resolve({ data: null }),
  ]);

  if (!d.verba_producao && !fornRes.data)
    return { ok: false, message: "Fornecedor inválido ou inativo." };
  if (d.verba_producao && !responsavelRes.data)
    return { ok: false, message: "Responsável inválido ou não encontrado." };
  if (!empRes.data)
    return { ok: false, message: "A empresa gerencial do job não foi encontrada." };

  // Decisão 156: o CNPJ da PP (o do PDF, o tomador esperado da NF).
  const cnpjDaPP = await cnpjDaPPNaGeracao(
    supabase,
    session.activeTenant.id,
    { regional_id: job.regional_id, empresa_id: job.empresa_id },
    d.estabelecimento_id ?? null,
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
    // Verba: fornecedor null, responsável preenchido. PP normal: o oposto.
    verba_producao: d.verba_producao,
    fornecedor_id: d.verba_producao ? null : (d.fornecedor_id ?? null),
    responsavel_verba_id: d.verba_producao ? (d.responsavel_verba_id ?? null) : null,
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

  // Carrega dados enriquecidos pro PDF
  const contexto = await carregarContextoPdf(supabase, session.activeTenant.id, job);

  // ---- Um documento só, com todas as parcelas (decisão 112) ----
  // O financeiro aprova a PP inteira e as parcelas seguem juntas para
  // Títulos a Pagar: o papel é da PP, com o valor e o prazo de cada
  // parcela e o total do pedido.
  //
  // Verba de Produção também gera PDF, mas com layout adaptado (trocado
  // bloco Fornecedor por Responsável, omitido bloco de dados bancários) —
  // ver `lib/pdf/pedido-compra.ts`. Vai como comprovante interno do
  // adiantamento ao gerente.
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
      },
      // O cabeçalho é o do CNPJ da PP, não o da gerencial (decisão 156).
      empresa: cnpjDaPP.empresa,
      fornecedor: fornecedorDoDocumento(fornRes.data ?? null, foraDoCadastroDe(d)),
      responsavelVerbaNome: d.verba_producao
        ? (responsavelRes.data?.nome ?? "")
        : null,
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      contexto,
      parcelas: parcelas.map((p) => ({
        numero: p.numero,
        data_vencimento: p.data_vencimento,
        valor: Number(p.valor),
      })),
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
      verba_producao: d.verba_producao,
      fornecedor_id: d.verba_producao ? null : (d.fornecedor_id ?? null),
      responsavel_verba_id: d.verba_producao ? (d.responsavel_verba_id ?? null) : null,
      pagamento_fora_do_cadastro: auditoriaDoForaDoCadastro(foraDoCadastroDe(d)),
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
      "id, tenant_id, codigo, job_id, item_realizado_id, status, jobs!inner(id, status, responsavel_id)",
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

  const job = (pp as unknown as { jobs: { status: string; responsavel_id: string | null } }).jobs;
  // Mesmo gate de gerar (decisão 056): quem pôde gerar a PP na
  // pré-abertura precisa poder cancelá-la lá também — senão ela ficaria
  // presa no job até a abertura, sem caminho de volta.
  if (!jobAceitaGerarPP(job.status as JobStatus)) {
    return { ok: false, message: "Job não está em estado editável." };
  }

  // Decisão 136: qualquer GP (e o administrador) cancela — antes era só o
  // GP responsável do job. O produtor gera PP mas não a envia ao
  // financeiro; por isso cancela só a que ainda não foi enviada.
  const podeCancelar =
    pode(session.activeRole, "jobs.enviar_pp") || pp.status === "gerada";
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

  // Soft delete: marca como cancelada. PDF e anexos ficam no bucket.
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
 * O que falta nos anexos para enviar (decisão 152): pelo menos um arquivo;
 * o tipo de cada um; o número dos documentos; e, em cada NF, número,
 * emissão, valor, CNPJ tomador e a parte desta PP. A soma das partes vai
 * até o valor da PP (revisão da 152, 07/10/2026; o banco confere de novo em
 * `_conferir_partes_da_nota`). Null = nada.
 */
function faltaNosAnexosDoEnvio(anexos: AnexoUploaded[], valorPP: number): string | null {
  if (anexos.length === 0) {
    return "Anexe a nota fiscal do fornecedor antes de enviar esta PP ao financeiro.";
  }
  for (const a of anexos) {
    if (!a.documento_tipo) return `Escolha o tipo de “${a.nome_original}”.`;
    const numero = (a.documento_numero ?? "").trim();
    if (a.documento_tipo !== "nota_fiscal") {
      if (!numero) return `Preencha o número do documento de “${a.nome_original}”.`;
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
  return null;
}

/**
 * Os anexos da PP gerada como o pop-up de envio os deixou: os que saíram da
 * lista somem (linha e arquivo), os novos entram e os que ficaram têm o
 * tipo, o número e a NF atualizados. Os novos precisam estar no lugar da PP
 * no bucket — subiram pelo `prefixoAnexosPedidoCompra`.
 */
async function gravarAnexosDoEnvio(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  profileId: string,
  jobId: string,
  ppId: string,
  anexos: AnexoUploaded[],
): Promise<string | null> {
  const prefixo = `${tenantId}/${jobId}/${ppId}/anexos/`;
  const { data: atuais, error: atuaisErr } = await supabase
    .from("pedidos_compra_anexos")
    .select("id, arquivo_path")
    .eq("pedido_compra_id", ppId)
    .eq("tenant_id", tenantId);
  if (atuaisErr) return `Falha ao ler os anexos: ${atuaisErr.message}`;
  const idsAtuais = new Set((atuais ?? []).map((a) => a.id as string));
  const novos = anexos.filter((a) => !idsAtuais.has(a.anexo_id));
  const ficam = new Set(anexos.map((a) => a.anexo_id));
  const saem = (atuais ?? []).filter((a) => !ficam.has(a.id as string));

  const somaBytes = anexos.reduce((s, a) => s + a.tamanho_bytes, 0);
  if (somaBytes > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) return "Anexos somam mais que 25 MB.";
  for (const a of novos) {
    if (a.tamanho_bytes > PP_ANEXO_TAMANHO_MAX_BYTES) return `Anexo ${a.nome_original} > 8 MB.`;
    if (!a.path.startsWith(prefixo)) return "Anexo em path inválido.";
  }
  if (novos.length > 0) {
    const { data: noBucket, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(prefixo.replace(/\/$/, ""));
    if (listErr) return `Falha ao listar anexos: ${listErr.message}`;
    const nomes = new Set((noBucket ?? []).map((f) => `${prefixo}${f.name}`));
    const faltando = novos.find((a) => !nomes.has(a.path));
    if (faltando) return `Anexo ${faltando.nome_original} não foi encontrado no bucket. Refaça o upload.`;
  }

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
 * Envia ao financeiro uma PP que está GERADA (02/09/2026, decisão 039).
 *
 * É a metade que "Gerar PP" perdeu: até aqui gerar e enviar eram o mesmo
 * clique. Agora a PP nasce no job e só entra em avaliação quando alguém a
 * envia — esta action. O que ela confere:
 *
 *   1. O job aceita ação de planilha e quem envia é o responsável do job
 *      ou administrador (mesmo gate de gerar).
 *   2. A abertura NÃO está em revisão por errata (decisão 040).
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
  /** Decisão 156: o "tem certeza?" da nota em outro CNPJ já foi respondido. */
  confirmarTomadorDiferente = false,
): Promise<ResultadoEnvio> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: ppRow, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, codigo, job_id, item_realizado_id, status, valor, verba_producao, fornecedor_id, estabelecimento_id, prazo_pagamento, created_at, anexos:pedidos_compra_anexos(id)",
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
      fornecedor_id: string | null;
      estabelecimento_id: string | null;
      prazo_pagamento: string;
      created_at: string;
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
  const barradoNoEnvio = await barrarEnvioPeloPapel(gate.session, ppRow.id);
  if (barradoNoEnvio) return barradoNoEnvio;
  const { item, job } = gate;

  const bloqueioEnvio = await barrarEnvioDePP(
    session.activeTenant.id,
    pp_id,
    job,
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
        message: `O prazo de envio para o vencimento ${isoParaBr(prazo)} terminou${limite ? ` em ${isoParaBr(limite)}` : ""}. Atualize o vencimento da ${ppRow.codigo} — a primeira janela possível hoje é ${isoParaBr(primeiraJanelaComEnvioAberto(hoje, feriados))}.`,
      };
    }
  }

  // Verba de Produção é adiantamento: sai antes de existir nota, e as
  // notas entram na prestação de contas. Nas demais, a nota do fornecedor
  // é o que justifica o pedido — e é ela que o financeiro vai conferir.
  // Decisão 152: todo campo de todo anexo é obrigatório no envio.
  let anexosDoPedido: AnexoUploaded[] = [];
  if (!ppRow.verba_producao) {
    const parsed = z.array(anexoUploadedSchema).safeParse(anexosDoEnvio ?? []);
    if (!parsed.success) return { ok: false, message: "Formato de anexo inválido." };
    anexosDoPedido = parsed.data;
    const falta = faltaNosAnexosDoEnvio(anexosDoPedido, Number(ppRow.valor ?? 0));
    if (falta) return { ok: false, message: falta };
  }

  // Decisão 156: a nota em outro CNPJ que não o da PP não barra o envio —
  // pede o "tem certeza?" e o financeiro decide na aprovação.
  const notasEmOutroCnpj = ppRow.estabelecimento_id
    ? anexosDoPedido.filter(
        (a) =>
          a.documento_tipo === "nota_fiscal" &&
          a.nf_tomador_estabelecimento_id &&
          a.nf_tomador_estabelecimento_id !== ppRow.estabelecimento_id,
      )
    : [];
  if (notasEmOutroCnpj.length > 0 && !confirmarTomadorDiferente) {
    return {
      ok: false,
      message: "A nota está em outro CNPJ que não o da PP. Confirme o envio.",
      tomadorDiferente: {
        cnpjDaPP: ppRow.estabelecimento_id,
        notas: notasEmOutroCnpj.map((a) => ({
          numero: (a.documento_numero ?? "").trim(),
          tomador: a.nf_tomador_estabelecimento_id as string,
        })),
      },
    };
  }

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
  // planejado não deixar meio envio gravado.
  if (!ppRow.verba_producao) {
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

  // `.eq("status", "gerada")` é a trava de corrida: dois envios ao mesmo
  // tempo, só um passa. O `select` diz se ESTE passou.
  const agora = new Date().toISOString();
  const { data: atualizada, error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      status: "em_avaliacao",
      enviada_financeiro_em: agora,
      enviada_financeiro_por: session.profile.id,
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
      anexos: anexosDoPedido.length,
      notas_fiscais: anexosDoPedido.filter((a) => a.documento_tipo === "nota_fiscal").length,
      // Decisão 156: enviada com nota em outro CNPJ, depois do "tem certeza?".
      nota_em_outro_cnpj_confirmada: notasEmOutroCnpj.length > 0,
      cnpj_da_pp: ppRow.estabelecimento_id,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath(`/financeiro/jobs/${job.id}`);
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro");
  return { ok: true, codigo: ppRow.codigo };
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
 * certeza?" acima do planejado, o da nota em outro CNPJ (decisão 156), o
 * prazo de envio (decisão 157), a abertura em revisão (decisão 040) e a
 * ligação das NFs ao cadastro de notas (`ligar_notas_fiscais_da_pp`).
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
    .select("id, codigo, job_id, item_realizado_id, status, valor, verba_producao")
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
  // produção sai sem nota: só a marca.
  let anexosDoPedido: AnexoUploaded[] = [];
  if (!ppRow.verba_producao) {
    const parsed = z.array(anexoUploadedSchema).safeParse(anexosDoEnvio ?? []);
    if (!parsed.success) return { ok: false, message: "Formato de anexo inválido." };
    anexosDoPedido = parsed.data;
    const falta = faltaNosAnexosDoEnvio(anexosDoPedido, Number(ppRow.valor ?? 0));
    if (falta) return { ok: false, message: falta };
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

  const linha = {
    empresa_id: d.empresa_id,
    verba_producao: d.verba_producao,
    fornecedor_id: d.verba_producao ? null : (d.fornecedor_id ?? null),
    responsavel_verba_id: d.verba_producao ? (d.responsavel_verba_id ?? null) : null,
    servico: d.servico,
    valor,
    // O formulário como veio (já validado): a geração o valida de novo, e
    // o valor normalizado pelo schema não precisa passar duas vezes por ele.
    dados,
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
      fornecedor_id: linha.fornecedor_id,
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
 * Gera a PP a partir da PP a emitir — o "Gerar PP" da revisão (decisão
 * 153). A geração é a de sempre (`finalizarPedidoCompraImpl`): código, PDF,
 * parcelas, anexos (com a NF de cada um) e a marca da última PP do item. O
 * job aguardando abertura ou devolvido pelo financeiro não gera.
 */
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
 * "Cancelar e refazer" da PP rejeitada pelo financeiro (decisão 153). A PP
 * não se edita: ela é cancelada (fica no histórico) e volta como PP a
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
  const barrado = await barrarEnvioPeloPapel(gate.session, ppId);
  if (barrado) return barrado;

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
    fornecedor_id: linhaPP.verba_producao ? null : linhaPP.fornecedor_id,
    responsavel_verba_id: linhaPP.verba_producao ? linhaPP.responsavel_verba_id : null,
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
      nf_data_emissao: nf ? (a.nota?.data_emissao ?? a.nf_data_emissao) : null,
      nf_valor: nf ? (a.nota?.valor ?? a.nf_valor) : null,
      nf_tomador_estabelecimento_id: nf ? (a.nota?.tomador_estabelecimento_id ?? a.nf_tomador_estabelecimento_id) : null,
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
    verba_producao: dados.verba_producao,
    fornecedor_id: dados.fornecedor_id,
    responsavel_verba_id: dados.responsavel_verba_id,
    servico: dados.servico,
    valor: Number(linhaPP.valor),
    dados,
    // A pergunta da última PP volta a ser feita: o item pode ter mudado.
    ultima_pp_do_item: null,
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
      motivo_cancelamento: "Rejeitada pelo financeiro e refeita (Cancelar e refazer).",
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
 * Mudam o 1º vencimento, as parcelas seguintes (a mesma janela nos meses
 * seguintes, decisão 077, com os mesmos valores) e o PDF, refeito com as
 * datas novas e a data de emissão de antes.
 *
 * Só vale para a PP ainda no job (`gerada`) e só quando o vencimento atual
 * já não aceita envio: fora disso a PP gerada segue sem edição (decisão 153).
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
    .select("*, parcelas:pedidos_compra_parcelas(id, numero, data_vencimento, valor)")
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
    servico: string;
    especificacoes: string | null;
    quantidade: number | string;
    valor: number | string;
    prazo_pagamento: string;
    pdf_path: string | null;
    created_at: string;
    dados_pagamento_congelados_em: string | null;
    parcelas: Array<{ id: string; numero: number; data_vencimento: string; valor: number | string }> | null;
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
  const erroJanela = validarVencimentosNasJanelas([novo], [], feriados);
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
  const datasNovas = vencimentosNasJanelas(novo, parcelasAntes.length);
  const parcelasNovas = parcelasAntes.map((p, i) => ({ ...p, data_vencimento: datasNovas[i] }));

  // ---- O PDF com as datas novas, antes de gravar ----
  // Mesmo documento de antes: o pagamento sai da foto que a PP tirou na
  // geração (cadastro + meio escolhido, decisões 067 e 127), não do
  // cadastro de agora.
  const [fornRes, cnpjDaPP, responsavelRes, contexto] = await Promise.all([
    pp.verba_producao || !pp.fornecedor_id
      ? Promise.resolve({ data: null })
      : supabase.from("fornecedores").select("*").eq("id", pp.fornecedor_id).eq("tenant_id", tenantId).maybeSingle(),
    // O cabeçalho é o do CNPJ da PP (decisão 156), o mesmo da geração.
    cnpjDaPPNaGeracao(supabase, tenantId, job, pp.estabelecimento_id),
    pp.verba_producao && pp.responsavel_verba_id
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
      },
      empresa: cnpjDaPP.empresa,
      fornecedor: fornecedorDoPdf,
      responsavelVerbaNome: pp.verba_producao
        ? ((responsavelRes.data as { nome?: string } | null)?.nome ?? "")
        : null,
      job: { codigo: job.codigo, nome: job.nome, produto: job.produto ?? "" },
      contexto,
      parcelas: parcelasNovas,
      emitidaEm: pp.created_at,
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
