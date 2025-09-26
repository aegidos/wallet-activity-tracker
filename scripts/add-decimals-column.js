require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Add the decimals column to the tokens table
 */
async function addDecimalsColumn() {
    try {
        console.log('Checking if decimals column needs to be added to tokens table...');

        // First check if the tokens table exists
        console.log('1. Verifying tokens table exists...');
        const { error: checkError } = await supabase
            .from('tokens')
            .select('count')
            .limit(1);
            
        if (checkError && checkError.code !== 'PGRST204') {
            console.error('❌ Could not verify tokens table:', checkError);
            console.error('Please create the tokens table first using setup-tokens-table.js');
            return false;
        }

        if (checkError && checkError.code === 'PGRST204') {
            console.error('❌ Tokens table doesn\'t exist yet');
            console.error('Please create the tokens table first using setup-tokens-table.js');
            return false;
        }

        console.log('✅ Tokens table exists');

        // Now check if the decimals column exists
        console.log('2. Checking if decimals column already exists...');
        const { error: columnCheckError } = await supabase
            .from('tokens')
            .select('decimals')
            .limit(1);

        if (!columnCheckError) {
            console.log('✅ Decimals column already exists in tokens table');
            return true;
        }

        if (columnCheckError && columnCheckError.code === 'PGRST204') {
            console.log('❌ Decimals column missing, need to add it');
            
            console.log(`
            To add the decimals column to the tokens table, run the following SQL in your Supabase SQL editor:
            
            ALTER TABLE public.tokens 
            ADD COLUMN IF NOT EXISTS decimals INTEGER DEFAULT 18;
            `);
            
            return false;
        }

        console.error('❓ Unexpected error checking for decimals column:', columnCheckError);
        return false;
    } catch (error) {
        console.error('❌ Error checking or adding decimals column:', error);
        return false;
    }
}

// Run the function
addDecimalsColumn()
    .then(result => {
        if (result) {
            console.log('Operation completed successfully');
        } else {
            console.log('Operation completed with issues, see output above');
        }
        process.exit(0);
    })
    .catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });