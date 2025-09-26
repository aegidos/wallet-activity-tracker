/**
 * Check the status of the tokens table and display summary statistics
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

/**
 * Check if the tokens table exists and its structure
 */
async function checkTableStructure() {
  try {
    // First, check if the table exists
    const { data: tableExists, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('*')
      .eq('table_name', 'tokens')
      .eq('table_schema', 'public');
      
    if (tableError) {
      console.error('❌ Error checking if table exists:', tableError);
      return false;
    }
    
    if (!tableExists || tableExists.length === 0) {
      console.error('❌ The tokens table does not exist!');
      return false;
    }
    
    console.log('✅ The tokens table exists');
    
    // Check the columns in the table
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type')
      .eq('table_name', 'tokens')
      .eq('table_schema', 'public');
      
    if (columnsError) {
      console.error('❌ Error checking table columns:', columnsError);
      return false;
    }
    
    console.log('\n📊 Table Structure:');
    console.table(columns);
    
    return true;
  } catch (error) {
    console.error('❌ Error checking table structure:', error);
    return false;
  }
}

/**
 * Get token counts by network
 */
async function getTokenCounts() {
  try {
    const { data, error } = await supabase
      .from('tokens')
      .select('network');
      
    if (error) {
      console.error('❌ Error getting token counts:', error);
      return;
    }
    
    // Count tokens by network
    const networkCounts = {};
    data.forEach(token => {
      const network = token.network || 'unknown';
      networkCounts[network] = (networkCounts[network] || 0) + 1;
    });
    
    console.log('\n📊 Token Counts by Network:');
    console.table(Object.entries(networkCounts).map(([network, count]) => ({
      Network: network,
      Count: count
    })));
    
    console.log(`\n✅ Total tokens: ${data.length}`);
    
    return data.length;
  } catch (error) {
    console.error('❌ Error getting token counts:', error);
  }
}

/**
 * Get tokens with prices
 */
async function getTokensWithPrices() {
  try {
    const { data, error } = await supabase
      .from('tokens')
      .select('*')
      .not('current_price', 'is', null);
      
    if (error) {
      console.error('❌ Error getting tokens with prices:', error);
      return;
    }
    
    console.log(`\n💰 Tokens with prices: ${data.length}`);
    
    if (data.length > 0) {
      // Get the most recent price update
      const mostRecentUpdate = data.reduce((latest, token) => {
        const tokenDate = token.price_updated_at ? new Date(token.price_updated_at) : null;
        if (!tokenDate) return latest;
        return !latest || tokenDate > latest ? tokenDate : latest;
      }, null);
      
      if (mostRecentUpdate) {
        console.log(`\n🕒 Most recent price update: ${mostRecentUpdate.toISOString()}`);
      }
      
      // Show a sample of tokens with prices (first 5)
      console.log('\n📝 Sample tokens with prices:');
      console.table(data.slice(0, 5).map(token => ({
        Symbol: token.symbol,
        Name: token.name,
        Network: token.network,
        Price: `$${token.current_price}`,
        Updated: token.price_updated_at
      })));
    }
  } catch (error) {
    console.error('❌ Error getting tokens with prices:', error);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🔍 Checking token database status...\n');
  
  const tableExists = await checkTableStructure();
  
  if (tableExists) {
    await getTokenCounts();
    await getTokensWithPrices();
  } else {
    console.log('\n❌ Please create the tokens table first:');
    console.log('node scripts/create-tokens-table.js');
  }
}

// Run the script
main().catch(error => {
  console.error('Unhandled error:', error);
}).finally(() => {
  process.exit(0);
});