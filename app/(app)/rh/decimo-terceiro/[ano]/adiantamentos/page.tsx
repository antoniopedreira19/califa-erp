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
        `id, ano, colaborador_id, data, valor, obs, conta_avulsa_id,
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
    conta_avulsa_id: string | null;
    colaborador: ColabEmbed;
  }

  const adiantamentos: AdiantamentoRow[] = ((adiantRes.data ?? []) as AdiantamentoRaw[]).map((a) => {
    const colab = Array.isArray(a.colaborador) ? a.colaborador[0] : a.colaborador;
    return {
      id: a.id,
      colaborador_id: a.colaborador_id,
      colaborador_nome: colab?.nome ?? "—",
      colaborador_funcao: colab?.funcao ?? "",
      colaborador_tipo: colab?.tipo_contratacao ?? "",
      data: a.data,
      valor: Number(a.valor),
      obs: a.obs,
      conta_avulsa_id: a.conta_avulsa_id,
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
