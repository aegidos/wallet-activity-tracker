require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Create the tokens table in Supabase if it doesn't exist
 */
async function createTokensTable() {
    try {
        console.log('Creating tokens table if it doesn\'t exist...');
        
        // Check if the table already exists by querying its schema
        const { error: checkError } = await supabase
            .from('tokens')
            .select('count')
            .limit(1);
            
        // If no error, table exists
        if (!checkError) {
            console.log('✅ Tokens table already exists');
            return true;
        }
        
        // Create the table via REST API (this is a workaround since supabase-js doesn't support table creation)
        // You'll need to run this using the Supabase SQL editor or use their REST API with admin privileges
        
        console.log(`
        To create the tokens table, run the following SQL in your Supabase SQL editor:
        
        CREATE TABLE IF NOT EXISTS public.tokens (
            id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
            contract_address TEXT NOT NULL,
            network TEXT NOT NULL,
            symbol TEXT,
            name TEXT,
            decimals INTEGER DEFAULT 18,
            price_usd DECIMAL(24, 12) DEFAULT 0,
            last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            dex TEXT,
            dex_network TEXT,
            liquidity_usd DECIMAL(24, 2),
            volume_24h DECIMAL(24, 2),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            
            -- Create a compound unique constraint for contract_address and network
            CONSTRAINT unique_token_per_network UNIQUE (contract_address, network)
        );
        
        -- Create indexes for better query performance
        CREATE INDEX IF NOT EXISTS idx_tokens_contract_address ON public.tokens (contract_address);
        CREATE INDEX IF NOT EXISTS idx_tokens_network ON public.tokens (network);
        CREATE INDEX IF NOT EXISTS idx_tokens_last_updated ON public.tokens (last_updated);
        
        -- Set up RLS (Row Level Security)
        ALTER TABLE public.tokens ENABLE ROW LEVEL SECURITY;
        
        -- Allow read access to authenticated users
        CREATE POLICY "Allow read access for authenticated users" 
        ON public.tokens 
        FOR SELECT 
        TO authenticated 
        USING (true);
        
        -- Allow read access to anonymous users (if desired)
        CREATE POLICY "Allow read access for anonymous users" 
        ON public.tokens 
        FOR SELECT 
        TO anon 
        USING (true);
        
        -- Allow insert/update access only to service role (GitHub Action)
        CREATE POLICY "Allow service role to insert/update" 
        ON public.tokens 
        FOR ALL 
        TO service_role 
        USING (true);
        `);
        
        return false;
    } catch (error) {
        console.error('Error creating tokens table:', error);
        return false;
    }
}

// Run the setup
createTokensTable()
    .then(() => {
        console.log('Database setup complete');
        process.exit(0);
    })
    .catch(error => {
        console.error('Error setting up database:', error);
        process.exit(1);
    });