-- Update nft_collections table to include floor price tracking
-- Add floor price columns to existing table

ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS floor_price_eth DECIMAL(18,8);
ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS floor_price_usd DECIMAL(12,2);
ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS floor_price_currency VARCHAR(10);
ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS last_floor_price_update TIMESTAMPTZ;
ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS magic_eden_slug VARCHAR(200);
ALTER TABLE nft_collections ADD COLUMN IF NOT EXISTS network VARCHAR(50) DEFAULT 'ethereum';

-- Add index for efficient querying by last update time
CREATE INDEX IF NOT EXISTS idx_nft_collections_last_update ON nft_collections(last_floor_price_update);

-- Add index for network filtering
CREATE INDEX IF NOT EXISTS idx_nft_collections_network ON nft_collections(network);

-- Update RLS policies to allow updates to floor price data
-- Drop policy if it exists, then create it
DROP POLICY IF EXISTS "Allow floor price updates" ON nft_collections;
CREATE POLICY "Allow floor price updates" ON nft_collections
    FOR UPDATE USING (true);

-- Comments for documentation
COMMENT ON COLUMN nft_collections.floor_price_eth IS 'Current floor price in ETH (or native currency)';
COMMENT ON COLUMN nft_collections.floor_price_usd IS 'Current floor price in USD';
COMMENT ON COLUMN nft_collections.floor_price_currency IS 'Currency symbol (ETH, APE, etc.)';
COMMENT ON COLUMN nft_collections.last_floor_price_update IS 'Timestamp of last successful floor price fetch';
COMMENT ON COLUMN nft_collections.magic_eden_slug IS 'Magic Eden collection slug identifier';
COMMENT ON COLUMN nft_collections.network IS 'Blockchain network (ethereum, apechain, etc.)';

-- =====================================================
-- WATCHED WALLETS TABLE
-- =====================================================

-- Create watched_wallets table for storing user watchlists
CREATE TABLE IF NOT EXISTS watched_wallets (
    id BIGSERIAL PRIMARY KEY,
    user_wallet VARCHAR(42) NOT NULL, -- Glyph connected wallet address
    watched_address VARCHAR(42) NOT NULL, -- Address being watched
    label VARCHAR(100), -- Optional user-defined label
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_wallet, watched_address) -- Prevent duplicate entries
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_watched_wallets_user ON watched_wallets(user_wallet);
CREATE INDEX IF NOT EXISTS idx_watched_wallets_address ON watched_wallets(watched_address);
CREATE INDEX IF NOT EXISTS idx_watched_wallets_created ON watched_wallets(created_at);

-- Enable Row Level Security
ALTER TABLE watched_wallets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for watched_wallets table
-- Users can only access their own watchlist entries
CREATE POLICY "Users can view own watchlist" ON watched_wallets
    FOR SELECT USING (true); -- Allow all reads for now (can be restricted later)

CREATE POLICY "Users can insert own watchlist" ON watched_wallets
    FOR INSERT WITH CHECK (true); -- Allow all inserts for now

CREATE POLICY "Users can update own watchlist" ON watched_wallets
    FOR UPDATE USING (true); -- Allow all updates for now

CREATE POLICY "Users can delete own watchlist" ON watched_wallets
    FOR DELETE USING (true); -- Allow all deletes for now

-- Create trigger function for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_watched_wallets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at column
DROP TRIGGER IF EXISTS trigger_update_watched_wallets_updated_at ON watched_wallets;
CREATE TRIGGER trigger_update_watched_wallets_updated_at
    BEFORE UPDATE ON watched_wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_watched_wallets_updated_at();

-- Comments for documentation
COMMENT ON TABLE watched_wallets IS 'Stores wallet addresses that users want to monitor';
COMMENT ON COLUMN watched_wallets.user_wallet IS 'Glyph connected wallet address (owner of the watchlist)';
COMMENT ON COLUMN watched_wallets.watched_address IS 'Wallet address being monitored';
COMMENT ON COLUMN watched_wallets.label IS 'Optional user-defined label for the watched wallet';
COMMENT ON COLUMN watched_wallets.created_at IS 'Timestamp when the entry was created';
COMMENT ON COLUMN watched_wallets.updated_at IS 'Timestamp when the entry was last updated';