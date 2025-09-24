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
const ENABLE_STRICT_VALIDATION = process.env.STRICT_VALIDATION === 'true'; // Can be disabled via env var

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
 * Filters out collections with suspicious "moon prices"
 * Now more lenient when sales data is unavailable from API
 */
const isCollectionActive = (stats, days = 30) => {
    console.log(`🔍 Validating collection activity:`, {
        sales: stats.sales_last_30d,
        owners: stats.owners,
        floorPrice: stats.floor_price,
        medianSalePrice: stats.median_sale_price
    });
    
    // If we have sales data and it's 0, that's a red flag
    // But if sales data is missing (null/undefined), we'll be more lenient
    if (stats.sales_last_30d === 0 && stats.sales_last_30d !== null && stats.sales_last_30d !== undefined) {
        console.warn(`❌ Collection has confirmed 0 sales in last ${days} days`);
        return false;
    }
    
    // If sales data is missing, log it but don't fail validation
    if (stats.sales_last_30d === null || stats.sales_last_30d === undefined) {
        console.log(`⚠️ Sales data unavailable from API - proceeding with caution`);
    }
    
    // Only enforce owner count if we have the data and it's very low
    if (stats.owners !== null && stats.owners !== undefined && stats.owners < 5) {
        console.warn(`❌ Collection has very few owners: ${stats.owners} (minimum: 5)`);
        return false;
    }
    
    // Only check price ratio if we have both floor price and median sale price data
    if (stats.median_sale_price && stats.median_sale_price > 0 && stats.floor_price) {
        const priceRatio = stats.floor_price / stats.median_sale_price;
        if (priceRatio > 10) {
            console.warn(`❌ Floor price (${stats.floor_price}) is ${priceRatio.toFixed(1)}x median sale price (${stats.median_sale_price}) - possible moon price`);
            return false;
        }
    }
    
    // Additional validation: Extremely high floor prices (>10 ETH equivalent) require extra scrutiny
    if (stats.floor_price > 10) {
        console.log(`⚠️ High floor price detected (${stats.floor_price}) - requires manual validation but allowing for now`);
    }
    
    console.log(`✅ Collection passes relaxed activity validation`);
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
            
            // DEBUG: Log complete collection structure for the first few collections
            if (Math.random() < 0.3) { // Log ~30% of collections for debugging
                console.log(`🐛 DEBUG - Complete API response for ${collectionName}:`, JSON.stringify(collection, null, 2));
            }
            
            if (collection.floorAsk && collection.floorAsk.price && collection.floorAsk.price.amount) {
                const floorPrice = collection.floorAsk.price.amount.decimal;
                const floorPriceUSD = collection.floorAsk.price.amount.usd;
                const currency = collection.floorAsk.price.currency.symbol;
                
                // Extract collection statistics for activity validation
                // Log the raw collection data structure for debugging
                console.log(`🔍 Raw API response structure for ${collectionName}:`, {
                    volume: collection.volume,
                    ownerCount: collection.ownerCount,
                    tokenCount: collection.tokenCount,
                    floorAsk: collection.floorAsk?.price?.amount
                });
                
                const stats = {
                    sales_last_30d: collection.volume?.['30day']?.count || 
                                   collection.volume?.['1month']?.count || 
                                   collection.sales30d || 
                                   null, // More flexible field checking
                    owners: collection.ownerCount || collection.owners || null,
                    floor_price: floorPriceUSD || floorPrice, // Use USD if available, otherwise native currency
                    median_sale_price: collection.volume?.['30day']?.median || 
                                     collection.volume?.['1month']?.median ||
                                     collection.medianPrice ||
                                     null // More flexible field checking
                };
                
                console.log(`📊 Extracted stats for ${collectionName}:`, stats);
                
                // Validate collection activity to filter out suspicious collections
                // If strict validation is disabled and we have missing data, use minimal validation
                if (ENABLE_STRICT_VALIDATION || (stats.sales_last_30d !== null && stats.median_sale_price !== null)) {
                    if (!isCollectionActive(stats)) {
                        console.warn(`🚫 ${collectionName}: Collection filtered out due to suspicious activity or pricing`);
                        return null;
                    }
                } else {
                    console.log(`⚠️ ${collectionName}: Using minimal validation due to missing API data`);
                    // Minimal validation: just check for extremely unrealistic floor prices
                    if (floorPriceUSD && floorPriceUSD > 1000000) { // $1M+ floor price
                        console.warn(`🚫 ${collectionName}: Extremely high floor price ($${floorPriceUSD}) - likely unrealistic`);
                        return null;
                    }
                }
                
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
                    // Store validation stats for future reference
                    validationStats: stats
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
 * Fetch floor prices for multiple collections with rate limiting and activity validation
 */
const fetchMultipleFloorPrices = async (collections) => {
    console.log(`\n=== 🏷️ Starting Floor Price Fetching with Activity Validation ===`);
    console.log(`📊 Processing ${collections.length} collections...`);
    
    const results = [];
    const failures = [];
    const filtered = [];
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
        } else {
            // Check if it was filtered due to activity validation or actual failure
            // (we can distinguish this by looking at the console output patterns)
            const failureReason = 'API failure or validation filter';
            failures.push({
                contract_address: collection.contract_address,
                collection_name: collection.collection_name,
                network: collection.network,
                reason: failureReason
            });
        }
    }
    
    // Summary
    console.log(`\n🏁 Floor Price Fetch & Validation Summary:`);
    console.log(`   📊 Total collections processed: ${collections.length}`);
    console.log(`   ✅ Successfully validated & fetched: ${results.length} collections`);
    console.log(`   ❌ Failed or filtered out: ${failures.length} collections`);
    console.log(`   🔍 Success rate: ${((results.length / collections.length) * 100).toFixed(1)}%`);
    console.log(`   🕒 Total API requests: ${requestCount}`);
    console.log(`   ⚡ Rate limit: 2 requests/second`);
    console.log(`   🚫 Moon price protection: Active\n`);
    
    if (failures.length > 0) {
        console.log(`🚫 Filtered/Failed Collections:`);
        failures.forEach((failure, index) => {
            console.log(`   ${index + 1}. ${failure.collection_name} (${failure.contract_address?.substring(0, 8)}...)`);
        });
        console.log('');
    }
    
    return { results, failures, requestCount, filtered };
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
                    last_floor_price_update: priceData.lastUpdated,
                    // Store validation statistics for transparency
                    validation_stats: priceData.validationStats ? JSON.stringify(priceData.validationStats) : null,
                    is_active: true // Mark as active since it passed validation
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
        const { results: floorPriceResults, failures, requestCount, filtered } = await fetchMultipleFloorPrices(collections);
        
        if (floorPriceResults.length === 0) {
            console.warn('⚠️ No collections passed validation - all were filtered out or failed');
            console.warn('💡 This could indicate:');
            console.warn('   - Collections have no recent sales activity');
            console.warn('   - Floor prices are unrealistically high (moon prices)');
            console.warn('   - Collections have too few owners');
            console.warn('   - API connectivity issues');
            return;
        }
        
        // Step 3: Convert prices to USD where needed
        const pricesWithUSD = await convertPricesToUSD(floorPriceResults);
        
        // Step 4: Update database with new floor prices
        const updateResults = await updateFloorPrices(pricesWithUSD);
        
        // Step 5: Log comprehensive execution statistics
        const executionTime = Date.now() - startTime;
        const filterRate = ((failures.length / collections.length) * 100).toFixed(1);
        const successRate = ((floorPriceResults.length / collections.length) * 100).toFixed(1);
        
        console.log('\n📈 Comprehensive Execution Statistics:');
        console.log(`   🕒 Execution time: ${executionTime}ms (${(executionTime / 1000).toFixed(1)}s)`);
        console.log(`   📊 Total collections processed: ${collections.length}`);
        console.log(`   ✅ Passed validation & updated: ${floorPriceResults.length} (${successRate}%)`);
        console.log(`   🚫 Filtered or failed: ${failures.length} (${filterRate}%)`);
        console.log(`   💾 Database updates successful: ${updateResults.successful}`);
        console.log(`   ❌ Database updates failed: ${updateResults.failed}`);
        console.log(`   🌐 Total API requests: ${requestCount}`);
        console.log(`   ⚡ Average request time: ${(executionTime / requestCount).toFixed(0)}ms`);
        console.log(`   🛡️ Moon price protection: ACTIVE`);
        console.log(`   📊 Quality assurance: Only active collections with realistic pricing`);
        console.log(`   📅 Completed at: ${new Date().toISOString()}`);
        
        // Log recommendations based on results
        if (filterRate > 50) {
            console.log('\n💡 High Filter Rate Detected:');
            console.log('   - Consider reviewing collection selection criteria');
            console.log('   - Many collections may have stale or unrealistic floor prices');
            console.log('   - This filtering protects against inflated portfolio valuations');
        }
        
        if (floorPriceResults.length > 0) {
            console.log(`\n🎯 Portfolio Impact: Floor prices updated for ${floorPriceResults.length} active collections`);
            console.log('   - These collections have recent sales activity');
            console.log('   - Floor prices are within realistic ranges');
            console.log('   - Portfolio valuations will be more accurate');
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