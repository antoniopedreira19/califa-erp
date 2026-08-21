"use server";

/**
 * Tela 3.2 — aba "Títulos a Pagar".
 *
 * Três verbos, e só três: APROVAR uma PP definindo a data de pagamento,
 * DAR BAIXA num título, e REPACTUAR a data de pagamento. Aprovação e
 * rejeição de PP continuam em `actions.ts`, na aba de Pedidos de
 * Produção — é a regra que o próprio protótipo escreve no rodapé da aba:
 * "Nesta aba só é possível dar baixa."
 *
 * "Título" aqui não é tabela: é a parcela de uma PP aprovada ou uma
 * `contas_avulsas` (que é onde a recorrência materializa suas
 * ocorrências). Por isso toda action recebe a `origem` junto do id — é
 * ela que decide em qual das duas fontes a escrita cai.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Ok = { ok: true };
type Err = { ok: false; message: string };
type Result = Ok | Err;

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar em YYYY-MM-DD.");

/** Origem do título — ver `OrigemTitulo` em `lib/types.ts`. */
const origemSchema = z.enum(["pp", "avulso", "recorrencia", "desembolso"]);

/**
 * A mensagem do Postgres não é para o usuário.
 *
 * As RPCs de baixa falam português quando são elas que barram, mas uma
 * violação de constraint sobe crua — foi o que apareceu na verificação
 * de 18/08/2026, com o índice de baixa por parcela chegando à tela como
 * `duplicate key value violates unique constraint`. Erro que não
 * reconhecemos vira uma frase genérica, e o original fica no log do
 * servidor para quem for investigar.
 */
function mensagemDeBaixa(msg: string): string {
  if (msg.includes("uniq_baixa_ativa_por_parcela")) {
    return "Esta parcela já tem uma baixa registrada.";
  }
  if (msg.includes("uniq_baixa_ativa_por_pp_sem_parcela")) {
    return "Este pedido de produção já tem uma baixa registrada.";
  }
  if (msg.includes("uniq_baixa_ativa_por_avulsa")) {
    return "Este lançamento já tem uma baixa registrada.";
  }
  if (msg.includes("uniq_baixa_ativa_por_desembolso_parcela")) {
    return "Esta parcela de desembolso já tem uma baixa registrada.";
  }
  // As RPCs levantam exceção com texto já pronto para a tela; o
  // prefixo do Postgres é o que precisa sair.
  const limpa = msg.replace(/^.*?(?:ERROR|erro):\s*/i, "").trim();
  if (limpa && !/[_"]/.test(limpa)) return limpa;
  return "Não foi possível dar baixa. Tente novamente.";
}

/**
 * Gate: apenas admin ou financeiro, com `acao_negada` no audit.
 * Mesmo formato do `checarGateFinanceiro` de `actions.ts` e
 * `actions-avulsas.ts` — repetido de propósito para cada arquivo
 * carregar o seu `entidadeTipo`.
 */
async function checarGateFinanceiro(
  entidadeTipo: string,
  entidadeId: string | null,
  acaoTentada: string,
): Promise<
  | {
      ok: true;
      session: Awaited<ReturnType<typeof requireSession>>;
      supabase: ReturnType<typeof createClient>;
    }
  | Err
> {
  const session = await requireSession();
  const supabase = createClient();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo,
      entidadeId,
      metadata: { acao_tentada: acaoTentada, motivo: "sem_permissao_financeira" },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode executar esta ação.",
    };
  }

  return { ok: true, session, supabase };
}

/** Revalida tudo que enxerga dinheiro a sair. */
function revalidarFinanceiro(jobId?: string | null) {
  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/fluxo-caixa");
  revalidatePath("/financeiro/conciliacao");
  revalidatePath("/financeiro");
  if (jobId) revalidatePath(`/jobs/${jobId}`);
}

// ---------------------------------------------------------------------
// Aprovar PP definindo a data de pagamento
// ---------------------------------------------------------------------

const aprovarSchema = z.object({
  pp_id: z.string().uuid(),
  data_pagamento: dataSchema,
});

/**
 * Aprova a PP e transforma as parcelas dela em títulos a pagar.
 *
 * A data escolhida desloca TODAS as parcelas pelo mesmo delta em relação
 * ao vencimento da 1ª — o espaçamento negociado pela produção é
 * preservado, só o ponto de partida muda. A conta mora na RPC
 * `aprovar_pp_com_data`, não aqui: é regra crítica e não pode depender
 * do frontend nem desta camada.
 */
export async function aprovarPPComData(input: unknown): Promise<Result> {
  const parsed = aprovarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Escolha a data de pagamento antes de aprovar.",
    };
  }

  const gate = await checarGateFinanceiro(
    "pedido_compra",
    parsed.data.pp_id,
    "pedido_compra.aprovada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: pp } = await supabase
    .from("pedidos_compra")
    .select("id, status, codigo, valor, job_id")
    .eq("id", parsed.data.pp_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!pp) return { ok: false, message: "PP não encontrada." };
  if (pp.status !== "em_avaliacao") {
    return {
      ok: false,
      message:
        pp.status === "aprovada"
          ? "PP já está aprovada."
          : "Só PP em avaliação pode ser aprovada.",
    };
  }

  const { error } = await supabase.rpc("aprovar_pp_com_data", {
    p_pp_id: parsed.data.pp_id,
    p_data_pagamento: parsed.data.data_pagamento,
  });
  if (error) return { ok: false, message: `Falha ao aprovar: ${error.message}` };

  await logAuditEvent({
    acao: "pedido_compra.aprovada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parsed.data.pp_id,
    metadata: {
      pp_codigo: pp.codigo,
      valor: Number(pp.valor),
      job_id: pp.job_id,
      data_pagamento: parsed.data.data_pagamento,
    },
  });

  revalidarFinanceiro(pp.job_id);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Dar baixa num título
// ---------------------------------------------------------------------

const baixaSchema = z.object({
  origem: origemSchema,
  /** Id da parcela (origem `pp`) ou da conta avulsa (demais origens). */
  id: z.string().uuid(),
  pago_em: dataSchema,
  conta_bancaria_id: z.string().uuid("Selecione a conta que realizará o pagamento."),
  plano_conta_tipo_id: z.string().uuid("Selecione o centro de custo do pagamento."),
  plano_conta_subtipo_id: z
    .string()
    .uuid("Selecione o centro de custo do pagamento."),
});

/**
 * Baixa um título e o envia para a conciliação.
 *
 * Origem `pp` baixa UMA parcela (a PP só vira paga quando a última cai);
 * `avulso` e `recorrencia` baixam a `contas_avulsas`. Nos dois casos o
 * centro de custo — o par tipo/subtipo do plano de contas — é
 * obrigatório e vai gravado no lançamento.
 */
export async function darBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = baixaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await checarGateFinanceiro(
    d.origem === "pp" ? "pedido_compra" : "conta_avulsa",
    d.id,
    d.origem === "pp" ? "pedido_compra.parcela_paga" : "conta_avulsa.baixada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  if (d.origem === "pp") {
    const { data: parcela } = await supabase
      .from("pedidos_compra_parcelas")
      .select(
        "id, numero, valor, pago_em, pedido:pedidos_compra!inner(id, codigo, status, job_id)",
      )
      .eq("id", d.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        numero: number;
        valor: string | number;
        pago_em: string | null;
        pedido: {
          id: string;
          codigo: string;
          status: string;
          job_id: string;
        } | null;
      }>();

    if (!parcela) return { ok: false, message: "Parcela não encontrada." };
    if (parcela.pago_em) return { ok: false, message: "Esta parcela já está paga." };
    if (parcela.pedido?.status !== "aprovada") {
      return {
        ok: false,
        message: "A PP precisa estar aprovada antes da baixa.",
      };
    }

    const { data: lancId, error } = await supabase.rpc("dar_baixa_pp_parcela", {
      p_parcela_id: d.id,
      p_pago_em: d.pago_em,
      p_conta_bancaria_id: d.conta_bancaria_id,
      p_plano_conta_tipo_id: d.plano_conta_tipo_id,
      p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      p_criado_por: session.profile.id,
    });
    if (error) {
      console.error("[titulos.baixa.pp]", error.message);
      return { ok: false, message: mensagemDeBaixa(error.message) };
    }

    await logAuditEvent({
      acao: "pedido_compra.parcela_paga",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: parcela.pedido.id,
      metadata: {
        pp_codigo: parcela.pedido.codigo,
        parcela_id: parcela.id,
        parcela_numero: parcela.numero,
        valor: Number(parcela.valor),
        pago_em: d.pago_em,
        job_id: parcela.pedido.job_id,
        conta_bancaria_id: d.conta_bancaria_id,
        lancamento_id: lancId,
      },
    });

    revalidarFinanceiro(parcela.pedido.job_id);
    return { ok: true };
  }

  if (d.origem === "desembolso") {
    const { data: parcela } = await supabase
      .from("desembolsos_parcelas")
      .select(
        "id, numero, valor, pago_em, desembolso:desembolsos!inner(id, codigo, status)",
      )
      .eq("id", d.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<{
        id: string;
        numero: number;
        valor: string | number;
        pago_em: string | null;
        desembolso: { id: string; codigo: string; status: string } | null;
      }>();

    if (!parcela) return { ok: false, message: "Parcela não encontrada." };
    if (parcela.pago_em) return { ok: false, message: "Esta parcela já está paga." };
    if (parcela.desembolso?.status !== "aprovada") {
      return { ok: false, message: "O desembolso precisa estar aprovado antes da baixa." };
    }

    const { data: lancId, error } = await supabase.rpc("dar_baixa_desembolso_parcela", {
      p_parcela_id: d.id,
      p_pago_em: d.pago_em,
      p_conta_bancaria_id: d.conta_bancaria_id,
      p_plano_conta_tipo_id: d.plano_conta_tipo_id,
      p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
      p_criado_por: session.profile.id,
    });
    if (error) {
      console.error("[titulos.baixa.desembolso]", error.message);
      return { ok: false, message: mensagemDeBaixa(error.message) };
    }

    await logAuditEvent({
      acao: "desembolso.parcela_paga",
      tenantId: session.activeTenant.id,
      entidadeTipo: "desembolso",
      entidadeId: parcela.desembolso!.id,
      metadata: {
        codigo: parcela.desembolso!.codigo,
        parcela_id: parcela.id,
        parcela_numero: parcela.numero,
        valor: Number(parcela.valor),
        pago_em: d.pago_em,
        conta_bancaria_id: d.conta_bancaria_id,
        lancamento_id: lancId,
      },
    });

    revalidarFinanceiro();
    return { ok: true };
  }

  const { data: avulsa } = await supabase
    .from("contas_avulsas")
    .select("id, status, descricao, valor, job_id, recorrente_id")
    .eq("id", d.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!avulsa) return { ok: false, message: "Lançamento não encontrado." };
  if (avulsa.status !== "aprovada") {
    return {
      ok: false,
      message: avulsa.status === "baixada" ? "Já está baixado." : "Não pode ser baixado.",
    };
  }

  const { data: lancId, error } = await supabase.rpc("dar_baixa_avulsa_com_plano", {
    p_conta_avulsa_id: d.id,
    p_pago_em: d.pago_em,
    p_conta_bancaria_id: d.conta_bancaria_id,
    p_plano_conta_tipo_id: d.plano_conta_tipo_id,
    p_plano_conta_subtipo_id: d.plano_conta_subtipo_id,
  });
  if (error) {
    console.error("[titulos.baixa.avulsa]", error.message);
    return { ok: false, message: mensagemDeBaixa(error.message) };
  }

  await logAuditEvent({
    acao: "conta_avulsa.baixada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: d.id,
    metadata: {
      descricao: avulsa.descricao,
      valor: Number(avulsa.valor),
      pago_em: d.pago_em,
      origem: avulsa.recorrente_id ? "recorrencia" : "avulso",
      conta_bancaria_id: d.conta_bancaria_id,
      lancamento_id: lancId,
    },
  });

  revalidarFinanceiro(avulsa.job_id);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Repactuar a data de pagamento
// ---------------------------------------------------------------------

const repactuarSchema = z.object({
  origem: origemSchema,
  id: z.string().uuid(),
  data_pagamento: dataSchema,
});

/**
 * Move a data de pagamento de um título já existente.
 *
 * O vencimento original e a primeira data de pagamento não se tocam: o
 * primeiro porque ninguém escreve nele depois da emissão, a segunda
 * porque um trigger no banco a congela. Título já pago não repactua —
 * a data dele virou fato no lançamento.
 */
export async function repactuarDataPagamento(input: unknown): Promise<Result> {
  const parsed = repactuarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await checarGateFinanceiro(
    d.origem === "pp" ? "pedido_compra" : "conta_avulsa",
    d.id,
    "titulo_pagar.data_repactuada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  if (d.origem === "pp") {
    const { data: parcela } = await supabase
      .from("pedidos_compra_parcelas")
      .select("id, numero, data_pagamento, pago_em, pedido_compra_id")
      .eq("id", d.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle();

    if (!parcela) return { ok: false, message: "Parcela não encontrada." };
    if (parcela.pago_em) {
      return {
        ok: false,
        message: "Parcela já paga — a data do pagamento não muda mais.",
      };
    }

    const { error } = await supabase
      .from("pedidos_compra_parcelas")
      .update({ data_pagamento: d.data_pagamento })
      .eq("id", d.id)
      .eq("tenant_id", session.activeTenant.id);
    if (error) {
      return { ok: false, message: `Falha ao salvar a data: ${error.message}` };
    }

    await logAuditEvent({
      acao: "titulo_pagar.data_repactuada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "pedido_compra",
      entidadeId: parcela.pedido_compra_id,
      metadata: {
        parcela_id: parcela.id,
        parcela_numero: parcela.numero,
        data_anterior: parcela.data_pagamento,
        data_nova: d.data_pagamento,
      },
    });

    revalidarFinanceiro();
    return { ok: true };
  }

  const { data: avulsa } = await supabase
    .from("contas_avulsas")
    .select("id, descricao, data_pagamento, status")
    .eq("id", d.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!avulsa) return { ok: false, message: "Lançamento não encontrado." };
  if (avulsa.status !== "aprovada") {
    return {
      ok: false,
      message: "Lançamento já baixado — a data do pagamento não muda mais.",
    };
  }

  const { error } = await supabase
    .from("contas_avulsas")
    .update({ data_pagamento: d.data_pagamento })
    .eq("id", d.id)
    .eq("tenant_id", session.activeTenant.id);
  if (error) {
    return { ok: false, message: `Falha ao salvar a data: ${error.message}` };
  }

  await logAuditEvent({
    acao: "titulo_pagar.data_repactuada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: d.id,
    metadata: {
      descricao: avulsa.descricao,
      data_anterior: avulsa.data_pagamento,
      data_nova: d.data_pagamento,
    },
  });

  revalidarFinanceiro();
  return { ok: true };
}

// ---------------------------------------------------------------------
// Estornar a baixa de uma parcela
// ---------------------------------------------------------------------

const motivoEstornoSchema = z
  .string()
  .trim()
  .min(10, "Motivo precisa ter pelo menos 10 caracteres.")
  .max(500, "Motivo passa de 500 caracteres.");

const estornoSchema = z.object({
  /** Id da PARCELA — o estorno tem a mesma granularidade da baixa. */
  parcela_id: z.string().uuid(),
  motivo: motivoEstornoSchema,
});

const estornoTituloSchema = z.object({
  origem: origemSchema,
  /** Id da parcela (origem `pp`) ou da conta avulsa (demais origens) —
   *  o mesmo par que `darBaixaTitulo` recebe. */
  id: z.string().uuid(),
  motivo: motivoEstornoSchema,
});

/**
 * Estorna a baixa de UMA parcela de PP.
 *
 * Decisão do Tiago (18/08/2026): "as PPs sempre chegarão por parcela no
 * contas a pagar e cada baixa ou estorno deverá ser feito por parcela;
 * quanto à aprovação, essa deverá ser feita por PP". Esta action é a
 * metade que faltava — a antiga `estornarBaixaPP` revertia a PP inteira
 * e foi removida.
 *
 * ⚠️ Continua SEM PORTA NA UI, como a decisão 016 determinou: o
 * protótipo não tem estorno em lugar nenhum. O que muda é que, no dia em
 * que ele voltar, a semântica está certa. Ver `cancelar-baixa-modal.tsx`.
 */
export async function estornarBaixaParcela(input: unknown): Promise<Result> {
  const parsed = estornoSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  const gate = await checarGateFinanceiro(
    "pedido_compra",
    d.parcela_id,
    "pedido_compra.parcela_baixa_estornada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: parcela } = await supabase
    .from("pedidos_compra_parcelas")
    .select(
      "id, numero, valor, pago_em, pedido:pedidos_compra!inner(id, codigo, job_id)",
    )
    .eq("id", d.parcela_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      numero: number;
      valor: string | number;
      pago_em: string | null;
      pedido: { id: string; codigo: string; job_id: string } | null;
    }>();

  if (!parcela) return { ok: false, message: "Parcela não encontrada." };
  if (!parcela.pago_em) {
    return { ok: false, message: "Esta parcela não está paga." };
  }

  const { data: reversoId, error } = await supabase.rpc(
    "estornar_baixa_pp_parcela",
    {
      p_parcela_id: d.parcela_id,
      p_motivo: d.motivo,
      p_criado_por: session.profile.id,
    },
  );

  if (error) {
    console.error("[titulos.estorno.parcela]", error.message);
    return { ok: false, message: mensagemDeBaixa(error.message) };
  }

  await logAuditEvent({
    acao: "pedido_compra.parcela_baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "pedido_compra",
    entidadeId: parcela.pedido?.id ?? null,
    metadata: {
      pp_codigo: parcela.pedido?.codigo,
      parcela_id: parcela.id,
      parcela_numero: parcela.numero,
      valor: Number(parcela.valor),
      motivo: d.motivo,
      lancamento_reverso_id: reversoId,
    },
  });

  await logAuditEvent({
    acao: "lancamento_financeiro.estornado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "lancamento_financeiro",
    entidadeId: (reversoId as string) ?? null,
    metadata: {
      origem: "pp_estorno",
      pp_codigo: parcela.pedido?.codigo,
      parcela_numero: parcela.numero,
      motivo: d.motivo,
    },
  });

  revalidarFinanceiro(parcela.pedido?.job_id);
  return { ok: true };
}

/**
 * Estorna a baixa de um TÍTULO, seja qual for a origem.
 *
 * É a irmã de `darBaixaTitulo`, com a mesma assinatura `{origem, id}`:
 * a aba unificada não deve saber que por baixo existem duas tabelas.
 * Origem `pp` cai no estorno por parcela; `avulso` e `recorrencia` caem
 * no estorno da `contas_avulsas`, que sempre foi por lançamento.
 *
 * Religado na UI em 18/08/2026, a pedido do Tiago: título pago abre o
 * mesmo formulário da baixa, agora em leitura, com o botão de estornar
 * dentro dele. A decisão 016 tinha tirado o estorno da tela seguindo o
 * protótipo; esta decisão a substitui.
 */
export async function estornarBaixaTitulo(input: unknown): Promise<Result> {
  const parsed = estornoTituloSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Entrada inválida.",
    };
  }
  const d = parsed.data;

  if (d.origem === "pp") {
    return estornarBaixaParcela({ parcela_id: d.id, motivo: d.motivo });
  }

  if (d.origem === "desembolso") {
    return estornarBaixaDesembolsoParcela(d.id, d.motivo);
  }

  const { estornarBaixaAvulsa } = await import("./actions-avulsas");
  return estornarBaixaAvulsa({ conta_avulsa_id: d.id, motivo: d.motivo });
}

/**
 * Estorna a baixa de UMA parcela de desembolso.
 *
 * Mesmo padrão de `estornarBaixaParcela` mas chamando a RPC
 * `estornar_baixa_desembolso_parcela`.
 */
async function estornarBaixaDesembolsoParcela(
  parcelaId: string,
  motivo: string,
): Promise<Result> {
  const gate = await checarGateFinanceiro(
    "desembolso",
    parcelaId,
    "desembolso.parcela_baixa_estornada",
  );
  if (!gate.ok) return gate;
  const { session, supabase } = gate;

  const { data: parcela } = await supabase
    .from("desembolsos_parcelas")
    .select(
      "id, numero, valor, pago_em, desembolso:desembolsos!inner(id, codigo)",
    )
    .eq("id", parcelaId)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<{
      id: string;
      numero: number;
      valor: string | number;
      pago_em: string | null;
      desembolso: { id: string; codigo: string } | null;
    }>();

  if (!parcela) return { ok: false, message: "Parcela não encontrada." };
  if (!parcela.pago_em) {
    return { ok: false, message: "Esta parcela não está paga." };
  }

  const { data: reversoId, error } = await supabase.rpc(
    "estornar_baixa_desembolso_parcela",
    {
      p_parcela_id: parcelaId,
      p_motivo: motivo,
      p_criado_por: session.profile.id,
    },
  );

  if (error) {
    console.error("[titulos.estorno.desembolso]", error.message);
    return { ok: false, message: mensagemDeBaixa(error.message) };
  }

  await logAuditEvent({
    acao: "desembolso.parcela_baixa_estornada",
    tenantId: session.activeTenant.id,
    entidadeTipo: "desembolso",
    entidadeId: parcela.desembolso?.id ?? null,
    metadata: {
      codigo: parcela.desembolso?.codigo,
      parcela_id: parcela.id,
      parcela_numero: parcela.numero,
      valor: Number(parcela.valor),
      motivo,
      lancamento_reverso_id: reversoId,
    },
  });

  await logAuditEvent({
    acao: "lancamento_financeiro.estornado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "lancamento_financeiro",
    entidadeId: (reversoId as string) ?? null,
    metadata: {
      origem: "desembolso_estorno",
      codigo: parcela.desembolso?.codigo,
      parcela_numero: parcela.numero,
      motivo,
    },
  });

  revalidarFinanceiro();
  return { ok: true };
}
