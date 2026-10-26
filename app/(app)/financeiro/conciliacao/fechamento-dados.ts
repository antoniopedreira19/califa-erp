/**
 * A leitura do fechamento da conciliação de uma conta (decisão 205): os
 * registros (o ativo e o histórico, com quem fechou e quem reabriu) e, na
 * aba Conciliação automática, as condições do botão "Fechar a conciliação
 * até dd/mm", pela mesma função do banco que `fechar_conciliacao` confere.
 * As duas leituras correm juntas.
 */

import type { createClient } from "@/lib/supabase/server";
import type { CondicoesDoFechamento, ConciliacaoFechamento } from "@/lib/types";
import { SEM_FECHAMENTO, type FechamentoDaConta, type RegistroDoFechamento } from "@/lib/conciliacao/fechamento";

type Supabase = ReturnType<typeof createClient>;

type RegistroCru = Pick<
  ConciliacaoFechamento,
  "id" | "ate" | "fechado_em" | "reaberto_em" | "motivo_reabertura" | "ativo"
> & {
  // Duas FKs para `profiles`: o embed diz a coluna.
  fechador: { nome: string | null } | null;
  reabridor: { nome: string | null } | null;
};

export async function carregarFechamentoDaConciliacao(
  supabase: Supabase,
  args: { tenantId: string; contaId: string; comCondicoes: boolean },
): Promise<FechamentoDaConta> {
  const [registrosRes, condicoesRes] = await Promise.all([
    supabase
      .from("conciliacao_fechamentos")
      .select(
        "id, ate, fechado_em, reaberto_em, motivo_reabertura, ativo, " +
          "fechador:profiles!fechado_por(nome), reabridor:profiles!reaberto_por(nome)",
      )
      .eq("tenant_id", args.tenantId)
      .eq("conta_bancaria_id", args.contaId)
      .order("fechado_em", { ascending: true })
      .returns<RegistroCru[]>(),
    args.comCondicoes
      ? supabase.rpc("condicoes_do_fechamento", { p_conta_id: args.contaId })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (registrosRes.error) {
    console.error("[conciliacao.fechamento]", registrosRes.error.message);
    return SEM_FECHAMENTO;
  }
  if (condicoesRes.error) console.error("[conciliacao.fechamento.condicoes]", condicoesRes.error.message);

  const registros: RegistroDoFechamento[] = (registrosRes.data ?? []).map((r) => ({
    id: r.id,
    ate: r.ate,
    fechadoEm: r.fechado_em,
    fechadoPor: r.fechador?.nome ?? "—",
    reabertoEm: r.reaberto_em,
    reabertoPor: r.reaberto_em ? (r.reabridor?.nome ?? "—") : null,
    motivo: r.motivo_reabertura,
    ativo: r.ativo,
  }));
  const c = condicoesRes.data as CondicoesDoFechamento | null;
  return {
    ativo: registros.find((r) => r.ativo) ?? null,
    ultimo: registros.length ? registros[registros.length - 1] : null,
    registros,
    condicoes: c
      ? {
          ate: c.ate,
          linhas_pendentes: c.linhas_pendentes,
          sem_linha: c.sem_linha,
          saldo_banco: c.saldo_banco === null || c.saldo_banco === undefined ? null : Number(c.saldo_banco),
          saldo_sistema: c.saldo_sistema === undefined ? undefined : Number(c.saldo_sistema),
          diferenca: c.diferenca === null || c.diferenca === undefined ? null : Number(c.diferenca),
        }
      : null,
  };
}
