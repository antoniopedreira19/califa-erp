import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { montarFaturamento, type VisaoDoFaturamento } from "@/lib/historico-financeiro/faturamento";
import { Aviso, Filtro, Filtros, Opcao, anosEntre } from "../_historico/filtros";
import { EMPRESAS, PERIODOS, VISOES } from "../_historico/jobs";
import { carregarNotasDoAno, type NotasDoAno } from "./dados";
import { TabelaFaturamento } from "./tabela-faturamento";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * O faturamento dos jobs do histórico (decisão 211, A4): os jobs das abas
 * Res. Jobs da planilha, com as notas emitidas de cada um, o recebido e o a
 * receber. Só admin e financeiro, como o histórico.
 */
export default async function FaturamentoDoHistoricoPage({ searchParams }: Props) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const params = await searchParams;
  const { slug, empresa } = EMPRESAS.find((e) => e.slug === params.empresa) ?? EMPRESAS[0];
  const periodo = PERIODOS.find((p) => p.slug === params.periodo) ?? PERIODOS[0];
  const visao = VISOES.find((v) => v.slug === params.visao) ?? VISOES[0];
  const anoPedido = typeof params.ano === "string" ? Number(params.ano) : NaN;
  // Sem ano na URL, o ano passado: o último inteiro no histórico.
  const ano = Number.isInteger(anoPedido) ? anoPedido : Number(hojeEmSaoPauloIso().slice(0, 4)) - 1;

  const dados = await carregarNotasDoAno(createClient(), session.activeTenant.id, ano);
  const cobertura = dados?.cobertura ?? null;
  const anos = cobertura ? anosEntre(cobertura.de, cobertura.ate) : [];
  const noHistorico = anos.includes(ano);
  const anoDoLink = noHistorico ? ano : anos[anos.length - 1];
  const href = (e: string, a: number, p: string, v: string) => `/relatorios/faturamento-historico?empresa=${e}&ano=${a}&periodo=${p}&visao=${v}`;
  const titulo = noHistorico
    ? `Faturamento dos jobs do histórico ${periodo.trimestre ? `${periodo.trimestre} ` : ""}${ano}`
    : "Faturamento dos jobs do histórico";

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/relatorios" />
      <PageHeader
        eyebrow="RELATÓRIOS"
        title={titulo}
        description="Os jobs das abas Res. Jobs da planilha, com as notas emitidas de cada um, o recebido e o a receber. Só leitura."
        icon={Receipt}
      />

      {!dados ? (
        <Aviso>Não foi possível ler o histórico agora. Tente de novo em instantes.</Aviso>
      ) : !cobertura ? (
        <Aviso>
          Nenhuma carga do histórico está ativa.{" "}
          <Link href="/financeiro/cadastros/historico" prefetch={false} className="font-semibold text-california-red hover:underline">
            Ver as cargas
          </Link>
        </Aviso>
      ) : (
        <>
          <Filtros>
            <Filtro rotulo="Empresa">
              {EMPRESAS.map((e) => (
                <Opcao key={e.slug} href={href(e.slug, anoDoLink, periodo.slug, visao.slug)} ativa={e.slug === slug}>
                  {e.empresa}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Ano">
              {anos.map((a) => (
                <Opcao key={a} href={href(slug, a, periodo.slug, visao.slug)} ativa={a === ano}>
                  {a}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Período">
              {PERIODOS.map((p) => (
                <Opcao key={p.slug} href={href(slug, anoDoLink, p.slug, visao.slug)} ativa={p.slug === periodo.slug}>
                  {p.rotulo}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Visão">
              {VISOES.map((v) => (
                <Opcao key={v.slug} href={href(slug, anoDoLink, periodo.slug, v.slug)} ativa={v.slug === visao.slug}>
                  {v.rotulo}
                </Opcao>
              ))}
            </Filtro>
          </Filtros>

          {noHistorico ? (
            <ConteudoDoPeriodo
              empresa={empresa}
              ano={ano}
              trimestre={periodo.trimestre}
              visao={visao.slug}
              cobertura={cobertura}
              jobs={dados.jobs}
            />
          ) : (
            <Aviso>
              O histórico carregado vai de {formatDiaBr(cobertura.de)} a {formatDiaBr(cobertura.ate)}. Escolha um ano acima.
            </Aviso>
          )}
        </>
      )}
    </div>
  );
}

function ConteudoDoPeriodo({
  empresa,
  ano,
  trimestre,
  visao,
  cobertura,
  jobs,
}: {
  empresa: string;
  ano: number;
  trimestre: string | null;
  visao: VisaoDoFaturamento;
  cobertura: NonNullable<NotasDoAno["cobertura"]>;
  jobs: NotasDoAno["jobs"];
}) {
  const doPeriodo = jobs.filter((j) => j.empresa === empresa && (trimestre === null || j.trimestre === trimestre));
  if (doPeriodo.length === 0) {
    return (
      <Aviso>
        Nenhum job da {empresa} na aba Res. Jobs de {ano}
        {trimestre ? ` no ${trimestre}` : ""}.
      </Aviso>
    );
  }
  const resultado = montarFaturamento(doPeriodo, visao);
  return (
    <section className="space-y-3" aria-label={`Faturamento dos jobs ${empresa} ${ano}`}>
      <TabelaFaturamento resultado={resultado} visao={visao} />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Os jobs são os da aba Res. Jobs de {ano}; o trimestre é a coluna T. Cada job soma as notas emitidas dele nas abas de
          Faturamento da planilha, em qualquer data; as canceladas ficam fora. Recebido é a nota com data de recebimento na
          planilha de {formatDiaBr(cobertura.versao)}; a receber, a nota sem essa data. O histórico não tem o valor contratado
          do job.
        </p>
        {resultado.semNota > 0 && (
          <p>
            {resultado.semNota} {resultado.semNota === 1 ? "job não tem" : "jobs não têm"} nota emitida no histórico.
          </p>
        )}
        {String(ano) === cobertura.de.slice(0, 4) && (
          <p>O histórico começa em {formatDiaBr(cobertura.de)}: as notas emitidas antes não entram.</p>
        )}
        <p>O histórico vai até {formatDiaBr(cobertura.ate)}: as notas emitidas depois ainda não entraram.</p>
      </div>
    </section>
  );
}
