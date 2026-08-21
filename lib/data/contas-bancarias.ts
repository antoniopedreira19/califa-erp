import { createClient } from "@/lib/supabase/server";

/**
 * Uma conta bancária como o seletor da abertura de job precisa dela:
 * rótulo curto, detalhe (empresa e agência) e saldo de hoje.
 *
 * O saldo vem de `fc_saldos_por_conta` (migration 20260817000006), a
 * mesma função que alimenta o Fluxo de Caixa — nada de recalcular razão
 * aqui e correr o risco de o seletor mostrar um número que a outra tela
 * não confirma.
 */
export interface ContaBancariaOpcao {
  id: string;
  /** "Itaú · c/c 56789-0" — o que fica no botão fechado. */
  rotulo: string;
  /** "Califa Live Marketing · ag 1234" — a segunda linha da opção. */
  detalhe: string;
  saldo: number;
  empresa_id: string;
}

/**
 * Contas ativas do tenant, com saldo de hoje, prontas para o seletor.
 *
 * Duas leituras em paralelo: o cadastro das contas e o saldo de cada uma.
 * `fc_saldos_por_conta` já devolve só as ativas, então o join em memória
 * dá saldo 0 apenas para conta que a RPC não trouxe — situação que não
 * acontece com o filtro `ativo` dos dois lados.
 */
export async function listarContasBancarias(
  tenantId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<ContaBancariaOpcao[]> {
  const supabase = createClient();

  const [contasRes, saldosRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select(
        "id, nome, banco, agencia, numero_conta, tipo, empresa_id, " +
          "empresa:empresas(razao_social, nome_fantasia)",
      )
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("ordem", { ascending: true })
      .order("nome", { ascending: true }),
    supabase.rpc("fc_saldos_por_conta", { p_data: hoje }),
  ]);

  if (contasRes.error) {
    console.error("[contas-bancarias.listar]", contasRes.error.message);
    return [];
  }
  if (saldosRes.error) {
    // Saldo é contexto, não regra: sem ele o seletor ainda funciona.
    console.error("[contas-bancarias.saldos]", saldosRes.error.message);
  }

  const saldoPorConta = new Map<string, number>();
  for (const s of (saldosRes.data ?? []) as {
    conta_bancaria_id: string;
    saldo: number | string;
  }[]) {
    saldoPorConta.set(s.conta_bancaria_id, Number(s.saldo ?? 0));
  }

  return ((contasRes.data ?? []) as any[]).map((c) => {
    const empresa = c.empresa?.nome_fantasia ?? c.empresa?.razao_social ?? null;
    const conta = c.numero_conta ? `${rotuloTipo(c.tipo)} ${c.numero_conta}` : null;

    return {
      id: c.id,
      rotulo: [c.banco, conta].filter(Boolean).join(" · ") || c.nome,
      detalhe:
        [empresa, c.agencia ? `ag ${c.agencia}` : null]
          .filter(Boolean)
          .join(" · ") || c.nome,
      saldo: saldoPorConta.get(c.id) ?? 0,
      empresa_id: c.empresa_id,
    };
  });
}

/**
 * "corrente" → "c/c". O cadastro (conta-bancaria-drawer) guarda o tipo
 * por extenso, em três valores.
 */
function rotuloTipo(tipo: string | null): string {
  if (tipo === "corrente") return "c/c";
  if (tipo === "poupanca") return "c/p";
  if (tipo === "investimento") return "c/inv";
  return "conta";
}
