import Link from "next/link";
import { ArrowRight, Sparkles, Users, Receipt } from "lucide-react";
import type { SessionContext } from "@/lib/types";
import { CabecalhoHome } from "./_componentes/cabecalho-home";

/**
 * Placeholder da home do RH. O dashboard próprio (pendências da folha,
 * comparativos por mês, alertas de cadastro) vai vir numa próxima
 * iteração — por enquanto, um cartão "em breve" + atalhos pras 2
 * telas úteis do módulo.
 */
export function HomeRh({ session }: { session: SessionContext }) {
  return (
    <div className="space-y-8">
      <CabecalhoHome
        nome={session.profile.nome}
        subtitulo="Seu módulo é o RH. O dashboard com pendências e comparativos do quadro tá em construção — abaixo, atalhos pras telas que já funcionam."
      />

      <section className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">Dashboard em breve</h2>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          Uma visão executiva do RH com pendências do dia, evolução do quadro e
          alertas de folha. Enquanto isso, use os atalhos abaixo pra ir direto
          nas telas do módulo.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <AtalhoCard
          href="/rh/colaboradores"
          icon={Users}
          title="Colaboradores"
          description="Cadastro do quadro, alocação por empresa e regional, histórico salarial e dados bancários."
        />
        <AtalhoCard
          href="/rh/folhas"
          icon={Receipt}
          title="Folhas de pagamento"
          description="Geração e revisão da folha mensal. RH edita e envia; financeiro aprova, reprova ou paga cada linha."
        />
      </section>
    </div>
  );
}

function AtalhoCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Users;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:border-california-red/30 hover:shadow-elevated"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground group-hover:text-california-red transition-colors">
        {title}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 flex items-center justify-end border-t border-border pt-4">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-california-red">
          Abrir
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
