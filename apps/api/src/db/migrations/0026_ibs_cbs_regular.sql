-- Apuração do IBS e da CBS (F4-13): o optante pelo Simples Nacional pode escolher apurar o IBS e a
-- CBS pelo regime regular (LC 214/2025, art. 41, § 3º). Sem a opção, eles vão no DAS.
alter table companies add column ibs_cbs_regular boolean not null default false;
