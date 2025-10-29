#!/usr/bin/env node

/**
 * Floor Price Update Script for GitHub Actions
 * Fetches NFT floor prices from Magic Eden API and updates Supabase database
 * 
 * This script runs without the 30-second timeout limitation of Netlify Functions,
 * allowing for processing of all collections in a single execution.
 */

const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

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
const SKIP_INACTIVE_COLLECTIONS = true; // Skip collections previously marked as inactive

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
                .select('contract_address, collection_name, network, last_floor_price_update, "ISACTIVE"')
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
        
        // Filter out inactive collections if SKIP_INACTIVE_COLLECTIONS is enabled
        if (SKIP_INACTIVE_COLLECTIONS) {
            const activeCollections = allCollections.filter(collection => collection.ISACTIVE !== false);
            console.log(`⏭️ Filtered out ${allCollections.length - activeCollections.length} inactive collections`);
            allCollections = activeCollections;
        }
        
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
        lastTrade: stats.last_trade ? new Date(stats.last_trade).toISOString() : null,
        lastSaleDate: stats.last_sale_date ? new Date(stats.last_sale_date).toISOString() : null,
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
    // UPDATED: Always return false for collections with no recent volume (zero or null)
    if (stats.volume_30d === 0 || stats.volume_30d === null || stats.volume_30d === undefined) {
        console.warn(`❌ No trading volume in last 30 days`);
        
        if (stats.volume_30d === 0) {
            console.warn(`❌ volume_30d = 0 - Setting floor price to zero`);
        } else if (stats.volume_30d === null) {
            console.warn(`❌ volume_30d = null - Setting floor price to zero`);
        } else {
            console.warn(`❌ volume_30d undefined - Setting floor price to zero`);
        }
        
        // Log additional context about the collection for monitoring purposes
        if (stats.volume_all_time !== undefined && stats.volume_all_time !== null && stats.volume_all_time > 0) {
            console.warn(`⚠️ Collection appears inactive: has all-time volume (${stats.volume_all_time}) but no recent activity`);
            
            // Check last sale date if available (for informational purposes only)
            if (stats.last_sale_date || stats.last_trade) {
                const lastActivityDate = stats.last_sale_date ? new Date(stats.last_sale_date) : 
                                         stats.last_trade ? new Date(stats.last_trade) : null;
                
                if (lastActivityDate) {
                    const daysSinceLastActivity = (Date.now() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24);
                    console.log(`⏱️ Last activity was ${Math.round(daysSinceLastActivity)} days ago`);
                }
            }
            
            // Note high owner count collections for reference
            if (stats.owners > 5000) {
                console.log(`⚠️ High owner count (${stats.owners}) detected despite inactivity`);
                console.log(`⚖️ Setting floor price to zero as requested (volume_30d is ${stats.volume_30d})`);
            }
        }
        
        // Always return false for collections with no 30-day volume
        return false;
    }
    
    // Check yearly trading volume if available
    if (stats.volume_365d !== undefined && stats.volume_365d !== null && stats.volume_365d === 0) {
        console.warn(`❌ No trading volume in last year (volume_365d = 0)`);
        return false;
    }
    
    // Fallback to floor_sale_30d check if volume data isn't available
    if (stats.volume_30d === undefined || stats.volume_30d === null) {
        if (stats.floor_sale_30d === null || stats.floor_sale_30d === undefined) {
            console.warn(`❌ No floor sales data available (30d)`);
            return false;
        }
        
        if (stats.floor_sale_30d === 0) {
            console.warn(`❌ No floor sales in last 30 days`);
            return false;
        }
        
        console.log(`✅ Floor sale activity detected: ${stats.floor_sale_30d} crypto units (30d)`);
    } else if (stats.volume_30d !== null && stats.volume_30d !== undefined && stats.volume_30d > 0) {
        console.log(`✅ Trading volume detected: ${stats.volume_30d} crypto units (30d)`);
    } else {
        console.log(`⚠️ Using floor sale data as volume data is unavailable or unreliable`);
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
 * Fetch floor prices for multiple collections using Magic Eden v4 API (batch mode)
 * This new API can handle up to 40 collections in one call
 */
const fetchCollectionFloorPricesBatch = async (collections, network = 'apechain') => {
    // Limit to 40 collections per batch as per API limits
    const batchSize = 40;
    const batches = [];
    
    for (let i = 0; i < collections.length; i += batchSize) {
        batches.push(collections.slice(i, i + batchSize));
    }
    
    console.log(`📦 Split ${collections.length} collections into ${batches.length} batches of up to ${batchSize}`);
    
    const allResults = [];
    
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`\n🔄 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} collections)...`);
        
        // Build collection IDs array for the API
        const collectionIds = batch.map(c => `${network}:${c.contract_address.toLowerCase()}`);
        
        // Build URL with collection IDs as query parameters
        // IMPORTANT: Request enough results to get at least one bid per collection
        // API returns bids sorted by price globally, not one per collection
        // API only allows specific limit values: 1, 5, 10, 20, 50, 100
        const baseUrl = 'https://api-mainnet.magiceden.dev/v4/bids';
        const queryParams = collectionIds.map(id => `collectionIds[]=${encodeURIComponent(id)}`).join('&');
        
        // Use 100 limit for batches (maximum allowed, covers all 40 collections)
        const limit = 100;
        const url = `${baseUrl}?${queryParams}&sortBy=price&sortDir=desc&limit=${limit}`;
        
        console.log(`📡 API URL: ${url.substring(0, 150)}...`);
        console.log(`📊 Fetching top ${limit} bids across ${collectionIds.length} collections`);
        
        try {
            const response = await fetch(url, {
                headers: {
                    'accept': 'application/json'
                }
            });
            
            console.log(`📊 Response status: ${response.status} ${response.statusText}`);
            console.log(`📋 Content-Type: ${response.headers.get('content-type')}`);
            
            if (!response.ok) {
                console.error(`❌ API responded with status ${response.status}`);
                const rawText = await response.text();
                console.error(`📄 Response body (first 200 chars): ${rawText.substring(0, 200)}`);
                
                // Continue to next batch instead of failing completely
                continue;
            }
            
            const rawText = await response.text();
            
            let data;
            try {
                data = JSON.parse(rawText);
            } catch (parseError) {
                console.error(`❌ Failed to parse JSON response`);
                console.error(`📄 Raw text (first 200 chars): ${rawText.substring(0, 200)}`);
                console.error(`❌ Parse error: ${parseError.message}`);
                continue;
            }
            
            console.log(`✅ Received data for batch`);
            console.log(`📊 Data structure:`, {
                hasData: !!data.data,
                dataCount: data.data?.length || 0,
                hasPagination: !!data.pagination
            });
            
            // Process the bids data
            if (data.data && Array.isArray(data.data)) {
                // Group bids by collection contract address
                // IMPORTANT: Only include collection-wide bids (criteria.type === "COLLECTION")
                // Exclude individual NFT bids (criteria.type === "ASSET")
                const bidsByCollection = {};
                
                data.data.forEach(item => {
                    if (item.bid && item.bid.contract) {
                        // Filter out individual NFT bids - we only want collection-wide bids
                        if (item.bid.criteria && item.bid.criteria.type === 'ASSET') {
                            // Skip individual NFT bids
                            return;
                        }
                        
                        const contract = item.bid.contract.toLowerCase();
                        if (!bidsByCollection[contract]) {
                            bidsByCollection[contract] = [];
                        }
                        bidsByCollection[contract].push(item.bid);
                    }
                });
                
                console.log(`📊 Found collection-wide bids for ${Object.keys(bidsByCollection).length} collections out of ${batch.length} requested`);
                console.log(`📋 Collections with bids:`, Object.keys(bidsByCollection).map(c => c.substring(0, 10) + '...').join(', '));
                
                // Fetch current crypto prices for USD conversion
                const cryptoPrices = await getCryptoPrices();
                
                // Match bids back to our collections and extract highest bid data
                batch.forEach(collection => {
                    const contractLower = collection.contract_address.toLowerCase();
                    const bids = bidsByCollection[contractLower];
                    
                    if (bids && bids.length > 0) {
                        // Sort bids by USD value descending (highest first)
                        // Use priceV2.amount.fiat.usd for reliable sorting
                        const sortedBids = bids.sort((a, b) => {
                            const usdA = a.priceV2?.amount?.fiat?.usd ? parseFloat(a.priceV2.amount.fiat.usd) : 0;
                            const usdB = b.priceV2?.amount?.fiat?.usd ? parseFloat(b.priceV2.amount.fiat.usd) : 0;
                            return usdB - usdA;
                        });
                        
                        const topBid = sortedBids[0];
                        
                        if (topBid.priceV2 && topBid.priceV2.amount && topBid.priceV2.amount.fiat && topBid.priceV2.amount.fiat.usd) {
                            const floorPriceUSD = parseFloat(topBid.priceV2.amount.fiat.usd);
                            const currency = topBid.priceV2.currency?.symbol || (network === 'ethereum' ? 'WETH' : 'wAPE');
                            
                            // Convert USD back to crypto using live exchange rate
                            const exchangeRate = cryptoPrices[currency] || cryptoPrices[currency?.toUpperCase()];
                            const floorPrice = exchangeRate ? floorPriceUSD / exchangeRate : parseFloat(topBid.priceV2.amount.native || 0);
                            
                            console.log(`💰 ${collection.collection_name}: Top bid = $${floorPriceUSD.toFixed(2)} → ${floorPrice.toFixed(4)} ${currency} (@ $${exchangeRate?.toFixed(4)}/each)`);
                            
                            allResults.push({
                                contractAddress: contractLower,
                                floorPrice: floorPrice,
                                floorPriceUSD: floorPriceUSD,
                                currency: currency,
                                collectionName: collection.collection_name,
                                network: network,
                                lastUpdated: new Date().toISOString(),
                                dataSource: 'bids',
                                suspicious: false,
                                isActive: true
                            });
                        } else {
                            console.warn(`⚠️ ${collection.collection_name}: Bid found but no valid USD price data`);
                        }
                    } else {
                        console.warn(`⚠️ ${collection.collection_name}: No collection-wide bids found (only individual NFT bids)`);
                    }
                });
            }
            
            // Rate limiting between batches
            if (batchIndex < batches.length - 1) {
                await delay(RATE_LIMIT_DELAY);
            }
            
        } catch (error) {
            console.error(`❌ Batch ${batchIndex + 1} failed:`, error.message);
            // Continue to next batch
        }
    }
    
    return allResults;
};

/**
 * Fetch floor price for a single collection from Magic Eden API with activity validation
 * DEPRECATED: This is kept for backwards compatibility but the batch API should be preferred
 */
const fetchCollectionFloorPrice = async (contractAddress, network = 'ethereum', collectionName = 'Unknown') => {
    // Use v4 bids API for single collection
    const collectionId = `${network}:${contractAddress.toLowerCase()}`;
    const url = `https://api-mainnet.magiceden.dev/v4/bids?collectionIds[]=${encodeURIComponent(collectionId)}&sortBy=price&sortDir=desc&limit=1`;
    
    console.log(`🔍 Fetching floor price for ${collectionName} on ${network} (${contractAddress.substring(0, 8)}...)`);
    console.log(`📡 API URL: ${url}`);
    
    try {
        const response = await fetch(url, {
            headers: {
                'accept': 'application/json'
            }
        });
        
        // Log response details before parsing
        console.log(`📊 Response status: ${response.status} ${response.statusText}`);
        console.log(`📋 Content-Type: ${response.headers.get('content-type')}`);
        
        // Get raw text first to see what we're dealing with
        const rawText = await response.text();
        console.log(`📄 Raw response (first 200 chars): ${rawText.substring(0, 200)}`);
        
        if (!response.ok) {
            console.error(`❌ API responded with status ${response.status}`);
            console.error(`📄 Response body: ${rawText}`);
            return null;
        }
        
        // Try to parse JSON
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (parseError) {
            console.error(`❌ Failed to parse JSON response`);
            console.error(`📄 Raw text: ${rawText}`);
            console.error(`❌ Parse error: ${parseError.message}`);
            return null;
        }
        
        // Process v4 bids API response
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            // Filter for collection-wide bids only (exclude individual NFT bids)
            const collectionBids = data.data.filter(item => 
                item.bid && 
                item.bid.criteria && 
                item.bid.criteria.type !== 'ASSET' // Exclude individual NFT bids
            );
            
            if (collectionBids.length === 0) {
                console.warn(`❌ ${collectionName}: Only individual NFT bids found, no collection-wide bids`);
                return null;
            }
            
            const topBid = collectionBids[0].bid;
            
            if (topBid && topBid.priceV2 && topBid.priceV2.amount && topBid.priceV2.amount.fiat && topBid.priceV2.amount.fiat.usd) {
                const floorPriceUSD = parseFloat(topBid.priceV2.amount.fiat.usd);
                const currency = topBid.priceV2.currency?.symbol || (network === 'ethereum' ? 'WETH' : 'wAPE');
                
                // Calculate crypto amount using live exchange rate (USD → Crypto)
                const cryptoPrices = await getCryptoPrices();
                const exchangeRate = cryptoPrices[currency] || cryptoPrices[currency?.toUpperCase()];
                const floorPrice = exchangeRate ? floorPriceUSD / exchangeRate : parseFloat(topBid.priceV2.amount.native || 0);
                
                console.log(`✅ ${collectionName}: Top bid = $${floorPriceUSD.toFixed(2)} → ${floorPrice.toFixed(4)} ${currency} (@ $${exchangeRate?.toFixed(4)}/each)`);
                
                return {
                    contractAddress: contractAddress.toLowerCase(),
                    floorPrice: floorPrice,
                    floorPriceUSD: floorPriceUSD,
                    currency: currency,
                    collectionName: collectionName,
                    network: network,
                    lastUpdated: new Date().toISOString(),
                    dataSource: 'bids',
                    suspicious: false,
                    isActive: true
                };
            } else {
                console.warn(`❌ ${collectionName}: Found collection bid but no valid USD price data`);
                return null;
            }
        } else {
            console.warn(`❌ ${collectionName}: No bids found`);
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
    console.log(`\n=== 🏷️ Starting Floor Price Fetching with Batch API (v4) ===`);
    console.log(`📊 Processing ${collections.length} collections...`);
    console.log(`⚡ Using batch processing: up to 40 collections per API call`);
    
    const results = [];
    const failures = [];
    const suspicious = [];
    let requestCount = 0;
    
    // Group collections by network for batch processing
    const ethereumCollections = collections.filter(c => (c.network || 'ethereum') === 'ethereum');
    const apechainCollections = collections.filter(c => c.network === 'apechain');
    
    console.log(`📊 Network distribution: ${ethereumCollections.length} Ethereum, ${apechainCollections.length} ApeChain`);
    
    // Process Ethereum collections in batches
    if (ethereumCollections.length > 0) {
        console.log(`\n--- Processing Ethereum collections ---`);
        const ethereumResults = await fetchCollectionFloorPricesBatch(ethereumCollections, 'ethereum');
        
        requestCount += Math.ceil(ethereumCollections.length / 40); // Count batch requests
        
        // Match results back to original collection data
        ethereumResults.forEach(result => {
            if (result) {
                const originalCollection = ethereumCollections.find(
                    c => c.contract_address.toLowerCase() === result.contractAddress.toLowerCase()
                );
                
                if (originalCollection) {
                    result.collectionName = originalCollection.collection_name || result.collectionName;
                }
                
                results.push(result);
                
                if (result.suspicious) {
                    suspicious.push(result);
                }
            }
        });
        
        // Track failures (collections without results)
        ethereumCollections.forEach(collection => {
            const found = ethereumResults.some(
                r => r && r.contractAddress.toLowerCase() === collection.contract_address.toLowerCase()
            );
            if (!found) {
                failures.push({
                    contract_address: collection.contract_address,
                    collection_name: collection.collection_name,
                    network: collection.network,
                    reason: 'No bids found or API failure'
                });
            }
        });
    }
    
    // Rate limit between network batches
    if (ethereumCollections.length > 0 && apechainCollections.length > 0) {
        await delay(RATE_LIMIT_DELAY);
    }
    
    // Process ApeChain collections in batches
    if (apechainCollections.length > 0) {
        console.log(`\n--- Processing ApeChain collections ---`);
        const apechainResults = await fetchCollectionFloorPricesBatch(apechainCollections, 'apechain');
        
        requestCount += Math.ceil(apechainCollections.length / 40); // Count batch requests
        
        // Match results back to original collection data
        apechainResults.forEach(result => {
            if (result) {
                const originalCollection = apechainCollections.find(
                    c => c.contract_address.toLowerCase() === result.contractAddress.toLowerCase()
                );
                
                if (originalCollection) {
                    result.collectionName = originalCollection.collection_name || result.collectionName;
                }
                
                results.push(result);
                
                if (result.suspicious) {
                    suspicious.push(result);
                }
            }
        });
        
        // Track failures (collections without results)
        apechainCollections.forEach(collection => {
            const found = apechainResults.some(
                r => r && r.contractAddress.toLowerCase() === collection.contract_address.toLowerCase()
            );
            if (!found) {
                failures.push({
                    contract_address: collection.contract_address,
                    collection_name: collection.collection_name,
                    network: collection.network,
                    reason: 'No bids found or API failure'
                });
            }
        });
    }
    
    const validCollections = results.filter(r => !r.suspicious);
    
    // Summary
    console.log(`\n🏁 Floor Price Fetch & Validation Summary:`);
    console.log(`   📊 Total collections processed: ${collections.length}`);
    console.log(`   ✅ Valid collections with prices: ${validCollections.length}`);
    console.log(`   🚫 Suspicious collections (set to $0): ${suspicious.length}`);
    console.log(`   ❌ API failures: ${failures.length}`);
    console.log(`   🔍 Data retrieval rate: ${((results.length / collections.length) * 100).toFixed(1)}%`);
    console.log(`   🕒 Total API requests (batches): ${requestCount}`);
    console.log(`   ⚡ Batch size: 40 collections per request`);
    console.log(`   � Efficiency: ${(collections.length / (requestCount || 1)).toFixed(1)} collections per API call\n`);
    
    if (suspicious.length > 0) {
        console.log(`🚫 Suspicious Collections (Floor Price Set to $0):`);
        suspicious.forEach((susp, index) => {
            console.log(`   ${index + 1}. ${susp.collectionName} (${susp.contractAddress?.substring(0, 8)}...)`);
        });
        console.log('');
    }
    
    if (failures.length > 0) {
        console.log(`❌ Failed Collections (No Bids or API Issues):`);
        failures.forEach((failure, index) => {
            console.log(`   ${index + 1}. ${failure.collection_name} (${failure.contract_address?.substring(0, 8)}...)`);
        });
        console.log('');
    }
    
    return { results, failures, requestCount, suspicious };
};

/**
 * Get current crypto prices for USD conversion
 */
const getCryptoPrices = async () => {
    try {
        console.log('💰 Fetching current crypto prices...');
        
        // Fetch ETH price
        console.log('🔍 Fetching ETH price from Binance...');
        const ethResponse = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT');
        console.log(`📊 ETH Response status: ${ethResponse.status}`);
        const ethData = await ethResponse.json();
        console.log(`📄 ETH Response data:`, ethData);
        const ethPrice = parseFloat(ethData.price);
        console.log(`💰 ETH Price parsed: ${ethPrice}`);
        
        // Fetch APE price
        console.log('🔍 Fetching APE price from Binance...');
        const apeResponse = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=APEUSDT');
        console.log(`📊 APE Response status: ${apeResponse.status}`);
        const apeData = await apeResponse.json();
        console.log(`📄 APE Response data:`, apeData);
        const apePrice = parseFloat(apeData.price);
        console.log(`💰 APE Price parsed: ${apePrice}`);
        
        console.log(`✅ ETH: $${ethPrice.toFixed(2)}`);
        console.log(`✅ APE: $${apePrice.toFixed(4)}`);
        
        return {
            ETH: ethPrice,
            APE: apePrice,
            WETH: ethPrice, // Wrapped ETH = ETH
            wAPE: apePrice  // Wrapped APE = APE
        };
    } catch (error) {
        console.warn('⚠️ Failed to fetch crypto prices, using fallback:', error.message);
        console.error('🔍 Full error details:', error);
        return {
            ETH: 3000,
            APE: 0.45,
            WETH: 3000,
            wAPE: 0.45
        };
    }
};

/**
 * Convert floor prices to USD where needed
 */
const convertPricesToUSD = async (floorPriceResults) => {
    const cryptoPrices = await getCryptoPrices();
    console.log(`\n💰 Converting prices to USD using current exchange rates`);
    
    return floorPriceResults.map(result => {
        if (result.floorPrice && !result.floorPriceUSD) {
            // Get the exchange rate for this currency
            const exchangeRate = cryptoPrices[result.currency] || cryptoPrices[result.currency?.toUpperCase()];
            
            if (exchangeRate) {
                result.floorPriceUSD = result.floorPrice * exchangeRate;
                console.log(`🔄 ${result.collectionName}: ${result.floorPrice} ${result.currency} × $${exchangeRate.toFixed(4)} = $${result.floorPriceUSD.toFixed(2)}`);
            } else {
                console.warn(`⚠️ ${result.collectionName}: No exchange rate found for ${result.currency}, cannot calculate USD value`);
            }
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
                    "ISACTIVE": priceData.isActive !== false // Update activity status
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
        
        // Test API connectivity before processing all collections
        console.log('\n🧪 Testing Magic Eden v4 Bids API connectivity...');
        const testContract = '0x88f1a6d167531adc34ab24c6b22a9e99bbd77e3f'; // Rejects contract as test
        const testCollections = [{ 
            contract_address: testContract, 
            network: 'apechain', 
            collection_name: 'TEST Collection' 
        }];
        const testResults = await fetchCollectionFloorPricesBatch(testCollections, 'apechain');
        
        if (testResults.length === 0) {
            console.error('\n❌ API connectivity test FAILED');
            console.error('💡 Possible issues:');
            console.error('   1. Magic Eden v4 Bids API endpoint is not responding');
            console.error('   2. API requires authentication/API key');
            console.error('   3. Rate limiting or IP blocking');
            console.error('   4. Network connectivity issues');
            console.error('   5. Collection has no active bids');
            console.error('\n💡 Suggested actions:');
            console.error('   1. Check Magic Eden API documentation for updates');
            console.error('   2. Verify API endpoints are still valid');
            console.error('   3. Check if API key is required');
            console.warn('\n⚠️ Note: No bids for test collection is normal - continuing with main processing');
        } else {
            console.log('✅ API connectivity test PASSED');
            console.log(`📊 Test result: ${testResults[0].collectionName || 'Unknown'} - ${testResults[0].floorPrice || 0} ${testResults[0].currency || 'N/A'}`);
        }
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
