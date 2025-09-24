#!/usr/bin/env node

/**
 * Floor Price Update Script for GitHub Actions
 * Fetches NFT floor prices from Magic Eden API and updates Supabase database
 * 
 * This script runs without the 30-second timeout limitation of Netlify Functions,
 * allowing for processing of all collections in a single execution.
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables: SUPABASE_URL or SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Magic Eden API configuration
const RATE_LIMIT_DELAY = 500; // 500ms between requests (2 requests/second)

/**
 * Delay function for rate limiting
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get all NFT collections from the database
 */
const getAllNftCollections = async () => {
    try {
        console.log('📊 Fetching all NFT collections from database...');
        
        const { data, error } = await supabase
            .from('nft_collections')
            .select('contract_address, collection_name, network, last_floor_price_update')
            .order('collection_name');
        
        if (error) {
            console.error('❌ Error fetching NFT collections:', error);
            throw error;
        }
        
        console.log(`✅ Found ${data.length} collections in database`);
        console.log('📋 Collections found:');
        data.forEach((collection, index) => {
            console.log(`   ${index + 1}. ${collection.collection_name} (${collection.contract_address}) [${collection.network || 'ethereum'}]`);
        });
        
        return data;
        
    } catch (error) {
        console.error('❌ Failed to fetch NFT collections:', error);
        throw error;
    }
};

/**
 * Check if a collection is active and has realistic pricing
 * Uses floorSale data and isSpam flag for validation
 */
const isCollectionActive = (stats) => {
    console.log(`🔍 Validating collection activity:`, {
        floorSale30d: stats.floor_sale_30d,
        owners: stats.owners,
        floorPriceUSD: stats.floor_price_usd,
        isSpam: stats.is_spam
    });
    
    // Immediately reject spam collections
    if (stats.is_spam === true) {
        console.warn(`❌ Collection is marked as spam`);
        return false;
    }
    
    // Must have reasonable owner count (indicates some distribution)
    if (stats.owners !== null && stats.owners !== undefined && stats.owners < 10) {
        console.warn(`❌ Collection has too few owners: ${stats.owners} (minimum: 10)`);
        return false;
    }
    
    // Check for recent floor sale activity (30 days)
    if (stats.floor_sale_30d !== null && stats.floor_sale_30d !== undefined) {
        if (stats.floor_sale_30d === 0) {
            console.warn(`❌ No floor sales in last 30 days`);
            return false;
        }
        console.log(`✅ Floor sale activity detected: $${stats.floor_sale_30d} (30d)`);
    }
    
    // Additional validation: Extremely high floor prices (>$100k) are suspicious
    if (stats.floor_price_usd && stats.floor_price_usd > 100000) {
        console.warn(`❌ Extremely high floor price ($${stats.floor_price_usd}) - likely unrealistic`);
        return false;
    }
    
    console.log(`✅ Collection passes validation`);
    return true;
};

/**
 * Fetch floor price for a single collection from Magic Eden API with activity validation
 */
const fetchCollectionFloorPrice = async (contractAddress, network = 'ethereum', collectionName = 'Unknown') => {
    const apiEndpoint = network === 'apechain' 
        ? 'https://api-mainnet.magiceden.dev/v3/rtp/apechain/collections/v7'
        : 'https://api-mainnet.magiceden.dev/v3/rtp/ethereum/collections/v7';
    
    const url = `${apiEndpoint}?id=${contractAddress}&limit=20`;
    
    console.log(`🔍 Fetching floor price for ${collectionName} on ${network} (${contractAddress.substring(0, 8)}...)`);
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(`API responded with status ${response.status}: ${data.message || 'Unknown error'}`);
        }
        
        if (data.collections && data.collections.length > 0) {
            const collection = data.collections[0];
            
            if (collection.floorAsk && collection.floorAsk.price && collection.floorAsk.price.amount) {
                const floorPrice = collection.floorAsk.price.amount.decimal;
                const floorPriceUSD = collection.floorAsk.price.amount.usd;
                const currency = collection.floorAsk.price.currency.symbol;
                
                // Extract collection statistics for validation using new API fields
                const stats = {
                    floor_sale_30d: collection.floorSale?.['30day'] || null,
                    owners: collection.ownerCount || null,
                    floor_price_usd: floorPriceUSD || null,
                    is_spam: collection.isSpam || false
                };
                
                // Validate collection activity - set suspicious collections to zero instead of filtering
                const isActive = isCollectionActive(stats);
                
                if (!isActive) {
                    console.warn(`🚫 ${collectionName}: Suspicious collection - setting floor price to ZERO`);
                    return {
                        contractAddress: contractAddress.toLowerCase(),
                        floorPrice: 0,
                        floorPriceUSD: 0,
                        currency: currency,
                        collectionName: collection.name || collectionName,
                        magicEdenSlug: collection.slug,
                        network: network,
                        lastUpdated: new Date().toISOString(),
                        validationStats: stats,
                        suspicious: true // Flag for tracking
                    };
                } else {
                    console.log(`✅ ${collectionName}: ${floorPrice} ${currency} ($${floorPriceUSD?.toLocaleString() || 'N/A'}) - VALIDATED`);
                    return {
                        contractAddress: contractAddress.toLowerCase(),
                        floorPrice: floorPrice,
                        floorPriceUSD: floorPriceUSD,
                        currency: currency,
                        collectionName: collection.name || collectionName,
                        magicEdenSlug: collection.slug,
                        network: network,
                        lastUpdated: new Date().toISOString(),
                        validationStats: stats,
                        suspicious: false
                    };
                }
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
 * Fetch floor prices for multiple collections with rate limiting and activity validation
 */
const fetchMultipleFloorPrices = async (collections) => {
    console.log(`\n=== 🏷️ Starting Floor Price Fetching with Activity Validation ===`);
    console.log(`📊 Processing ${collections.length} collections...`);
    
    const results = [];
    const failures = [];
    const suspicious = [];
    let requestCount = 0;
    
    for (const collection of collections) {
        // Rate limiting before each request (except the first)
        if (requestCount > 0) {
            await delay(RATE_LIMIT_DELAY);
        }
        requestCount++;
        
        console.log(`\n--- Processing ${collection.collection_name} ---`);
        
        const floorPriceData = await fetchCollectionFloorPrice(
            collection.contract_address,
            collection.network || 'ethereum',
            collection.collection_name || 'Unknown Collection'
        );
        
        if (floorPriceData) {
            results.push(floorPriceData);
            // Track suspicious collections separately
            if (floorPriceData.suspicious) {
                suspicious.push(floorPriceData);
            }
        } else {
            // API failure or collection not found
            const failureReason = 'API failure or collection not found';
            failures.push({
                contract_address: collection.contract_address,
                collection_name: collection.collection_name,
                network: collection.network,
                reason: failureReason
            });
        }
    }
    
    const validCollections = results.filter(r => !r.suspicious);
    
    // Summary
    console.log(`\n🏁 Floor Price Fetch & Validation Summary:`);
    console.log(`   📊 Total collections processed: ${collections.length}`);
    console.log(`   ✅ Valid collections with prices: ${validCollections.length}`);
    console.log(`   🚫 Suspicious collections (set to $0): ${suspicious.length}`);
    console.log(`   ❌ API failures: ${failures.length}`);
    console.log(`   🔍 Data retrieval rate: ${((results.length / collections.length) * 100).toFixed(1)}%`);
    console.log(`   🕒 Total API requests: ${requestCount}`);
    console.log(`   ⚡ Rate limit: 2 requests/second`);
    console.log(`   �️ Moon price protection: Active\n`);
    
    if (suspicious.length > 0) {
        console.log(`🚫 Suspicious Collections (Floor Price Set to $0):`);
        suspicious.forEach((susp, index) => {
            console.log(`   ${index + 1}. ${susp.collectionName} (${susp.contractAddress?.substring(0, 8)}...)`);
        });
        console.log('');
    }
    
    if (failures.length > 0) {
        console.log(`❌ Failed Collections (API Issues):`);
        failures.forEach((failure, index) => {
            console.log(`   ${index + 1}. ${failure.collection_name} (${failure.contract_address?.substring(0, 8)}...)`);
        });
        console.log('');
    }
    
    return { results, failures, requestCount, suspicious };
};

/**
 * Get current ETH price for USD conversion
 */
const getCurrentEthPrice = async () => {
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
 */
const convertPricesToUSD = async (floorPriceResults) => {
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

/**
 * Update floor prices in the database
 */
const updateFloorPrices = async (floorPriceData) => {
    try {
        console.log(`\n💾 Updating floor prices for ${floorPriceData.length} collections...`);
        
        const updatePromises = floorPriceData.map(async (priceData) => {
            console.log(`🔄 Attempting to update collection: ${priceData.collectionName}`);
            console.log(`   📍 Contract Address: ${priceData.contractAddress}`);
            console.log(`   💰 Floor Price: ${priceData.floorPrice} ${priceData.currency}`);
            console.log(`   💵 USD Price: $${priceData.floorPriceUSD?.toFixed(2) || 'N/A'}`);
            
            const { data, error } = await supabase
                .from('nft_collections')
                .update({
                    floor_price_eth: priceData.floorPrice,
                    floor_price_usd: priceData.floorPriceUSD,
                    floor_price_currency: priceData.currency,
                    magic_eden_slug: priceData.magicEdenSlug,
                    last_floor_price_update: priceData.lastUpdated
                })
                .eq('contract_address', priceData.contractAddress)
                .select();
            
            if (error) {
                console.error(`❌ Failed to update ${priceData.collectionName}:`, error);
                console.error(`   Full error details:`, JSON.stringify(error, null, 2));
                return { success: false, collection: priceData.collectionName, error };
            }
            
            if (data && data.length === 0) {
                console.warn(`⚠️ No rows updated for ${priceData.collectionName} - contract address might not match`);
                console.warn(`   Searched for contract_address: ${priceData.contractAddress}`);
                return { success: false, collection: priceData.collectionName, error: 'No matching rows found' };
            }
            
            console.log(`✅ Updated ${priceData.collectionName}: ${priceData.floorPrice} ${priceData.currency} ($${priceData.floorPriceUSD?.toFixed(2) || 'N/A'})`);
            console.log(`   📊 Updated ${data?.length || 0} rows`);
            return { success: true, collection: priceData.collectionName, data };
        });
        
        const results = await Promise.all(updatePromises);
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log(`\n💾 Database Update Summary:`);
        console.log(`   ✅ Successfully updated: ${successful} collections`);
        console.log(`   ❌ Failed to update: ${failed} collections`);
        
        return { successful, failed, results };
        
    } catch (error) {
        console.error('❌ Failed to update floor prices:', error);
        throw error;
    }
};

/**
 * Main execution function
 */
async function main() {
    const startTime = Date.now();
    
    try {
        console.log('\n🚀 Starting Floor Price Update Script');
        console.log(`⏰ Execution time: ${new Date().toISOString()}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        
        // Step 1: Get all collections from database
        const collections = await getAllNftCollections();
        
        if (collections.length === 0) {
            console.log('🤷 No NFT collections found in database');
            return;
        }
        
        // Step 2: Fetch floor prices from Magic Eden API with activity validation
        const { results: floorPriceResults, failures, requestCount, suspicious } = await fetchMultipleFloorPrices(collections);
        
        if (floorPriceResults.length === 0) {
            console.warn('⚠️ No collections could be processed - all API requests failed');
            console.warn('💡 This indicates API connectivity issues');
            return;
        }
        
        // Step 3: Convert prices to USD where needed
        const pricesWithUSD = await convertPricesToUSD(floorPriceResults);
        
        // Step 4: Update database with new floor prices
        const updateResults = await updateFloorPrices(pricesWithUSD);
        
        // Step 5: Log comprehensive execution statistics
        const executionTime = Date.now() - startTime;
        const validCollections = floorPriceResults.filter(r => !r.suspicious);
        const suspiciousRate = ((suspicious.length / collections.length) * 100).toFixed(1);
        const validRate = ((validCollections.length / collections.length) * 100).toFixed(1);
        const dataRate = ((floorPriceResults.length / collections.length) * 100).toFixed(1);
        
        console.log('\n📈 Comprehensive Execution Statistics:');
        console.log(`   🕒 Execution time: ${executionTime}ms (${(executionTime / 1000).toFixed(1)}s)`);
        console.log(`   📊 Total collections processed: ${collections.length}`);
        console.log(`   ✅ Valid collections with prices: ${validCollections.length} (${validRate}%)`);
        console.log(`   🚫 Suspicious collections (set to $0): ${suspicious.length} (${suspiciousRate}%)`);
        console.log(`   ❌ API failures: ${failures.length}`);
        console.log(`   📡 Data retrieval rate: ${dataRate}%`);
        console.log(`   💾 Database updates successful: ${updateResults.successful}`);
        console.log(`   ❌ Database updates failed: ${updateResults.failed}`);
        console.log(`   🌐 Total API requests: ${requestCount}`);
        console.log(`   ⚡ Average request time: ${(executionTime / requestCount).toFixed(0)}ms`);
        console.log(`   🛡️ Moon price protection: ACTIVE (suspicious collections set to $0)`);
        console.log(`   📊 Quality assurance: Portfolio protection from inflated valuations`);
        console.log(`   📅 Completed at: ${new Date().toISOString()}`);
        
        // Log recommendations based on results
        if (suspiciousRate > 30) {
            console.log('\n💡 High Suspicious Collection Rate:');
            console.log('   - Many collections have suspicious characteristics (spam, low activity, etc.)');
            console.log('   - These have been set to $0 to prevent inflated portfolio values');
            console.log('   - Portfolio calculations will be more realistic');
        }
        
        if (validCollections.length > 0) {
            console.log(`\n🎯 Portfolio Impact: ${validCollections.length} collections have realistic floor prices`);
            console.log(`   - ${suspicious.length} suspicious collections neutralized (set to $0)`);
            console.log('   - Portfolio valuations protected from moon prices');
            console.log('   - Only legitimate collections contribute to portfolio value');
        }
        
        // Exit with success
        process.exit(0);
        
    } catch (error) {
        console.error('\n💥 Script execution failed:', error);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = {
    main,
    getAllNftCollections,
    fetchMultipleFloorPrices,
    updateFloorPrices
};