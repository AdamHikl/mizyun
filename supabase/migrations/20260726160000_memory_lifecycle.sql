-- MEM-001: candidate-first, thresholded memory lifecycle.
alter table public.memory_items
  alter column status set default 'candidate';

alter table public.memory_items
  add constraint memory_items_active_threshold
  check (
    status <> 'active'
    or (confidence >= 0.5 and importance >= 3)
  );

comment on constraint memory_items_active_threshold on public.memory_items is
  'Only confirmed memories meeting the recall threshold may become active.';
