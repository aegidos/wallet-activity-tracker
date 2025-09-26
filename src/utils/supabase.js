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

/**
 * Fetch cached floor prices from Supabase nft_collections table
 * @param {Array} contractAddresses - Array of contract addresses to look up
 * @returns {Object} Map of contract addresses to floor price data
 */
export const getCachedFloorPrices = async (contractAddresses) => {
    if (!supabase) {
        console.warn('⚠️ Supabase not initialized - cannot fetch cached floor prices');
        return {};
    }

    if (!contractAddresses || contractAddresses.length === 0) {
        console.warn('⚠️ No contract addresses provided for floor price lookup');
        return {};
    }

    try {
        console.log(`📊 Fetching cached floor prices from Supabase for ${contractAddresses.length} collections...`);
        
        // Convert all addresses to lowercase for consistent matching
        const normalizedAddresses = contractAddresses.map(addr => addr.toLowerCase());
        
        const { data, error } = await supabase
            .from('nft_collections')
            .select(`
                contract_address,
                collection_name,
                floor_price_eth,
                floor_price_usd,
                floor_price_currency,
                magic_eden_slug,
                network,
                last_floor_price_update
            `)
            .in('contract_address', normalizedAddresses)
            .not('floor_price_eth', 'is', null)  // Only get collections that have floor prices
            .not('floor_price_usd', 'is', null);

        if (error) {
            console.error('❌ Error fetching cached floor prices:', error);
            return {};
        }

        // Convert to the same format as the Magic Eden API response
        const floorPricesMap = {};
        let cachedCount = 0;
        
        data.forEach(collection => {
            const contractAddress = collection.contract_address.toLowerCase();
            
            floorPricesMap[contractAddress] = {
                floorPrice: collection.floor_price_eth || collection.floor_price_usd, // Prefer ETH, fallback to USD
                currency: collection.floor_price_currency || 'ETH',
                collectionName: collection.collection_name,
                collectionSlug: collection.magic_eden_slug,
                priceUSD: collection.floor_price_usd,
                network: collection.network || 'ethereum',
                lastUpdated: collection.last_floor_price_update,
                cached: true // Flag to indicate this came from cache
            };
            
            cachedCount++;
            
            console.log(`✅ Cached floor price: ${collection.collection_name} = ${collection.floor_price_eth || collection.floor_price_usd} ${collection.floor_price_currency || 'ETH'} ($${collection.floor_price_usd?.toFixed(2) || 'N/A'})`);
        });

        const missedCount = contractAddresses.length - cachedCount;
        
        console.log(`💾 Cache lookup summary:`);
        console.log(`   ✅ Found in cache: ${cachedCount}/${contractAddresses.length} collections`);
        if (missedCount > 0) {
            console.log(`   ❌ Cache misses: ${missedCount} collections (will use Magic Eden API)`);
        }
        
        return floorPricesMap;

    } catch (err) {
        console.error('❌ Unexpected error fetching cached floor prices:', err);
        return {};
    }
};

// Watchlist functionality
// Expected Supabase table: watched_wallets
// Columns: id (uuid, primary key), user_wallet (text), watched_address (text), 
//          label (text, optional), created_at (timestamptz), updated_at (timestamptz)

export const saveWatchedWallets = async (userWallet, watchedWallets) => {
    if (!supabase) {
        console.error('❌ Supabase client not initialized - cannot save watched wallets');
        return { success: false, error: 'Database not available' };
    }

    try {
        console.log('💾 Saving watched wallets:', { userWallet, count: watchedWallets.length });

        // First, delete existing watched wallets for this user
        const { error: deleteError } = await supabase
            .from('watched_wallets')
            .delete()
            .eq('user_wallet', userWallet);

        if (deleteError) {
            console.error('❌ Error deleting existing watched wallets:', deleteError);
            return { success: false, error: deleteError.message };
        }

        // Insert new watched wallets - handle both old format (strings) and new format (objects)
        const watchlistData = watchedWallets.map(wallet => {
            // Support both old format (string addresses) and new format (objects with address/label)
            if (typeof wallet === 'string') {
                return {
                    user_wallet: userWallet,
                    watched_address: wallet.toLowerCase(),
                    label: null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
            } else {
                return {
                    user_wallet: userWallet,
                    watched_address: wallet.address.toLowerCase(),
                    label: wallet.label || null,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
            }
        });

        const { data, error } = await supabase
            .from('watched_wallets')
            .insert(watchlistData)
            .select();

        if (error) {
            console.error('❌ Error saving watched wallets:', error);
            return { success: false, error: error.message };
        }

        console.log(`✅ Successfully saved ${data.length} watched wallets`);
        return { success: true, data };

    } catch (err) {
        console.error('❌ Unexpected error saving watched wallets:', err);
        return { success: false, error: err.message };
    }
};

export const getWatchedWallets = async (userWallet) => {
    if (!supabase) {
        console.error('❌ Supabase client not initialized - cannot get watched wallets');
        return { success: false, error: 'Database not available' };
    }

    try {
        console.log('📖 Loading watched wallets for user:', userWallet);

        const { data, error } = await supabase
            .from('watched_wallets')
            .select('*')
            .eq('user_wallet', userWallet)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('❌ Error loading watched wallets:', error);
            return { success: false, error: error.message };
        }

        console.log(`✅ Successfully loaded ${data.length} watched wallets`);
        return { success: true, data };

    } catch (err) {
        console.error('❌ Unexpected error loading watched wallets:', err);
        return { success: false, error: err.message };
    }
};

export const deleteWatchedWallet = async (userWallet) => {
    if (!supabase) {
        console.error('❌ Supabase client not initialized - cannot delete watched wallet');
        return { success: false, error: 'Database not available' };
    }

    try {
        console.log('🗑️ Deleting all watched wallets for user:', { userWallet });

        const { error } = await supabase
            .from('watched_wallets')
            .delete()
            .eq('user_wallet', userWallet.toLowerCase());

        if (error) {
            console.error('❌ Error deleting watched wallets:', error);
            return { success: false, error: error.message };
        }

        console.log('✅ Successfully deleted all watched wallets for user');
        return { success: true };

    } catch (err) {
        console.error('❌ Unexpected error deleting watched wallets:', err);
        return { success: false, error: err.message };
    }
};

/**
 * Insert tokens from multiple chains into the tokens table
 * @param {Object} tokenPortfolio - Object containing token arrays by network
 * @param {Array} tokenPortfolio.ethereum - Ethereum tokens
 * @param {Array} tokenPortfolio.apechain - ApeChain tokens
 * @param {Array} tokenPortfolio.bnb - BNB Chain tokens
 * @param {Array} tokenPortfolio.solana - Solana tokens
 * @returns {Promise<Object>} Result of the operation
 */
export const insertTokensPerChain = async (tokens, network, userId = null) => {
    try {
        if (!Array.isArray(tokens) || tokens.length === 0) {
            return { success: false, error: "No tokens provided" };
        }

        const formattedTokens = tokens.map(token => {
            // For different network formats, the token data might be structured differently
            const contractAddress = token.contractAddress || token.address || (token.token && (token.token.contractAddress || token.token.address));
            const symbol = token.symbol || (token.token && token.token.symbol) || 'UNKNOWN';
            const name = token.name || (token.token && token.token.name) || 'Unknown';
            const decimalsValue = token.decimals || (token.token && token.token.decimals) || 18;

            return {
                name: name,
                symbol: symbol,
                contract_address: contractAddress,
                network,
                // Add decimals if available, otherwise default to 18
                decimals: decimalsValue,
                // Add user_id if provided
                user_id: userId,
                updated_at: new Date().toISOString()
            };
        });

        // Filter out tokens without contract addresses
        const insertData = formattedTokens.filter(token => 
            token.contract_address && token.contract_address !== '0x0000000000000000000000000000000000000000'
        );

        if (insertData.length === 0) {
            return { success: false, error: "No valid tokens to insert" };
        }

        console.log(`� Inserting ${insertData.length} tokens for network: ${network}`);

        if (!supabase) {
            return { success: false, error: "Supabase client not initialized" };
        }

        try {
            // Use upsert to handle conflicts (insert only if not exists)
            const { data, error } = await supabase
                .from('tokens')
                .upsert(insertData, { 
                    onConflict: 'contract_address,network',
                    ignoreDuplicates: true 
                })
                .select();

            if (error) {
                // Check if it's an RLS policy violation
                if (error.code === '42501') {
                    console.error('❌ Row-Level Security policy violation on tokens table:', error.message);
                    console.error(`
                    This is a Row-Level Security (RLS) policy error. You need to update the RLS policies 
                    for the tokens table in your Supabase dashboard. Run the script:
                    
                    node scripts/fix-rls-policies.js
                    
                    Then follow the instructions to update your RLS policies.
                    `);
                    return { 
                        success: false, 
                        error: {
                            ...error,
                            hint: 'Run node scripts/fix-rls-policies.js to fix RLS policies'
                        }
                    };
                } else if (error.message && error.message.includes('violates not-null constraint')) {
                    // Check for missing columns issues
                    console.error('❌ Database schema error:', error.message);
                    console.error(`
                    This error indicates a missing or misconfigured column in your tokens table.
                    Run the script to fix the database schema:
                    
                    node scripts/fix-rls-policies.js
                    
                    Then follow the instructions to update your tokens table schema.
                    `);
                    return {
                        success: false,
                        error: {
                            ...error,
                            hint: 'Run node scripts/fix-rls-policies.js to fix database schema'
                        }
                    };
                } else {
                    console.error('❌ Supabase tokens insert error:', error);
                    return { success: false, error };
                }
            }

            return { 
                success: true, 
                data,
                insertedCount: data?.length || 0,
                network 
            };
        } catch (error) {
            console.error('❌ Unexpected error inserting tokens:', error);
            return { success: false, error };
        }
    } catch (error) {
        console.error('❌ Error in insertTokensPerChain:', error);
        return { success: false, error };
    }
};