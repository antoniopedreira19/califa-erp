import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="text-center space-y-4 max-w-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Erro 404
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Página não encontrada
        </h1>
        <p className="text-sm text-muted-foreground">
          A página que você procura não existe ou foi movida.
        </p>
        <Link
          href="/home"
          className="inline-flex items-center justify-center rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-california-red-hover transition-colors"
        >
          Voltar ao início
        </Link>
      </div>
    </div>
  );
}
