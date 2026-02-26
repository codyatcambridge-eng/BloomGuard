-- Move moderation_labels writes from API key/service role to user-authenticated JWT flow.
ALTER TABLE public.moderation_labels
  ADD COLUMN IF NOT EXISTS user_id UUID;

CREATE INDEX IF NOT EXISTS idx_moderation_labels_user_id_created_at
  ON public.moderation_labels(user_id, created_at DESC);

ALTER TABLE public.moderation_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to moderation_labels" ON public.moderation_labels;
DROP POLICY IF EXISTS "Authenticated users can insert own moderation_labels" ON public.moderation_labels;
DROP POLICY IF EXISTS "Authenticated users can select own moderation_labels" ON public.moderation_labels;

CREATE POLICY "Authenticated users can insert own moderation_labels"
  ON public.moderation_labels
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can select own moderation_labels"
  ON public.moderation_labels
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
