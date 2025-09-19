# Supabase Database Setup

## Prerequisites
- Supabase project created at https://supabase.com
- Environment variables configured in `.env` file

## Database Setup

1. **Create the Table**
   - Go to your Supabase dashboard
   - Navigate to SQL Editor
   - Run the SQL script from `database/schema.sql`

2. **Configure Row Level Security (Optional)**
   - If you need access control, uncomment and modify the RLS policies in the schema
   - For development, you can start without RLS enabled

## Environment Variables

Make sure your `.env` file contains:
```
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

## Data Structure

Each portfolio snapshot contains:
- `wallet_address`: The wallet being analyzed
- `total_value_usd`: Complete portfolio value in USD
- `token_value_usd`: Value from tokens only
- `staked_ape_value_usd`: Value from staked APE tokens
- `nft_value_usd`: Value from NFT collection floor prices
- `ape_price_usd`: Current APE token price
- `staked_ape_amount`: Amount of APE tokens staked
- `network_breakdown`: JSON object with values per network
- `snapshot_timestamp`: When this snapshot was taken

## Usage

The application automatically inserts portfolio data whenever:
- The total portfolio value changes by more than $0.01
- Token prices are updated
- NFT values are recalculated
- Staking amounts change

## Querying Data

Example queries you can run in Supabase SQL Editor:

```sql
-- Get latest portfolio snapshot for a wallet
SELECT * FROM portfolio_snapshots 
WHERE wallet_address = '0x...' 
ORDER BY snapshot_timestamp DESC 
LIMIT 1;

-- Get portfolio history over time
SELECT 
    snapshot_timestamp,
    total_value_usd,
    token_value_usd,
    nft_value_usd
FROM portfolio_snapshots 
WHERE wallet_address = '0x...'
ORDER BY snapshot_timestamp ASC;

-- Get average portfolio values
SELECT 
    wallet_address,
    AVG(total_value_usd) as avg_total_value,
    COUNT(*) as snapshot_count
FROM portfolio_snapshots 
GROUP BY wallet_address;
```