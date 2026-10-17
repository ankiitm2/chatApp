-- Quiet Signal Supabase Schema (Safe Migration & Setup)
-- Architecture: Separates private auth identity from public anonymous identity

-- 1. Ensure Profiles table exists
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')) DEFAULT 'other',
  interests TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Safely add newly introduced columns if the table already existed
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS handle TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS handle_normalized TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_renamed_at TIMESTAMPTZ;

-- Unique index ensuring case-insensitive and lookalike collision prevention
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_normalized 
ON public.profiles(handle_normalized) 
WHERE handle_normalized IS NOT NULL;

-- 2. Ensure Friendships table exists
CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'accepted', 'blocked')) DEFAULT 'accepted',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- 3. Ensure Match History table exists
CREATE TABLE IF NOT EXISTS public.match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  partner_name TEXT NOT NULL,
  partner_gender TEXT,
  partner_handle TEXT,
  common_interests TEXT[] DEFAULT '{}',
  had_video BOOLEAN DEFAULT false,
  matched_at TIMESTAMPTZ DEFAULT now()
);

-- Safely add partner_handle if match_history already existed
ALTER TABLE public.match_history ADD COLUMN IF NOT EXISTS partner_handle TEXT;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

-- 5. Safe Policy Creation (Drop first if exists to prevent duplicate policy errors)
DROP POLICY IF EXISTS "Public read profiles" ON public.profiles;
CREATE POLICY "Public read profiles" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public insert profiles" ON public.profiles;
CREATE POLICY "Public insert profiles" ON public.profiles FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Public update profiles" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Public read friendships" ON public.friendships;
CREATE POLICY "Public read friendships" ON public.friendships FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public insert friendships" ON public.friendships;
CREATE POLICY "Public insert friendships" ON public.friendships FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public read match_history" ON public.match_history;
CREATE POLICY "Public read match_history" ON public.match_history FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public insert match_history" ON public.match_history;
CREATE POLICY "Public insert match_history" ON public.match_history FOR INSERT WITH CHECK (true);

-- 6. Direct Messages Table (Persistent Chat-wise Storage for Logged-In Members & Friends)
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_key TEXT NOT NULL,
  sender_handle TEXT NOT NULL,
  receiver_handle TEXT NOT NULL,
  sender_id TEXT,
  receiver_id TEXT,
  message_type TEXT CHECK (message_type IN ('text', 'image', 'audio')) DEFAULT 'text',
  text TEXT,
  media_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for rapid conversation retrieval
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_key 
ON public.direct_messages(conversation_key, created_at ASC);

-- Direct Messages RLS
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read direct_messages" ON public.direct_messages;
CREATE POLICY "Public read direct_messages" ON public.direct_messages FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public insert direct_messages" ON public.direct_messages;
CREATE POLICY "Public insert direct_messages" ON public.direct_messages FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Public update direct_messages" ON public.direct_messages;
CREATE POLICY "Public update direct_messages" ON public.direct_messages FOR UPDATE USING (true);

-- Add status column (sent, delivered, read) and support sticker type
ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
ALTER TABLE public.direct_messages DROP CONSTRAINT IF EXISTS direct_messages_message_type_check;
ALTER TABLE public.direct_messages ADD CONSTRAINT direct_messages_message_type_check CHECK (message_type IN ('text', 'image', 'audio', 'sticker'));

-- Enable Supabase Realtime for instant messaging updates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'direct_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;
  END IF;
END $$;


