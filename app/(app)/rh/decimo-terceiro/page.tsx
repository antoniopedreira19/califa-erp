import Link from "next/link";
import { redirect } from "next/navigation";
import { Gift, Users, Wallet, Calculator, ArrowRight } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/empty-state";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { pode } from "@/lib/permissoes";
import { CriarFolhaButton } from "./_components/criar-folha-button";

export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

interface FolhaResumo {
  id: string;
  ano: number;
  status: string;
  criada_em: string;
  criada_por: string | null;
  total_linhas: number;
  total_1a: number;
  total_2a: number;
  total_liquido: number;
}

export default async function DecimoTerceiroPage() {
  const session = await requireSession();
  if (!pode(session.activeRole, "rh.decimo_terceiro.ver")) {
    redirect("/home?reason=sem_permissao_rh");
  }

  const supabase = createClient();

  const [folhasRes, agregadosRes] = await Promise.all([
    supabase
      .from("decimo_terceiro_folhas")
      .select("id, ano, status, criada_em, criada_por")
      .eq("tenant_id", session.activeTenant.id)
      .order("ano", { ascending: false }),
    supabase
      .from("decimo_terceiro_linhas")
      .select(
        "folha_id, primeira_parcela, segunda_parcela, total_liquido",
      )
      .eq("tenant_id", session.activeTenant.id),
  ]);

  if (folhasRes.error) {
    console.error("[rh.decimo-terceiro.page] folhas:", folhasRes.error.message);
  }
  if (agregadosRes.error) {
    console.error("[rh.decimo-terceiro.page] agregados:", agregadosRes.error.message);
  }

  type AgLinha = {
    folha_id: string;
    primeira_parcela: string;
    segunda_parcela: string;
    total_liquido: string;
  };

  const agregadosPorFolha = new Map<
    string,
    { total_linhas: number; total_1a: number; total_2a: number; total_liquido: number }
  >();
  for (const linha of (agregadosRes.data ?? []) as AgLinha[]) {
    const atual = agregadosPorFolha.get(linha.folha_id) ?? {
      total_linhas: 0,
      total_1a: 0,
      total_2a: 0,
      total_liquido: 0,
    };
    atual.total_linhas += 1;
    atual.total_1a += Number(linha.primeira_parcela);
    atual.total_2a += Number(linha.segunda_parcela);
    atual.total_liquido += Number(linha.total_liquido);
    agregadosPorFolha.set(linha.folha_id, atual);
  }

  const folhas: FolhaResumo[] = (folhasRes.data ?? []).map((f) => {
    const ag = agregadosPorFolha.get(f.id) ?? {
      total_linhas: 0,
      total_1a: 0,
      total_2a: 0,
      total_liquido: 0,
    };
    return { ...f, ...ag };
  });

  const anoCorrente = new Date().getFullYear();
  const maiorAno = folhas.length > 0 ? folhas[0].ano : null;
  const proximoAnoSugerido =
    maiorAno == null ? anoCorrente : Math.max(maiorAno + 1, anoCorrente);
  const podeEditar = pode(session.activeRole, "rh.decimo_terceiro.editar");

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh" />
      <PageHeader
        eyebrow="RH"
        title="13º Salário"
        description="Folha anual de 13º com snapshot do cadastro, cálculo automático de avos, parcelas e descontos. Uma folha por ano."
        icon={Gift}
        actions={
          podeEditar ? (
            <CriarFolhaButton anoSugerido={proximoAnoSugerido} />
          ) : undefined
        }
      />

      {folhas.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="Nenhuma folha de 13º criada ainda"
          description={`Comece criando a folha de ${proximoAnoSugerido}. O sistema puxa automaticamente todos os colaboradores elegíveis do cadastro.`}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {folhas.map((f) => (
            <FolhaCard key={f.id} folha={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "rascunho":
      return "Rascunho";
    case "fechada_parcial_1":
      return "1ª parcela fechada";
    case "fechada_parcial_2":
      return "2ª parcela fechada";
    case "concluida":
      return "Concluída";
    default:
      return status;
  }
}

function FolhaCard({ folha }: { folha: FolhaResumo }) {
  return (
    <Link
      href={`/rh/decimo-terceiro/${folha.ano}`}
      prefetch={false}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
          <Gift className="h-5 w-5" />
        </div>
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
          {statusLabel(folha.status)}
        </span>
      </div>

      <h3 className="mt-4 text-2xl font-bold text-foreground group-hover:text-california-red transition-colors">
        13º {folha.ano}
      </h3>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Colaboradores</span>
        </div>
        <div className="text-right font-semibold">{folha.total_linhas}</div>

        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">1ª parcela</span>
        </div>
        <div className="text-right font-semibold tabular-nums">
          {brl.format(folha.total_1a)}
        </div>

        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">2ª parcela</span>
        </div>
        <div className="text-right font-semibold tabular-nums">
          {brl.format(folha.total_2a)}
        </div>

        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Total líquido</span>
        </div>
        <div className="text-right font-semibold tabular-nums text-california-red">
          {brl.format(folha.total_liquido)}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
