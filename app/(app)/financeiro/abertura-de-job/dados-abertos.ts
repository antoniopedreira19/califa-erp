import { createClient } from "@/lib/supabase/server";
import { nomeDoJobNoFinanceiro } from "@/lib/types";
import {
  classificarFaturamento,
  type SituacaoFaturamento,
} from "@/lib/calculos/esteira-faturamento";

export type { SituacaoFaturamento };

/**
 * Um job aberto na visão do financeiro.
 *
 * O nome exibido é o `nome_financeiro` quando existe — é o ponto da tela:
 * o financeiro vê o nome dele, não o da produção (docs/decisions/004 e
 * HANDOFF_FINANCEIRO seção 3).
 *
 * A coluna de faturamento entrou em 13/08/2026, quando o envio para
 * faturamento e a tabela `faturamentos` passaram a existir. Antes disso
 * ficou de fora de propósito: chip ligado em campo inexistente devolve
 * zero linhas sempre, e quem usa conclui que o dado sumiu.
 */
export interface JobAberto {
  id: string;
  codigo: string;
  /** Nome que o financeiro vê (financeiro, com fallback no da produção). */
  nome: string;
  /** Nome da produção, mostrado quando difere — some a dúvida de "que job é esse". */
  nome_producao: string;
  valor_total: number | null;
  data_abertura_financeiro: string | null;
  competencia_trimestre: number | null;
  competencia_ano: number | null;
  categoria_nome: string | null;
  empresa_nome: string | null;
  projeto_id: string;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  responsavel_nome: string | null;
  regional_nome: string | null;
  produto: string | null;
  situacao_faturamento: SituacaoFaturamento;
  /**
   * O número da linha na coluna Faturamento: valor da nota quando ela
   * existe, valor enviado quando só houve envio, faturamento previsto
   * enquanto nenhum dos dois aconteceu.
   */
  valor_faturamento: number | null;
  numero_nf: string | null;
  data_envio_faturamento: string | null;
  /** Quanto já foi recebido — soma dos títulos pagos da nota. */
  valor_recebido: number;
  /** Vencimento em aberto mais antigo. É o que datar a inadimplência. */
  vencimento_em_aberto: string | null;
}

const SELECT_JOB_ABERTO =
  "id, codigo, nome, nome_financeiro, valor_total, faturamento_previsto, " +
  "data_abertura_financeiro, " +
  "competencia_trimestre, competencia_ano, projeto_id, produto, " +
  "categoria:categorias_dominio(nome), " +
  "empresa:empresas(razao_social, nome_fantasia), " +
  "regional:regionais(nome), " +
  "responsavel:profiles!responsavel_id(nome), " +
  "projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))";

/**
 * Todos os jobs já abertos no financeiro, ordenados por código.
 *
 * Quatro queries em paralelo, todas rasas: os jobs, os envios, as notas e
 * os títulos a receber delas. O cruzamento é feito em memória — embed de
 * `faturamentos` dentro de `jobs` não existe (a ligação é polimórfica,
 * por `origem_tipo`/`origem_id`) e embed pesado é o anti-padrão que
 * `docs/PERFORMANCE.md` proíbe.
 *
 * `hoje` entra por parâmetro para a inadimplência ser testável sem
 * depender do relógio da máquina.
 */
export async function listarJobsAbertos(
  tenantId: string,
  hoje: string = new Date().toISOString().slice(0, 10),
): Promise<JobAberto[]> {
  const supabase = createClient();

  const [jobsRes, enviosRes, notasRes, titulosRes] = await Promise.all([
    supabase
      .from("jobs")
      .select(SELECT_JOB_ABERTO)
      .eq("tenant_id", tenantId)
      .eq("status", "aberto")
      .order("codigo", { ascending: true }),
    supabase
      .from("jobs_envio_faturamento")
      .select("job_id, valor_faturado, enviado_em")
      .eq("tenant_id", tenantId),
    // Nota cancelada não conta como faturada — o job volta a esperar.
    supabase
      .from("faturamentos")
      .select("id, origem_id, numero_nf, valor_total")
      .eq("tenant_id", tenantId)
      .eq("origem_tipo", "job")
      .eq("status", "emitido"),
    // Título cancelado fica de fora: não é dinheiro a receber nem
    // recebido, então não pesa em liquidado nem em inadimplente.
    supabase
      .from("titulos_receber")
      .select("faturamento_id, valor, data_vencimento, status")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelado"),
  ]);

  const { data, error } = jobsRes;

  if (error) {
    console.error("[jobs-abertos.listar]", error.message);
    return [];
  }
  if (enviosRes.error) {
    console.error("[jobs-abertos.envios]", enviosRes.error.message);
  }
  if (notasRes.error) {
    console.error("[jobs-abertos.notas]", notasRes.error.message);
  }
  if (titulosRes.error) {
    console.error("[jobs-abertos.titulos]", titulosRes.error.message);
  }

  const envioPorJob = new Map<string, { valor: number; em: string }>();
  for (const e of (enviosRes.data ?? []) as any[]) {
    envioPorJob.set(e.job_id, {
      valor: Number(e.valor_faturado ?? 0),
      em: e.enviado_em,
    });
  }

  const notaPorJob = new Map<
    string,
    { id: string; numero: string | null; valor: number }
  >();
  for (const n of (notasRes.data ?? []) as any[]) {
    notaPorJob.set(n.origem_id, {
      id: n.id,
      numero: n.numero_nf ?? null,
      valor: Number(n.valor_total ?? 0),
    });
  }

  const titulosPorNota = new Map<
    string,
    { valor: number; vencimento: string; status: string }[]
  >();
  for (const t of (titulosRes.data ?? []) as any[]) {
    const arr = titulosPorNota.get(t.faturamento_id) ?? [];
    arr.push({
      valor: Number(t.valor ?? 0),
      vencimento: t.data_vencimento,
      status: t.status,
    });
    titulosPorNota.set(t.faturamento_id, arr);
  }

  return ((data ?? []) as any[]).map((j) => {
    const nota = notaPorJob.get(j.id);
    const envio = envioPorJob.get(j.id);
    const titulos = nota ? (titulosPorNota.get(nota.id) ?? []) : [];

    const emAberto = titulos.filter((t) => t.status !== "pago");
    const valorRecebido = titulos
      .filter((t) => t.status === "pago")
      .reduce((s, t) => s + t.valor, 0);
    // Vencimento em aberto mais antigo — é o que a tela data quando o job
    // está inadimplente.
    const vencimentoEmAberto =
      emAberto.map((t) => t.vencimento).sort()[0] ?? null;

    const situacao = classificarFaturamento(!!nota, !!envio, titulos, hoje);

    return {
      id: j.id,
      codigo: j.codigo,
      nome: nomeDoJobNoFinanceiro(j),
      nome_producao: j.nome,
      valor_total: j.valor_total !== null ? Number(j.valor_total) : null,
      data_abertura_financeiro: j.data_abertura_financeiro,
      competencia_trimestre: j.competencia_trimestre,
      competencia_ano: j.competencia_ano,
      categoria_nome: j.categoria?.nome ?? null,
      empresa_nome: j.empresa?.nome_fantasia ?? j.empresa?.razao_social ?? null,
      projeto_id: j.projeto_id,
      projeto_codigo: j.projeto?.codigo ?? null,
      projeto_nome: j.projeto?.nome ?? null,
      cliente_nome: j.projeto?.cliente?.nome_fantasia ?? null,
      responsavel_nome: j.responsavel?.nome ?? null,
      regional_nome: j.regional?.nome ?? null,
      produto: j.produto,
      situacao_faturamento: situacao,
      valor_faturamento:
        nota?.valor ??
        envio?.valor ??
        (j.faturamento_previsto !== null && j.faturamento_previsto !== undefined
          ? Number(j.faturamento_previsto)
          : null),
      numero_nf: nota?.numero ?? null,
      data_envio_faturamento: envio?.em ?? null,
      valor_recebido: valorRecebido,
      vencimento_em_aberto: vencimentoEmAberto,
    };
  });
}
