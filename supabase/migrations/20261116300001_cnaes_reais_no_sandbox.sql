-- O "CNAE sugerido" do envio para faturamento lista os CNAEs ativos de TODOS
-- os CNPJs do tenant (empresas contábeis, não as gerenciais), sem repetir
-- código + subitem (`cnaesDoGrupo`, lib/fiscal/cadastro.ts).
--
-- O Sandbox só tem dois estabelecimentos fiscais, cópias da California ·
-- Salvador ("Empresa Teste · Salvador") e da Hitlab ("Empresa Teste
-- Presumido · Salvador"). A lista dele saía com 23 códigos; a da produção tem
-- 30. Faltavam os que só existem na California · Fortaleza (90.01-9-03 e
-- 93.19-1-01) e na GoCrazy · Santo André (52.50-8-03, 59.12-0-99, 70.20-4-00,
-- 73.11-4-00 e 77.40-3-00).
--
-- Pedido do Tiago (16/11/2026), para o vídeo do envio para faturamento: a
-- lista do Sandbox igual à real. Os 7 entram copiados da produção (código,
-- subitem, atividade, alíquotas e vigência), no estabelecimento "Empresa
-- Teste · Salvador" — o Sandbox não tem cópia da Fortaleza nem da GoCrazy.
--
-- Só aditiva e só no Sandbox: nenhuma linha da produção muda, nenhuma do
-- Sandbox é sobrescrita. Idempotente (NOT EXISTS por código + subitem).
-- A tabela já tem RLS, policies, GRANT e índices desde a criação.

insert into public.fiscal_cnaes (
  tenant_id, estabelecimento_id, codigo, subitem, descricao,
  aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo,
  vigencia_inicio, vigencia_fim, ativo
)
select
  sb.id, est.id, p.codigo, p.subitem, p.descricao,
  p.aliquota_iss, p.aliquota_pis, p.aliquota_cofins, p.cumulativo,
  p.vigencia_inicio, p.vigencia_fim, true
from (
  select distinct on (c.codigo, coalesce(c.subitem, ''))
    c.codigo, c.subitem, c.descricao, c.aliquota_iss, c.aliquota_pis,
    c.aliquota_cofins, c.cumulativo, c.vigencia_inicio, c.vigencia_fim
  from public.fiscal_cnaes c
  join public.tenants t on t.id = c.tenant_id and t.slug = 'agencia-california'
  where c.ativo
  order by c.codigo, coalesce(c.subitem, ''), c.created_at
) p
cross join (select id from public.tenants where slug = 'california-sandbox') sb
join public.fiscal_estabelecimentos est
  on est.tenant_id = sb.id and est.nome = 'Empresa Teste · Salvador'
where not exists (
  select 1 from public.fiscal_cnaes s
  where s.tenant_id = sb.id
    and s.ativo
    and s.codigo = p.codigo
    and coalesce(s.subitem, '') = coalesce(p.subitem, '')
);
