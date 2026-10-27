"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SubNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Como decidir se este item está ativo dado o pathname corrente. */
  isActive: (pathname: string) => boolean;
};

const items: SubNavItem[] = [
  {
    href: "/freelancers",
    label: "Dashboard",
    icon: LayoutDashboard,
    isActive: (p) => p === "/freelancers",
  },
  {
    href: "/freelancers/solicitacoes",
    label: "Solicitações",
    icon: ClipboardList,
    isActive: (p) => p === "/freelancers/solicitacoes" || p.startsWith("/freelancers/solicitacoes/"),
  },
  {
    href: "/freelancers/lista",
    label: "Freelancers",
    icon: Users,
    isActive: (p) =>
      p === "/freelancers/lista" ||
      p.startsWith("/freelancers/lista/") ||
      // Rotas internas (perfil, novo, contratos) tratadas na Task 013:
      p === "/freelancers/novo" ||
      p.startsWith("/freelancers/novo/") ||
      p.startsWith("/freelancers/contratos/") ||
      // Qualquer /freelancers/<id>/* não coberto acima também acende "Freelancers".
      // Match defensivo: tudo que começa com /freelancers/ e NÃO é dashboard,
      // solicitações ou responsáveis.
      (p.startsWith("/freelancers/") &&
        !p.startsWith("/freelancers/solicitacoes") &&
        !p.startsWith("/freelancers/responsaveis") &&
        p !== "/freelancers"),
  },
  {
    href: "/freelancers/responsaveis",
    label: "Responsáveis",
    icon: UserCog,
    isActive: (p) =>
      p === "/freelancers/responsaveis" ||
      p.startsWith("/freelancers/responsaveis/"),
  },
];

export function FreelancersSubNav({
  countSolicitacoes = 0,
  mostrarResponsaveis = false,
}: {
  countSolicitacoes?: number;
  /** Tab "Responsáveis" só pra admin/rh/financeiro; GP/produtor não enxerga. */
  mostrarResponsaveis?: boolean;
}) {
  const pathname = usePathname();
  const itensVisiveis = items.filter(
    (i) => i.href !== "/freelancers/responsaveis" || mostrarResponsaveis,
  );

  return (
    <div className="border-b border-border -mx-5 md:-mx-8 px-5 md:px-8 mb-6">
      <nav
        className="flex items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Seções do módulo Freelancers"
      >
        {itensVisiveis.map((item) => {
          const Icon = item.icon;
          const active = item.isActive(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-california-red" : "text-muted-foreground/70",
                )}
              />
              <span>{item.label}</span>
              {item.href === "/freelancers/solicitacoes" && countSolicitacoes > 0 && (
                <span
                  className="tabular-nums rounded-full bg-california-red px-1.5 py-0.5 text-[10px] leading-none text-white font-semibold"
                  aria-label={`${countSolicitacoes} pendente${countSolicitacoes === 1 ? "" : "s"}`}
                >
                  {countSolicitacoes}
                </span>
              )}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-0.5 bg-california-red"
                />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
