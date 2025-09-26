/**
 * Test script to verify token insertion and RLS policies
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

async function testTokenInsertion() {
  console.log('🧪 Testing token insertion with public RLS policy...');
  
  // Create test token data
  const testToken = {
    name: 'Test Token',
    symbol: 'TEST',
    contract_address: `0xTEST${Date.now()}`,  // Generate unique address for testing
    network: 'ethereum',
    // Remove the logo field if it's causing issues
    decimals: 18,
    updated_at: new Date().toISOString()
  };
  
  console.log('📝 Inserting test token:', testToken);
  
  try {
    const { data, error } = await supabase
      .from('tokens')
      .upsert([testToken], { 
        onConflict: 'contract_address,network',
        ignoreDuplicates: true 
      })
      .select();
      
    if (error) {
      console.error('❌ Test failed with error:', error);
      
      // Check for different error types
      if (error.code === '42501') {
        console.error(`
        This is a Row-Level Security policy error. You need to update the RLS policies.
        Please run:
        
        node scripts/fix-rls-policies.js
        
        Then follow the instructions to update your RLS policies in the Supabase dashboard.
        `);
      } else if (error.code === 'PGRST204') {
        console.error(`
        Schema issue detected: The table structure doesn't match what's expected.
        Please run:
        
        node scripts/create-tokens-table.js
        
        Then follow the instructions to create the proper table structure.
        `);
      }
      return false;
    }
    
    console.log('✅ Test successful!', data);
    return true;
  } catch (error) {
    console.error('❌ Unexpected error during test:', error);
    return false;
  }
}

// Main function
/**
 * Check if the tokens table exists
 */
async function checkTableExists() {
  try {
    // Try to get the structure of the tokens table
    const { data, error } = await supabase
      .from('tokens')
      .select('id')
      .limit(1);
      
    if (error) {
      console.error('❌ Error checking tokens table:', error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error checking if table exists:', error);
    return false;
  }
}

async function main() {
  console.log('🔍 Checking if tokens table exists...');
  const tableExists = await checkTableExists();
  
  if (!tableExists) {
    console.error('❌ The tokens table does not exist or is not accessible!');
    console.log('Please run: node scripts/create-tokens-table.js');
    return;
  }
  
  console.log('✅ Tokens table found. Proceeding with insertion test...');
  const success = await testTokenInsertion();
  
  if (success) {
    console.log('🎉 Token insertion test passed! RLS policies are working correctly.');
  } else {
    console.error('❌ Token insertion test failed! RLS policies need to be fixed.');
    console.log('Please run the fix-rls-policies.js script and follow the instructions.');
  }
}

// Run the test
main()
  .catch(error => {
    console.error('Unhandled error:', error);
  })
  .finally(() => {
    process.exit(0);
  });