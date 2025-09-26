require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fix the Row-Level Security (RLS) policies for the tokens table
 */
async function fixRlsPolicies() {
    try {
        console.log('Checking Row-Level Security (RLS) policies for tokens table...');

        // Check if the tokens table exists
        const { error: checkError } = await supabase
            .from('tokens')
            .select('count')
            .limit(1);
            
        if (checkError && checkError.code !== '42501') {
            console.error('❌ Could not verify tokens table:', checkError);
            console.error('Please create the tokens table first using setup-tokens-table.js');
            return false;
        }

        // Generate SQL to fix RLS policies
        console.log(`
        To fix the Row-Level Security (RLS) policies for the tokens table, run the following SQL in your Supabase SQL editor:
        
        -- First, enable RLS on the table (if not already enabled)
        ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
        
        -- Drop any existing policies that might be causing issues
        DROP POLICY IF EXISTS "Allow authenticated users to select" ON public.tokens;
        DROP POLICY IF EXISTS "Allow anonymous users to select" ON public.tokens;
        DROP POLICY IF EXISTS "Allow service role to insert/update" ON public.tokens;
        DROP POLICY IF EXISTS "Allow all users to insert" ON public.tokens;
        
        -- Create policies for read access
        CREATE POLICY "Allow read access for all" 
        ON public.tokens 
        FOR SELECT 
        TO PUBLIC
        USING (true);
        
        -- Create policy for write access - allow any authenticated user to insert/update
        CREATE POLICY "Allow insert for all users" 
        ON public.tokens 
        FOR INSERT 
        TO PUBLIC
        WITH CHECK (true);
        
        -- Create policy for write access - allow update for authenticated users
        CREATE POLICY "Allow update for authenticated users" 
        ON public.tokens 
        FOR UPDATE 
        TO authenticated
        USING (true)
        WITH CHECK (true);
        `);
        
        console.log('\nAfter running the SQL, test the token insertion again.\n');
        return true;

    } catch (error) {
        console.error('❌ Error checking RLS policies:', error);
        return false;
    }
}

// Run the function
fixRlsPolicies()
    .then(result => {
        console.log('\nOperation completed. Please run the SQL commands in your Supabase SQL Editor.');
        process.exit(0);
    })
    .catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });