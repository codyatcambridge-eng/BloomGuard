-- Create moderation_labels table for training data collection
CREATE TABLE IF NOT EXISTS public.moderation_labels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  src TEXT NOT NULL,
  page_url TEXT,
  platform TEXT,
  user_label TEXT NOT NULL CHECK (user_label IN ('shirtless', 'swimwear', 'other', 'unsure')),
  consent_upload BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  model_prediction JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_moderation_labels_user_label ON public.moderation_labels(user_label);
CREATE INDEX IF NOT EXISTS idx_moderation_labels_created_at ON public.moderation_labels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_labels_status ON public.moderation_labels(status);

-- Enable RLS
ALTER TABLE public.moderation_labels ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge function uses service role key)
CREATE POLICY "Service role full access to moderation_labels"
  ON public.moderation_labels
  FOR ALL
  USING (true)
  WITH CHECK (true);