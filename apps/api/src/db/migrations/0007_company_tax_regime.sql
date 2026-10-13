-- F3-06.c: regime tributário da empresa. É ele que decide o CRT da nota, se o ICMS usa CSOSN ou
-- CST e de onde vêm o PIS e a COFINS. Fica nulo até o lojista informar: o sistema não supõe.
alter table companies
  add column tax_regime text
  check (tax_regime in ('mei', 'simples', 'simples-excesso', 'presumido', 'real'));
