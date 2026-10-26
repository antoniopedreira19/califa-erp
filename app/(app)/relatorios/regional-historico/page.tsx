import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPinned } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { descricaoDosProjetos, montarRegional, type EmpresaDoRegional } from "@/lib/historico-financeiro/regional";
import { Aviso, Filtro, Filtros, Opcao, anosEntre, fimDoTrimestre } from "../_historico/filtros";
import { carregarSomasDoRegional } from "./dados";
import { RateioDaEmpresa, TabelaRegional } from "./tabela-regional";

export const dynamic = "force-dynamic";

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** As empresas com rateio por regional, com o endereço de cada uma. */
const EMPRESAS: readonly { slug: string; empresa: EmpresaDoRegional }[] = [
  { slug: "california", empresa: "Agência California" },
  { slug: "cch", empresa: "CCH" },
];
const PERIODOS: readonly { slug: string; rotulo: string; trimestre: number | null }[] = [
  { slug: "ano", rotulo: "Ano", trimestre: null },
  { slug: "1", rotulo: "1º tri", trimestre: 1 },
  { slug: "2", rotulo: "2º tri", trimestre: 2 },
  { slug: "3", rotulo: "3º tri", trimestre: 3 },
  { slug: "4", rotulo: "4º tri", trimestre: 4 },
];

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * O resultado por regional do histórico (decisão 211, A4): as linhas das abas
 * Gerencial da planilha por regional, refeitas dos lançamentos das cargas
 * ativas, com o TD rateado pelo percentual do ano. Só admin e financeiro,
 * como o histórico.
 */
export default async function RegionalDoHistoricoPage({ searchParams }: Props) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const params = await searchParams;
  const { slug, empresa } = EMPRESAS.find((e) => e.slug === params.empresa) ?? EMPRESAS[0];
  const periodo = PERIODOS.find((p) => p.slug === params.periodo) ?? PERIODOS[0];
  const anoPedido = typeof params.ano === "string" ? Number(params.ano) : NaN;
  // Sem ano na URL, o ano passado: o último inteiro no histórico.
  const ano = Number.isInteger(anoPedido) ? anoPedido : Number(hojeEmSaoPauloIso().slice(0, 4)) - 1;

  const somas = await carregarSomasDoRegional(createClient(), session.activeTenant.id, ano);
  const cobertura = somas?.cobertura ?? null;
  const anos = cobertura ? anosEntre(cobertura.de, cobertura.ate) : [];
  const noHistorico = anos.includes(ano);
  const href = (e: string, a: number, p: string) => `/relatorios/regional-historico?empresa=${e}&ano=${a}&periodo=${p}`;
  const titulo = noHistorico ? `Resultado por regional do histórico ${periodo.trimestre ? `${periodo.trimestre}T ` : ""}${ano}` : "Resultado por regional do histórico";

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/relatorios" />
      <PageHeader
        eyebrow="RELATÓRIOS"
        title={titulo}
        description="A DRE regional da planilha refeita dos lançamentos do histórico: o faturamento e o custo pela divisão de cada job, o imposto teórico com o benefício do ISS e do PERSE, e o TD pelo percentual do ano. Só leitura."
        icon={MapPinned}
      />

      {!somas ? (
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
                <Opcao key={e.slug} href={href(e.slug, noHistorico ? ano : anos[anos.length - 1], periodo.slug)} ativa={e.slug === slug}>
                  {e.empresa}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Ano">
              {anos.map((a) => (
                <Opcao key={a} href={href(slug, a, periodo.slug)} ativa={a === ano}>
                  {a}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Período">
              {PERIODOS.map((p) => (
                <Opcao key={p.slug} href={href(slug, noHistorico ? ano : anos[anos.length - 1], p.slug)} ativa={p.slug === periodo.slug}>
                  {p.rotulo}
                </Opcao>
              ))}
            </Filtro>
          </Filtros>

          {noHistorico ? (
            <ConteudoDoPeriodo
              empresa={empresa}
              ano={ano}
              trimestre={periodo.trimestre}
              cobertura={cobertura}
              somas={somas}
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
  cobertura,
  somas,
}: {
  empresa: EmpresaDoRegional;
  ano: number;
  trimestre: number | null;
  cobertura: { de: string; ate: string };
  somas: NonNullable<Awaited<ReturnType<typeof carregarSomasDoRegional>>>;
}) {
  const rateio = somas.rateio.filter((r) => r.empresa === empresa);
  const resultado = montarRegional(empresa, ano, trimestre, somas.porGrupo, somas.porJobs, rateio);
  const fim = formatDiaBr(cobertura.ate);
  const depoisDoHistorico = fimDoTrimestre(ano, trimestre ?? 4) > cobertura.ate;
  return (
    <section className="space-y-3" aria-label={`Resultado por regional ${empresa} ${ano}`}>
      <RateioDaEmpresa rateio={rateio} ano={ano} colunas={resultado.colunas} />
      <TabelaRegional resultado={resultado} />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          O faturamento e o custo operacional se dividem pelas partes de cada job nas abas Res. Jobs. O imposto é o teórico,
          pela alíquota do job; o benefício do ISS e do PERSE (o teórico menos o imposto pago) entra depois do lucro, rateado
          pelo faturamento de cada regional no trimestre. Os demais lançamentos entram na regional deles; o TD, pelo percentual
          do ano da planilha; o que não tem regional fica em &quot;Sem regional&quot;. A coluna Total fecha com a DRE do
          histórico na última linha. Não entram as previsões.
        </p>
        {resultado.temProjetos && (
          <p>
            Os projetos proprietários — {descricaoDosProjetos(empresa)} — ficam fora das linhas de cima e entram no bloco
            abaixo do resultado, somados só no lucro após investimento, como no Fechamento. O benefício deles é a parte do
            trimestre que cabe ao faturamento dos projetos.
          </p>
        )}
        {resultado.faturamentoSemDivisao !== 0 && (
          <p>
            {reais(resultado.faturamentoSemDivisao)} do faturamento não tem divisão de job na planilha (lançamento sem job, ou
            job que as abas Res. Jobs não dividem) e ficou na regional do lançamento.
          </p>
        )}
        {depoisDoHistorico && <p>O período termina depois de {fim}: só o que a planilha lançou até lá.</p>}
        {String(ano) === cobertura.de.slice(0, 4) && (
          <p>
            O histórico começa em {formatDiaBr(cobertura.de)}: o que foi recebido ou pago antes, com competência de {ano}, não
            entra.
          </p>
        )}
      </div>
    </section>
  );
}
