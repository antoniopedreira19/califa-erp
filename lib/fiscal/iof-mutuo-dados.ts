import type { SupabaseClient } from "@supabase/supabase-js";
import type { MutuoDoIof } from "./iof-mutuo";

/**
 * Os mútuos que entram na Apuração do IOF: só com empresa de fora. Nos mútuos do
 * grupo nada é apurado por enquanto (decisão 230, seguindo os registros).
 */
export async function carregarMutuosDoIof(supabase: SupabaseClient, tenantId: string): Promise<MutuoDoIof[]> {
  const [aberturasRes, mutuosRes, cnpjsRes] = await Promise.all([
    supabase
      .from("mutuos_saldo_abertura")
      .select("credor_empresa_contabil_id, valor, juros_ao_mes, saidas, data_referencia, fornecedor:fornecedores(id, nome)")
      .eq("tenant_id", tenantId)
      .not("devedor_fornecedor_id", "is", null),
    supabase
      .from("transferencias_contas")
      .select(
        `fornecedor_id, valor, juros_ao_mes, transferida_em, conta_origem_id, conta_destino_id,
         fornecedor:fornecedores(nome),
         origem:contas_bancarias!conta_origem_id(empresa_contabil_id),
         destino:contas_bancarias!conta_destino_id(empresa_contabil_id)`,
      )
      .eq("tenant_id", tenantId)
      .eq("tipo", "mutuo")
      .eq("status", "transferida")
      .not("fornecedor_id", "is", null),
    supabase
      .from("empresas_contabeis")
      .select("id, nome_fantasia, razao_social, empresa_gerencial_id, regional_padrao_id, empresa:empresas!empresa_gerencial_id(nome_fantasia, razao_social), regional:regionais!regional_padrao_id(nome)")
      .eq("tenant_id", tenantId),
  ]);
  for (const [nome, res] of [
    ["abertura", aberturasRes],
    ["mútuos", mutuosRes],
    ["cnpjs", cnpjsRes],
  ] as const) {
    if (res.error) throw new Error(`[fiscal.iof_mutuo.${nome}] ${res.error.message}`);
  }

  type Cnpj = {
    id: string;
    nome_fantasia: string | null;
    razao_social: string;
    empresa_gerencial_id: string | null;
    regional_padrao_id: string | null;
    empresa: { nome_fantasia: string | null; razao_social: string } | null;
    regional: { nome: string } | null;
  };
  const cnpjs = new Map(((cnpjsRes.data ?? []) as unknown as Cnpj[]).map((c) => [c.id, c]));

  const pares = new Map<string, MutuoDoIof>();
  const par = (credor: string, foraId: string, foraNome: string): MutuoDoIof | null => {
    const c = cnpjs.get(credor);
    if (!c?.empresa_gerencial_id) return null;
    const chave = `${credor}|${foraId}`;
    let m = pares.get(chave);
    if (!m) {
      m = {
        credor_id: credor,
        credor_nome: c.nome_fantasia ?? c.razao_social,
        empresa_id: c.empresa_gerencial_id,
        empresa_nome: c.empresa?.nome_fantasia ?? c.empresa?.razao_social ?? "—",
        regional_id: c.regional_padrao_id,
        regional_nome: c.regional?.nome ?? null,
        com: foraNome,
        saidas: [],
        devolucoes: [],
      };
      pares.set(chave, m);
    }
    return m;
  };

  for (const a of (aberturasRes.data ?? []) as unknown as Array<{
    credor_empresa_contabil_id: string;
    valor: string | number;
    juros_ao_mes: string | number | null;
    saidas: Array<{ data: string; valor: number }> | null;
    data_referencia: string;
    fornecedor: { id: string; nome: string } | null;
  }>) {
    if (!a.fornecedor) continue;
    const m = par(a.credor_empresa_contabil_id, a.fornecedor.id, a.fornecedor.nome);
    if (!m) continue;
    const juros = a.juros_ao_mes === null ? null : Number(a.juros_ao_mes);
    const saidas = a.saidas?.length ? a.saidas : [{ data: a.data_referencia, valor: Number(a.valor) }];
    m.saidas.push(...saidas.map((s) => ({ data: s.data, valor: Number(s.valor), juros })));
  }

  for (const t of (mutuosRes.data ?? []) as unknown as Array<{
    fornecedor_id: string;
    valor: string | number;
    juros_ao_mes: string | number | null;
    transferida_em: string;
    conta_origem_id: string | null;
    fornecedor: { nome: string } | null;
    origem: { empresa_contabil_id: string | null } | null;
    destino: { empresa_contabil_id: string | null } | null;
  }>) {
    const saiuDaqui = t.conta_origem_id !== null;
    const credor = saiuDaqui ? t.origem?.empresa_contabil_id : t.destino?.empresa_contabil_id;
    if (!credor) continue;
    const m = par(credor, t.fornecedor_id, t.fornecedor?.nome ?? "—");
    if (!m) continue;
    if (saiuDaqui) m.saidas.push({ data: t.transferida_em, valor: Number(t.valor), juros: t.juros_ao_mes === null ? null : Number(t.juros_ao_mes) });
    else m.devolucoes.push({ data: t.transferida_em, valor: Number(t.valor) });
  }

  return [...pares.values()];
}
