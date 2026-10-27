import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import {
  jobsDoEmissor,
  montarFaturamento,
  montarPorCnpj,
  rotuloDoEmissor,
  type VisaoDoFaturamento,
} from "@/lib/historico-financeiro/faturamento";
import { Aviso, Filtro, Filtros, Opcao, anosEntre } from "../_historico/filtros";
import { EMPRESAS, PERIODOS, VISOES } from "../_historico/jobs";
import { carregarNotasDoAno, carregarNotasEmitidas, type NotasDoAno, type NotasEmitidasNoAno } from "./dados";
import { TabelaFaturamento } from "./tabela-faturamento";
import { ListaDeNotas, TabelaPorCnpj } from "./tabela-cnpj";

export const dynamic = "force-dynamic";

/** A visão por CNPJ, como as abas de Faturamento da planilha, vem antes das visões por job e é a padrão. */
const VISOES_DO_FATURAMENTO: readonly { slug: "cnpj" | VisaoDoFaturamento; rotulo: string }[] = [
  { slug: "cnpj", rotulo: "CNPJ" },
  ...VISOES,
];

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type Endereco = { empresa: string; ano: number; periodo: string; visao: string; emissor?: string | null; cnpj?: string | null };

function href(e: Endereco): string {
  const p = new URLSearchParams({ empresa: e.empresa, ano: String(e.ano), periodo: e.periodo, visao: e.visao });
  if (e.emissor) p.set("emissor", e.emissor);
  if (e.cnpj) p.set("cnpj", e.cnpj);
  return `/relatorios/faturamento-historico?${p.toString()}`;
}

/**
 * O faturamento dos jobs do histórico (decisão 211, A4). A visão padrão é por
 * CNPJ emissor, como as abas de Faturamento da planilha: as notas emitidas no
 * ano, mês a mês pela data de emissão, e a lista das notas de cada CNPJ. As
 * visões por cliente, marca e job leem as notas de cada job das abas Res.
 * Jobs, com o filtro do emissor. Só admin e financeiro, como o histórico.
 */
export default async function FaturamentoDoHistoricoPage({ searchParams }: Props) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const params = await searchParams;
  const texto = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const { slug, empresa } = EMPRESAS.find((e) => e.slug === params.empresa) ?? EMPRESAS[0];
  const periodo = PERIODOS.find((p) => p.slug === params.periodo) ?? PERIODOS[0];
  const visao = VISOES_DO_FATURAMENTO.find((v) => v.slug === params.visao) ?? VISOES_DO_FATURAMENTO[0];
  const anoPedido = typeof params.ano === "string" ? Number(params.ano) : NaN;
  // Sem ano na URL, o ano passado: o último inteiro no histórico.
  const ano = Number.isInteger(anoPedido) ? anoPedido : Number(hojeEmSaoPauloIso().slice(0, 4)) - 1;
  const porCnpj = visao.slug === "cnpj";

  const supabase = createClient();
  const dados = porCnpj
    ? await carregarNotasEmitidas(supabase, session.activeTenant.id, ano)
    : await carregarNotasDoAno(supabase, session.activeTenant.id, ano);
  const cobertura = dados?.cobertura ?? null;
  const anos = cobertura ? anosEntre(cobertura.de, cobertura.ate) : [];
  const noHistorico = anos.includes(ano);
  const anoDoLink = noHistorico ? ano : anos[anos.length - 1];
  const base: Endereco = { empresa: slug, ano: anoDoLink, periodo: periodo.slug, visao: visao.slug, emissor: texto("emissor") };
  const titulo = !noHistorico
    ? "Faturamento dos jobs do histórico"
    : porCnpj
      ? `Faturamento por CNPJ do histórico ${ano}`
      : `Faturamento dos jobs do histórico ${periodo.trimestre ? `${periodo.trimestre} ` : ""}${ano}`;

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/relatorios" />
      <PageHeader
        eyebrow="RELATÓRIOS"
        title={titulo}
        description={
          porCnpj
            ? "As notas emitidas de cada CNPJ, mês a mês, como as abas de Faturamento da planilha. Só leitura."
            : "Os jobs das abas Res. Jobs da planilha, com as notas emitidas de cada um, o recebido e o a receber. Só leitura."
        }
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
            <Filtro rotulo="Visão">
              {VISOES_DO_FATURAMENTO.map((v) => (
                <Opcao key={v.slug} href={href({ ...base, visao: v.slug })} ativa={v.slug === visao.slug}>
                  {v.rotulo}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Ano">
              {anos.map((a) => (
                <Opcao key={a} href={href({ ...base, ano: a, cnpj: texto("cnpj") })} ativa={a === ano}>
                  {a}
                </Opcao>
              ))}
            </Filtro>
            {!porCnpj && (
              <>
                <Filtro rotulo="Empresa">
                  {EMPRESAS.map((e) => (
                    <Opcao key={e.slug} href={href({ ...base, empresa: e.slug, emissor: null })} ativa={e.slug === slug}>
                      {e.empresa}
                    </Opcao>
                  ))}
                </Filtro>
                <Filtro rotulo="Período">
                  {PERIODOS.map((p) => (
                    <Opcao key={p.slug} href={href({ ...base, periodo: p.slug })} ativa={p.slug === periodo.slug}>
                      {p.rotulo}
                    </Opcao>
                  ))}
                </Filtro>
              </>
            )}
          </Filtros>

          {!noHistorico ? (
            <Aviso>
              O histórico carregado vai de {formatDiaBr(cobertura.de)} a {formatDiaBr(cobertura.ate)}. Escolha um ano acima.
            </Aviso>
          ) : porCnpj ? (
            <ConteudoPorCnpj
              ano={ano}
              cobertura={cobertura}
              notas={(dados as NotasEmitidasNoAno).notas}
              cnpj={texto("cnpj")}
              hrefDoCnpj={(c) => href({ ...base, cnpj: c })}
              hrefDeVolta={href(base)}
            />
          ) : (
            <ConteudoDoPeriodo
              empresa={empresa}
              ano={ano}
              trimestre={periodo.trimestre}
              visao={visao.slug as VisaoDoFaturamento}
              cobertura={cobertura}
              jobs={(dados as NotasDoAno).jobs}
              emissor={texto("emissor")}
              hrefDoEmissor={(e) => href({ ...base, emissor: e })}
            />
          )}
        </>
      )}
    </div>
  );
}

function ConteudoPorCnpj({
  ano,
  cobertura,
  notas,
  cnpj,
  hrefDoCnpj,
  hrefDeVolta,
}: {
  ano: number;
  cobertura: NonNullable<NotasEmitidasNoAno["cobertura"]>;
  notas: NotasEmitidasNoAno["notas"];
  cnpj: string | null;
  hrefDoCnpj: (estabelecimento: string) => string;
  hrefDeVolta: string;
}) {
  if (notas.length === 0) return <Aviso>Nenhuma nota emitida em {ano} no histórico.</Aviso>;
  const doCnpj = cnpj ? notas.filter((n) => n.estabelecimento === cnpj) : null;
  const notasDoPeriodo = (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        Cada CNPJ é uma aba de Faturamento da planilha; a nota cai no mês da emissão, de qualquer job e de qualquer empresa
        (a CCH e a Hitlab também emitem pelo CNPJ da California). As notas sem job e as de distribuição de lucro entram no
        total e aparecem à parte; as canceladas ficam fora. Recebido é a nota com data de recebimento na planilha de{" "}
        {formatDiaBr(cobertura.versao)}; a receber, a nota sem essa data.
      </p>
      {String(ano) === cobertura.ate.slice(0, 4) && (
        <p>O histórico vai até {formatDiaBr(cobertura.ate)}: as notas emitidas depois ainda não entraram.</p>
      )}
    </div>
  );
  if (doCnpj) {
    const { linhas, total } = montarPorCnpj(doCnpj);
    const rotulo = linhas[0]?.rotulo ?? rotuloDoEmissor(cnpj ?? "");
    return (
      <section className="space-y-3" aria-label={`Notas de ${rotulo} em ${ano}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">
            {rotulo} <span className="font-normal text-muted-foreground">· {cnpj}</span>
          </h2>
          <Link href={hrefDeVolta} prefetch={false} className="text-sm font-semibold text-california-red hover:underline">
            Todos os CNPJs
          </Link>
        </div>
        {doCnpj.length === 0 ? (
          <Aviso>Nenhuma nota emitida por este CNPJ em {ano}.</Aviso>
        ) : (
          <>
            <TabelaPorCnpj linhas={[]} total={total} hrefDoCnpj={hrefDoCnpj} />
            <ListaDeNotas notas={doCnpj} />
          </>
        )}
        {notasDoPeriodo}
      </section>
    );
  }
  const { linhas, total } = montarPorCnpj(notas);
  return (
    <section className="space-y-3" aria-label={`Faturamento por CNPJ em ${ano}`}>
      <TabelaPorCnpj linhas={linhas} total={total} hrefDoCnpj={hrefDoCnpj} />
      {notasDoPeriodo}
    </section>
  );
}

function ConteudoDoPeriodo({
  empresa,
  ano,
  trimestre,
  visao,
  cobertura,
  jobs,
  emissor,
  hrefDoEmissor,
}: {
  empresa: string;
  ano: number;
  trimestre: string | null;
  visao: VisaoDoFaturamento;
  cobertura: NonNullable<NotasDoAno["cobertura"]>;
  jobs: NotasDoAno["jobs"];
  emissor: string | null;
  hrefDoEmissor: (emissor: string | null) => string;
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
  const emissores = [...new Set(doPeriodo.flatMap((j) => Object.keys(j.emissores)))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const doEmissor = emissor && emissores.includes(emissor) ? emissor : null;
  const vistos = jobsDoEmissor(doPeriodo, doEmissor);
  const resultado = montarFaturamento(vistos, visao);
  return (
    <section className="space-y-3" aria-label={`Faturamento dos jobs ${empresa} ${ano}`}>
      {emissores.length > 1 && (
        <Filtros>
          <Filtro rotulo="Emissor">
            <Opcao href={hrefDoEmissor(null)} ativa={doEmissor === null}>
              Todos
            </Opcao>
            {emissores.map((e) => (
              <Opcao key={e} href={hrefDoEmissor(e)} ativa={e === doEmissor}>
                {rotuloDoEmissor(e)}
              </Opcao>
            ))}
          </Filtro>
        </Filtros>
      )}
      {vistos.length === 0 ? (
        <Aviso>Nenhum job com nota deste emissor no período.</Aviso>
      ) : (
        <TabelaFaturamento resultado={resultado} visao={visao} />
      )}
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Os jobs são os da aba Res. Jobs de {ano}; o trimestre é a coluna T. Cada job soma as notas emitidas dele nas abas de
          Faturamento da planilha, em qualquer data; as canceladas ficam fora. Recebido é a nota com data de recebimento na
          planilha de {formatDiaBr(cobertura.versao)}; a receber, a nota sem essa data. O histórico não tem o valor contratado
          do job.
          {doEmissor && " Com um emissor escolhido, só entram os jobs com nota dele, e só as notas dele."}
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
