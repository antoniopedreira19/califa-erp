import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OrigemImpostoAPagar,
  RegimeTributarioPJ,
  StatusImpostoAPagar,
  TributoFiscal,
} from "@/lib/types";
import { carregarCadastroFiscal, formatarCnpj, regimeDaPJ } from "@/lib/fiscal/cadastro";

/**
 * Os dados da aba Impostos a Pagar da seção Fiscal (módulo fiscal, entrega
 * 2 — desenho aprovado pelo Tiago no protótipo de 30/09 a 02/10/2026).
 *
 * Os títulos de `impostos_a_pagar` (os que a aprovação de uma guia cria e
 * os lançados à mão), com o rateio entre empresas e regionais pelo nome, as
 * correções de valor e a baixa. `lerImpostos` é também a leitura da aba
 * Títulos da conciliação (só os em aberto), para as duas telas mostrarem o
 * MESMO imposto do mesmo jeito.
 *
 * Só admin e financeiro leem (RLS das quatro tabelas); a página já barra
 * os outros papéis.
 */

/** Uma parte do rateio de um imposto, com os nomes. */
export interface ParteDoRateio {
  empresa_id: string;
  regional_id: string | null;
  empresa: string;
  regional: string | null;
  valor: number;
  percentual: number;
}

/** Uma correção de valor (a guia da contabilidade veio diferente). */
export interface CorrecaoDoImposto {
  id: string;
  de: number;
  para: number;
  justificativa: string;
  anexo_path: string | null;
  /** Timestamp ISO. */
  criado_em: string;
  autor: string;
}

/** Um imposto a pagar, pronto para a tela. */
export interface ImpostoDaLista {
  id: string;
  origem: OrigemImpostoAPagar;
  tributo: TributoFiscal | "OUTRO";
  titulo: string;
  /** Código do DARF; nulo na guia municipal. */
  codigo_receita: string | null;
  empresa_contabil_id: string;
  estabelecimento_id: string | null;
  competencia: string;
  rotulo_competencia: string;
  cota_numero: number | null;
  cota_total: number | null;
  descricao: string;
  vencimento: string;
  principal: number;
  juros: number;
  /** principal + juros: o que a guia cobra. */
  valor: number;
  status: StatusImpostoAPagar;
  guia_path: string | null;
  pago_em: string | null;
  conta_bancaria_id: string | null;
  /** "Conta Teste · Teste"; nulo sem baixa. */
  conta_nome: string | null;
  multa_juros: number;
  comprovante_path: string | null;
  baixado_por_nome: string | null;
  /** Timestamp ISO da baixa; nulo sem baixa. */
  baixado_em: string | null;
  /** A PJ (empresa contábil) da guia: "California". */
  pj: string;
  /** O nome do CNPJ: o estabelecimento (guia municipal) ou a PJ. */
  local: string;
  /** O CNPJ formatado: o do estabelecimento, ou o da matriz da PJ. */
  cnpj: string;
  /** "Salvador-BA" na guia com estabelecimento; nulo na federal. */
  municipio: string | null;
  rateio: ParteDoRateio[];
  correcoes: CorrecaoDoImposto[];
}

/** Uma PJ (empresa contábil), para os filtros e os avisos de conta. */
export interface PJDaLista {
  id: string;
  nome: string;
}

/** Uma conta que paga a guia: ativa e fora das contas-espelho de cartão. */
export interface ContaDaBaixaDeImposto {
  id: string;
  nome: string;
  banco: string;
  /** A PJ dona da conta — para o aviso "a guia é da X e a conta é da Y". */
  empresa_contabil_id: string;
}

/** Um CNPJ que pode receber um imposto avulso. */
export interface EstabelecimentoDoAvulso {
  id: string;
  empresa_contabil_id: string;
  nome: string;
  cnpj: string;
}

/** Uma regional do rateio do avulso: "Empresa · Regional". */
export interface RegionalDoRateio {
  id: string;
  empresa_id: string;
  nome: string;
  ativo: boolean;
}

export interface DadosDosImpostos {
  tenantId: string;
  /** Todos os impostos, em aberto e pagos. */
  impostos: ImpostoDaLista[];
  pjs: PJDaLista[];
  contas: ContaDaBaixaDeImposto[];
  /** Os CNPJs ativos com número, para o lançamento avulso. */
  estabelecimentos: EstabelecimentoDoAvulso[];
  /** O regime de hoje de cada PJ — o código de DARF sugerido no avulso. */
  regimePorPJ: Record<string, RegimeTributarioPJ>;
  regionais: RegionalDoRateio[];
  /** A leitura dos impostos falhou: a tela avisa em vez de dizer "nenhum". */
  erro: boolean;
}

const SELECT_IMPOSTO = `
  id, origem, tributo, titulo, codigo_receita, empresa_contabil_id, estabelecimento_id,
  competencia, rotulo_competencia, cota_numero, cota_total, descricao, vencimento,
  principal, juros, valor, status, guia_path, pago_em, conta_bancaria_id, multa_juros,
  comprovante_path, baixado_em,
  conta:contas_bancarias!conta_bancaria_id(nome, banco),
  baixado_por_profile:profiles!baixado_por(nome),
  rateio:impostos_a_pagar_rateio(empresa_id, regional_id, valor, percentual, ordem,
    empresa:empresas(nome_fantasia, razao_social), regional:regionais(nome)),
  correcoes:impostos_a_pagar_correcoes(id, de, para, justificativa, anexo_path, created_at,
    autor:profiles!criado_por(nome))
`;

type Num = number | string;

interface LinhaDoBanco {
  id: string;
  origem: OrigemImpostoAPagar;
  tributo: TributoFiscal | "OUTRO";
  titulo: string;
  codigo_receita: string | null;
  empresa_contabil_id: string;
  estabelecimento_id: string | null;
  competencia: string;
  rotulo_competencia: string;
  cota_numero: number | null;
  cota_total: number | null;
  descricao: string;
  vencimento: string;
  principal: Num;
  juros: Num;
  valor: Num;
  status: StatusImpostoAPagar;
  guia_path: string | null;
  pago_em: string | null;
  conta_bancaria_id: string | null;
  multa_juros: Num;
  comprovante_path: string | null;
  baixado_em: string | null;
  conta: { nome: string; banco: string } | null;
  baixado_por_profile: { nome: string | null } | null;
  rateio: Array<{
    empresa_id: string;
    regional_id: string | null;
    valor: Num;
    percentual: Num;
    ordem: number;
    empresa: { nome_fantasia: string | null; razao_social: string | null } | null;
    regional: { nome: string } | null;
  }> | null;
  correcoes: Array<{
    id: string;
    de: Num;
    para: Num;
    justificativa: string;
    anexo_path: string | null;
    created_at: string;
    autor: { nome: string | null } | null;
  }> | null;
}

interface EstabDoBanco {
  id: string;
  empresa_contabil_id: string;
  nome: string;
  cnpj: string | null;
  papel: "matriz" | "filial";
  municipio: string;
  uf: string;
  ativo: boolean;
}

/**
 * Lê os impostos a pagar (todos, ou só os em aberto), já com os nomes da
 * PJ, do CNPJ, do rateio e de quem baixou e corrigiu. Usada pela aba
 * Impostos a Pagar e pela aba Títulos da conciliação.
 */
export async function lerImpostos(
  supabase: SupabaseClient,
  tenantId: string,
  opcoes: { soEmAberto: boolean },
): Promise<{ impostos: ImpostoDaLista[]; pjs: PJDaLista[]; erro: boolean }> {
  let consulta = supabase
    .from("impostos_a_pagar")
    .select(SELECT_IMPOSTO)
    .eq("tenant_id", tenantId)
    .order("vencimento", { ascending: true });
  if (opcoes.soEmAberto) consulta = consulta.eq("status", "a_pagar");

  const [impostosRes, pjsRes, estabsRes] = await Promise.all([
    consulta.returns<LinhaDoBanco[]>(),
    supabase
      .from("empresas_contabeis")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("tenant_id", tenantId)
      .order("razao_social"),
    supabase
      .from("fiscal_estabelecimentos")
      .select("id, empresa_contabil_id, nome, cnpj, papel, municipio, uf, ativo")
      .eq("tenant_id", tenantId)
      .returns<EstabDoBanco[]>(),
  ]);
  // ⚠️ O erro é LIDO: consulta quebrada não pode virar "nenhum imposto".
  for (const [nome, res] of [
    ["impostos", impostosRes],
    ["pjs", pjsRes],
    ["estabelecimentos", estabsRes],
  ] as const) {
    if (res.error) console.error(`[fiscal.impostos.${nome}]`, res.error.message);
  }

  const pjsDoBanco = (pjsRes.data ?? []) as Array<{
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    cnpj: string;
    ativo: boolean;
  }>;
  const pjs: PJDaLista[] = pjsDoBanco.map((p) => ({ id: p.id, nome: p.nome_fantasia ?? p.razao_social }));
  const nomeDaPJ = new Map(pjs.map((p) => [p.id, p.nome]));
  const cnpjDaPJ = new Map(pjsDoBanco.map((p) => [p.id, p.cnpj]));
  const estabs = estabsRes.data ?? [];
  const estabPorId = new Map(estabs.map((e) => [e.id, e]));
  /** O CNPJ da matriz da PJ (o da própria PJ, sem matriz cadastrada). */
  const cnpjDaMatriz = (pjId: string) =>
    estabs.find((e) => e.empresa_contabil_id === pjId && e.papel === "matriz" && e.cnpj)?.cnpj ??
    cnpjDaPJ.get(pjId) ??
    null;

  const impostos: ImpostoDaLista[] = (impostosRes.data ?? []).map((t) => {
    const estab = t.estabelecimento_id ? estabPorId.get(t.estabelecimento_id) ?? null : null;
    const pj = nomeDaPJ.get(t.empresa_contabil_id) ?? "—";
    return {
      id: t.id,
      origem: t.origem,
      tributo: t.tributo,
      titulo: t.titulo,
      codigo_receita: t.codigo_receita,
      empresa_contabil_id: t.empresa_contabil_id,
      estabelecimento_id: t.estabelecimento_id,
      competencia: t.competencia,
      rotulo_competencia: t.rotulo_competencia,
      cota_numero: t.cota_numero,
      cota_total: t.cota_total,
      descricao: t.descricao,
      vencimento: t.vencimento,
      principal: Number(t.principal),
      juros: Number(t.juros),
      valor: Number(t.valor),
      status: t.status,
      guia_path: t.guia_path,
      pago_em: t.pago_em,
      conta_bancaria_id: t.conta_bancaria_id,
      conta_nome: t.conta ? t.conta.nome : null,
      multa_juros: Number(t.multa_juros),
      comprovante_path: t.comprovante_path,
      baixado_por_nome: t.baixado_por_profile?.nome ?? null,
      baixado_em: t.baixado_em,
      pj,
      local: estab ? estab.nome : pj,
      cnpj: formatarCnpj(estab ? estab.cnpj : cnpjDaMatriz(t.empresa_contabil_id)),
      municipio: estab ? `${estab.municipio}-${estab.uf}` : null,
      rateio: [...(t.rateio ?? [])]
        .sort((a, b) => a.ordem - b.ordem)
        .map((r) => ({
          empresa_id: r.empresa_id,
          regional_id: r.regional_id,
          empresa: r.empresa?.nome_fantasia ?? r.empresa?.razao_social ?? "—",
          regional: r.regional?.nome ?? null,
          valor: Number(r.valor),
          percentual: Number(r.percentual),
        })),
      correcoes: [...(t.correcoes ?? [])]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((c) => ({
          id: c.id,
          de: Number(c.de),
          para: Number(c.para),
          justificativa: c.justificativa,
          anexo_path: c.anexo_path,
          criado_em: c.created_at,
          autor: c.autor?.nome ?? "—",
        })),
    };
  });

  return { impostos, pjs, erro: Boolean(impostosRes.error) };
}

const hojeEmSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export async function carregarImpostos(supabase: SupabaseClient, tenantId: string): Promise<DadosDosImpostos> {
  // Todas as leituras em paralelo — regra de performance do projeto.
  const [lidos, cadastro, contasRes, empresasRes, regionaisRes] = await Promise.all([
    lerImpostos(supabase, tenantId, { soEmAberto: false }),
    carregarCadastroFiscal(supabase, tenantId),
    // As contas que pagam guia: ativas, sem a conta-espelho do cartão (a
    // baixa no banco recusa, `_conta_da_baixa`).
    supabase
      .from("contas_bancarias")
      .select("id, nome, banco, empresa_contabil_id")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .neq("tipo", "cartao_credito")
      .order("ordem")
      .order("nome"),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, ativo")
      .eq("tenant_id", tenantId),
    supabase
      .from("regionais")
      .select("id, nome, ativo, empresa_id")
      .eq("tenant_id", tenantId)
      .order("nome"),
  ]);
  for (const [nome, res] of [
    ["contas", contasRes],
    ["empresas", empresasRes],
    ["regionais", regionaisRes],
  ] as const) {
    if (res.error) console.error(`[fiscal.impostos.${nome}]`, res.error.message);
  }

  const hoje = hojeEmSaoPaulo();
  const regimePorPJ: Record<string, RegimeTributarioPJ> = {};
  for (const p of lidos.pjs) regimePorPJ[p.id] = regimeDaPJ(cadastro, p.id, hoje).regime;

  const empresas = (empresasRes.data ?? []) as Array<{
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    ativo: boolean;
  }>;
  const empresaPorId = new Map(empresas.map((e) => [e.id, e]));
  // O rateio do avulso junta empresas gerenciais diferentes: a regional
  // aparece como "Empresa · Regional", e só a ativa de empresa ativa.
  const regionais: RegionalDoRateio[] = (
    (regionaisRes.data ?? []) as Array<{ id: string; nome: string; ativo: boolean; empresa_id: string }>
  )
    .flatMap((r) => {
      const e = empresaPorId.get(r.empresa_id);
      if (!e) return [];
      return [
        {
          id: r.id,
          empresa_id: r.empresa_id,
          nome: `${e.nome_fantasia ?? e.razao_social} · ${r.nome}`,
          ativo: r.ativo && e.ativo,
        },
      ];
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    tenantId,
    impostos: lidos.impostos,
    pjs: lidos.pjs,
    contas: (contasRes.data ?? []) as ContaDaBaixaDeImposto[],
    estabelecimentos: cadastro.estabelecimentos
      .filter((e) => e.ativo && e.cnpj)
      .map((e) => ({
        id: e.id,
        empresa_contabil_id: e.empresa_contabil_id,
        nome: e.nome,
        cnpj: formatarCnpj(e.cnpj),
      })),
    regimePorPJ,
    regionais,
    erro: lidos.erro,
  };
}

/** Quantos impostos estão em aberto (o número da aba). */
export async function contarImpostosAPagar(supabase: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await supabase
    .from("impostos_a_pagar")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "a_pagar");
  return count ?? 0;
}
