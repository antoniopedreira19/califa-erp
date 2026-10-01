import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/sidebar";
import { RastroDeNavegacao } from "@/components/voltar/rastro-de-navegacao";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  // Role `colaborador`: acesso restrito só a /perfil. Sem sidebar.
  // Qualquer rota ≠ /perfil redireciona pra lá. Fluxo: colaborador recebe
  // acesso via convite com role inicial colaborador (ver docs/modulos/rh/
  // 25-ferias.md §9).
  if (session.activeRole === "colaborador") {
    const pathname = headers().get("x-pathname") ?? "";
    if (pathname && pathname !== "/perfil" && !pathname.startsWith("/perfil/")) {
      redirect("/perfil");
    }

    return (
      <div className="min-h-screen bg-background">
        <main>
          <div className="px-5 py-6 md:px-8 md:py-8 max-w-[1680px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        role={session.activeRole}
        nome={session.profile.nome}
      />
      {/* Rastro das páginas desta aba, para o botão Voltar (decisão 108).
          Não desenha nada; o Suspense é exigência do useSearchParams. */}
      <Suspense fallback={null}>
        <RastroDeNavegacao />
      </Suspense>
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
