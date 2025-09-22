// Netlify Scheduled Function - Update NFT Floor Prices
// Runs every hour to fetch and update floor prices for all collections

import { fetchMultipleFloorPrices, convertPricesToUSD } from './utils/floorPriceUtils.js';
import { getAllNftCollections, updateFloorPrices, getStaleCollections, logExecutionStats } from './utils/supabaseUtils.js';

export async function handler(event, context) {
    const startTime = Date.now();
    console.log('\n🚀 Starting Scheduled Floor Price Update');
    console.log(`⏰ Execution time: ${new Date().toISOString()}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    
    try {
        // Step 1: Get all collections from database
        // Prioritize stale collections (not updated in last 6 hours) but process all if time allows
        let collections = await getStaleCollections(6);
        
        if (collections.length === 0) {
            console.log('✅ All collections are up to date, fetching all collections for routine update...');
            collections = await getAllNftCollections();
        }
        
        if (collections.length === 0) {
            console.log('🤷 No NFT collections found in database');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'No collections to process',
                    collections: 0
                })
            };
        }
        
        console.log(`📊 Processing ${collections.length} collections for floor price updates`);
        
        // Step 2: Fetch floor prices from Magic Eden API
        const { results: floorPriceResults, failures, requestCount } = await fetchMultipleFloorPrices(collections);
        
        if (floorPriceResults.length === 0) {
            console.warn('⚠️ No successful floor price fetches');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'No floor prices fetched successfully',
                    apiRequests: requestCount,
                    failures: failures.length
                })
            };
        }
        
        // Step 3: Convert prices to USD where needed
        const pricesWithUSD = await convertPricesToUSD(floorPriceResults);
        
        // Step 4: Update database with new floor prices
        const updateResults = await updateFloorPrices(pricesWithUSD);
        
        // Step 5: Log execution statistics
        const executionTime = Date.now() - startTime;
        const stats = {
            executionTime,
            collectionsProcessed: collections.length,
            successfulUpdates: updateResults.successful,
            failedUpdates: updateResults.failed,
            apiRequests: requestCount,
            timestamp: new Date().toISOString()
        };
        
        await logExecutionStats(stats);
        
        // Step 6: Return success response
        console.log(`\n🎉 Floor price update completed successfully in ${executionTime}ms`);
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: true,
                message: 'Floor prices updated successfully',
                stats: {
                    executionTime: `${executionTime}ms`,
                    collectionsProcessed: collections.length,
                    successfulUpdates: updateResults.successful,
                    failedUpdates: updateResults.failed,
                    apiRequests: requestCount
                },
                timestamp: new Date().toISOString()
            })
        };
        
    } catch (error) {
        console.error('❌ Floor price update failed:', error);
        
        const executionTime = Date.now() - startTime;
        
        // Log the error but don't throw it (so Netlify doesn't mark the function as failed)
        console.error(`💥 Function failed after ${executionTime}ms:`, error.message);
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                success: false,
                error: error.message,
                executionTime: `${executionTime}ms`,
                timestamp: new Date().toISOString()
            })
        };
    }
}

// For local testing
if (process.env.NODE_ENV === 'development') {
    // Uncomment to test locally:
    // handler({}, {}).then(result => console.log('Test result:', result));
}