import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  ArrowRight,
  Receipt,
  FileSignature,
  FileX,
  Palmtree,
  ShieldPlus,
  Gift,
  type LucideIcon,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function CentralRHPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth() + 1;

  // Rescisões recentes = desligados nos últimos 90 dias
  const noventaDiasAtras = new Date();
  noventaDiasAtras.setDate(noventaDiasAtras.getDate() - 90);
  const corteRescisoesISO = noventaDiasAtras.toISOString().slice(0, 10);

  const [
    colaboradoresAtivosRes,
    pendenciasRes,
    contratacoesEmAndamentoRes,
    feriasAguardandoRes,
    rescisoesRes,
    beneficiosAtivosRes,
    folhasDecimoTerceiroRes,
  ] = await Promise.all([
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo"),
    supabase
      .from("folhas_pagamento")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("competencia_ano", anoAtual)
      .eq("competencia_mes", mesAtual)
      .eq("status", "pendente_correcao"),
    supabase
      .from("contratacoes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .in("status", [
        "rascunho",
        "proposta_enviada",
        "aceite_recebido",
        "dados_completos",
        "contrato_gerado",
        "contrato_assinado",
      ]),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .in("status", ["pendente_aprovacao", "em_analise"]),
    supabase
      .from("colaboradores")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "inativo")
      .not("data_encerramento", "is", null)
      .gte("data_encerramento", corteRescisoesISO),
    supabase
      .from("colaborador_beneficio")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id)
      .is("data_fim", null),
    supabase
      .from("decimo_terceiro_folhas")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.activeTenant.id),
  ]);
  const colaboradoresAtivos = colaboradoresAtivosRes.count ?? 0;
  const pendenciasNoMes = pendenciasRes.count ?? 0;
  const contratacoesEmAndamento = contratacoesEmAndamentoRes.count ?? 0;
  const feriasAguardando = feriasAguardandoRes.count ?? 0;
  const rescisoesRecentes = rescisoesRes.count ?? 0;
  const beneficiosAtivos = beneficiosAtivosRes.count ?? 0;
  const folhasDecimoTerceiro = folhasDecimoTerceiroRes.count ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="RH"
        title="Recursos Humanos"
        description="Pipeline de contratação, cadastro de colaboradores, alocação por empresa e regional, histórico salarial e folha mensal."
        icon={Users}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <RhCard
          href="/rh/contratacoes"
          icon={FileSignature}
          title="Contratações"
          description="Novas contratações, da proposta até a efetivação."
          count={contratacoesEmAndamento}
          countLabel={
            contratacoesEmAndamento === 1
              ? "em andamento"
              : "em andamento"
          }
        />
        <RhCard
          href="/rh/colaboradores"
          icon={Users}
          title="Colaboradores"
          description="Quadro ativo e inativo, com cargo, alocação e salário."
          count={colaboradoresAtivos}
          countLabel={colaboradoresAtivos === 1 ? "ativo" : "ativos"}
        />
        <RhCard
          href="/rh/folhas"
          icon={Receipt}
          title="Folhas de pagamento"
          description="Folha mensal dos colaboradores, com envio ao financeiro."
          count={pendenciasNoMes}
          countLabel={
            pendenciasNoMes === 1
              ? "pendência no mês atual"
              : "pendências no mês atual"
          }
        />
        <RhCard
          href="/rh/ferias"
          icon={Palmtree}
          title="Férias"
          description="Solicitações, aprovações e controle dos períodos aquisitivos."
          count={feriasAguardando}
          countLabel={
            feriasAguardando === 1
              ? "solicitação aguardando"
              : "solicitações aguardando"
          }
        />
        <RhCard
          href="/rh/beneficios"
          icon={ShieldPlus}
          title="Benefícios"
          description="Planos de saúde, dental e dependentes dos colaboradores."
          count={beneficiosAtivos}
          countLabel={beneficiosAtivos === 1 ? "vínculo ativo" : "vínculos ativos"}
        />
        <RhCard
          href="/rh/decimo-terceiro"
          icon={Gift}
          title="13º Salário"
          description="Cálculo anual do 13º de todos os colaboradores."
          count={folhasDecimoTerceiro}
          countLabel={folhasDecimoTerceiro === 1 ? "folha criada" : "folhas criadas"}
        />
        <RhCard
          href="/rh/rescisoes"
          icon={FileX}
          title="Rescisões"
          description="Verbas rescisórias dos colaboradores desligados."
          count={rescisoesRecentes}
          countLabel={
            rescisoesRecentes === 1
              ? "nos últimos 90 dias"
              : "nos últimos 90 dias"
          }
        />
        {/* Próximo card: Turnover */}
      </div>
    </div>
  );
}

function RhCard({
  href,
  icon: Icon,
  title,
  description,
  count,
  countLabel,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  count?: number;
  countLabel?: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {count !== undefined && (
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{count}</span>{" "}
            {countLabel ?? "registros"}
          </p>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
            Abrir
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      )}
      {count === undefined && (
        <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
            Abrir
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      )}
    </Link>
  );
}
