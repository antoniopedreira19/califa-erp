# Final Fix Report — Fornecedor Dados Completos
Date: 2026-07-31

## Applied Fixes

### FIX 1 — Bank codes "000" eliminated (Important)
- **File changed:** `scripts/atualizar-bancos-febraban.ts`
- Filter updated from `typeof b.code === "number"` to `typeof b.code === "number" && b.code > 0`.
- `npm run atualizar:bancos` re-run: 470 banks written (was 473 with 3 phantom "000" entries).
- **Verification:** `grep '"000"' lib/dados/bancos-febraban.ts` returns 0 lines. Clean.

### FIX 2 — `verificarPixDuplicado` normalization consistency (Important-borderline)
- **File changed:** `app/(app)/fornecedores/actions.ts`
- Added `import type { PixTipoChave } from "@/lib/types"`.
- Signature extended: `verificarPixDuplicado(chave, pixTipo: PixTipoChave | null, excludeId?)`.
- Implementation: if `pixTipo` is non-null, calls `normalizePixChave(pixTipo, chave)` before the DB query; falls back to `chave.trim()` when `pixTipo` is null.
- **File changed:** `app/(app)/fornecedores/fornecedor-form.tsx`
- Call site updated: `verificarPixDuplicado(chaveNormalizada, pixTipo || null, fornecedor?.id)`.

### FIX 3 — Zod: partial-bank double error removed (deferred minor)
- **File changed:** `lib/validations/fornecedores.ts`
- Final `superRefine` guard changed from `!bancoCompleto && !pixCompleto` to `!bancoParcial && !pixParcial`.
- When a user starts a bank block but hasn't finished it, the field-specific errors already fire; the summary "Preencha OU o PIX" no longer duplicates on `banco_codigo`.

### FIX 4 — Unused `TipoContaBancaria` import removed (deferred minor)
- **File changed:** `app/(app)/fornecedores/fornecedor-form.tsx`
- `TipoContaBancaria` removed from the `import type { ... } from "@/lib/types"` line.

### FIX 5 — Test script: 2 new assertions added (deferred minor)
- **File changed:** `scripts/testar-fornecedor-schema.ts`
- Added `assertErroEm("chave CNPJ com DV inválido", ...)` — uses "12345678901234" (14 digits, invalid checksum, not all-same digit).
- Added `assertErroEm("chave aleatoria muito curta", ...)` — uses "abc123" (6 chars, well below the 32-char floor for aleatoria).

## Verification Results

| Step | Result |
|------|--------|
| `npm run atualizar:bancos` | OK — 470 banks, "000" codes gone |
| `grep '"000"' lib/dados/bancos-febraban.ts` | 0 lines |
| `npx tsx scripts/testar-fornecedor-schema.ts` | 15 OK / 0 falha(s) |
| `npm run typecheck` | 0 errors |
| `npm run build` | Clean (1 pre-existing a11y warning on combobox.tsx, not introduced here) |

## Concerns / Notes

- The combobox a11y warning (`aria-controls`, `aria-expanded` missing on role="combobox") existed before this branch and is out of scope for this fix wave.
- `normalizePixChave` signature takes `(pix_tipo, pix_chave)` — the new call in `verificarPixDuplicado` passes args in the correct order `(pixTipo, chave)`.
- The Zod FIX 3 changes observable behavior: previously, submitting with only `banco_codigo` filled would show both field errors AND the summary. Now only field errors fire. The "at least one block" enforcement is preserved — submitting with nothing still shows the summary error.
