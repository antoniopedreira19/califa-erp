import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { FluxoCaixaView, type FluxoItem, type ContaOpcao } from "./fluxo-caixa-view";

export const dynamic = "force-dynamic";

/**
 * A janela lida do banco é FIXA e generosa; quem recorta é o cliente,
 * conforme o nível e o horizonte escolhidos — que mudam sem ida ao
 * servidor.
 *
 * O maior recuo possível são 3 meses (3 colunas passadas no nível
 * mensal); o maior avanço, 12 meses. A âncora vai 4 meses para trás para
 * sobrar folga, e é dela que sai o saldo bancário de partida: com o
 * saldo na véspera da âncora mais os movimentos daí em diante, o cliente
 * reconstrói o saldo de QUALQUER data da janela sem nova consulta.
 */
function hojeISO(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function iso(ano: number, mesZeroBased: number, dia: number): string {
  const d = new Date(ano, mesZeroBased, dia);
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dd}`;
}

type SearchParams = { empresa?: string };
export default async function FluxoCaixaPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const empresaFiltroIds: string[] =
    typeof searchParams?.empresa === "string" && searchParams.empresa.length > 0
      ? searchParams.empresa.split(",").filter((id) => id.length > 0)
      : session.activeEmpresas.map((e) => e.id);

  const activeEmpresasEfetivas =
    empresaFiltroIds.length > 0
      ? session.empresas.filter((e) => empresaFiltroIds.includes(e.id))
      : [];

  const supabase = createClient();

  const hoje = hojeISO();
  const [ano, mes] = hoje.split("-").map(Number);
  const ancora = iso(ano, mes - 1 - 4, 1); // 1º dia, 4 meses atrás
  const vespera = iso(ano, mes - 1 - 4, 0); // véspera da âncora
  const fim = iso(ano, mes - 1 + 14, 0); // fim do 13º mês à frente

  const queryFluxo = (() => {
    let q = supabase
      .from("vw_fluxo_caixa")
      .select(
        "classe, situacao, origem_tipo, origem_id, conta_bancaria_id, regional_id, data_evento, valor, natureza, descricao, job_id",
      )
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_evento", ancora)
      .lte("data_evento", fim)
      .order("data_evento", { ascending: true });
    if (empresaFiltroIds.length > 0) q = q.in("empresa_id", empresaFiltroIds);
    return q;
  })();

  const queryRegionais = (() => {
    let qr = supabase
      .from("regionais")
      .select("id, nome, empresa_id")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome");
    if (empresaFiltroIds.length > 0) qr = qr.in("empresa_id", empresaFiltroIds);
    return qr;
  })();

  const [fluxoRes, contasRes, regionaisRes, saldosRes] = await Promise.all([
    queryFluxo,
    supabase
      .from("contas_bancarias")
      .select("id, nome, banco")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .neq("tipo", "cartao_credito")
      .order("ordem"),
    queryRegionais,
    // Saldo de cada conta na véspera da âncora — o ponto de partida do
    // razão. Função da migration 20260817000006.
    supabase.rpc("fc_saldos_por_conta", { p_data: vespera }),
  ]);

  if (fluxoRes.error) console.error("[fluxo-caixa] view", fluxoRes.error.message);
  if (saldosRes.error) console.error("[fluxo-caixa] saldos", saldosRes.error.message);

  const itens: FluxoItem[] = (fluxoRes.data ?? []).map((r) => ({
    classe: r.classe as FluxoItem["classe"],
    origem_tipo: r.origem_tipo as string,
    origem_id: r.origem_id as string,
    conta_bancaria_id: (r.conta_bancaria_id as string | null) ?? null,
    regional_id: (r.regional_id as string | null) ?? null,
    data_evento: r.data_evento as string,
    valor: Number(r.valor),
    natureza: r.natureza as "entrada" | "saida",
    descricao: r.descricao as string,
    job_id: (r.job_id as string | null) ?? null,
  }));

  const contas: ContaOpcao[] = (contasRes.data ?? []).map((c) => ({
    id: c.id as string,
    nome: `${c.nome as string} · ${c.banco as string}`,
  }));

  const saldoAncora: Record<string, number> = {};
  for (const linha of (saldosRes.data ?? []) as {
    conta_bancaria_id: string;
    saldo: number | string;
  }[]) {
    saldoAncora[linha.conta_bancaria_id] = Number(linha.saldo);
  }

  return (
    <div className="space-y-8 max-w-[1560px] mx-auto">
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Fluxo de caixa"
        description="Do passado ao futuro: o realizado (movimentos das contas) mais o previsto (títulos em aberto e previsões da abertura do job)."
        icon={TrendingUp}
        showEmpresaFilter
        empresas={session.empresas}
        activeEmpresas={activeEmpresasEfetivas}
      />

      <FluxoCaixaView
        itens={itens}
        contas={contas}
        regionais={regionaisRes.data ?? []}
        saldoAncora={saldoAncora}
        ancora={ancora}
        hoje={hoje}
      />
    </div>
  );
}
