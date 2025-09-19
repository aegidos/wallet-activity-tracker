import requests
import csv
import os
from datetime import datetime, timezone
from operator import itemgetter

ADDRESS = '0x939AC38d9ee95e0E01B88086AAb47786F8e61f5f'
API_KEY = os.getenv('REACT_APP_APESCAN_API_KEY')
BASE_URL = 'https://api.apescan.io/api'
OUTPUT_FILE = 'wallet_activity_converted.csv'
ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

# Check if API key is available
if not API_KEY:
    raise ValueError("REACT_APP_APESCAN_API_KEY environment variable is required but not set")

def fetch(url):
    r = requests.get(url)
    return r.json()

# Fetch normal transactions
tx_url = f'{BASE_URL}?module=account&action=txlist&address={ADDRESS}&startblock=0&endblock=99999999&sort=asc&apikey={API_KEY}'
tx_data = fetch(tx_url)

# Fetch NFT transfers
nft_url = f'{BASE_URL}?module=account&action=tokennfttx&address={ADDRESS}&startblock=0&endblock=99999999&sort=asc&apikey={API_KEY}'
nft_data = fetch(nft_url)

# Fetch internal transactions
internal_url = f'{BASE_URL}?module=account&action=txlistinternal&address={ADDRESS}&startblock=0&endblock=99999999&sort=asc&apikey={API_KEY}'
internal_data = fetch(internal_url)

# Fetch token transfers (ERC-20 transfers)
token_url = f'{BASE_URL}?module=account&action=tokentx&address={ADDRESS}&startblock=0&endblock=99999999&sort=asc&apikey={API_KEY}'
token_data = fetch(token_url)

# Build a mapping of transactions
txs_by_hash = {}
if tx_data.get('status') == '1' and isinstance(tx_data['result'], list):
    for tx in tx_data['result']:
        txs_by_hash[tx['hash']] = tx

# Group NFT transfers by transaction hash
nft_by_tx = {}
if nft_data.get('status') == '1' and isinstance(nft_data['result'], list):
    for nft in nft_data['result']:
        tx_hash = nft['hash']
        nft_by_tx.setdefault(tx_hash, []).append(nft)

# Map internal transactions by hash
internal_map = {}
if internal_data.get('status') == '1' and isinstance(internal_data['result'], list):
    for itx in internal_data['result']:
        internal_map.setdefault(itx['hash'], []).append(itx)

# Map token transfers by hash
token_map = {}
if token_data.get('status') == '1' and isinstance(token_data['result'], list):
    for token_tx in token_data['result']:
        token_map.setdefault(token_tx['hash'], []).append(token_tx)

header = [
    "Date (UTC)","Integration Name","Label","Outgoing Asset","Outgoing Amount",
    "Incoming Asset","Incoming Amount","Fee Asset (optional)","Fee Amount (optional)",
    "Comment (optional)","Trx. ID (optional)"
]

rows = []

# Process normal transactions 
if tx_data.get('status') == '1' and isinstance(tx_data['result'], list):
    for tx in tx_data['result']:
        date_utc = datetime.fromtimestamp(int(tx['timeStamp']), tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        date_obj = datetime.fromtimestamp(int(tx['timeStamp']), tz=timezone.utc)
        
        # Label as Payment or Deposit
        if tx['from'].lower() == ADDRESS.lower():
            label = 'Payment'
            outgoing_asset = 'APE'
            outgoing_amount = str(int(tx['value']) / 1e18)
            incoming_asset = ''
            incoming_amount = ''
        else:
            label = 'Deposit'
            outgoing_asset = ''
            outgoing_amount = ''
            incoming_asset = 'APE'
            incoming_amount = str(int(tx['value']) / 1e18)
        
        fee_asset = 'APE'
        gas_price = tx.get('gasPrice') or tx.get('gasPriceBid') or '0'
        try:
            fee_amount = str(int(tx['gasUsed']) * int(gas_price) / 1e18)
        except ValueError:
            fee_amount = ''
        
        rows.append([
            date_utc, '', label, outgoing_asset, outgoing_amount,
            incoming_asset, incoming_amount, fee_asset, fee_amount, '', tx['hash'], 
            date_obj  # For sorting
        ])

# Process token transfers (ERC-20)
if token_data.get('status') == '1' and isinstance(token_data['result'], list):
    # Only process token transfers that aren't part of NFT transactions
    processed_tx_hashes = set()
    for token_tx in token_data['result']:
        tx_hash = token_tx['hash']
        
        # Skip if this is part of an NFT transaction - we'll handle it in the NFT section
        if tx_hash in nft_by_tx:
            continue
            
        date_utc = datetime.fromtimestamp(int(token_tx['timeStamp']), tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        date_obj = datetime.fromtimestamp(int(token_tx['timeStamp']), tz=timezone.utc)
        
        # To prevent duplicate entries for the same transaction
        if tx_hash in processed_tx_hashes:
            continue
        processed_tx_hashes.add(tx_hash)
            
        # Process ERC-20 transfers
        token_symbol = token_tx['tokenSymbol']
        token_decimals = int(token_tx['tokenDecimal'])
        
        if token_tx['from'].lower() == ADDRESS.lower():
            label = 'Payment'
            outgoing_asset = token_symbol
            outgoing_amount = str(int(token_tx['value']) / (10**token_decimals))
            incoming_asset = ''
            incoming_amount = ''
        else:
            label = 'Deposit'
            outgoing_asset = ''
            outgoing_amount = ''
            incoming_asset = token_symbol
            incoming_amount = str(int(token_tx['value']) / (10**token_decimals))
        
        fee_asset = 'APE'
        fee_amount = ''
        
        rows.append([
            date_utc, '', label, outgoing_asset, outgoing_amount,
            incoming_asset, incoming_amount, fee_asset, fee_amount, '', tx_hash, 
            date_obj  # For sorting
        ])

# Process NFT transfers - first identify burn transactions
burn_transactions = {}
burned_token_ids = set()  # Track all burned NFTs
if nft_data.get('status') == '1' and isinstance(nft_data['result'], list):
    # First pass: identify potential burn/mint pairs
    # Group by time windows (look for burns followed by mints within 2 minutes)
    outgoing_by_time = {}
    incoming_by_time = {}
    
    for nft in nft_data['result']:
        timestamp = int(nft['timeStamp'])
        # Round to nearest minute to group related transactions
        time_key = timestamp // 60
        
        if nft['from'].lower() == ADDRESS.lower():
            # This is an outgoing NFT (potential burn)
            outgoing_by_time.setdefault(time_key, []).append(nft)
        elif nft['to'].lower() == ADDRESS.lower() and nft['from'].lower() == ZERO_ADDRESS.lower():
            # This is an incoming mint
            incoming_by_time.setdefault(time_key, []).append(nft)
    
    # Look for burns followed by mints within a short time window
    for time_key, outgoing_nfts in outgoing_by_time.items():
        # Check nearby time windows for mints (within 2 minutes)
        nearby_mints = []
        for i in range(time_key, time_key + 3):  # Check current minute and next 2 minutes
            if i in incoming_by_time:
                nearby_mints.extend(incoming_by_time[i])
        
        # If we found both outgoing NFTs and nearby mints, consider it a burn
        if outgoing_nfts and nearby_mints:
            # Group by transaction hash if they're in the same tx
            for nft in outgoing_nfts:
                tx_hash = nft['hash']
                
                # Mark this NFT as burned to prevent it being processed as a sale
                burned_token_ids.add((nft['tokenName'], nft['tokenID']))
                
                # If there are mints in the same transaction, pair them directly
                same_tx_mints = [m for m in nearby_mints if m['hash'] == tx_hash]
                if same_tx_mints:
                    burn_transactions[tx_hash] = {
                        'burned': [nft for nft in outgoing_nfts if nft['hash'] == tx_hash],
                        'minted': same_tx_mints
                    }
                else:
                    # Otherwise, create a separate "burn" entry
                    # Find the closest mint transaction in time
                    closest_mint_tx = min(nearby_mints, 
                                        key=lambda m: abs(int(m['timeStamp']) - int(nft['timeStamp'])))
                    mint_tx_hash = closest_mint_tx['hash']
                    
                    # Group all mints from this transaction
                    related_mints = [m for m in nearby_mints if m['hash'] == mint_tx_hash]
                    
                    # Create a synthetic transaction ID by combining both
                    synthetic_tx_id = f"{tx_hash}_{mint_tx_hash}"
                    
                    burn_transactions[synthetic_tx_id] = {
                        'burned': [nft],
                        'minted': related_mints,
                        'burn_tx': tx_hash,
                        'mint_tx': mint_tx_hash,
                        'is_synthetic': True
                    }

# Process NFT transfers
if nft_data.get('status') == '1' and isinstance(nft_data['result'], list):
    for nft in nft_data['result']:
        tx_hash = nft['hash']
        date_utc = datetime.fromtimestamp(int(nft['timeStamp']), tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        date_obj = datetime.fromtimestamp(int(nft['timeStamp']), tz=timezone.utc)
        
        # Skip if this is part of a burn transaction
        is_part_of_burn = False
        for burn_tx_id, burn_data in burn_transactions.items():
            # Check if this NFT is in the burned list
            if nft['from'].lower() == ADDRESS.lower():
                for burned in burn_data['burned']:
                    if burned['tokenID'] == nft['tokenID'] and burned['tokenName'] == nft['tokenName']:
                        is_part_of_burn = True
                        break
            # Check if this NFT is in the minted list
            elif nft['to'].lower() == ADDRESS.lower() and nft['from'].lower() == ZERO_ADDRESS.lower():
                for minted in burn_data['minted']:
                    if minted['tokenID'] == nft['tokenID'] and minted['tokenName'] == nft['tokenName']:
                        is_part_of_burn = True
                        break
            if is_part_of_burn:
                break
                
        if is_part_of_burn:
            continue
        
        # Additional check using the burned_token_ids set
        if nft['from'].lower() == ADDRESS.lower() and (nft['tokenName'], nft['tokenID']) in burned_token_ids:
            continue
            
        if nft['from'].lower() == ADDRESS.lower():
            # This is an NFT Sale (since we've filtered out burns)
            label = 'NFT Sale'
            outgoing_asset = nft['tokenName']
            outgoing_amount = '1'
            incoming_asset = 'APE'  # Default currency
            incoming_amount = '0'
            
            # Detect currency and payment from token transfers first
            payment_currency = None
            payment_amount = None
            
            # Check token transfers for this transaction
            if tx_hash in token_map:
                incoming_tokens = [
                    tx for tx in token_map[tx_hash]
                    if tx['to'].lower() == ADDRESS.lower()
                ]
                
                if incoming_tokens:
                    # Use the first incoming token transfer as payment
                    token_tx = incoming_tokens[0]
                    payment_currency = token_tx['tokenSymbol']
                    token_decimals = int(token_tx['tokenDecimal'])
                    payment_amount = int(token_tx['value']) / (10**token_decimals)
            
            # If no token transfer found, check internal transactions
            if payment_amount is None and tx_hash in internal_map:
                our_internal_txs = [
                    itx for itx in internal_map[tx_hash]
                    if itx['to'].lower() == ADDRESS.lower()
                ]
                
                # If there's exactly one internal tx per NFT in this batch,
                # use the corresponding one
                batch_nfts = [n for n in nft_by_tx.get(tx_hash, []) 
                             if n['from'].lower() == ADDRESS.lower()]
                
                if len(our_internal_txs) == len(batch_nfts):
                    # Match NFT to payment by position in the batch
                    idx = batch_nfts.index(nft)
                    if idx < len(our_internal_txs):
                        payment_amount = int(our_internal_txs[idx]['value']) / 1e18
                        comment = f"Token ID: {nft['tokenID']} (Specific sale amount)"
                else:
                    # Just sum all incoming value and divide by number of NFTs
                    total_ape = sum(int(itx['value']) for itx in our_internal_txs) / 1e18
                    # If multiple NFTs but single payment, try to estimate individual price
                    if len(batch_nfts) > 0:
                        payment_amount = total_ape / len(batch_nfts)
                        comment = f"Token ID: {nft['tokenID']} (Estimated sale from batch)"
                    else:
                        payment_amount = total_ape
                        comment = f"Token ID: {nft['tokenID']} (Batch sale)"
            else:
                comment = f"Token ID: {nft['tokenID']}"
            
            # Set the payment details
            if payment_currency:
                incoming_asset = payment_currency
            
            if payment_amount is not None:
                incoming_amount = str(payment_amount)
            
            fee_asset = 'APE'
            fee_amount = ''
        else:
            # Skip if from zero address and part of a burn transaction
            if nft['from'].lower() == ZERO_ADDRESS.lower() and tx_hash in burn_transactions:
                continue
                
            # This is an NFT Purchase
            label = 'NFT Purchase'
            incoming_asset = nft['tokenName']
            incoming_amount = '1'
            outgoing_asset = 'APE'  # Default currency
            outgoing_amount = ''
            fee_asset = 'APE'
            fee_amount = ''
            
            # Find individual purchase price and currency for this NFT
            purchase_price = None
            purchase_currency = None
            
            # Method 1: Check if there are token transfers for this transaction
            if tx_hash in token_map:
                our_token_txs = [
                    tx for tx in token_map[tx_hash]
                    if tx['from'].lower() == ADDRESS.lower()
                ]
                
                batch_nfts = [n for n in nft_by_tx.get(tx_hash, []) 
                             if n['to'].lower() == ADDRESS.lower()]
                
                # If there's any token transfer, use that as the currency
                if our_token_txs:
                    # Use the first outgoing token's currency
                    purchase_currency = our_token_txs[0]['tokenSymbol']
                    decimals = int(our_token_txs[0].get('tokenDecimal', '18'))
                    
                    # If exact match between token transfers and NFTs
                    if len(our_token_txs) == len(batch_nfts):
                        idx = batch_nfts.index(nft)
                        if idx < len(our_token_txs):
                            token_tx = our_token_txs[idx]
                            purchase_price = int(token_tx['value']) / (10 ** decimals)
                    else:
                        # Sum all outgoing token transfers for the total payment
                        # This handles cases like WAPE payments split into fees, royalties, and seller payment
                        total_paid = sum(int(tx['value']) for tx in our_token_txs) / (10 ** decimals)
                        purchase_price = total_paid / len(batch_nfts) if len(batch_nfts) > 0 else total_paid
            
            # Method 2: Check if there's a payment transaction (APE native currency)
            if purchase_price is None and purchase_currency is None and tx_hash in txs_by_hash:
                payment_tx = txs_by_hash[tx_hash]
                if payment_tx['from'].lower() == ADDRESS.lower():
                    batch_nfts = [n for n in nft_by_tx.get(tx_hash, []) 
                                 if n['to'].lower() == ADDRESS.lower()]
                    if len(batch_nfts) > 0:
                        purchase_price = int(payment_tx['value']) / 1e18 / len(batch_nfts)
                        purchase_currency = 'APE'
            
            # Method 3: Check internal transactions
            if purchase_price is None and purchase_currency is None and tx_hash in internal_map:
                our_internal_payments = [
                    itx for itx in internal_map[tx_hash]
                    if itx['from'].lower() == ADDRESS.lower()
                ]
                
                batch_nfts = [n for n in nft_by_tx.get(tx_hash, []) 
                             if n['to'].lower() == ADDRESS.lower()]
                
                if our_internal_payments:
                    purchase_currency = 'APE'  # Internal txs are in native currency
                    
                    if len(our_internal_payments) == len(batch_nfts):
                        idx = batch_nfts.index(nft)
                        if idx < len(our_internal_payments):
                            purchase_price = int(our_internal_payments[idx]['value']) / 1e18
                    elif len(our_internal_payments) > 0 and len(batch_nfts) > 0:
                        # Sum payments and divide by NFT count
                        total_payment = sum(int(itx['value']) for itx in our_internal_payments) / 1e18
                        purchase_price = total_payment / len(batch_nfts)
            
            # Set the outgoing asset to the detected currency
            if purchase_currency:
                outgoing_asset = purchase_currency
                
            # Set the outgoing amount to the purchase price
            if purchase_price is not None:
                outgoing_amount = str(purchase_price)
            
            # Generate comment with token ID information
            comment = f"Token ID: {nft['tokenID']}"
            batch_nfts = len(nft_by_tx.get(tx_hash, []))
            if batch_nfts > 1:
                comment += f" (Part of batch purchase of {batch_nfts} NFTs)"
            
            # For specific known transactions, hardcode the price and currency
            if tx_hash.lower() == "0x85cbfecf9e5097cc83b7d01bf554cb59038fd7ecbb90fe31500526b314b34e65".lower():
                outgoing_asset = "APE"
                outgoing_amount = "17"
            
            # For the specific Goblin transaction
            if tx_hash.lower() == "0x450278a4f1a857295cd4264117d4bfbe2906cc00d946864a6f18f8851faf069d".lower():
                outgoing_asset = "GEM"
                outgoing_amount = "1000"
        
        rows.append([
            date_utc, '', label, outgoing_asset, outgoing_amount,
            incoming_asset, incoming_amount, fee_asset, fee_amount, comment, tx_hash,
            date_obj  # For sorting
        ])

# Process burn transactions
for tx_hash, burn_data in burn_transactions.items():
    # Get a timestamp from one of the NFTs in this transaction
    date_obj = None
    for nft in burn_data['burned'] + burn_data['minted']:
        date_obj = datetime.fromtimestamp(int(nft['timeStamp']), tz=timezone.utc)
        break
    
    if date_obj:
        date_utc = date_obj.strftime('%Y-%m-%d %H:%M:%S')
        
        # Create a conversion entry
        burned_nfts = ", ".join([f"{n['tokenName']} ID:{n['tokenID']}" for n in burn_data['burned']])
        minted_nfts = ", ".join([f"{n['tokenName']} ID:{n['tokenID']}" for n in burn_data['minted']])
        
        label = 'NFT Conversion'
        outgoing_asset = burned_nfts
        outgoing_amount = str(len(burn_data['burned']))
        incoming_asset = minted_nfts
        incoming_amount = str(len(burn_data['minted']))
        fee_asset = 'APE'
        fee_amount = ''
        
        # Add a more descriptive comment for synthetic transactions
        if burn_data.get('is_synthetic'):
            comment = f"Burned {len(burn_data['burned'])} NFTs in tx {burn_data['burn_tx'][:8]}... and received {len(burn_data['minted'])} NFTs in tx {burn_data['mint_tx'][:8]}..."
        else:
            comment = f"Burned {len(burn_data['burned'])} NFTs to mint {len(burn_data['minted'])} new NFTs"
        
        rows.append([
            date_utc, '', label, outgoing_asset, outgoing_amount,
            incoming_asset, incoming_amount, fee_asset, fee_amount, comment, tx_hash,
            date_obj  # For sorting
        ])

# Sort all rows by date
rows.sort(key=itemgetter(-1))
rows = [row[:-1] for row in rows]  # Remove date objects

with open(OUTPUT_FILE, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(header)
    writer.writerows(rows)

print(f"Data written to {OUTPUT_FILE}, sorted by date")