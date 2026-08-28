"use server";

/**
 * Estornar uma compra do cartão.
 *
 * Devolução de compra, cancelamento de assinatura, cobrança indevida
 * reconhecida pela operadora: o cartão recebe crédito. O estorno nasce
 * como uma conta avulsa de natureza `entrada`, apontando para a compra —
 * como a devolução de verba aponta para a PP.
 *
 * ⚠️ Quase nada é decidido aqui. Empresa, plano de contas, job,
 * fornecedor e cliente são COPIADOS da compra pelo gatilho
 * `avulsa_estorno_herda_da_compra`, no banco, e o teto do valor é
 * validado lá também. Esta action escolhe o cartão e a descrição, cuida
 * do gate de permissão e da auditoria; o resto é do banco, porque
 * estorno com plano de contas diferente do da compra não se anula no DRE
 * e essa é a única razão de ele existir.
 *
 * ⚠️ O estorno aponta para a COMPRA, nunca para a parcela. Uma compra em
 * 3x estornada por inteiro é UM estorno do valor cheio; as parcelas já
 * pagas continuam pagas e o crédito cai na fatura aberta do dia.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/auth/audit";

type Result = { ok: true; id: string } | { ok: false; message: string };

/** O que precisamos da compra. O resto o gatilho copia sozinho. */
interface CompraRow {
  id: string;
  codigo: string | null;
  descricao: string;
  valor: number;
  empresa_id: string;
  cartao_credito_id: string | null;
  forma_pagamento: string | null;
  estorno_de_avulsa_id: string | null;
  plano_conta_tipo_id: string;
  plano_conta_subtipo_id: string;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const schema = z.object({
  compra_id: z.string().uuid(),
  valor: z
    .number({ invalid_type_error: "Informe o valor do estorno." })
    .positive("O valor do estorno precisa ser maior que zero."),
  /** Dia em que o crédito caiu. É ele que escolhe a fatura. */
  data_estorno: z
    .string()
    .regex(dateRegex, "Data em YYYY-MM-DD.")
    .nullable()
    .default(null),
  descricao: z.string().trim().max(500).nullable().default(null),
});

export async function estornarCompraCartao(input: unknown): Promise<Result> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }
  const d = parsed.data;

  const session = await requireSession();

  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    await logAuditEvent({
      acao: "acao_negada",
      tenantId: session.activeTenant.id,
      entidadeTipo: "conta_avulsa",
      entidadeId: d.compra_id,
      metadata: {
        acao_tentada: "cartao.estorno_lancado",
        motivo: "sem_permissao_financeira",
      },
    });
    return {
      ok: false,
      message: "Apenas admin ou financeiro pode lançar estorno.",
    };
  }

  const supabase = createClient();

  const { data: compra } = await supabase
    .from("contas_avulsas")
    .select(
      "id, codigo, descricao, valor, empresa_id, cartao_credito_id, " +
        "forma_pagamento, estorno_de_avulsa_id, plano_conta_tipo_id, " +
        "plano_conta_subtipo_id, fornecedor_id, cliente_id, job_id",
    )
    .eq("id", d.compra_id)
    .eq("tenant_id", session.activeTenant.id)
    .maybeSingle<CompraRow>();

  if (!compra) return { ok: false, message: "Compra não encontrada." };

  // O banco recusa isto também. A checagem aqui existe só para a
  // mensagem chegar antes de o formulário ser enviado.
  if (compra.forma_pagamento !== "cartao_credito" || !compra.cartao_credito_id) {
    return {
      ok: false,
      message: "Só compra feita no cartão pode ser estornada por aqui.",
    };
  }
  if (compra.estorno_de_avulsa_id) {
    return {
      ok: false,
      message: "Não se estorna um estorno. Aponte para a compra original.",
    };
  }

  const { data: codigo, error: errCodigo } = await supabase.rpc(
    "gerar_codigo_avulsa",
    { p_tenant_id: session.activeTenant.id },
  );
  if (errCodigo) console.error("[estorno.codigo]", errCodigo.message);

  const descricao =
    d.descricao?.trim() ||
    `Estorno · ${compra.codigo ?? ""} ${compra.descricao}`.trim().slice(0, 500);

  const { data: estorno, error } = await supabase
    .from("contas_avulsas")
    .insert({
      tenant_id: session.activeTenant.id,
      codigo: (codigo as string | null) ?? null,
      descricao,
      valor: d.valor,
      // A avulsa nasce aprovada — quem cria é admin ou financeiro, que é
      // quem aprovaria depois.
      aprovada_em: new Date().toISOString(),
      aprovada_por: session.profile.id,
      criado_por: session.profile.id,
      forma_pagamento: "cartao_credito",
      cartao_credito_id: compra.cartao_credito_id,
      estorno_de_avulsa_id: compra.id,
      data_compra: d.data_estorno,
      // Daqui para baixo, o gatilho sobrescreve com os valores da compra.
      // Mandamos assim mesmo porque as colunas são NOT NULL e o insert
      // precisa passar pelo PostgREST antes de o gatilho rodar.
      natureza: "entrada",
      empresa_id: compra.empresa_id,
      plano_conta_tipo_id: compra.plano_conta_tipo_id,
      plano_conta_subtipo_id: compra.plano_conta_subtipo_id,
      fornecedor_id: compra.fornecedor_id,
      cliente_id: compra.cliente_id,
      job_id: compra.job_id,
    })
    .select("id")
    .single();

  if (error || !estorno) {
    console.error("[cartao.estorno]", error?.message);
    // A mensagem do banco já diz quanto sobra para estornar — é mais útil
    // que qualquer texto genérico aqui.
    return { ok: false, message: limparMensagem(error?.message ?? "") };
  }

  // O rateio de regional acompanha o da compra: sem ele o estorno some da
  // coluna Regional da Conciliação enquanto a compra aparece nela.
  const { data: rateio } = await supabase
    .from("contas_avulsas_regionais")
    .select("regional_id, percentual")
    .eq("conta_avulsa_id", compra.id);

  if (rateio && rateio.length > 0) {
    const { error: errRateio } = await supabase
      .from("contas_avulsas_regionais")
      .insert(
        rateio.map((r) => ({
          tenant_id: session.activeTenant.id,
          conta_avulsa_id: estorno.id,
          regional_id: r.regional_id,
          percentual: r.percentual,
        })),
      );
    if (errRateio) {
      // Não derruba o estorno: ele é íntegro sem o rateio, e perder o
      // crédito por causa de um rótulo seria pior.
      console.error("[cartao.estorno.rateio]", errRateio.message);
    }
  }

  await logAuditEvent({
    acao: "cartao.estorno_lancado",
    tenantId: session.activeTenant.id,
    entidadeTipo: "conta_avulsa",
    entidadeId: estorno.id,
    metadata: {
      compra_id: compra.id,
      compra_codigo: compra.codigo,
      valor: d.valor,
      valor_da_compra: Number(compra.valor),
    },
  });

  revalidatePath("/financeiro/contas-a-pagar");
  revalidatePath("/financeiro/conciliacao");
  return { ok: true, id: estorno.id };
}

/** O Postgres prefixa a mensagem; o usuário só quer a frase. */
function limparMensagem(msg: string): string {
  return (
    msg.replace(/^.*?(?:ERROR|error):\s*/i, "").trim() ||
    "Falha ao lançar o estorno."
  );
}
