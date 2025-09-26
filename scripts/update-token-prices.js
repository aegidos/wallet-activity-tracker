require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Set up logging to both console and file
const logFile = 'token-update.log';
// Clear previous log file
fs.writeFileSync(logFile, '');

// Custom logger
const logger = {
  info: (message) => {
    const logMessage = `[INFO] ${new Date().toISOString()} - ${message}`;
    console.log(logMessage);
    fs.appendFileSync(logFile, logMessage + '\n');
  },
  warn: (message) => {
    const logMessage = `[WARN] ${new Date().toISOString()} - ${message}`;
    console.warn(logMessage);
    fs.appendFileSync(logFile, logMessage + '\n');
  },
  error: (message, error) => {
    const logMessage = `[ERROR] ${new Date().toISOString()} - ${message}`;
    console.error(logMessage);
    if (error) {
      const errorDetails = error.stack || error.message || String(error);
      console.error(errorDetails);
      fs.appendFileSync(logFile, logMessage + '\n' + errorDetails + '\n');
    } else {
      fs.appendFileSync(logFile, logMessage + '\n');
    }
  }
};

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Rate limiting to avoid API throttling
const RATE_LIMIT_DELAY = 500; // 500ms between requests
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetch all unique tokens from wallets in Supabase
 */
async function getTokensFromDatabase() {
    try {
        logger.info('📊 Fetching all unique tokens from database...');
        
        // Get distinct tokens from portfolio snapshots
        const { data: walletTokens, error: walletError } = await supabase
            .from('portfolio_snapshots')
            .select('tokens')
            .not('tokens', 'is', null);
        
        if (walletError) {
            throw new Error(`Error fetching tokens from portfolio snapshots: ${walletError.message}`);
        }
        
        // Extract unique tokens across all wallets and networks
        const uniqueTokens = {};
        
        walletTokens.forEach(snapshot => {
            if (!snapshot.tokens) return;
            
            // Process each token in the snapshot
            snapshot.tokens.forEach(token => {
                if (!token.contractAddress) return;
                
                const tokenKey = `${token.contractAddress.toLowerCase()}-${token.networkName?.toLowerCase() || 'unknown'}`;
                
                if (!uniqueTokens[tokenKey]) {
                    uniqueTokens[tokenKey] = {
                        contractAddress: token.contractAddress.toLowerCase(),
                        networkName: token.networkName || 'unknown',
                        symbol: token.symbol || 'unknown',
                        name: token.name || 'unknown',
                        lastUpdated: null,
                        priceUSD: token.priceUSD || 0
                    };
                }
            });
        });
        
        logger.info(`✅ Found ${Object.keys(uniqueTokens).length} unique tokens across all wallets`);
        return Object.values(uniqueTokens);
    } catch (error) {
        logger.error('❌ Error fetching tokens:', error);
        return [];
    }
}

/**
 * Ensure all tokens exist in the tokens table
 */
async function syncTokensToDatabase(tokens) {
    try {
        console.log('📝 Syncing tokens to database...');
        let count = 0;
        
        // Process tokens in batches to avoid overloading the database
        const BATCH_SIZE = 50;
        for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
            const batch = tokens.slice(i, i + BATCH_SIZE);
            
            // Use upsert to add or update tokens
            const { error } = await supabase
                .from('tokens')
                .upsert(
                    batch.map(token => ({
                        contract_address: token.contractAddress,
                        network: token.networkName,
                        symbol: token.symbol,
                        name: token.name,
                        last_updated: new Date().toISOString(),
                        price_usd: token.priceUSD || 0
                    })),
                    { onConflict: 'contract_address,network' }
                );
                
            if (error) {
                console.error(`❌ Error upserting tokens batch: ${error.message}`);
                continue;
            }
            
            count += batch.length;
            console.log(`✅ Synced ${count}/${tokens.length} tokens to database`);
            
            // Rate limiting
            await delay(100);
        }
        
        return count;
    } catch (error) {
        console.error('❌ Error syncing tokens to database:', error);
        return 0;
    }
}

/**
 * Get token price from DEXScreener API
 * @param {string} tokenAddress - Contract address of the token
 * @param {string} network - Network name (ethereum, bnb, etc.)
 */
async function getTokenPriceFromDEXScreener(tokenAddress, network) {
    try {
        console.log(`🔎 Fetching price for ${tokenAddress} on ${network}...`);
        
        // Map network names to what DEXScreener might expect
        const networkMapping = {
            'ethereum': 'ethereum',
            'apechain': 'ethereum', // Assuming apechain is EVM compatible
            'bnb': 'bsc',           // Binance Smart Chain
            'solana': 'solana',
            'polygon': 'polygon',
            'avalanche': 'avalanche',
            'arbitrum': 'arbitrum',
            'optimism': 'optimism',
            'fantom': 'fantom'
        };
        
        // DEXScreener API
        const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
        const response = await axios.get(url, { timeout: 10000 });
        
        if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
            console.warn(`⚠️ No price data found for ${tokenAddress}`);
            return null;
        }
        
        // Find the most relevant pair based on network and liquidity
        let bestPair = null;
        let highestLiquidity = 0;
        
        // Try to find pairs matching our network first
        const networkCode = networkMapping[network.toLowerCase()] || network.toLowerCase();
        
        for (const pair of response.data.pairs) {
            // Check if this pair is on the correct network
            const pairChainId = pair.chainId?.toLowerCase();
            const isMatchingNetwork = 
                pairChainId === networkCode ||
                (network.toLowerCase() === 'ethereum' && pairChainId === 'eth') ||
                (network.toLowerCase() === 'bnb' && pairChainId === 'bsc');
                
            // Skip if not matching network and we're looking for a specific one
            if (!isMatchingNetwork && networkCode) continue;
            
            // Get liquidity in USD
            const liquidity = parseFloat(pair.liquidity?.usd || 0);
            
            // Update best pair if this has higher liquidity
            if (liquidity > highestLiquidity) {
                highestLiquidity = liquidity;
                bestPair = pair;
            }
        }
        
        // If we couldn't find a pair on the specified network, use the highest liquidity pair
        if (!bestPair && response.data.pairs.length > 0) {
            bestPair = response.data.pairs.reduce((best, current) => {
                const currentLiquidity = parseFloat(current.liquidity?.usd || 0);
                const bestLiquidity = parseFloat(best?.liquidity?.usd || 0);
                return currentLiquidity > bestLiquidity ? current : best;
            }, response.data.pairs[0]);
        }
        
        if (!bestPair) {
            console.warn(`⚠️ No suitable trading pair found for ${tokenAddress}`);
            return null;
        }
        
        const priceUSD = parseFloat(bestPair.priceUsd || 0);
        const liquidity = bestPair.liquidity?.usd || 'unknown';
        const volume24h = bestPair.volume?.h24 || 'unknown';
        const dex = bestPair.dexId || 'unknown';
        const pairNetwork = bestPair.chainId || 'unknown';
        
        console.log(`💰 Price: $${priceUSD.toFixed(8)}, Liquidity: $${liquidity}, DEX: ${dex} on ${pairNetwork}`);
        
        return {
            priceUSD,
            timestamp: new Date().toISOString(),
            dex,
            network: pairNetwork,
            liquidity: typeof liquidity === 'string' ? liquidity : parseFloat(liquidity),
            volume24h: typeof volume24h === 'string' ? volume24h : parseFloat(volume24h)
        };
    } catch (error) {
        console.error(`❌ Error fetching price for ${tokenAddress}: ${error.message}`);
        return null;
    }
}

/**
 * Update token prices in the database
 */
async function updateTokenPrices() {
    try {
        console.log('🚀 Starting token price update process...');
        
        // Get all tokens from database
        const { data: tokens, error } = await supabase
            .from('tokens')
            .select('*')
            .order('last_updated', { ascending: true });
            
        if (error) {
            throw new Error(`Error fetching tokens from database: ${error.message}`);
        }
        
        console.log(`📊 Found ${tokens.length} tokens to check for price updates`);
        
        // Update prices for each token with rate limiting
        let updatedCount = 0;
        for (const token of tokens) {
            // Skip tokens with invalid addresses
            if (!token.contract_address || token.contract_address === 'native') {
                continue;
            }
            
            // Get price from DEXScreener
            const priceData = await getTokenPriceFromDEXScreener(token.contract_address, token.network);
            await delay(RATE_LIMIT_DELAY); // Rate limiting
            
            // Skip if no price data found
            if (!priceData) continue;
            
            // Update token in database
            const { error: updateError } = await supabase
                .from('tokens')
                .update({
                    price_usd: priceData.priceUSD,
                    last_updated: priceData.timestamp,
                    dex: priceData.dex,
                    dex_network: priceData.network,
                    liquidity_usd: priceData.liquidity,
                    volume_24h: priceData.volume24h
                })
                .eq('contract_address', token.contract_address)
                .eq('network', token.network);
                
            if (updateError) {
                console.error(`❌ Error updating price for ${token.contract_address}: ${updateError.message}`);
                continue;
            }
            
            updatedCount++;
            logger.info(`✅ Updated price for ${token.symbol || token.contract_address}: $${priceData.priceUSD}`);
        }
        
        logger.info(`🎉 Price update completed. Updated ${updatedCount}/${tokens.length} tokens.`);
        return updatedCount;
    } catch (error) {
        logger.error('❌ Error updating token prices:', error);
        return 0;
    }
}

/**
 * Main function to run the entire process
 */
async function main() {
    try {
        console.log('🕒 Starting token sync and price update at', new Date().toISOString());
        
        // First get all tokens from wallet data
        const allTokens = await getTokensFromDatabase();
        
        // Make sure all tokens exist in the tokens table
        const syncedCount = await syncTokensToDatabase(allTokens);
        logger.info(`✅ Successfully synced ${syncedCount} tokens to the database`);
        
        // Update prices for all tokens
        const updatedCount = await updateTokenPrices();
        logger.info(`✅ Successfully updated prices for ${updatedCount} tokens`);
        
        logger.info('✨ Token price update completed successfully!');
        return { success: true, syncedCount, updatedCount };
    } catch (error) {
        logger.error('❌ Error in main process:', error);
        return { success: false, error: error.message };
    }
}

// Run the script
main()
    .then(result => {
        logger.info(`Script completed with result: ${JSON.stringify(result)}`);
        process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
        logger.error('Unhandled error in script:', error);
        process.exit(1);
    });