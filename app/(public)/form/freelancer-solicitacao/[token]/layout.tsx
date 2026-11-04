import Image from "next/image";

export default function FormPublicoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F6F3EE] flex flex-col">
      {/* Grão sutil sobre o fundo bege — dá textura sem imagem, não atrapalha
          leitura. Opacity baixíssima; só percebe se olhar de perto. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.035] mix-blend-multiply"
        style={{
          backgroundImage:
            "radial-gradient(#282828 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <header className="relative z-10 border-b border-black/5 bg-[#F6F3EE]/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <Image
            src="/brand/logo-icon.png"
            alt="Agência California"
            width={40}
            height={40}
            priority
            className="h-10 w-10 object-contain shrink-0"
          />
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground/50">
              Agência
            </p>
            <h1 className="font-display text-lg font-semibold tracking-tight leading-none mt-0.5 text-foreground">
              California
            </h1>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 w-full">{children}</main>

      <footer className="relative z-10 border-t border-black/5 bg-transparent">
        <div className="max-w-6xl mx-auto px-6 py-4 text-[11px] text-foreground/50 text-center">
          Problemas com o link? Fale com quem te enviou.
        </div>
      </footer>
    </div>
  );
}
