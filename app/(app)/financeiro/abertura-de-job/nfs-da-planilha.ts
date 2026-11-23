/**
 * As NFs presas ao job da planilha (decisão 276).
 *
 * A carga das NFs da aba Faturamento da planilha do financeiro lança as notas
 * dos jobs que ainda não existem no sistema como notas avulsas presas ao job
 * da planilha (`faturamento_itens.job_planilha_chave`/`job_planilha_nome`).
 * Na abertura, o campo do nome do job sugere esses jobs enquanto se digita; o
 * job aberto com o nome de um deles (escolhido na lista ou digitado igual)
 * recebe as NFs: cada uma vira Novo faturamento dele
 * (`passar_nf_da_planilha_ao_job`), com registro da passagem. No job mensal,
 * o mês é o anterior ao da emissão (Tiago, 23/11/2026).
 *
 * Só a nota de um job da planilha só passa sozinha; a de vários jobs fica
 * como está (é avulsa e continua no Contas a Receber).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerFaturamentoMensalPeloJob } from "@/lib/data/faturamento-mensal";
import { mesDaNotaMensal, nomeComparavel } from "@/lib/calculos/nfs-da-planilha";

export interface JobDaPlanilhaComNf {
  chave: string;
  nome: string;
  clienteId: string | null;
  empresaId: string | null;
  qtdNfs: number;
  valor: number;
}

/** Os jobs da planilha com NF esperando, para a sugestão do nome na abertura. */
export async function lerJobsDaPlanilhaComNf(supabase: SupabaseClient): Promise<JobDaPlanilhaComNf[]> {
  const { data, error } = await supabase.rpc("jobs_da_planilha_com_nf");
  if (error) {
    console.error("[nfs-da-planilha.jobs]", error.message);
    return [];
  }
  return (
    (data ?? []) as Array<{
      job_planilha_chave: string;
      job_planilha_nome: string;
      cliente_id: string | null;
      empresa_id: string | null;
      qtd_nfs: number;
      valor: number | string;
    }>
  ).map((j) => ({
    chave: j.job_planilha_chave,
    nome: j.job_planilha_nome,
    clienteId: j.cliente_id,
    empresaId: j.empresa_id,
    qtdNfs: Number(j.qtd_nfs),
    valor: Number(j.valor),
  }));
}

export interface PassagemDasNfs {
  passadas: Array<{ numero_nf: string; valor: number }>;
  recusadas: Array<{ numero_nf: string; motivo: string }>;
}

/**
 * Passa para o job aberto as NFs do job da planilha com o mesmo nome. Chamada
 * pela abertura, depois que o job ficou aberto e com as previsões gravadas:
 * falha aqui não desfaz a abertura, vira o aviso do fim.
 */
export async function passarNfsDaPlanilhaAoJob(
  supabase: SupabaseClient,
  tenantId: string,
  jobId: string,
  nomeFinanceiro: string,
): Promise<PassagemDasNfs> {
  const saida: PassagemDasNfs = { passadas: [], recusadas: [] };
  const alvo = nomeComparavel(nomeFinanceiro);
  if (!alvo) return saida;
  const jobs = (await lerJobsDaPlanilhaComNf(supabase)).filter((j) => nomeComparavel(j.nome) === alvo);
  if (jobs.length === 0) return saida;

  const { data: notas, error } = await supabase
    .from("faturamentos")
    .select("id, numero_nf, valor_total, data_emissao, itens:faturamento_itens!inner(job_planilha_chave)")
    .eq("tenant_id", tenantId)
    .eq("status", "emitido")
    .eq("origem_tipo", "avulso")
    .in(
      "itens.job_planilha_chave",
      jobs.map((j) => j.chave),
    )
    .order("data_emissao", { ascending: true })
    .returns<Array<{ id: string; numero_nf: string; valor_total: number | string; data_emissao: string }>>();
  if (error) {
    console.error("[nfs-da-planilha.notas]", error.message);
    saida.recusadas.push({ numero_nf: "—", motivo: "Não foi possível ler as NFs da planilha deste job." });
    return saida;
  }
  if (!notas || notas.length === 0) return saida;

  // No mensal, o mês e o previsto dele, pela mesma leitura do Novo faturamento.
  const mensal = await lerFaturamentoMensalPeloJob(supabase, tenantId, jobId, []);
  if (!mensal) {
    for (const n of notas) {
      saida.recusadas.push({ numero_nf: n.numero_nf, motivo: "Não foi possível ler se o job fatura por mês." });
    }
    return saida;
  }

  for (const n of notas) {
    let mes: string | null = null;
    let previsto: number | null = null;
    if (mensal.mensal) {
      mes = mesDaNotaMensal(n.data_emissao);
      const doMes = (mensal.meses ?? []).find((m) => m.mes === mes);
      if (!doMes) {
        saida.recusadas.push({
          numero_nf: n.numero_nf,
          motivo: `o mês ${mes.slice(5, 7)}/${mes.slice(0, 4)} não é do job`,
        });
        continue;
      }
      previsto = Math.round(doMes.faturamento * 100) / 100;
    }
    const { error: erro } = await supabase.rpc("passar_nf_da_planilha_ao_job", {
      p_faturamento_id: n.id,
      p_job_id: jobId,
      p_mes: mes,
      p_previsto_do_mes: previsto,
    });
    if (erro) {
      saida.recusadas.push({ numero_nf: n.numero_nf, motivo: erro.message });
      continue;
    }
    saida.passadas.push({ numero_nf: n.numero_nf, valor: Number(n.valor_total) });
  }
  return saida;
}
