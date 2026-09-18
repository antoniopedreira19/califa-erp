-- A marca gravada nos dois jobs do "Beats Esquenta Festivals".
--
-- `jobs.produto` é TEXTO, uma cópia do nome da marca tirada na abertura do
-- job — não uma FK para `cliente_produtos`. Por isso mover o projeto para
-- a AMBEV (migration `20260918180003`) não o alcançou, e a tela do job
-- continuou mostrando a marca antiga:
--
--   JOB-0024 Beats Esquenta Festivals | Artístico   → dizia "Novo"
--   JOB-0025 Beats Esquenta Festivals | Clearance   → dizia "AMBEV"
--
-- Os dois passam a dizer BEATS, que é a marca do projeto. Foi a tela que
-- mostrou a divergência: no banco, `jobs` não tem coluna de marca com FK,
-- e a varredura por `produto_id`/`marca_id` não encontrou nada.

update public.jobs
   set produto = 'BEATS'
 where projeto_id = 'c4b34423-aae4-4f2f-a63f-dd2df2f181f1'
   and produto is distinct from 'BEATS';
