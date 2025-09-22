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