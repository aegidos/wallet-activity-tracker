/**
 * Script to update Supabase RLS policies for GitHub Actions
 * This needs to be run once to enable the GitHub Actions workflow to update token prices
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

// Create Supabase client with service role key (if available)
// Note: For security reasons, only use service_role key for admin scripts, never in browser code
// The service_role key has bypass RLS privileges
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isServiceRole = !!serviceRoleKey;

const supabase = createClient(
  supabaseUrl, 
  isServiceRole ? serviceRoleKey : supabaseKey,
  isServiceRole ? { auth: { persistSession: false } } : {}
);

console.log(`
============================================================
  SUPABASE RLS POLICY UPDATE FOR TOKEN PRICE TRACKING
============================================================

This script will guide you through the process of setting up
Row Level Security (RLS) policies for the tokens table to 
enable price updates via GitHub Actions.

Since GitHub Actions run with anonymous privileges, we need
to ensure the RLS policies allow:
1. Anonymous SELECT on tokens table
2. Anonymous INSERT/UPDATE on tokens table for price updates

`);

console.log(`To fix this issue, you need to run the following SQL in your Supabase SQL Editor:

-- First, make sure the tokens table has RLS enabled
ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;

-- Remove any existing policies that might be conflicting
DROP POLICY IF EXISTS "Allow public access to tokens" ON public.tokens;
DROP POLICY IF EXISTS "Allow authenticated users to update" ON public.tokens;

-- Create policies to allow public (anonymous) access for token tracking
CREATE POLICY "Allow public read access to tokens"
ON public.tokens
FOR SELECT
USING (true);

CREATE POLICY "Allow public insert to tokens"
ON public.tokens
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow public update to tokens"
ON public.tokens
FOR UPDATE
USING (true)
WITH CHECK (true);

-- If you also want to restrict authenticated users to only their data
-- while still allowing the above public policies:
CREATE POLICY "Allow authenticated users to manage their tokens"
ON public.tokens
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Grant permissions to public roles
GRANT SELECT, INSERT, UPDATE ON public.tokens TO anon;
GRANT SELECT, INSERT, UPDATE ON public.tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tokens TO service_role;
`);

console.log(`
After running this SQL, your GitHub Action should be able to insert and update
token data in the database.

Note: This configuration allows anonymous access to the tokens table, which is 
necessary for GitHub Actions to work without authentication. This is safe for
a token price tracking system since it doesn't contain sensitive data, but
consider more restrictive policies for tables with private information.
`);

console.log(`
You can access your Supabase SQL Editor at:
${supabaseUrl}/project/sql

Run these commands there to update your RLS policies.
`);