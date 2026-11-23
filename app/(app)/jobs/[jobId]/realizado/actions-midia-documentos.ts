"use server";

/**
 * AP, PI e a NF do veículo, por veículo e mês do job de Mídia Off (decisão
 * 274). O arquivo sobe do navegador direto para o bucket privado
 * `jobs-midia`, no padrão das apresentações do projeto (decisão 213): o
 * caminho nasce aqui (`reservarDocumentoDaMidia`), com o tenant da sessão e
 * o job, e o arquivo não passa pelo corpo da Server Action (o Next corta em
 * 1 MB). `salvarDocumentoDaMidia` grava a linha e confere tudo de novo.
 *
 * Quem anexa, troca e remove: administrador, GP e produtor (`jobs.editar`,
 * Tiago, 23/11/2026). Só no job aberto, só em veículo que tem linha no mês,
 * e só em mês que ainda não foi ao faturamento (Tiago, 23/11/2026: o mês
 * enviado não muda).
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { checarPermissao } from "@/lib/permissoes-server";
import { jobAceitaAcoesPlanilha, type JobStatus } from "@/lib/types";
import { lerMidiaDoJob } from "@/lib/data/midia-do-job";
import { mesesEnviadosDoJob } from "@/lib/data/envio-faturamento";
import { nomeDoMesMidia } from "@/lib/calculos/midia-off";
import {
  BUCKET_DA_MIDIA,
  NOME_DO_DOCUMENTO,
  caminhoDoDocumento,
  documentoDoJob,
  recusaDoDocumento,
  type TipoDocumentoMidia,
} from "@/lib/midia/documentos";

type Resultado = { ok: true } | { ok: false; message: string };

const TIPOS: TipoDocumentoMidia[] = ["ap", "pi", "nf"];
const MES_ISO = /^\d{4}-\d{2}-01$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * As portas comuns às três ações: o job é deste tenant, está aberto, é de
 * Mídia Off, o veículo tem linha no mês e o mês não foi ao faturamento.
 */
async function conferirPortas(
  jobId: string,
  fornecedorId: string,
  mes: string,
): Promise<
  | { ok: true; tenantId: string; profileId: string; supabase: ReturnType<typeof createClient>; jobCodigo: string }
  | { ok: false; message: string }
> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar");
  if (!gate.ok) return gate;
  if (!MES_ISO.test(mes)) return { ok: false, message: "Mês inválido." };

  const supabase = createClient();
  const tenantId = session.activeTenant.id;
  const [jobRes, lida, linhasRes, enviados] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, codigo, status, versao_orcamento_aprovada_id")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle<{ id: string; codigo: string; status: JobStatus; versao_orcamento_aprovada_id: string }>(),
    lerMidiaDoJob(supabase, tenantId, jobId),
    // A linha do veículo, com o mês do agrupamento da versão (a âncora,
    // decisão 162).
    supabase
      .from("jobs_itens_orcado")
      .select("id, grupo:versoes_orcamento_grupos!jobs_itens_orcado_grupo_id_fkey(mes:versoes_orcamento_meses!versoes_orcamento_grupos_mes_da_mesma_versao_fkey(mes))")
      .eq("job_id", jobId)
      .eq("tenant_id", tenantId)
      .eq("fornecedor_id", fornecedorId)
      .is("cancelada_em", null),
    mesesEnviadosDoJob(supabase, jobId, tenantId).catch(() => null),
  ]);
  const job = jobRes.data;
  if (!job) return { ok: false, message: "Job não encontrado." };
  if (!jobAceitaAcoesPlanilha(job.status)) {
    return {
      ok: false,
      message: "Os documentos do veículo se anexam com o job aberto.",
    };
  }
  if (!lida.ok || linhasRes.error || enviados === null) {
    if (linhasRes.error) console.error("[midia.documentos.linhas]", linhasRes.error.message);
    return { ok: false, message: "Não foi possível conferir o job. Tente de novo." };
  }
  if (!lida.midia) return { ok: false, message: "Este job não é de Mídia Off." };

  const temLinhaNoMes = (linhasRes.data ?? []).some((l: any) => {
    const grupo = Array.isArray(l.grupo) ? l.grupo[0] : l.grupo;
    const m = Array.isArray(grupo?.mes) ? grupo.mes[0] : grupo?.mes;
    return String(m?.mes ?? "").slice(0, 10) === mes;
  });
  if (!temLinhaNoMes) {
    return { ok: false, message: "Este veículo não tem linha neste mês do job." };
  }
  if ([...enviados].some((m) => String(m).slice(0, 10) === mes)) {
    return {
      ok: false,
      message: `${nomeDoMesMidia(mes)} já foi ao faturamento: os documentos do mês não mudam mais.`,
    };
  }
  return { ok: true, tenantId, profileId: session.profile.id, supabase, jobCodigo: job.codigo };
}

/** Reserva o caminho `<tenant>/<job>/<uuid>-<nome>` para o navegador subir
 *  o arquivo. */
export async function reservarDocumentoDaMidia(
  jobId: string,
  input: { nome: string; tamanho: number },
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const session = await requireSession();
  const gate = await checarPermissao(session, "jobs.editar");
  if (!gate.ok) return gate;
  const nome = String(input?.nome ?? "");
  const recusa = recusaDoDocumento(nome, Number(input?.tamanho ?? 0));
  if (recusa) return { ok: false, message: recusa };
  return {
    ok: true,
    path: caminhoDoDocumento(session.activeTenant.id, jobId, crypto.randomUUID(), nome),
  };
}

/** O arquivo subiu e o formulário fechou sem salvar: ele sai do bucket. A
 *  policy do bucket não apaga arquivo que uma linha ainda aponta. */
export async function descartarArquivoDaMidia(jobId: string, path: string): Promise<void> {
  const session = await requireSession();
  if (typeof path !== "string" || !documentoDoJob(path, session.activeTenant.id, jobId)) return;
  const { error } = await createClient().storage.from(BUCKET_DA_MIDIA).remove([path]);
  if (error) console.error("[midia.documentos.descartar]", error.message);
}

export interface DocumentoDaMidiaInput {
  fornecedorId: string;
  /** `YYYY-MM-01`. */
  mes: string;
  tipo: TipoDocumentoMidia;
  numero: string;
  /** Só na NF. */
  valor: number | null;
  /** Só na NF, `YYYY-MM-DD`. */
  dataEmissao: string | null;
  arquivo: { path: string; nome: string; tamanho: number; tipo: string | null };
}

/**
 * Anexa o documento do veículo no mês, ou troca o que já estava: um de cada
 * tipo por veículo e mês. Na troca o arquivo antigo sai do bucket.
 */
export async function salvarDocumentoDaMidia(
  jobId: string,
  input: DocumentoDaMidiaInput,
): Promise<Resultado> {
  const tipo = input?.tipo;
  if (!TIPOS.includes(tipo)) return { ok: false, message: "Documento inválido." };
  const numero = String(input?.numero ?? "").trim();
  if (numero === "" || numero.length > 60) {
    return { ok: false, message: `Informe o número do ${NOME_DO_DOCUMENTO[tipo]}.` };
  }
  const nf = tipo === "nf";
  const valor = nf ? Math.round(Number(input?.valor ?? 0) * 100) / 100 : null;
  const dataEmissao = nf ? String(input?.dataEmissao ?? "") : null;
  if (nf && !(valor! > 0)) return { ok: false, message: "Informe o valor da NF." };
  if (nf && !DATA_ISO.test(dataEmissao!)) return { ok: false, message: "Informe a data de emissão da NF." };

  const portas = await conferirPortas(jobId, String(input?.fornecedorId ?? ""), String(input?.mes ?? ""));
  if (!portas.ok) return portas;
  const { supabase, tenantId, profileId } = portas;

  const arquivo = input.arquivo;
  if (!arquivo || !documentoDoJob(String(arquivo.path ?? ""), tenantId, jobId)) {
    return { ok: false, message: "Arquivo inválido. Anexe de novo." };
  }

  const { data: antes } = await supabase
    .from("jobs_midia_documentos")
    .select("id, storage_path, numero")
    .eq("job_id", jobId)
    .eq("tenant_id", tenantId)
    .eq("fornecedor_id", input.fornecedorId)
    .eq("mes", input.mes)
    .eq("tipo", tipo)
    .maybeSingle<{ id: string; storage_path: string; numero: string }>();
  // O mesmo arquivo de antes: só o número, o valor ou a data mudaram.
  const mesmoArquivo = antes !== null && antes.storage_path === arquivo.path;
  if (!mesmoArquivo) {
    const recusa = recusaDoDocumento(String(arquivo.nome ?? ""), Number(arquivo.tamanho ?? 0));
    if (recusa) return { ok: false, message: recusa };
  }

  const dados = {
    numero,
    valor,
    data_emissao: dataEmissao,
    // A policy de escrita pede a sessão como autora: quem mexeu por último.
    created_by: profileId,
  };
  const linha = {
    tenant_id: tenantId,
    job_id: jobId,
    fornecedor_id: input.fornecedorId,
    mes: input.mes,
    tipo,
    numero,
    valor,
    data_emissao: dataEmissao,
    nome_arquivo: String(arquivo.nome).slice(0, 255),
    storage_path: arquivo.path,
    tamanho_bytes: Number(arquivo.tamanho),
    tipo_arquivo: arquivo.tipo ?? null,
    // Na troca, quem anexou e quando passam a ser os da troca: é a data do
    // documento em vigor (a entrega 5 a compara com a da extensão).
    created_by: profileId,
    created_at: new Date().toISOString(),
  };
  const { data: salvo, error } = antes
    ? await supabase
        .from("jobs_midia_documentos")
        // Arquivo novo regrava a data; sem arquivo novo, a data é a do
        // documento em vigor e não muda.
        .update(mesmoArquivo ? dados : linha)
        .eq("id", antes.id)
        .eq("tenant_id", tenantId)
        .select("id")
        .maybeSingle<{ id: string }>()
    : await supabase
        .from("jobs_midia_documentos")
        .insert(linha)
        .select("id")
        .maybeSingle<{ id: string }>();
  if (error || !salvo) {
    console.error("[midia.documentos.salvar]", error?.message);
    return { ok: false, message: "Não foi possível salvar o documento. Tente de novo." };
  }

  // O arquivo antigo já não é apontado por linha nenhuma: sai do bucket.
  if (antes && !mesmoArquivo) {
    const { error: e } = await supabase.storage.from(BUCKET_DA_MIDIA).remove([antes.storage_path]);
    if (e) console.error("[midia.documentos.salvar.antigo]", e.message);
  }

  await logAuditEvent({
    acao: antes ? "midia_documento.trocado" : "midia_documento.anexado",
    tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      documento_id: salvo.id,
      tipo,
      numero,
      ...(antes ? { numero_anterior: antes.numero, arquivo_trocado: !mesmoArquivo } : {}),
      fornecedor_id: input.fornecedorId,
      mes: input.mes,
      valor,
      data_emissao: dataEmissao,
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** Tira o documento do veículo no mês: a linha e o arquivo. */
export async function removerDocumentoDaMidia(jobId: string, documentoId: string): Promise<Resultado> {
  const session = await requireSession();
  const supabase = createClient();
  const { data: doc } = await supabase
    .from("jobs_midia_documentos")
    .select("id, fornecedor_id, mes, tipo, numero, storage_path")
    .eq("id", documentoId)
    .eq("job_id", jobId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      fornecedor_id: string;
      mes: string;
      tipo: TipoDocumentoMidia;
      numero: string;
      storage_path: string;
    }>();
  if (!doc) return { ok: false, message: "Documento não encontrado." };

  const portas = await conferirPortas(jobId, doc.fornecedor_id, String(doc.mes).slice(0, 10));
  if (!portas.ok) return portas;

  const { error } = await supabase
    .from("jobs_midia_documentos")
    .delete()
    .eq("id", doc.id)
    .eq("tenant_id", portas.tenantId);
  if (error) {
    console.error("[midia.documentos.remover]", error.message);
    return { ok: false, message: "Não foi possível remover o documento." };
  }
  const { error: e } = await supabase.storage.from(BUCKET_DA_MIDIA).remove([doc.storage_path]);
  if (e) console.error("[midia.documentos.remover.arquivo]", e.message);

  await logAuditEvent({
    acao: "midia_documento.removido",
    tenantId: portas.tenantId,
    entidadeTipo: "job",
    entidadeId: jobId,
    metadata: {
      documento_id: doc.id,
      tipo: doc.tipo,
      numero: doc.numero,
      fornecedor_id: doc.fornecedor_id,
      mes: String(doc.mes).slice(0, 10),
    },
  });

  revalidatePath(`/jobs/${jobId}`);
  return { ok: true };
}

/** URL assinada (10 minutos) para abrir o documento numa aba nova. Quem é
 *  do tenant abre. */
export async function urlDoDocumentoDaMidia(
  jobId: string,
  path: string,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const session = await requireSession();
  if (typeof path !== "string" || !documentoDoJob(path, session.activeTenant.id, jobId)) {
    return { ok: false, message: "Arquivo não encontrado." };
  }
  const { data, error } = await createClient()
    .storage.from(BUCKET_DA_MIDIA)
    .createSignedUrl(path, 60 * 10);
  if (error || !data) {
    console.error("[midia.documentos.url]", error?.message);
    return { ok: false, message: "Não foi possível abrir o arquivo." };
  }
  return { ok: true, url: data.signedUrl };
}
