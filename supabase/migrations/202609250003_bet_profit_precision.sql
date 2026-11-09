-- Fractional-unit stakes can produce four-decimal unit profit.
alter table public.bets
  alter column profit_units type numeric(9,4);
