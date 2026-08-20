"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, initials } from "@/lib/utils";
import { roleLabel, type AppRole } from "@/lib/types";
import {
  Home,
  FileText,
  FolderKanban,
  Briefcase,
  Landmark,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Lock,
  Wallet,
} from "lucide-react";

type NavLink = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Prefixos adicionais que também marcam este item como ativo. */
  activePathPrefixes?: string[];
  disabled?: boolean;
  disabledReason?: string;
  /** Roles que podem ver este item. Undefined = visível para todos. */
  roles?: AppRole[];
};

const links: NavLink[] = [
  { href: "/home", label: "Home", icon: Home },
  {
    href: "/cadastros",
    label: "Cadastros",
    icon: FolderKanban,
    activePathPrefixes: ["/clientes", "/fornecedores"],
  },
  { href: "/orcamentos", label: "Orçamentos", icon: FileText },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  {
    href: "/financeiro",
    label: "Financeiro",
    icon: Landmark,
    roles: ["administrador", "financeiro"],
  },
  {
    href: "/financeiro/desembolsos",
    label: "Desembolsos",
    icon: Wallet,
    activePathPrefixes: ["/financeiro/desembolsos"],
  },
  {
    href: "/admin",
    label: "Administração",
    icon: ShieldCheck,
    roles: ["administrador"],
  },
];

// Larguras fixas em px pra animação de width funcionar (CSS não interpola auto/full).
// - Colapsada: 76px total; item bg é 44×44 centrado (76 - 44 = 32 → 16px cada lado).
// - Expandida: 256px total; item bg ocupa 232px (256 - 12 px de padding cada lado).
const SIDEBAR_W_COLLAPSED = 76;
const SIDEBAR_W_EXPANDED = 256;
const ITEM_W_COLLAPSED = 44; // w-11
const ITEM_W_EXPANDED = SIDEBAR_W_EXPANDED - 24; // 24 = nav px-3 * 2

const TRANSITION_MS = 300;

export function Sidebar({
  role,
  nome,
}: {
  role: AppRole;
  nome: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  const expanded = hovered || mobileOpen;

  const visibleLinks = links.filter((l) => (!l.roles || l.roles.includes(role)));

  // Largura do bg de cada item — animável porque são valores numéricos px.
  const itemBgWidth = expanded ? ITEM_W_EXPANDED : ITEM_W_COLLAPSED;
  const transitionStyle: React.CSSProperties = {
    transitionProperty: "width, background-color, opacity, transform",
    transitionDuration: `${TRANSITION_MS}ms`,
    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)", // ease-in-out suave
  };

  return (
    <>
      {/* Toggle mobile */}
      <button
        type="button"
        className="fixed top-4 left-4 z-50 md:hidden p-2.5 rounded-lg bg-california-dark text-white shadow-elevated"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          transitionProperty: "width, transform",
          transitionDuration: `${TRANSITION_MS}ms`,
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 bg-california-dark text-white flex flex-col scrollbar-dark",
          "w-64 -translate-x-full",
          mobileOpen && "translate-x-0",
          "md:translate-x-0",
          expanded ? "md:w-64" : "md:w-[76px]",
          hovered && "md:shadow-2xl md:shadow-black/30",
        )}
      >
        {/* Brand */}
        <div className="px-3 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <Image
              src="/brand/logo-icon.png"
              alt="Agência California"
              width={48}
              height={48}
              priority
              className="h-12 w-12 object-contain shrink-0"
            />
            <div
              style={transitionStyle}
              className={cn(
                "min-w-0 overflow-hidden",
                expanded
                  ? "opacity-100 translate-x-0"
                  : "opacity-0 -translate-x-2 pointer-events-none",
              )}
            >
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/50 whitespace-nowrap">
                Agência
              </p>
              <h1 className="font-display text-xl font-semibold tracking-tight leading-none mt-1 whitespace-nowrap">
                California
              </h1>
            </div>
          </div>
        </div>

        <div className="px-4">
          <div className="h-px bg-white/10" />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto overflow-x-hidden scrollbar-dark">
          <p
            style={transitionStyle}
            className={cn(
              "px-3 mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40",
              expanded ? "opacity-100" : "opacity-0",
            )}
          >
            Menu
          </p>
          {visibleLinks.map((link) => {
            const Icon = link.icon;
            const isActive =
              pathname === link.href ||
              pathname.startsWith(link.href + "/") ||
              (link.activePathPrefixes?.some(
                (p) => pathname === p || pathname.startsWith(p + "/"),
              ) ?? false);
            const tooltipTitle = !expanded
              ? link.label + (link.disabled ? " (em breve)" : "")
              : link.disabled
                ? link.disabledReason
                : undefined;

            const activeBar = isActive && !link.disabled && (
              <span className="absolute inset-y-0 left-0 w-1 bg-california-red" />
            );

            // Estrutura interna:
            // - Container fixo h-11 com width animável (44 → 232 px)
            // - Slot de ícone fixo 44px (sempre centrado), garante que o ícone
            //   fique no mesmo ponto quando colapsado e "no início" quando expandido
            // - Label ocupa o restante do espaço (só visível quando > 44px)
            const bg = (
              <div
                style={{ ...transitionStyle, width: `${itemBgWidth}px` }}
                className={cn(
                  "relative flex items-center h-11 rounded-lg overflow-hidden text-sm font-medium shrink-0",
                  link.disabled
                    ? "text-white/30 cursor-not-allowed"
                    : isActive
                      ? "bg-[#3E3E3E] text-white"
                      : "text-white/60 group-hover:text-white group-hover:bg-white/5",
                )}
              >
                {activeBar}
                {/* Slot do ícone (44px fixos) */}
                <div className="flex h-full w-11 shrink-0 items-center justify-center">
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] transition-colors",
                      isActive && !link.disabled
                        ? "text-california-red"
                        : "text-white/50 group-hover:text-white/80",
                    )}
                  />
                </div>
                {/* Label + lock: sempre renderizados, opacidade transiciona */}
                <div
                  style={transitionStyle}
                  className={cn(
                    "flex flex-1 items-center gap-2 pr-3 min-w-0",
                    expanded ? "opacity-100" : "opacity-0",
                  )}
                >
                  <span className="truncate whitespace-nowrap flex-1">
                    {link.label}
                  </span>
                  {link.disabled && (
                    <Lock className="h-3 w-3 text-white/30 shrink-0" />
                  )}
                </div>
              </div>
            );

            if (link.disabled) {
              return (
                <div
                  key={link.href}
                  title={tooltipTitle}
                  className="group flex justify-center"
                >
                  {bg}
                </div>
              );
            }

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                title={tooltipTitle}
                className="group flex justify-center"
              >
                {bg}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-3 flex justify-center">
          <div
            style={{ ...transitionStyle, width: `${itemBgWidth}px` }}
            className="flex items-center h-11 rounded-xl bg-white/5 border border-white/10 overflow-hidden shrink-0"
          >
            {/* Slot do avatar (44px fixos, centralizado quando colapsado) */}
            <div className="flex h-full w-11 shrink-0 items-center justify-center">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-full bg-california-red text-white text-[11px] font-semibold"
                title={`${nome} · ${roleLabel(role)}`}
              >
                {initials(nome)}
              </div>
            </div>
            {/* Nome + role + logout: opacidade transiciona */}
            <div
              style={transitionStyle}
              className={cn(
                "flex flex-1 items-center gap-2 pr-1 min-w-0",
                expanded ? "opacity-100" : "opacity-0 pointer-events-none",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate whitespace-nowrap">
                  {nome}
                </p>
                <p className="text-[10px] text-white/50 uppercase tracking-wider truncate whitespace-nowrap">
                  {roleLabel(role)}
                </p>
              </div>
              <form action="/api/auth/logout" method="post" className="shrink-0">
                <button
                  type="submit"
                  title="Sair"
                  className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
