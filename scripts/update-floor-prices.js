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
 * Get all NFT collections from the database with pagination to bypass 1000 row limit
 */
const getAllNftCollections = async () => {
    try {
        console.log('📊 Fetching all NFT collections from database...');
        
        let allCollections = [];
        let from = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        while (hasMore) {
            console.log(`📄 Fetching page ${Math.floor(from / pageSize) + 1} (rows ${from + 1}-${from + pageSize})...`);
            
            const { data, error } = await supabase
                .from('nft_collections')
                .select('contract_address, collection_name, network, last_floor_price_update')
                .range(from, from + pageSize - 1)
                .order('collection_name');
            
            if (error) {
                console.error('❌ Error fetching NFT collections:', error);
                throw error;
            }
            
            if (data && data.length > 0) {
                allCollections = allCollections.concat(data);
                console.log(`✅ Fetched ${data.length} collections (total: ${allCollections.length})`);
                
                // Check if we got fewer results than requested (indicates last page)
                if (data.length < pageSize) {
                    hasMore = false;
                    console.log('📄 Reached last page of results');
                } else {
                    from += pageSize;
                }
            } else {
                hasMore = false;
                console.log('📄 No more collections to fetch');
            }
        }
        
        console.log(`✅ Found ${allCollections.length} total collections in database`);
        
        // Add debug logging for tokengators specifically
        console.log('\n🔍 Debugging: Searching for tokengators collections...');
        
        const tokengatorCollections = allCollections.filter(c => 
            c.collection_name.toLowerCase().includes('tokengator') ||
            c.contract_address.toLowerCase().includes('4fb7363cf6d0a546cc0ed8cc0a6c99069170a623')
        );
        
        console.log(`🎯 Found ${tokengatorCollections.length} tokengators-related collections:`);
        tokengatorCollections.forEach((collection, index) => {
            console.log(`   ${index + 1}. Collection: "${collection.collection_name}"`);
            console.log(`      📍 Contract: ${collection.contract_address}`);
            console.log(`      🌐 Network: ${collection.network || 'ethereum'}`);
            console.log(`      📅 Last Updated: ${collection.last_floor_price_update || 'Never'}`);
            console.log('');
        });
        
        if (tokengatorCollections.length === 0) {
            console.log('❌ No tokengators collections found in database');
            console.log('🔍 Searching for similar contracts...');
            const similar = allCollections.filter(c => 
                c.contract_address.toLowerCase().includes('4fb7') ||
                c.collection_name.toLowerCase().includes('token') ||
                c.collection_name.toLowerCase().includes('gator')
            );
            console.log(`Found ${similar.length} similar collections:`, similar.slice(0, 5));
        }
        
        console.log('\n📋 All collections summary:');
        console.log(`   📊 Total collections: ${allCollections.length}`);
        console.log(`   🌐 Networks: ${[...new Set(allCollections.map(c => c.network || 'ethereum'))].join(', ')}`);
        console.log(`   📄 Pages fetched: ${Math.ceil(allCollections.length / pageSize)}`);
        
        // Show first few collections as sample (instead of all 1000+)
        console.log('\n📋 First 10 collections sample:');
        allCollections.slice(0, 10).forEach((collection, index) => {
            console.log(`   ${index + 1}. ${collection.collection_name} (${collection.contract_address}) [${collection.network || 'ethereum'}]`);
        });
        if (allCollections.length > 10) {
            console.log(`   ... and ${allCollections.length - 10} more collections`);
        }
        
        return allCollections;
        
    } catch (error) {
        console.error('❌ Failed to fetch NFT collections:', error);
        throw error;
    }
};

/**
 * Check if a collection is active and has realistic pricing
 * Uses floorSale data and isSpam flag for validation
 */
const isCollectionActive = (stats, currentFloorPrice = null) => {
    console.log(`🔍 Validating collection activity:`, {
        floorSale30d: stats.floor_sale_30d,
        volume30d: stats.volume_30d,
        volume365d: stats.volume_365d,
        volumeAllTime: stats.volume_all_time,
        currentFloorPrice: currentFloorPrice,
        owners: stats.owners,
        floorPriceUSD: stats.floor_price_usd,
        isSpam: stats.is_spam,
        priceRatio: currentFloorPrice && stats.floor_sale_30d ? (currentFloorPrice / stats.floor_sale_30d).toFixed(1) + 'x' : 'N/A'
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
    
    // Check for recent trading volume (30 days) - THIS IS KEY
    if (stats.volume_30d !== undefined && stats.volume_30d === 0) {
        console.warn(`❌ No trading volume in last 30 days (volume_30d = 0)`);
        return false;
    }
    
    // Check for yearly trading volume if available (365 days)
    if (stats.volume_365d !== undefined && stats.volume_365d === 0) {
        console.warn(`❌ No trading volume in last year (volume_365d = 0)`);
        return false;
    }
    
    // Fallback to floor_sale_30d check if volume data isn't available
    if (stats.volume_30d === undefined) {
        if (stats.floor_sale_30d === null || stats.floor_sale_30d === undefined) {
            console.warn(`❌ No floor sales data available (30d)`);
            return false;
        }
        
        if (stats.floor_sale_30d === 0) {
            console.warn(`❌ No floor sales in last 30 days`);
            return false;
        }
        
        console.log(`✅ Floor sale activity detected: ${stats.floor_sale_30d} crypto units (30d)`);
    } else {
        console.log(`✅ Trading volume detected: ${stats.volume_30d} crypto units (30d)`);
    }
    
    // Check for extreme price pumps: current floor vs recent sales (100x threshold)
    // Compare crypto currency values (both in ETH/APE, not USD)
    if (currentFloorPrice && stats.floor_sale_30d && currentFloorPrice > 0 && stats.floor_sale_30d > 0) {
        const priceRatio = currentFloorPrice / stats.floor_sale_30d;
        if (priceRatio > 100) {
            console.warn(`❌ Extreme price pump detected: Current floor (${currentFloorPrice} crypto) is ${priceRatio.toFixed(1)}x higher than recent sales (${stats.floor_sale_30d} crypto)`);
            console.warn(`❌ This indicates potential market manipulation or meme pricing - likely unrealistic`);
            return false;
        }
        console.log(`💰 Price ratio check: Current floor (${currentFloorPrice}) is ${priceRatio.toFixed(1)}x recent sales (${stats.floor_sale_30d}) - acceptable`);
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
                    volume_30d: collection.volume?.['30day'] || null,
                    volume_365d: collection.volume?.['365day'] || null,
                    volume_all_time: collection.volume?.['allTime'] || null,
                    owners: collection.ownerCount || null,
                    floor_price_usd: floorPriceUSD || null,
                    is_spam: collection.isSpam || false
                };
                
                // Validate collection activity - set suspicious collections to zero instead of filtering
                // Pass current floor price in crypto currency for proper comparison
                const isActive = isCollectionActive(stats, floorPrice);
                
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
    console.log(`   🛡️ Moon price protection: Active (100x pump threshold)\n`);
    
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
        console.log(`   🛡️ Moon price protection: ACTIVE (100x pump threshold + suspicious collections set to $0)`);
        console.log(`   📊 Quality assurance: Portfolio protection from extreme price manipulation`);
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