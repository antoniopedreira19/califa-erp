"use server";

/**
 * Notas Fiscais (decisão 271): o endereço temporário do PDF de uma NF
 * tomada, pelo anexo do documento que a traz (PP, desembolso ou prestação
 * da verba), e a leitura ampliada da NF pela IA. Só o administrador e o
 * financeiro abrem a seção; a leitura do anexo passa pela RLS de quem pede.
 */
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import { custoEstimadoUsd } from "@/lib/ia/openai-client";
import {
  VERSAO_DA_LEITURA_POR_IMAGEM,
  VERSAO_LEITURA_NOTA_TOMADA,
  lerNotaTomada,
  leituraParaGravar,
  type DadosBrutosNotaTomada,
} from "@/lib/ia/ler-nota-tomada";
import { extrairTextoDoPdf, lerPeloTexto } from "@/lib/ia/texto-da-nf";
import { NOTAS_POR_LEITURA, type TabelaDoAnexo } from "./dados";
import { seguirDocumentoNasPPs } from "@/app/(app)/jobs/[jobId]/realizado/actions-pp";

const BUCKET = "pedidos-compra";
const TABELAS: readonly TabelaDoAnexo[] = ["pedidos_compra_anexos", "desembolsos_anexos", "pp_verba_prestacoes_anexos"];

export async function urlDoAnexoDaNota(
  tabela: TabelaDoAnexo,
  anexoId: string,
): Promise<{ ok: true; url: string; imagem: boolean } | { ok: false; message: string }> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Só o financeiro e o administrador abrem as notas." };
  }
  if (!TABELAS.includes(tabela) || !/^[0-9a-f-]{36}$/i.test(anexoId)) return { ok: false, message: "Anexo inválido." };
  const supabase = createClient();
  const { data: anexo } = await supabase
    .from(tabela)
    .select("arquivo_path, arquivo_mimetype")
    .eq("id", anexoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{ arquivo_path: string; arquivo_mimetype: string | null }>();
  if (!anexo?.arquivo_path) return { ok: false, message: "Anexo não encontrado." };
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(anexo.arquivo_path, 600);
  if (error || !data?.signedUrl) {
    console.error("[notas-fiscais.url-do-anexo]", error?.message);
    return { ok: false, message: "Não foi possível abrir o arquivo. Tente de novo." };
  }
  return { ok: true, url: data.signedUrl, imagem: (anexo.arquivo_mimetype ?? "").startsWith("image/") };
}

// ---------------------------------------------------------------------------
// A leitura ampliada da NF tomada (decisão 271)
// ---------------------------------------------------------------------------

export interface ResultadoDaLeitura {
  /** Notas cuja leitura foi gravada (inclusive as divergentes). */
  lidas: number;
  /** O PDF não bate com o registro: outro número, outro emitente, outra emissão ou outro valor. */
  divergentes: Array<{ numero: string; motivo: string }>;
  falhas: Array<{ numero: string; motivo: string }>;
}

/**
 * Lê pela IA o arquivo de cada nota (o anexo do primeiro documento que a
 * traz) e grava na nota a descrição, o CNAE, o município, a competência, o
 * código de verificação e as retenções destacadas. Usa o cache das
 * leituras (`nf_extracao_cache`) pelo hash do arquivo.
 */
export async function lerNotasTomadas(ids: string[]): Promise<{ ok: true; resultado: ResultadoDaLeitura } | { ok: false; message: string }> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Só o financeiro e o administrador leem as notas." };
  }
  const lote = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, NOTAS_POR_LEITURA);
  const tenantId = session.activeTenant.id;
  const supabase = createClient();
  const resultado: ResultadoDaLeitura = { lidas: 0, divergentes: [], falhas: [] };

  const { data: notas } = await supabase
    .from("notas_fiscais_fornecedor")
    .select("id, numero, valor, data_emissao, fornecedor:fornecedores(cpf_cnpj)")
    .eq("tenant_id", tenantId)
    .in("id", lote)
    .returns<Array<{ id: string; numero: string; valor: number | string; data_emissao: string; fornecedor: { cpf_cnpj: string | null } | null }>>();

  // As notas do lote em paralelo: a chamada cabe no tempo da página (60 s).
  await Promise.all(
    (notas ?? []).map(async (nota) => {
      try {
        const anexo = await anexoDaNota(supabase, tenantId, nota.id);
        if (!anexo) {
          resultado.falhas.push({ numero: nota.numero, motivo: "Nenhum documento traz o arquivo desta nota." });
          return;
        }
        const { data: blob, error: errDownload } = await supabase.storage.from(BUCKET).download(anexo.path);
        if (errDownload || !blob) {
          resultado.falhas.push({ numero: nota.numero, motivo: "Não foi possível baixar o arquivo." });
          return;
        }
        const arquivo = Buffer.from(await blob.arrayBuffer());
        const hash = createHash("sha256").update(arquivo).digest("hex");
        // A segunda leitura: o texto do PDF, quando ele tem texto (sem IA).
        const textoDoPdf = anexo.mimetype.startsWith("image/") ? null : await extrairTextoDoPdf(arquivo);
        const porTexto = textoDoPdf ? lerPeloTexto(textoDoPdf) : null;
        // A leitura por imagem (IA), pelo cache quando o arquivo já foi lido.
        const { data: cache } = await supabase
          .from("nf_extracao_cache")
          .select("dados")
          .eq("tenant_id", tenantId)
          .eq("hash_sha256", hash)
          .eq("modelo", VERSAO_DA_LEITURA_POR_IMAGEM)
          .maybeSingle<{ dados: DadosBrutosNotaTomada }>();
        let dados: DadosBrutosNotaTomada;
        let tokensIn = 0;
        let tokensOut = 0;
        if (cache?.dados) {
          dados = cache.dados;
        } else {
          try {
            const r = await lerNotaTomada(arquivo, anexo.mimetype);
            dados = r.dados;
            tokensIn = r.tokensIn;
            tokensOut = r.tokensOut;
            await supabase.from("nf_extracao_cache").insert({ tenant_id: tenantId, hash_sha256: hash, dados, modelo: VERSAO_DA_LEITURA_POR_IMAGEM });
          } catch (err) {
            // A IA não leu, mas o texto do PDF trouxe os campos: vale o texto.
            if (!porTexto || (!porTexto.numero && !porTexto.valor)) throw err;
            console.error("[notas-fiscais.leitura.imagem]", err instanceof Error ? err.message : err);
            dados = dadosVazios();
          }
        }
        const conferida = leituraParaGravar(
          dados,
          {
            numero: nota.numero,
            cnpjEmitente: nota.fornecedor?.cpf_cnpj ?? null,
            valor: Number(nota.valor),
            emissao: nota.data_emissao,
          },
          porTexto,
        );
        const { error } = await supabase.rpc("gravar_leitura_da_nota", {
          p_nota_id: nota.id,
          p_dados: { ...conferida.leitura, texto_bruto: textoDoPdf ? textoDoPdf.slice(0, 20000) : null },
          p_modelo: VERSAO_LEITURA_NOTA_TOMADA,
        });
        if (error) {
          console.error("[notas-fiscais.leitura]", error.message);
          resultado.falhas.push({ numero: nota.numero, motivo: "Não foi possível gravar a leitura." });
          return;
        }
        resultado.lidas++;
        if (conferida.leitura.divergencias.length > 0) {
          resultado.divergentes.push({ numero: nota.numero, motivo: conferida.motivo ?? motivoDaDivergencia(conferida.leitura.pdf, conferida.leitura.divergencias) });
        }
        await logAuditEvent({
          acao: "nota_fiscal.leitura_ampliada",
          tenantId,
          entidadeTipo: "nota_fiscal_fornecedor",
          entidadeId: nota.id,
          metadata: {
            numero: nota.numero,
            arquivo_hash: hash,
            cache_hit: !!cache?.dados,
            modelo: VERSAO_LEITURA_NOTA_TOMADA,
            arquivo_da_nota: conferida.arquivoDaNota,
            divergencias: conferida.leitura.divergencias,
            com_texto: Boolean(textoDoPdf),
            discordancias: conferida.leitura.discordancias,
            tokens_in: tokensIn,
            tokens_out: tokensOut,
            custo_usd: custoEstimadoUsd(tokensIn, tokensOut),
          },
        });
      } catch (err) {
        console.error("[notas-fiscais.leitura]", err instanceof Error ? err.message : err);
        resultado.falhas.push({ numero: nota.numero, motivo: "A leitura pela IA falhou." });
      }
    }),
  );
  revalidatePath("/financeiro/notas-fiscais");
  return { ok: true, resultado };
}

type Supabase = ReturnType<typeof createClient>;

/** A leitura por imagem vazia: a IA não leu e vale só o texto do PDF. */
function dadosVazios(): DadosBrutosNotaTomada {
  const vazia = { aliquota: null, valor: null };
  return {
    numero_nf: null,
    cnpj_emissor: null,
    data_emissao: null,
    valor_total: null,
    descricao_servico: null,
    cnae: null,
    codigo_servico: null,
    municipio_prestacao: null,
    competencia: null,
    codigo_verificacao: null,
    retencoes: { iss: vazia, irrf: vazia, pis: vazia, cofins: vazia, csll: vazia, inss: vazia },
    confianca_baixa: true,
  };
}

/** "No PDF: emissão 05/11/2026; valor R$ 82,00." */
function motivoDaDivergencia(pdf: { emissao: string | null; valor: number | null }, divergencias: string[]): string {
  const partes: string[] = [];
  if (divergencias.includes("emissao") && pdf.emissao) partes.push(`emissão ${pdf.emissao.split("-").reverse().join("/")}`);
  if (divergencias.includes("valor") && pdf.valor !== null)
    partes.push(`valor ${pdf.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  return `No PDF: ${partes.join("; ")}.`;
}

/** O arquivo da nota: o anexo do primeiro documento que a traz (PP, desembolso, prestação). */
async function anexoDaNota(supabase: Supabase, tenantId: string, notaId: string): Promise<{ path: string; mimetype: string } | null> {
  for (const tabela of TABELAS) {
    const { data } = await supabase
      .from(tabela)
      .select("arquivo_path, arquivo_mimetype")
      .eq("tenant_id", tenantId)
      .eq("nota_fiscal_id", notaId)
      .order("created_at")
      .limit(1)
      .maybeSingle<{ arquivo_path: string; arquivo_mimetype: string | null }>();
    if (data?.arquivo_path) return { path: data.arquivo_path, mimetype: data.arquivo_mimetype ?? "application/pdf" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// O "Editar registro" (decisão 271, ponto 6)
// ---------------------------------------------------------------------------

/** Uma nota alterada na tabela: os dados novos e o que a tela viu ao abrir a edição. */
export interface AlteracaoDaNota {
  nota_id: string;
  numero: string;
  data_emissao: string;
  valor: number;
  tomador_estabelecimento_id: string;
  antes: { numero: string; data_emissao: string; valor: number; tomador_estabelecimento_id: string | null };
}

/**
 * Grava a alteração do registro das notas (RPC `alterar_registro_das_notas`:
 * confere o papel, a nota não registrada, a edição simultânea, junta o número
 * que já existe e confere o saldo). Depois, se o CNPJ tomador mudou, a PP
 * segue o CNPJ novo e o PDF é refeito; o que não seguir volta como aviso.
 */
export async function alterarRegistroDasNotas(
  alteracoes: AlteracaoDaNota[],
  motivo: string,
): Promise<{ ok: true; notas: number; avisos: string[]; trocas: number } | { ok: false; message: string }> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Só o financeiro e o administrador alteram o registro das notas." };
  }
  const uuid = /^[0-9a-f-]{36}$/i;
  if (alteracoes.length === 0 || alteracoes.some((a) => !uuid.test(a.nota_id) || !uuid.test(a.tomador_estabelecimento_id))) {
    return { ok: false, message: "Alteração inválida. Recarregue a tela." };
  }
  if (motivo.trim().length < 10) return { ok: false, message: "Escreva o motivo da alteração (pelo menos 10 caracteres)." };

  const supabase = createClient();
  const { data, error } = await supabase.rpc("alterar_registro_das_notas", {
    p_alteracoes: alteracoes,
    p_motivo: motivo.trim(),
  });
  if (error) {
    console.error("[notas-fiscais.alterar_registro]", error.message);
    const limpa = error.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
    return { ok: false, message: limpa && !/[_"]/.test(limpa) ? limpa : "Não foi possível alterar o registro. Tente de novo." };
  }
  const r = (data ?? {}) as { notas?: string[]; pps?: string[]; desembolsos?: string[]; tomador_mudou?: boolean };

  let avisos: string[] = [];
  let trocas = 0;
  // A PP segue o CNPJ da nota (revisão da 156). Roda em todas as PPs da nota,
  // não só quando o tomador desta linha mudou: na junção (6b), a nota que já
  // existia pode estar em outro CNPJ. Na PP que já está no CNPJ certo, nada muda.
  if ((r.pps ?? []).length > 0) {
    const seguiu = await seguirDocumentoNasPPs(r.pps ?? []);
    trocas = seguiu.trocas.length;
    avisos = seguiu.avisos.map((m) => `A nota foi alterada, mas uma PP não mudou de CNPJ: ${m}`);
  }

  await logAuditEvent({
    acao: "nota_fiscal.registro_alterado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "nota_fiscal_fornecedor",
    entidadeId: alteracoes[0].nota_id,
    metadata: {
      notas: alteracoes.map((a) => ({ nota_id: a.nota_id, antes: a.antes, depois: { numero: a.numero, data_emissao: a.data_emissao, valor: a.valor, tomador_estabelecimento_id: a.tomador_estabelecimento_id } })),
      motivo: motivo.trim(),
      pps: r.pps ?? [],
      desembolsos: r.desembolsos ?? [],
      pps_com_cnpj_trocado: trocas,
      papel: session.activeRole,
      decisao: 271,
    },
  });
  revalidatePath("/financeiro/notas-fiscais");
  return { ok: true, notas: (r.notas ?? []).length, avisos, trocas };
}

/**
 * "O registro está certo" (decisão 271): o financeiro confirma, com motivo,
 * que a divergência com o PDF é erro da leitura. A divergência sai, a
 * confirmação fica no histórico da nota, e a mesma leitura não volta a acusar.
 */
export async function confirmarRegistroDaNota(
  notaId: string,
  motivo: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    return { ok: false, message: "Só o financeiro e o administrador confirmam o registro das notas." };
  }
  if (!/^[0-9a-f-]{36}$/i.test(notaId)) return { ok: false, message: "Nota inválida. Recarregue a tela." };
  if (motivo.trim().length < 10) return { ok: false, message: "Escreva o motivo (pelo menos 10 caracteres)." };
  const supabase = createClient();
  const { error } = await supabase.rpc("confirmar_registro_da_nota", { p_nota_id: notaId, p_motivo: motivo.trim() });
  if (error) {
    console.error("[notas-fiscais.confirmar_registro]", error.message);
    const limpa = error.message.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
    return { ok: false, message: limpa && !/[_"]/.test(limpa) ? limpa : "Não foi possível confirmar o registro. Tente de novo." };
  }
  await logAuditEvent({
    acao: "nota_fiscal.registro_confirmado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "nota_fiscal_fornecedor",
    entidadeId: notaId,
    metadata: { motivo: motivo.trim(), papel: session.activeRole, decisao: 271 },
  });
  revalidatePath("/financeiro/notas-fiscais");
  return { ok: true };
}

