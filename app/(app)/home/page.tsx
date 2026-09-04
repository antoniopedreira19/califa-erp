import { requireSession } from "@/lib/auth/session";
import { HomeAdmin } from "./home-admin";
import { HomeFinanceiro } from "./home-financeiro";
import { HomeFreelancer } from "./home-freelancer";
import { HomeGerenteProducao } from "./home-gerente-producao";
import { HomeProdutor } from "./home-produtor";

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
      return <HomeGerenteProducao session={session} />;
    case "produtor":
      return <HomeProdutor session={session} />;
  }
}
