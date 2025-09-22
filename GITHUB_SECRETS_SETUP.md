# GitHub Repository Secrets Setup

## Required Secrets for Floor Price Update Action

You need to add these secrets to your GitHub repository for the floor price update workflow to work:

### 🔐 How to Add Secrets:

1. **Go to your GitHub repository**: https://github.com/aegidos/wallet-activity-tracker
2. **Navigate to Settings** → **Secrets and variables** → **Actions**
3. **Click "New repository secret"** for each secret below

### 📋 Required Secrets:

#### 1. `SUPABASE_URL`
- **Name**: `SUPABASE_URL`
- **Value**: Your Supabase project URL (e.g., `https://your-project-id.supabase.co`)
- **Source**: Found in your Supabase dashboard → Settings → API

#### 2. `SUPABASE_ANON_KEY`
- **Name**: `SUPABASE_ANON_KEY`
- **Value**: Your Supabase anonymous/public API key
- **Source**: Found in your Supabase dashboard → Settings → API
- **Note**: This should be the `anon` key, not the `service_role` key

### 🔍 How to Find Your Supabase Credentials:

1. Go to [supabase.com](https://supabase.com) and sign in
2. Select your project
3. Go to **Settings** → **API**
4. Copy the **Project URL** for `SUPABASE_URL`
5. Copy the **anon public** key for `SUPABASE_ANON_KEY`

### ✅ Verification:

After adding the secrets, you can test the workflow by:

1. **Manual trigger**: Go to **Actions** → **Update NFT Floor Prices** → **Run workflow**
2. **Check logs**: The workflow will show detailed logs of the floor price update process
3. **Verify database**: Check your Supabase `nft_collections` table for updated floor prices

### 🚨 Security Notes:

- Never commit these values to your code
- The `anon` key is safe to use in GitHub Actions (it respects your RLS policies)
- These secrets are encrypted and only available to your repository's workflows

### 📅 Schedule:

The workflow will run automatically every hour at minute 0 (e.g., 1:00 PM, 2:00 PM, etc.)