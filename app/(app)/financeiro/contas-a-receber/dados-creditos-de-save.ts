/**
 * A aba "Créditos de save" do Contas a Receber (decisão 247, protótipo
 * aprovado pelo Tiago em 04 e 09/11/2026): os clientes com save, cada um com
 * as origens do crédito — os jobs que geraram save e os saves avulsos — e,
 * de cada origem, os jobs que consumiram.
 *
 * Jobs pelo nome que o financeiro deu (`nomeDoJobNoFinanceiro`), nunca pelo
 * código. O que ainda não é job (orçamento em rascunho) vai pelo nome do
 * orçamento.
 *
 * Os saldos vêm de `vw_saves_por_job` e `vw_saves_avulsos` — a mesma conta
 * que a planilha usa para oferecer o saldo. O detalhe do consumo vem de
 * `saves_consumos`, uma linha por consumo, com a situação dele.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { nomeDoJobNoFinanceiro } from "@/lib/types";
import { detalheDoSaveAvulso } from "@/lib/data/saves";

export type SituacaoDoConsumo = "consumido" | "aguardando_financeiro" | "aguardando_abertura" | "rascunho";

export interface ConsumoDoCredito {
  /** O job que consome (nome do financeiro), ou o orçamento em rascunho. */
  consumidor: string;
  linha: string;
  valor: number;
  situacao: SituacaoDoConsumo;
}

export interface OrigemDoCredito {
  id: string;
  tipo: "job" | "avulso";
  nome: string;
  detalhe: string;
  credito: number;
  consumido: number;
  /** O que ainda não é consumo firme: pedido aguardando, versão aprovada e
   *  rascunho. */
  reservado: number;
  saldo: number;
  consumos: ConsumoDoCredito[];
}

export interface ClienteComSave {
  id: string;
  nome: string;
  origens: OrigemDoCredito[];
}

const STATUS_DE_JOB_ABERTO = new Set(["aberto", "em_producao", "encerrado", "finalizado"]);
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function lerCreditosDeSave(supabase: SupabaseClient, tenantId: string): Promise<ClienteComSave[]> {
  const [jobsRes, avulsosRes, clientesRes, consumosRes, pedidosRes] = await Promise.all([
    supabase
      .from("vw_saves_por_job")
      .select("job_id, cliente_id, saldo_gerado, consumido, reservado, reservado_aprovacao, disponivel")
      .eq("tenant_id", tenantId),
    supabase
      .from("vw_saves_avulsos")
      .select("id, cliente_id, nome, numero_nf, data_emissao, valor_nf, credito, consumido, reservado, reservado_aprovacao, disponivel")
      .eq("tenant_id", tenantId),
    supabase.from("clientes").select("id, nome_fantasia, razao_social").eq("tenant_id", tenantId),
    supabase
      .from("saves_consumos")
      .select("job_origem_id, save_avulso_id, job_item_orcado_id, item_versao_id, valor, substituido_em")
      .eq("tenant_id", tenantId),
    supabase
      .from("saves_aprovacoes")
      .select("job_item_orcado_id")
      .eq("tenant_id", tenantId)
      .eq("tipo", "consome")
      .eq("situacao", "aguardando"),
  ]);
  for (const [rotulo, r] of [
    ["jobs", jobsRes],
    ["avulsos", avulsosRes],
    ["clientes", clientesRes],
    ["consumos", consumosRes],
    ["pedidos", pedidosRes],
  ] as const) {
    if (r.error) console.error(`[receber.creditos.${rotulo}]`, r.error.message);
  }

  const saldosDeJob = (jobsRes.data ?? []) as any[];
  const avulsos = (avulsosRes.data ?? []) as any[];
  if (saldosDeJob.length === 0 && avulsos.length === 0) return [];

  const idsOrigemJob = new Set(saldosDeJob.map((s) => s.job_id as string));
  const idsAvulso = new Set(avulsos.map((a) => a.id as string));
  const consumos = ((consumosRes.data ?? []) as any[]).filter(
    (c) =>
      !c.substituido_em &&
      ((c.job_origem_id && idsOrigemJob.has(c.job_origem_id)) || (c.save_avulso_id && idsAvulso.has(c.save_avulso_id))),
  );
  const aguardandoFinanceiro = new Set(
    ((pedidosRes.data ?? []) as any[]).map((p) => p.job_item_orcado_id as string | null).filter(Boolean),
  );

  // Quem consome: a linha do job (e o job), ou a linha da versão (e o
  // orçamento). E o nome do financeiro dos jobs de origem.
  const idsLinhaJob = [...new Set(consumos.map((c) => c.job_item_orcado_id).filter(Boolean))] as string[];
  const idsLinhaVersao = [...new Set(consumos.map((c) => c.item_versao_id).filter(Boolean))] as string[];
  const [linhasJobRes, linhasVersaoRes, jobsOrigemRes] = await Promise.all([
    idsLinhaJob.length
      ? supabase
          .from("jobs_itens_orcado")
          .select("id, item, job:jobs!inner(nome, nome_financeiro, status)")
          .in("id", idsLinhaJob)
      : Promise.resolve({ data: [] as any[], error: null }),
    idsLinhaVersao.length
      ? supabase
          .from("versoes_orcamento_itens")
          // `!orcamento_id`: duas FKs entre `versoes_orcamento` e `orcamentos`.
          .select("id, item, versao:versoes_orcamento!inner(status, orcamento:orcamentos!orcamento_id(nome))")
          .in("id", idsLinhaVersao)
      : Promise.resolve({ data: [] as any[], error: null }),
    idsOrigemJob.size
      ? supabase.from("jobs").select("id, nome, nome_financeiro, codigo").in("id", [...idsOrigemJob])
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (linhasJobRes.error) console.error("[receber.creditos.linhas_job]", linhasJobRes.error.message);
  if (linhasVersaoRes.error) console.error("[receber.creditos.linhas_versao]", linhasVersaoRes.error.message);

  const linhaJob = new Map<string, any>(((linhasJobRes.data ?? []) as any[]).map((l) => [l.id, l]));
  const linhaVersao = new Map<string, any>(((linhasVersaoRes.data ?? []) as any[]).map((l) => [l.id, l]));
  const jobOrigem = new Map<string, any>(((jobsOrigemRes.data ?? []) as any[]).map((j) => [j.id, j]));

  const consumoNaTela = (c: any): ConsumoDoCredito => {
    const valor = Number(c.valor ?? 0);
    if (c.job_item_orcado_id) {
      const l = linhaJob.get(c.job_item_orcado_id);
      const status = l?.job?.status as string | undefined;
      return {
        consumidor: l?.job ? nomeDoJobNoFinanceiro(l.job) : "Job",
        linha: l?.item ?? "",
        valor,
        situacao: aguardandoFinanceiro.has(c.job_item_orcado_id)
          ? "aguardando_financeiro"
          : status && STATUS_DE_JOB_ABERTO.has(status)
            ? "consumido"
            : "aguardando_abertura",
      };
    }
    const l = linhaVersao.get(c.item_versao_id);
    return {
      consumidor: l?.versao?.orcamento?.nome ?? "Orçamento",
      linha: l?.item ?? "",
      valor,
      situacao: l?.versao?.status === "aprovada" ? "aguardando_abertura" : "rascunho",
    };
  };

  const porCliente = new Map<string, OrigemDoCredito[]>();
  const empilha = (clienteId: string, o: OrigemDoCredito) => {
    const lista = porCliente.get(clienteId) ?? [];
    lista.push(o);
    porCliente.set(clienteId, lista);
  };

  for (const a of avulsos) {
    empilha(a.cliente_id, {
      id: a.id,
      tipo: "avulso",
      nome: a.nome,
      detalhe: `${detalheDoSaveAvulso(a.numero_nf, a.data_emissao)} · NF de ${Number(a.valor_nf ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      credito: Number(a.credito ?? 0),
      consumido: Number(a.consumido ?? 0),
      reservado: r2(Number(a.reservado ?? 0) + Number(a.reservado_aprovacao ?? 0)),
      saldo: Number(a.disponivel ?? 0),
      consumos: consumos.filter((c) => c.save_avulso_id === a.id).map(consumoNaTela),
    });
  }
  for (const s of saldosDeJob) {
    const j = jobOrigem.get(s.job_id);
    empilha(s.cliente_id, {
      id: s.job_id,
      tipo: "job",
      nome: j ? nomeDoJobNoFinanceiro(j) : "Job",
      detalhe: "Linhas em save do job",
      credito: Number(s.saldo_gerado ?? 0),
      consumido: Number(s.consumido ?? 0),
      reservado: r2(Number(s.reservado ?? 0) + Number(s.reservado_aprovacao ?? 0)),
      saldo: Number(s.disponivel ?? 0),
      consumos: consumos.filter((c) => c.job_origem_id === s.job_id).map(consumoNaTela),
    });
  }

  const nomeDoCliente = new Map<string, string>(
    ((clientesRes.data ?? []) as any[]).map((c) => [c.id, c.nome_fantasia ?? c.razao_social ?? "—"]),
  );
  return [...porCliente.entries()]
    .map(([id, origens]) => ({
      id,
      nome: nomeDoCliente.get(id) ?? "—",
      // O save avulso primeiro, depois os jobs, cada grupo pelo nome.
      origens: origens.sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === "avulso" ? -1 : 1)),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
