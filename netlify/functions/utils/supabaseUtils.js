// Supabase utilities for Netlify Functions
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client for server-side operations
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Get all NFT collections from the database
 * @returns {Array} Array of collection objects
 */
export const getAllNftCollections = async () => {
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
        return data;
        
    } catch (error) {
        console.error('❌ Failed to fetch NFT collections:', error);
        throw error;
    }
};

/**
 * Update floor price data for multiple collections
 * @param {Array} floorPriceData - Array of floor price objects
 * @returns {Object} Update results
 */
export const updateFloorPrices = async (floorPriceData) => {
    try {
        console.log(`💾 Updating floor prices for ${floorPriceData.length} collections...`);
        
        const updatePromises = floorPriceData.map(async (priceData) => {
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
                return { success: false, collection: priceData.collectionName, error };
            }
            
            console.log(`✅ Updated ${priceData.collectionName}: ${priceData.floorPrice} ${priceData.currency} ($${priceData.floorPriceUSD?.toFixed(2) || 'N/A'})`);
            return { success: true, collection: priceData.collectionName, data };
        });
        
        const results = await Promise.all(updatePromises);
        
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        console.log(`\n💾 Database Update Summary:`);
        console.log(`   ✅ Successfully updated: ${successful} collections`);
        console.log(`   ❌ Failed to update: ${failed} collections`);
        
        return {
            successful,
            failed,
            results
        };
        
    } catch (error) {
        console.error('❌ Failed to update floor prices:', error);
        throw error;
    }
};

/**
 * Get collections that haven't been updated recently (for prioritization)
 * @param {number} hoursAgo - Consider collections stale if not updated in this many hours
 * @returns {Array} Array of stale collections
 */
export const getStaleCollections = async (hoursAgo = 24) => {
    try {
        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - hoursAgo);
        
        console.log(`🕰️ Finding collections not updated since ${cutoffTime.toISOString()}...`);
        
        const { data, error } = await supabase
            .from('nft_collections')
            .select('contract_address, collection_name, network, last_floor_price_update')
            .or(`last_floor_price_update.is.null,last_floor_price_update.lt.${cutoffTime.toISOString()}`)
            .order('last_floor_price_update', { nullsFirst: true });
        
        if (error) {
            console.error('❌ Error fetching stale collections:', error);
            throw error;
        }
        
        console.log(`📊 Found ${data.length} collections needing price updates`);
        return data;
        
    } catch (error) {
        console.error('❌ Failed to fetch stale collections:', error);
        throw error;
    }
};

/**
 * Log execution statistics to help monitor the scheduled function
 * @param {Object} stats - Execution statistics
 */
export const logExecutionStats = async (stats) => {
    try {
        console.log('\n📈 Execution Statistics:');
        console.log(`   🕒 Execution time: ${stats.executionTime}ms`);
        console.log(`   📊 Collections processed: ${stats.collectionsProcessed}`);
        console.log(`   ✅ Successful updates: ${stats.successfulUpdates}`);
        console.log(`   ❌ Failed updates: ${stats.failedUpdates}`);
        console.log(`   🌐 API requests made: ${stats.apiRequests}`);
        console.log(`   ⚡ Average request time: ${(stats.executionTime / stats.apiRequests).toFixed(0)}ms`);
        
        // Could optionally store these stats in a monitoring table
        // await supabase.from('execution_logs').insert([stats]);
        
    } catch (error) {
        console.warn('⚠️ Failed to log execution stats:', error);
    }
};