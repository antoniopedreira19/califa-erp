import { requireSession } from "@/lib/auth/session";
import { HomeAdmin } from "./home-admin";
import { HomeFinanceiro } from "./home-financeiro";
import { HomeFreelancer } from "./home-freelancer";
// HomeGerenteProducao e HomeProdutor entram na Task 4 — placeholder
// abaixo mantem a rota funcional pra esses papeis enquanto isso.

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await requireSession();

  switch (session.activeRole) {
    case "administrador":
      return <HomeAdmin session={session} />;
    case "financeiro":
      return <HomeFinanceiro session={session} />;
    case "freelancer":
      return <HomeFreelancer session={session} />;
    case "gerente_producao":
    case "produtor":
      // Task 4 troca por HomeGerenteProducao / HomeProdutor.
      return (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-10 text-center">
          <p className="text-sm font-semibold text-foreground">
            Home deste papel em construção.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Volta em breve com pendências e números do time.
          </p>
        </div>
      );
  }
}
