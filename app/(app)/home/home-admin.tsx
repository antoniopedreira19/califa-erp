import type { SessionContext } from "@/lib/types";
import { carregarHomeAdmin } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeAdmin({ session }: { session: SessionContext }) {
  const { pendencias, kpis } = await carregarHomeAdmin(session);
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        subtitulo="O que precisa da sua atenção hoje, e como estão os números do mês."
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Precisa da sua atenção
        </h2>
        {pendenciasVisiveis.length === 0 ? (
          <EstadoVazio mensagem="Tudo em dia por aqui." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {pendenciasVisiveis.map((c) => (
              <CardPendenciaLink key={c.href + c.titulo} card={c} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Números do mês</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <CardKpiLink key={k.href + k.titulo} card={k} />
          ))}
        </div>
      </section>
    </div>
  );
}
