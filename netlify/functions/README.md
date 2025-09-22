# NFT Floor Price Tracking - Netlify Scheduled Functions

This directory contains the Netlify Scheduled Function that automatically updates NFT collection floor prices every hour.

## Overview

The `update-floor-prices` function:
- Runs every hour (configured in `netlify.toml`)
- Fetches all NFT collections from the `nft_collections` table
- Retrieves current floor prices from Magic Eden API
- Updates the database with the latest floor price data
- Respects Magic Eden's rate limits (2 requests/second)

## Database Schema

The `nft_collections` table has been extended with floor price tracking columns:

```sql
-- New columns added:
floor_price_eth DECIMAL(18,8)        -- Floor price in native currency (ETH/APE)
floor_price_usd DECIMAL(12,2)        -- Floor price in USD
floor_price_currency VARCHAR(10)     -- Currency symbol (ETH, APE, etc.)
last_floor_price_update TIMESTAMPTZ  -- Last successful update timestamp
magic_eden_slug VARCHAR(200)         -- Magic Eden collection identifier
network VARCHAR(50)                  -- Blockchain network (ethereum, apechain)
```

## File Structure

```
netlify/functions/
├── update-floor-prices.js           # Main scheduled function
├── utils/
│   ├── floorPriceUtils.js          # Magic Eden API utilities
│   └── supabaseUtils.js            # Database operations
```

## Configuration

### Environment Variables
The function uses the same environment variables as the main app:
- `REACT_APP_SUPABASE_URL` or `SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY` or `SUPABASE_ANON_KEY`

### Schedule Configuration
In `netlify.toml`:
```toml
[[functions]]
  name = "update-floor-prices"
  schedule = "0 * * * *"  # Every hour at minute 0
```

## How It Works

1. **Collection Discovery**: Fetches all unique contract addresses from `nft_collections` table
2. **Prioritization**: Processes collections that haven't been updated recently first
3. **API Requests**: Makes rate-limited requests to Magic Eden API (2/second)
4. **Price Conversion**: Converts ETH prices to USD using current ETH price
5. **Database Updates**: Updates floor price columns with new data
6. **Monitoring**: Logs execution statistics and success/failure rates

## Monitoring

The function logs detailed execution information:
- Collections processed
- Successful vs failed updates
- API request count and timing
- Total execution time

## Rate Limiting

Respects Magic Eden's rate limits:
- Maximum 2 requests per second
- 500ms delay between requests
- Batch processing with failure handling

## Local Testing

To test the function locally:

```javascript
// In update-floor-prices.js, uncomment the bottom section:
if (process.env.NODE_ENV === 'development') {
    handler({}, {}).then(result => console.log('Test result:', result));
}
```

Then run:
```bash
node netlify/functions/update-floor-prices.js
```

## Error Handling

The function is designed to be resilient:
- Continues processing even if individual collections fail
- Returns success even with partial failures
- Logs detailed error information for debugging
- Uses fallback values when external APIs fail

## Performance Considerations

- Processes collections in series to respect rate limits
- Prioritizes stale collections (not updated in 6+ hours)
- Uses efficient batch database updates
- Includes execution time monitoring

## Future Enhancements

Potential improvements:
- Add support for more NFT marketplaces (OpenSea, Blur, etc.)
- Implement exponential backoff for failed requests
- Add Slack/Discord notifications for monitoring
- Store historical floor price data for trend analysis
- Add collection popularity metrics from Magic Eden