drop policy if exists "Users can record their lesson completion"
  on public.learning_progress;

create policy "Users can record their lesson completion"
  on public.learning_progress for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      (path_id = 'clear-communication' and lesson_id in (
        'one-clear-point',
        'structure-a-story',
        'ask-better-questions'
      ))
      or (path_id = 'focused-work' and lesson_id in (
        'choose-one-outcome',
        'reduce-friction',
        'review-and-adjust'
      ))
      or (path_id = 'career-direction' and lesson_id in (
        'energy-audit',
        'strength-evidence',
        'run-a-small-experiment'
      ))
    )
  );
