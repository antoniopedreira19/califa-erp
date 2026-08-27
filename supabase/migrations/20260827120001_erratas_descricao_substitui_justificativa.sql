-- A errata tem UM texto, e ele é a descrição.
--
-- ⚠️ DESTRUTIVA. `jobs_erratas.justificativa` sai, e com ela o conteúdo de
-- 2 das 8 erratas gravadas. Autorizada explicitamente pelo Tiago em
-- 27/08/2026, depois de avisado de que o histórico dessas duas some.
--
-- O modo errata (decisão 030) trocou o par "título curto obrigatório +
-- justificativa opcional" por um campo só, "Descrição da errata", que é
-- obrigatório. Ele grava em `titulo`, que já era a coluna lida pelo card do
-- histórico e pelo fio da Comunicação. `justificativa` parou de ser
-- preenchida no mesmo dia e ficou sem leitor.
--
-- O código que ainda escrevia nela saiu junto, no mesmo commit:
-- `registrarErrataDeSave` (que aceitava um argumento que ninguém passava) e
-- o parágrafo do `erratas-card`.

alter table public.jobs_erratas
  drop column if exists justificativa;

comment on column public.jobs_erratas.titulo is
  'A "Descrição da errata" — o único texto da errata desde 27/08/2026, e obrigatório. Antes era um título curto ao lado de uma justificativa opcional (decisão 030).';
