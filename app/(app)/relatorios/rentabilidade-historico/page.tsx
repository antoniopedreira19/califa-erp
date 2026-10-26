import Link from "next/link";
import { redirect } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { montarRentabilidade, type VisaoDaRentabilidade } from "@/lib/historico-financeiro/rentabilidade";
import { Aviso, Filtro, Filtros, Opcao, anosEntre } from "../_historico/filtros";
import { carregarJobsDoAno } from "./dados";
import { TabelaRentabilidade } from "./tabela-rentabilidade";

export const dynamic = "force-dynamic";

/** As empresas com abas Res. Jobs, com o endereço de cada uma. */
const EMPRESAS: readonly { slug: string; empresa: string }[] = [
  { slug: "california", empresa: "Agência California" },
  { slug: "cch", empresa: "CCH" },
  { slug: "hitlab", empresa: "Hitlab" },
  { slug: "ventura", empresa: "Ventura" },
];
const PERIODOS: readonly { slug: string; rotulo: string; trimestre: string | null }[] = [
  { slug: "ano", rotulo: "Ano", trimestre: null },
  { slug: "1", rotulo: "1º tri", trimestre: "1T" },
  { slug: "2", rotulo: "2º tri", trimestre: "2T" },
  { slug: "3", rotulo: "3º tri", trimestre: "3T" },
  { slug: "4", rotulo: "4º tri", trimestre: "4T" },
];
const VISOES: readonly { slug: VisaoDaRentabilidade; rotulo: string }[] = [
  { slug: "cliente", rotulo: "Cliente" },
  { slug: "marca", rotulo: "Marca" },
  { slug: "job", rotulo: "Job" },
];

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A rentabilidade dos jobs do histórico (decisão 211, A4): os jobs das abas
 * Res. Jobs da planilha, com o resultado e a rentabilidade depois do fee,
 * refeitos dos lançamentos e das notas das cargas ativas. Só admin e
 * financeiro, como o histórico.
 */
export default async function RentabilidadeDoHistoricoPage({ searchParams }: Props) {
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

  const dados = await carregarJobsDoAno(createClient(), session.activeTenant.id, ano);
  const cobertura = dados?.cobertura ?? null;
  const anos = cobertura ? anosEntre(cobertura.de, cobertura.ate) : [];
  const noHistorico = anos.includes(ano);
  const anoDoLink = noHistorico ? ano : anos[anos.length - 1];
  const href = (e: string, a: number, p: string, v: string) => `/relatorios/rentabilidade-historico?empresa=${e}&ano=${a}&periodo=${p}&visao=${v}`;
  const titulo = noHistorico
    ? `Rentabilidade dos jobs do histórico ${periodo.trimestre ? `${periodo.trimestre} ` : ""}${ano}`
    : "Rentabilidade dos jobs do histórico";

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/relatorios" />
      <PageHeader
        eyebrow="RELATÓRIOS"
        title={titulo}
        description="Os jobs das abas Res. Jobs da planilha, com o resultado e a rentabilidade depois do fee, refeitos dos lançamentos e das notas do histórico. Só leitura."
        icon={TrendingUp}
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
  visao: VisaoDaRentabilidade;
  cobertura: { de: string; ate: string };
  jobs: NonNullable<Awaited<ReturnType<typeof carregarJobsDoAno>>>["jobs"];
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
  const resultado = montarRentabilidade(doPeriodo, visao);
  return (
    <section className="space-y-3" aria-label={`Rentabilidade dos jobs ${empresa} ${ano}`}>
      <TabelaRentabilidade resultado={resultado} visao={visao} />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Os jobs são os da aba Res. Jobs de {ano}; o trimestre é a coluna T. Cada job soma todos os lançamentos e notas dele
          no histórico, em qualquer data. O resultado é a receita menos o imposto das notas e o custo. O fee (planilha) é o que
          a planilha separa por dentro da receita menos o imposto, pelo percentual de cada job, e não é o honorário orçado; a
          rentabilidade é o resultado menos esse fee. Vale só para o histórico.
        </p>
        {resultado.semFee > 0 && (
          <p>
            {resultado.semFee} {resultado.semFee === 1 ? "job não tem" : "jobs não têm"} percentual de fee na planilha: o fee
            fica zero.
          </p>
        )}
        {String(ano) === cobertura.de.slice(0, 4) && (
          <p>O histórico começa em {formatDiaBr(cobertura.de)}: o que o job recebeu ou pagou antes não entra.</p>
        )}
        <p>O histórico vai até {formatDiaBr(cobertura.ate)}: o que o job recebeu ou pagou depois ainda não entrou.</p>
      </div>
    </section>
  );
}
