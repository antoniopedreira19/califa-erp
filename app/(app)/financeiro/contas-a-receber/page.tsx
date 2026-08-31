import { redirect } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ContasReceberTabs } from "./tabs";
import {
  FaturamentoList,
  type FaturamentoPendenteRow,
  type FaturadoRow,
} from "./faturamento-list";
import { TitulosList, type TituloRow } from "./titulos-list";
import type { InfoJob } from "./faturar-drawer";
import {
  contatosDeCobrancaPorJob,
  type ContatoCobranca,
} from "@/lib/data/contatos-cobranca";
import type {
  ContaBancaria,
  PlanoContaTipo,
  PlanoContaSubtipo,
  TituloReceberStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContasReceberPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Todas as leituras em paralelo — regra de performance do projeto.
  const [
    pendentesRes,
    faturadosRes,
    titulosRes,
    baixasRes,
    contasRes,
    tiposRes,
    subtiposRes,
    empresasRes,
    clientesRes,
    fornecedoresRes,
    jobsRes,
    enviosRes,
  ] = await Promise.all([
    supabase
      .from("vw_faturamento_pendente")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("data_prevista", { ascending: true, nullsFirst: false }),
    // Notas já emitidas: continuam na aba Faturamento, em verde.
    supabase
      .from("faturamentos")
      .select(`
        id, numero_nf, data_emissao, valor_total, descricao, cnae, anexo_nf_path,
        empresa_id, origem_tipo, cliente_id, fornecedor_id,
        plano_conta_tipo_id, plano_conta_subtipo_id,
        itens:faturamento_itens(id, origem_tipo, origem_id, envio_parcela_id, valor)
      `)
      .eq("tenant_id", tenantId)
      .eq("status", "emitido")
      .order("data_emissao", { ascending: false }),
    supabase
      .from("titulos_receber")
      .select(`
        id, numero_parcela, valor, data_vencimento, status,
        data_previsao_recebimento, data_previsao_recebimento_primeira,
        pago_em, empresa_id, faturamento_id,
        faturamento:faturamentos!inner(
          id, numero_nf, data_emissao, descricao, status, origem_tipo,
          cliente:clientes(id, nome_fantasia, razao_social),
          fornecedor:fornecedores(id, nome, razao_social),
          itens:faturamento_itens(origem_tipo, origem_id, envio_parcela_id, valor)
        )
      `)
      .eq("tenant_id", tenantId)
      .order("data_vencimento", { ascending: true }),
    // Conta e centro de custo da baixa — o "Conciliação · conta · centro"
    // da linha recebida. Query separada porque só as linhas pagas usam.
    supabase
      .from("lancamentos_financeiros")
      .select(`
        titulo_receber_id,
        conta:contas_bancarias(nome, banco),
        tipo:plano_contas_tipos(codigo, nome),
        subtipo:plano_contas_subtipos(nome)
      `)
      .eq("tenant_id", tenantId)
      .eq("origem", "titulo_baixa")
      .not("titulo_receber_id", "is", null),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .neq("tipo", "cartao_credito")
      .returns<ContaBancaria[]>(),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("razao_social"),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social")
      .eq("tenant_id", tenantId)
      .eq("status", "ativo")
      .order("nome"),
    // Códigos dos jobs cobertos pelas notas e a lista do "Job de
    // referência" do avulso. Limite alto o bastante para o histórico e
    // baixo o bastante para não virar varredura.
    supabase
      .from("jobs")
      .select("id, codigo, nome")
      .eq("tenant_id", tenantId)
      .order("codigo", { ascending: false })
      .limit(500),
    // O que a produção mandou no envio para faturamento: a PO e a instrução
    // do GP sobre como a nota deve ser descrita. É o conteúdo do botão `i`
    // (31/08/2026). Um registro por job, tabela pequena — entra na mesma
    // onda paralela, sem custo de ida e volta extra.
    supabase
      .from("jobs_envio_faturamento")
      .select("job_id, numero_po, descricao_nf")
      .eq("tenant_id", tenantId),
  ]);

  for (const [nome, res] of [
    ["pendentes", pendentesRes],
    ["faturados", faturadosRes],
    ["titulos", titulosRes],
    ["envios", enviosRes],
  ] as const) {
    if (res.error) console.error(`[cr.${nome}]`, res.error.message);
  }

  const clientesList = (clientesRes.data ?? []).map(
    (c: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
      id: c.id,
      nome: c.razao_social ?? c.nome_fantasia ?? "",
    }),
  );
  const fornecedoresList = (fornecedoresRes.data ?? []).map(
    (f: { id: string; nome: string; razao_social: string | null }) => ({
      id: f.id,
      nome: f.razao_social ?? f.nome,
    }),
  );
  const empresasList = (empresasRes.data ?? []).map(
    (e: { id: string; razao_social: string | null; nome_fantasia: string | null }) => ({
      id: e.id,
      nome: e.razao_social ?? e.nome_fantasia ?? "",
    }),
  );
  const jobsList = (jobsRes.data ?? []) as Array<{
    id: string;
    codigo: string;
    nome: string;
  }>;

  const nomeCliente = new Map(clientesList.map((c) => [c.id, c.nome]));
  const nomeFornecedor = new Map(fornecedoresList.map((f) => [f.id, f.nome]));
  const jobPorId = new Map(jobsList.map((j) => [j.id, j]));

  // Quem cobrar, por job (docs/decisions/012). Uma query só para a tela
  // inteira — depende de `jobsList`, por isso não cabe na onda paralela
  // de cima. Job anterior a 17/08/2026 não aparece no mapa.
  const contatosPorJob = await contatosDeCobrancaPorJob(
    jobsList.map((j) => j.id),
    session.activeTenant.id,
  );

  /**
   * O que o botão `i` mostra de cada job: PO, a instrução do GP sobre a
   * descrição da nota e a quem cobrar.
   *
   * Só entra job que TEM envio para faturamento — BV não tem, e é por isso
   * que a chave é o `job_id` e não a linha da tabela. Job sem entrada aqui
   * cai nos vazios do modal, que são estado legítimo e não erro.
   */
  const infoPorJob: Record<string, InfoJob> = {};
  for (const e of (enviosRes.data ?? []) as unknown as Array<{
    job_id: string;
    numero_po: string | null;
    descricao_nf: string | null;
  }>) {
    infoPorJob[e.job_id] = {
      po: e.numero_po,
      descricaoNf: e.descricao_nf,
      contatos: contatosPorJob.get(e.job_id) ?? [],
    };
  }
  // Job com contato mas sem envio ainda não aparece na fila de faturamento,
  // então não precisa de entrada — mas a nota já emitida pode reabrir em
  // leitura apontando para um job cujo envio foi apagado. Completa o mapa
  // para o modal não ficar sem os contatos nesse caso.
  for (const [jobId, contatos] of contatosPorJob) {
    if (!infoPorJob[jobId]) {
      infoPorJob[jobId] = { po: null, descricaoNf: null, contatos };
    }
  }

  // --- Aba Faturamento: pendentes -----------------------------------------

  const pendentes: FaturamentoPendenteRow[] = (pendentesRes.data ?? []).map((r) => {
    const clienteId = (r.cliente_id as string | null) ?? null;
    const fornecedorId = (r.fornecedor_id as string | null) ?? null;
    return {
      origem_tipo: r.origem_tipo as FaturamentoPendenteRow["origem_tipo"],
      origem_id: r.origem_id as string,
      envio_parcela_id: (r.envio_parcela_id as string | null) ?? null,
      empresa_id: (r.empresa_id as string | null) ?? "",
      codigo: (r.codigo as string | null) ?? null,
      descricao: r.descricao as string,
      cliente_id: clienteId,
      fornecedor_id: fornecedorId,
      contraparte_nome:
        (fornecedorId ? nomeFornecedor.get(fornecedorId) : nomeCliente.get(clienteId ?? "")) ??
        "—",
      valor_previsto: Number(r.valor_previsto),
      valor_ja_faturado: Number(r.valor_ja_faturado),
      saldo: Number(r.saldo),
      saldo_job: Number(r.saldo_job ?? r.saldo),
      // Sem save, `saldo_proprio` é o próprio saldo — o `??` cobre a
      // janela entre o deploy do código e o da view.
      saldo_proprio: Number(r.saldo_proprio ?? r.saldo),
      saldo_save: Number(r.saldo_save ?? 0),
      parcela_numero: Number(r.parcela_numero ?? 1),
      parcela_total: Number(r.parcela_total ?? 1),
      data_prevista: (r.data_prevista as string | null) ?? null,
      // BV não tem job, logo não tem contato de cobrança do job.
      contatos:
        r.origem_tipo === "job"
          ? (contatosPorJob.get(r.origem_id as string) ?? [])
          : [],
    };
  });

  // --- Aba Faturamento: notas já emitidas ---------------------------------

  type FaturamentoBruto = {
    id: string;
    numero_nf: string;
    data_emissao: string;
    valor_total: string | number;
    descricao: string;
    cnae: string;
    anexo_nf_path: string;
    empresa_id: string;
    origem_tipo: "job" | "bv" | "avulso";
    cliente_id: string | null;
    fornecedor_id: string | null;
    plano_conta_tipo_id: string | null;
    plano_conta_subtipo_id: string | null;
    itens: Array<{
      id: string;
      origem_tipo: "job" | "bv" | "avulso" | "save";
      origem_id: string | null;
      envio_parcela_id: string | null;
      valor: string | number;
    }>;
  };

  const faturadosBrutos = (faturadosRes.data ?? []) as unknown as FaturamentoBruto[];

  // Quantas parcelas de recebimento cada nota tem, e qual a 1ª a vencer —
  // as duas colunas que a linha verde mostra.
  // Guardamos as parcelas em si, e não só a contagem: o formulário em
  // modo leitura precisa listar valor e vencimento de cada uma
  // (18/08/2026 — antes ele inventava uma parcela com o total da nota).
  const parcelasPorNota = new Map<
    string,
    {
      qtd: number;
      primeiroVenc: string | null;
      parcelas: Array<{ numero: number; valor: number; data_vencimento: string }>;
    }
  >();
  for (const t of (titulosRes.data ?? []) as unknown as Array<{
    faturamento_id: string;
    numero_parcela: number;
    valor: string | number;
    data_vencimento: string;
    status: TituloReceberStatus;
  }>) {
    if (t.status === "cancelado") continue;
    const atual =
      parcelasPorNota.get(t.faturamento_id) ??
      { qtd: 0, primeiroVenc: null, parcelas: [] };
    atual.qtd += 1;
    if (!atual.primeiroVenc || t.data_vencimento < atual.primeiroVenc) {
      atual.primeiroVenc = t.data_vencimento;
    }
    atual.parcelas.push({
      numero: t.numero_parcela,
      valor: Number(t.valor),
      data_vencimento: t.data_vencimento,
    });
    parcelasPorNota.set(t.faturamento_id, atual);
  }
  for (const p of parcelasPorNota.values()) {
    p.parcelas.sort((a, b) => a.numero - b.numero);
  }

  const faturados: FaturadoRow[] = faturadosBrutos.map((f) => {
    const parc = parcelasPorNota.get(f.id);
    return {
      faturamento_id: f.id,
      numero_nf: f.numero_nf,
      data_emissao: f.data_emissao,
      valor_total: Number(f.valor_total),
      descricao: f.descricao,
      anexo_nf_path: f.anexo_nf_path,
      empresa_id: f.empresa_id,
      origem_tipo: f.origem_tipo,
      contraparte_nome:
        (f.fornecedor_id
          ? nomeFornecedor.get(f.fornecedor_id)
          : nomeCliente.get(f.cliente_id ?? "")) ?? "—",
      cliente_id: f.cliente_id,
      qtd_parcelas: parc?.qtd ?? 1,
      primeiro_vencimento: parc?.primeiroVenc ?? null,
      parcelas: parc?.parcelas ?? [],
      cnae: f.cnae,
      itens: f.itens.map((i) => {
        const job = i.origem_id ? jobPorId.get(i.origem_id) : undefined;
        return {
          origem_tipo: i.origem_tipo,
          origem_id: i.origem_id,
          codigo: job?.codigo ?? (i.origem_tipo === "bv" ? "BV" : "Avulso"),
          // Item de save aponta para o mesmo job do item próprio; o que
          // os separa é o tipo. Sem isto a nota mostra o job duas vezes.
          descricao:
            i.origem_tipo === "save"
              ? "Saldo em save — crédito do cliente"
              : (job?.nome ?? f.descricao),
          valor: Number(i.valor),
        };
      }),
    };
  });

  // --- Aba Títulos a Receber ----------------------------------------------

  const detalheBaixa = new Map<string, { conta: string; centro: string }>();
  for (const l of (baixasRes.data ?? []) as unknown as Array<{
    titulo_receber_id: string | null;
    conta: { nome: string; banco: string } | null;
    tipo: { codigo: string; nome: string } | null;
    subtipo: { nome: string } | null;
  }>) {
    if (!l.titulo_receber_id) continue;
    detalheBaixa.set(l.titulo_receber_id, {
      conta: l.conta ? `${l.conta.nome} · ${l.conta.banco}` : "—",
      centro: l.tipo
        ? `${l.tipo.codigo} · ${l.subtipo?.nome ?? l.tipo.nome}`
        : "—",
    });
  }

  const titulosRows: TituloRow[] = ((titulosRes.data ?? []) as unknown as Array<{
    id: string;
    numero_parcela: number;
    valor: string | number;
    data_vencimento: string;
    data_previsao_recebimento: string | null;
    data_previsao_recebimento_primeira: string | null;
    status: TituloReceberStatus;
    pago_em: string | null;
    empresa_id: string;
    faturamento_id: string;
    faturamento: {
      numero_nf: string;
      data_emissao: string;
      descricao: string;
      status: "emitido" | "cancelado";
      origem_tipo: "job" | "bv" | "avulso";
      cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
      fornecedor: { nome: string | null; razao_social: string | null } | null;
      itens: Array<{
        origem_tipo: "job" | "bv" | "avulso" | "save";
        origem_id: string | null;
        envio_parcela_id: string | null;
        valor: string | number;
      }>;
    };
  }>).map((r) => {
    const baixa = detalheBaixa.get(r.id);
    const itens = r.faturamento.itens ?? [];
    return {
      id: r.id,
      numero_parcela: r.numero_parcela,
      total_parcelas: parcelasPorNota.get(r.faturamento_id)?.qtd ?? 1,
      valor: Number(r.valor),
      data_vencimento: r.data_vencimento,
      data_previsao_recebimento: r.data_previsao_recebimento ?? r.data_vencimento,
      data_previsao_recebimento_primeira:
        r.data_previsao_recebimento_primeira ?? r.data_vencimento,
      status: r.status,
      pago_em: r.pago_em,
      empresa_id: r.empresa_id,
      faturamento_id: r.faturamento_id,
      fat_numero_nf: r.faturamento.numero_nf,
      fat_data_emissao: r.faturamento.data_emissao,
      fat_descricao: r.faturamento.descricao,
      contraparte_nome:
        r.faturamento.fornecedor?.razao_social ??
        r.faturamento.fornecedor?.nome ??
        r.faturamento.cliente?.razao_social ??
        r.faturamento.cliente?.nome_fantasia ??
        "—",
      jobs_cobertos:
        itens.length === 0
          ? [r.faturamento.descricao]
          : itens.map((i) => {
              const job = i.origem_id ? jobPorId.get(i.origem_id) : undefined;
              if (!job) {
                return i.origem_tipo === "bv"
                  ? `BV · ${r.faturamento.descricao}`
                  : `Avulso · ${r.faturamento.descricao}`;
              }
              // Item de save aponta para o MESMO job do item próprio — o
              // que os separa é o tipo. Sem rótulo, a nota listaria o job
              // duas vezes e ninguém saberia que parte virou crédito.
              return i.origem_tipo === "save"
                ? `${job.codigo} · saldo em save`
                : `${job.codigo} ${job.nome}`;
            }),
      // Quantos JOBS distintos a nota cobre — e não quantos itens ela tem.
      // A nota com save tem dois itens do MESMO job (o próprio e o saldo
      // em save), e contá-los como dois jobs faria a nota de um job só se
      // anunciar como agrupada (decisão 017 × decisão 028).
      qtd_jobs: new Set(
        itens.map((i) => i.origem_id).filter((id): id is string => !!id),
      ).size,
      // NF agrupada cobre vários jobs (decisão 017): junta os contatos de
      // todos eles, sem repetir o mesmo e-mail duas vezes.
      contatos: dedupContatos(
        itens.flatMap((i) =>
          i.origem_id ? (contatosPorJob.get(i.origem_id) ?? []) : [],
        ),
      ),
      conta_nome: baixa?.conta ?? null,
      centro_nome: baixa?.centro ?? null,
    };
  });

  // Próximo número sugerido: o maior já emitido + 1. Quem decide é o
  // usuário — o campo vem preenchido, e é editável.
  const maiorNf = faturadosBrutos.reduce((max, f) => {
    const n = Number(f.numero_nf.replace(/\D/g, ""));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const proximoNf = maiorNf > 0 ? String(maiorNf + 1) : "";

  // Mais largo que o padrao do app (max-w-7xl = 1280px), na mesma largura
  // do Fluxo de Caixa: a tabela de Titulos a Receber precisa de 1426px e
  // era cortada em 1280 desde que nasceu, e a de Faturamento (1371px)
  // perdeu a coluna de acao quando o contato de cobranca passou a ocupar a
  // celula do cliente (decisao 012).
  //
  // O numero 1560 e teto declarado, nao largura efetiva: o proprio layout
  // (`app/(app)/layout.tsx`, max-w-[1600px] + px-8) ja limita o conteudo a
  // 1536px, entao 1560 e 1600 renderizam identicos e a folga lateral vem
  // do padding do layout. Fica 1560 por igualdade com o Fluxo de Caixa.
  //
  // As duas tabelas cabem inteiras a partir de ~1570px de viewport. Abaixo
  // disso elas rolam DENTRO da propria caixa (`overflow-x-auto`) — a
  // pagina nunca rola na horizontal.
  return (
    <div className="mx-auto max-w-[1560px] space-y-8">
      <div>
        <Link
          href="/financeiro"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para central financeira
        </Link>
      </div>
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground text-pretty">
          Jobs e BVs aguardando nota fiscal, e os títulos já faturados. Fature um
          job por vez ou use o{" "}
          <strong className="font-semibold text-foreground">
            Faturamento Agrupado
          </strong>{" "}
          para emitir uma única NF cobrindo vários jobs do mesmo cliente.
        </p>
      </header>

      <ContasReceberTabs
        faturamento={
          <FaturamentoList
            pendentes={pendentes}
            faturados={faturados}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            empresas={empresasList}
            clientes={clientesList}
            fornecedores={fornecedoresList}
            jobs={jobsList}
            proximoNf={proximoNf}
            infoPorJob={infoPorJob}
          />
        }
        faturamentoCount={pendentes.length}
        titulos={
          <TitulosList
            rows={titulosRows}
            contas={contasRes.data ?? []}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
          />
        }
        titulosCount={titulosRows.filter((t) => t.status === "em_aberto").length}
      />
    </div>
  );
}

/**
 * Uma NF agrupada pode cobrir vários jobs do mesmo cliente, e o mesmo
 * contato costuma responder por todos. Repetir o nome três vezes na
 * linha do título não informa nada — a chave é o e-mail, que é o que o
 * financeiro usa para cobrar; contato sem e-mail cai no nome.
 */
function dedupContatos(lista: ContatoCobranca[]): ContatoCobranca[] {
  const vistos = new Set<string>();
  const saida: ContatoCobranca[] = [];
  for (const c of lista) {
    const chave = (c.email || c.nome || "").trim().toLowerCase();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(c);
  }
  return saida;
}
