import type { SessionContext } from "@/lib/types";
import { carregarHomeGerenteProducao } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeGerenteProducao({
  session,
}: {
  session: SessionContext;
}) {
  const { pendencias, kpis } = await carregarHomeGerenteProducao(session);
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        subtitulo="Aprovações que dependem de você e o volume do seu time."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Aguardando você
        </h2>
        {pendenciasVisiveis.length === 0 ? (
          <EstadoVazio mensagem="Nada precisa da sua atenção agora." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pendenciasVisiveis.map((c) => (
              <CardPendenciaLink key={c.href + c.titulo} card={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Seu time</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {kpis.map((k) => (
            <CardKpiLink key={k.href + k.titulo} card={k} />
          ))}
        </div>
      </section>
    </div>
  );
}
