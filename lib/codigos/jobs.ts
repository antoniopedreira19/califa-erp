import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Código sequencial `JOB-NNNN` (4 dígitos zero-padded): o MAIOR número já
 * usado no tenant + 1.
 *
 * ⚠️ Até 14/09/2026 era a CONTAGEM de jobs + 1. Com job apagado a contagem
 * fica abaixo do maior código, e o próximo código calculado já existia: o
 * tenant tinha 9 jobs (JOB-0007 a 0010, 0024, 0025, 0029, 0031 e 0033), e
 * todo envio para abertura tentava o JOB-0010 e caía no unique. Código de
 * job apagado não volta a ser usado — ele pode estar em documento antigo
 * (Tiago, 14/09/2026).
 *
 * Sujeito a race condition entre dois envios simultâneos — o unique index
 * (tenant_id, codigo) captura a colisão, e a tela pede para tentar de novo.
 */
export function proximoCodigoDeJob(codigos: string[]): string {
  let maior = 0;
  for (const codigo of codigos) {
    const m = /^JOB-(\d+)$/.exec(codigo);
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `JOB-${(maior + 1).toString().padStart(4, "0")}`;
}

export async function gerarCodigoJob(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string> {
  // Só a coluna do código: é uma leitura leve mesmo com milhares de jobs,
  // e o maior número não sai de ordenação por texto (JOB-10000 < JOB-9999).
  const { data, error } = await supabase
    .from("jobs")
    .select("codigo")
    .eq("tenant_id", tenantId)
    .like("codigo", "JOB-%");

  if (error) {
    throw new Error(`Falha ao ler os códigos de job: ${error.message}`);
  }

  return proximoCodigoDeJob(
    ((data ?? []) as { codigo: string }[]).map((j) => j.codigo),
  );
}
