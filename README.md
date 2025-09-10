# Wallet Activity Tracker

A Python script to fetch and analyze wallet activity from ApeScan API, including NFT purchases, sales, and profit/loss calculations.

## Features

- Fetches wallet transactions, NFT transfers, and token transfers
- Identifies NFT purchases and sales
- Detects burn/mint transactions for NFT conversions
- Calculates profit/loss for NFT trades
- Handles WAPE/APE currency equivalence
- Exports data to CSV format compatible with tax software

## Files

- `fetch_wallet_activity.py` - Main script to fetch wallet data from ApeScan API
- `profit_loss.py` - Script to calculate profit/loss from the exported data

## Setup

1. Install required packages:
```bash
pip install requests pandas
```

2. Update the wallet address and API key in `fetch_wallet_activity.py`:
```python
ADDRESS = 'your_wallet_address_here'
API_KEY = 'your_apescan_api_key_here'
```

## Usage

1. Run the main script to fetch wallet activity:
```bash
python fetch_wallet_activity.py
```

2. Run the profit/loss analysis:
```bash
python profit_loss.py
```

The scripts will generate CSV files with the processed data.

## Notes

- The script is specifically designed for ApeScan API (ApeChain)
- WAPE and APE are treated as equivalent currencies
- NFT burn/mint pairs are automatically detected and grouped as conversions
