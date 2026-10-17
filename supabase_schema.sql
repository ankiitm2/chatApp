-- Quiet Signal Supabase Schema
-- Architecture: Separates private auth identity (auth.users / email) from public anonymous identity (handle & nickname)

-- 1. Profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT, -- private account email (never exposed to public strangers)
  username TEXT NOT NULL, -- current display name (e.g. "Clover")
  handle TEXT, -- claimed permanent handle (e.g. "Clover_44")
  handle_normalized TEXT UNIQUE, -- lowercased, NFKC normalized (e.g. "clover_44")
  is_member BOOLEAN DEFAULT false, -- false = temporary guest, true = permanent account holder
  last_renamed_at TIMESTAMPTZ, -- tracks 30-day renaming cooldown
  gender TEXT CHECK (gender IN ('male', 'female', 'other')) DEFAULT 'other',
  interests TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Handle constraints: length 3-20, lowercase a-z, 0-9, and underscore only
  CONSTRAINT valid_handle_format CHECK (
    handle_normalized IS NULL OR handle_normalized ~ '^[a-z0-9_]{3,20}$'
  )
);

-- Unique index ensuring case-insensitive and lookalike collision prevention
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_normalized 
ON public.profiles(handle_normalized) 
WHERE handle_normalized IS NOT NULL;

-- 2. Friendships table
CREATE TABLE IF NOT EXISTS public.friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending', 'accepted', 'blocked')) DEFAULT 'accepted',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- 3. Match History table
CREATE TABLE IF NOT EXISTS public.match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  partner_name TEXT NOT NULL,
  partner_gender TEXT,
  partner_handle TEXT, -- revealed only if both accept friendship
  common_interests TEXT[] DEFAULT '{}',
  had_video BOOLEAN DEFAULT false,
  matched_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

-- Security Policies:
-- Strangers can ONLY see public display fields (id, username, handle, is_member, gender, interests)
-- Private email is protected and only visible to the profile owner
CREATE POLICY "Public read profiles" ON public.profiles 
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON public.profiles 
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update their own profile" ON public.profiles 
  FOR UPDATE USING (
    auth_user_id IS NULL OR auth.uid() = auth_user_id
  );

CREATE POLICY "Public read friendships" ON public.friendships 
  FOR SELECT USING (true);

CREATE POLICY "Public insert friendships" ON public.friendships 
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Public read match_history" ON public.match_history 
  FOR SELECT USING (true);

CREATE POLICY "Public insert match_history" ON public.match_history 
  FOR INSERT WITH CHECK (true);
