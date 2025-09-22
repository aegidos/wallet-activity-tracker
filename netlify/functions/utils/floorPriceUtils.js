// Server-side utilities for floor price fetching
// Adapted from WalletAnalyzer.js for Netlify Functions

// Rate limiting utility
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const RATE_LIMIT_DELAY = 500; // 500ms = 2 requests per second (Magic Eden limit)

/**
 * Fetch floor price for a single collection from Magic Eden API
 * @param {string} contractAddress - The NFT collection contract address
 * @param {string} network - The blockchain network (ethereum, apechain)
 * @param {string} collectionName - Human readable collection name for logging
 * @returns {Object|null} Floor price data or null if failed
 */
export const fetchCollectionFloorPrice = async (contractAddress, network = 'ethereum', collectionName = 'Unknown') => {
    try {
        // Determine the correct Magic Eden API endpoint based on network
        let apiEndpoint;
        if (network.toLowerCase() === 'apechain') {
            apiEndpoint = `https://api-mainnet.magiceden.dev/v3/rtp/apechain/collections/v7?id=${contractAddress}&includeMintStages=false&includeSecurityConfigs=false&normalizeRoyalties=false&useNonFlaggedFloorAsk=false&sortBy=allTimeVolume&limit=20`;
        } else {
            // Default to ethereum for all other networks
            apiEndpoint = `https://api-mainnet.magiceden.dev/v3/rtp/ethereum/collections/v7?id=${contractAddress}&includeMintStages=false&includeSecurityConfigs=false&normalizeRoyalties=false&useNonFlaggedFloorAsk=false&sortBy=allTimeVolume&limit=20`;
        }
        
        console.log(`🔍 Fetching floor price for ${collectionName} on ${network} (${contractAddress.slice(0, 8)}...)`);
        
        // Query Magic Eden API
        const response = await fetch(apiEndpoint, {
            headers: {
                'accept': '*/*',
                'User-Agent': 'Wallet-Analyzer-Bot/1.0'
                // Note: Add API key here if you have one
                // 'Authorization': 'Bearer YOUR_API_KEY'
            }
        });

        if (!response.ok) {
            console.warn(`❌ ${collectionName}: API error ${response.status}`);
            return null;
        }

        const data = await response.json();
        const collections = data.collections || [];
        
        if (collections.length > 0) {
            const collection = collections[0];
            
            if (collection.floorAsk?.price?.amount?.decimal) {
                const floorPrice = collection.floorAsk.price.amount.decimal;
                const floorPriceUSD = collection.floorAsk.price.amount.usd;
                const currency = collection.floorAsk.price.currency.symbol;
                
                console.log(`✅ ${collectionName}: ${floorPrice} ${currency} ($${floorPriceUSD?.toLocaleString() || 'N/A'})`);
                
                return {
                    contractAddress: contractAddress.toLowerCase(),
                    floorPrice: floorPrice,
                    floorPriceUSD: floorPriceUSD,
                    currency: currency,
                    collectionName: collection.name || collectionName,
                    magicEdenSlug: collection.slug,
                    network: network,
                    lastUpdated: new Date().toISOString()
                };
            } else {
                console.warn(`❌ ${collectionName}: Found in Magic Eden but no floor price available`);
                return null;
            }
        } else {
            console.warn(`❌ ${collectionName}: Collection not found in Magic Eden`);
            return null;
        }
        
    } catch (error) {
        console.error(`❌ ${collectionName}: Request failed - ${error.message}`);
        return null;
    }
};

/**
 * Fetch floor prices for multiple collections with rate limiting
 * @param {Array} collections - Array of collection objects with {contract_address, collection_name, network}
 * @returns {Array} Array of successful floor price fetches
 */
export const fetchMultipleFloorPrices = async (collections) => {
    console.log(`\n=== 🏷️ Starting Batch Floor Price Fetching ===`);
    console.log(`📊 Processing ${collections.length} collections...`);
    
    const results = [];
    const failures = [];
    let requestCount = 0;
    
    for (const collection of collections) {
        // Rate limiting before each request (except the first)
        if (requestCount > 0) {
            await delay(RATE_LIMIT_DELAY);
        }
        requestCount++;
        
        const floorPriceData = await fetchCollectionFloorPrice(
            collection.contract_address,
            collection.network || 'ethereum',
            collection.collection_name || 'Unknown Collection'
        );
        
        if (floorPriceData) {
            results.push(floorPriceData);
        } else {
            failures.push({
                contract_address: collection.contract_address,
                collection_name: collection.collection_name,
                network: collection.network
            });
        }
    }
    
    // Summary
    console.log(`\n🏁 Batch Floor Price Summary:`);
    console.log(`   ✅ Successfully fetched: ${results.length}/${collections.length} collections`);
    console.log(`   ❌ Failed to fetch: ${failures.length} collections`);
    console.log(`   🕒 Total API requests: ${requestCount}`);
    console.log(`   ⚡ Rate limit: 2 requests/second\n`);
    
    return { results, failures, requestCount };
};

/**
 * Get current ETH price for USD conversion
 * @returns {number} ETH price in USD
 */
export const getCurrentEthPrice = async () => {
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
        const data = await response.json();
        return parseFloat(data.price);
    } catch (error) {
        console.warn('Failed to fetch ETH price, using fallback:', error.message);
        return 3000; // Fallback ETH price
    }
};

/**
 * Convert floor prices to USD where needed
 * @param {Array} floorPriceResults - Results from fetchMultipleFloorPrices
 * @returns {Array} Results with USD prices calculated
 */
export const convertPricesToUSD = async (floorPriceResults) => {
    const ethPrice = await getCurrentEthPrice();
    console.log(`💰 Using ETH price: $${ethPrice.toFixed(2)} for USD conversions`);
    
    return floorPriceResults.map(result => {
        if (result.currency === 'ETH' && result.floorPrice && !result.floorPriceUSD) {
            // Calculate USD price from ETH price
            result.floorPriceUSD = result.floorPrice * ethPrice;
            console.log(`🔄 Converted ${result.collectionName}: ${result.floorPrice} ETH → $${result.floorPriceUSD.toFixed(2)}`);
        }
        return result;
    });
};