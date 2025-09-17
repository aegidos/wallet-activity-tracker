# Copilot Instructions: ApeChain Wallet Analyzer

## Project Overview
This is a React-based multi-chain wallet analysis tool focused on ApeChain/Ethereum ecosystems. It fetches wallet data, analyzes NFT/token portfolios, calculates profit/loss from transactions, and provides comprehensive portfolio visualization.

## Architecture & Key Components

### Core Structure
- **App.js**: Main wallet connection flow (MetaMask + manual address input)
- **WalletAnalyzer.js**: 4000-line monolithic component handling all analysis logic
- **Python Scripts**: Data processing utilities (`fetch_wallet_activity.py`, `profit_loss.py`)
- **Build System**: Webpack-based with custom browser polyfills for crypto libraries

### Multi-Network Integration
The app supports 4 networks via Alchemy SDK:
```javascript
// Network initialization pattern
const initializeAlchemySDK = (network) => {
    switch (network) {
        case 'ethereum': return Network.ETH_MAINNET;
        case 'apechain': return 'apechain-mainnet'; // Custom network
        case 'bnb': return Network.BNB_MAINNET;
        case 'solana': return Network.SOLANA_MAINNET;
    }
};
```

## Critical Development Patterns

### 1. TON Provider Error Suppression
The app has extensive TON wallet error handling due to browser extension conflicts:
```javascript
// Global TON provider protection at module level
if (typeof window !== 'undefined') {
    // Proxy-based error suppression for window.ton
    // Console error filtering for TON-related messages
}
```

### 2. API Rate Limiting Strategy
Magic Eden API integration requires strict rate limiting:
```javascript
const RATE_LIMIT_DELAY = 500; // 500ms = 2 requests per second
// Always await delay(RATE_LIMIT_DELAY) between sequential API calls
// Use individual collection queries with `id` parameter, limit=20
```

### 3. Network-Aware API Endpoints
Floor price fetching uses network-specific Magic Eden endpoints:
```javascript
// Conditional endpoint selection based on NFT collection network
const apiEndpoint = network === 'apechain' 
    ? 'https://api-mainnet.magiceden.dev/v3/rtp/apechain/collections/v7'
    : 'https://api-mainnet.magiceden.dev/v3/rtp/ethereum/collections/v7';
```

### 4. State Management Pattern
Complex nested state with network-specific organization:
```javascript
const [tokenBalances, setTokenBalances] = useState({
    ethereum: [], apechain: [], bnb: [], solana: []
});
const [nativeBalances, setNativeBalances] = useState({
    ethereum: 0, apechain: 0, bnb: 0, solana: 0
});
```

## Development Workflows

### Build & Development
```bash
npm run dev        # Webpack dev server on port 3000
npm run build      # Production build to dist/
npm start          # Same as dev but with --open flag
```

### Key Environment Variables
```bash
REACT_APP_APESCAN_API_KEY=8AIZVW9PAGT3UY6FCGRZFDJ51SZGDIG13X  # ApeChain explorer
NEXT_PUBLIC_ALCHEMY_API_KEY=Lx58kkNIJtKmG_mSohRWLvxzxJj_iNW-   # Multi-chain data
```

### Python Data Processing
```bash
python fetch_wallet_activity.py  # Raw transaction fetching
python profit_loss.py            # P&L calculations
python convert_csv.py            # Data format conversion
```

## Critical Code Conventions

### 1. Duplicate NFT Handling
When processing NFT collections, preserve first occurrence only:
```javascript
// Track seen NFTs to eliminate duplicates while preserving original
const seenNfts = new Set();
const duplicateNfts = new Set();
// Only add to nfts array if not seen before
```

### 2. Price Fallback Hierarchy
Token pricing uses cascading price sources:
1. Alchemy SDK prices (highest priority)
2. External APIs (CryptoCompare, Binance)
3. Magic Eden for NFT floor prices
4. Native token prices from Binance

### 3. Error Boundary Patterns
```javascript
// Comprehensive try-catch with user-friendly error messages
try {
    // API calls with retry logic
} catch (error) {
    setError('Failed to fetch X: ' + error.message);
    console.error('Detailed error context:', error);
}
```

### 4. Network Badge Styling
UI uses color-coded network identification:
```javascript
backgroundColor: network.name === 'ethereum' ? '#627eea' : '#ff6b35'
// Blue for Ethereum, Orange for ApeChain
```

## External API Integrations

### Magic Eden API
- **Rate Limit**: 2 requests/second maximum
- **Endpoint Pattern**: `/v3/rtp/{network}/collections/v7?id={contract}&limit=20`
- **Networks**: ethereum, apechain
- **Authentication**: None required for floor price queries

### Alchemy SDK
- **Multi-network**: ETH, ApeChain, BNB, Solana
- **Key Methods**: `getTokenBalances()`, `getNftsForOwner()`, `getBalance()`
- **Rate Limiting**: Built-in, but batch requests when possible

### ApeScam API
- **Base URL**: `https://api.apescan.io/api`
- **Key Methods**: `txlist`, `tokennfttx`, `txlistinternal`, `tokentx`
- **Rate Limit**: 2 requests/second, use 1-second delays

## Data Processing Specifics

### Transaction Classification
```javascript
// NFT purchases must exclude transfers
if ((tx.label === 'NFT Purchase' && !tx.isTransfer) || tx.isPaidMint) {
    // Process as purchase with profit/loss tracking
}
```

### Portfolio Value Calculation
```javascript
// Multi-network portfolio total with staking
const totalValue = tokenBalances + nativeBalances + stakedAPE + nftFloorValue;
// Each network calculates separately then aggregates
```

### Sorting & Display
- Default sort: Descending by estimated value
- Table format preferred over card layout for NFT collections
- Include network badges and duplicate indicators

## Common Debugging Areas

1. **TON Provider Errors**: Check console suppression is working
2. **Rate Limiting**: Ensure 500ms delays between API calls
3. **Network Mismatch**: Verify correct Alchemy network constants
4. **NFT Duplicates**: Check deduplication logic preserves first occurrence
5. **Price Fetching**: Validate fallback chain works across price sources

## File Modification Guidelines

- **WalletAnalyzer.js**: 4000+ lines, use semantic search for targeted changes
- **Never edit**: Transaction processing logic without understanding profit/loss implications
- **Always update**: Rate limiting delays when adding new API calls
- **Test thoroughly**: Multi-network functionality across all supported chains