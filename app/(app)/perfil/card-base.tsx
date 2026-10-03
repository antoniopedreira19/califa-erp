import type { ComponentType } from "react";

/**
 * Casca comum pros cards do /perfil. Garante consistência visual
 * (header com título + ícone + ação opcional, corpo com padding igual).
 */
export function CardBase({
  titulo,
  icon: Icon,
  acao,
  children,
  variante = "normal",
}: {
  titulo: string;
  icon?: ComponentType<{ className?: string }>;
  acao?: React.ReactNode;
  children: React.ReactNode;
  /** 'placeholder' aplica estilo esmaecido pra cards "em breve". */
  variante?: "normal" | "placeholder";
}) {
  const bgCls =
    variante === "placeholder"
      ? "bg-muted/30 border-dashed"
      : "bg-card";
  return (
    <section
      className={`rounded-2xl border border-border ${bgCls} shadow-soft overflow-hidden`}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {titulo}
          </h2>
        </div>
        {acao}
      </header>
      <div className="p-6">{children}</div>
    </section>
  );
}

/**
 * Campo rotulado padrão. Rótulo em CAPS LOCK cinza, valor em texto
 * normal. Valor vazio mostra "—".
 */
export function Campo({
  rotulo,
  valor,
  mono,
}: {
  rotulo: string;
  valor: string | null | undefined;
  mono?: boolean;
}) {
  const vazio = !valor;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={`text-sm ${vazio ? "text-muted-foreground" : "font-medium text-foreground"} ${mono ? "font-mono text-[13px]" : ""}`}
      >
        {valor ?? "—"}
      </p>
    </div>
  );
}

/**
 * Mensagem padrão pra cards "em breve" (benefícios, nota fiscal,
 * documentos). Mantém a casca do card mas sinaliza que a feature
 * ainda não existe.
 */
export function EmBreve({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
        Em breve
      </span>
      <p className="text-sm text-muted-foreground max-w-sm">{texto}</p>
    </div>
  );
}
