# Token Price Update System

This system automatically fetches and updates cryptocurrency token prices from DEXScreener every two hours. It manages a database of tokens found in users' wallets and keeps their prices updated.

## How It Works

1. **Token Discovery**: The system scans all wallet snapshots in Supabase to identify unique tokens.
2. **Token Database**: All discovered tokens are stored in a dedicated `tokens` table.
3. **Price Updates**: Every two hours, a GitHub Actions workflow fetches current market prices from DEXScreener.

## Setup Instructions

### 1. Create the Tokens Table in Supabase

Run the `setup-tokens-table.js` script to see the SQL needed to create the tokens table:

```bash
node scripts/setup-tokens-table.js
```

Then, copy the displayed SQL and execute it in your Supabase SQL editor.

### 2. Configure GitHub Secrets

For the automated workflow to function, add these secrets to your GitHub repository:

- `REACT_APP_SUPABASE_URL`: Your Supabase project URL
- `REACT_APP_SUPABASE_ANON_KEY`: Your Supabase anonymous key

### 3. Test the Token Price Update

You can manually test the token price update script:

```bash
node scripts/update-token-prices.js
```

## GitHub Workflow

The automated workflow (`update-token-prices.yml`) runs every 2 hours and:

1. Checks out the repository
2. Sets up Node.js
3. Installs dependencies
4. Creates a temporary .env file with Supabase credentials
5. Runs the token price update script

You can also trigger this workflow manually from the GitHub Actions tab.

## Tokens Table Schema

The tokens table has the following structure:

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| contract_address | TEXT | Token contract address |
| network | TEXT | Network (ethereum, bnb, etc.) |
| symbol | TEXT | Token symbol |
| name | TEXT | Token name |
| price_usd | DECIMAL | Current price in USD |
| last_updated | TIMESTAMP | Last price update time |
| dex | TEXT | DEX where price was sourced |
| dex_network | TEXT | Network of the DEX |
| liquidity_usd | DECIMAL | Token liquidity in USD |
| volume_24h | DECIMAL | 24-hour trading volume |

## Integrating with Your App

You can use the token prices in your application by querying the tokens table:

```javascript
const { data: tokenPrices } = await supabase
  .from('tokens')
  .select('contract_address, network, price_usd')
  .in('contract_address', [addresses])  // Filter by specific addresses
```

This provides up-to-date token prices without needing to call external APIs for each request.