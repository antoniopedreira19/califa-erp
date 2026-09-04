import { Home } from "lucide-react";

/**
 * Header padrao da home. Segue o padrao das outras pages do ERP
 * (kicker vermelho + icone + titulo + subtitulo em muted) — ver
 * docs/09-identidade-visual-ui.md secao "Header padrao da pagina".
 */
export function CabecalhoHome({
  nome,
  papel,
  subtitulo,
}: {
  nome: string;
  papel: string;
  subtitulo: string;
}) {
  const primeiroNome = nome.split(" ")[0];
  return (
    <header className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
        {papel}
      </p>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-california-red/10 p-2">
          <Home className="h-5 w-5 text-california-red" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Bem-vindo, {primeiroNome}
        </h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl">{subtitulo}</p>
    </header>
  );
}
