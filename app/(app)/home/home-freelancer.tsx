import type { SessionContext } from "@/lib/types";
import { carregarHomeFreelancer } from "@/lib/home/carregar";
import { CabecalhoHome } from "./_componentes/cabecalho-home";
import { CardPendenciaLink } from "./_componentes/card-pendencia";
import { CardKpiLink } from "./_componentes/card-kpi";
import { EstadoVazio } from "./_componentes/estado-vazio";

export async function HomeFreelancer({
  session,
}: {
  session: SessionContext;
}) {
  const { pendencias, kpis } = await carregarHomeFreelancer(session);
  const jobsAtivos = Number(kpis[0]?.valor ?? "0");
  const pendenciasVisiveis = pendencias.filter((c) => c.contagem > 0);

  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        papel="Freelancer"
        subtitulo="Seus jobs, seu realizado e seu chat — o que precisa da sua atenção."
      />

      {jobsAtivos === 0 ? (
        <EstadoVazio mensagem="Nenhum job atribuído a você ainda. Fale com o gestor do projeto." />
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              Precisa da sua atenção
            </h2>
            {pendenciasVisiveis.length === 0 ? (
              <EstadoVazio mensagem="Tudo em dia por aqui." />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pendenciasVisiveis.map((c) => (
                  <CardPendenciaLink key={c.href + c.titulo} card={c} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              Meu volume
            </h2>
            <div className="grid gap-3 md:grid-cols-3">
              {kpis.map((k) => (
                <CardKpiLink key={k.href + k.titulo} card={k} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
