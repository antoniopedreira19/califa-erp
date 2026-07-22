"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, initials } from "@/lib/utils";
import { isAdmin, roleLabel, type AppRole } from "@/lib/types";
import {
  Home,
  FileText,
  FolderKanban,
  Briefcase,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  Lock,
} from "lucide-react";

type NavLink = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Prefixos adicionais que também marcam este item como ativo. */
  activePathPrefixes?: string[];
  disabled?: boolean;
  disabledReason?: string;
  adminOnly?: boolean;
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
  {
    href: "/jobs",
    label: "Jobs",
    icon: Briefcase,
    disabled: true,
    disabledReason: "Disponível na Task 005",
  },
  {
    href: "/admin",
    label: "Administração",
    icon: ShieldCheck,
    adminOnly: true,
    disabled: true,
    disabledReason: "Em construção",
  },
];

export function Sidebar({
  role,
  nome,
  tenantNome,
}: {
  role: AppRole;
  nome: string;
  tenantNome: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  const expanded = hovered || mobileOpen;

  const visibleLinks = links.filter((l) => (l.adminOnly ? isAdmin(role) : true));

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
        className={cn(
          "fixed inset-y-0 left-0 z-40 bg-california-dark text-white flex flex-col scrollbar-dark",
          "transition-[width,transform] duration-300 ease-out",
          "w-64 -translate-x-full",
          mobileOpen && "translate-x-0",
          "md:translate-x-0",
          expanded ? "md:w-64" : "md:w-[76px]",
          hovered && "md:shadow-2xl md:shadow-black/30",
        )}
      >
        {/* Brand */}
        <div className="px-3 pt-6 pb-5 overflow-hidden">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 items-center justify-center shrink-0">
              <div
                className="absolute inset-0 rounded-xl bg-california-red/20 blur-lg"
                aria-hidden
              />
              <Image
                src="/brand/logo-icon.png"
                alt="Agência California"
                width={48}
                height={48}
                priority
                className="relative h-12 w-12 object-contain"
              />
            </div>
            <div
              className={cn(
                "min-w-0 transition-[opacity,transform] duration-200",
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
        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto scrollbar-dark">
          <p
            className={cn(
              "px-3 mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40 transition-opacity duration-200",
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

            const content = (
              <>
                {isActive && !link.disabled && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-california-red" />
                )}
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] shrink-0 transition-colors",
                    isActive && !link.disabled
                      ? "text-california-red"
                      : "text-white/50 group-hover:text-white/80",
                  )}
                />
                <span
                  className={cn(
                    "whitespace-nowrap transition-[opacity,transform] duration-200 flex-1",
                    expanded
                      ? "opacity-100 translate-x-0"
                      : "opacity-0 -translate-x-2",
                  )}
                >
                  {link.label}
                </span>
                {link.disabled && expanded && (
                  <Lock className="h-3 w-3 text-white/30 shrink-0" />
                )}
              </>
            );

            if (link.disabled) {
              return (
                <div
                  key={link.href}
                  title={tooltipTitle}
                  className={cn(
                    "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium overflow-hidden",
                    "text-white/30 cursor-not-allowed",
                  )}
                >
                  {content}
                </div>
              );
            }

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                title={tooltipTitle}
                className={cn(
                  "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors overflow-hidden",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:text-white hover:bg-white/5",
                )}
              >
                {content}
              </Link>
            );
          })}
        </nav>

        {/* Tenant + user footer */}
        <div className="p-3 space-y-2">
          <div
            className={cn(
              "rounded-xl bg-white/[0.03] border border-white/10 p-2.5 transition-opacity duration-200",
              expanded ? "opacity-100" : "opacity-0 pointer-events-none",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
              Tenant ativo
            </p>
            <p className="text-sm font-semibold text-white mt-1 truncate">
              {tenantNome}
            </p>
          </div>

          <div className="rounded-xl bg-white/5 border border-white/10 p-2.5 overflow-hidden">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-california-red text-white text-xs font-semibold shrink-0">
                {initials(nome)}
              </div>
              <div
                className={cn(
                  "min-w-0 flex-1 transition-[opacity,transform] duration-200",
                  expanded
                    ? "opacity-100 translate-x-0"
                    : "opacity-0 -translate-x-2 pointer-events-none",
                )}
              >
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
                  className={cn(
                    "p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-[opacity,colors] duration-200",
                    expanded ? "opacity-100" : "opacity-0 pointer-events-none",
                  )}
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
