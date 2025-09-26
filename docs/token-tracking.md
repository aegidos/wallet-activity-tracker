# Token Tracking System

This system automatically tracks tokens across different blockchains and updates their prices periodically.

## Components

1. **Token Insertion**: Tokens discovered during wallet analysis are saved to the database
2. **GitHub Action**: A workflow runs every 2 hours to update token prices
3. **Supabase Database**: Stores token information and current prices

## Setup Instructions

### 1. Create the Tokens Table

Run the following command to see the SQL needed to create the tokens table:

```bash
node scripts/create-tokens-table.js
```

Copy the displayed SQL and run it in your Supabase SQL Editor.

### 2. Fix RLS Policies (if needed)

If you encounter permission errors, run:

```bash
node scripts/fix-rls-policies.js
```

Follow the instructions to update the Row Level Security policies in Supabase.

### 3. Test Token Insertion

Verify that token insertion works correctly:

```bash
node scripts/test-token-insertion.js
```

If successful, you'll see a confirmation message.

### 4. Set Up GitHub Secrets

In your GitHub repository, add the following secrets:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous API key

### 5. Enable GitHub Actions

The workflow file is already set up to run every 2 hours. You can also manually trigger the workflow from the Actions tab in your GitHub repository.

## Troubleshooting

### Token Insertion Errors

- **PGRST204 error**: The table schema is incorrect. Run the create-tokens-table.js script.
- **42501 error**: RLS policy issue. Run the fix-rls-policies.js script.

### Price Update Errors

Check the GitHub Actions logs for detailed error information.

## Manual Price Updates

You can manually update token prices by running:

```bash
node scripts/update-token-prices.js
```

## Architecture

- **WalletAnalyzer.js**: Discovers tokens and saves them to the database
- **supabase.js**: Contains utility functions for database operations
- **update-token-prices.js**: Fetches current prices from DEXScreener API
- **GitHub Action**: Runs the price update script automatically

## Database Schema

The tokens table has the following structure:

```sql
CREATE TABLE public.tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  network TEXT NOT NULL,
  decimals INTEGER DEFAULT 18,
  user_id UUID REFERENCES auth.users(id),
  current_price DECIMAL,
  price_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(contract_address, network)
);
```