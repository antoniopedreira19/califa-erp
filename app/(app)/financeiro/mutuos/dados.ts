import type { createClient } from "@/lib/supabase/server";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import {
  parteDeFora,
  parteDoCnpj,
  saldosDosPares,
  type AberturaDoPar,
  type ContaDoMutuo,
  type ContextoDoMutuoNaConta,
  type DadosDoMutuo,
  type IofDoMutuo,
  type LinhaDeOutraConta,
  type MutuoDaLista,
  type ParteDoMutuo,
} from "@/lib/financeiro/mutuo";

type Supabase = ReturnType<typeof createClient>;

/**
 * O que a tela e o formulário do mútuo leem (decisão 230). O saldo não vem
 * pronto do banco: é a soma de `lib/financeiro/mutuo.ts`, que a prévia do
 * formulário também usa.
 */
export async function carregarMutuos(supabase: Supabase, tenantId: string): Promise<DadosDoMutuo> {
  const [contasRes, cnpjsRes, forasRes, mutuosRes, aberturasRes, iofsRes, guiasRes] = await Promise.all([
    supabase
      .from("contas_bancarias")
      .select("id, nome, banco, empresa_contabil_id, cartao_credito_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .not("empresa_contabil_id", "is", null)
      .order("nome"),
    supabase
      .from("empresas_contabeis")
      .select("id, nome_fantasia, razao_social, de_teste, empresa_gerencial_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true),
    supabase
      .from("fornecedores")
      .select("id, nome")
      .eq("tenant_id", tenantId)
      .eq("empresa_de_fora", true)
      .order("nome"),
    supabase
      .from("transferencias_contas")
      .select(
        `id, codigo, conta_origem_id, conta_destino_id, fornecedor_id, valor, data_prevista, descricao,
         status, transferida_em, juros_ao_mes, trimestre, ano,
         pernas:lancamentos_financeiros(origem, conta_bancaria_id, extrato_linha_id, data_movimento)`,
      )
      .eq("tenant_id", tenantId)
      .eq("tipo", "mutuo")
      .order("data_prevista", { ascending: true }),
    supabase
      .from("mutuos_saldo_abertura")
      .select(
        "id, credor_empresa_contabil_id, devedor_empresa_contabil_id, devedor_fornecedor_id, valor, data_referencia, trimestre, ano, nota, juros_ao_mes, saidas, iof_pago",
      )
      .eq("tenant_id", tenantId),
    supabase
      .from("mutuos_iof")
      .select("pagador_empresa_contabil_id, com_empresa_contabil_id, com_fornecedor_id, lancamento:lancamentos_financeiros(valor)")
      .eq("tenant_id", tenantId),
    supabase
      .from("impostos_a_pagar")
      .select("empresa_contabil_id, rotulo_competencia, valor, status, multa_juros")
      .eq("tenant_id", tenantId)
      .eq("tributo", "IOF")
      .in("status", ["a_pagar", "pago"]),
  ]);

  for (const [nome, res] of [
    ["contas", contasRes],
    ["cnpjs", cnpjsRes],
    ["empresas de fora", forasRes],
    ["mútuos", mutuosRes],
    ["abertura", aberturasRes],
    ["iof", iofsRes],
    ["guias de iof", guiasRes],
  ] as const) {
    if (res.error) throw new Error(`Falha ao carregar ${nome} do mútuo: ${res.error.message}`);
  }

  // Só o CNPJ que tem empresa gerencial faz mútuo: os de teste ficam de fora.
  const cnpjs = (cnpjsRes.data ?? []).filter((c) => !c.de_teste && c.empresa_gerencial_id);
  const idsDoGrupo = new Set(cnpjs.map((c) => c.id));

  const partes: ParteDoMutuo[] = [
    ...cnpjs.map((c) => ({ chave: parteDoCnpj(c.id), nome: c.nome_fantasia ?? c.razao_social, deFora: false })),
    ...(forasRes.data ?? []).map((f) => ({ chave: parteDeFora(f.id), nome: f.nome, deFora: true })),
  ];

  const contas: ContaDoMutuo[] = (contasRes.data ?? [])
    .filter((c) => !c.cartao_credito_id && c.empresa_contabil_id && idsDoGrupo.has(c.empresa_contabil_id))
    .map((c) => ({ id: c.id, nome: c.nome, banco: c.banco, parte: parteDoCnpj(c.empresa_contabil_id as string) }));

  const mutuos: MutuoDaLista[] = ((mutuosRes.data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    conta_origem_id: string | null;
    conta_destino_id: string | null;
    fornecedor_id: string | null;
    valor: string | number;
    data_prevista: string;
    descricao: string | null;
    status: "a_transferir" | "transferida";
    transferida_em: string | null;
    juros_ao_mes: string | number | null;
    trimestre: number;
    ano: number;
    pernas: Array<{ origem: string; conta_bancaria_id: string; extrato_linha_id: string | null; data_movimento: string }>;
  }>).map((m) => ({
    id: m.id,
    codigo: m.codigo,
    origemId: m.conta_origem_id,
    destinoId: m.conta_destino_id,
    fornecedorId: m.fornecedor_id,
    valor: Number(m.valor),
    // A perna conciliada vai para a data do banco: a tela mostra a dela.
    data: m.pernas[0]?.data_movimento ?? m.transferida_em ?? m.data_prevista,
    descricao: m.descricao,
    status: m.status,
    juros: m.juros_ao_mes === null ? null : Number(m.juros_ao_mes),
    trimestre: m.trimestre,
    ano: m.ano,
    pernas: m.pernas.map((p) => ({
      lado: p.origem === "mutuo_saida" ? ("saida" as const) : ("entrada" as const),
      contaId: p.conta_bancaria_id,
      conciliada: p.extrato_linha_id !== null,
    })),
  }));

  const aberturas: AberturaDoPar[] = (aberturasRes.data ?? []).map((a) => ({
    id: a.id,
    credor: parteDoCnpj(a.credor_empresa_contabil_id),
    devedor: a.devedor_fornecedor_id ? parteDeFora(a.devedor_fornecedor_id) : parteDoCnpj(a.devedor_empresa_contabil_id as string),
    valor: Number(a.valor),
    dataReferencia: a.data_referencia,
    trimestre: a.trimestre,
    ano: a.ano,
    nota: a.nota,
    juros: a.juros_ao_mes === null ? null : Number(a.juros_ao_mes),
    saidas: (a.saidas ?? []) as AberturaDoPar["saidas"],
    iofPago: Number(a.iof_pago),
  }));

  const iofs: IofDoMutuo[] = ((iofsRes.data ?? []) as unknown as Array<{
    pagador_empresa_contabil_id: string;
    com_empresa_contabil_id: string | null;
    com_fornecedor_id: string | null;
    lancamento: { valor: string | number } | null;
  }>).map((i) => ({
    pagador: parteDoCnpj(i.pagador_empresa_contabil_id),
    com: i.com_fornecedor_id
      ? parteDeFora(i.com_fornecedor_id)
      : i.com_empresa_contabil_id
        ? parteDoCnpj(i.com_empresa_contabil_id)
        : null,
    valor: Number(i.lancamento?.valor ?? 0),
  }));

  // A guia paga soma no IOF do par. Só a empresa de fora tem guia por enquanto:
  // com mais de uma para o mesmo CNPJ, a guia não diz de qual delas é.
  const guias = (guiasRes.data ?? []) as Array<{ empresa_contabil_id: string; rotulo_competencia: string; valor: string | number; status: string }>;
  for (const g of guias.filter((x) => x.status === "pago")) {
    const pagador = parteDoCnpj(g.empresa_contabil_id);
    const foras = aberturas.filter((a) => a.credor === pagador && a.devedor.startsWith("f:"));
    iofs.push({ pagador, com: foras.length === 1 ? foras[0].devedor : null, valor: Number(g.valor) });
  }
  const guiasAbertas = guias
    .filter((x) => x.status === "a_pagar")
    .map((x) => ({ parte: parteDoCnpj(x.empresa_contabil_id), competencia: x.rotulo_competencia, valor: Number(x.valor) }));

  return { hoje: hojeEmSaoPauloIso(), contas, partes, mutuos, aberturas, iofs, guiasAbertas };
}

/** O que a aba Conciliação automática precisa para reconhecer um mútuo na linha. */
export async function contextoDoMutuoNaConta(
  supabase: Supabase,
  tenantId: string,
  contaId: string,
  pendentes: Array<{ data: string; valor: number }>,
): Promise<ContextoDoMutuoNaConta & { partes: ParteDoMutuo[] }> {
  const [dados, contasRes, cnpjsRes, forasRes] = await Promise.all([
    carregarMutuos(supabase, tenantId),
    supabase.from("contas_bancarias").select("id, nome, empresa_contabil_id, cartao_credito_id").eq("tenant_id", tenantId).eq("ativo", true),
    supabase.from("empresas_contabeis").select("id, nome_fantasia, razao_social, cnpj, de_teste, empresa_gerencial_id").eq("tenant_id", tenantId).eq("ativo", true),
    supabase.from("fornecedores").select("id, nome, cpf_cnpj").eq("tenant_id", tenantId).eq("empresa_de_fora", true),
  ]);

  const doGrupo = (cnpjsRes.data ?? []).filter((c) => !c.de_teste && c.empresa_gerencial_id);
  const partes: ParteDoMutuo[] = [
    ...doGrupo.map((c) => ({ chave: parteDoCnpj(c.id), nome: c.nome_fantasia ?? c.razao_social, deFora: false })),
    ...(forasRes.data ?? []).map((f) => ({ chave: parteDeFora(f.id), nome: f.nome, deFora: true })),
  ];
  const cnpjs: ContextoDoMutuoNaConta["cnpjs"] = {};
  const digitos = (v: string | null) => (v ?? "").replace(/\D/g, "");
  for (const c of doGrupo) {
    const parte = partes.find((p) => p.chave === parteDoCnpj(c.id));
    if (parte && digitos(c.cnpj).length === 14) cnpjs[digitos(c.cnpj)] = parte;
  }
  for (const f of forasRes.data ?? []) {
    const parte = partes.find((p) => p.chave === parteDeFora(f.id));
    if (parte && digitos(f.cpf_cnpj).length === 14) cnpjs[digitos(f.cpf_cnpj)] = parte;
  }

  const contas = (contasRes.data ?? []).filter((c) => !c.cartao_credito_id && c.empresa_contabil_id);
  const aqui = contas.find((c) => c.id === contaId)?.empresa_contabil_id ?? null;
  const parte = aqui ? parteDoCnpj(aqui) : "";

  // Só as linhas de valor oposto ao das pendentes desta conta, em conta de outro CNPJ.
  const valores = [...new Set(pendentes.map((l) => -l.valor))];
  const outras = contas.filter((c) => c.empresa_contabil_id !== aqui && doGrupo.some((g) => g.id === c.empresa_contabil_id));
  let linhas: LinhaDeOutraConta[] = [];
  if (aqui && valores.length && outras.length) {
    const { data, error } = await supabase
      .from("vw_extrato_linhas")
      .select("id, conta_bancaria_id, data, valor")
      .eq("tenant_id", tenantId)
      .in("conta_bancaria_id", outras.map((c) => c.id))
      .in("valor", valores)
      .eq("conciliada", false)
      .is("ignorada_em", null);
    if (error) console.error("[mutuo.linhas de outras contas]", error.message);
    linhas = (data ?? []).map((l) => {
      const conta = outras.find((c) => c.id === l.conta_bancaria_id);
      return {
        id: l.id as string,
        contaId: l.conta_bancaria_id as string,
        contaNome: conta?.nome ?? "—",
        data: l.data as string,
        valor: Number(l.valor),
        parte: conta?.empresa_contabil_id ? parteDoCnpj(conta.empresa_contabil_id) : "",
      };
    });
  }

  const devedores: ContextoDoMutuoNaConta["devedores"] = {};
  for (const p of saldosDosPares(dados)) {
    if (Math.abs(p.saldo) < 0.005 || (p.a !== parte && p.b !== parte)) continue;
    devedores[p.a === parte ? p.b : p.a] = p.saldo > 0 ? p.a : p.b;
  }

  return { parte, pendentes: linhas, cnpjs, devedores, partes };
}
