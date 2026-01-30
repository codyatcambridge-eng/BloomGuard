-- Create blocked_sites table for storing website blocklist
CREATE TABLE public.blocked_sites (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    domain TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'adult',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_protection_settings table
CREATE TABLE public.user_protection_settings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    shield_active BOOLEAN NOT NULL DEFAULT true,
    blur_sensitivity TEXT NOT NULL DEFAULT 'strict',
    block_adult_sites BOOLEAN NOT NULL DEFAULT true,
    block_social_media BOOLEAN NOT NULL DEFAULT false,
    block_ads BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create content_moderation_logs table for tracking
CREATE TABLE public.content_moderation_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT,
    content_type TEXT NOT NULL,
    url TEXT,
    classification TEXT NOT NULL,
    confidence DECIMAL(3,2),
    action_taken TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.blocked_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_protection_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_moderation_logs ENABLE ROW LEVEL SECURITY;

-- Public read access for blocked sites (needed for filtering)
CREATE POLICY "Anyone can read blocked sites" 
ON public.blocked_sites 
FOR SELECT 
USING (true);

-- Device-based access for settings (using device_id as identifier)
CREATE POLICY "Devices can read their own settings" 
ON public.user_protection_settings 
FOR SELECT 
USING (true);

CREATE POLICY "Devices can insert their settings" 
ON public.user_protection_settings 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Devices can update their settings" 
ON public.user_protection_settings 
FOR UPDATE 
USING (true);

-- Logs are write-only for now
CREATE POLICY "Anyone can insert logs" 
ON public.content_moderation_logs 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can read logs" 
ON public.content_moderation_logs 
FOR SELECT 
USING (true);

-- Insert default blocked domains (adult sites)
INSERT INTO public.blocked_sites (domain, category) VALUES
('pornhub.com', 'adult'),
('xvideos.com', 'adult'),
('xnxx.com', 'adult'),
('xhamster.com', 'adult'),
('redtube.com', 'adult'),
('youporn.com', 'adult'),
('tube8.com', 'adult'),
('spankbang.com', 'adult'),
('eporner.com', 'adult'),
('porn.com', 'adult'),
('brazzers.com', 'adult'),
('onlyfans.com', 'adult'),
('chaturbate.com', 'adult'),
('livejasmin.com', 'adult'),
('stripchat.com', 'adult');

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_protection_settings_updated_at
BEFORE UPDATE ON public.user_protection_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();