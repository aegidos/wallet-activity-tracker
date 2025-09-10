import pandas as pd
import re

# Load the CSV file
df = pd.read_csv('wallet_activity_converted.csv')

# Add profit and loss columns, initialize with 0
df['profit'] = 0.0
df['loss'] = 0.0

# Create a dictionary to track NFT purchases
nft_purchases = {}

# First pass: Identify NFT purchases
for i, row in df.iterrows():
    if row['Label'] == 'NFT Purchase':
        # Extract token ID from the comment
        token_id = None
        if isinstance(row['Comment (optional)'], str) and "Token ID:" in row['Comment (optional)']:
            token_id = row['Comment (optional)'].split("Token ID:")[1].split()[0].strip()
        
        # Create a unique key for this NFT
        nft_key = f"{row['Incoming Asset']}_ID_{token_id}" if token_id else row['Incoming Asset']
        
        # Get purchase amount from Outgoing Amount column
        purchase_amount = 0
        purchase_currency = row['Outgoing Asset']  # Store the currency too
        
        if row['Outgoing Amount'] and row['Outgoing Amount'] != '':
            try:
                purchase_amount = float(row['Outgoing Amount'])
            except ValueError:
                purchase_amount = 0
        
        # Store purchase details
        nft_purchases[nft_key] = {
            'purchase_amount': purchase_amount,
            'purchase_currency': purchase_currency,
            'purchase_index': i,
            'hash': row['Trx. ID (optional)']
        }

# Second pass: Match sales with purchases and calculate profit/loss
for i, row in df.iterrows():
    if row['Label'] == 'NFT Sale':
        # Extract token ID from the comment
        token_id = None
        if isinstance(row['Comment (optional)'], str) and "Token ID:" in row['Comment (optional)']:
            token_id = row['Comment (optional)'].split("Token ID:")[1].split()[0].strip()
        
        # Create a unique key for this NFT
        nft_key = f"{row['Outgoing Asset']}_ID_{token_id}" if token_id else row['Outgoing Asset']
        
        # Get sale amount and currency
        sale_amount = 0
        sale_currency = row['Incoming Asset']
        
        if row['Incoming Amount'] and row['Incoming Amount'] != '':
            try:
                sale_amount = float(row['Incoming Amount'])
            except ValueError:
                sale_amount = 0
        
        # Check if we have a record of purchasing this NFT
        if nft_key in nft_purchases and nft_purchases[nft_key]['purchase_amount'] > 0:
            # We have a valid purchase record
            purchase_info = nft_purchases[nft_key]
            purchase_amount = purchase_info['purchase_amount']
            purchase_currency = purchase_info['purchase_currency']
            
            # Normalize currencies - treat WAPE and APE as the same (APE)
            normalized_purchase_currency = 'APE' if purchase_currency == 'WAPE' else purchase_currency
            normalized_sale_currency = 'APE' if sale_currency == 'WAPE' else sale_currency
            
            # Check if the normalized currencies match
            if normalized_purchase_currency == normalized_sale_currency:
                # Same currency (including WAPE/APE equivalence) - calculate profit/loss as normal
                if sale_amount > purchase_amount:
                    profit = sale_amount - purchase_amount
                    df.at[i, 'profit'] = profit
                    current_comment = row['Comment (optional)'] if pd.notnull(row['Comment (optional)']) else ""
                    df.at[i, 'Comment (optional)'] = f"{current_comment} (Purchase: {purchase_amount:.4f} {purchase_currency}, Profit: {profit:.4f} APE)"
                else:
                    loss = purchase_amount - sale_amount
                    df.at[i, 'loss'] = loss
                    current_comment = row['Comment (optional)'] if pd.notnull(row['Comment (optional)']) else ""
                    df.at[i, 'Comment (optional)'] = f"{current_comment} (Purchase: {purchase_amount:.4f} {purchase_currency}, Loss: {loss:.4f} APE)"
            else:
                # Different currencies - set profit and loss to zero
                df.at[i, 'profit'] = 0
                df.at[i, 'loss'] = 0
                current_comment = row['Comment (optional)'] if pd.notnull(row['Comment (optional)']) else ""
                df.at[i, 'Comment (optional)'] = f"{current_comment} (Purchase: {purchase_amount:.4f} {purchase_currency}, Sale: {sale_amount:.4f} {sale_currency} - Different currencies, no profit/loss calculated)"
        else:
            # No purchase record found or purchase price is 0 or invalid
            # Check if this is a stablecoin or token with value
            if sale_currency in ['APE', 'WAPE', 'GEM', 'ETH', 'WETH']:
                # Treat as gifted/minted/airdropped - full sale amount is profit
                df.at[i, 'profit'] = sale_amount
                current_comment = row['Comment (optional)'] if pd.notnull(row['Comment (optional)']) else ""
                df.at[i, 'Comment (optional)'] = f"{current_comment} (No purchase record found, treated as gifted/minted - full sale of {sale_amount:.4f} {sale_currency} is profit)"
            else:
                # For other types of tokens, don't assume profit
                df.at[i, 'profit'] = 0
                current_comment = row['Comment (optional)'] if pd.notnull(row['Comment (optional)']) else ""
                df.at[i, 'Comment (optional)'] = f"{current_comment} (No purchase record found, unknown currency {sale_currency})"

# Final pass: Add summary totals
total_profit = df['profit'].sum()
total_loss = df['loss'].sum()
net_profit = total_profit - total_loss

# Add a summary row
summary = pd.DataFrame({
    'Date (UTC)': ['Summary'],
    'Integration Name': [''],
    'Label': ['Total'],
    'Outgoing Asset': [''],
    'Outgoing Amount': [''],
    'Incoming Asset': [''],
    'Incoming Amount': [''],
    'Fee Asset (optional)': [''],
    'Fee Amount (optional)': [''],
    'Comment (optional)': [f'Total Profit: {total_profit:.4f}, Total Loss: {total_loss:.4f}, Net Profit/Loss: {net_profit:.4f}'],
    'Trx. ID (optional)': [''],
    'profit': [total_profit],
    'loss': [total_loss]
})

df = pd.concat([df, summary], ignore_index=True)

# Save the updated DataFrame to a new CSV file
df.to_csv('wallet_activity_with_profit_loss.csv', index=False)

print("Analysis complete. New file saved as 'wallet_activity_with_profit_loss.csv'")
print(f"Total Profit: {total_profit:.4f}")
print(f"Total Loss: {total_loss:.4f}")
print(f"Net Profit/Loss: {net_profit:.4f}")