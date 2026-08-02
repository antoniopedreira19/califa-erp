"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { gerarCodigoPP } from "@/lib/codigos/pedidos-compra";
import { renderPedidoCompraPDF } from "@/lib/pdf/pedido-compra";
import {
  PP_ANEXO_MIMETYPES_ACEITOS,
  PP_ANEXO_TAMANHO_MAX_BYTES,
  PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES,
} from "@/lib/types";

const BUCKET = "pedidos-compra";
const PDF_TTL_SEGUNDOS = 3600;

type Ok<T = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = object> = Ok<T> | Err;

const dadosSchema = z.object({
  fornecedor_id: z.string().uuid(),
  empresa_id: z.string().uuid(),
  prazo_pagamento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD"),
  servico: z.string().trim().min(1).max(500),
  quantidade: z.number().positive(),
  especificacoes: z.string().max(2000).nullable().optional(),
});

const anexoUploadedSchema = z.object({
  anexo_id: z.string().uuid(),
  path: z.string().min(1),
  nome_original: z.string().min(1),
  tamanho_bytes: z.number().int().positive(),
  mimetype: z.enum(PP_ANEXO_MIMETYPES_ACEITOS),
});

type AnexoUploaded = z.infer<typeof anexoUploadedSchema>;

/**
 * Gates comuns: sessao, tenant, job existe, status editavel, ownership.
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
        total_realizado: number | null;
        quantidade_realizada: number | null;
        item_id: string;
      };
      job: {
        id: string;
        tenant_id: string;
        status: string;
        responsavel_id: string | null;
        empresa_id: string | null;
        produto: string | null;
        nome: string;
        projeto_id: string | null;
        orcamento_id: string | null;
      };
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: item, error: itemErr } = await supabase
    .from("jobs_itens_realizado")
    .select(
      "id, tenant_id, job_id, total_realizado, quantidade_realizada, item_id",
    )
    .eq("id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (itemErr || !item) {
    return { ok: false, message: "Item realizado não encontrado." };
  }

  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(
      "id, tenant_id, status, responsavel_id, empresa_id, produto, nome, projeto_id, orcamento_id",
    )
    .eq("id", item.job_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (jobErr || !job) {
    return { ok: false, message: "Job não encontrado." };
  }

  if (job.status !== "aberto" && job.status !== "em_producao") {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: null,
      metadata: {
        acao_tentada: "pedido_compra.emitida",
        motivo: "status_bloqueia_edicao",
        status_atual: job.status,
      },
    });
    return {
      ok: false,
      message:
        "PP só pode ser gerada com o job em 'Aberto' ou 'Em produção'.",
    };
  }

  const podeEditar =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;

  if (!podeEditar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: null,
      metadata: {
        acao_tentada: "pedido_compra.emitida",
        motivo: "usuario_nao_e_responsavel_nem_admin",
      },
    });
    return {
      ok: false,
      message: "Apenas o responsável do job ou admin pode gerar PP.",
    };
  }

  return { ok: true, session, item, job, supabase };
}

/**
 * Fase 1 do fluxo: reserva um pp_id UUID e retorna o path prefix para
 * client fazer upload direto dos anexos pro bucket. NAO persiste no DB.
 */
export async function reservarPedidoCompra(
  itemRealizadoId: string,
): Promise<Result<{ pp_id: string; upload_prefix: string }>> {
  // TEMPORÁRIO — remover após diagnóstico
  console.log("[pp.reservar.entrada]", { itemRealizadoId });
  try {
    const res = await reservarPedidoCompraImpl(itemRealizadoId);
    // TEMPORÁRIO — remover após diagnóstico
    console.log("[pp.reservar.saida]", res);
    return res;
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

  const { item, job, session, supabase } = gate;

  if (Number(item.total_realizado ?? 0) <= 0) {
    return { ok: false, message: "Item ainda não tem realizado lançado." };
  }

  // Rejeita se ja existe PP
  const { data: ppExistente } = await supabase
    .from("pedidos_compra")
    .select("id")
    .eq("item_realizado_id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppExistente) {
    return {
      ok: false,
      message:
        "Já existe PP para este item. Cancele a atual antes de gerar outra.",
    };
  }

  const pp_id = crypto.randomUUID();
  const upload_prefix = `${session.activeTenant.id}/${job.id}/${pp_id}/anexos/`;

  return { ok: true, pp_id, upload_prefix };
}

/**
 * Fase 2: client ja subiu anexos direto pro bucket. Envia metadata,
 * server persiste tudo + gera PDF.
 */
export async function finalizarPedidoCompra(
  pp_id: string,
  dados: z.input<typeof dadosSchema>,
  anexos: z.input<typeof anexoUploadedSchema>[],
  itemRealizadoId: string,
): Promise<Result<{ codigo: string }>> {
  const gate = await checarGatesRealizado(itemRealizadoId);
  if (!gate.ok) return gate;
  const { session, item, job, supabase } = gate;

  // Valida dados
  const dadosParsed = dadosSchema.safeParse(dados);
  if (!dadosParsed.success) {
    return {
      ok: false,
      message: `Dados inválidos: ${dadosParsed.error.issues[0]?.message ?? "erro"}.`,
    };
  }
  const d = dadosParsed.data;

  // Valida anexos array
  if (anexos.length < 1) {
    return { ok: false, message: "Pelo menos um anexo é obrigatório." };
  }
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

  // Valida FKs (fornecedor + empresa pertencem ao tenant)
  const [fornRes, empRes] = await Promise.all([
    supabase
      .from("fornecedores")
      .select("*")
      .eq("id", d.fornecedor_id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("*")
      .eq("id", d.empresa_id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .maybeSingle(),
  ]);

  if (!fornRes.data)
    return { ok: false, message: "Fornecedor inválido ou inativo." };
  if (!empRes.data)
    return { ok: false, message: "Empresa emissora inválida ou inativa." };

  // Gera codigo
  let codigo: string;
  try {
    codigo = await gerarCodigoPP(supabase, session.activeTenant.id);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Falha ao gerar codigo.";
    return { ok: false, message: msg };
  }

  // INSERT pedidos_compra (pdf_path = '' placeholder)
  const { error: insertErr } = await supabase.from("pedidos_compra").insert({
    id: pp_id,
    tenant_id: session.activeTenant.id,
    codigo,
    item_realizado_id: itemRealizadoId,
    job_id: job.id,
    fornecedor_id: d.fornecedor_id,
    empresa_id: d.empresa_id,
    servico: d.servico,
    quantidade: d.quantidade,
    especificacoes: d.especificacoes ?? null,
    valor: Number(item.total_realizado),
    prazo_pagamento: d.prazo_pagamento,
    pdf_path: "",
    emitida_por: session.profile.id,
  });

  if (insertErr) {
    // Limpa anexos do bucket (rollback)
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return { ok: false, message: `Falha ao salvar PP: ${insertErr.message}` };
  }

  // INSERT anexos bulk
  const anexosRows = anexosParsed.data.map((a: AnexoUploaded) => ({
    id: a.anexo_id,
    tenant_id: session.activeTenant.id,
    pedido_compra_id: pp_id,
    arquivo_path: a.path,
    arquivo_nome_original: a.nome_original,
    arquivo_tamanho_bytes: a.tamanho_bytes,
    arquivo_mimetype: a.mimetype,
    created_by: session.profile.id,
  }));
  const { error: anexosErr } = await supabase
    .from("pedidos_compra_anexos")
    .insert(anexosRows);
  if (anexosErr) {
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return {
      ok: false,
      message: `Falha ao salvar anexos: ${anexosErr.message}`,
    };
  }

  // Carrega dados enriquecidos pro PDF
  const [projetoRes, orcRes] = await Promise.all([
    supabase
      .from("projetos")
      .select(
        "id, codigo, campanha, cliente:clientes(nome_fantasia), responsavel:profiles!responsavel_id(nome)",
      )
      .eq("id", job.projeto_id ?? "")
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    supabase
      .from("orcamentos")
      .select("id, codigo")
      .eq("id", job.orcamento_id ?? "")
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
  ]);

  type ProjetoEnriquecido = {
    id: string;
    codigo: string;
    campanha: string | null;
    cliente: { nome_fantasia: string } | null;
    responsavel: { nome: string } | null;
  } | null;
  type OrcamentoRow = { id: string; codigo: string } | null;

  const projeto = projetoRes.data as ProjetoEnriquecido;
  const orcamento = orcRes.data as OrcamentoRow;
  const responsavelNome = projeto?.responsavel?.nome ?? "";
  const clienteNome = projeto?.cliente?.nome_fantasia ?? "";

  // Renderiza PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPedidoCompraPDF({
      pp: {
        codigo,
        servico: d.servico,
        quantidade: d.quantidade,
        especificacoes: d.especificacoes ?? null,
        valor: Number(item.total_realizado),
        prazo_pagamento: d.prazo_pagamento,
        created_at: new Date().toISOString(),
      },
      empresa: empRes.data as never,
      fornecedor: fornRes.data as never,
      job: { nome: job.nome, produto: job.produto ?? "" },
      projeto: {
        codigo: projeto?.codigo ?? "",
        campanha: projeto?.campanha ?? null,
      },
      orcamento: { codigo: orcamento?.codigo ?? "" },
      cliente: { nome_fantasia: clienteNome },
      responsavelNome,
    });
  } catch (err: unknown) {
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Falha ao gerar PDF: ${msg}` };
  }

  const pdfPath = `${session.activeTenant.id}/${job.id}/${pp_id}/pp-${codigo}.pdf`;
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(pdfPath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (uploadErr) {
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    await supabase.storage
      .from(BUCKET)
      .remove(anexosParsed.data.map((a) => a.path));
    return {
      ok: false,
      message: `Falha ao subir PDF: ${uploadErr.message}`,
    };
  }

  // Update pdf_path + fornecedor no realizado
  const [updPP, updReal] = await Promise.all([
    supabase.from("pedidos_compra").update({ pdf_path: pdfPath }).eq("id", pp_id),
    supabase
      .from("jobs_itens_realizado")
      .update({ fornecedor_id: d.fornecedor_id })
      .eq("id", itemRealizadoId)
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (updPP.error || updReal.error) {
    // Cleanup total
    await supabase.storage
      .from(BUCKET)
      .remove([pdfPath, ...anexosParsed.data.map((a) => a.path)]);
    await supabase.from("pedidos_compra").delete().eq("id", pp_id);
    return {
      ok: false,
      message: `Falha ao finalizar: ${updPP.error?.message ?? updReal.error?.message}`,
    };
  }

  // Audit
  await logAuditEvent({
    acao: "pedido_compra.emitida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: codigo,
      valor: Number(item.total_realizado),
      fornecedor_id: d.fornecedor_id,
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
  const supabase = createClient();

  const { data: pp, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, tenant_id, codigo, job_id, item_realizado_id, pdf_path, jobs!inner(id, status, responsavel_id), anexos:pedidos_compra_anexos(id, arquivo_path)",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };

  const job = (pp as Record<string, unknown>).jobs as Record<string, unknown>;
  if (job.status !== "aberto" && job.status !== "em_producao") {
    return { ok: false, message: "Job não está em estado editável." };
  }

  const podeCancelar =
    session.activeRole === "administrador" ||
    job.responsavel_id === session.profile.id;
  if (!podeCancelar) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: pp_id,
      metadata: {
        acao_tentada: "pedido_compra.cancelada",
        motivo: "sem_permissao",
      },
    });
    return { ok: false, message: "Sem permissão pra cancelar esta PP." };
  }

  const anexosPaths = (
    ((pp as Record<string, unknown>).anexos ?? []) as { arquivo_path: string }[]
  ).map((a) => a.arquivo_path);
  const paths = [pp.pdf_path, ...anexosPaths].filter(Boolean) as string[];

  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (rmErr) {
      // Log mas prossegue — arquivos orfaos sao aceitaveis
      console.error("[pp.cancelar.storage]", rmErr.message);
    }
  }

  // DELETE cascade limpa anexos rows
  const { error: delErr } = await supabase
    .from("pedidos_compra")
    .delete()
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (delErr)
    return { ok: false, message: `Falha ao apagar PP: ${delErr.message}` };

  // Volta fornecedor_id do realizado pra null
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
    },
  });

  revalidatePath(`/jobs/${pp.job_id}`);
  return { ok: true };
}

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
