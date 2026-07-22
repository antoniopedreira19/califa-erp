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
        tenantNome={session.activeTenant.nome}
      />
      {/* pl-[76px] = largura colapsada da sidebar.
          Ao hover, ela expande POR CIMA do conteúdo. */}
      <main className="md:pl-[76px]">
        <div className="px-5 py-6 md:px-8 md:py-8 max-w-[1600px] mx-auto pt-20 md:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
