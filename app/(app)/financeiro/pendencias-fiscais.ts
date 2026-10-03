import { createClient } from "@/lib/supabase/server";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { calcularApuracao, estadoDaGuia } from "@/lib/fiscal/apuracao";
import { carregarFatosFiscais } from "@/lib/fiscal/apuracao-fatos";
import { addDias } from "@/lib/fiscal/datas";

/**
 * O que pede atenção no fiscal (módulo fiscal, entrega 2 — 02/10/2026),
 * para o cartão "Fiscal" da Central: as guias a aprovar na Apuração e os
 * impostos a pagar que vencem nos próximos 7 dias ou já venceram.
 *
 * Os impostos são duas contagens baratas (`count`, índice
 * `idx_impostos_a_pagar_lista`). As guias a aprovar exigem o cálculo da
 * Apuração (os fatos fiscais e o motor) — por isso o cartão é montado num
 * `Suspense` da página: a Central abre na hora e o cartão chega quando a
 * conta termina. Falha no cálculo das guias não derruba o cartão: ele mostra
 * só os impostos.
 */
export interface PendenciasFiscais {
  guiasAAprovar: number | null;
  vencendo: number;
  vencidos: number;
}

export async function carregarPendenciasFiscais(tenantId: string): Promise<PendenciasFiscais> {
  const supabase = createClient();
  const hoje = hojeEmSaoPauloIso();
  const [vencendoRes, vencidosRes, fatos] = await Promise.all([
    supabase
      .from("impostos_a_pagar")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "a_pagar")
      .gte("vencimento", hoje)
      .lte("vencimento", addDias(hoje, 7)),
    supabase
      .from("impostos_a_pagar")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("status", "a_pagar")
      .lt("vencimento", hoje),
    carregarFatosFiscais(supabase, tenantId).catch((e: unknown) => {
      console.error("[central.fiscal]", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  if (vencendoRes.error) console.error("[central.fiscal.vencendo]", vencendoRes.error.message);
  if (vencidosRes.error) console.error("[central.fiscal.vencidos]", vencidosRes.error.message);

  let guiasAAprovar: number | null = null;
  if (fatos) {
    try {
      guiasAAprovar = calcularApuracao(fatos.cadastro, fatos.fatos, hoje, fatos.aprovacoes).filter((g) => {
        const { estado } = estadoDaGuia(g, hoje, fatos.aprovacoes);
        return estado === "a_aprovar" || estado === "diferenca";
      }).length;
    } catch (e) {
      console.error("[central.fiscal.apuracao]", e instanceof Error ? e.message : e);
    }
  }
  return { guiasAAprovar, vencendo: vencendoRes.count ?? 0, vencidos: vencidosRes.count ?? 0 };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "2 guias a aprovar · 1 imposto vence em 7 dias · 1 imposto vencido" (só o que tem). */
export function detalheFiscal(p: PendenciasFiscais): string {
  return [
    (p.guiasAAprovar ?? 0) > 0 && plural(p.guiasAAprovar ?? 0, "guia a aprovar", "guias a aprovar"),
    p.vencendo > 0 && `${plural(p.vencendo, "imposto vence", "impostos vencem")} em 7 dias`,
    p.vencidos > 0 && plural(p.vencidos, "imposto vencido", "impostos vencidos"),
  ]
    .filter(Boolean)
    .join(" · ");
}
