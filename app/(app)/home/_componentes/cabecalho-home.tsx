import { Home } from "lucide-react";

/**
 * Header da home: icone + "Bem-vindo, {primeiro nome}" + subtitulo.
 * Sem kicker de area (o padrao das outras pages) porque na home o papel
 * ja e evidente pelo avatar da sidebar e nao ha navegacao pra
 * contextualizar.
 */
export function CabecalhoHome({
  nome,
  subtitulo,
}: {
  nome: string;
  subtitulo: string;
}) {
  const primeiroNome = nome.split(" ")[0];
  return (
    <header className="space-y-2">
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
