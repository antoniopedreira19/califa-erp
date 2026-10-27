import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  Gift,
  Users,
  Wallet,
  Calculator,
  CheckCircle2,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { pode } from "@/lib/permissoes";
import { TabelaLinhas, type LinhaRow } from "./tabela-linhas";
import { BotaoExportar } from "./botao-exportar";
import { BotaoRecalcular } from "./botao-recalcular";
import { BotaoFecharParcela } from "./botao-fechar-parcela";

export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

interface Props {
  params: { ano: string };
}

export default async function DecimoTerceiroDetalhePage({ params }: Props) {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }
  const ano = Number(params.ano);
  if (!Number.isInteger(ano) || ano < 2020 || ano > 2100) {
    notFound();
  }

  const supabase = createClient();

  const { data: folha, error: errFolha } = await supabase
    .from("decimo_terceiro_folhas")
    .select("id, ano, status, criada_em, recalculada_em")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ano", ano)
    .maybeSingle();

  if (errFolha) {
    console.error("[rh.decimo-terceiro.detalhe] folha:", errFolha.message);
  }
  if (!folha) {
    notFound();
  }

  const { data: linhasRaw, error: errLinhas } = await supabase
    .from("decimo_terceiro_linhas")
    .select(
      `id, snapshot_nome, snapshot_cpf, snapshot_tipo_contratacao,
       snapshot_funcao, snapshot_data_admissao, snapshot_salario,
       snapshot_valor_recibo, snapshot_empresa_id, avos, total_adiantado,
       primeira_parcela, segunda_parcela, desconto_inss, desconto_irrf,
       total_bruto, total_liquido,
       parte_clt_primeira_parcela, parte_clt_segunda_parcela,
       parte_clt_desconto_inss, parte_clt_desconto_irrf, parte_clt_total_liquido,
       parte_pj_primeira_parcela, parte_pj_segunda_parcela, parte_pj_total_liquido,
       editado_manualmente, salario_editado, avos_editado, obs,
       teve_reajuste_no_ano,
       empresa:empresas!decimo_terceiro_linhas_snapshot_empresa_id_fkey(nome_fantasia)`,
    )
    .eq("folha_id", folha.id)
    .eq("tenant_id", session.activeTenant.id)
    .order("snapshot_nome", { ascending: true });

  if (errLinhas) {
    console.error("[rh.decimo-terceiro.detalhe] linhas:", errLinhas.message);
    throw new Error(`Falha ao carregar linhas da folha: ${errLinhas.message}`);
  }

  type EmpresaEmbed = { nome_fantasia: string } | { nome_fantasia: string }[] | null;
  interface LinhaRaw {
    id: string;
    snapshot_nome: string;
    snapshot_cpf: string | null;
    snapshot_tipo_contratacao: string;
    snapshot_funcao: string;
    snapshot_data_admissao: string;
    snapshot_salario: string;
    snapshot_valor_recibo: string | null;
    snapshot_empresa_id: string | null;
    avos: number;
    total_adiantado: string;
    primeira_parcela: string;
    segunda_parcela: string;
    desconto_inss: string;
    desconto_irrf: string;
    total_bruto: string;
    total_liquido: string;
    parte_clt_primeira_parcela: string | null;
    parte_clt_segunda_parcela: string | null;
    parte_clt_desconto_inss: string | null;
    parte_clt_desconto_irrf: string | null;
    parte_clt_total_liquido: string | null;
    parte_pj_primeira_parcela: string | null;
    parte_pj_segunda_parcela: string | null;
    parte_pj_total_liquido: string | null;
    editado_manualmente: boolean;
    salario_editado: string | null;
    avos_editado: number | null;
    obs: string | null;
    teve_reajuste_no_ano: boolean;
    empresa: EmpresaEmbed;
  }

  const linhas: LinhaRow[] = ((linhasRaw ?? []) as LinhaRaw[]).map((l) => {
    const empresa = Array.isArray(l.empresa) ? l.empresa[0] : l.empresa;
    const parteClt =
      l.parte_clt_primeira_parcela != null
        ? {
            primeira_parcela: Number(l.parte_clt_primeira_parcela),
            segunda_parcela: Number(l.parte_clt_segunda_parcela ?? 0),
            desconto_inss: Number(l.parte_clt_desconto_inss ?? 0),
            desconto_irrf: Number(l.parte_clt_desconto_irrf ?? 0),
            total_liquido: Number(l.parte_clt_total_liquido ?? 0),
          }
        : null;
    const partePj =
      l.parte_pj_primeira_parcela != null
        ? {
            primeira_parcela: Number(l.parte_pj_primeira_parcela),
            segunda_parcela: Number(l.parte_pj_segunda_parcela ?? 0),
            desconto_inss: 0,
            desconto_irrf: 0,
            total_liquido: Number(l.parte_pj_total_liquido ?? 0),
          }
        : null;
    return {
      id: l.id,
      nome: l.snapshot_nome,
      empresa: empresa?.nome_fantasia ?? null,
      tipo_contratacao: l.snapshot_tipo_contratacao,
      data_admissao: l.snapshot_data_admissao,
      salario: Number(l.snapshot_salario),
      valor_recibo:
        l.snapshot_valor_recibo != null ? Number(l.snapshot_valor_recibo) : null,
      avos: l.avos,
      primeira_parcela: Number(l.primeira_parcela),
      segunda_parcela: Number(l.segunda_parcela),
      desconto_inss: Number(l.desconto_inss),
      desconto_irrf: Number(l.desconto_irrf),
      total_liquido: Number(l.total_liquido),
      parte_clt: parteClt,
      parte_pj: partePj,
      editado_manualmente: l.editado_manualmente,
      salario_editado: l.salario_editado != null ? Number(l.salario_editado) : null,
      avos_editado: l.avos_editado,
      obs: l.obs,
      teve_reajuste_no_ano: l.teve_reajuste_no_ano,
    };
  });

  const totalLinhas = linhas.length;
  const total1a = linhas.reduce((acc, l) => acc + l.primeira_parcela, 0);
  const total2a = linhas.reduce((acc, l) => acc + l.segunda_parcela, 0);
  const totalLiquido = linhas.reduce((acc, l) => acc + l.total_liquido, 0);

  const podeEditar = pode(session.activeRole, "rh.decimo_terceiro.editar");
  const podeRecalcular = podeEditar && folha.status === "rascunho";
  const podeFechar1a = podeEditar && folha.status === "rascunho";
  const podeFechar2a = podeEditar && folha.status === "fechada_parcial_1";

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh/decimo-terceiro" />

      <PageHeader
        title={`13º ${folha.ano}`}
        description={descricaoDoStatus(folha.status, totalLinhas)}
        icon={Gift}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/rh/decimo-terceiro/${folha.ano}/adiantamentos`}
              prefetch={false}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-colors"
            >
              <Wallet className="h-4 w-4" />
              Adiantamentos
            </Link>
            <BotaoExportar folhaId={folha.id} />
            {podeRecalcular && <BotaoRecalcular folhaId={folha.id} />}
            {podeFechar1a && <BotaoFecharParcela folhaId={folha.id} numero={1} />}
            {podeFechar2a && <BotaoFecharParcela folhaId={folha.id} numero={2} />}
            {folha.status === "fechada_parcial_2" && (
              <span className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Parcelas enviadas
              </span>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Colaboradores" value={String(totalLinhas)} />
        <KpiCard
          icon={Calculator}
          label="Total 1ª parcela"
          value={brl.format(total1a)}
          sublabel="paga em 30/11"
        />
        <KpiCard
          icon={Calculator}
          label="Total 2ª parcela"
          value={brl.format(total2a)}
          sublabel="paga em 20/12"
        />
        <KpiCard
          icon={Wallet}
          label="Total líquido"
          value={brl.format(totalLiquido)}
          highlight
        />
      </div>

      <TabelaLinhas
        linhas={linhas}
        podeEditar={podeEditar && folha.status === "rascunho"}
      />
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sublabel,
  highlight,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${highlight ? "bg-california-red/10 text-california-red" : "bg-muted text-muted-foreground"}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p
        className={`mt-3 text-2xl font-bold tabular-nums ${highlight ? "text-california-red" : "text-foreground"}`}
      >
        {value}
      </p>
      {sublabel && (
        <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>
      )}
    </div>
  );
}

function descricaoDoStatus(status: string, totalLinhas: number): string {
  const n = `${totalLinhas} ${totalLinhas === 1 ? "colaborador" : "colaboradores"}`;
  switch (status) {
    case "rascunho":
      return `${n} na folha. Clique numa linha para editar o cálculo. Quando estiver tudo pronto, feche a 1ª parcela para enviar ao financeiro.`;
    case "fechada_parcial_1":
      return `${n}. 1ª parcela enviada ao financeiro — aguardando aprovação. Quando aprovada e paga, feche a 2ª parcela.`;
    case "fechada_parcial_2":
      return `${n}. Ambas as parcelas enviadas ao financeiro. Acompanhe a aprovação em Contas a Pagar.`;
    case "concluida":
      return `${n}. Folha concluída.`;
    default:
      return `${n} na folha.`;
  }
}
