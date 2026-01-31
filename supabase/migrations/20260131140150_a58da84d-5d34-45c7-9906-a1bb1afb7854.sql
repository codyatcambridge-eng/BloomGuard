-- Accountability Partners table
CREATE TABLE public.accountability_partners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_device_id TEXT NOT NULL,
  partner_device_id TEXT,
  partner_email TEXT,
  invite_code TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  accepted_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.accountability_partners ENABLE ROW LEVEL SECURITY;

-- Policies for accountability partners
CREATE POLICY "Anyone can read partnerships" ON public.accountability_partners
  FOR SELECT USING (true);

CREATE POLICY "Anyone can create partnerships" ON public.accountability_partners
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update partnerships" ON public.accountability_partners
  FOR UPDATE USING (true);

-- Override Requests table
CREATE TABLE public.override_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_device_id TEXT NOT NULL,
  partner_id UUID REFERENCES public.accountability_partners(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  responded_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.override_requests ENABLE ROW LEVEL SECURITY;

-- Policies for override requests
CREATE POLICY "Anyone can read override requests" ON public.override_requests
  FOR SELECT USING (true);

CREATE POLICY "Anyone can create override requests" ON public.override_requests
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update override requests" ON public.override_requests
  FOR UPDATE USING (true);

-- Unlock Tokens table (for friction gate bypass)
CREATE TABLE public.unlock_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  reason TEXT
);

-- Enable RLS
ALTER TABLE public.unlock_tokens ENABLE ROW LEVEL SECURITY;

-- Policies for unlock tokens
CREATE POLICY "Anyone can read tokens" ON public.unlock_tokens
  FOR SELECT USING (true);

CREATE POLICY "Anyone can create tokens" ON public.unlock_tokens
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update tokens" ON public.unlock_tokens
  FOR UPDATE USING (true);

-- Add index for faster token lookups
CREATE INDEX idx_unlock_tokens_device ON public.unlock_tokens(device_id, expires_at);
CREATE INDEX idx_override_requests_requester ON public.override_requests(requester_device_id, status);
CREATE INDEX idx_accountability_invite ON public.accountability_partners(invite_code);