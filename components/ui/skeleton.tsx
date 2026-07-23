import { cn } from "@/lib/utils";

/**
 * Bloco de placeholder com pulse discreto. Usado no loading.tsx do
 * grupo (app) enquanto o server termina de renderizar o conteúdo real.
 * Tom escolhido para bater com bg-muted da identidade California.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/70",
        className,
      )}
      {...props}
    />
  );
}
