import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarFatosFiscais } from "@/lib/fiscal/apuracao-fatos";
import {
  PRIMEIRA_COMPETENCIA,
  calcularApuracao,
  estadoDaGuia,
  issARecuperar,
  type ARecuperar,
  type EstadoGuia,
  type Guia,
} from "@/lib/fiscal/apuracao";
import { formatarCnpj, regimeDaPJ, type CadastroFiscal } from "@/lib/fiscal/cadastro";
import type { FiscalFeriado, FiscalParametro, RegimeTributarioPJ } from "@/lib/types";

/**
 * A aba Apuração da seção Fiscal (módulo fiscal, entrega 2 — protótipo
 * aprovado pelo Tiago em 02/10/2026): as guias de cada competência,
 * calculadas hoje (fuso de São Paulo) sobre os fatos do banco
 * (`carregarFatosFiscais`) com as aprovações já feitas, e o estado de cada
 * uma (em curso, a aprovar, aprovada, diferença).
 *
 * A apuração não se grava: o que se grava é a aprovação (`./actions.ts`).
 */

/** Uma aprovação já feita, do jeito que a memória de cálculo mostra. */
export interface AprovacaoDaTela {
  id: string;
  data: string;
  valor_calculado: number;
  valor_guia: number;
  justificativa: string | null;
  diferenca: boolean;
  /** O nome do arquivo da guia anexada (o caminho fica no servidor). */
  guia_nome: string | null;
  autor: string;
}

export interface GuiaDaTela extends Guia {
  estado: EstadoGuia;
  /** Na diferença: quanto o cálculo de hoje se afastou do aprovado. */
  delta: number;
  aprovacoes: AprovacaoDaTela[];
}

export interface EstabelecimentoDaTela {
  id: string;
  empresa_contabil_id: string;
  nome: string;
  cnpj: string;
  municipio: string;
  uf: string;
  papel: "matriz" | "filial";
}

export interface PJDaTela {
  id: string;
  nome: string;
  regime: RegimeTributarioPJ;
  regime_caixa: boolean;
  /** "lucro real" · "lucro presumido pelo caixa"... */
  rotulo_regime: string;
  /** Como as guias da PJ se juntam (o texto ao lado do nome no agrupamento). */
  como_apura: string | null;
  matriz_id: string | null;
}

export interface ARecuperarDaTela extends ARecuperar {
  nota_numero: string;
  jobs: string;
}

export interface DadosDaApuracao {
  tenantId: string;
  /** Hoje em São Paulo ("AAAA-MM-DD"). */
  hoje: string;
  guias: GuiaDaTela[];
  aRecuperar: ARecuperarDaTela[];
  /** As PJs na ordem do cadastro de impostos. */
  pjs: PJDaTela[];
  estabelecimentos: EstabelecimentoDaTela[];
  /** Notas de saída com CNPJ emissor (as que entram na apuração). */
  notasNaApuracao: number;
  /** Notas emitidas desde o início da apuração sem CNPJ emissor (ficam de fora). */
  notasSemCnpj: number;
  /** NFs de fornecedor registradas na aprovação das PPs. */
  nfsDeFornecedor: number;
  /** O que a prévia das cotas do IRPJ/CSLL precisa (vencimento e Selic estimada). */
  feriados: FiscalFeriado[];
  parametros: FiscalParametro[];
  /** Falha ao ler ou calcular (a aba mostra a mensagem em vez das guias). */
  erro: string | null;
}

const INICIO = `${PRIMEIRA_COMPETENCIA}-01`;

/** Hoje no fuso da casa (o servidor roda em UTC). */
export const hojeEmSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const juntar = (itens: string[]) =>
  itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;

/** O nome do arquivo no fim do caminho ("<tenant>/guias/<uuid>/darf.pdf" → "darf.pdf"). */
const nomeDoArquivo = (path: string | null) => (path ? path.split("/").pop() || path : null);

function pjsDaTela(cad: CadastroFiscal, nomes: Map<string, string>, hoje: string): PJDaTela[] {
  const estabs = [...cad.estabelecimentos].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const ids = [...new Set(estabs.map((e) => e.empresa_contabil_id))];
  return ids.map((id) => {
    const doPj = estabs.filter((e) => e.empresa_contabil_id === id);
    const matriz = doPj.find((e) => e.papel === "matriz") ?? doPj[0];
    const filiais = doPj.filter((e) => e.papel === "filial" && e.ativo).map((e) => e.municipio);
    const { regime, regime_caixa } = regimeDaPJ(cad, id, hoje);
    let rotulo = "lucro real";
    let como: string | null = null;
    if (regime === "lucro_real") {
      como = filiais.length
        ? `federais numa guia só pela matriz (${matriz?.municipio ?? "—"}), somando ${juntar(filiais)}; ISS por estabelecimento`
        : null;
    } else if (regime_caixa) {
      rotulo = "lucro presumido pelo caixa";
      como = "ISS pela emissão da nota; PIS, COFINS, IRPJ e CSLL pelo recebimento";
    } else {
      rotulo = "lucro presumido";
    }
    return {
      id,
      nome: nomes.get(id) ?? matriz?.nome.split(" · ")[0] ?? "—",
      regime,
      regime_caixa,
      rotulo_regime: rotulo,
      como_apura: como,
      matriz_id: matriz?.id ?? null,
    };
  });
}

function vazio(tenantId: string, hoje: string, erro: string | null): DadosDaApuracao {
  return {
    tenantId,
    hoje,
    guias: [],
    aRecuperar: [],
    pjs: [],
    estabelecimentos: [],
    notasNaApuracao: 0,
    notasSemCnpj: 0,
    nfsDeFornecedor: 0,
    feriados: [],
    parametros: [],
    erro,
  };
}

interface AprovacaoDoBanco {
  id: string;
  chave: string;
  data: string;
  valor_calculado: number | string;
  valor_guia: number | string;
  justificativa: string | null;
  diferenca: boolean;
  guia_path: string | null;
  aprovada_por: string;
}

export async function carregarApuracao(supabase: SupabaseClient, tenantId: string): Promise<DadosDaApuracao> {
  const hoje = hojeEmSaoPaulo();
  try {
    const [fatosDoBanco, empresasRes, aprovacoesRes, semCnpjRes, membrosRes] = await Promise.all([
      carregarFatosFiscais(supabase, tenantId),
      supabase.from("empresas_contabeis").select("id, razao_social, nome_fantasia").eq("tenant_id", tenantId),
      supabase
        .from("fiscal_aprovacoes")
        .select("id, chave, data, valor_calculado, valor_guia, justificativa, diferenca, guia_path, aprovada_por")
        .eq("tenant_id", tenantId)
        .order("aprovada_em"),
      // Só a contagem: as notas de antes do módulo fiscal não dizem por qual CNPJ saíram.
      supabase
        .from("faturamentos")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("status", "emitido")
        .is("estabelecimento_id", null)
        .gte("data_emissao", INICIO),
      // O nome de quem aprovou: a lista de membros (a RLS de `profiles` só mostra o próprio).
      supabase.rpc("membros_ativos_do_tenant", { p_tenant_id: tenantId }),
    ]);
    if (empresasRes.error) throw new Error(`[fiscal.apuracao.empresas] ${empresasRes.error.message}`);
    if (aprovacoesRes.error) throw new Error(`[fiscal.apuracao.aprovacoes] ${aprovacoesRes.error.message}`);

    const { cadastro, fatos, aprovacoes } = fatosDoBanco;
    const aprovacoesDoBanco = (aprovacoesRes.data ?? []) as AprovacaoDoBanco[];

    const nomes = new Map<string, string>();
    for (const m of (membrosRes.data ?? []) as Array<{ id: string; nome: string }>) nomes.set(m.id, m.nome);
    const aprovacoesPorChave = new Map<string, AprovacaoDaTela[]>();
    for (const a of aprovacoesDoBanco) {
      const lista = aprovacoesPorChave.get(a.chave) ?? [];
      lista.push({
        id: a.id,
        data: a.data,
        valor_calculado: Number(a.valor_calculado),
        valor_guia: Number(a.valor_guia),
        justificativa: a.justificativa,
        diferenca: a.diferenca,
        guia_nome: nomeDoArquivo(a.guia_path),
        autor: nomes.get(a.aprovada_por) ?? "—",
      });
      aprovacoesPorChave.set(a.chave, lista);
    }

    const guias: GuiaDaTela[] = calcularApuracao(cadastro, fatos, hoje, aprovacoes).map((g) => {
      const s = estadoDaGuia(g, hoje, aprovacoes);
      return { ...g, estado: s.estado, delta: s.delta, aprovacoes: aprovacoesPorChave.get(g.chave) ?? [] };
    });

    const notaPorId = new Map(fatos.notas.map((n) => [n.id, n]));
    const aRecuperar: ARecuperarDaTela[] = issARecuperar(cadastro, fatos, aprovacoes, hoje).map((a) => {
      const n = notaPorId.get(a.nota_id);
      return {
        ...a,
        nota_numero: n?.numero ?? "—",
        jobs: n ? juntar(n.jobs.map((j) => j.codigo)) : "",
      };
    });

    const nomesDasPJs = new Map(
      ((empresasRes.data ?? []) as Array<{ id: string; razao_social: string; nome_fantasia: string | null }>).map((e) => [
        e.id,
        e.nome_fantasia?.trim() || e.razao_social,
      ]),
    );

    return {
      tenantId,
      hoje,
      guias,
      aRecuperar,
      pjs: pjsDaTela(cadastro, nomesDasPJs, hoje),
      estabelecimentos: [...cadastro.estabelecimentos]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
        .map((e) => ({
          id: e.id,
          empresa_contabil_id: e.empresa_contabil_id,
          nome: e.nome,
          cnpj: e.cnpj ? formatarCnpj(e.cnpj) : "a informar",
          municipio: e.municipio,
          uf: e.uf,
          papel: e.papel,
        })),
      notasNaApuracao: fatos.notas.length,
      notasSemCnpj: semCnpjRes.count ?? 0,
      // Só as que entram em alguma competência apurada (emitidas ou pagas a partir dela).
      nfsDeFornecedor: fatos.notasFornecedor.filter(
        (nf) => nf.emissao >= INICIO || nf.pagamentos.some((pg) => pg.data >= INICIO),
      ).length,
      feriados: cadastro.feriados,
      parametros: cadastro.parametros,
      erro: null,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : String(e);
    console.error("[fiscal.apuracao]", mensagem);
    return vazio(tenantId, hoje, mensagem);
  }
}

/** Guias a aprovar ou com diferença (o número da aba). */
export function contarGuiasAAprovar(dados: DadosDaApuracao): number {
  return dados.guias.filter((g) => g.estado === "a_aprovar" || g.estado === "diferenca").length;
}
