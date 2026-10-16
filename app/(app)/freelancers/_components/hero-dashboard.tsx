import Link from "next/link";
import { Sparkles, Plus } from "lucide-react";

interface Props {
  nomeUsuario: string;
  totalFreelancers: number;
  totalIrregular: number;
}

const DIAS_SEMANA = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function HeroDashboard({
  nomeUsuario,
  totalFreelancers,
  totalIrregular,
}: Props) {
  const agora = new Date();
  const dataFormatada = `${DIAS_SEMANA[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`;
  const primeiroNome = nomeUsuario.split(" ")[0];

  return (
    <div className="relative overflow-hidden rounded-2xl bg-california-dark text-white px-6 py-5 md:px-8 md:py-6 shadow-elevated">
      <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-california-red/30 blur-3xl pointer-events-none" />
      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">
            <Sparkles className="h-3 w-3" />
            {dataFormatada}
          </p>
          <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">
            Olá, {primeiroNome}
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {totalFreelancers} freelancer{totalFreelancers === 1 ? "" : "s"}{" "}
            cadastrado{totalFreelancers === 1 ? "" : "s"}
            {totalIrregular > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-semibold text-california-red">
                  {totalIrregular} precisa
                  {totalIrregular === 1 ? "" : "m"} de atenção
                </span>
              </>
            )}
          </p>
        </div>
        <Link
          href="/freelancers/solicitacoes"
          prefetch={false}
          className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-brand hover:bg-california-red-hover transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nova solicitação
        </Link>
      </div>
    </div>
  );
}
