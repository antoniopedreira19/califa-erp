import { notFound, redirect } from "next/navigation";
import {
  Gift,
  Users,
  Wallet,
  Calculator,
  RefreshCw,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { pode } from "@/lib/permissoes";
import { recalcularFolhaDecimoTerceiro } from "../actions";
import { TabelaLinhas, type LinhaRow } from "./tabela-linhas";
import { BotaoExportar } from "./botao-exportar";

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
       snapshot_empresa_id, avos, total_adiantado, primeira_parcela,
       segunda_parcela, desconto_inss, desconto_irrf, total_bruto,
       total_liquido, editado_manualmente, salario_editado, avos_editado,
       obs,
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
    snapshot_empresa_id: string | null;
    avos: number;
    total_adiantado: string;
    primeira_parcela: string;
    segunda_parcela: string;
    desconto_inss: string;
    desconto_irrf: string;
    total_bruto: string;
    total_liquido: string;
    editado_manualmente: boolean;
    salario_editado: string | null;
    avos_editado: number | null;
    obs: string | null;
    empresa: EmpresaEmbed;
  }

  const linhas: LinhaRow[] = ((linhasRaw ?? []) as LinhaRaw[]).map((l) => {
    const empresa = Array.isArray(l.empresa) ? l.empresa[0] : l.empresa;
    return {
      id: l.id,
      nome: l.snapshot_nome,
      empresa: empresa?.nome_fantasia ?? null,
      tipo_contratacao: l.snapshot_tipo_contratacao,
      data_admissao: l.snapshot_data_admissao,
      salario: Number(l.snapshot_salario),
      avos: l.avos,
      primeira_parcela: Number(l.primeira_parcela),
      segunda_parcela: Number(l.segunda_parcela),
      desconto_inss: Number(l.desconto_inss),
      desconto_irrf: Number(l.desconto_irrf),
      total_liquido: Number(l.total_liquido),
      editado_manualmente: l.editado_manualmente,
      salario_editado: l.salario_editado != null ? Number(l.salario_editado) : null,
      avos_editado: l.avos_editado,
      obs: l.obs,
    };
  });

  const totalLinhas = linhas.length;
  const total1a = linhas.reduce((acc, l) => acc + l.primeira_parcela, 0);
  const total2a = linhas.reduce((acc, l) => acc + l.segunda_parcela, 0);
  const totalLiquido = linhas.reduce((acc, l) => acc + l.total_liquido, 0);

  const podeEditar = pode(session.activeRole, "rh.decimo_terceiro.editar");

  async function recalcular() {
    "use server";
    await recalcularFolhaDecimoTerceiro(folha!.id);
  }

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh/decimo-terceiro" />

      <PageHeader
        eyebrow="RH · 13º Salário"
        title={`13º ${folha.ano}`}
        description={`${totalLinhas} ${totalLinhas === 1 ? "colaborador" : "colaboradores"} na folha. Clique numa linha para editar o cálculo.`}
        icon={Gift}
        actions={
          <div className="flex items-center gap-2">
            <BotaoExportar folhaId={folha.id} />
            {podeEditar && (
              <form action={recalcular}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Recalcular folha
                </button>
              </form>
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

      <TabelaLinhas linhas={linhas} podeEditar={podeEditar} />
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
