/**
 * A cauda do histórico da planilha no Extrato da conta (decisão 211, A6).
 *
 * Os pagamentos e recebimentos de outubro dos jobs até o 3T que não existem
 * no sistema ficam no histórico (a carga `cauda`) e contam no saldo da conta
 * desde o início dela. No Extrato eles entram na ordem do dia, como linhas
 * só de leitura ("Histórico da planilha · job"), para o saldo de cada linha
 * bater com o do banco. O id leva o prefixo `historico:` e a origem é
 * `historico`: a tela não abre detalhe de lançamento para elas.
 */
import type { createClient } from "@/lib/supabase/server";
import type { LinhaSemSaldo } from "@/lib/data/lancamento-linha";

type Supabase = ReturnType<typeof createClient>;

/** A origem das linhas da cauda no Extrato. */
export const ORIGEM_DA_CAUDA = "historico";

type CaudaCrua = {
  id: string;
  data: string;
  valor: string | number;
  job_nome: string | null;
  descricao: string | null;
  fornecedor: string | null;
  empresa_nome: string | null;
  regional_nome: string | null;
  extrato_linha_id: string | null;
};

/** As linhas da cauda da conta no período (desde o início da conta) e as já conciliadas com o banco. */
export async function carregarCaudaDoExtrato(
  supabase: Supabase,
  args: { tenantId: string; contaId: string; dataDe: string; dataAte: string; inicioDaConta: string },
): Promise<{ linhas: LinhaSemSaldo[]; conciliadas: string[] }> {
  const de = args.dataDe > args.inicioDaConta ? args.dataDe : args.inicioDaConta;
  if (de > args.dataAte) return { linhas: [], conciliadas: [] };
  const PAGINA = 1000;
  const crus: CaudaCrua[] = [];
  for (let pos = 0; pos < 50_000; pos += PAGINA) {
    const { data, error } = await supabase
      .from("historico_movimentos")
      .select(
        "id, data, valor, job_nome, descricao, fornecedor, empresa_nome, regional_nome, extrato_linha_id, carga:historico_cargas!inner(tipo, situacao)",
      )
      .eq("tenant_id", args.tenantId)
      .eq("conta_bancaria_id", args.contaId)
      .eq("carga.tipo", "cauda")
      .eq("carga.situacao", "ativa")
      .gte("data", de)
      .lte("data", args.dataAte)
      .order("data", { ascending: true })
      .order("id", { ascending: true })
      .range(pos, pos + PAGINA - 1)
      .returns<CaudaCrua[]>();
    if (error) {
      console.error("[conciliacao.cauda]", error.message);
      break;
    }
    crus.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return {
    linhas: crus.map((h) => {
      const valor = Number(h.valor);
      return {
        id: `historico:${h.id}`,
        folha: null,
        data_movimento: h.data,
        descricao: `Histórico da planilha · ${h.job_nome ?? h.descricao ?? "jobs até o 3T"}`,
        natureza: valor >= 0 ? "entrada" : "saida",
        valor: Math.abs(valor),
        fornecedor_nome: h.fornecedor,
        job_id: null,
        job_codigo: null,
        tipo_codigo: "",
        tipo_nome: "",
        subtipo_codigo: "",
        subtipo_nome: "",
        empresa_nome: h.empresa_nome,
        regional_nome: h.regional_nome,
        origem_codigo: null,
        origem_recorrente: false,
        cartao_label: null,
        documento_label: null,
        documento_path: null,
        origem: ORIGEM_DA_CAUDA,
        estornada: false,
        rateio: [],
        origens: [],
        papel_na_fatura: null,
        fatura_cartao_id: null,
        conta_avulsa_id: null,
        pedido_compra_parcela_id: null,
        desembolso_parcela_id: null,
        juros_de_lancamento_id: null,
      };
    }),
    conciliadas: crus.filter((h) => h.extrato_linha_id).map((h) => `historico:${h.id}`),
  };
}

/** Junta as linhas da cauda às do sistema na ordem do dia; no mesmo dia, as do sistema primeiro. */
export function juntarNaOrdemDoDia<T extends { data_movimento: string }>(sistema: T[], cauda: T[]): T[] {
  if (!cauda.length) return sistema;
  const saida: T[] = [];
  let k = 0;
  for (const l of sistema) {
    while (k < cauda.length && cauda[k].data_movimento < l.data_movimento) saida.push(cauda[k++]);
    saida.push(l);
  }
  while (k < cauda.length) saida.push(cauda[k++]);
  return saida;
}
