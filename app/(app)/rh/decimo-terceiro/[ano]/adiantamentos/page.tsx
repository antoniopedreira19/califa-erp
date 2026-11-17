import { notFound, redirect } from "next/navigation";
import { Wallet, Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { pode } from "@/lib/permissoes";
import { ListaAdiantamentos, type AdiantamentoRow, type ColabOpcao } from "./lista-adiantamentos";

export const dynamic = "force-dynamic";

interface Props {
  params: { ano: string };
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function AdiantamentosPage({ params }: Props) {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }
  const ano = Number(params.ano);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) {
    notFound();
  }

  const supabase = createClient();

  const [adiantRes, colabsRes] = await Promise.all([
    supabase
      .from("decimo_terceiro_adiantamentos")
      .select(
        `id, ano, colaborador_id, data, valor, obs, integral, folha_pagamento_id,
         colaborador:colaboradores!decimo_terceiro_adiantamentos_colaborador_id_fkey(nome, funcao, tipo_contratacao)`,
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("ano", ano)
      .order("data", { ascending: false }),
    supabase
      .from("colaboradores")
      .select("id, nome, tipo_contratacao")
      .eq("tenant_id", session.activeTenant.id)
      .in("tipo_contratacao", ["clt", "clt_recibo", "pj", "mei"])
      .eq("status", "ativo")
      .order("nome", { ascending: true }),
  ]);

  if (adiantRes.error) {
    console.error("[13o.adiantamentos.page]", adiantRes.error.message);
    throw new Error(`Falha ao carregar adiantamentos: ${adiantRes.error.message}`);
  }

  const adiantIds = (adiantRes.data ?? []).map((a) => a.id);

  // Busca todas as folhas de pagamento vinculadas aos adiantamentos pela
  // FK reversa. Híbridos têm 2 (CLT contabilidade + PJ california);
  // PJ/MEI/CLT puro têm 1; legados têm 0. Precisamos do split na UI
  // (linha expansível) + status combinado.
  const folhasPorAdiant = new Map<
    string,
    Array<{ id: string; status: string; origem: string; salario_base: number }>
  >();
  if (adiantIds.length > 0) {
    const { data: folhasRows } = await supabase
      .from("folhas_pagamento")
      .select("id, status, origem, salario_base, decimo_terceiro_adiantamento_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("tipo", "decimo_terceiro_adiantamento")
      .in("decimo_terceiro_adiantamento_id", adiantIds);
    for (const f of folhasRows ?? []) {
      if (!f.decimo_terceiro_adiantamento_id) continue;
      const arr = folhasPorAdiant.get(f.decimo_terceiro_adiantamento_id) ?? [];
      arr.push({
        id: f.id,
        status: f.status,
        origem: f.origem,
        salario_base: Number(f.salario_base),
      });
      folhasPorAdiant.set(f.decimo_terceiro_adiantamento_id, arr);
    }
  }

  // Pra híbridos LEGADOS (sem folhas vinculadas), calcula o split em
  // runtime usando o salário vigente do colaborador — assim a linha
  // expansível aparece sempre que o colaborador for clt_recibo,
  // independente de ter folha ativa ou não.
  const hibridosSemFolhas = new Set<string>();
  for (const a of adiantRes.data ?? []) {
    const colab = Array.isArray(a.colaborador) ? a.colaborador[0] : a.colaborador;
    if (
      colab?.tipo_contratacao === "clt_recibo" &&
      (folhasPorAdiant.get(a.id) ?? []).length === 0
    ) {
      hibridosSemFolhas.add(a.colaborador_id);
    }
  }
  const salarioPorHibrido = new Map<string, { salario: number; valor_recibo: number }>();
  if (hibridosSemFolhas.size > 0) {
    const { data: salsHibridos } = await supabase
      .from("colaboradores_salarios")
      .select("colaborador_id, valor, valor_recibo")
      .eq("tenant_id", session.activeTenant.id)
      .is("data_fim", null)
      .in("colaborador_id", Array.from(hibridosSemFolhas));
    for (const s of salsHibridos ?? []) {
      salarioPorHibrido.set(s.colaborador_id, {
        salario: Number(s.valor),
        valor_recibo: s.valor_recibo != null ? Number(s.valor_recibo) : 0,
      });
    }
  }

  // Busca NFs de adiantamentos de 13° em lote (evita N+1)
  const nfSet = new Set<string>();
  if (adiantIds.length > 0) {
    const { data: nfRows } = await supabase
      .from("colaboradores_nf_anexos")
      .select("escopo_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("escopo_tipo", "decimo_terceiro_adiantamento")
      .in("escopo_id", adiantIds);
    for (const row of nfRows ?? []) {
      if (row.escopo_id) nfSet.add(row.escopo_id);
    }
  }

  type ColabEmbed =
    | { nome: string; funcao: string; tipo_contratacao: string }
    | { nome: string; funcao: string; tipo_contratacao: string }[]
    | null;
  interface AdiantamentoRaw {
    id: string;
    ano: number;
    colaborador_id: string;
    data: string;
    valor: string;
    obs: string | null;
    integral: boolean;
    folha_pagamento_id: string | null;
    colaborador: ColabEmbed;
  }

  // Combina o status das folhas em UM status representativo: a de pior
  // prioridade vence (enviada < pendente_correcao < aprovada < paga).
  // Assim a label reflete o estado "mais atrás" no fluxo, que é o que
  // o usuário precisa agir.
  const prioridade: Record<string, number> = {
    enviada: 0,
    pendente_correcao: 1,
    aprovada: 2,
    paga: 3,
  };
  function statusCombinado(
    folhas: Array<{ status: string }>,
  ): string | null {
    if (folhas.length === 0) return null;
    return folhas.reduce((pior, f) =>
      (prioridade[f.status] ?? 99) < (prioridade[pior.status] ?? 99) ? f : pior,
    ).status;
  }

  const adiantamentos: AdiantamentoRow[] = ((adiantRes.data ?? []) as AdiantamentoRaw[]).map((a) => {
    const colab = Array.isArray(a.colaborador) ? a.colaborador[0] : a.colaborador;
    const folhasDoAdiant = folhasPorAdiant.get(a.id) ?? [];
    const valorNum = Number(a.valor);

    // Partes: vem das folhas quando existem (híbrido novo).
    // Pra híbrido legado (sem folhas), calcula em runtime pelo salário
    // vigente. Mesma fórmula do montarFolhasAdiantamento.
    let partes: Array<{
      origem: string;
      salario_base: number;
      status: string | null;
      tem_nf: boolean;
    }> = folhasDoAdiant
      .map((f) => ({
        origem: f.origem,
        salario_base: f.salario_base,
        status: f.status,
        // Só origem california (parte PJ) exige NF. tem_nf do adiantamento
        // já reflete a NF anexada ao escopo decimo_terceiro_adiantamento.
        tem_nf: f.origem === "california" ? nfSet.has(a.id) : false,
      }))
      .sort((x, y) => x.origem.localeCompare(y.origem));

    if (
      partes.length === 0 &&
      colab?.tipo_contratacao === "clt_recibo"
    ) {
      const sal = salarioPorHibrido.get(a.colaborador_id);
      if (sal && sal.salario > 0 && sal.valor_recibo > 0 && sal.valor_recibo <= sal.salario) {
        const parteClt = Math.round((valorNum * (sal.salario - sal.valor_recibo)) / sal.salario * 100) / 100;
        const partePj = Math.round((valorNum - parteClt) * 100) / 100;
        const calculadas: typeof partes = [];
        if (partePj > 0) calculadas.push({ origem: "california", salario_base: partePj, status: null, tem_nf: false });
        if (parteClt > 0) calculadas.push({ origem: "contabilidade", salario_base: parteClt, status: null, tem_nf: false });
        partes = calculadas.sort((x, y) => x.origem.localeCompare(y.origem));
      }
    }

    return {
      id: a.id,
      colaborador_id: a.colaborador_id,
      colaborador_nome: colab?.nome ?? "—",
      colaborador_funcao: colab?.funcao ?? "",
      colaborador_tipo: colab?.tipo_contratacao ?? "",
      data: a.data,
      valor: valorNum,
      obs: a.obs,
      integral: a.integral,
      folha_pagamento_id: a.folha_pagamento_id,
      folha_status: statusCombinado(folhasDoAdiant),
      tem_nf: nfSet.has(a.id),
      partes,
    };
  });

  const colabOpcoes: ColabOpcao[] = ((colabsRes.data ?? []) as ColabOpcao[]).map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo_contratacao: c.tipo_contratacao,
  }));

  const totalAno = adiantamentos.reduce((acc, a) => acc + a.valor, 0);
  const podeEditar = pode(session.activeRole, "rh.decimo_terceiro.editar");

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva={`/rh/decimo-terceiro/${ano}`} />

      <PageHeader
        eyebrow={`RH · 13º Salário · ${ano}`}
        title="Adiantamentos"
        description={`${adiantamentos.length} ${adiantamentos.length === 1 ? "adiantamento registrado" : "adiantamentos registrados"} em ${ano}. Cada lançamento vai pro financeiro como Despesa com Pessoal · 13° Salário e abate automaticamente da 1ª parcela.`}
        icon={Wallet}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Total adiantado em {ano}
            </span>
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums text-california-red">
            {brl.format(totalAno)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Nº de lançamentos
            </span>
            <Receipt className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-2xl font-bold tabular-nums">{adiantamentos.length}</p>
        </div>
      </div>

      <ListaAdiantamentos
        ano={ano}
        adiantamentos={adiantamentos}
        colaboradores={colabOpcoes}
        podeEditar={podeEditar}
      />
    </div>
  );
}
