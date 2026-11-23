-- 276 — O cliente dos jobs da planilha que têm NF esperando a carga.
--
-- A carga das NFs da planilha (decisão 276) deixou 25 NFs "a decidir" porque o job da
-- planilha (historico_jobs) estava sem cliente: a importação da planilha (decisão 211)
-- não achou o cliente pelo nome escrito na planilha. Para 18 desses jobs o cliente já
-- está no cadastro, com outro nome (Tiago, 23/11: "Pode seguir" — ligar os clientes que
-- já existem; os que faltam o financeiro cadastra):
--
-- - "Warner" na planilha é a Warner Music (os jobs WAR-* e as NFs 6337 e 6338 do sistema
--   são dela; a Warner Bros a planilha escreve "Warner Bros", e esses jobs já têm o
--   cliente certo);
-- - "Influent Summit" é a INFLUENT & CO;
-- - "Checklist" é a CheckList Eventos;
-- - "Ventura" (o job HigiExpo, que a aba Faturamento põe no cliente AGC Vidros) é a AGC Vidros;
-- - "Ambev" e "Prefeitura Ambev" (o Fee São Sebastião, cujo 3T é o AMB-1055, da Ambev)
--   são a Ambev.
--
-- Ficam sem cliente, até o financeiro decidir: Mercado Livre (dois cadastros: EBAZAR e
-- Mercado Pago, com jobs nos dois), Embratur, Amazon, Spotify, Orla, Montenegro, Ville
-- Comércio e Oppa.
--
-- Só preenche o que está vazio (aditiva): uma linha do job que já tem cliente fica como está.

with mapa(cliente_id, chave) as (
  values
    -- Warner Music
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER FESTAS MADONNA CONTEUDO 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER FILMES POLAROID 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER ATIVACAO K10 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER AGROBOY CONTEUDO 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER FEE 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER IZA FEE 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER FEE MIDIA ON 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER IZA FEE 4T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER AMAR OU ODIAR FERRUGEM 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER LINKIN PARK CONTEUDO 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER FELIPE RODRIGO CONTEUDO 3T 2026'),
    ('4b8c3170-07ce-405f-828c-b77c8250a905'::uuid, 'job:WARNER CLAYTON E ROMARIO CONTEUDO 3T 2026'),
    -- INFLUENT & CO
    ('b0a1c87c-3c10-4f7d-bf80-d2206445bedf'::uuid, 'job:COMMUNITY INFLUENT SUMMITY 3T 2025'),
    ('b0a1c87c-3c10-4f7d-bf80-d2206445bedf'::uuid, 'job:COMMUNITY INFLUENT SUMMITY EXTRA 3T 2025'),
    -- CheckList Eventos
    ('9f11f29e-3883-4457-bb02-f2c814e045fd'::uuid, 'job:CASA CALIFORNIA TAKO 4T 2026'),
    -- AGC Vidros
    ('88a704ac-b111-4cd6-b6b1-93c6ea1a018a'::uuid, 'evento:VENTURA HIGIEXPO 3T 2026'),
    -- Ambev
    ('f9430c39-aa70-4cf8-bab1-89d2001daafc'::uuid, 'job:FEE SAO SEBASTIAO 2T 2026'),
    ('f9430c39-aa70-4cf8-bab1-89d2001daafc'::uuid, 'job:SKOL PAGODE RODA PROMO 1T 2022')
)
update public.historico_jobs h
   set cliente_id = m.cliente_id
  from mapa m
 where h.chave = m.chave
   and h.cliente_id is null
   and h.tenant_id = (select id from public.tenants where nome = 'Agência California')
   and exists (select 1 from public.clientes c where c.id = m.cliente_id and c.tenant_id = h.tenant_id);
