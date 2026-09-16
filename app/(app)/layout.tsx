import { requireSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        role={session.activeRole}
        nome={session.profile.nome}
      />
      {/* pl-[76px] = largura colapsada da sidebar.
          Ao hover, ela expande POR CIMA do conteúdo.

          max-w-[1680px] com px-8 = 1616px de conteúdo. É o ÚNICO teto de
          largura das telas principais, que não definem largura própria
          (decisão 085). Mudar aqui alarga todas elas juntas. */}
      <main className="md:pl-[76px]">
        <div className="px-5 py-6 md:px-8 md:py-8 max-w-[1680px] mx-auto pt-20 md:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
