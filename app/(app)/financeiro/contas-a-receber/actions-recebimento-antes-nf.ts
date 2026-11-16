"use server";

/**
 * Recebimento antes da NF (decisão 130).
 *
 * O cliente pagou e a nota ainda não saiu. O financeiro registra o
 * recebimento — a nota do envio ou o BV — e o dinheiro entra no extrato na
 * hora. Quando a NF daquela linha é emitida, `emitir_faturamento` transforma
 * o recebimento na parcela 1 dela, já quitada.
 *
 * Decisão 256: o registro saiu da aba Faturamento e está na conciliação
 * ("Novo lançamento" › "Recebimento antes da NF"), escolhendo o job: com
 * envio do GP esperando nota, vai para a nota do envio; sem envio, fica preso
 * ao job, e o Novo faturamento associa à nota.
 *
 * As regras moram nas duas funções do banco (saldo, papel, conta, centro
 * de custo, auditoria); aqui fica o schema e a tradução do erro.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { rotuloMes } from "@/lib/calculos/meses-trimestre";
import { chaveDoRecebidoAntes, chaveDoRecebidoDoJob } from "./chave-info";
import { SELECT_RECEBIDO_ANTES, recebidosAntesPorChave } from "./dados-do-recebido-antes";
import type { AlvoDoRecebidoAntes, CambioDoJob } from "./recebimento-antes-nf-dialog";

type Result = { ok: true } | { ok: false; message: string };

async function gateFinanceiro(acaoTentada: string) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "recebimento_antes_nf",
      entidadeId: null,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false as const,
      message: "Apenas admin ou financeiro pode registrar recebimento antes da NF.",
    };
  }
  return { ok: true as const, session, supabase: createClient() };
}

/** O texto da exceção do banco já vem pronto para a tela; o técnico não. */
function mensagemDoBanco(msg: string, generica: string): string {
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/["]|\b[a-z]+_[a-z_]+\b/.test(limpa)) return limpa;
  return generica;
}

function revalidar() {
  revalidatePath("/financeiro/contas-a-receber");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro");
}

const registrarSchema = z
  .object({
    envio_nota_id: z.string().uuid().nullable(),
    item_bv_id: z.string().uuid().nullable(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
    conta_bancaria_id: z.string().uuid("Selecione a conta que recebeu."),
    valor: z.number().positive("Informe o valor recebido."),
    plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
    plano_conta_subtipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  })
  .refine((d) => (d.envio_nota_id === null) !== (d.item_bv_id === null), {
    message: "Informe a nota do envio ou o BV.",
  });

export async function registrarRecebimentoAntesNf(input: unknown): Promise<Result> {
  const parsed = registrarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.registrado");
  if (!gate.ok) return gate;
  const d = parsed.data;

  // A função grava o lançamento, o recebimento e a auditoria na mesma
  // transação.
  const { error } = await gate.supabase.rpc("registrar_recebimento_antes_nf", {
    p_envio_nota_id: d.envio_nota_id,
    p_item_bv_id: d.item_bv_id,
    p_data: d.data,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_valor: d.valor,
    p_tipo_id: d.plano_conta_tipo_id,
    p_subtipo_id: d.plano_conta_subtipo_id,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível registrar o recebimento."),
    };
  }

  revalidar();
  return { ok: true };
}

// O câmbio fechado do job internacional (decisão 229): o bruto em R$ e,
// à parte, o valor na moeda, a cotação, o IOF e a tarifa. A função confere
// que o job é internacional, que a nota ainda não tem recebimento e que o
// bruto é o valor na moeda vezes a cotação; grava o bruto, o IOF e a tarifa
// como lançamentos do job e a variação cambial no recebimento.
const registrarCambioSchema = z.object({
  envio_nota_id: z.string().uuid("Informe a nota do envio."),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
  conta_bancaria_id: z.string().uuid("Selecione a conta que recebeu."),
  valor: z.number().positive("Informe o valor recebido."),
  valor_moeda: z.number().positive("Informe o valor recebido na moeda."),
  cotacao: z.number().positive("Informe a cotação do dia."),
  iof: z.number().min(0, "O IOF não pode ser negativo."),
  tarifa: z.number().min(0, "A tarifa não pode ser negativa."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
});

export async function registrarRecebimentoCambio(input: unknown): Promise<Result> {
  const parsed = registrarCambioSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.registrado");
  if (!gate.ok) return gate;
  const d = parsed.data;

  const { error } = await gate.supabase.rpc("registrar_recebimento_antes_nf_cambio", {
    p_envio_nota_id: d.envio_nota_id,
    p_data: d.data,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_valor_moeda: d.valor_moeda,
    p_cotacao: d.cotacao,
    p_bruto: d.valor,
    p_iof: d.iof,
    p_tarifa: d.tarifa,
    p_tipo_id: d.plano_conta_tipo_id,
    p_subtipo_id: d.plano_conta_subtipo_id,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível registrar o recebimento."),
    };
  }

  revalidar();
  return { ok: true };
}

const cancelarSchema = z.object({
  id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .min(10, "Escreva o motivo do cancelamento (mínimo 10 caracteres)."),
});

export async function cancelarRecebimentoAntesNf(input: unknown): Promise<Result> {
  const parsed = cancelarSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.cancelado");
  if (!gate.ok) return gate;

  const { error } = await gate.supabase.rpc("cancelar_recebimento_antes_nf", {
    p_id: parsed.data.id,
    p_motivo: parsed.data.motivo,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível cancelar o recebimento."),
    };
  }

  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Decisão 256: o recebimento preso ao job (job sem envio), pela conciliação
// ---------------------------------------------------------------------------

const registrarDoJobSchema = z.object({
  job_id: z.string().uuid("Escolha o job."),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data do recebimento."),
  conta_bancaria_id: z.string().uuid("Selecione a conta que recebeu."),
  valor: z.number().positive("Informe o valor recebido."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
  plano_conta_subtipo_id: z.string().uuid("Selecione o centro de custo do recebimento."),
});

export async function registrarRecebimentoAntesNfDoJob(input: unknown): Promise<Result> {
  const parsed = registrarDoJobSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Entrada inválida." };
  }
  const gate = await gateFinanceiro("recebimento_antes_nf.registrado");
  if (!gate.ok) return gate;
  const d = parsed.data;

  // A função grava o lançamento, o recebimento e a auditoria na mesma
  // transação, e confere o que falta faturar do job.
  const { error } = await gate.supabase.rpc("registrar_recebimento_antes_nf_do_job", {
    p_job_id: d.job_id,
    p_data: d.data,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_valor: d.valor,
    p_tipo_id: d.plano_conta_tipo_id,
    p_subtipo_id: d.plano_conta_subtipo_id,
  });
  if (error) {
    return {
      ok: false,
      message: mensagemDoBanco(error.message, "Não foi possível registrar o recebimento."),
    };
  }
  revalidar();
  return { ok: true };
}

/** Um alvo do recebimento antes da NF na conciliação: a nota do envio, o BV
 *  ou o job sem envio, com o texto da lista de escolha. */
export interface AlvoDaConciliacao extends AlvoDoRecebidoAntes {
  /** "TES-1013/26 · Nome do job" ou "BV — item". */
  rotulo: string;
  /** A segunda linha da lista: o que acontece com o recebimento. */
  descricao: string;
  busca: string;
}

/**
 * Decisão 256: os alvos do recebimento antes da NF, lidos quando o
 * financeiro abre o formulário na conciliação (e não com a página):
 * - a nota do envio do GP que espera nota (com o câmbio do internacional);
 * - o BV confirmado;
 * - o job sem envio esperando nota, com o que falta faturar — o recebimento
 *   fica preso ao job, e o Novo faturamento associa à nota.
 * A nota do envio em lote não aceita (decisão 188, pendente), como na fila.
 */
export async function carregarAlvosDoRecebimentoAntesNf(): Promise<
  { ok: true; alvos: AlvoDaConciliacao[] } | { ok: false; message: string }
> {
  const gate = await gateFinanceiro("recebimento_antes_nf.alvos_lidos");
  if (!gate.ok) return gate;
  const { supabase, session } = gate;
  const tenantId = session.activeTenant.id;

  const [pendentesRes, jobsRes, recebidosRes] = await Promise.all([
    supabase
      .from("vw_faturamento_pendente")
      .select(
        "origem_tipo, origem_id, job_id, codigo, descricao, cliente_id, fornecedor_id, saldo, " +
          "envio_nota_id, nota_ordem, nota_total, mes_referencia",
      )
      .eq("tenant_id", tenantId),
    supabase
      .from("jobs")
      .select(
        "id, codigo, nome, cliente_id, faturamento_previsto, " +
          "orcamento:orcamentos(categoria:categorias_dominio!categoria_id(modelo_planilha)), " +
          "versao:versoes_orcamento!versao_orcamento_aprovada_id(moeda_estrangeira, cambio_compra)",
      )
      .eq("tenant_id", tenantId)
      .in("status", ["aberto", "em_producao", "encerrado", "finalizado"]),
    supabase
      .from("recebimentos_antes_nf")
      .select(SELECT_RECEBIDO_ANTES)
      .eq("tenant_id", tenantId)
      .eq("status", "aguardando")
      .order("data", { ascending: true }),
  ]);
  for (const res of [pendentesRes, jobsRes, recebidosRes]) {
    if (res.error) {
      console.error("[recebimento_antes_nf.alvos]", res.error.message);
      return { ok: false, message: "Não foi possível abrir os jobs. Tente de novo." };
    }
  }

  type Pendente = {
    origem_tipo: "job" | "bv";
    origem_id: string;
    job_id: string | null;
    codigo: string | null;
    descricao: string;
    cliente_id: string | null;
    fornecedor_id: string | null;
    saldo: number | string;
    envio_nota_id: string | null;
    nota_ordem: number | null;
    nota_total: number | null;
    mes_referencia: string | null;
  };
  type Job = {
    id: string;
    codigo: string | null;
    nome: string;
    cliente_id: string | null;
    faturamento_previsto: number | string | null;
    orcamento: { categoria: { modelo_planilha: string } | null } | null;
    versao: { moeda_estrangeira: string | null; cambio_compra: number | string | null } | null;
  };
  const pendentes = (pendentesRes.data ?? []) as unknown as Pendente[];
  const jobs = (jobsRes.data ?? []) as unknown as Job[];
  const recebidos = recebidosAntesPorChave(recebidosRes.data as unknown[] | null);
  const jobsComEnvio = new Set(pendentes.filter((p) => p.origem_tipo === "job").map((p) => p.job_id ?? p.origem_id));
  const jobsSemEnvio = jobs.filter((j) => !jobsComEnvio.has(j.id) && Number(j.faturamento_previsto ?? 0) > 0.004);
  const idsNotas = [...new Set(pendentes.map((p) => p.envio_nota_id).filter((id): id is string => Boolean(id)))];
  const idsClientes = [...new Set([...pendentes, ...jobsSemEnvio].map((x) => x.cliente_id).filter((id): id is string => Boolean(id)))];
  const idsFornecedores = [...new Set(pendentes.map((p) => p.fornecedor_id).filter((id): id is string => Boolean(id)))];

  // O já faturado dos jobs sem envio, as notas do envio que são de um lote
  // e os nomes do cliente e do fornecedor.
  const [faturadoRes, lotesRes, clientesRes, fornecedoresRes] = await Promise.all([
    jobsSemEnvio.length
      ? supabase
          .from("faturamento_itens")
          .select("origem_id, valor, faturamento:faturamentos!inner(status)")
          .eq("tenant_id", tenantId)
          .in("origem_tipo", ["job", "save"])
          .eq("faturamento.status", "emitido")
          .in(
            "origem_id",
            jobsSemEnvio.map((j) => j.id),
          )
      : Promise.resolve({ data: [] as Array<{ origem_id: string; valor: number | string }>, error: null }),
    idsNotas.length
      ? supabase.from("jobs_envio_faturamento_notas").select("id").in("id", idsNotas).not("lote_nota_id", "is", null)
      : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    idsClientes.length
      ? supabase.from("clientes").select("id, nome_fantasia, razao_social").in("id", idsClientes)
      : Promise.resolve({ data: [] as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }>, error: null }),
    idsFornecedores.length
      ? supabase.from("fornecedores").select("id, nome").in("id", idsFornecedores)
      : Promise.resolve({ data: [] as Array<{ id: string; nome: string }>, error: null }),
  ]);
  for (const res of [faturadoRes, lotesRes, clientesRes, fornecedoresRes]) {
    if (res.error) {
      console.error("[recebimento_antes_nf.alvos]", res.error.message);
      return { ok: false, message: "Não foi possível abrir os jobs. Tente de novo." };
    }
  }
  const faturado = new Map<string, number>();
  for (const i of (faturadoRes.data ?? []) as Array<{ origem_id: string; valor: number | string }>)
    faturado.set(i.origem_id, (faturado.get(i.origem_id) ?? 0) + Number(i.valor));
  const notasDeLote = new Set(((lotesRes.data ?? []) as Array<{ id: string }>).map((n) => n.id));
  const nomeCliente = new Map(
    ((clientesRes.data ?? []) as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }>).map(
      (c) => [c.id, c.nome_fantasia || c.razao_social || "—"],
    ),
  );
  const nomeFornecedor = new Map(((fornecedoresRes.data ?? []) as Array<{ id: string; nome: string }>).map((f) => [f.id, f.nome]));

  // Decisão 229: o job internacional recebe pelo câmbio fechado.
  const cambioPorJob = new Map<string, CambioDoJob>();
  for (const j of jobs) {
    const moeda = j.versao?.moeda_estrangeira?.trim() ?? "";
    const cotacao = Number(j.versao?.cambio_compra ?? 0);
    if (j.orcamento?.categoria?.modelo_planilha === "internacional" && moeda && cotacao > 0) {
      cambioPorJob.set(j.id, { moeda, cotacaoDaVersao: cotacao });
    }
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const moedaBr = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const alvos: AlvoDaConciliacao[] = [];

  // As notas do envio, juntando os vencimentos de cada uma.
  const porNota = new Map<string, Pendente[]>();
  for (const p of pendentes)
    if (p.origem_tipo === "job" && p.envio_nota_id && !notasDeLote.has(p.envio_nota_id))
      porNota.set(p.envio_nota_id, [...(porNota.get(p.envio_nota_id) ?? []), p]);
  for (const [notaId, linhas] of porNota) {
    const p = linhas[0];
    const chave = chaveDoRecebidoAntes(notaId, null);
    if (!chave) continue;
    const saldo = r2(linhas.reduce((t, l) => t + Number(l.saldo), 0));
    const titulo = [p.codigo, p.descricao].filter(Boolean).join(" · ") + (p.mes_referencia ? ` · ${rotuloMes(p.mes_referencia)}` : "");
    const contraparte = nomeCliente.get(p.cliente_id ?? "") ?? "—";
    alvos.push({
      chave,
      envioNotaId: notaId,
      itemBvId: null,
      jobId: null,
      titulo,
      contraparte,
      ehBv: false,
      notaRotulo: `NF ${p.nota_ordem ?? 1}/${p.nota_total ?? 1}` + (linhas.length > 1 ? ` · ${linhas.length} vencimentos` : ""),
      saldo,
      recebidos: recebidos[chave] ?? [],
      cambio: cambioPorJob.get(p.job_id ?? p.origem_id) ?? null,
      rotulo: titulo,
      descricao: `Envio do GP · NF ${p.nota_ordem ?? 1}/${p.nota_total ?? 1} · ${contraparte} · saldo ${moedaBr(saldo)}`,
      busca: `${titulo} ${contraparte}`,
    });
  }

  // O BV confirmado: contraparte é o fornecedor.
  for (const p of pendentes) {
    if (p.origem_tipo !== "bv") continue;
    const chave = chaveDoRecebidoAntes(null, p.origem_id);
    if (!chave) continue;
    const contraparte = nomeFornecedor.get(p.fornecedor_id ?? "") ?? "—";
    const titulo = [p.codigo, p.descricao].filter(Boolean).join(" · ");
    alvos.push({
      chave,
      envioNotaId: null,
      itemBvId: p.origem_id,
      jobId: null,
      titulo,
      contraparte,
      ehBv: true,
      notaRotulo: null,
      saldo: r2(Number(p.saldo)),
      recebidos: recebidos[chave] ?? [],
      cambio: null,
      rotulo: titulo,
      descricao: `BV · ${contraparte} · ${moedaBr(Number(p.saldo))}`,
      busca: `${titulo} ${contraparte}`,
    });
  }

  // O job sem envio: o recebimento fica preso a ele.
  for (const j of jobsSemEnvio) {
    const falta = r2(Number(j.faturamento_previsto ?? 0) - (faturado.get(j.id) ?? 0));
    if (falta <= 0.004) continue;
    const chave = chaveDoRecebidoDoJob(j.id);
    const titulo = [j.codigo, j.nome].filter(Boolean).join(" · ");
    const contraparte = nomeCliente.get(j.cliente_id ?? "") ?? "—";
    alvos.push({
      chave,
      envioNotaId: null,
      itemBvId: null,
      jobId: j.id,
      titulo,
      contraparte,
      ehBv: false,
      notaRotulo: "Sem envio · fica preso ao job",
      saldo: falta,
      recebidos: recebidos[chave] ?? [],
      cambio: null,
      rotulo: titulo,
      descricao: `Sem envio: fica preso ao job, para o Novo faturamento · ${contraparte} · falta faturar ${moedaBr(falta)}`,
      busca: `${titulo} ${contraparte}`,
    });
  }

  alvos.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  return { ok: true, alvos };
}
