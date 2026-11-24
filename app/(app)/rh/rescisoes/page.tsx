import { redirect } from "next/navigation";
import {
  FileSignature,
  Clock,
  Wallet,
  Send,
  CheckCircle2,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { EmptyState } from "@/components/empty-state";
import type { TipoContratacao } from "@/lib/types";
import { RescisoesView, type RescisaoLinha } from "./_components/rescisoes-view";

export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export default async function RescisoesPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();
  const tenantId = session.activeTenant.id;

  // Carrega todas as rescisões (todos status) + dados do colaborador.
  // Rescisões canceladas não aparecem no default (tab "Pendentes"), mas
  // continuam acessíveis na tab "Todas" pra auditoria.
  const { data: rescisoesRaw, error } = await supabase
    .from("rescisoes")
    .select(
      `
      id,
      status,
      data_rescisao,
      salario_vigente,
      saldo_salario_dias,
      saldo_salario_valor,
      avos_ferias,
      valor_ferias,
      valor_um_terco_ferias,
      avos_decimo,
      valor_decimo_terceiro,
      ajuste_valor,
      ajuste_motivo,
      total_bruto,
      total_liquido,
      conta_avulsa_id,
      enviada_em,
      paga_em,
      colaborador:colaboradores!colaborador_id(
        id, nome, cpf, tipo_contratacao, data_admissao
      )
      `,
    )
    .eq("tenant_id", tenantId)
    .order("data_rescisao", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[rh.rescisoes.page]", error.message);
  }

  type Row = {
    id: string;
    status: RescisaoLinha["status"];
    data_rescisao: string;
    salario_vigente: string | number | null;
    saldo_salario_dias: number | null;
    saldo_salario_valor: string | number | null;
    avos_ferias: number | null;
    valor_ferias: string | number | null;
    valor_um_terco_ferias: string | number | null;
    avos_decimo: number | null;
    valor_decimo_terceiro: string | number | null;
    ajuste_valor: string | number;
    ajuste_motivo: string | null;
    total_bruto: string | number | null;
    total_liquido: string | number | null;
    conta_avulsa_id: string | null;
    enviada_em: string | null;
    paga_em: string | null;
    colaborador: {
      id: string;
      nome: string;
      cpf: string | null;
      tipo_contratacao: TipoContratacao;
      data_admissao: string;
    } | null;
  };

  const linhas: RescisaoLinha[] = ((rescisoesRaw ?? []) as unknown as Row[])
    .filter((r) => r.colaborador !== null)
    .map((r) => ({
      id: r.id,
      status: r.status,
      data_rescisao: r.data_rescisao,
      salario_vigente: r.salario_vigente == null ? null : Number(r.salario_vigente),
      saldo_salario_dias: r.saldo_salario_dias,
      saldo_salario_valor:
        r.saldo_salario_valor == null ? null : Number(r.saldo_salario_valor),
      avos_ferias: r.avos_ferias,
      valor_ferias: r.valor_ferias == null ? null : Number(r.valor_ferias),
      valor_um_terco_ferias:
        r.valor_um_terco_ferias == null ? null : Number(r.valor_um_terco_ferias),
      avos_decimo: r.avos_decimo,
      valor_decimo_terceiro:
        r.valor_decimo_terceiro == null ? null : Number(r.valor_decimo_terceiro),
      ajuste_valor: Number(r.ajuste_valor ?? 0),
      ajuste_motivo: r.ajuste_motivo,
      total_bruto: r.total_bruto == null ? null : Number(r.total_bruto),
      total_liquido: r.total_liquido == null ? null : Number(r.total_liquido),
      conta_avulsa_id: r.conta_avulsa_id,
      enviada_em: r.enviada_em,
      paga_em: r.paga_em,
      colaborador: r.colaborador!,
    }));

  // KPIs: cards de topo. Calculamos do dataset inteiro (sem filtrar por
  // status aqui) e deixamos cada card interpretar o que ele quer.
  const pendentes = linhas.filter((l) => l.status === "rascunho");
  const enviadas = linhas.filter((l) => l.status === "enviada_financeiro");
  const pagas = linhas.filter((l) => l.status === "paga");

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const noMes = (iso: string | null) => {
    if (!iso) return false;
    return new Date(iso) >= inicioMes;
  };
  const enviadasNoMes = linhas.filter((l) => noMes(l.enviada_em)).length;
  const pagasNoMes = linhas.filter((l) => noMes(l.paga_em)).length;

  const totalAPagar = pendentes.reduce(
    (acc, l) => acc + (l.total_liquido ?? 0),
    0,
  );

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh" />
      <PageHeader
        title="Rescisões"
        description="Verbas rescisórias calculadas a partir do desligamento. Nasce como rascunho ao inativar o colaborador — depois de revisar os descontos, você envia pro financeiro como título em Contas a Pagar."
        icon={FileSignature}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icone={<Clock className="h-4 w-4" />}
          rotulo="Pendentes"
          valorPrincipal={pendentes.length.toString()}
          rodape={
            pendentes.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                aguardando revisão + envio
              </span>
            ) : (
              <span className="text-xs text-emerald-700">tudo em dia</span>
            )
          }
          tom={pendentes.length > 0 ? "vermelho" : undefined}
        />
        <KpiCard
          icone={<Wallet className="h-4 w-4" />}
          rotulo="Total a pagar"
          valorPrincipal={brl.format(totalAPagar)}
          rodape={
            <span className="text-xs text-muted-foreground">
              líquido somado das rescisões em rascunho
            </span>
          }
        />
        <KpiCard
          icone={<Send className="h-4 w-4" />}
          rotulo="Enviadas (mês)"
          valorPrincipal={enviadasNoMes.toString()}
          rodape={
            <span className="text-xs text-muted-foreground">
              total enviadas: {enviadas.length}
            </span>
          }
        />
        <KpiCard
          icone={<CheckCircle2 className="h-4 w-4" />}
          rotulo="Pagas (mês)"
          valorPrincipal={pagasNoMes.toString()}
          rodape={
            <span className="text-xs text-muted-foreground">
              total pagas: {pagas.length}
            </span>
          }
        />
      </div>

      {linhas.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Nenhuma rescisão registrada"
          description="Rescisões nascem automaticamente quando o RH inativa um colaborador."
        />
      ) : (
        <RescisoesView linhas={linhas} />
      )}
    </div>
  );
}

function KpiCard({
  icone,
  rotulo,
  valorPrincipal,
  rodape,
  tom,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valorPrincipal: string;
  rodape: React.ReactNode;
  tom?: "vermelho";
}) {
  const corValor =
    tom === "vermelho" && valorPrincipal !== "0"
      ? "text-california-red"
      : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft flex flex-col justify-between min-h-[128px]">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
          {icone}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide">
          {rotulo}
        </span>
      </div>
      <div className="mt-3">
        <p className={`text-2xl font-bold tabular-nums leading-none ${corValor}`}>
          {valorPrincipal}
        </p>
        <div className="mt-2">{rodape}</div>
      </div>
    </div>
  );
}
