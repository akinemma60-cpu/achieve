drop policy if exists "Users can save their coach messages"
  on public.coach_messages;

create policy "Users can save their own coach prompts"
  on public.coach_messages for insert to authenticated
  with check ((select auth.uid()) = user_id and role = 'user');

grant insert on public.coach_messages to service_role;
