import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * As listas dos campos Marca, Empresa e Regional do registro da abertura
 * (decisão 214). Uma onda só, em paralelo, para entrar no `Promise.all`
 * de quem chama (docs/PERFORMANCE.md).
 */

export interface MarcaDoRegistro {
  id: string;
  nome: string;
  codigo: string;
  /** A marca geral do cliente (PRD-01, decisão 133). */
  padrao: boolean;
}

export interface EmpresaDoRegistro {
  id: string;
  nome: string;
}

export interface RegionalDoRegistro {
  id: string;
  nome: string;
  empresa_id: string;
}

export interface OpcoesDoRegistro {
  /** As marcas ativas do cliente do job — e a do job, se foi inativada. */
  marcas: MarcaDoRegistro[];
  /** Quantas marcas o cliente tem no cadastro, inativas inclusive: é o que
   *  dá o código da próxima (PRD-NN). */
  marcasNoCadastro: number;
  empresas: EmpresaDoRegistro[];
  /** As regionais ativas de projeto, de todas as empresas: a tela filtra
   *  pela empresa escolhida. */
  regionais: RegionalDoRegistro[];
}

export async function carregarOpcoesDoRegistro(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  clienteId: string | null,
  marcaDoJobId: string | null,
): Promise<OpcoesDoRegistro> {
  const [marcasRes, empresasRes, regionaisRes] = await Promise.all([
    clienteId
      ? supabase
          .from("cliente_produtos")
          .select("id, nome, codigo, padrao, ativo")
          .eq("tenant_id", tenantId)
          .eq("cliente_id", clienteId)
          .order("codigo")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("empresas")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("razao_social"),
    supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .eq("disponivel_em_projetos", true)
      .order("nome"),
  ]);

  if (marcasRes.error) console.error("[abertura.registro.marcas]", marcasRes.error.message);
  if (empresasRes.error) console.error("[abertura.registro.empresas]", empresasRes.error.message);
  if (regionaisRes.error) console.error("[abertura.registro.regionais]", regionaisRes.error.message);

  const todasAsMarcas = (marcasRes.data ?? []) as any[];
  return {
    marcas: todasAsMarcas
      .filter((m) => m.ativo || m.id === marcaDoJobId)
      .map((m) => ({
        id: m.id as string,
        nome: m.nome as string,
        codigo: m.codigo as string,
        padrao: m.padrao === true,
      })),
    marcasNoCadastro: todasAsMarcas.length,
    empresas: ((empresasRes.data ?? []) as any[]).map((e) => ({
      id: e.id as string,
      nome: (e.nome_fantasia ?? e.razao_social) as string,
    })),
    regionais: ((regionaisRes.data ?? []) as any[]).map((r) => ({
      id: r.id as string,
      nome: r.nome as string,
      empresa_id: r.empresa_id as string,
    })),
  };
}
