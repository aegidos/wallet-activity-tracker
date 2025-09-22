// Netlify Scheduled Function - Update NFT Floor Prices
// Runs every hour to fetch and update floor prices for all collections

const { schedule } = require('@netlify/functions');
const { fetchMultipleFloorPrices, convertPricesToUSD } = require('./utils/floorPriceUtils');
const { getAllNftCollections, updateFloorPrices, getStaleCollections, logExecutionStats } = require('./utils/supabaseUtils');

const handler = async (event, context) => {
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
        
        // Calculate processing time estimate
        const BATCH_SIZE = 20; // Process 20 collections at a time to stay under 30s timeout
        const TIMEOUT_BUFFER = 5000; // Reserve 5 seconds for database updates
        const MAX_EXECUTION_TIME = 25000; // 25 seconds max for API calls
        
        let allResults = [];
        let allFailures = [];
        let totalRequestCount = 0;
        let processedCount = 0;
        
        // Process collections in batches
        for (let i = 0; i < collections.length; i += BATCH_SIZE) {
            const remainingTime = MAX_EXECUTION_TIME - (Date.now() - startTime);
            
            if (remainingTime < 10000) { // Less than 10 seconds remaining
                console.warn(`⏰ Stopping processing with ${remainingTime}ms remaining to ensure database updates can complete`);
                break;
            }
            
            const batch = collections.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(collections.length / BATCH_SIZE);
            
            console.log(`\n🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} collections)`);
            
            // Step 2: Fetch floor prices from Magic Eden API for this batch
            const { results: batchResults, failures: batchFailures, requestCount: batchRequestCount } = await fetchMultipleFloorPrices(batch);
            
            allResults.push(...batchResults);
            allFailures.push(...batchFailures);
            totalRequestCount += batchRequestCount;
            processedCount += batch.length;
            
            console.log(`✅ Batch ${batchNumber} complete: ${batchResults.length}/${batch.length} successful`);
            
            // If this isn't the last batch, update database immediately to avoid timeout
            if (batchResults.length > 0 && (i + BATCH_SIZE < collections.length || Date.now() - startTime > 20000)) {
                console.log(`💾 Updating database for batch ${batchNumber}...`);
                
                // Step 3: Convert prices to USD where needed
                const pricesWithUSD = await convertPricesToUSD(batchResults);
                
                // Step 4: Update database with new floor prices
                const batchUpdateResults = await updateFloorPrices(pricesWithUSD);
                console.log(`✅ Batch ${batchNumber} database update: ${batchUpdateResults.successful} successful, ${batchUpdateResults.failed} failed`);
            }
        }
        
        // Final database update for any remaining results
        const floorPriceResults = allResults;
        
        if (floorPriceResults.length === 0) {
            console.warn('⚠️ No successful floor price fetches');
            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    message: 'No floor prices fetched successfully',
                    apiRequests: totalRequestCount,
                    failures: allFailures.length,
                    processedCount: processedCount
                })
            };
        }
        
        // Final batch processing (if any results weren't updated yet)
        let updateResults = { successful: 0, failed: 0, results: [] };
        
        if (floorPriceResults.length > 0) {
            console.log(`\n💾 Final database update for remaining ${floorPriceResults.length} results...`);
            
            // Step 3: Convert prices to USD where needed
            const pricesWithUSD = await convertPricesToUSD(floorPriceResults);
            
            // Step 4: Update database with new floor prices
            updateResults = await updateFloorPrices(pricesWithUSD);
        }
        
        // Step 5: Log execution statistics
        const executionTime = Date.now() - startTime;
        const stats = {
            executionTime,
            collectionsProcessed: processedCount,
            totalCollections: collections.length,
            successfulFetches: allResults.length,
            failedFetches: allFailures.length,
            successfulUpdates: updateResults.successful,
            failedUpdates: updateResults.failed,
            apiRequests: totalRequestCount,
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
                message: `Floor price update completed successfully`,
                stats: stats,
                executionTimeMs: executionTime,
                totalCollections: collections.length,
                processedCollections: processedCount,
                successfulFetches: allResults.length,
                failedFetches: allFailures.length,
                successfulUpdates: updateResults.successful,
                failedUpdates: updateResults.failed,
                apiRequests: totalRequestCount
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

// Export the scheduled handler
exports.handler = schedule("0 * * * *", handler);

// For local testing
if (process.env.NODE_ENV === 'development') {
    // Uncomment to test locally:
    // handler({}, {}).then(result => console.log('Test result:', result));
}