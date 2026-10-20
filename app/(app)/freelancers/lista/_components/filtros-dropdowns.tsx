"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Users, Briefcase, Tag, Calendar } from "lucide-react";
import { cn, nomeCurto } from "@/lib/utils";
import { useExclusiveDropdown } from "../../_components/use-exclusive-dropdown";

/**
 * Dropdowns de filtro na linha da busca:
 * - Responsáveis (multi) → ?responsavel=uuid1,uuid2
 * - Jobs (multi)        → ?job=uuid1,uuid2
 * - Cargos (single)     → ?cargo=label
 * - Início (range)      → ?inicio_apos=YYYY-MM-DD
 *
 * O filtro Período de início aqui é simples: "últimos N dias". O server-side
 * aceita qualquer data ISO em ?inicio_apos= — a UI oferece atalhos.
 */

interface Props {
  responsaveisDisponiveis: Array<{ id: string; nome: string }>;
  jobsDisponiveis: Array<{ id: string; label: string }>;
  cargosDisponiveis: string[];
}

const INICIO_PRESETS: Array<{ label: string; dias: number | null }> = [
  { label: "Qualquer data", dias: null },
  { label: "Últimos 7 dias", dias: 7 },
  { label: "Últimos 15 dias", dias: 15 },
  { label: "Últimos 30 dias", dias: 30 },
  { label: "Últimos 60 dias", dias: 60 },
  { label: "Últimos 90 dias", dias: 90 },
];

export function FiltrosDropdowns({
  responsaveisDisponiveis,
  jobsDisponiveis,
  cargosDisponiveis,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const responsaveisAtivos = React.useMemo(() => {
    const raw = searchParams.get("responsavel");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  const jobsAtivos = React.useMemo(() => {
    const raw = searchParams.get("job");
    if (!raw) return new Set<string>();
    return new Set(raw.split(",").filter(Boolean));
  }, [searchParams]);

  const cargoAtual = searchParams.get("cargo") ?? "";
  const inicioApos = searchParams.get("inicio_apos") ?? "";

  function alterar(fn: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    fn(params);
    const qs = params.toString();
    router.push(`/freelancers/lista${qs ? `?${qs}` : ""}`);
  }

  function toggleResp(id: string) {
    const nova = new Set(responsaveisAtivos);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    alterar((p) => {
      if (nova.size > 0) p.set("responsavel", Array.from(nova).join(","));
      else p.delete("responsavel");
    });
  }

  function toggleJob(id: string) {
    const nova = new Set(jobsAtivos);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    alterar((p) => {
      if (nova.size > 0) p.set("job", Array.from(nova).join(","));
      else p.delete("job");
    });
  }

  function setCargo(novo: string) {
    alterar((p) => {
      if (novo) p.set("cargo", novo);
      else p.delete("cargo");
    });
  }

  function setInicio(dias: number | null) {
    alterar((p) => {
      if (dias === null) p.delete("inicio_apos");
      else {
        const d = new Date();
        d.setDate(d.getDate() - dias);
        p.set("inicio_apos", d.toISOString().slice(0, 10));
      }
    });
  }

  const inicioPresetAtivo = React.useMemo(() => {
    if (!inicioApos) return null;
    const diff = Math.round(
      (Date.now() - new Date(inicioApos + "T00:00:00").getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return INICIO_PRESETS.find((p) => p.dias === diff) ?? null;
  }, [inicioApos]);

  return (
    <>
      <MultiSelectDropdown
        label="Todos os responsáveis"
        icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
        options={responsaveisDisponiveis.map((r) => ({
          value: r.id,
          label: nomeCurto(r.nome),
        }))}
        selected={responsaveisAtivos}
        onToggle={toggleResp}
      />

      <MultiSelectDropdown
        label="Todos os jobs"
        icon={<Briefcase className="h-3.5 w-3.5 text-muted-foreground" />}
        options={jobsDisponiveis.map((j) => ({
          value: j.id,
          label: j.label,
        }))}
        selected={jobsAtivos}
        onToggle={toggleJob}
      />

      <SingleSelectDropdown
        label="Todos os cargos"
        icon={<Tag className="h-3.5 w-3.5 text-muted-foreground" />}
        options={cargosDisponiveis.map((c) => ({ value: c, label: c }))}
        selected={cargoAtual}
        onSelect={setCargo}
      />

      <PresetDropdown
        label="Todos os inícios"
        icon={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
        atual={inicioPresetAtivo}
        presets={INICIO_PRESETS}
        onSelect={setInicio}
      />
    </>
  );
}

function MultiSelectDropdown({
  label,
  icon,
  options,
  selected,
  onToggle,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const { open, toggleOpen, containerRef } = useExclusiveDropdown();
  if (options.length === 0) return null;
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="h-10 inline-flex items-center gap-2 rounded-lg px-3 text-sm font-medium border bg-white text-foreground border-border hover:border-california-red/40 transition-all"
      >
        {icon}
        <span>{label}</span>
        {selected.size > 0 && (
          <span className="tabular-nums rounded-full bg-california-red text-white px-1.5 py-0.5 text-[10px] leading-none font-semibold">
            {selected.size}
          </span>
        )}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[240px] max-w-[360px] max-h-[320px] overflow-y-auto rounded-xl border border-border bg-white shadow-elevated p-1">
          {options.map((o) => {
            const checked = selected.has(o.value);
            return (
              <label
                key={o.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(o.value)}
                  className="h-3.5 w-3.5 rounded border-border accent-california-red"
                />
                <span className="truncate">{o.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SingleSelectDropdown({
  label,
  icon,
  options,
  selected,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (v: string) => void;
}) {
  const { open, toggleOpen, close, containerRef } = useExclusiveDropdown();
  if (options.length === 0) return null;
  const atual = options.find((o) => o.value === selected);
  function pick(v: string) {
    onSelect(v);
    close();
  }
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="h-10 inline-flex items-center gap-2 rounded-lg px-3 text-sm font-medium border bg-white text-foreground border-border hover:border-california-red/40 transition-all"
      >
        {icon}
        <span>{atual ? atual.label : label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[240px] max-w-[360px] max-h-[320px] overflow-y-auto rounded-xl border border-border bg-white shadow-elevated p-1">
          <button
            type="button"
            onClick={() => pick("")}
            className={cn(
              "block w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/40 text-xs",
              !selected && "font-semibold text-california-red",
            )}
          >
            {label}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => pick(o.value)}
              className={cn(
                "block w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/40 text-xs",
                selected === o.value && "font-semibold text-california-red",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PresetDropdown({
  label,
  icon,
  atual,
  presets,
  onSelect,
}: {
  label: string;
  icon?: React.ReactNode;
  atual: { label: string; dias: number | null } | null;
  presets: Array<{ label: string; dias: number | null }>;
  onSelect: (dias: number | null) => void;
}) {
  const { open, toggleOpen, close, containerRef } = useExclusiveDropdown();
  function pick(dias: number | null) {
    onSelect(dias);
    close();
  }
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        className="h-10 inline-flex items-center gap-2 rounded-lg px-3 text-sm font-medium border bg-white text-foreground border-border hover:border-california-red/40 transition-all"
      >
        {icon}
        <span>{atual ? atual.label : label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 min-w-[200px] rounded-xl border border-border bg-white shadow-elevated p-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => pick(p.dias)}
              className={cn(
                "block w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/40 text-xs",
                atual?.dias === p.dias && "font-semibold text-california-red",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
