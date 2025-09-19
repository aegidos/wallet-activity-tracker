-- Supabase SQL Schema for Portfolio Snapshots
-- Run this in your Supabase SQL Editor to create the table

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id BIGSERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    total_value_usd DECIMAL(20, 2) NOT NULL,
    token_value_usd DECIMAL(20, 2) NOT NULL DEFAULT 0,
    staked_ape_value_usd DECIMAL(20, 2) NOT NULL DEFAULT 0,
    nft_value_usd DECIMAL(20, 2) NOT NULL DEFAULT 0,
    ape_price_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,
    staked_ape_amount DECIMAL(20, 6) NOT NULL DEFAULT 0,
    network_breakdown JSONB,
    snapshot_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_portfolio_wallet_address ON portfolio_snapshots(wallet_address);
CREATE INDEX IF NOT EXISTS idx_portfolio_timestamp ON portfolio_snapshots(snapshot_timestamp);
CREATE INDEX IF NOT EXISTS idx_portfolio_wallet_timestamp ON portfolio_snapshots(wallet_address, snapshot_timestamp);

-- Enable Row Level Security (RLS) if needed
-- ALTER TABLE portfolio_snapshots ENABLE ROW LEVEL SECURITY;

-- Example policy to allow inserts (adjust based on your security needs)
-- CREATE POLICY "Allow portfolio inserts" ON portfolio_snapshots
--     FOR INSERT WITH CHECK (true);

-- Example policy to allow reads (adjust based on your security needs)  
-- CREATE POLICY "Allow portfolio reads" ON portfolio_snapshots
--     FOR SELECT USING (true);

-- Example query to view recent portfolio snapshots
-- SELECT 
--     wallet_address,
--     total_value_usd,
--     token_value_usd,
--     staked_ape_value_usd,
--     nft_value_usd,
--     snapshot_timestamp
-- FROM portfolio_snapshots 
-- ORDER BY snapshot_timestamp DESC 
-- LIMIT 10;