"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/auth/audit";
import { createClient } from "@/lib/supabase/server";
import type {
  ColaboradorFeriasPeriodo,
  TipoContratacao,
} from "@/lib/types";

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const ANTECEDENCIA_MINIMA_DIAS = 5; // Decisão F13

// ---------- Validação ----------

const solicitarSchema = z
  .object({
    tipo: z.enum(["usufruto", "abono_avulso", "misto"]),
    periodo_id: z.string().uuid().nullable(),
    data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de início inválida."),
    data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fim inválida."),
    observacao: z.string().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const ini = new Date(data.data_inicio + "T00:00:00");
    const fim = new Date(data.data_fim + "T00:00:00");
    if (fim < ini) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_fim"],
        message: "A data de fim precisa ser igual ou posterior à data de início.",
      });
    }
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const minimo = new Date(hoje);
    minimo.setDate(hoje.getDate() + ANTECEDENCIA_MINIMA_DIAS);
    if (ini < minimo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data_inicio"],
        message: `A solicitação precisa ser feita com pelo menos ${ANTECEDENCIA_MINIMA_DIAS} dias de antecedência.`,
      });
    }
    // abono_avulso não vincula a período
    if (data.tipo === "abono_avulso" && data.periodo_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodo_id"],
        message: "Abono avulso não é vinculado a um período aquisitivo específico.",
      });
    }
    // usufruto e misto PRECISAM de período
    if ((data.tipo === "usufruto" || data.tipo === "misto") && !data.periodo_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodo_id"],
        message: "Escolha o período aquisitivo das férias.",
      });
    }
  });

function diasEntre(iniStr: string, fimStr: string): number {
  const ini = new Date(iniStr + "T00:00:00");
  const fim = new Date(fimStr + "T00:00:00");
  return Math.floor((fim.getTime() - ini.getTime()) / 86_400_000) + 1;
}

// ---------- Server action: solicitar ----------

export async function solicitarFerias(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = solicitarSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Dados inválidos.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const dados = parsed.data;

  const supabase = createClient();

  // Busca colaborador vinculado ao user atual
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tenant_id, tipo_contratacao, lider_id")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!colab) {
    return {
      ok: false,
      message:
        "Seu login não está vinculado a um colaborador. Procure o RH para fazer o vínculo.",
    };
  }

  // Regra de negócio: abono_avulso é só para PJ (modelo California, F3).
  // CLT clássico tem abono_combinado (= abono dentro do bloco de férias),
  // modelado em UI futura. Hoje bloqueamos abono_avulso para CLT.
  const tipoColab = colab.tipo_contratacao as TipoContratacao;
  if (dados.tipo === "abono_avulso" && tipoColab === "clt") {
    return {
      ok: false,
      message:
        "Abono avulso só é disponível para PJ. Como CLT, você vende abono junto do gozo de férias.",
      fieldErrors: { tipo: ["Abono avulso indisponível para CLT."] },
    };
  }

  const dias = diasEntre(dados.data_inicio, dados.data_fim);
  if (dias <= 0 || dias > 30) {
    return {
      ok: false,
      message: "A solicitação precisa ter entre 1 e 30 dias.",
      fieldErrors: { data_fim: ["Período inválido."] },
    };
  }

  // Se é usufruto/misto, confere saldo do período informado
  let periodo: ColaboradorFeriasPeriodo | null = null;
  if (dados.periodo_id) {
    const { data: p } = await supabase
      .from("colaboradores_ferias_periodos")
      .select("*")
      .eq("id", dados.periodo_id)
      .eq("colaborador_id", colab.id)
      .maybeSingle();

    if (!p) {
      return {
        ok: false,
        message: "Período aquisitivo não encontrado.",
      };
    }

    periodo = p as ColaboradorFeriasPeriodo;

    if (
      periodo.status !== "apto" &&
      periodo.status !== "em_alerta" &&
      periodo.status !== "vencido"
    ) {
      return {
        ok: false,
        message:
          "Este período aquisitivo não está disponível para solicitação (status: " +
          periodo.status +
          ").",
        fieldErrors: { periodo_id: ["Período indisponível."] },
      };
    }

    // Soma dias de lançamentos aprovados + pendentes/em análise do período
    const { data: outrosLancs } = await supabase
      .from("colaboradores_ferias_lancamentos")
      .select("dias, status")
      .eq("periodo_id", periodo.id)
      .in("status", [
        "pendente_aprovacao",
        "em_analise",
        "aprovado",
        "concluido",
      ]);

    const diasOcupados = (outrosLancs ?? []).reduce(
      (acc, l) => acc + ((l as { dias: number }).dias ?? 0),
      0,
    );
    if (diasOcupados + dias > periodo.dias_direito) {
      return {
        ok: false,
        message: `Saldo do período insuficiente: ${diasOcupados} dias já em uso + ${dias} solicitados > ${periodo.dias_direito} de direito.`,
        fieldErrors: { data_fim: ["Dias excedem o saldo do período."] },
      };
    }
  }

  // Insere o lançamento com status pendente_aprovacao
  const { data: lanc, error: insErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .insert({
      tenant_id: colab.tenant_id,
      colaborador_id: colab.id,
      periodo_id: dados.periodo_id,
      tipo: dados.tipo === "misto" ? "usufruto" : dados.tipo,
      data_inicio: dados.data_inicio,
      data_fim: dados.data_fim,
      dias,
      status: "pendente_aprovacao",
      solicitado_por: session.profile.id,
      observacao: dados.observacao || null,
      lancado_direto_por_rh: false,
    })
    .select("id")
    .single();

  if (insErr || !lanc) {
    console.error("[perfil.solicitar.insert]", insErr?.message);
    return {
      ok: false,
      message:
        "Não foi possível registrar sua solicitação. " +
        (insErr?.message ?? ""),
    };
  }

  // Notificação ao RH removida com a limpeza das notificações de férias
  // em 2026-10-03 (migration 20261003000001). Vai renascer no hub central
  // de notificações multi-módulo — ver docs/pendencias/hub-central-notificacoes.md.

  await logAuditEvent({
    acao: "ferias.solicitacao.criada",
    tenantId: colab.tenant_id,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: {
      colaborador_id: colab.id,
      tipo: dados.tipo,
      dias,
      data_inicio: dados.data_inicio,
      data_fim: dados.data_fim,
    },
  });

  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}

// ---------- Server action: editar meus próprios dados ----------

/**
 * Permite que qualquer usuário logado edite os campos "do perfil" do
 * COLABORADOR vinculado ao próprio login. Admin/RH que precisam editar
 * dados estruturais (CPF, admissão, cargo, alocação) usam a tela
 * `/rh/colaboradores/[id]` — essa action não cobre esses campos.
 *
 * Campos permitidos (alinhado com o PO em 2026-10-03):
 *  - Contato: telefone, email_pessoal
 *  - Endereço: cep, logradouro, numero, complemento, bairro, cidade, uf
 *  - Banco: banco_codigo, banco_nome, agencia, agencia_dv, conta,
 *    conta_dv, tipo_conta
 *  - PIX: pix_tipo, pix_chave
 *
 * Qualquer outro campo passado é ignorado.
 */

const UF_SCHEMA = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, "UF inválida (use 2 letras maiúsculas).");

const editarMeuPerfilSchema = z.object({
  // Contato
  telefone: z.string().trim().max(20).optional().nullable(),
  email_pessoal: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email pessoal inválido.")
    .optional()
    .nullable()
    .or(z.literal("")),

  // Endereço
  cep: z.string().trim().max(10).optional().nullable(),
  logradouro: z.string().trim().max(200).optional().nullable(),
  numero: z.string().trim().max(20).optional().nullable(),
  complemento: z.string().trim().max(100).optional().nullable(),
  bairro: z.string().trim().max(100).optional().nullable(),
  cidade: z.string().trim().max(100).optional().nullable(),
  uf: UF_SCHEMA.optional().nullable().or(z.literal("")),

  // Banco
  banco_codigo: z.string().trim().max(10).optional().nullable(),
  banco_nome: z.string().trim().max(100).optional().nullable(),
  agencia: z.string().trim().max(10).optional().nullable(),
  agencia_dv: z.string().trim().max(2).optional().nullable(),
  conta: z.string().trim().max(20).optional().nullable(),
  conta_dv: z.string().trim().max(2).optional().nullable(),
  tipo_conta: z
    .enum(["corrente", "poupanca", "pagamento"])
    .optional()
    .nullable()
    .or(z.literal("")),

  // PIX
  pix_tipo: z
    .enum(["cpf", "cnpj", "email", "telefone", "aleatoria"])
    .optional()
    .nullable()
    .or(z.literal("")),
  pix_chave: z.string().trim().max(200).optional().nullable(),
});

function normalizarVazios<T extends Record<string, unknown>>(obj: T): T {
  // Converte strings vazias em null — simplifica o update no banco.
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = v === "" ? null : v;
  }
  return out as T;
}

export async function editarMeuPerfil(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();

  const parsed = editarMeuPerfilSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Verifique os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const dados = normalizarVazios(parsed.data);

  const supabase = createClient();

  // Carrega o colaborador vinculado ao próprio profile. Essa é a única
  // garantia de autorização: user só edita o próprio.
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id, tenant_id")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!colab) {
    return {
      ok: false,
      message:
        "Seu login não está vinculado a um colaborador. Procure o RH para fazer o vínculo.",
    };
  }

  const { error: updErr } = await supabase
    .from("colaboradores")
    .update(dados)
    .eq("id", colab.id)
    .eq("tenant_id", colab.tenant_id);

  if (updErr) {
    console.error("[perfil.editar.update]", updErr.message);
    return {
      ok: false,
      message: "Não foi possível salvar: " + updErr.message,
    };
  }

  await logAuditEvent({
    acao: "colaborador.editado_pelo_proprio",
    tenantId: colab.tenant_id,
    entidadeTipo: "colaborador",
    entidadeId: colab.id,
    metadata: {
      campos_alterados: Object.keys(dados),
    },
  });

  revalidatePath("/perfil");
  return { ok: true, id: colab.id };
}

// ---------- Server action: cancelar o próprio lançamento ----------

export async function cancelarMinhaSolicitacao(
  lancamentoId: string,
): Promise<ActionResult> {
  const session = await requireSession();

  if (!lancamentoId || typeof lancamentoId !== "string") {
    return { ok: false, message: "ID do lançamento inválido." };
  }

  const supabase = createClient();

  // Confirma propriedade e estado cancelável
  const { data: lanc } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select("id, tenant_id, colaborador_id, status, data_inicio")
    .eq("id", lancamentoId)
    .maybeSingle();

  if (!lanc) {
    return { ok: false, message: "Lançamento não encontrado." };
  }

  // Só pode cancelar o próprio
  const { data: colab } = await supabase
    .from("colaboradores")
    .select("id")
    .eq("user_id", session.profile.id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle();

  if (!colab || colab.id !== lanc.colaborador_id) {
    return {
      ok: false,
      message: "Você não pode cancelar este lançamento.",
    };
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataInicio = new Date(lanc.data_inicio + "T00:00:00");
  const cancelavel =
    lanc.status === "pendente_aprovacao" ||
    (lanc.status === "aprovado" && dataInicio > hoje);

  if (!cancelavel) {
    return {
      ok: false,
      message:
        "Esse lançamento não pode mais ser cancelado por você. Fale com o RH.",
    };
  }

  const { error: updErr } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .update({ status: "cancelado" })
    .eq("id", lanc.id);

  if (updErr) {
    console.error("[perfil.cancelar]", updErr.message);
    return {
      ok: false,
      message: "Não foi possível cancelar: " + updErr.message,
    };
  }

  await logAuditEvent({
    acao: "ferias.solicitacao.cancelada_pelo_colaborador",
    tenantId: lanc.tenant_id,
    entidadeTipo: "ferias_lancamento",
    entidadeId: lanc.id,
    metadata: { status_anterior: lanc.status },
  });

  revalidatePath("/perfil");
  return { ok: true, id: lanc.id };
}
