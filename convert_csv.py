import pandas as pd

# Load your original CSV
df = pd.read_csv("export-transaction-list-1752131224241.csv")

# Prepare the new DataFrame with your desired columns
new_df = pd.DataFrame({
    "Date (UTC)": df["DateTime (UTC)"],
    "Integration Name": "",  # You can fill this based on logic or leave blank
    "Label": df["Method"].replace({
        "Deposit": "Deposit",
        "Withdrawal": "Withdrawal",
        "Trade": "Trade",
        "Buy Goobs": "Trade",
        "Mint": "Mint",
        "Mint To": "Mint",
        "Mint Public": "Mint",
        "Set Approval For All": "Approval",
        "Transfer": "Transfer",
        "Transfer From": "Transfer",
        "Cancel": "Cancel",
        "Fulfill Advanced Order": "Trade",
        "Match Advanced Orders": "Trade",
        "Unpack": "Unpack"
    }),
    "Outgoing Asset": "",  # Needs logic based on Method or From/To
    "Outgoing Amount": "", # Needs logic based on Amount
    "Incoming Asset": "",  # Needs logic based on Method or To
    "Incoming Amount": "", # Needs logic based on Amount
    "Fee Asset (optional)": "APE",  # Assuming all fees are in APE
    "Fee Amount (optional)": df["Txn Fee"],
    "Comment (optional)": "",
    "Trx. ID (optional)": df["Transaction Hash"]
})

# Save to new CSV
new_df.to_csv("converted_transactions.csv", index=False)
print("Converted CSV saved as converted_transactions.csv")