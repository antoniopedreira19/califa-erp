import Link from "next/link";
import { Sparkles, Plus, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Saude {
  percentual: number;
  saudaveis: number;
  ativos: number;
  /** 'tenant' pra aprovador (todos os freelas); 'meus' pra GP/produtor. */
  escopo: "tenant" | "meus";
}

interface Props {
  nomeUsuario: string;
  totalFreelancers: number;
  totalIrregular: number;
  /** Pills abaixo da saudação (Buscar freelancer, Novidades). */
  pills?: React.ReactNode;
  /** "Nova solicitação" só faz sentido pra GP/produtor; aprovadores aprovam. */
  mostrarNovaSolicitacao?: boolean;
  /** Indicador no canto direito. Omite quando não há ativos (ativos === 0). */
  saude?: Saude;
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
  pills,
  mostrarNovaSolicitacao = false,
  saude,
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
          {(pills || mostrarNovaSolicitacao) && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {mostrarNovaSolicitacao && (
                <Link
                  href="/freelancers/solicitacoes"
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white shadow-brand hover:bg-california-red-hover transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Solicitar contratação
                </Link>
              )}
              {pills}
            </div>
          )}
        </div>
        {saude && saude.ativos > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
              {saude.escopo === "tenant" ? "Saúde geral" : "Minha saúde"}
            </p>
            <div className="flex items-baseline justify-end gap-2 mt-1">
              <span className="text-4xl font-bold tracking-tight tabular-nums">
                {saude.percentual}%
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5",
                  saude.percentual >= 80
                    ? "bg-emerald-500/20 text-emerald-300"
                    : saude.percentual >= 50
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-california-red/20 text-california-red",
                )}
              >
                <TrendingUp className="h-3 w-3" />
                {saude.percentual >= 80
                  ? "Bom"
                  : saude.percentual >= 50
                    ? "Atenção"
                    : "Crítico"}
              </span>
            </div>
            <p className="text-[10px] text-white/50 mt-0.5">
              {saude.saudaveis} de {saude.ativos}{" "}
              {saude.escopo === "tenant" ? "freelancers" : "freelancers meus"}{" "}
              ativos com contrato válido
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
