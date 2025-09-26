/**
 * Create tokens table with proper schema
 * This script creates the tokens table with all required columns
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase environment variables!');
  console.error('Please set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔧 Creating tokens table with proper schema...');
console.log(`
Please run the following SQL in your Supabase SQL Editor at ${supabaseUrl}/project/sql:

-- Drop the existing tokens table if it exists
DROP TABLE IF EXISTS public.tokens;

-- Create the tokens table with the correct schema
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  network TEXT NOT NULL,
  logo TEXT,  -- This is the logo URL field
  decimals INTEGER DEFAULT 18,
  user_id UUID REFERENCES auth.users(id),
  current_price DECIMAL,
  price_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_address, network)
);

-- Enable Row Level Security
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;

-- Create public access policies
CREATE POLICY "Allow read access for all" 
ON public.tokens 
FOR SELECT 
TO PUBLIC
USING (true);

CREATE POLICY "Allow insert for all users" 
ON public.tokens 
FOR INSERT 
TO PUBLIC
WITH CHECK (true);

-- Create policies for authenticated users
CREATE POLICY "Allow authenticated users to update tokens" 
ON public.tokens 
FOR UPDATE 
TO authenticated
USING (true)
WITH CHECK (true);

-- Grant permissions
GRANT ALL ON public.tokens TO authenticated;
GRANT SELECT, INSERT ON public.tokens TO anon;
`);

console.log('\nAfter running the SQL, try the test script again.');