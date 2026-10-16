import Image from "next/image";

export default function FormPublicoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header enxuto, sem sidebar */}
      <header className="border-b border-border bg-white">
        <div className="max-w-3xl mx-auto px-5 py-4 flex items-center gap-3">
          <Image
            src="/brand/logo-icon.png"
            alt="Agência California"
            width={40}
            height={40}
            priority
            className="h-10 w-10 object-contain shrink-0"
          />
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Agência
            </p>
            <h1 className="font-display text-lg font-semibold tracking-tight leading-none mt-0.5">
              California
            </h1>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-3xl mx-auto w-full px-5 py-8">
        {children}
      </main>
      <footer className="border-t border-border bg-white">
        <div className="max-w-3xl mx-auto px-5 py-3 text-[11px] text-muted-foreground text-center">
          Problemas com o link? Entre em contato com quem te enviou.
        </div>
      </footer>
    </div>
  );
}
