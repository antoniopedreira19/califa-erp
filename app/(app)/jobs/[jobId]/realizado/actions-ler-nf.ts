"use server";

import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import type { DadosExtraidosNF, DadosLidosDoDocumento, DocumentoTipo } from "@/lib/types";
import { custoEstimadoUsd, MODELO_LEITURA_NF } from "@/lib/ia/openai-client";
import {
  lerDadosBrutosDaNF,
  lerDadosBrutosDoDocumento,
  VERSAO_LEITURA_DOCUMENTO,
  type DadosBrutosNF,
  type DadosBrutosDocumento,
} from "@/lib/ia/ler-nf";
import {
  validarCnpj,
  validarDataEmissao,
  validarValor,
  validarNumeroNF,
  validarDescricao,
} from "@/lib/ia/validacoes-nf";
import {
  acharEstabelecimentoPorCnpj,
  acharFornecedorPorCnpj,
} from "@/lib/ia/matches-nf";
import { validarInputLeituraNF } from "./validar-input-ler-nf";

type Err = { ok: false; message: string };
type Ok = { ok: true; dados: DadosExtraidosNF; cache_hit: boolean };

export async function lerDadosDaNFPorIA(input: {
  anexo_path: string;
  mimetype: string;
  tomadores: Array<{ id: string; cnpj: string }>;
  fornecedores: Array<{ id: string; cpf_cnpj?: string | null }>;
}): Promise<Ok | Err> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;

  const check = validarInputLeituraNF({
    anexo_path: input.anexo_path,
    mimetype: input.mimetype,
    tenantId,
  });
  if (!check.ok) return check;

  const supabase = createClient();

  const { data: blob, error: errDownload } = await supabase.storage
    .from("pedidos-compra")
    .download(input.anexo_path);
  if (errDownload || !blob) {
    return { ok: false, message: "Não consegui baixar o PDF do anexo." };
  }
  const arrayBuffer = await blob.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);
  const hash = createHash("sha256").update(pdfBuffer).digest("hex");

  // Cache lookup filtrando por modelo (trocar modelo não lê cache stale).
  const { data: cached } = await supabase
    .from("nf_extracao_cache")
    .select("dados")
    .eq("tenant_id", tenantId)
    .eq("hash_sha256", hash)
    .eq("modelo", MODELO_LEITURA_NF)
    .maybeSingle();

  let dadosBrutos: DadosBrutosNF;
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheHit = false;

  if (cached) {
    // Cache guarda DadosBrutosNF (antes do match). O match depende do
    // estado atual de empresas/fornecedores do tenant, que pode mudar
    // entre leituras — então validação e match rodam toda vez.
    dadosBrutos = cached.dados as DadosBrutosNF;
    cacheHit = true;
  } else {
    try {
      const r = await lerDadosBrutosDaNF(pdfBuffer);
      dadosBrutos = r.dados;
      tokensIn = r.tokensIn;
      tokensOut = r.tokensOut;
    } catch (err) {
      await logAuditEvent({
        acao: "pp.anexo.nf_lida_por_ia",
        tenantId,
        entidadeTipo: "pedido_compra_anexo",
        entidadeId: input.anexo_path,
        metadata: {
          arquivo_hash: hash,
          cache_hit: false,
          modelo: MODELO_LEITURA_NF,
          erro: err instanceof Error ? err.message : String(err),
        },
      });
      return {
        ok: false,
        message: "Falha ao ler a NF pela IA. Preencha os campos manualmente.",
      };
    }

    // Grava cache (ignora conflito: se outra request chegou primeiro, tudo bem).
    await supabase.from("nf_extracao_cache").insert({
      tenant_id: tenantId,
      hash_sha256: hash,
      dados: dadosBrutos,
      modelo: MODELO_LEITURA_NF,
    });
  }

  const hojeIso = hojeEmSaoPauloIso();
  const cnpjEmissor = validarCnpj(dadosBrutos.cnpj_emissor);
  const cnpjTomador = validarCnpj(dadosBrutos.cnpj_tomador);

  const dados: DadosExtraidosNF = {
    numero_nf: validarNumeroNF(dadosBrutos.numero_nf),
    data_emissao: validarDataEmissao(dadosBrutos.data_emissao, hojeIso),
    valor_total: validarValor(dadosBrutos.valor_total),
    descricao_servico: validarDescricao(dadosBrutos.descricao_servico),
    tomador: {
      cnpj: cnpjTomador,
      razao_social: dadosBrutos.razao_social_tomador?.trim() || null,
      estabelecimento_id_match: cnpjTomador
        ? acharEstabelecimentoPorCnpj(cnpjTomador, input.tomadores)
        : null,
    },
    emissor: {
      cnpj: cnpjEmissor,
      razao_social: dadosBrutos.razao_social_emissor?.trim() || null,
      fornecedor_id_match: cnpjEmissor
        ? acharFornecedorPorCnpj(cnpjEmissor, input.fornecedores)
        : null,
    },
    confianca_baixa: dadosBrutos.confianca_baixa,
  };

  await logAuditEvent({
    acao: "pp.anexo.nf_lida_por_ia",
    tenantId,
    entidadeTipo: "pedido_compra_anexo",
    entidadeId: input.anexo_path,
    metadata: {
      arquivo_hash: hash,
      cache_hit: cacheHit,
      modelo: MODELO_LEITURA_NF,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      custo_usd_estimado: custoEstimadoUsd(tokensIn, tokensOut),
      confianca_baixa: dadosBrutos.confianca_baixa,
    },
  });

  return { ok: true, dados, cache_hit: cacheHit };
}

/**
 * A leitura do anexo logo que ele sobe (decisão 192, 19/10/2026). Diz que documento é, o número e, quando o documento traz,
 * a data, o valor e o CNPJ da California contra o qual foi emitido — já
 * casado com o cadastro de CNPJs. A tela pré-preenche só o que estiver
 * vazio, com o selo "IA".
 *
 * Mesmo caminho da leitura da NF: só PDF do bucket da PP, cache por hash
 * do arquivo (com a versão do pedido, para não reaproveitar a leitura da
 * NF, que não tem o tipo), auditoria a cada chamada.
 */
export async function lerDocumentoPorIA(input: {
  anexo_path: string;
  mimetype: string;
  tomadores: Array<{ id: string; cnpj: string }>;
}): Promise<{ ok: true; dados: DadosLidosDoDocumento; cache_hit: boolean } | Err> {
  const session = await requireSession();
  const tenantId = session.activeTenant.id;
  const check = validarInputLeituraNF({ anexo_path: input.anexo_path, mimetype: input.mimetype, tenantId });
  if (!check.ok) return check;

  const supabase = createClient();
  const { data: blob, error: errDownload } = await supabase.storage.from("pedidos-compra").download(input.anexo_path);
  if (errDownload || !blob) return { ok: false, message: "Não consegui baixar o arquivo para ler." };
  const pdfBuffer = Buffer.from(await blob.arrayBuffer());
  const hash = createHash("sha256").update(pdfBuffer).digest("hex");

  const { data: cached } = await supabase
    .from("nf_extracao_cache")
    .select("dados")
    .eq("tenant_id", tenantId)
    .eq("hash_sha256", hash)
    .eq("modelo", VERSAO_LEITURA_DOCUMENTO)
    .maybeSingle();

  let brutos: DadosBrutosDocumento;
  let tokensIn = 0;
  let tokensOut = 0;
  const cacheHit = !!cached;
  if (cached) {
    brutos = cached.dados as DadosBrutosDocumento;
  } else {
    try {
      const r = await lerDadosBrutosDoDocumento(pdfBuffer);
      brutos = r.dados;
      tokensIn = r.tokensIn;
      tokensOut = r.tokensOut;
    } catch (err) {
      await logAuditEvent({
        acao: "pp.anexo.lido_por_ia",
        tenantId,
        entidadeTipo: "pedido_compra_anexo",
        entidadeId: input.anexo_path,
        metadata: {
          arquivo_hash: hash,
          cache_hit: false,
          modelo: VERSAO_LEITURA_DOCUMENTO,
          erro: err instanceof Error ? err.message : String(err),
        },
      });
      return { ok: false, message: "Não deu para ler o documento. Escolha o tipo." };
    }
    await supabase.from("nf_extracao_cache").insert({
      tenant_id: tenantId,
      hash_sha256: hash,
      dados: brutos,
      modelo: VERSAO_LEITURA_DOCUMENTO,
    });
  }

  const tipo = (brutos.tipo_documento ?? null) as DocumentoTipo | null;
  const ehNf = tipo === "nota_fiscal";
  const cnpjTomador = validarCnpj(brutos.cnpj_tomador);
  const dados: DadosLidosDoDocumento = {
    tipo,
    numero: ehNf
      ? validarNumeroNF(brutos.numero_nf ?? brutos.numero_documento)
      : brutos.numero_documento?.trim().slice(0, 60) || null,
    data_emissao: ehNf ? validarDataEmissao(brutos.data_emissao, hojeEmSaoPauloIso()) : null,
    valor_total: ehNf ? validarValor(brutos.valor_total) : null,
    tomador_estabelecimento_id: cnpjTomador ? acharEstabelecimentoPorCnpj(cnpjTomador, input.tomadores) : null,
    confianca_baixa: brutos.confianca_baixa,
  };

  await logAuditEvent({
    acao: "pp.anexo.lido_por_ia",
    tenantId,
    entidadeTipo: "pedido_compra_anexo",
    entidadeId: input.anexo_path,
    metadata: {
      arquivo_hash: hash,
      cache_hit: cacheHit,
      modelo: VERSAO_LEITURA_DOCUMENTO,
      tipo_lido: tipo,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      custo_usd_estimado: custoEstimadoUsd(tokensIn, tokensOut),
      confianca_baixa: brutos.confianca_baixa,
    },
  });

  return { ok: true, dados, cache_hit: cacheHit };
}
