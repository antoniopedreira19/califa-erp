"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { gerarCodigoPP } from "@/lib/codigos/pedidos-compra";
import {
  valorDaPP,
  saldoDoItem,
  passaDoSaldo,
  parcelasFecham,
  dividirEmParcelas,
  proximoVencimento,
} from "@/lib/calculos/pps-item";
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
  jobAceitaAcoesPlanilha,
  type PPStatus,
  type JobStatus,
} from "@/lib/types";

const BUCKET = "pedidos-compra";
const PDF_TTL_SEGUNDOS = 3600;

/** R$ nas mensagens de erro — o usuário lê valor, não número solto. */
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Caminho do PDF de UMA parcela, no mesmo prefixo da PP.
 *
 * PP de parcela única mantém o nome histórico (`pp-PP-00008.pdf`): é o
 * caminho que as PPs já emitidas usam, e mudá-lo quebraria o link delas
 * sem ganhar nada. Parcelada ganha o sufixo, que é o que distingue os
 * documentos na hora de baixar.
 */
function caminhoPdfParcela(
  tenantId: string,
  jobId: string,
  ppId: string,
  codigo: string,
  numero: number,
  total: number,
): string {
  const nome =
    total > 1 ? `pp-${codigo}-parcela-${numero}de${total}.pdf` : `pp-${codigo}.pdf`;
  return `${tenantId}/${jobId}/${ppId}/${nome}`;
}

type Ok<T = object> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = object> = Ok<T> | Err;

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD");

/** Teto de parcelas: 36 é 3 anos de mensais — acima disso é erro de
 *  digitação, não parcelamento. Vale contra payload sem fim. */
const MAX_PARCELAS = 36;

const dadosBaseSchema = z.object({
  empresa_id: z.string().uuid(),
  // Vencimento da 1ª parcela. A parcela 1 SEMPRE repete esta data — o
  // campo continua existindo em `pedidos_compra` porque é o que o
  // financeiro e as views leem hoje.
  prazo_pagamento: dataSchema,
  servico: z.string().trim().min(1).max(500),
  // Quantidade do item que ESTA PP leva. Desde 17/08/2026 é ela que
  // define o valor da PP (quantidade × R$/un do realizado), então deixou
  // de ser texto solto do documento.
  quantidade: z.number().positive(),
  especificacoes: z.string().max(2000).nullable().optional(),
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
    }),
    z.object({
      verba_producao: z.literal(true),
      fornecedor_id: z.null().optional(),
      responsavel_verba_id: z.string().uuid(),
    }),
  ])
);

/** Campos base SEM parcelas — base do reenvio (não redefine parcelamento). */
const dadosCamposBase = z.object({
  empresa_id: z.string().uuid(),
  prazo_pagamento: dataSchema,
  servico: z.string().trim().min(1).max(500),
  quantidade: z.number().positive(),
  especificacoes: z.string().max(2000).nullable().optional(),
});

/** O reenvio corrige a PP mas não redefine o parcelamento:
 *  quem quiser mudar os vencimentos cancela e emite nova PP. */
const dadosReenvioSchema = dadosCamposBase.and(
  z.discriminatedUnion("verba_producao", [
    z.object({
      verba_producao: z.literal(false),
      fornecedor_id: z.string().uuid(),
      responsavel_verba_id: z.null().optional(),
    }),
    z.object({
      verba_producao: z.literal(true),
      fornecedor_id: z.null().optional(),
      responsavel_verba_id: z.string().uuid(),
    }),
  ])
);

const dadosSchema = dadosBaseSchema;

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
        item_id: string;
        /** ORÇADO do item na cópia do job (`jobs_itens_orcado`) — a base
         *  da fatia da PP e o teto do saldo desde 21/08/2026. Vem da
         *  cópia, e não da versão aprovada, porque é a cópia que a errata
         *  altera. */
        total_orcado: number;
        quantidade_orcada: number;
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

  const { data: ancora, error: itemErr } = await supabase
    .from("jobs_itens_realizado")
    .select("id, tenant_id, job_id, item_id")
    .eq("id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (itemErr || !ancora) {
    return { ok: false, message: "Item realizado não encontrado." };
  }

  // A base da PP é o ORÇADO do item, e ele mora na cópia do job. Sem esta
  // linha não há como saber quanto o item comporta — e o trigger
  // `pp_valida_saldo_do_item` recusaria de todo jeito.
  const { data: orcado, error: orcadoErr } = await supabase
    .from("jobs_itens_orcado")
    .select("total_orcado, quantidade_orcada")
    .eq("job_id", ancora.job_id)
    .eq("item_versao_id", ancora.item_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (orcadoErr || !orcado) {
    return {
      ok: false,
      message: "Item não encontrado na planilha do job.",
    };
  }

  const item = {
    id: ancora.id,
    tenant_id: ancora.tenant_id,
    job_id: ancora.job_id,
    item_id: ancora.item_id,
    total_orcado: Number(orcado.total_orcado ?? 0),
    quantidade_orcada: Number(orcado.quantidade_orcada ?? 0),
  };

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

  // PP continua exigindo o job ABERTO, mesmo agora que a planilha
  // aparece na pré-abertura (17/08/2026): o pedido é compromisso de
  // pagamento, e antes da abertura o job ainda pode ser devolvido.
  if (!jobAceitaAcoesPlanilha(job.status as JobStatus)) {
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
 * Quanto do ORÇADO do item ainda pode virar PP.
 *
 * Era o realizado até 21/08/2026. Trocou porque o realizado passou a SER
 * a soma das PPs: comparar a soma com ela mesma nunca barraria nada, e a
 * primeira PP de um item nunca caberia.
 *
 * `excetoPPId` serve ao reenvio: a PP que está sendo corrigida não pode
 * competir consigo mesma pelo saldo. Só o cancelamento devolve saldo —
 * PP rejeitada continua ocupando, porque vai ser corrigida e reenviada.
 */
async function saldoDisponivelDoItem(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  itemRealizadoId: string,
  totalOrcado: number,
  excetoPPId?: string,
): Promise<number> {
  const query = supabase
    .from("pedidos_compra")
    .select("valor, status")
    .eq("item_realizado_id", itemRealizadoId)
    .eq("tenant_id", tenantId)
    .neq("status", "cancelada");

  const { data } = excetoPPId ? await query.neq("id", excetoPPId) : await query;

  return saldoDoItem(
    totalOrcado,
    (data ?? []).map((pp) => ({ valor: Number(pp.valor), status: pp.status })),
  );
}

/**
 * Fase 1 do fluxo: reserva um pp_id UUID e retorna o path prefix para
 * client fazer upload direto dos anexos pro bucket. NAO persiste no DB.
 */
export async function reservarPedidoCompra(
  itemRealizadoId: string,
): Promise<Result<{ pp_id: string; upload_prefix: string }>> {
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

  const { item, job, session, supabase } = gate;

  if (item.total_orcado <= 0) {
    return { ok: false, message: "Item sem valor orçado — não há o que pedir." };
  }

  // PP já existente não bloqueia mais: o item aceita quantas PPs forem
  // necessárias, de quantos fornecedores forem (17/08/2026). O que
  // bloqueia é o item já estar inteiro em PPs — sem saldo não há o que
  // pedir, e o usuário merece saber disso ANTES de preencher o formulário.
  const saldo = await saldoDisponivelDoItem(
    supabase,
    session.activeTenant.id,
    itemRealizadoId,
    item.total_orcado,
  );
  if (saldo <= 0) {
    return {
      ok: false,
      message:
        "O orçado deste item já está inteiro em PPs. Cancele uma PP ou faça uma errata no orçado para pedir mais.",
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
  try {
    return await finalizarPedidoCompraImpl(pp_id, dados, anexos, itemRealizadoId);
  } catch (err) {
    console.error("[pp.finalizar.exception]", err);
    return {
      ok: false,
      message: `Falha ao finalizar PP: ${err instanceof Error ? err.message : "erro desconhecido"}.`,
    };
  }
}

async function finalizarPedidoCompraImpl(
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

  // ---- Valor da PP e saldo do item ----
  // O valor é a fatia que ESTA PP leva: quantidade × R$/un do ORÇADO. A
  // soma das PPs não canceladas do item não pode passar do orçado — a
  // mesma conta que o painel "Destrinchar realizado" mostra, e que o
  // trigger `pp_valida_saldo_do_item` reforça no banco.
  const valor = valorDaPP(
    d.quantidade,
    item.total_orcado,
    item.quantidade_orcada,
  );
  if (valor <= 0) {
    return {
      ok: false,
      message: "Quantidade inválida: o valor da PP ficaria zerado.",
    };
  }

  const saldo = await saldoDisponivelDoItem(
    supabase,
    session.activeTenant.id,
    itemRealizadoId,
    item.total_orcado,
  );
  if (passaDoSaldo(valor, saldo)) {
    return {
      ok: false,
      message: `A PP de ${brl(valor)} passa do saldo do item. Máximo aceito: ${brl(saldo)}.`,
    };
  }

  if (!parcelasFecham(d.parcelas.map((p) => p.valor), valor)) {
    return {
      ok: false,
      message: `A soma das parcelas precisa fechar com o valor da PP (${brl(valor)}).`,
    };
  }

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
    supabase
      .from("empresas")
      .select("*")
      .eq("id", d.empresa_id)
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .maybeSingle(),
    d.verba_producao
      ? supabase
          .from("profiles")
          .select("id, nome")
          .eq("id", d.responsavel_verba_id as string)
          .eq("tenant_id", session.activeTenant.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!d.verba_producao && !fornRes.data)
    return { ok: false, message: "Fornecedor inválido ou inativo." };
  if (d.verba_producao && !responsavelRes.data)
    return { ok: false, message: "Responsável inválido ou não encontrado." };
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
    empresa_id: d.empresa_id,
    servico: d.servico,
    quantidade: d.quantidade,
    especificacoes: d.especificacoes ?? null,
    valor,
    // Continua sendo o vencimento da 1ª parcela: é o que as views do
    // financeiro leem hoje, e o que a Tela 3.2 vai reorganizar.
    prazo_pagamento: parcelasFinais[0].data_vencimento,
    pdf_path: "",
    emitida_por: session.profile.id,
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

  // ---- Um documento POR PARCELA (Tela 2.3) ----
  // O fornecedor recebe um PDF por vencimento, e é ele que o financeiro
  // confere na hora de pagar. Tudo idêntico entre eles, menos o Prazo de
  // Pagto, a linha "Parcela: N/T" e o valor em destaque.
  //
  // Verba de Produção não tem fornecedor — o PDF que o modelo atual
  // renderiza é orientado ao fornecedor externo. Por ora, verba omite
  // geração de PDF (os anexos são o documento); Task futura adaptará o
  // modelo para verba interna.
  const parcelas = (parcelasCriadas ?? []).slice().sort((a, b) => a.numero - b.numero);
  const documentos: Array<{ parcelaId: string; path: string; buffer: Buffer }> = [];

  if (!d.verba_producao) {
    try {
      // Import dinâmico: só carrega pdfmake QUANDO vai gerar PDF, isolando
      // seus side-effects de inicialização do resto do módulo.
      const { renderPedidoCompraPDF } = await import("@/lib/pdf/pedido-compra");
      const emitidoEm = new Date().toISOString();

      for (const parcela of parcelas) {
        const buffer = await renderPedidoCompraPDF({
          pp: {
            codigo,
            servico: d.servico,
            quantidade: d.quantidade,
            especificacoes: d.especificacoes ?? null,
            valor,
            prazo_pagamento: parcela.data_vencimento,
            created_at: emitidoEm,
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
          parcela: {
            numero: parcela.numero,
            total: parcelas.length,
            data_vencimento: parcela.data_vencimento,
            valor: Number(parcela.valor),
          },
        });
        documentos.push({
          parcelaId: parcela.id,
          path: caminhoPdfParcela(
            session.activeTenant.id,
            job.id,
            pp_id,
            codigo,
            parcela.numero,
            parcelas.length,
          ),
          buffer,
        });
      }
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
  }

  for (const doc of documentos) {
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(doc.path, doc.buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadErr) {
      // Rollback inteiro: PP com metade dos documentos é pior que PP
      // nenhuma — o fornecedor receberia parcela sem papel.
      await supabase
        .from("pedidos_compra")
        .delete()
        .eq("id", pp_id)
        .eq("tenant_id", session.activeTenant.id);
      await supabase.storage
        .from(BUCKET)
        .remove([
          ...documentos.map((x) => x.path),
          ...anexosParsed.data.map((a) => a.path),
        ]);
      return {
        ok: false,
        message: `Falha ao subir PDF: ${uploadErr.message}`,
      };
    }
  }

  // Cada parcela guarda o caminho do SEU documento; `pedidos_compra.pdf_path`
  // segue apontando para o da primeira, que é o que as telas do financeiro
  // abrem hoje quando falam "a PP".
  const pdfPath = documentos[0]?.path ?? "";
  for (const doc of documentos) {
    const { error: errPath } = await supabase
      .from("pedidos_compra_parcelas")
      .update({ pdf_path: doc.path })
      .eq("id", doc.parcelaId)
      .eq("tenant_id", session.activeTenant.id);
    if (errPath) {
      // Documento existe no bucket; só o ponteiro falhou. Não desfaz a
      // PP por isso — avisa, que é o padrão das falhas parciais daqui.
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
      .remove([
        ...documentos.map((x) => x.path),
        ...anexosParsed.data.map((a) => a.path),
      ]);
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

  // Audit
  await logAuditEvent({
    acao: "pedido_compra.emitida",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: codigo,
      valor,
      quantidade: d.quantidade,
      parcelas: parcelasFinais.length,
      saldo_do_item_antes: saldo,
      verba_producao: d.verba_producao,
      fornecedor_id: d.verba_producao ? null : (d.fornecedor_id ?? null),
      responsavel_verba_id: d.verba_producao ? (d.responsavel_verba_id ?? null) : null,
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
      "id, tenant_id, codigo, job_id, item_realizado_id, status, jobs!inner(id, status, responsavel_id)",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !pp) return { ok: false, message: "PP não encontrada." };

  // Só PP em avaliação ou rejeitada pode ser cancelada. Paga, não: o
  // dinheiro já saiu, e desfazer isso é estorno, não cancelamento.
  if (!podeCancelarPP(pp.status as PPStatus)) {
    return {
      ok: false,
      message:
        pp.status === "cancelada"
          ? "PP já está cancelada."
          : "PP já foi paga — cancelar exigiria estorno pelo financeiro.",
    };
  }

  const job = (pp as unknown as { jobs: { status: string; responsavel_id: string | null } }).jobs;
  if (!jobAceitaAcoesPlanilha(job.status as JobStatus)) {
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
  if (pp.status !== "rejeitada") {
    return { ok: false, message: "Só PP rejeitada pode receber novos anexos." };
  }

  const gate = await checarGatesRealizado(pp.item_realizado_id);
  if (!gate.ok) return gate;

  return {
    ok: true,
    upload_prefix: `${session.activeTenant.id}/${pp.job_id}/${pp_id}/anexos/`,
  };
}

/**
 * Corrige uma PP rejeitada pelo financeiro e devolve pra avaliação.
 *
 * O PDF é REGERADO e sobrescreve o anterior no mesmo path: ele é o
 * documento que vai pro fornecedor e é o que o financeiro abre pra
 * conferir, então não pode contradizer a PP. O código da PP não muda,
 * logo o path também não.
 *
 * `valor` não vem do formulário: é calculado da quantidade, igual na
 * emissão (quantidade × R$/un do realizado).
 *
 * O PARCELAMENTO não se refaz aqui — a quantidade de parcelas e os
 * vencimentos foram combinados com o fornecedor na emissão. O que a
 * correção pode mudar é o valor total, e nesse caso as parcelas são
 * redivididas pela mesma regra do formulário (parte igual, sobra na
 * última), mantendo número e datas. Quem quiser outro parcelamento
 * cancela a PP e emite outra.
 */
export async function reenviarPedidoCompra(
  pp_id: string,
  dados: z.input<typeof dadosReenvioSchema>,
  anexosNovos: z.input<typeof anexoUploadedSchema>[],
  anexosRemovidosIds: string[],
): Promise<Result> {
  const session = await requireSession();
  const supabase = createClient();

  const { data: ppRow, error: ppErr } = await supabase
    .from("pedidos_compra")
    .select(
      "id, tenant_id, codigo, job_id, item_realizado_id, status, pdf_path, prazo_pagamento_financeiro",
    )
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (ppErr || !ppRow) return { ok: false, message: "PP não encontrada." };

  if (ppRow.status !== "rejeitada") {
    return {
      ok: false,
      message: "Só PP rejeitada pelo financeiro pode ser corrigida e reenviada.",
    };
  }

  // Reusa os mesmos gates da emissão: job editável + responsável ou admin.
  const gate = await checarGatesRealizado(ppRow.item_realizado_id);
  if (!gate.ok) return gate;
  const { item, job } = gate;

  const dadosParsed = dadosReenvioSchema.safeParse(dados);
  if (!dadosParsed.success) {
    return {
      ok: false,
      message: `Dados inválidos: ${dadosParsed.error.issues[0]?.message ?? "erro"}.`,
    };
  }
  const d = dadosParsed.data;

  // ---- Anexos: valida os novos antes de mexer em qualquer coisa ----
  const anexosParsed = z.array(anexoUploadedSchema).safeParse(anexosNovos);
  if (!anexosParsed.success) {
    return { ok: false, message: "Formato de anexo inválido." };
  }

  const expectedPrefix = `${session.activeTenant.id}/${job.id}/${pp_id}/anexos/`;
  for (const a of anexosParsed.data) {
    if (a.tamanho_bytes > PP_ANEXO_TAMANHO_MAX_BYTES) {
      return { ok: false, message: `Anexo ${a.nome_original} > 8 MB.` };
    }
    if (!a.path.startsWith(expectedPrefix)) {
      return { ok: false, message: "Anexo em path inválido." };
    }
  }

  const { data: anexosAtuais } = await supabase
    .from("pedidos_compra_anexos")
    .select("id, arquivo_path, arquivo_tamanho_bytes")
    .eq("pedido_compra_id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  const removidos = new Set(anexosRemovidosIds);
  const mantidos = (anexosAtuais ?? []).filter((a) => !removidos.has(a.id));

  if (mantidos.length + anexosParsed.data.length < 1) {
    return { ok: false, message: "Pelo menos um anexo é obrigatório." };
  }

  const somaBytes =
    mantidos.reduce((s, a) => s + Number(a.arquivo_tamanho_bytes ?? 0), 0) +
    anexosParsed.data.reduce((s, a) => s + a.tamanho_bytes, 0);
  if (somaBytes > PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES) {
    return { ok: false, message: "Anexos somam mais que 25 MB." };
  }

  // Confere no bucket que os novos existem mesmo (metadata pode ser forjada)
  if (anexosParsed.data.length > 0) {
    const { data: arquivosNoBucket, error: listErr } = await supabase.storage
      .from(BUCKET)
      .list(expectedPrefix.replace(/\/$/, ""));
    if (listErr) {
      return { ok: false, message: `Falha ao listar anexos: ${listErr.message}` };
    }
    const nomes = new Set(
      (arquivosNoBucket ?? []).map((f) => `${expectedPrefix}${f.name}`),
    );
    for (const a of anexosParsed.data) {
      if (!nomes.has(a.path)) {
        return {
          ok: false,
          message: `Anexo ${a.nome_original} não foi encontrado no bucket. Refaça o upload.`,
        };
      }
    }
  }

  // ---- FKs ----
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
    codigo: string;
    campanha: string | null;
    cliente: { nome_fantasia: string } | null;
    responsavel: { nome: string } | null;
  } | null;

  const projeto = projetoRes.data as ProjetoEnriquecido;
  const orcamento = orcRes.data as { codigo: string } | null;
  // Valor recalculado da quantidade corrigida, e conferido contra o saldo
  // SEM contar esta PP — ela já ocupa o saldo desde a emissão, e não pode
  // competir consigo mesma.
  const valor = valorDaPP(
    d.quantidade,
    item.total_orcado,
    item.quantidade_orcada,
  );
  if (valor <= 0) {
    return {
      ok: false,
      message: "Quantidade inválida: o valor da PP ficaria zerado.",
    };
  }

  const saldoSemEsta = await saldoDisponivelDoItem(
    supabase,
    session.activeTenant.id,
    ppRow.item_realizado_id,
    item.total_orcado,
    pp_id,
  );
  if (passaDoSaldo(valor, saldoSemEsta)) {
    return {
      ok: false,
      message: `A PP de ${brl(valor)} passa do saldo do item. Máximo aceito: ${brl(saldoSemEsta)}.`,
    };
  }

  // ---- Parcelas: valores redivididos, datas conforme a 1ª ----
  // Precisa vir ANTES do PDF: cada documento carrega o vencimento e o
  // valor da SUA parcela, então os números têm que estar decididos.
  const { data: parcelasAtuais } = await supabase
    .from("pedidos_compra_parcelas")
    .select("id, numero, data_vencimento")
    .eq("pedido_compra_id", pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .order("numero", { ascending: true });

  const parcelas = parcelasAtuais ?? [];
  const valores = dividirEmParcelas(valor, Math.max(parcelas.length, 1));
  const primeiraMudou =
    parcelas.length > 0 &&
    parcelas[0].data_vencimento.slice(0, 10) !== d.prazo_pagamento;

  const parcelasNovas = parcelas.map((parcela, i) => {
    let data = parcela.data_vencimento.slice(0, 10);
    if (primeiraMudou) {
      data = d.prazo_pagamento;
      for (let k = 0; k < i; k++) data = proximoVencimento(data);
    }
    return {
      id: parcela.id,
      numero: parcela.numero,
      data_vencimento: data,
      valor: valores[i],
    };
  });

  // ---- PDFs novos, sobrescrevendo os antigos ----
  // Um por parcela, como na emissão. Aqui o snapshot É regerado de
  // propósito: a PP foi corrigida, e o papel que o fornecedor recebe não
  // pode contradizer o que o financeiro vai aprovar.
  const documentos: Array<{ parcelaId: string; path: string; buffer: Buffer }> = [];
  try {
    const { renderPedidoCompraPDF } = await import("@/lib/pdf/pedido-compra");
    const emitidoEm = new Date().toISOString();

    for (const parcela of parcelasNovas) {
      const buffer = await renderPedidoCompraPDF({
        pp: {
          codigo: ppRow.codigo,
          servico: d.servico,
          quantidade: d.quantidade,
          especificacoes: d.especificacoes ?? null,
          valor,
          prazo_pagamento: parcela.data_vencimento,
          created_at: emitidoEm,
        },
        empresa: empRes.data as never,
        fornecedor: fornRes.data as never,
        job: { nome: job.nome, produto: job.produto ?? "" },
        projeto: {
          codigo: projeto?.codigo ?? "",
          campanha: projeto?.campanha ?? null,
        },
        orcamento: { codigo: orcamento?.codigo ?? "" },
        cliente: { nome_fantasia: projeto?.cliente?.nome_fantasia ?? "" },
        responsavelNome: projeto?.responsavel?.nome ?? "",
        parcela: {
          numero: parcela.numero,
          total: parcelasNovas.length,
          data_vencimento: parcela.data_vencimento,
          valor: parcela.valor,
        },
      });
      documentos.push({
        parcelaId: parcela.id,
        path: caminhoPdfParcela(
          session.activeTenant.id,
          job.id,
          pp_id,
          ppRow.codigo,
          parcela.numero,
          parcelasNovas.length,
        ),
        buffer,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Falha ao gerar PDF: ${msg}` };
  }

  for (const doc of documentos) {
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(doc.path, doc.buffer, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadErr) {
      return { ok: false, message: `Falha ao subir PDF: ${uploadErr.message}` };
    }
  }

  const pdfPath = documentos[0]?.path ?? ppRow.pdf_path;

  // ---- Persiste: PP volta pra avaliação, rejeição some do registro ----
  const { error: updErr } = await supabase
    .from("pedidos_compra")
    .update({
      fornecedor_id: d.fornecedor_id,
      empresa_id: d.empresa_id,
      servico: d.servico,
      quantidade: d.quantidade,
      especificacoes: d.especificacoes ?? null,
      valor,
      prazo_pagamento: d.prazo_pagamento,
      pdf_path: pdfPath,
      status: "em_avaliacao",
      rejeitada_por: null,
      rejeitada_em: null,
      motivo_rejeicao: null,
    })
    .eq("id", pp_id)
    .eq("tenant_id", session.activeTenant.id);

  if (updErr) {
    return { ok: false, message: `Falha ao reenviar PP: ${updErr.message}` };
  }

  for (const [i, parcela] of parcelasNovas.entries()) {
    const { error: updParcelaErr } = await supabase
      .from("pedidos_compra_parcelas")
      .update({
        valor: parcela.valor,
        data_vencimento: parcela.data_vencimento,
        pdf_path: documentos[i]?.path ?? null,
      })
      .eq("id", parcela.id)
      .eq("tenant_id", session.activeTenant.id);
    if (updParcelaErr) {
      return {
        ok: false,
        message: `PP reenviada, mas as parcelas não foram atualizadas: ${updParcelaErr.message}`,
      };
    }
  }

  if (anexosParsed.data.length > 0) {
    const { error: insAnexoErr } = await supabase
      .from("pedidos_compra_anexos")
      .insert(
        anexosParsed.data.map((a) => ({
          id: a.anexo_id,
          tenant_id: session.activeTenant.id,
          pedido_compra_id: pp_id,
          arquivo_path: a.path,
          arquivo_nome_original: a.nome_original,
          arquivo_tamanho_bytes: a.tamanho_bytes,
          arquivo_mimetype: a.mimetype,
          created_by: session.profile.id,
        })),
      );
    if (insAnexoErr) {
      return {
        ok: false,
        message: `PP reenviada, mas falhou ao registrar anexos: ${insAnexoErr.message}`,
      };
    }
  }

  // Remoção dos anexos que o GP tirou. Depois do update: se falhar aqui, o
  // pior caso é arquivo órfão no bucket, não PP sem anexo.
  const paraRemover = (anexosAtuais ?? []).filter((a) => removidos.has(a.id));
  if (paraRemover.length > 0) {
    await supabase
      .from("pedidos_compra_anexos")
      .delete()
      .in(
        "id",
        paraRemover.map((a) => a.id),
      )
      .eq("tenant_id", session.activeTenant.id);
    await supabase.storage
      .from(BUCKET)
      .remove(paraRemover.map((a) => a.arquivo_path));
  }

  await supabase
    .from("jobs_itens_realizado")
    .update({ fornecedor_id: d.fornecedor_id })
    .eq("id", ppRow.item_realizado_id)
    .eq("tenant_id", session.activeTenant.id);

  await logAuditEvent({
    acao: "pedido_compra.reenviada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: pp_id,
    metadata: {
      pp_codigo: ppRow.codigo,
      valor,
      fornecedor_id: d.fornecedor_id,
      job_id: job.id,
      anexos_adicionados: anexosParsed.data.length,
      anexos_removidos: paraRemover.length,
    },
  });

  revalidatePath(`/jobs/${job.id}`);
  revalidatePath("/financeiro/contas-a-pagar");
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

/**
 * URL assinada do documento de UMA parcela (Tela 2.3).
 *
 * Cada linha de parcela baixa o SEU papel — o que tem o vencimento e o
 * valor dela. PP legada cai no `pdf_path` que a migration backfillou, que
 * é o documento único de sempre; e se a parcela ainda não tiver caminho
 * (falha no ponteiro durante a emissão), cai no da PP, que existe.
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
