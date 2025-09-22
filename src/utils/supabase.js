import { createClient } from '@supabase/supabase-js';

// Use React environment variables (they should be REACT_APP_ prefixed)


const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Debug environment variables loading
console.log('🔧 Supabase Environment Check:', {
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL_EXISTS: !!supabaseUrl,
    SUPABASE_KEY_EXISTS: !!supabaseAnonKey,
    SUPABASE_URL_VALUE: supabaseUrl ? `${supabaseUrl.slice(0, 30)}...` : 'MISSING'
});

// Validate environment variables
if (!supabaseUrl) {
    console.error('❌ REACT_APP_SUPABASE_URL is missing from environment variables');
    console.error('Available env vars:', Object.keys(process.env).filter(key => key.startsWith('REACT_APP_')));
}

if (!supabaseAnonKey) {
    console.error('❌ REACT_APP_SUPABASE_ANON_KEY is missing from environment variables');
}

// Create Supabase client only if we have the required variables
let supabase = null;

if (supabaseUrl && supabaseAnonKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
        console.log('✅ Supabase client initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize Supabase client:', error);
    }
} else {
    console.warn('⚠️ Supabase client not initialized due to missing environment variables');
}

export { supabase };

// Function to insert portfolio data
// Expected Supabase table: portfolio_snapshots
// Columns: wallet_address (text), total_value_usd (numeric), token_balance_usd (numeric), 
//          native_balance_usd (numeric), nft_value_usd (numeric), staked_ape_usd (numeric),
//          profit_loss_ape (numeric), staking_rewards_ape (numeric), church_rewards_ape (numeric),
//          raffle_rewards_ape (numeric), snapshot_timestamp (timestamptz), created_at (timestamptz)
export const insertPortfolioSnapshot = async (walletAddress, portfolioData) => {
    if (!supabase) {
        console.warn('⚠️ Supabase not initialized - skipping portfolio data insert');
        return { success: false, error: 'Supabase client not available' };
    }

    try {
        const insertData = {
            wallet_address: walletAddress,
            total_value_usd: Math.round(portfolioData.totalValue || 0),
            token_balance_usd: Math.round(portfolioData.tokenBalance || 0),
            native_balance_usd: Math.round(portfolioData.nativeBalance || 0),
            nft_value_usd: Math.round(portfolioData.nftValue || 0),
            staked_ape_usd: Math.round(portfolioData.stakedValue || 0),
            profit_loss_ape: Math.round(portfolioData.profitLoss || 0),
            staking_rewards_ape: Math.round(portfolioData.stakingRewards || 0),
            church_rewards_ape: Math.round(portfolioData.churchRewards || 0),
            raffle_rewards_ape: Math.round(portfolioData.raffleRewards || 0),
            snapshot_timestamp: new Date().toISOString()
        };

        console.log('📊 Inserting portfolio snapshot:', { 
            wallet: `${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`,
            totalValue: insertData.total_value_usd 
        });

        const { data, error } = await supabase
            .from('portfolio_snapshots')
            .insert([insertData]);

        if (error) {
            console.error('❌ Supabase insert error:', error);
            return { success: false, error };
        }

        console.log('✅ Portfolio snapshot saved successfully');
        return { success: true, data };

    } catch (err) {
        console.error('❌ Unexpected error inserting portfolio data:', err);
        return { success: false, error: err };
    }
};

// Function to insert NFT collection contract addresses
// Expected Supabase table: nft_collections
// Columns: collection_name (text), contract_address (text), 
//          first_seen_timestamp (timestamptz), created_at (timestamptz)
// Unique constraint on: (contract_address)
export const insertNftCollections = async (nftPortfolio) => {
    if (!supabase) {
        console.warn('⚠️ Supabase not initialized - skipping NFT collections insert');
        return { success: false, error: 'Supabase client not available' };
    }

    if (!nftPortfolio || nftPortfolio.length === 0) {
        console.log('📝 No NFT collections to insert');
        return { success: true, data: [] };
    }

    try {
        // Extract unique collections from NFT portfolio
        // NFT objects have structure: { contract: { address, name }, ... }
        const uniqueCollections = new Map();
        
        console.log(`📝 Processing ${nftPortfolio.length} NFTs for collection extraction...`);
        
        nftPortfolio.forEach((nft, index) => {
            // Debug first few NFTs to understand structure
            if (index < 3) {
                console.log(`🔍 NFT ${index + 1} structure:`, {
                    hasContract: !!nft.contract,
                    contractAddress: nft.contract?.address,
                    contractName: nft.contract?.name,
                    title: nft.title,
                    collection: nft.collection
                });
            }
            
            const contractAddress = nft.contract?.address?.toLowerCase();
            if (contractAddress && !uniqueCollections.has(contractAddress)) {
                // Try multiple possible sources for collection name
                const collectionName = nft.contract?.name || 
                                     nft.collection?.name || 
                                     nft.collection || 
                                     nft.title || 
                                     'Unknown Collection';
                
                // Extract network information from NFT object
                const network = nft.network || nft.networkDisplayName?.toLowerCase() || 'ethereum';
                
                uniqueCollections.set(contractAddress, {
                    collection_name: collectionName,
                    contract_address: contractAddress,
                    network: network,
                    first_seen_timestamp: new Date().toISOString()
                });
                
                console.log(`📋 Found collection: ${collectionName} on ${network} (${contractAddress.slice(0, 8)}...)`);
            }
        });

        const insertData = Array.from(uniqueCollections.values());
        
        if (insertData.length === 0) {
            console.log('📝 No valid NFT collections to insert');
            return { success: true, data: [] };
        }

        console.log(`📝 Attempting to insert ${insertData.length} unique NFT collections:`);
        insertData.forEach(collection => {
            console.log(`  - ${collection.collection_name} (${collection.contract_address.slice(0, 8)}...)`);
        });

        // Use upsert to handle conflicts (insert only if not exists)
        const { data, error } = await supabase
            .from('nft_collections')
            .upsert(insertData, { 
                onConflict: 'contract_address',
                ignoreDuplicates: true 
            })
            .select();

        if (error) {
            console.error('❌ Supabase NFT collections insert error:', error);
            return { success: false, error };
        }

        const insertedCount = data?.length || 0;
        console.log(`✅ NFT collections processed: ${insertedCount} new records inserted/updated`);
        
        return { success: true, data, insertedCount };

    } catch (err) {
        console.error('❌ Unexpected error inserting NFT collections:', err);
        return { success: false, error: err };
    }
};