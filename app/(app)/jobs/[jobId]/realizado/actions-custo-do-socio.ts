"use server";

/**
 * Decisão 236 (03/11/2026): o custo pago pelo sócio no realizado do item.
 *
 * Nos jobs de empresa com sócio (`empresas_socio_de_custos` — hoje só a
 * Ventura, com a Robotech), o painel "Destrinchar realizado" lança custo de
 * duas formas: a PP, que a California paga e vai ao financeiro, e o custo
 * que o sócio pagou, que só entra no realizado. Este arquivo é o segundo.
 *
 * Quem lança é quem gera PP (`jobs.emitir_pp`). O job precisa estar aberto:
 * o custo do sócio não tem "a emitir". O gatilho
 * `custo_do_socio_confere` repete as travas de linha, empresa e status, e o
 * `recalcular_realizado_do_item` soma o custo ao realizado.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { pode } from "@/lib/permissoes";
import { jobAceitaEnvioDePP, type JobStatus } from "@/lib/types";

const BUCKET = "pedidos-compra";
const URL_TTL_SEGUNDOS = 3600;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; message: string };
type Result<T = object> = Ok<T> | Err;

const numeroPositivo = z.coerce.number().finite().positive();

const dadosSchema = z.object({
  descricao: z.string().trim().min(1, "Descreva o custo.").max(300, "Descrição com até 300 caracteres."),
  fornecedor_nome: z
    .string()
    .trim()
    .max(200, "Quem o sócio pagou: até 200 caracteres.")
    .nullable()
    .transform((v) => (v ? v : null)),
  valor_unitario: numeroPositivo,
  quantidade: numeroPositivo,
  dias_meses: numeroPositivo,
  data_gasto: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do gasto."),
  comprovante_path: z.string().min(1).max(500).nullable(),
  comprovante_nome: z.string().trim().min(1).max(200).nullable(),
  observacao: z
    .string()
    .trim()
    .max(1000, "Observação com até 1000 caracteres.")
    .nullable()
    .transform((v) => (v ? v : null)),
});

export type DadosDoCustoDoSocio = z.input<typeof dadosSchema>;

/**
 * As travas comuns: sessão, papel, linha do job, empresa com sócio, job
 * aberto e linha não cancelada por errata.
 */
async function checarGates(
  itemRealizadoId: string,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
      linha: { id: string; job_id: string; tenant_id: string };
      socio: string;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (!pode(session.activeRole, "jobs.emitir_pp")) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "custo_do_socio",
      entidadeId: null,
      metadata: { acao_tentada: acaoTentada, motivo: "papel_sem_permissao", papel: session.activeRole },
    });
    return { ok: false, message: "Você não tem permissão para lançar custo neste job." };
  }

  const { data: linha } = await supabase
    .from("jobs_itens_realizado")
    .select("id, job_id, tenant_id, job_item_orcado_id")
    .eq("id", itemRealizadoId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();
  if (!linha) return { ok: false, message: "Item não encontrado." };

  const [jobRes, orcadoRes] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, empresa_id")
      .eq("id", linha.job_id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle(),
    linha.job_item_orcado_id
      ? supabase
          .from("jobs_itens_orcado")
          .select("item, cancelada_em")
          .eq("id", linha.job_item_orcado_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const job = jobRes.data;
  if (!job) return { ok: false, message: "Job não encontrado." };

  if (!jobAceitaEnvioDePP(job.status as JobStatus)) {
    return {
      ok: false,
      message: "O custo do sócio só se lança com o job aberto.",
    };
  }

  const orcado = orcadoRes.data as { item: string | null; cancelada_em: string | null } | null;
  if (orcado?.cancelada_em) {
    return {
      ok: false,
      message: `"${orcado.item ?? "A linha"}" foi cancelada por errata e não recebe custo.`,
    };
  }

  const { data: socioRow } = job.empresa_id
    ? await supabase
        .from("empresas_socio_de_custos")
        .select("socio")
        .eq("empresa_id", job.empresa_id)
        .maybeSingle()
    : { data: null };
  if (!socioRow) {
    return { ok: false, message: "A empresa deste job não tem sócio que pague custos." };
  }

  return {
    ok: true,
    session,
    supabase,
    linha: { id: linha.id, job_id: linha.job_id, tenant_id: linha.tenant_id },
    socio: socioRow.socio as string,
  };
}

/** O comprovante precisa estar na pasta deste job, no tenant da sessão. */
function prefixoDoComprovante(tenantId: string, jobId: string) {
  return `${tenantId}/custos-do-socio/${jobId}/`;
}

function validar(dados: DadosDoCustoDoSocio, tenantId: string, jobId: string) {
  const parsed = dadosSchema.safeParse(dados);
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;
  if ((d.comprovante_path === null) !== (d.comprovante_nome === null)) {
    return { ok: false as const, message: "Comprovante incompleto: anexe de novo." };
  }
  if (d.comprovante_path && !d.comprovante_path.startsWith(prefixoDoComprovante(tenantId, jobId))) {
    return { ok: false as const, message: "Comprovante fora da pasta do job." };
  }
  return { ok: true as const, dados: d };
}

/** A pasta onde o navegador sobe o comprovante antes de registrar. */
export async function prefixoComprovanteDoSocio(
  itemRealizadoId: string,
): Promise<Result<{ prefixo: string }>> {
  const gate = await checarGates(itemRealizadoId, "custo_do_socio.registrado");
  if (!gate.ok) return gate;
  return { ok: true, prefixo: prefixoDoComprovante(gate.session.activeTenant.id, gate.linha.job_id) };
}

export async function registrarCustoDoSocio(
  itemRealizadoId: string,
  dados: DadosDoCustoDoSocio,
): Promise<Result<{ id: string }>> {
  const gate = await checarGates(itemRealizadoId, "custo_do_socio.registrado");
  if (!gate.ok) return gate;
  const { session, supabase, linha } = gate;

  const v = validar(dados, session.activeTenant.id, linha.job_id);
  if (!v.ok) return v;

  const { data, error } = await supabase
    .from("jobs_custos_do_socio")
    .insert({
      tenant_id: session.activeTenant.id,
      job_id: linha.job_id,
      item_realizado_id: linha.id,
      // O gatilho troca pelo nome do cadastro; vai aqui por ser obrigatório.
      socio: gate.socio,
      ...v.dados,
      created_by: session.profile.id,
    })
    .select("id, valor")
    .single();
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Não foi possível registrar o custo." };
  }

  await logAuditEvent({
    acao: "custo_do_socio.registrado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "custo_do_socio",
    entidadeId: data.id,
    metadata: {
      job_id: linha.job_id,
      item_realizado_id: linha.id,
      socio: gate.socio,
      descricao: v.dados.descricao,
      valor: Number(data.valor),
    },
  });

  revalidatePath(`/jobs/${linha.job_id}`);
  return { ok: true, id: data.id };
}

async function carregarCusto(custoId: string, tenantId: string) {
  const supabase = createClient();
  const { data } = await supabase
    .from("jobs_custos_do_socio")
    .select("id, job_id, item_realizado_id, descricao, valor, comprovante_path")
    .eq("id", custoId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data as
    | {
        id: string;
        job_id: string;
        item_realizado_id: string;
        descricao: string;
        valor: number;
        comprovante_path: string | null;
      }
    | null;
}

export async function editarCustoDoSocio(
  custoId: string,
  dados: DadosDoCustoDoSocio,
): Promise<Result> {
  const session = await requireSession();
  const antes = await carregarCusto(custoId, session.activeTenant.id);
  if (!antes) return { ok: false, message: "Custo não encontrado." };

  const gate = await checarGates(antes.item_realizado_id, "custo_do_socio.editado");
  if (!gate.ok) return gate;
  const { supabase, linha } = gate;

  const v = validar(dados, session.activeTenant.id, linha.job_id);
  if (!v.ok) return v;

  const { data, error } = await supabase
    .from("jobs_custos_do_socio")
    .update({ ...v.dados, updated_by: session.profile.id })
    .eq("id", custoId)
    .eq("tenant_id", session.activeTenant.id)
    .select("valor")
    .single();
  if (error || !data) {
    return { ok: false, message: error?.message ?? "Não foi possível salvar o custo." };
  }

  // O comprovante trocado ou tirado sai do bucket.
  if (antes.comprovante_path && antes.comprovante_path !== v.dados.comprovante_path) {
    await supabase.storage.from(BUCKET).remove([antes.comprovante_path]);
  }

  await logAuditEvent({
    acao: "custo_do_socio.editado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "custo_do_socio",
    entidadeId: custoId,
    metadata: {
      job_id: linha.job_id,
      item_realizado_id: linha.id,
      descricao: v.dados.descricao,
      valor_antes: Number(antes.valor),
      valor_depois: Number(data.valor),
    },
  });

  revalidatePath(`/jobs/${linha.job_id}`);
  return { ok: true };
}

export async function excluirCustoDoSocio(custoId: string): Promise<Result> {
  const session = await requireSession();
  const antes = await carregarCusto(custoId, session.activeTenant.id);
  if (!antes) return { ok: false, message: "Custo não encontrado." };

  const gate = await checarGates(antes.item_realizado_id, "custo_do_socio.excluido");
  if (!gate.ok) return gate;
  const { supabase, linha } = gate;

  const { error } = await supabase
    .from("jobs_custos_do_socio")
    .delete()
    .eq("id", custoId)
    .eq("tenant_id", session.activeTenant.id);
  if (error) return { ok: false, message: error.message };

  if (antes.comprovante_path) {
    await supabase.storage.from(BUCKET).remove([antes.comprovante_path]);
  }

  await logAuditEvent({
    acao: "custo_do_socio.excluido",
    tenantId: session.activeTenant.id,
    entidadeTipo: "custo_do_socio",
    entidadeId: custoId,
    metadata: {
      job_id: linha.job_id,
      item_realizado_id: linha.id,
      descricao: antes.descricao,
      valor: Number(antes.valor),
    },
  });

  revalidatePath(`/jobs/${linha.job_id}`);
  return { ok: true };
}

/** O comprovante abre numa aba, por URL assinada. */
export async function urlDoComprovanteDoSocio(custoId: string): Promise<Result<{ url: string }>> {
  const session = await requireSession();
  const custo = await carregarCusto(custoId, session.activeTenant.id);
  if (!custo?.comprovante_path) return { ok: false, message: "Comprovante não encontrado." };
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(custo.comprovante_path, URL_TTL_SEGUNDOS);
  if (error || !data) return { ok: false, message: error?.message ?? "Falha ao abrir o comprovante." };
  return { ok: true, url: data.signedUrl };
}
