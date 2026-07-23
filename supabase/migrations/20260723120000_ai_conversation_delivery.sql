alter table public.messages
  add column status text not null default 'complete'
    check (status in ('complete', 'failed')),
  add column idempotency_key text;

create unique index messages_user_conversation_idempotency_idx
on public.messages(user_id, conversation_id, idempotency_key)
where role = 'user' and idempotency_key is not null;
