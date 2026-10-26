import Link from "next/link";
import { redirect } from "next/navigation";
import { ScrollText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { montarDre, type EmpresaDaDre } from "@/lib/historico-financeiro/dre";
import { Aviso, Filtro, Filtros, Opcao, anosEntre, fimDoTrimestre } from "../_historico/filtros";
import { carregarSomasDaDre } from "./dados";
import { TabelaDre } from "./tabela-dre";

export const dynamic = "force-dynamic";

/** As empresas da DRE, pela ordem da planilha, com o endereço de cada uma. */
const EMPRESAS: readonly { slug: string; empresa: EmpresaDaDre }[] = [
  { slug: "california", empresa: "Agência California" },
  { slug: "cch", empresa: "CCH" },
  { slug: "hitlab", empresa: "Hitlab" },
  { slug: "ventura", empresa: "Ventura" },
];

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A DRE do histórico (decisão 211, A4): a DRE por competência de cada empresa,
 * refeita dos lançamentos da planilha financeira que estão nas cargas ativas
 * do histórico. Só admin e financeiro, como o histórico.
 */
export default async function DreDoHistoricoPage({ searchParams }: Props) {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const params = await searchParams;
  const { slug, empresa } = EMPRESAS.find((e) => e.slug === params.empresa) ?? EMPRESAS[0];
  const anoPedido = typeof params.ano === "string" ? Number(params.ano) : NaN;
  // Sem ano na URL, o ano passado: o último inteiro no histórico.
  const ano = Number.isInteger(anoPedido) ? anoPedido : Number(hojeEmSaoPauloIso().slice(0, 4)) - 1;

  const somas = await carregarSomasDaDre(createClient(), session.activeTenant.id, ano);
  const cobertura = somas?.cobertura ?? null;
  const anos = cobertura ? anosEntre(cobertura.de, cobertura.ate) : [];
  const noHistorico = anos.includes(ano);
  const href = (e: string, a: number) => `/relatorios/dre-historico?empresa=${e}&ano=${a}`;

  return (
    <div className="space-y-6">
      <BotaoVoltar reserva="/relatorios" />
      <PageHeader
        eyebrow="RELATÓRIOS"
        title={noHistorico ? `DRE do histórico ${ano}` : "DRE do histórico"}
        description="DRE por competência de cada empresa, refeita dos lançamentos da planilha financeira. Só leitura."
        icon={ScrollText}
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
                <Opcao key={e.slug} href={href(e.slug, noHistorico ? ano : anos[anos.length - 1])} ativa={e.slug === slug}>
                  {e.empresa}
                </Opcao>
              ))}
            </Filtro>
            <Filtro rotulo="Ano">
              {anos.map((a) => (
                <Opcao key={a} href={href(slug, a)} ativa={a === ano}>
                  {a}
                </Opcao>
              ))}
            </Filtro>
          </Filtros>

          {noHistorico ? (
            <ConteudoDoAno
              empresa={empresa}
              ano={ano}
              cobertura={cobertura}
              linhas={montarDre(empresa, somas.porGrupo, somas.porJobs)}
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

function ConteudoDoAno({
  empresa,
  ano,
  cobertura,
  linhas,
}: {
  empresa: EmpresaDaDre;
  ano: number;
  cobertura: { de: string; ate: string };
  linhas: ReturnType<typeof montarDre>;
}) {
  const depoisDoHistorico = [1, 2, 3, 4].map((t) => fimDoTrimestre(ano, t) > cobertura.ate) as [boolean, boolean, boolean, boolean];
  const fim = formatDiaBr(cobertura.ate);
  return (
    <section className="space-y-3" aria-label={`DRE ${empresa} ${ano}`}>
      <TabelaDre linhas={linhas} depoisDoHistorico={depoisDoHistorico} fimDoHistorico={fim} />
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Lançamentos do histórico de {formatDiaBr(cobertura.de)} a {fim}, numa regra só por linha: receita é crédito −
          débito; custo e despesa, débito − crédito. Não entram as previsões (lançamentos com data futura), que a DRE da
          planilha soma.
        </p>
        {depoisDoHistorico.some(Boolean) && <p>* Trimestre que termina depois de {fim}: só o que a planilha lançou até lá.</p>}
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
