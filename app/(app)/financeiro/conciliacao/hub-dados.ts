/**
 * Leitura da página inicial da Conciliação (decisão 091).
 *
 * Os agregados vêm da função `conciliacao_resumo_contas` — uma linha por
 * conta, somada no Postgres. Ler `lancamentos_financeiros` inteiro para
 * somar no Node é o anti-padrão de `docs/PERFORMANCE.md`.
 *
 * A conta-espelho do CARTÃO fica de fora: conciliação bancária bate com
 * extrato de banco, e fatura de cartão é passivo, não saldo. Contas a
 * Pagar, Contas a Receber, o detalhe da avulsa e o Fluxo de caixa já a
 * filtram do mesmo jeito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContaBancaria, EmpresaContabil } from "@/lib/types";
import {
  faixaDoPeriodo,
  type ContaResumo,
  type PeriodoChave,
  type TotaisConciliacao,
} from "./hub-periodo";

export type DadosDoHub = {
  contas: ContaResumo[];
  periodo: { chave: PeriodoChave; de: string; ate: string; label: string };
  /** Consolidado das contas ATIVAS (decisão 091): conta inativa é
   *  liquidada antes de ser inativada, e saldo residual esquecido não
   *  deve inflar o total da agência. */
  totais: TotaisConciliacao;
  /** O que ficou de fora do consolidado, para a tela poder dizer. */
  inativas: { contas: number; saldo: number };
};

export async function carregarHub(
  supabase: SupabaseClient,
  tenantId: string,
  chave: PeriodoChave,
): Promise<DadosDoHub> {
  const periodo = { chave, ...faixaDoPeriodo(chave) };

  const [contasRes, resumoRes, contabeisRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", tenantId)
      .neq("tipo", "cartao_credito")
      .order("ativo", { ascending: false })
      .order("ordem")
      .order("nome")
      .returns<ContaBancaria[]>(),
    supabase.rpc("conciliacao_resumo_contas", {
      p_tenant_id: tenantId,
      p_de: periodo.de,
      p_ate: periodo.ate,
    }),
    supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", tenantId)
      .returns<Pick<EmpresaContabil, "id" | "razao_social" | "nome_fantasia">[]>(),
  ]);

  // O erro é LIDO: sem isto, um engano na consulta vira "nenhuma conta
  // cadastrada", que é indistinguível de um tenant sem conta nenhuma.
  if (contasRes.error) console.error("[conciliacao.hub.contas]", contasRes.error.message);
  if (resumoRes.error) console.error("[conciliacao.hub.resumo]", resumoRes.error.message);
  if (contabeisRes.error) console.error("[conciliacao.hub.contabeis]", contabeisRes.error.message);

  type ResumoRow = {
    conta_id: string;
    saldo_atual: string | number;
    creditos_periodo: string | number;
    debitos_periodo: string | number;
    lancamentos_periodo: number;
    ultimo_movimento: string | null;
  };
  const resumoPorConta = new Map(
    ((resumoRes.data ?? []) as ResumoRow[]).map((r) => [r.conta_id, r]),
  );

  const empresaPorId = new Map(
    (contabeisRes.data ?? []).map((e) => [
      e.id,
      e.nome_fantasia ?? e.razao_social,
    ]),
  );

  const contas: ContaResumo[] = (contasRes.data ?? []).map((c) => {
    const r = resumoPorConta.get(c.id);
    const agencia = c.agencia?.trim() || null;
    const numero = c.numero_conta?.trim() || null;
    return {
      id: c.id,
      nome: c.nome,
      banco: c.banco,
      tipo: c.tipo,
      agenciaConta:
        agencia && numero ? `${agencia} / ${numero}` : agencia ?? numero,
      empresaContabil: empresaPorId.get(c.empresa_contabil_id) ?? "—",
      ativa: c.ativo,
      saldoAtual: Number(r?.saldo_atual ?? c.saldo_inicial),
      creditosPeriodo: Number(r?.creditos_periodo ?? 0),
      debitosPeriodo: Number(r?.debitos_periodo ?? 0),
      lancamentosPeriodo: r?.lancamentos_periodo ?? 0,
      ultimoMovimento: r?.ultimo_movimento ?? null,
    };
  });

  const ativas = contas.filter((c) => c.ativa);
  const inativas = contas.filter((c) => !c.ativa);

  return {
    contas,
    periodo,
    totais: {
      saldo: ativas.reduce((a, c) => a + c.saldoAtual, 0),
      creditos: ativas.reduce((a, c) => a + c.creditosPeriodo, 0),
      debitos: ativas.reduce((a, c) => a + c.debitosPeriodo, 0),
      contas: ativas.length,
      lancamentos: ativas.reduce((a, c) => a + c.lancamentosPeriodo, 0),
    },
    inativas: {
      contas: inativas.length,
      saldo: inativas.reduce((a, c) => a + c.saldoAtual, 0),
    },
  };
}
