import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { obterFechamento, temAvulsaPaga } from "@/lib/queries/beneficios";
import { CabecalhoFechamento } from "./_components/cabecalho-fechamento";
import { KpisFechamento } from "./_components/kpis-fechamento";
import { CardsPorOperadora } from "./_components/cards-por-operadora";
import { TabelaLinhasFechamento } from "./_components/tabela-linhas-fechamento";

export const dynamic = "force-dynamic";

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export default async function FechamentoDetalhePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    redirect("/home?reason=sem_permissao_rh");
  }

  const [detalhe, avulsaPaga] = await Promise.all([
    obterFechamento({ fechamentoId: params.id }),
    temAvulsaPaga({ fechamentoId: params.id }),
  ]);

  if (!detalhe) notFound();

  const label = `${NOMES_MES[detalhe.cabecalho.mes - 1]}/${detalhe.cabecalho.ano}`;

  return (
    <div className="space-y-6 max-w-[1480px] mx-auto">
      <BotaoVoltar reserva="/rh/beneficios?tab=fechamentos" />

      <PageHeader
        title={label}
        description={
          detalhe.cabecalho.fechado_por_nome
            ? `Fechado em ${new Date(detalhe.cabecalho.fechado_em).toLocaleString("pt-BR")} por ${detalhe.cabecalho.fechado_por_nome}.`
            : `Fechado em ${new Date(detalhe.cabecalho.fechado_em).toLocaleString("pt-BR")}.`
        }
        icon={Receipt}
      />

      <CabecalhoFechamento
        fechamentoId={detalhe.cabecalho.id}
        reabertoEm={detalhe.cabecalho.reaberto_em}
        avulsaPaga={avulsaPaga}
      />

      <KpisFechamento detalhe={detalhe} />

      <CardsPorOperadora operadoras={detalhe.por_operadora} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Vínculos no fechamento ({detalhe.linhas.length})
        </h2>
        <TabelaLinhasFechamento linhas={detalhe.linhas} />
      </section>

      {detalhe.cabecalho.reaberto_em && (
        <p className="text-xs text-muted-foreground">
          Este fechamento foi reaberto. Os valores exibidos refletem o snapshot
          do momento do fechamento original.
          {" "}
          <Link
            href="/rh/beneficios?tab=fechamentos"
            prefetch={false}
            className="underline"
          >
            Ver outros fechamentos
          </Link>
          .
        </p>
      )}
    </div>
  );
}
