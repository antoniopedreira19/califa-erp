import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Dimensões que alimentam os dropdowns e o `resolveRotulo` do relatório.
 *
 * Estas 4 tabelas mudam RARO durante uma sessão de uso do relatório
 * (novo cliente ou marca acontece uma ou duas vezes por semana). Sem
 * cache, elas re-carregavam a cada troca de filtro, pagando 4 round-trips
 * ao Supabase por request.
 *
 * `unstable_cache` guarda o resultado por tenant, com TTL curto (5 min).
 * Usamos `service client` porque `unstable_cache` não permite ler
 * `cookies()` — como filtramos por `tenant_id` explícito e keying por
 * `tenantId`, isolamento entre tenants é preservado.
 *
 * Invalidação sob demanda: quando cliente/marca/empresa/regional é
 * criado ou editado, chame `revalidateTag(\`tenant-${tenantId}-dimensoes\`)`
 * na server action correspondente. Enquanto isso não estiver plumado, o
 * TTL de 5 min garante que mudanças aparecem sem F5 dentro desse limite.
 */
export interface DimensoesRelatorio {
  clientes: { id: string; nome: string }[];
  marcas: { id: string; nome: string; clienteId: string }[];
  empresas: { id: string; nome: string }[];
  regionais: { id: string; nome: string }[];
}

async function buscarDimensoes(tenantId: string): Promise<DimensoesRelatorio> {
  const supabase = createServiceClient();

  const [clientesRes, marcasRes, empresasRes, regionaisRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo"),
    supabase
      .from("cliente_produtos")
      .select("id, nome, cliente_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("empresas")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("regionais")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
  ]);

  const nomeCliente = (c: {
    nome_fantasia: string | null;
    razao_social: string;
  }) => c.nome_fantasia ?? c.razao_social;

  return {
    clientes: (clientesRes.data ?? []).map((c) => ({
      id: c.id,
      nome: nomeCliente(c),
    })),
    marcas: (marcasRes.data ?? []).map((m) => ({
      id: m.id,
      nome: m.nome as string,
      clienteId: m.cliente_id as string,
    })),
    empresas: (empresasRes.data ?? []).map((e) => ({
      id: e.id,
      nome: nomeCliente(e),
    })),
    regionais: (regionaisRes.data ?? []).map((r) => ({
      id: r.id,
      nome: r.nome as string,
    })),
  };
}

export function carregarDimensoesRelatorio(
  tenantId: string,
): Promise<DimensoesRelatorio> {
  return unstable_cache(
    () => buscarDimensoes(tenantId),
    ["relatorios-rentabilidade-dimensoes", tenantId],
    { revalidate: 300, tags: [`tenant-${tenantId}-dimensoes`] },
  )();
}
