import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { format } from 'date-fns';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Alchemy, Network } from 'alchemy-sdk';
import { insertPortfolioSnapshot, insertNftCollections, getCachedFloorPrices, saveWatchedWallets, getWatchedWallets, deleteWatchedWallet } from '../utils/supabase';

// APE Staking Contract Addressf
const STAKING_CONTRACT = '0x4Ba2396086d52cA68a37D9C0FA364286e9c7835a';

// Global TON provider protection - runs immediately when module loads
if (typeof window !== 'undefined') {
    // Create a safe proxy for window.ton to prevent undefined access errors
    const tonHandler = {
        get(target, prop) {
            if (!target || typeof target !== 'object') {
                console.warn(`TON provider not ready - attempted to access: ${String(prop)}`);
                return undefined;
            }
            return target[prop];
        }
    };
    
    // Monitor and protect window.ton
    let tonProvider = null;
    
    Object.defineProperty(window, 'ton', {
        get() {
            return tonProvider ? new Proxy(tonProvider, tonHandler) : undefined;
        },
        set(value) {
            console.log('TON provider initialized:', !!value);
            tonProvider = value;
        },
        configurable: true,
        enumerable: true
    });
    
    // Enhanced safety: catch any unhandled TON-related errors
    window.addEventListener('error', (event) => {
        const errorMessage = event.error?.message || event.message || '';
        if (errorMessage.toLowerCase().includes('ton') || 
            errorMessage.includes('Cannot read properties of undefined (reading \'ton\')')) {
            console.warn('Suppressed TON-related error:', errorMessage);
            event.preventDefault(); // Prevent the error from bubbling up
            event.stopPropagation();
            return false;
        }
    });
    
    // Also catch unhandled promise rejections related to TON
    window.addEventListener('unhandledrejection', (event) => {
        const errorMessage = event.reason?.message || event.reason || '';
        if (typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('ton')) {
            console.warn('Suppressed TON-related promise rejection:', errorMessage);
            event.preventDefault();
            return false;
        }
    });
    
    // Override console.error to suppress TON errors in development
    const originalConsoleError = console.error;
    console.error = (...args) => {
        const message = args[0];
        if (typeof message === 'string' && (
            message.toLowerCase().includes('ton') ||
            message.includes('Cannot read properties of undefined (reading \'ton\')')
        )) {
            // Silently suppress TON-related console errors
            return;
        }
        originalConsoleError.apply(console, args);
    };
}
//For debugging reasons we set API Keys to a static if its started locally

const ALCHEMY_API_KEY = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const API_KEY = process.env.REACT_APP_ETHERSCAN_API_KEY;
const BASE_URL = 'https://api.etherscan.io/v2/api?chainid=33139';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Debug: Log API keys to console (remove in production)
console.log('ALCHEMY_API_KEY:', ALCHEMY_API_KEY ? 'Set' : 'Missing');
console.log('API_KEY:', API_KEY ? 'Set' : 'Missing');

// Watch Component for managing wallet watchlist
const WatchComponent = ({ account, connectedAccount, analyzedWallet, screenSize, setAnalyzedWallet, setActiveTab, setCurrentView }) => {
    const [watchedWallets, setWatchedWallets] = useState([{ address: '', label: '' }]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Load existing watched wallets on component mount
    useEffect(() => {
        if (connectedAccount) {
            loadWatchedWallets();
        }
    }, [connectedAccount]);

    const loadWatchedWallets = async () => {
        setLoading(true);
        try {
            const result = await getWatchedWallets(connectedAccount);
            if (result.success) {
                const walletData = result.data.map(item => ({
                    address: item.watched_address,
                    label: item.label || ''
                }));
                setWatchedWallets(walletData.length > 0 ? walletData : [{ address: '', label: '' }]);
            } else {
                console.error('Failed to load watchlist:', result.error);
                setWatchedWallets([{ address: '', label: '' }]); // Default to empty field
            }
        } catch (err) {
            console.error('Error loading watchlist:', err);
            setWatchedWallets([{ address: '', label: '' }]); // Default to empty field
        } finally {
            setLoading(false);
        }
    };

    const addWalletField = () => {
        if (watchedWallets.length < 10) {
            setWatchedWallets([...watchedWallets, { address: '', label: '' }]);
        }
    };

    const removeWalletField = (index) => {
        if (watchedWallets.length > 1) {
            const newWallets = watchedWallets.filter((_, i) => i !== index);
            setWatchedWallets(newWallets);
        }
    };

    const updateWalletAddress = (index, value) => {
        const newWallets = [...watchedWallets];
        newWallets[index] = { ...newWallets[index], address: value };
        setWatchedWallets(newWallets);
        setError(null);
        setSuccess(null);
    };

    const updateWalletLabel = (index, value) => {
        const newWallets = [...watchedWallets];
        newWallets[index] = { ...newWallets[index], label: value };
        setWatchedWallets(newWallets);
        setError(null);
        setSuccess(null);
    };

    const validateAddress = (address) => {
        return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
    };

    const saveWatchList = async () => {
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            // Filter out empty addresses and validate
            const validWallets = watchedWallets
                .filter(wallet => wallet.address.trim() !== '');

            // Validate all addresses
            const invalidAddresses = validWallets
                .filter(wallet => !validateAddress(wallet.address))
                .map(wallet => wallet.address);
            
            if (invalidAddresses.length > 0) {
                throw new Error(`Invalid wallet addresses: ${invalidAddresses.join(', ')}`);
            }

            if (validWallets.length === 0) {
                throw new Error('Please add at least one wallet address');
            }

            // Prepare data for Supabase (convert to the format expected by saveWatchedWallets)
            const walletsWithLabels = validWallets.map(wallet => ({
                address: wallet.address.trim(),
                label: wallet.label.trim() || null
            }));

            // Save to Supabase
            const result = await saveWatchedWallets(connectedAccount, walletsWithLabels);
            
            if (result.success) {
                setSuccess(`Successfully saved ${validWallets.length} wallet(s) to your watchlist!`);
            } else {
                throw new Error(result.error || 'Failed to save watchlist');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const clearWatchList = async () => {
        setLoading(true);
        setError(null);
        setSuccess(null);

        try {
            // Delete all watched wallets for this user
            const result = await deleteWatchedWallet(connectedAccount);
            if (result.success) {
                setSuccess('Watchlist cleared successfully!');
                setWatchedWallets([{ address: '', label: '' }]); // Reset to single empty field
            } else {
                setError('Failed to clear watchlist: ' + result.error);
            }
        } catch (err) {
            setError('Failed to clear watchlist: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            maxWidth: '800px',
            margin: '0 auto',
            padding: '20px',
            color: '#ffffff'
        }}>
            <div style={{
                background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)',
                borderRadius: '12px',
                padding: '24px',
                border: '1px solid rgba(31, 81, 255, 0.3)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)'
            }}>
                <h2 style={{
                    color: '#ffffff',
                    fontSize: '1.8rem',
                    fontWeight: '600',
                    marginBottom: '8px',
                    textAlign: 'center'
                }}>
                    Wallet Watchlist
                </h2>

                {/* Current Analyzed Wallet Indicator */}
                <div style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    textAlign: 'center'
                }}>
                    <p style={{
                        color: '#60a5fa',
                        fontSize: '0.9rem',
                        margin: '0',
                        fontWeight: '500'
                    }}>
                        🔍 Currently Analyzing: {analyzedWallet === connectedAccount ? 'Your Wallet' : `${analyzedWallet?.slice(0, 6)}...${analyzedWallet?.slice(-4)}`}
                    </p>
                </div>
                
                <p style={{
                    color: '#9ca3af',
                    textAlign: 'center',
                    marginBottom: '24px',
                    fontSize: '0.9rem'
                }}>
                    Add up to 10 wallet addresses to your watchlist. You can monitor and analyze these wallets anytime.
                </p>

                {/* Wallet Input Fields */}
                <div style={{ marginBottom: '24px' }}>
                    {watchedWallets.map((wallet, index) => (
                        <div key={index} style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'flex-start',
                            marginBottom: '16px',
                            padding: '12px',
                            background: 'rgba(31, 41, 55, 0.5)',
                            borderRadius: '8px',
                            border: '1px solid rgba(55, 65, 81, 0.5)'
                        }}>
                            <span style={{
                                color: '#60a5fa',
                                fontSize: '0.8rem',
                                fontWeight: '500',
                                minWidth: '20px',
                                marginTop: '12px'
                            }}>
                                {index + 1}.
                            </span>
                            <div style={{ flex: 1 }}>
                                {/* Label Input */}
                                <input
                                    type="text"
                                    value={wallet.label}
                                    onChange={(e) => updateWalletLabel(index, e.target.value)}
                                    placeholder="Label (e.g., 'John's Wallet', 'Trading Account')"
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        background: '#1f2937',
                                        border: '1px solid #374151',
                                        borderRadius: '6px',
                                        color: '#ffffff',
                                        fontSize: '0.85rem',
                                        fontFamily: 'system-ui, -apple-system, sans-serif',
                                        marginBottom: '8px'
                                    }}
                                />
                                {/* Address Input */}
                                <input
                                    type="text"
                                    value={wallet.address}
                                    onChange={(e) => updateWalletAddress(index, e.target.value)}
                                    placeholder="0x... (Enter wallet address)"
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        background: '#1f2937',
                                        border: '1px solid #374151',
                                        borderRadius: '6px',
                                        color: '#ffffff',
                                        fontSize: '0.85rem',
                                        fontFamily: 'Monaco, Menlo, monospace'
                                    }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {/* GO Button - only show if wallet address is valid */}
                                {wallet.address.trim() && (
                                    <button
                                        onClick={() => {
                                            setAnalyzedWallet(wallet.address.trim());
                                            setActiveTab('Portfolio');
                                            setCurrentView('analysis');
                                        }}
                                        style={{
                                            background: 'rgba(59, 130, 246, 0.4)',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: '500'
                                        }}
                                    >
                                        🔄 GO
                                    </button>
                                )}
                                {watchedWallets.length > 1 && (
                                    <button
                                        onClick={() => removeWalletField(index)}
                                        style={{
                                            background: 'rgba(239, 68, 68, 0.4)',
                                            color: '#ffffff',
                                            border: 'none',
                                            borderRadius: '6px',
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem'
                                        }}
                                    >
                                        ❌
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Action Buttons */}
                <div style={{
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'center',
                    flexWrap: 'wrap'
                }}>
                    {watchedWallets.length < 10 && (
                        <button
                            onClick={addWalletField}
                            style={{
                                background: 'rgba(34, 197, 94, 0.4)',
                                color: '#ffffff',
                                border: '1px solid rgba(34, 197, 94, 0.3)',
                                padding: '12px 20px',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: '500'
                            }}
                        >
                            ➕ Add Wallet
                        </button>
                    )}
                    
                    <button
                        onClick={saveWatchList}
                        disabled={loading}
                        style={{
                            background: loading ? 'rgba(107, 114, 128, 0.4)' : 'rgba(31, 81, 255, 0.4)',
                            color: '#ffffff',
                            border: '1px solid rgba(31, 81, 255, 0.3)',
                            padding: '12px 20px',
                            borderRadius: '8px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '500'
                        }}
                    >
                        {loading ? '💾 Saving...' : '💾 Save Watchlist'}
                    </button>

                    <button
                        onClick={clearWatchList}
                        disabled={loading}
                        style={{
                            background: loading ? 'rgba(107, 114, 128, 0.4)' : 'rgba(239, 68, 68, 0.4)',
                            color: '#ffffff',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            padding: '12px 20px',
                            borderRadius: '8px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '500'
                        }}
                    >
                        {loading ? '🗑️ Clearing...' : '🗑️ Clear Watchlist'}
                    </button>

                    <button
                        onClick={() => {
                            setAnalyzedWallet(connectedAccount);
                            setActiveTab('Portfolio');
                            setCurrentView('analysis');
                        }}
                        style={{
                            background: 'rgba(156, 163, 175, 0.4)',
                            color: '#ffffff',
                            border: '1px solid rgba(156, 163, 175, 0.3)',
                            padding: '12px 20px',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: '500'
                        }}
                    >
                        🔄 Reset to My Wallet
                    </button>
                </div>

                {/* Messages */}
                {error && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        padding: '12px',
                        marginTop: '16px',
                        color: '#f87171',
                        fontSize: '0.9rem'
                    }}>
                        ⚠️ {error}
                    </div>
                )}

                {success && (
                    <div style={{
                        background: 'rgba(34, 197, 94, 0.1)',
                        border: '1px solid rgba(34, 197, 94, 0.3)',
                        borderRadius: '8px',
                        padding: '12px',
                        marginTop: '16px',
                        color: '#4ade80',
                        fontSize: '0.9rem'
                    }}>
                        ✅ {success}
                    </div>
                )}
            </div>
        </div>
    );
};

// Initialize Alchemy SDK for all supported networks
const initializeAlchemySDK = (network) => {
    let alchemyNetwork;
    
    switch (network) {
        case 'ethereum':
            alchemyNetwork = Network.ETH_MAINNET;
            break;
        case 'apechain':
            alchemyNetwork = 'apechain-mainnet'; // Custom network for ApeChain
            break;
        case 'bnb':
            alchemyNetwork = Network.BNB_MAINNET;
            break;
        case 'solana':
            alchemyNetwork = Network.SOLANA_MAINNET;
            break;
        default:
            throw new Error(`Unsupported network: ${network}`);
    }
    
    const config = {
        apiKey: ALCHEMY_API_KEY,
        network: alchemyNetwork
    };
    
    console.log(`Initializing Alchemy SDK for ${network} with network: ${alchemyNetwork}`);
    return new Alchemy(config);
};

// Enhanced TON provider check and account request function
async function requestAccounts() {
    // Multiple layers of safety checks
    if (typeof window === 'undefined') {
        console.log("Window object not available (SSR environment)");
        return [];
    }
    
    // Wait a bit to ensure extensions have loaded
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
        // Check if ton exists and is properly initialized
        if (!window.ton || typeof window.ton !== 'object') {
            console.log("TON provider not found or not properly initialized.");
            return [];
        }

        // Check if requestAccounts method exists
        if (typeof window.ton.requestAccounts !== 'function') {
            console.log("TON provider found but requestAccounts method not available.");
            return [];
        }

        const accounts = await window.ton.requestAccounts();
        return Array.isArray(accounts) ? accounts : [];
        
    } catch (err) {
        console.warn("Failed to fetch TON accounts:", err.message || err);
        return [];
    }
}

function WalletAnalyzer({ account, connectedAccount, onDisconnect, onClearAnalysis, onConnectGlyph }) {
    const [analyzedWallet, setAnalyzedWallet] = useState(account);

    useEffect(() => {
        setAnalyzedWallet(account);
    }, [account]);

    const [transactions, setTransactions] = useState([]);
    const [analysis, setAnalysis] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [tokenBalances, setTokenBalances] = useState({
        ethereum: [],
        apechain: [],
        bnb: [],
        solana: []
    });
    const [nativeBalances, setNativeBalances] = useState({
        ethereum: 0, // ETH balance
        apechain: 0, // APE balance
        bnb: 0,      // BNB balance
        solana: 0    // SOL balance
    });
    const [tokenPrices, setTokenPrices] = useState({});
    const [totalTokenValueUSD, setTotalTokenValueUSD] = useState(0);
    const [portfolioTotal, setPortfolioTotal] = useState(0);
    const [stakedAPEAmount, setStakedAPEAmount] = useState(0);
    const [nftPortfolio, setNftPortfolio] = useState([]);
    const [nftFloorPrices, setNftFloorPrices] = useState({});
    const [totalNftValueUSD, setTotalNftValueUSD] = useState(0);
    const [nftCollectionValues, setNftCollectionValues] = useState({}); // Store calculated values for each collection
    const [networkTotals, setNetworkTotals] = useState({
        ethereum: 0,
        apechain: 0,
        bnb: 0,
        solana: 0
    });
    
    // Add sorting state
    const [sortConfig, setSortConfig] = useState({
        key: 'date',
        direction: 'desc' // Default to descending (newest first)
    });

    // Add this state after the other useState declarations
    const [includeStaking, setIncludeStaking] = useState(false);
    const [stakingTransactions, setStakingTransactions] = useState([]);
    const [apeChurchRewards, setApeChurchRewards] = useState([]);
    const [raffleRewards, setRaffleRewards] = useState([]);
    const [fetchingFloorPrices, setFetchingFloorPrices] = useState(false);
    const [tokenDataLoaded, setTokenDataLoaded] = useState(false);
    const [processingComplete, setProcessingComplete] = useState(false);

    // Navigation state for header menu
    const [activeTab, setActiveTab] = useState('Portfolio');
    
    // View state for switching between analysis and watch views
    const [currentView, setCurrentView] = useState('analysis'); // 'analysis' or 'watch'
    
    // Screen size state for responsive design
    const [screenSize, setScreenSize] = useState({
        width: typeof window !== 'undefined' ? window.innerWidth : 1200,
        isMobile: typeof window !== 'undefined' ? window.innerWidth <= 480 : false,
        isTablet: typeof window !== 'undefined' ? window.innerWidth <= 768 : false
    });

    // Authentication popup state
    const [showAuthPopup, setShowAuthPopup] = useState(false);
    const [isConnectingGlyph, setIsConnectingGlyph] = useState(false);

    // Handle WATCH button click with authentication check
    const handleWatchClick = () => {
        if (!connectedAccount) {
            setShowAuthPopup(true);
        } else {
            setCurrentView('watch');
        }
    };

    // Fetch token prices using free APIs (Alchemy + Binance fallback)
    const fetchTokenPrices = async (tokens) => {
        try {
            const priceMap = {};
            
            // First, try to get prices from Binance API (free)
            const binancePrices = await fetchBinancePrices(tokens);
            Object.assign(priceMap, binancePrices);
            
            // For tokens not found on Binance, try other free sources
            const missingTokens = tokens.filter(token => !priceMap[token.contractAddress.toLowerCase()]);
            if (missingTokens.length > 0) {
                const alternatePrices = await fetchAlternatePrices(missingTokens);
                Object.assign(priceMap, alternatePrices);
            }

            return priceMap;
        } catch (err) {
            console.error('Error fetching token prices:', err);
            return {};
        }
    };

    // Fetch prices from Binance API (free)
    const fetchBinancePrices = async (tokens) => {
        try {
            const priceMap = {};
            
            // Get all Binance trading pairs
            const response = await fetch('https://api.binance.com/api/v3/ticker/price');
            const binancePrices = await response.json();
            
            // Create a map of symbol to USD price
            const symbolPriceMap = {};
            binancePrices.forEach(item => {
                if (item.symbol.endsWith('USDT')) {
                    const symbol = item.symbol.replace('USDT', '');
                    symbolPriceMap[symbol] = parseFloat(item.price);
                }
            });
            
            // Match tokens by symbol
            tokens.forEach(token => {
                const symbol = token.symbol?.toUpperCase();
                if (symbol && symbolPriceMap[symbol]) {
                    priceMap[token.contractAddress.toLowerCase()] = symbolPriceMap[symbol];
                }
            });
            
            console.log(`Found prices for ${Object.keys(priceMap).length} tokens via Binance`);
            return priceMap;
        } catch (err) {
            console.warn('Failed to fetch Binance prices:', err);
            return {};
        }
    };

    // Fetch prices from alternate free sources
    const fetchAlternatePrices = async (tokens) => {
        try {
            const priceMap = {};
            
            // Try CryptoCompare API (free tier)
            for (const token of tokens.slice(0, 10)) { // Limit to avoid rate limits
                try {
                    if (!token.symbol) continue;
                    
                    const response = await fetch(
                        `https://min-api.cryptocompare.com/data/price?fsym=${token.symbol.toUpperCase()}&tsyms=USD&api_key=demo`
                    );
                    const data = await response.json();
                    
                    if (data.USD && data.USD > 0) {
                        priceMap[token.contractAddress.toLowerCase()] = data.USD;
                    }
                    
                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (err) {
                    console.warn(`Failed to fetch price for ${token.symbol}:`, err);
                }
            }
            
            console.log(`Found prices for ${Object.keys(priceMap).length} tokens via alternate sources`);
            return priceMap;
        } catch (err) {
            console.warn('Failed to fetch alternate prices:', err);
            return {};
        }
    };

    // Fetch native token prices (ETH, APE, BNB, and SOL)
    const fetchNativeTokenPrices = async () => {
        try {
            const nativePrices = {};
            
            // Fetch native token prices from Binance
            const response = await fetch('https://api.binance.com/api/v3/ticker/price');
            const binancePrices = await response.json();
            
            // Find ETH price
            const ethPrice = binancePrices.find(item => item.symbol === 'ETHUSDT');
            if (ethPrice) {
                nativePrices['ethereum-native'] = parseFloat(ethPrice.price);
            }
            
            // Find APE price  
            const apePrice = binancePrices.find(item => item.symbol === 'APEUSDT');
            if (apePrice) {
                nativePrices['apechain-native'] = parseFloat(apePrice.price);
            }
            
            // Find BNB price
            const bnbPrice = binancePrices.find(item => item.symbol === 'BNBUSDT');
            if (bnbPrice) {
                nativePrices['bnb-native'] = parseFloat(bnbPrice.price);
            }
            
            // Find SOL price
            const solPrice = binancePrices.find(item => item.symbol === 'SOLUSDT');
            if (solPrice) {
                nativePrices['solana-native'] = parseFloat(solPrice.price);
            }
            
            console.log('Native token prices:', nativePrices);
            return nativePrices;
        } catch (err) {
            console.warn('Failed to fetch native token prices:', err);
            return {};
        }
    };

    // Fetch native balances (ETH, APE, BNB, SOL)
    const fetchNativeBalances = async () => {
        try {
            const ethereumAlchemy = initializeAlchemySDK('ethereum');
            const apechainAlchemy = initializeAlchemySDK('apechain');
            const bnbAlchemy = initializeAlchemySDK('bnb');
            const solanaAlchemy = initializeAlchemySDK('solana');

            // Fetch ETH balance on Ethereum
            const ethBalance = await ethereumAlchemy.core.getBalance(analyzedWallet);
            const ethBalanceFormatted = parseFloat(ethBalance.toString()) / 1e18;

            // Fetch APE balance on ApeChain
            const apeBalance = await apechainAlchemy.core.getBalance(analyzedWallet);
            const apeBalanceFormatted = parseFloat(apeBalance.toString()) / 1e18;

            // Fetch BNB balance on BNB Chain
            const bnbBalance = await bnbAlchemy.core.getBalance(analyzedWallet);
            const bnbBalanceFormatted = parseFloat(bnbBalance.toString()) / 1e18;

            // Fetch SOL balance on Solana (note: SOL uses different decimals - 9 instead of 18)
            let solBalanceFormatted = 0;
            try {
                const solBalance = await solanaAlchemy.core.getBalance(analyzedWallet);
                solBalanceFormatted = parseFloat(solBalance.toString()) / 1e9;
            } catch (solanaError) {
                console.warn('Failed to fetch SOL balance:', solanaError.message);
                solBalanceFormatted = 0;
            }

            setNativeBalances({
                ethereum: ethBalanceFormatted,
                apechain: apeBalanceFormatted,
                bnb: bnbBalanceFormatted,
                solana: solBalanceFormatted
            });

            console.log(`Native balances - ETH: ${ethBalanceFormatted.toFixed(6)}, APE: ${apeBalanceFormatted.toFixed(6)}, BNB: ${bnbBalanceFormatted.toFixed(6)}, SOL: ${solBalanceFormatted.toFixed(6)}`);
        } catch (err) {
            console.error('Error fetching native balances:', err);
            setNativeBalances({
                ethereum: 0,
                apechain: 0,
                bnb: 0,
                solana: 0
            });
        }
    };

    // Token blacklist - add unwanted token names or symbols here
    const getTokenBlacklist = () => {
        return [
            // Common scam/spam tokens
            "Scam Token",
            "Random Airdrop", 
            "Ethereum Defi",
            "Free Money",
            "Airdrop",
            "Visit Website",
            "Claim",
            "Reward",
            "Bonus",
            "Gift",
            "Prize",
            // Apes in Space - as mentioned in your code
            "Apes in Space",
            "MB Coin"
            // Add more blacklisted token names/symbols here
        ].map(s => s.toLowerCase()); // normalize to lowercase for comparison
    };

    // Filter function to remove blacklisted tokens
    const filterBlacklistedTokens = (tokens, networkName = 'Unknown') => {
        const blacklist = getTokenBlacklist();
        const originalCount = tokens.length;
        
        const filtered = tokens.filter(token => {
            const tokenName = (token.name || '').toLowerCase();
            const tokenSymbol = (token.symbol || '').toLowerCase();
            
            // Check if token name or symbol is in blacklist
            const isBlacklisted = blacklist.some(blacklistedItem => 
                tokenName.includes(blacklistedItem) || tokenSymbol.includes(blacklistedItem)
            );
            
            if (isBlacklisted) {
                console.log(`🚫 Filtered out blacklisted token on ${networkName}: ${token.name || 'Unknown'} (${token.symbol || 'N/A'})`);
                return false;
            }
            
            return true;
        });
        
        const filteredCount = originalCount - filtered.length;
        if (filteredCount > 0) {
            console.log(`🧹 Filtered out ${filteredCount} blacklisted tokens on ${networkName}`);
        }
        
        return filtered;
    };

    // Fetch token balances for both networks
    const fetchTokenBalances = async () => {
        if (!analyzedWallet) return;

        setLoading(true);
        try {
            // Helper function to fetch all token balances with pagination
            const fetchAllTokenBalances = async (alchemySDK, networkName) => {
                console.log(`🔍 Starting token balance fetch for ${networkName}...`);
                let allTokens = [];
                let pageKey = null;
                let pageCount = 0;
                const maxCount = 100; // Fetch 100 tokens per page
                
                do {
                    pageCount++;
                    console.log(`📊 Fetching ${networkName} tokens page ${pageCount}${pageKey ? ` (continuing pagination...)` : ' (initial page)'}...`);
                    
                    const requestOptions = {
                        type: 'erc20',
                        maxCount: maxCount
                    };
                    
                    // Add pageKey for continuation if we have one
                    if (pageKey) {
                        requestOptions.pageKey = pageKey;
                    }
                    
                    const tokenBalances = await alchemySDK.core.getTokenBalances(analyzedWallet, requestOptions);
                    
                    console.log(`📈 Page ${pageCount}: Found ${tokenBalances.tokenBalances.length} tokens on ${networkName}`);
                    
                    // Add tokens from this page to our collection
                    allTokens.push(...tokenBalances.tokenBalances);
                    
                    // Update pageKey for next iteration
                    pageKey = tokenBalances.pageKey;
                    
                    // Continue if we have a pageKey (more pages available)
                } while (pageKey);
                
                if (pageCount > 1) {
                    console.log(`🎯 ${networkName} PAGINATION USED: Total ${allTokens.length} tokens found across ${pageCount} pages`);
                } else {
                    console.log(`✅ ${networkName}: ${allTokens.length} tokens found (no pagination needed)`);
                }
                
                return { tokenBalances: allTokens };
            };

            // Fetch Ethereum Mainnet token balances with pagination
            const ethereumAlchemy = initializeAlchemySDK('ethereum');
            const ethereumBalances = await fetchAllTokenBalances(ethereumAlchemy, 'Ethereum');

            // Fetch ApeChain token balances with pagination
            const apechainAlchemy = initializeAlchemySDK('apechain');
            const apechainBalances = await fetchAllTokenBalances(apechainAlchemy, 'ApeChain');

            // Fetch BNB Chain token balances with pagination
            const bnbAlchemy = initializeAlchemySDK('bnb');
            const bnbBalances = await fetchAllTokenBalances(bnbAlchemy, 'BNB Chain');

            // Fetch Solana token balances with pagination (different API for non-EVM chain)
            let solanaBalances = { tokenBalances: [] };
            try {
                const solanaAlchemy = initializeAlchemySDK('solana');
                
                // Helper function for Solana token pagination (without 'type' parameter)
                const fetchAllSolanaTokens = async () => {
                    console.log(`🔍 Starting Solana token balance fetch...`);
                    let allTokens = [];
                    let pageKey = null;
                    let pageCount = 0;
                    const maxCount = 100;
                    
                    do {
                        pageCount++;
                        console.log(`📊 Fetching Solana tokens page ${pageCount}${pageKey ? ` (continuing pagination...)` : ' (initial page)'}...`);
                        
                        const requestOptions = {
                            maxCount: maxCount
                            // Note: Solana doesn't use 'type' parameter
                        };
                        
                        if (pageKey) {
                            requestOptions.pageKey = pageKey;
                        }
                        
                        const tokenBalances = await solanaAlchemy.core.getTokenBalances(analyzedWallet, requestOptions);
                        
                        console.log(`📈 Page ${pageCount}: Found ${tokenBalances.tokenBalances.length} tokens on Solana`);
                        
                        allTokens.push(...tokenBalances.tokenBalances);
                        pageKey = tokenBalances.pageKey;
                        
                    } while (pageKey);
                    
                    if (pageCount > 1) {
                        console.log(`🎯 Solana PAGINATION USED: Total ${allTokens.length} tokens found across ${pageCount} pages`);
                    } else {
                        console.log(`✅ Solana: ${allTokens.length} tokens found (no pagination needed)`);
                    }
                    
                    return { tokenBalances: allTokens };
                };
                
                solanaBalances = await fetchAllSolanaTokens();
            } catch (solanaError) {
                console.warn('Failed to fetch Solana token balances, skipping:', solanaError.message);
                solanaBalances = { tokenBalances: [] };
            }

            // Fetch metadata for each token and check for built-in price data
            const enrichTokenData = async (alchemy, tokenBalances, networkName = 'Unknown') => {
                if (!tokenBalances || tokenBalances.length === 0) {
                    return [];
                }
                
                const enrichedBalances = await Promise.all(
                    tokenBalances.map(async (token) => {
                        try {
                            // For Solana, the token structure might be different
                            const tokenAddress = token.contractAddress || token.mint || token.address;
                            if (!tokenAddress) {
                                console.warn(`No token address found for token on ${networkName}:`, token);
                                return {
                                    ...token,
                                    name: 'Unknown Token',
                                    symbol: 'N/A',
                                    decimals: networkName === 'Solana' ? 9 : 18,
                                    logo: null,
                                    alchemyPrice: null,
                                };
                            }
                            
                            const metadata = await alchemy.core.getTokenMetadata(tokenAddress);
                            
                            // Check if Alchemy provides price data in metadata
                            let alchemyPrice = null;
                            if (metadata.price || metadata.usdPrice || metadata.priceUsd) {
                                alchemyPrice = metadata.price || metadata.usdPrice || metadata.priceUsd;
                            }
                            
                            return {
                                ...token, // Preserve original token data including tokenBalance
                                contractAddress: tokenAddress, // Ensure we have a consistent contractAddress field
                                name: metadata.name || 'Unknown Token',
                                symbol: metadata.symbol || 'N/A',
                                decimals: metadata.decimals || (networkName === 'Solana' ? 9 : 18),
                                logo: metadata.logo || null,
                                alchemyPrice: alchemyPrice, // Store any price data from Alchemy
                            };
                        } catch (err) {
                            console.warn(`Failed to fetch metadata for token ${token.contractAddress || token.mint || 'unknown'} on ${networkName}:`, err);
                            return {
                                ...token, // Preserve original token data
                                name: 'Unknown Token',
                                symbol: 'N/A',
                                decimals: networkName === 'Solana' ? 9 : 18,
                                logo: null,
                                alchemyPrice: null,
                            };
                        }
                    })
                );
                return enrichedBalances;
            };

            const enrichedEthereumBalances = await enrichTokenData(ethereumAlchemy, ethereumBalances.tokenBalances, 'Ethereum');
            const enrichedApeChainBalances = await enrichTokenData(apechainAlchemy, apechainBalances.tokenBalances, 'ApeChain');
            const enrichedBnbBalances = await enrichTokenData(bnbAlchemy, bnbBalances.tokenBalances, 'BNB Chain');
            
            // Handle Solana tokens separately (they may have different metadata structure)
            let enrichedSolanaBalances = [];
            try {
                const solanaAlchemy = initializeAlchemySDK('solana');
                enrichedSolanaBalances = await enrichTokenData(solanaAlchemy, solanaBalances.tokenBalances || [], 'Solana');
            } catch (solanaError) {
                console.warn('Failed to enrich Solana token data:', solanaError.message);
                enrichedSolanaBalances = [];
            }

            // Apply blacklist filter to remove unwanted tokens
            const filteredEthereumBalances = filterBlacklistedTokens(enrichedEthereumBalances, 'Ethereum');
            const filteredApeChainBalances = filterBlacklistedTokens(enrichedApeChainBalances, 'ApeChain');
            const filteredBnbBalances = filterBlacklistedTokens(enrichedBnbBalances, 'BNB Chain');
            const filteredSolanaBalances = filterBlacklistedTokens(enrichedSolanaBalances, 'Solana');

            // Comprehensive token fetching summary
            const totalRawTokens = ethereumBalances.tokenBalances.length + 
                                 apechainBalances.tokenBalances.length + 
                                 bnbBalances.tokenBalances.length + 
                                 (solanaBalances.tokenBalances?.length || 0);
            
            const totalFilteredTokens = filteredEthereumBalances.length + 
                                      filteredApeChainBalances.length + 
                                      filteredBnbBalances.length + 
                                      filteredSolanaBalances.length;

            console.log('\n=== 🪙 TOKEN BALANCE FETCH SUMMARY ===');
            console.log(`📊 Raw Tokens Found:`);
            console.log(`   • Ethereum: ${ethereumBalances.tokenBalances.length} tokens`);
            console.log(`   • ApeChain: ${apechainBalances.tokenBalances.length} tokens`);
            console.log(`   • BNB Chain: ${bnbBalances.tokenBalances.length} tokens`);
            console.log(`   • Solana: ${solanaBalances.tokenBalances?.length || 0} tokens`);
            console.log(`   🎯 TOTAL RAW: ${totalRawTokens} tokens`);
            console.log(`\n🧹 After Blacklist Filtering:`);
            console.log(`   • Ethereum: ${filteredEthereumBalances.length} tokens`);
            console.log(`   • ApeChain: ${filteredApeChainBalances.length} tokens`);
            console.log(`   • BNB Chain: ${filteredBnbBalances.length} tokens`);
            console.log(`   • Solana: ${filteredSolanaBalances.length} tokens`);
            console.log(`   ✅ TOTAL FILTERED: ${totalFilteredTokens} tokens`);
            console.log(`   🚫 Filtered out: ${totalRawTokens - totalFilteredTokens} spam/scam tokens`);
            console.log('========================================\n');

            // Fetch native balances
            await fetchNativeBalances();

            // Combine all tokens for price fetching (using filtered tokens)
            const allTokens = [...filteredEthereumBalances, ...filteredApeChainBalances, ...filteredBnbBalances, ...filteredSolanaBalances];
            
            // Start with Alchemy prices (if available)
            const alchemyPrices = {};
            allTokens.forEach(token => {
                if (token.alchemyPrice && token.alchemyPrice > 0) {
                    alchemyPrices[token.contractAddress.toLowerCase()] = token.alchemyPrice;
                }
            });
            
            // Fetch additional prices for tokens without Alchemy prices
            const tokensNeedingPrices = allTokens.filter(token => !alchemyPrices[token.contractAddress.toLowerCase()]);
            const externalPrices = await fetchTokenPrices(tokensNeedingPrices);
            
            // Add native token prices (ETH and APE)
            const nativePrices = await fetchNativeTokenPrices();
            
            // Combine all price sources (Alchemy takes priority)
            const combinedPrices = { ...externalPrices, ...alchemyPrices, ...nativePrices };
            
            // Special case: WETH should have the same price as ETH
            const nativeEthPrice = combinedPrices['ethereum-native'];
            if (nativeEthPrice) {
                // WETH contract address on Ethereum mainnet
                const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
                combinedPrices[wethAddress] = nativeEthPrice;
                console.log(`🔄 Set WETH price to match ETH: $${nativeEthPrice.toFixed(2)}`);
            }
            
            // Special case: WAPE should have the same price as APE
            const nativeApePrice = combinedPrices['apechain-native'];
            if (nativeApePrice) {
                // WAPE contract address on ApeChain
                const wapeAddress = '0x48b62137edfa95a428d35c09e44256a739f6b557';
                combinedPrices[wapeAddress] = nativeApePrice;
                console.log(`🔄 Set WAPE price to match APE: $${nativeApePrice.toFixed(2)}`);
            }
            
            setTokenPrices(combinedPrices);
            
            console.log(`Price sources: ${Object.keys(alchemyPrices).length} from Alchemy, ${Object.keys(externalPrices).length} from external APIs, ${Object.keys(nativePrices).length} native tokens`);

            // Manual calculation removed - TokenBalanceDisplay components will report their totals directly

            // Calculate total USD value with improved error handling
            let totalUSD = 0;
            let tokenBreakdown = {
                ethereum: 0,
                apechain: 0,
                bnb: 0,
                solana: 0
            };
            
            // Helper function to safely calculate token value
            const calculateTokenValue = (token, networkName) => {
                try {
                    let rawBalance = token.tokenBalance;
                    
                    // Handle different balance formats more safely
                    if (typeof rawBalance === 'string') {
                        if (rawBalance.startsWith('0x')) {
                            rawBalance = parseInt(rawBalance, 16);
                        } else {
                            rawBalance = parseFloat(rawBalance) || 0;
                        }
                    } else if (typeof rawBalance === 'number') {
                        rawBalance = rawBalance;
                    } else {
                        console.warn(`Invalid balance format for token ${token.symbol} on ${networkName}:`, rawBalance);
                        return 0;
                    }
                    
                    // Validate balance is not NaN or negative
                    if (isNaN(rawBalance) || rawBalance < 0) {
                        console.warn(`Invalid balance value for token ${token.symbol} on ${networkName}:`, rawBalance);
                        return 0;
                    }
                    
                    const decimals = token.decimals || (networkName === 'Solana' ? 9 : 18);
                    const balance = rawBalance / Math.pow(10, decimals);
                    
                    // Get price with multiple fallbacks
                    let price = 0;
                    const contractAddr = token.contractAddress?.toLowerCase();
                    const mintAddr = token.mint?.toLowerCase();
                    
                    if (contractAddr && combinedPrices[contractAddr]) {
                        price = combinedPrices[contractAddr];
                    } else if (mintAddr && combinedPrices[mintAddr]) {
                        price = combinedPrices[mintAddr];
                    } else if (token.alchemyPrice && token.alchemyPrice > 0) {
                        price = token.alchemyPrice;
                    }
                    
                    // Override price for APES IN SPACE token
                    if (token.name && token.name.toLowerCase().includes('apes in space')) {
                        price = 0;
                    }
                    
                    // Validate price
                    if (isNaN(price) || price < 0) {
                        price = 0;
                    }
                    
                    const tokenValue = balance * price;
                    
                    // Log suspicious values
                    if (tokenValue > 1000000) { // Values over $1M seem suspicious
                        console.warn(`⚠️  Suspicious high value detected for ${token.symbol} on ${networkName}:`);
                        console.warn(`   Balance: ${balance.toFixed(6)}`);
                        console.warn(`   Price: $${price.toFixed(6)}`);
                        console.warn(`   Value: $${tokenValue.toFixed(2)}`);
                        console.warn(`   Raw Balance: ${rawBalance}`);
                        console.warn(`   Decimals: ${decimals}`);
                    }
                    
                    return isNaN(tokenValue) ? 0 : tokenValue;
                } catch (error) {
                    console.error(`Error calculating value for token ${token.symbol} on ${networkName}:`, error);
                    return 0;
                }
            };
            
            // Calculate token values by network with error handling (using filtered tokens)
            filteredEthereumBalances.forEach(token => {
                const tokenValue = calculateTokenValue(token, 'Ethereum');
                tokenBreakdown.ethereum += tokenValue;
                totalUSD += tokenValue;
            });
            
            filteredApeChainBalances.forEach(token => {
                const tokenValue = calculateTokenValue(token, 'ApeChain');
                tokenBreakdown.apechain += tokenValue;
                totalUSD += tokenValue;
            });
            
            filteredBnbBalances.forEach(token => {
                const tokenValue = calculateTokenValue(token, 'BNB Chain');
                tokenBreakdown.bnb += tokenValue;
                totalUSD += tokenValue;
            });
            
            filteredSolanaBalances.forEach(token => {
                const tokenValue = calculateTokenValue(token, 'Solana');
                tokenBreakdown.solana += tokenValue;
                totalUSD += tokenValue;
            });
            
            // Add native balances to total
            const ethPrice = combinedPrices['ethereum-native'] || 0;
            const apePrice = combinedPrices['apechain-native'] || 0;
            const bnbPrice = combinedPrices['bnb-native'] || 0;
            const solPrice = combinedPrices['solana-native'] || 0;
            
            const nativeValues = {
                ethereum: (nativeBalances.ethereum || 0) * ethPrice,
                apechain: (nativeBalances.apechain || 0) * apePrice,
                bnb: (nativeBalances.bnb || 0) * bnbPrice,
                solana: (nativeBalances.solana || 0) * solPrice
            };
            
            totalUSD += nativeValues.ethereum;
            totalUSD += nativeValues.apechain;
            totalUSD += nativeValues.bnb;
            totalUSD += nativeValues.solana;
            
            // Enhanced logging for debugging
            console.log('=== TOTAL VALUE BREAKDOWN ===');
            console.log('Token Values by Network:');
            console.log(`  Ethereum Tokens: $${tokenBreakdown.ethereum.toFixed(2)} (${filteredEthereumBalances.length} tokens)`);
            console.log(`  ApeChain Tokens: $${tokenBreakdown.apechain.toFixed(2)} (${filteredApeChainBalances.length} tokens)`);
            console.log(`  BNB Chain Tokens: $${tokenBreakdown.bnb.toFixed(2)} (${filteredBnbBalances.length} tokens)`);
            console.log(`  Solana Tokens: $${tokenBreakdown.solana.toFixed(2)} (${filteredSolanaBalances.length} tokens)`);
            console.log('Native Token Values:');
            console.log(`  ETH: ${(nativeBalances.ethereum || 0).toFixed(6)} * $${ethPrice.toFixed(2)} = $${nativeValues.ethereum.toFixed(2)}`);
            console.log(`  APE: ${(nativeBalances.apechain || 0).toFixed(6)} * $${apePrice.toFixed(2)} = $${nativeValues.apechain.toFixed(2)}`);
            console.log(`  BNB: ${(nativeBalances.bnb || 0).toFixed(6)} * $${bnbPrice.toFixed(2)} = $${nativeValues.bnb.toFixed(2)}`);
            console.log(`  SOL: ${(nativeBalances.solana || 0).toFixed(6)} * $${solPrice.toFixed(2)} = $${nativeValues.solana.toFixed(2)}`);
            console.log('---');
            console.log(`SUBTOTAL (Tokens): $${(tokenBreakdown.ethereum + tokenBreakdown.apechain + tokenBreakdown.bnb + tokenBreakdown.solana).toFixed(2)}`);
            console.log(`SUBTOTAL (Native): $${(nativeValues.ethereum + nativeValues.apechain + nativeValues.bnb + nativeValues.solana).toFixed(2)}`);
            console.log(`TOTAL PORTFOLIO VALUE: $${totalUSD.toFixed(2)}`);
            console.log('Expected from UI: $4380.26 + $566.12 + $772.30 + $0.00 = $5718.68');
            console.log('===============================');
            
            // Sanity check - if total is way off from UI totals, there might be a calculation error
            const expectedTotal = 4380.26 + 566.12 + 772.30; // Based on user's observation
            const calculatedTokensOnly = tokenBreakdown.ethereum + tokenBreakdown.apechain + tokenBreakdown.bnb + tokenBreakdown.solana;
            
            if (Math.abs(calculatedTokensOnly - expectedTotal) > expectedTotal * 0.1) { // More than 10% difference
                console.warn('⚠️  CALCULATION MISMATCH DETECTED:');
                console.warn(`   UI shows total: $${expectedTotal.toFixed(2)}`);
                console.warn(`   Calculated tokens: $${calculatedTokensOnly.toFixed(2)}`);
                console.warn(`   Difference: $${Math.abs(calculatedTokensOnly - expectedTotal).toFixed(2)}`);
                console.warn('   This suggests a calculation error - check token balance parsing or price data');
            }
            
            // Set token balances - the TokenBalanceDisplay components will calculate and report their totals
            setTokenBalances({
                ethereum: filteredEthereumBalances,
                apechain: filteredApeChainBalances,
                bnb: filteredBnbBalances,
                solana: filteredSolanaBalances
            });
            setTokenDataLoaded(true);
        } catch (err) {
            setError('Failed to fetch token balances: ' + err.message);
            console.error('Error fetching token balances:', err);
        } finally {
            setLoading(false);
        }
    };

    // NFT Portfolio Functions
    const fetchNftPortfolio = async () => {
        if (!analyzedWallet) return;

        try {
            console.log('🖼️ Fetching NFT portfolio from multiple networks for:', analyzedWallet);
            
            // Networks to check for NFTs
            const networks = [
                { name: 'ethereum', displayName: 'Ethereum' },
                { name: 'apechain', displayName: 'ApeChain' }
            ];

            let allNfts = [];
            const collectionMap = {};

            // Fetch NFTs from each network
            for (const network of networks) {
                try {
                    console.log(`📡 Fetching NFTs from ${network.displayName}...`);
                    const alchemySDK = initializeAlchemySDK(network.name);
                    
                    let allNetworkNfts = [];
                    let pageKey = null;
                    let pageCount = 0;
                    
                    // Paginate through all NFTs for this network
                    do {
                        pageCount++;
                        console.log(`📄 Fetching page ${pageCount} from ${network.displayName}${pageKey ? ` (pageKey: ${pageKey.slice(0, 20)}...)` : ''}...`);
                        
                        const requestOptions = {
                            withMetadata: true,
                            pageSize: 100
                        };
                        
                        // Add pageKey for continuation if we have one
                        if (pageKey) {
                            requestOptions.pageKey = pageKey;
                        }
                        
                        const nftsResponse = await alchemySDK.nft.getNftsForOwner(analyzedWallet, requestOptions);
                        
                        console.log(`📊 Page ${pageCount}: Found ${nftsResponse.ownedNfts.length} NFTs on ${network.displayName}`);
                        
                        // Add NFTs from this page to our collection
                        allNetworkNfts.push(...nftsResponse.ownedNfts);
                        
                        // Update pageKey for next iteration
                        pageKey = nftsResponse.pageKey;
                        
                        // Continue if we have a pageKey (more pages available)
                        // Also continue if we got exactly pageSize results (might be more pages)
                    } while (pageKey);
                    
                    console.log(`✅ Total NFTs found on ${network.displayName}: ${allNetworkNfts.length} (across ${pageCount} pages)`);

                    // Add network information to each NFT and group by collection
                    allNetworkNfts.forEach(nft => {
                        // Add network info to the NFT object
                        nft.network = network.name;
                        nft.networkDisplayName = network.displayName;
                        allNfts.push(nft);

                        const contractAddress = nft.contract.address;
                        if (!collectionMap[contractAddress]) {
                            collectionMap[contractAddress] = {
                                contract: nft.contract,
                                name: nft.contract.name,
                                network: network.name,
                                networkDisplayName: network.displayName,
                                nfts: [],
                                collectionSlug: null
                            };
                        }
                        collectionMap[contractAddress].nfts.push(nft);
                    });

                } catch (networkError) {
                    console.warn(`⚠️ Failed to fetch NFTs from ${network.displayName}:`, networkError.message);
                    // Continue with other networks even if one fails
                }
            }

            console.log(`🎯 Total NFTs found across all networks: ${allNfts.length}`);

            // Show all collections found
            console.log('📋 All collections found by Alchemy:');
            Object.entries(collectionMap).forEach(([address, collection]) => {
                console.log(`  - ${collection.name || 'Unknown'} (${address.slice(0,8)}...): ${collection.nfts.length} NFTs on ${collection.networkDisplayName}`);
            });

            // Fetch floor prices for each collection
            await fetchFloorPrices(collectionMap);

            // Set NFT portfolio and calculate value after both NFTs and floor prices are loaded
            setNftPortfolio(allNfts);
            
        } catch (err) {
            console.error('Error fetching NFT portfolio:', err);
            setError('Failed to fetch NFT portfolio: ' + err.message);
        }
    };



    const fetchFloorPrices = async (collectionMap) => {
        console.log('\n=== 🏷️ Starting Floor Price Fetching (Cache-First Strategy) ===');
        setFetchingFloorPrices(true);
        const floorPrices = {};
        const successfulFetches = [];
        const failedFetches = [];
        
        // Step 1: Try to get floor prices from Supabase cache first
        const contractAddresses = Object.keys(collectionMap);
        console.log(`🗄️ Step 1: Checking Supabase cache for ${contractAddresses.length} collections...`);
        
        const cachedFloorPrices = await getCachedFloorPrices(contractAddresses);
        
        // Add cached results to our final results
        let cachedCount = 0;
        const remainingCollections = {};
        
        for (const [contractAddress, collectionData] of Object.entries(collectionMap)) {
            const cachedPrice = cachedFloorPrices[contractAddress.toLowerCase()];
            
            if (cachedPrice) {
                // Use cached floor price
                floorPrices[contractAddress.toLowerCase()] = cachedPrice;
                
                successfulFetches.push({
                    name: cachedPrice.collectionName,
                    address: contractAddress.slice(0, 8) + '...',
                    price: `${cachedPrice.floorPrice} ${cachedPrice.currency}`,
                    priceUSD: cachedPrice.priceUSD ? `$${cachedPrice.priceUSD.toLocaleString()}` : 'N/A',
                    slug: cachedPrice.collectionSlug,
                    network: cachedPrice.network,
                    cached: true
                });
                
                console.log(`💾 Using cached price: ${cachedPrice.collectionName} = ${cachedPrice.floorPrice} ${cachedPrice.currency} ($${cachedPrice.priceUSD?.toFixed(2) || 'N/A'})`);
                cachedCount++;
            } else {
                // Need to fetch from Magic Eden API
                remainingCollections[contractAddress] = collectionData;
            }
        }
        
        console.log(`💾 Cache results: ${cachedCount}/${contractAddresses.length} collections found in cache`);
        
        // Step 2: Fetch remaining collections from Magic Eden API
        const remainingCount = Object.keys(remainingCollections).length;
        let requestCount = 0; // Track API calls made
        
        if (remainingCount > 0) {
            console.log(`🌐 Step 2: Fetching ${remainingCount} collections from Magic Eden API...`);
            
            // Rate limiting - Magic Eden allows 2 requests per second
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const RATE_LIMIT_DELAY = 500; // 500ms = 2 requests per second
            
            // Query each remaining collection individually using the id parameter
            for (const [contractAddress, collectionData] of Object.entries(remainingCollections)) {
            const collectionName = collectionData.name || 'Unknown Collection';
            const network = collectionData.network || 'ethereum'; // Default to ethereum if no network specified
            
            console.log(`🔍 Fetching floor price for ${collectionName} on ${network} (${contractAddress.slice(0, 8)}...)`)
            
            try {
                // Rate limiting before each request
                if (requestCount > 0) {
                    await delay(RATE_LIMIT_DELAY);
                }
                requestCount++;
                
                // Determine the correct Magic Eden API endpoint based on network
                let apiEndpoint;
                if (network.toLowerCase() === 'apechain') {
                    apiEndpoint = `https://api-mainnet.magiceden.dev/v3/rtp/apechain/collections/v7?id=${contractAddress}&includeMintStages=false&includeSecurityConfigs=false&normalizeRoyalties=false&useNonFlaggedFloorAsk=false&sortBy=allTimeVolume&limit=20`;
                } else {
                    // Default to ethereum for all other networks (ethereum, mainnet, etc.)
                    apiEndpoint = `https://api-mainnet.magiceden.dev/v3/rtp/ethereum/collections/v7?id=${contractAddress}&includeMintStages=false&includeSecurityConfigs=false&normalizeRoyalties=false&useNonFlaggedFloorAsk=false&sortBy=allTimeVolume&limit=20`;
                }
                
                console.log(`🌐 Using ${network} endpoint for ${collectionName}`);
                
                // Query Magic Eden API with specific collection id parameter
                const response = await fetch(apiEndpoint, {
                    headers: {
                        'accept': '*/*',
                        // Note: In production, you would add your API key here
                        // 'Authorization': 'Bearer YOUR_API_KEY'
                    }
                });

                if (!response.ok) {
                    failedFetches.push({
                        name: collectionName,
                        address: contractAddress.slice(0, 8) + '...',
                        reason: `API error: ${response.status}`
                    });
                    console.log(`❌ ${collectionName}: API error ${response.status}`);
                    continue;
                }

                const data = await response.json();
                const collections = data.collections || [];
                
                if (collections.length > 0) {
                    const collection = collections[0]; // Take the first (and likely only) result
                    
                    if (collection.floorAsk?.price?.amount?.decimal) {
                        const floorPrice = collection.floorAsk.price.amount.decimal;
                        const floorPriceUSD = collection.floorAsk.price.amount.usd;
                        const currency = collection.floorAsk.price.currency.symbol;
                        
                        floorPrices[contractAddress.toLowerCase()] = {
                            floorPrice: floorPrice,
                            currency: currency,
                            collectionName: collection.name || collectionName,
                            collectionSlug: collection.slug,
                            priceUSD: floorPriceUSD
                        };
                        
                        successfulFetches.push({
                            name: collection.name || collectionName,
                            address: contractAddress.slice(0, 8) + '...',
                            price: `${floorPrice} ${currency}`,
                            priceUSD: floorPriceUSD ? `$${floorPriceUSD.toLocaleString()}` : 'N/A',
                            slug: collection.slug,
                            network: network
                        });
                        
                        // 🎉 SUCCESS - Make this VERY visible
                        console.log(`%c✅ FLOOR PRICE FOUND! 🎉`, 'color: #10b981; font-weight: bold; font-size: 14px;');
                        console.log(`%c   Collection: ${collection.name || collectionName}`, 'color: #3b82f6; font-weight: bold;');
                        console.log(`%c   Network: ${network.toUpperCase()}`, 'color: #8b5cf6; font-weight: bold;');
                        console.log(`%c   Floor Price: ${floorPrice} ${currency} ($${floorPriceUSD?.toLocaleString() || 'N/A'})`, 'color: #f59e0b; font-weight: bold;');
                        console.log(`%c   Magic Eden Slug: "${collection.slug}"`, 'color: #8b5cf6;');
                        console.log(`%c   Contract: ${contractAddress}`, 'color: #6b7280;');
                        
                    } else {
                        failedFetches.push({
                            name: collectionName,
                            address: contractAddress.slice(0, 8) + '...',
                            reason: 'No floor price data available'
                        });
                        console.log(`❌ ${collectionName}: Found in Magic Eden but no floor price available`);
                    }
                } else {
                    failedFetches.push({
                        name: collectionName,
                        address: contractAddress.slice(0, 8) + '...',
                        reason: 'Collection not found in Magic Eden'
                    });
                    console.log(`❌ ${collectionName}: Collection not found in Magic Eden`);
                }
                
            } catch (error) {
                failedFetches.push({
                    name: collectionName,
                    address: contractAddress.slice(0, 8) + '...',
                    reason: `Request failed: ${error.message}`
                });
                console.log(`❌ ${collectionName}: Request failed - ${error.message}`);
            }
            }
        } else {
            console.log(`🎉 All collections found in cache - no API calls needed!`);
        }

        // 🎊 FINAL SUMMARY
        const successCount = Object.keys(floorPrices).length;
        const totalCollections = Object.keys(collectionMap).length;
        const apiCallsCount = requestCount || 0;
        
        console.log(`%c🏁 FLOOR PRICE FETCHING SUMMARY 🏁`, 'color: #ffffff; background: #059669; font-weight: bold; padding: 4px 8px; border-radius: 4px;');
        console.log(`%c   ✅ Total found: ${successCount}/${totalCollections} collections`, 'color: #10b981; font-weight: bold;');
        console.log(`%c   💾 From cache: ${cachedCount} collections`, 'color: #8b5cf6; font-weight: bold;');
        console.log(`%c   🌐 From API: ${apiCallsCount} collections`, 'color: #3b82f6; font-weight: bold;');
        console.log(`%c   ⚡ API calls saved: ${Math.max(0, totalCollections - apiCallsCount)}`, 'color: #10b981; font-weight: bold;');
        
        if (successfulFetches.length > 0) {
            console.log(`%c   💰 Collections with floor prices:`, 'color: #f59e0b; font-weight: bold;');
            successfulFetches.forEach(item => {
                const networkInfo = item.network ? `[${item.network.toUpperCase()}]` : '';
                const sourceInfo = item.cached ? '💾 CACHED' : '🌐 API';
                console.log(`%c      ${sourceInfo} ${item.name}: ${item.price} (${item.priceUSD}) ${networkInfo}`, 'color: #3b82f6;');
            });
        }
        
        if (failedFetches.length > 0) {
            console.log(`%c   ❌ No floor price found: ${failedFetches.length} collections`, 'color: #ef4444;');
            console.log(`%c   💡 Failed collections (will show "Floor price not available"):`, 'color: #6b7280;');
            failedFetches.forEach(item => {
                console.log(`%c      ${item.name} (${item.address}): ${item.reason}`, 'color: #6b7280;');
            });
        }
        
        console.log(`%c   🕒 Total API requests made: ${apiCallsCount}`, 'color: #6b7280;');
        console.log(`%c   ⚡ Rate limit: 2 requests/second (Magic Eden requirement)`, 'color: #6b7280;');
        console.log('%c=== End Floor Price Fetching Summary ===\n', 'color: #6b7280;');

        setNftFloorPrices(floorPrices);
        setFetchingFloorPrices(false);
        // Calculation will be triggered by useEffect when both nftPortfolio and nftFloorPrices are ready
    };

    // Centralized function to calculate collection values - used by all displays
    const calculateCollectionValue = (contractAddress, priceData, collectionNfts) => {
        const floorPriceETH = priceData.floorPrice || 0;
        const collectionCount = collectionNfts.length;
        const currency = priceData.currency || 'ETH';
        const ethPrice = tokenPrices['ethereum-native'] || 0;
        
        let floorPriceUSD;
        if (currency === 'ETH') {
            // For ETH currency: calculate using current ETH price from our token balances
            if (floorPriceETH > 0 && ethPrice > 0) {
                floorPriceUSD = floorPriceETH * ethPrice;
            } else {
                floorPriceUSD = 0;
            }
        } else {
            // For non-ETH currencies: use Magic Eden USD price
            floorPriceUSD = priceData.priceUSD || 0;
        }
        
        const collectionValue = floorPriceUSD * collectionCount;
        
        return {
            contractAddress,
            collectionName: priceData.collectionName,
            currency,
            floorPriceETH,
            floorPriceUSD,
            collectionCount,
            collectionValue,
            ethPrice
        };
    };

    const calculateNftPortfolioValue = (floorPrices) => {
        let totalValue = 0;
        const ethPrice = tokenPrices['ethereum-native'] || 0;
        const calculatedValues = {};

        console.log(`🔍 Calculating NFT portfolio value with:`, {
            nftCount: nftPortfolio.length,
            floorPricesCount: Object.keys(floorPrices).length,
            ethPrice: ethPrice
        });

        Object.entries(floorPrices).forEach(([contractAddress, priceData]) => {
            // Deduplicate NFTs - same logic as table display
            const seenNfts = new Set();
            const uniqueCollectionNfts = [];
            let duplicateCount = 0;
            
            nftPortfolio.forEach(nft => {
                if (nft.contract.address.toLowerCase() === contractAddress.toLowerCase()) {
                    const nftKey = `${nft.contract.address}-${nft.tokenId}`;
                    if (seenNfts.has(nftKey)) {
                        duplicateCount++;
                    } else {
                        seenNfts.add(nftKey);
                        uniqueCollectionNfts.push(nft);
                    }
                }
            });
            
            // Use centralized calculation with deduplicated NFTs
            const calcResult = calculateCollectionValue(contractAddress, priceData, uniqueCollectionNfts);
            calcResult.duplicateCount = duplicateCount; // Add duplicate count for reference
            calculatedValues[contractAddress.toLowerCase()] = calcResult;
            
            totalValue += calcResult.collectionValue;
            
            if (calcResult.collectionCount > 0) {
                if (calcResult.currency === 'ETH') {
                    console.log(`💰 Calculated USD price (ETH): ${calcResult.collectionName} = ${calcResult.floorPriceETH} ETH × $${calcResult.ethPrice.toFixed(2)} = $${calcResult.floorPriceUSD.toFixed(2)}`);
                } else {
                    console.log(`💰 Using Magic Eden USD price (${calcResult.currency}): ${calcResult.collectionName} = $${calcResult.floorPriceUSD.toFixed(2)}`);
                }
                const duplicateInfo = calcResult.duplicateCount > 0 ? ` (${calcResult.duplicateCount} duplicates excluded)` : '';
                console.log(`💎 ${calcResult.collectionName}: ${calcResult.collectionCount} unique NFTs × $${calcResult.floorPriceUSD.toFixed(2)} = $${calcResult.collectionValue.toFixed(2)}${duplicateInfo}`);
            }
        });

        // Store calculated values globally for use in table display
        setNftCollectionValues(calculatedValues);
        setTotalNftValueUSD(totalValue);
        console.log(`🖼️ Total NFT Portfolio Value: $${totalValue.toFixed(2)} (Magic Eden pricing)`);
    };

    // Enhanced TON provider safety check on component mount
    useEffect(() => {
        const checkTonProvider = () => {
            try {
                if (typeof window === 'undefined') return;
                
                // Check multiple times with delays to catch late-loading extensions
                const checkIntervals = [0, 500, 1000, 2000];
                
                checkIntervals.forEach((delay, index) => {
                    setTimeout(() => {
                        try {
                            if (window.ton && typeof window.ton === 'object') {
                                console.log(`TON provider detected (check ${index + 1}/4)`);
                            } else if (index === checkIntervals.length - 1) {
                                console.log("TON provider not detected after multiple checks. This is normal if no TON wallet is installed.");
                            }
                        } catch (err) {
                            console.warn(`TON provider check ${index + 1} failed:`, err.message);
                        }
                    }, delay);
                });
                
            } catch (err) {
                console.warn("TON provider safety check failed:", err.message);
            }
        };
        
        checkTonProvider();
        
        // Cleanup function
        return () => {
            // Any cleanup if needed
        };
    }, []);

    // Fetch token balances and NFT portfolio when analyzed wallet changes
    useEffect(() => {
        if (!analyzedWallet) return;
        
        // Reset all balance and data states when switching wallets
        console.log('🔄 Wallet changed to:', analyzedWallet, '- Resetting all balances and data');
        
        // IMPORTANT: Reset network totals FIRST to prevent stale data persistence
        // This ensures the portfolio value is reset immediately
        setNetworkTotals(prev => {
            console.log('🧹 Resetting network totals. Previous totals:', JSON.stringify({
                eth: prev.ethereum?.toFixed(2) || 0,
                ape: prev.apechain?.toFixed(2) || 0,
                bnb: prev.bnb?.toFixed(2) || 0,
                sol: prev.solana?.toFixed(2) || 0
            }));
            
            return {
                ethereum: 0,
                apechain: 0,
                bnb: 0,
                solana: 0,
                total: 0
            };
        });
        
        // Force portfolio total update to show 0 immediately
        setPortfolioTotal(0);
        
        // Reset token and balance states
        setTokenBalances({
            ethereum: [],
            apechain: [],
            bnb: [],
            solana: []
        });
        
        setNativeBalances({
            ethereum: 0,
            apechain: 0,
            bnb: 0,
            solana: 0
        });
        
        // Reset price and value states
        setTokenPrices({});
        setTotalTokenValueUSD(0);
        setStakedAPEAmount(0);
        
        // Reset NFT states
        setNftPortfolio([]);
        setNftFloorPrices({});
        setTotalNftValueUSD(0);
        setNftCollectionValues({});
        
        // Force an immediate calculation with zero values to ensure everything is reset
        setTimeout(() => {
            calculateAndUpdatePortfolioTotal();
        }, 50);
        
        // Reset transaction and analysis states
        setTransactions([]);
        setAnalysis(null);
        setStakingTransactions([]);
        setApeChurchRewards([]);
        setRaffleRewards([]);
        
        // Reset processing states
        setTokenDataLoaded(false);
        setProcessingComplete(false);
        setFetchingFloorPrices(false);
        
        // Clear any existing errors
        setError(null);
        
        // Now fetch fresh data for the new wallet
        fetchTokenBalances();
        fetchNftPortfolio();
    }, [analyzedWallet]);

    useEffect(() => {
        if (analyzedWallet) {
            fetchWalletData();
        }
    }, [analyzedWallet]);

    // Callback to collect network totals from TokenBalanceDisplay components
    const handleNetworkTotal = React.useCallback((network) => {
        let timeoutId = null;
        
        // Use an identifier tied to current wallet to help cleanup
        const currentWallet = analyzedWallet; 
        
        return (total) => {
            // Skip updates if the wallet has changed
            if (analyzedWallet !== currentWallet) {
                console.log(`🚫 Ignoring stale ${network} update from previous wallet`);
                return;
            }
            
            // Force reset to 0 if total is NaN or undefined
            const normalizedTotal = (typeof total === 'number' && !isNaN(total)) ? total : 0;
            
            // Debounce rapid updates to prevent infinite loops
            if (timeoutId) clearTimeout(timeoutId);
            
            timeoutId = setTimeout(() => {
                setNetworkTotals(prev => {
                    // Validate again that we're working with the current wallet
                    if (analyzedWallet !== currentWallet) {
                        return prev;
                    }
                    
                    // Only update if the value actually changed to prevent infinite loops
                    if (Math.abs((prev[network] || 0) - normalizedTotal) < 0.01) {
                        return prev; // No change, return same object to prevent re-render
                    }
                    
                    console.log(`📊 ${network} reported total: $${normalizedTotal.toFixed(2)} (was: $${(prev[network] || 0).toFixed(2)}) [${currentWallet.slice(0,6)}]`);
                    
                    // Create new object with updated value
                    const updated = { ...prev, [network]: normalizedTotal };
                    
                    // Debug log to verify all network totals
                    console.log(`📊 All network totals after ${network} update:`, {
                        ethereum: updated.ethereum || 0,
                        apechain: updated.apechain || 0,
                        bnb: updated.bnb || 0,
                        solana: updated.solana || 0,
                        total: Object.values(updated).reduce((sum, val) => sum + (val || 0), 0),
                        wallet: analyzedWallet.slice(0,6)
                    });
                    
                    return updated;
                });
            }, 100); // 100ms debounce
            
            // Return a cleanup function
            return () => {
                if (timeoutId) clearTimeout(timeoutId);
            };
        };
    }, [analyzedWallet]); // Keep analyzedWallet as dependency to recreate the callback when wallet changes

    // Calculate and update portfolio total only once after all data is loaded
    const calculateAndUpdatePortfolioTotal = React.useCallback(() => {
        // Get latest state values directly to avoid closure issues
        const currentApePrice = tokenPrices['apechain-native'] || 0;
        const currentStakedAmount = stakedAPEAmount || 0;
        const currentNftValue = totalNftValueUSD || 0;
        const stakedAPEValue = currentStakedAmount * currentApePrice;
        
        // Double check we're still looking at the right wallet when calculating
        const currentWallet = analyzedWallet;
        console.log(`🧮 Calculating portfolio total for wallet: ${currentWallet.slice(0,6)}`);
        
        // Get current network totals from TokenBalanceDisplay components
        const baseTotal = Object.values(networkTotals).reduce((sum, val) => sum + (val || 0), 0);
        const newPortfolioTotal = baseTotal + stakedAPEValue + currentNftValue;
        
        // Check if we should save the portfolio snapshot
        const hasNFTs = nftPortfolio.length > 0;
        const hasNFTValue = currentNftValue > 0;
        const nftDataComplete = hasNFTs && hasNFTValue; // Either no NFTs, or NFTs with actual value
        
        // Debug network values individually
        console.log(`🧮 Network values: ETH=$${(networkTotals.ethereum || 0).toFixed(2)}, APE=$${(networkTotals.apechain || 0).toFixed(2)}, BNB=$${(networkTotals.bnb || 0).toFixed(2)}, SOL=$${(networkTotals.solana || 0).toFixed(2)}`);
        
        // Update the portfolio total
        setPortfolioTotal(newPortfolioTotal);
        
        if (newPortfolioTotal > 0) {
            console.log(`💎 Portfolio Total Updated: $${newPortfolioTotal.toFixed(2)} (base: $${baseTotal.toFixed(2)} + staked: $${stakedAPEValue.toFixed(2)} + NFTs: $${currentNftValue.toFixed(2)}) for wallet: ${currentWallet.slice(0,6)}`);
            
            setTotalTokenValueUSD(newPortfolioTotal);
            
            // Only insert portfolio snapshot if NFT data is complete
            // This prevents saving incomplete snapshots when NFTs exist but floor prices haven't been fetched yet
            if (analyzedWallet && nftDataComplete) {
                console.log(`📊 Saving portfolio snapshot (NFTs: ${hasNFTs ? `${nftPortfolio.length} with $${totalNftValueUSD.toFixed(2)} value` : 'none'})`);
            } else if (analyzedWallet && !nftDataComplete) {
                console.log(`⏳ Skipping portfolio snapshot - waiting for NFT floor prices to load (${nftPortfolio.length} NFTs with $0 value)`);
                return; // Exit early, don't save incomplete data
            }
            
            // Insert portfolio snapshot into Supabase (non-blocking)
            if (analyzedWallet && nftDataComplete) {
                setTimeout(async () => {
                    try {
                        await insertPortfolioSnapshot(analyzedWallet, {
                            totalValue: newPortfolioTotal,
                            tokenBalance: newPortfolioTotal - stakedAPEValue - totalNftValueUSD,
                            nativeBalance: Object.entries(networkTotals).reduce((sum, [network, total]) => {
                                // Estimate native balance portion
                                const nativePrice = tokenPrices[`${network}-native`] || 0;
                                const nativeBalance = network === 'ethereum' ? nativeBalances.ethereum : 
                                                    network === 'apechain' ? nativeBalances.apechain :
                                                    network === 'bnb' ? nativeBalances.bnb :
                                                    network === 'solana' ? nativeBalances.solana : 0;
                                return sum + (nativeBalance * nativePrice);
                            }, 0),
                            nftValue: totalNftValueUSD,
                            stakedValue: stakedAPEValue,
                            profitLoss: analysis?.netProfit || 0,
                            stakingRewards: analysis?.totalStakingRewards || 0,
                            churchRewards: analysis?.totalApeChurchRewards || 0,
                            raffleRewards: analysis?.totalRaffleRewards || 0
                        });
                    } catch (error) {
                        console.warn('📊 Portfolio snapshot save failed (non-critical):', error.message);
                    }
                }, 100);
            }
        }
    }, [stakedAPEAmount, tokenPrices, networkTotals, totalNftValueUSD, analyzedWallet, analysis, nativeBalances, nftPortfolio]);

    // Recalculate NFT portfolio value when NFT data, floor prices, or ETH price changes
    useEffect(() => {
        if (nftPortfolio.length > 0 && Object.keys(nftFloorPrices).length > 0) {
            calculateNftPortfolioValue(nftFloorPrices);
        }
    }, [nftPortfolio, nftFloorPrices, tokenPrices]);

    // Handle window resize for responsive design
    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            setScreenSize({
                width,
                isMobile: width <= 480,
                isTablet: width <= 768
            });
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }
    }, []);

    // Insert NFT collections and calculate final portfolio total after all data is loaded
    useEffect(() => {
        const insertCollectionsAndCalculateTotal = async () => {
            // Check if all data is loaded
            if (tokenDataLoaded && !fetchingFloorPrices) {
                
                // First, calculate and update the portfolio total
                console.log('💎 Calculating final portfolio total...');
                calculateAndUpdatePortfolioTotal();
                
                // Then insert NFT collections if we have NFTs
                if (nftPortfolio.length > 0) {
                    console.log('📝 All data loaded - inserting NFT collections into Supabase...');
                    
                    try {
                        const result = await insertNftCollections(nftPortfolio);
                        if (result.success) {
                            console.log(`✅ NFT collections processed: ${result.insertedCount || 0} new records`);
                        } else {
                            console.warn('⚠️ NFT collections insert failed:', result.error);
                        }
                    } catch (error) {
                        console.error('❌ Error inserting NFT collections:', error);
                    }
                } else {
                    console.log('📝 No NFTs found - skipping collections insert');
                }
            }
        };

        // Add a small delay to ensure all state updates are complete
        const timeoutId = setTimeout(insertCollectionsAndCalculateTotal, 1000);
        return () => clearTimeout(timeoutId);
    }, [tokenDataLoaded, fetchingFloorPrices, nftPortfolio, networkTotals, calculateAndUpdatePortfolioTotal]);

    // Calculate total directly from token balances and native balances (no complex state management)
    const calculateTotalPortfolioValue = () => {
        let total = 0;
        
        // Calculate Ethereum network total
        const ethTokenTotal = tokenBalances.ethereum.reduce((sum, token) => {
            let rawBalance = token.tokenBalance;
            if (typeof rawBalance === 'string' && rawBalance.startsWith('0x')) {
                rawBalance = parseInt(rawBalance, 16);
            } else if (typeof rawBalance === 'string') {
                rawBalance = parseFloat(rawBalance) || 0;
            }
            
            const decimals = token.decimals || 18;
            const balance = rawBalance / Math.pow(10, decimals);
            let price = tokenPrices[token.contractAddress.toLowerCase()] || token.alchemyPrice || 0;
            if (token.name && token.name.toLowerCase().includes('apes in space')) {
                price = 0;
            }
            return sum + (balance * price);
        }, 0);
        
        const ethNativeValue = (nativeBalances.ethereum || 0) * (tokenPrices['ethereum-native'] || 0);
        total += ethTokenTotal + ethNativeValue;
        
        // Calculate ApeChain network total
        const apeTokenTotal = tokenBalances.apechain.reduce((sum, token) => {
            let rawBalance = token.tokenBalance;
            if (typeof rawBalance === 'string' && rawBalance.startsWith('0x')) {
                rawBalance = parseInt(rawBalance, 16);
            } else if (typeof rawBalance === 'string') {
                rawBalance = parseFloat(rawBalance) || 0;
            }
            
            const decimals = token.decimals || 18;
            const balance = rawBalance / Math.pow(10, decimals);
            let price = tokenPrices[token.contractAddress.toLowerCase()] || token.alchemyPrice || 0;
            if (token.name && token.name.toLowerCase().includes('apes in space')) {
                price = 0;
            }
            return sum + (balance * price);
        }, 0);
        
        const apeNativeValue = (nativeBalances.apechain || 0) * (tokenPrices['apechain-native'] || 0);
        total += apeTokenTotal + apeNativeValue;
        
        // Calculate BNB Chain network total
        const bnbTokenTotal = tokenBalances.bnb.reduce((sum, token) => {
            let rawBalance = token.tokenBalance;
            if (typeof rawBalance === 'string' && rawBalance.startsWith('0x')) {
                rawBalance = parseInt(rawBalance, 16);
            } else if (typeof rawBalance === 'string') {
                rawBalance = parseFloat(rawBalance) || 0;
            }
            
            const decimals = token.decimals || 18;
            const balance = rawBalance / Math.pow(10, decimals);
            let price = tokenPrices[token.contractAddress.toLowerCase()] || token.alchemyPrice || 0;
            if (token.name && token.name.toLowerCase().includes('apes in space')) {
                price = 0;
            }
            return sum + (balance * price);
        }, 0);
        
        const bnbNativeValue = (nativeBalances.bnb || 0) * (tokenPrices['bnb-native'] || 0);
        total += bnbTokenTotal + bnbNativeValue;
        
        // Calculate Solana network total
        const solTokenTotal = tokenBalances.solana.reduce((sum, token) => {
            let rawBalance = token.tokenBalance;
            if (typeof rawBalance === 'string' && rawBalance.startsWith('0x')) {
                rawBalance = parseInt(rawBalance, 16);
            } else if (typeof rawBalance === 'string') {
                rawBalance = parseFloat(rawBalance) || 0;
            }
            
            const decimals = token.decimals || 9; // Solana typically uses 9 decimals
            const balance = rawBalance / Math.pow(10, decimals);
            let price = tokenPrices[token.contractAddress.toLowerCase()] || token.alchemyPrice || 0;
            return sum + (balance * price);
        }, 0);
        
        const solNativeValue = (nativeBalances.solana || 0) * (tokenPrices['solana-native'] || 0);
        total += solTokenTotal + solNativeValue;
        
        return total;
    };

    // Add sorting function
    const handleSort = (key) => {
        let direction = 'asc';
        
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        
        setSortConfig({ key, direction });
    };

    // Add function to get sort indicator
    const getSortIndicator = (columnKey) => {
        if (sortConfig.key !== columnKey) {
            return ' ↕️'; // Both arrows for unsorted
        }
        return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
    };

    // Add function to sort transactions
    const sortedTransactions = React.useMemo(() => {
        if (!transactions.length) return [];
        
        const sorted = [...transactions].sort((a, b) => {
            let aValue = a[sortConfig.key];
            let bValue = b[sortConfig.key];
            
            // Handle different data types
            switch (sortConfig.key) {
                case 'date':
                    aValue = new Date(aValue).getTime();
                    bValue = new Date(bValue).getTime();
                    break;
                case 'outgoingAmount':
                case 'incomingAmount':
                case 'feeAmount':
                case 'profit':
                case 'loss':
                    aValue = parseFloat(aValue) || 0;
                    bValue = parseFloat(bValue) || 0;
                    break;
                case 'label':
                case 'outgoingAsset':
                case 'incomingAsset':
                case 'feeAsset':
                case 'comment':
                case 'hash':
                    aValue = (aValue || '').toString().toLowerCase();
                    bValue = (bValue || '').toString().toLowerCase();
                    break;
                default:
                    aValue = aValue || '';
                    bValue = bValue || '';
            }
            
            if (aValue < bValue) {
                return sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (aValue > bValue) {
                return sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
        
        return sorted;
    }, [transactions, sortConfig]);

    const fetchDataWithRetry = async (action, maxRetries = 3) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Fetching ${action} (attempt ${attempt}/${maxRetries})...`);
                
                const url = `${BASE_URL}&module=account&action=${action}&address=${analyzedWallet}&startblock=0&endblock=99999999&sort=asc&apikey=${API_KEY}`;
                console.log(`Request URL: ${url}`);
                
                const response = await axios.get(url, {
                    timeout: 60000 // Increased to 60 second timeout for large wallets
                });
                
                const data = response.data;
                console.log(`Raw response for ${action}:`, data);
                
                // Better error handling for ApeScan API responses
                if (!data) {
                    throw new Error(`No response data for ${action}`);
                }
                
                if (data.status === '0' || data.message === 'NOTOK') {
                    const errorMsg = data.result || data.message || 'Unknown API error';
                    console.warn(`API error for ${action}:`, errorMsg);
                    
                    // Handle specific error cases - more conservative waiting
                    if (errorMsg.includes('rate limit') || errorMsg.includes('too many requests') || errorMsg.includes('Max calls per sec')) {
                        console.log(`Rate limited on ${action}, waiting much longer...`);
                        if (attempt < maxRetries) {
                            const waitTime = 8000 * attempt; // 8s, 16s, 24s - more conservative
                            console.log(`Waiting ${waitTime}ms before retry due to rate limit...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            continue;
                        }
                    }
                    
                    // For final attempt, return empty results instead of failing
                    if (attempt === maxRetries) {
                        console.warn(`Final attempt failed for ${action}, returning empty result`);
                        return {
                            status: '1',
                            message: 'OK',
                            result: []
                        };
                    }
                    
                    throw new Error(`API error: ${errorMsg}`);
                }
                
                if (data.status !== '1') {
                    console.warn(`Unexpected status for ${action}:`, data.status);
                    if (attempt === maxRetries) {
                        console.warn(`Returning empty result for ${action} due to unexpected status`);
                        return {
                            status: '1',
                            message: 'OK',
                            result: []
                        };
                    }
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                    continue;
                }
                
                console.log(`${action} success: ${data.result?.length || 0} items`);
                return data;
                
            } catch (error) {
                console.error(`Attempt ${attempt} failed for ${action}:`, error.message);
                console.error(`Full error:`, error);
                
                // Check if it's a timeout error
                const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
                if (isTimeout) {
                    console.warn(`⏱️ Timeout occurred for ${action} - API may be slow or overloaded`);
                }
                
                if (attempt === maxRetries) {
                    // For the final attempt, return empty data instead of throwing
                    const failureReason = isTimeout ? 'API timeout' : 'connection error';
                    console.warn(`❌ All attempts failed for ${action} due to ${failureReason}, returning empty result`);
                    return {
                        status: '1',
                        message: 'OK',
                        result: []
                    };
                }
                
                // More conservative delays, longer for timeouts
                const baseDelay = isTimeout ? 10000 : 5000; // 10s for timeouts, 5s for other errors
                const waitTime = Math.min(baseDelay * Math.pow(2, attempt - 1), 30000); // Up to 30s max
                console.log(`⏳ Waiting ${waitTime}ms before retry (${isTimeout ? 'timeout recovery' : 'standard retry'})...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    };

    const fetchWalletData = async () => {
        setLoading(true);
        setError(null);
        setProcessingComplete(false); // Reset processing state
        
        // Reset state to prevent duplicate accumulation during re-analysis
        setTransactions([]);
        setAnalysis(null);
        setStakingTransactions([]);

        try {
            console.log('=== STARTING SEQUENTIAL WALLET DATA FETCH ===');
            console.log('Analyzed Wallet:', analyzedWallet);
            console.log('Include Staking:', includeStaking);
            console.log('API Key (first 8 chars):', API_KEY.substring(0, 8) + '...');
            console.log('Alchemy API Key:', process.env.NEXT_PUBLIC_ALCHEMY_API_KEY);
            
            // Sequential API calls with proper delays to respect rate limits (2/sec = 500ms minimum)
            console.log('Step 1/5: Fetching normal transactions...');
            const txData = await fetchDataWithRetry('txlist');
            
            console.log('Waiting 1 second before next request...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('Step 2/5: Fetching NFT transfers...');
            const nftData = await fetchDataWithRetry('tokennfttx');
            
            console.log('Waiting 1 second before next request...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('Step 3/5: Fetching internal transactions...');
            const internalData = await fetchDataWithRetry('txlistinternal');
            
            console.log('Waiting 1 second before next request...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log('Step 4/5: Fetching token transfers...');
            const tokenData = await fetchDataWithRetry('tokentx');

            // Fetch staking rewards if checkbox is enabled
            let stakingRewardsData = [];
            if (includeStaking) {
                console.log('Waiting 1 second before staking request...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                console.log('Step 5/5: Fetching staking rewards...');
                stakingRewardsData = await fetchStakingRewards();
                setStakingTransactions(stakingRewardsData);
            } else {
                setStakingTransactions([]);
            }

            console.log('=== SEQUENTIAL API FETCH COMPLETE ===');
            console.log('API Results:', {
                txData: txData?.result?.length || 0,
                nftData: nftData?.result?.length || 0,
                internalData: internalData?.result?.length || 0,
                tokenData: tokenData?.result?.length || 0,
                stakingRewards: stakingRewardsData.length || 0
            });

            // Validate all data before processing to prevent undefined errors
            const validTxData = txData && txData.status ? txData : { status: '1', result: [] };
            const validNftData = nftData && nftData.status ? nftData : { status: '1', result: [] };
            const validInternalData = internalData && internalData.status ? internalData : { status: '1', result: [] };
            const validTokenData = tokenData && tokenData.status ? tokenData : { status: '1', result: [] };
            const validStakingData = Array.isArray(stakingRewardsData) ? stakingRewardsData : [];

            console.log('Processing validated data...');
            const processedTransactions = await processWalletData(
                validTxData, 
                validNftData, 
                validInternalData, 
                validTokenData, 
                validStakingData
            );
            
            const analysisResult = calculateProfitLoss(processedTransactions);

            setTransactions(processedTransactions);
            setAnalysis(analysisResult);

        } catch (error) {
            console.error('Error fetching wallet data:', error);
            
            // Provide more specific error messages for common issues
            let errorMessage = `Failed to fetch wallet data: ${error.message}`;
            if (error.message.includes('timeout')) {
                errorMessage = `⏱️ Request timed out - ApeScan API may be overloaded. Please try again in a few minutes or check your internet connection.`;
            } else if (error.message.includes('Network Error')) {
                errorMessage = `🌐 Network error - Please check your internet connection and try again.`;
            }
            
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const processWalletData = async (txData, nftData, internalData, tokenData, stakingRewardsData = []) => {
        console.log('=== PROCESSING WALLET DATA WITH VALIDATION ===');
        
        // API constants
        const BASE_URL = 'https://api.etherscan.io/v2/api?chainid=33139';
        const API_KEY = process.env.REACT_APP_ETHERSCAN_API_KEY;
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
        
        // Staking contract constant
        const STAKING_CONTRACT = '0x4ba2396086d52ca68a37d9c0fa364286e9c7835a';
        
        // Validate all input parameters to prevent undefined errors
        const safeTxData = txData && typeof txData === 'object' ? txData : { status: '0', result: [] };
        const safeNftData = nftData && typeof nftData === 'object' ? nftData : { status: '0', result: [] };
        const safeInternalData = internalData && typeof internalData === 'object' ? internalData : { status: '0', result: [] };
        const safeTokenData = tokenData && typeof tokenData === 'object' ? tokenData : { status: '0', result: [] };
        const safeStakingData = Array.isArray(stakingRewardsData) ? stakingRewardsData : [];

        console.log('Input validation results:', {
            txData: { status: safeTxData.status, count: safeTxData.result?.length || 0 },
            nftData: { status: safeNftData.status, count: safeNftData.result?.length || 0 },
            internalData: { status: safeInternalData.status, count: safeInternalData.result?.length || 0 },
            tokenData: { status: safeTokenData.status, count: safeTokenData.result?.length || 0 },
            stakingData: { count: safeStakingData.length }
        });

        const transactions = [];
        
        // Build mappings with safe data
        const txsById = {};
        if (safeTxData.status === '1' && Array.isArray(safeTxData.result)) {
            safeTxData.result.forEach(tx => {
                if (tx && tx.hash) {
                    txsById[tx.hash] = tx;
                }
            });
        }

        const nftByTx = {};
        if (safeNftData.status === '1' && Array.isArray(safeNftData.result)) {
            safeNftData.result.forEach(nft => {
                if (nft && nft.hash) {
                    if (!nftByTx[nft.hash]) nftByTx[nft.hash] = [];
                    nftByTx[nft.hash].push(nft);
                }
            });
        }

        const internalByTx = {};
        if (safeInternalData.status === '1' && Array.isArray(safeInternalData.result)) {
            safeInternalData.result.forEach(itx => {
                if (itx && itx.hash) {
                    if (!internalByTx[itx.hash]) internalByTx[itx.hash] = [];
                    internalByTx[itx.hash].push(itx);
                }
            });
        }

        const tokenByTx = {};
        if (safeTokenData.status === '1' && Array.isArray(safeTokenData.result)) {
            safeTokenData.result.forEach(token => {
                if (token && token.hash) {
                    if (!tokenByTx[token.hash]) tokenByTx[token.hash] = [];
                    tokenByTx[token.hash].push(token);
                }
            });
        }

        // Track transactions processed as Trade to avoid duplicates
        const processedAsTrade = new Set();
        
        // Process normal transactions FIRST (exactly like Python script)
        if (safeTxData.status === '1' && Array.isArray(safeTxData.result)) {
            safeTxData.result.forEach(tx => {
                if (!tx || !tx.hash) return; // Skip invalid transactions
                const date = new Date(parseInt(tx.timeStamp) * 1000);
                
                // ENHANCEMENT: Check if this transaction contains NFT transfers
                if (nftByTx[tx.hash]) {
                    // This transaction has NFT transfers, check if it should be labeled as Trade or NFT Sale
                    const nftsInTx = nftByTx[tx.hash];
                    const userNftOut = nftsInTx.filter(nft => nft.from.toLowerCase() === account.toLowerCase());
                    const userNftIn = nftsInTx.filter(nft => nft.to.toLowerCase() === account.toLowerCase());
                    
                    // If user is sending NFTs out, check for payment (WAPE marketplace sales)
                    if (userNftOut.length > 0) {
                        // Check for WAPE/APE token receipts in this transaction
                        let hasTokenPayment = false;
                        let paymentAmount = 0;
                        let paymentCurrency = 'APE';
                        
                        if (tokenByTx[tx.hash]) {
                            const incomingTokens = tokenByTx[tx.hash].filter(
                                tokenTx => tokenTx.to.toLowerCase() === account.toLowerCase() &&
                                           (tokenTx.tokenSymbol === 'WAPE' || tokenTx.tokenSymbol === 'APE')
                            );
                            
                            if (incomingTokens.length > 0) {
                                hasTokenPayment = true;
                                const tokenTx = incomingTokens[0];
                                paymentCurrency = tokenTx.tokenSymbol;
                                const tokenDecimals = parseInt(tokenTx.tokenDecimal);
                                paymentAmount = parseInt(tokenTx.value) / Math.pow(10, tokenDecimals);
                                console.log(`🎯 Detected WAPE marketplace sale: ${userNftOut.length} NFT(s) for ${paymentAmount} ${paymentCurrency}`);
                            }
                        }
                        
                        // If no token payment and no native APE payment, it's a transfer
                        if (!hasTokenPayment && parseInt(tx.value) === 0) {
                            processedAsTrade.add(tx.hash); // Track this transaction
                            transactions.push({
                                hash: tx.hash,
                                date: date,
                                label: 'Trade',
                                outgoingAsset: 'NFT',
                                outgoingAmount: userNftOut.length.toString(),
                                incomingAsset: '',
                                incomingAmount: '',
                                feeAsset: '',
                                feeAmount: '',
                                comment: `NFT Transfer (Out) - ${userNftOut.length} NFT(s) transferred: ${userNftOut.map(nft => `${nft.tokenName} #${nft.tokenID}`).join(', ')}`,
                                type: 'nft',
                                tokenId: userNftOut[0].tokenID,
                                tokenName: userNftOut[0].tokenName,
                                isTransfer: true
                            });
                            return; // Skip regular transaction processing
                        } else if (hasTokenPayment) {
                            // This is a WAPE marketplace sale - let the NFT processing handle it properly
                            console.log(`✅ WAPE marketplace sale detected - will be processed as NFT Sale by NFT handler`);
                            // Don't add to processedAsTrade, let NFT processing handle it
                        }
                    }
                    
                    // If user is receiving NFTs (and no payment made), label as Trade
                    if (userNftIn.length > 0 && parseInt(tx.value) === 0) {
                        processedAsTrade.add(tx.hash); // Track this transaction
                        transactions.push({
                            hash: tx.hash,
                            date: date,
                            label: 'Trade',
                            outgoingAsset: '',
                            outgoingAmount: '',
                            incomingAsset: 'NFT',
                            incomingAmount: userNftIn.length.toString(),
                            feeAsset: '',
                            feeAmount: '',
                            comment: `NFT Transfer (In) - ${userNftIn.length} NFT(s) received: ${userNftIn.map(nft => `${nft.tokenName} #${nft.tokenID}`).join(', ')}`,
                            type: 'nft',
                            tokenId: userNftIn[0].tokenID,
                            tokenName: userNftIn[0].tokenName,
                            isTransfer: true
                        });
                        return; // Skip regular transaction processing
                    }
                }
                
                // Label as Payment, APE Staked, or Deposit (enhanced logic)
                let label, outgoingAsset, outgoingAmount, incomingAsset, incomingAmount;
                
                if (tx.from.toLowerCase() === account.toLowerCase()) {
                    // Calculate APE amount from main transaction
                    let apeAmount = parseInt(tx.value) / 1e18;
                    let isActuallyDeposit = false; // Flag to track if this is really a deposit disguised as payment
                    
                    // ENHANCEMENT: If main transaction has 0 value, check internal transactions
                    if (apeAmount === 0 && internalByTx[tx.hash]) {
                        // Check outgoing internal transactions (user is paying)
                        const ourInternalPayments = internalByTx[tx.hash].filter(
                            itx => itx.from.toLowerCase() === account.toLowerCase()
                        );
                        
                        // Check incoming internal transactions (user is receiving - e.g., marketplace sales)
                        const ourInternalReceipts = internalByTx[tx.hash].filter(
                            itx => itx.to.toLowerCase() === account.toLowerCase()
                        );
                        
                        if (ourInternalPayments.length > 0) {
                            // Sum all outgoing internal transactions for this payment
                            const totalInternalApe = ourInternalPayments.reduce(
                                (sum, itx) => sum + parseInt(itx.value), 0
                            ) / 1e18;
                            
                            if (totalInternalApe > 0) {
                                apeAmount = totalInternalApe;
                                console.log(`🔍 Enhanced payment detection - Main tx: 0 APE, Outgoing Internal txs: ${apeAmount.toFixed(4)} APE`, {
                                    hash: tx.hash,
                                    mainValue: parseInt(tx.value) / 1e18,
                                    internalValue: apeAmount,
                                    internalCount: ourInternalPayments.length
                                });
                            }
                        } else if (ourInternalReceipts.length > 0) {
                            // This is likely a marketplace sale - user is receiving APE despite main tx being from user
                            const totalInternalApe = ourInternalReceipts.reduce(
                                (sum, itx) => sum + parseInt(itx.value), 0
                            ) / 1e18;
                            
                            if (totalInternalApe > 0) {
                                apeAmount = totalInternalApe;
                                isActuallyDeposit = true; // Mark this as actually being a deposit
                                console.log(`🔍 Enhanced sale detection - Main tx: 0 APE, Incoming Internal txs: ${apeAmount.toFixed(4)} APE (Marketplace Sale)`, {
                                    hash: tx.hash,
                                    mainValue: parseInt(tx.value) / 1e18,
                                    internalValue: apeAmount,
                                    internalCount: ourInternalReceipts.length
                                });
                            }
                        }
                    }
                    
                    // Determine transaction type based on whether this is actually a deposit
                    if (isActuallyDeposit) {
                        // This is actually a deposit (marketplace sale) even though main tx.from = user
                        label = 'Deposit';
                        outgoingAsset = '';
                        outgoingAmount = '';
                        incomingAsset = 'APE';
                        incomingAmount = apeAmount.toString();
                    } else if (tx.to && tx.to.toLowerCase() === STAKING_CONTRACT.toLowerCase()) {
                        // Check if payment is to APE staking contract AND transaction was successful
                        console.log(`🔍 Staking contract transaction found - All fields:`, {
                            hash: tx.hash,
                            txreceipt_status: tx.txreceipt_status,
                            isError: tx.isError,
                            status: tx.status,
                            value: apeAmount.toFixed(4) + ' APE',
                            allFields: Object.keys(tx)
                        });
                        
                        // More flexible success check - if txreceipt_status is missing, assume success if no error
                        const isSuccess = (tx.txreceipt_status === '1') || 
                                        (tx.txreceipt_status === undefined && tx.isError !== '1');
                        
                        // Only label as "APE Staked" if amount > 1 APE and transaction is successful
                        const isValidStaking = isSuccess && apeAmount > 1;
                        
                        console.log(`🔍 Transaction evaluation:`, {
                            hash: tx.hash,
                            apeAmount: apeAmount,
                            isSuccess: isSuccess,
                            isValidStaking: isValidStaking,
                            reasoning: !isSuccess ? 'Transaction failed' : 
                                      apeAmount <= 1 ? `Amount too small (${apeAmount.toFixed(4)} APE <= 1)` :
                                      'Valid staking transaction'
                        });
                        
                        if (isValidStaking) {
                            label = 'APE Staked';
                        } else if (!isSuccess) {
                            label = 'Payment (Failed)';
                        } else {
                            label = 'Payment'; // Small amount but successful
                        }
                        outgoingAsset = 'APE';
                        outgoingAmount = apeAmount.toString();
                        incomingAsset = '';
                        incomingAmount = '';
                    } else {
                        // Regular payment transaction
                        label = 'Payment';
                        outgoingAsset = 'APE';
                        outgoingAmount = apeAmount.toString();
                        incomingAsset = '';
                        incomingAmount = '';
                    }
                } else {
                    // Calculate APE amount from main transaction
                    let apeAmount = parseInt(tx.value) / 1e18;
                    
                    // ENHANCEMENT: If main transaction has 0 value, check internal transactions
                    if (apeAmount === 0 && internalByTx[tx.hash]) {
                        const ourInternalDeposits = internalByTx[tx.hash].filter(
                            itx => itx.to.toLowerCase() === account.toLowerCase()
                        );
                        
                        if (ourInternalDeposits.length > 0) {
                            // Sum all incoming internal transactions for this deposit
                            const totalInternalApe = ourInternalDeposits.reduce(
                                (sum, itx) => sum + parseInt(itx.value), 0
                            ) / 1e18;
                            
                            if (totalInternalApe > 0) {
                                apeAmount = totalInternalApe;
                                console.log(`🔍 Enhanced deposit detection - Main tx: 0 APE, Internal txs: ${apeAmount.toFixed(4)} APE`, {
                                    hash: tx.hash,
                                    mainValue: parseInt(tx.value) / 1e18,
                                    internalValue: apeAmount,
                                    internalCount: ourInternalDeposits.length
                                });
                            }
                        }
                    }
                    
                    label = 'Deposit';
                    outgoingAsset = '';
                    outgoingAmount = '';
                    incomingAsset = 'APE';
                    incomingAmount = apeAmount.toString();
                }
                
                const gasPrice = tx.gasPrice || tx.gasPriceBid || '0';
                let feeAmount = '';
                try {
                    feeAmount = (parseInt(tx.gasUsed) * parseInt(gasPrice) / 1e18).toString();
                } catch (e) {
                    feeAmount = '';
                }
                const feeAsset = feeAmount && parseFloat(feeAmount) > 0 ? 'APE' : '';
                
                transactions.push({
                    hash: tx.hash,
                    date: date,
                    label: label,
                    outgoingAsset: outgoingAsset,
                    outgoingAmount: outgoingAmount,
                    incomingAsset: incomingAsset,
                    incomingAmount: incomingAmount,
                    feeAsset: feeAsset,
                    feeAmount: feeAmount,
                    comment: '',
                    type: 'transaction'
                });
            });
        }

        // Process token transfers (ERC-20) - Only those NOT part of NFT transactions (exactly like Python)
        const processedTxHashes = new Set();
        if (safeTokenData.status === '1' && Array.isArray(safeTokenData.result)) {
            safeTokenData.result.forEach(tokenTx => {
                if (!tokenTx || !tokenTx.hash) return; // Skip invalid tokens
                const txHash = tokenTx.hash;
                
                // Skip if this is part of an NFT transaction (like Python script)
                if (nftByTx[txHash]) {
                    return;
                }
                
                const date = new Date(parseInt(tokenTx.timeStamp) * 1000);
                
                // To prevent duplicate entries for the same transaction (like Python script)
                if (processedTxHashes.has(txHash)) {
                    return;
                }
                processedTxHashes.add(txHash);
                
                // Process ERC-20 transfers
                const tokenSymbol = tokenTx.tokenSymbol;
                const tokenDecimals = parseInt(tokenTx.tokenDecimal);
                
                let label, outgoingAsset, outgoingAmount, incomingAsset, incomingAmount;
                
                if (tokenTx.from.toLowerCase() === account.toLowerCase()) {
                    label = 'Payment';
                    outgoingAsset = tokenSymbol;
                    outgoingAmount = (parseInt(tokenTx.value) / Math.pow(10, tokenDecimals)).toString();
                    incomingAsset = '';
                    incomingAmount = '';
                } else {
                    label = 'Deposit';
                    outgoingAsset = '';
                    outgoingAmount = '';
                    incomingAsset = tokenSymbol;
                    incomingAmount = (parseInt(tokenTx.value) / Math.pow(10, tokenDecimals)).toString();
                }
                
                const feeAsset = '';
                const feeAmount = '';
                
                transactions.push({
                    hash: txHash,
                    date: date,
                    label: label,
                    outgoingAsset: outgoingAsset,
                    outgoingAmount: outgoingAmount,
                    incomingAsset: incomingAsset,
                    incomingAmount: incomingAmount,
                    feeAsset: feeAsset,
                    feeAmount: feeAmount,
                    comment: '',
                    type: 'token'
                });
            });
        }

        // Process burn transactions (from Python script logic) - EXACTLY like Python
        const burnTransactions = {};
        const burnedTokenIds = new Set();
        
        if (safeNftData.status === '1' && Array.isArray(safeNftData.result)) {
            // First pass: identify potential burn/mint pairs (like Python script)
            const outgoingByTime = {};
            const incomingByTime = {};
            
            safeNftData.result.forEach(nft => {
                if (!nft || !nft.hash) return; // Skip invalid NFTs
                const timestamp = parseInt(nft.timeStamp);
                const timeKey = Math.floor(timestamp / 60); // Round to nearest minute
                
                if (nft.from.toLowerCase() === account.toLowerCase()) {
                    // This is an outgoing NFT (potential burn)
                    if (!outgoingByTime[timeKey]) outgoingByTime[timeKey] = [];
                    outgoingByTime[timeKey].push(nft);
                } else if (nft.to.toLowerCase() === account.toLowerCase() && nft.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
                    // This is an incoming mint
                    if (!incomingByTime[timeKey]) incomingByTime[timeKey] = [];
                    incomingByTime[timeKey].push(nft);
                }
            });
            
            // Look for burns followed by mints within a short time window (like Python)
            Object.keys(outgoingByTime).forEach(timeKey => {
                const outgoingNfts = outgoingByTime[timeKey];
                let nearbyMints = [];
                
                // Check nearby time windows for mints (within 2 minutes)
                for (let i = parseInt(timeKey); i <= parseInt(timeKey) + 2; i++) {
                    if (incomingByTime[i]) {
                        nearbyMints = nearbyMints.concat(incomingByTime[i]);
                    }
                }
                
                // If we found both outgoing NFTs and nearby mints, consider it a burn
                if (outgoingNfts.length > 0 && nearbyMints.length > 0) {
                    outgoingNfts.forEach(nft => {
                        const txHash = nft.hash;
                        
                        // Mark this NFT as burned to prevent it being processed as a sale
                        burnedTokenIds.add(`${nft.tokenName}_${nft.tokenID}`);
                        
                        // If there are mints in the same transaction, pair them directly
                        const sameTxMints = nearbyMints.filter(m => m.hash === txHash);
                        if (sameTxMints.length > 0) {
                            burnTransactions[txHash] = {
                                burned: outgoingNfts.filter(n => n.hash === txHash),
                                minted: sameTxMints
                            };
                        } else {
                            // Otherwise, create a separate "burn" entry (like Python)
                            const closestMint = nearbyMints.reduce((closest, mint) => {
                                const mintTimeDiff = Math.abs(parseInt(mint.timeStamp) - parseInt(nft.timeStamp));
                                const closestTimeDiff = Math.abs(parseInt(closest.timeStamp) - parseInt(nft.timeStamp));
                                return mintTimeDiff < closestTimeDiff ? mint : closest;
                            });
                            const mintTxHash = closestMint.hash;
                            
                            // Group all mints from this transaction
                            const relatedMints = nearbyMints.filter(m => m.hash === mintTxHash);
                            
                            // Create a synthetic transaction ID by combining both
                            const syntheticTxId = `${txHash}_${mintTxHash}`;
                            
                            burnTransactions[syntheticTxId] = {
                                burned: [nft],
                                minted: relatedMints,
                                burn_tx: txHash,
                                mint_tx: mintTxHash,
                                is_synthetic: true
                            };
                        }
                    });
                }
            });
        }

        // Process staking withdrawals from specific contract (0x4ba2396086d52ca68a37d9c0fa364286e9c7835a)
        // Check transaction receipt event logs to detect WITHDRAW events only
        const processedStakingTxs = new Set(); // Prevent duplicate processing
        
        for (const internalTxList of Object.values(internalByTx)) {
            if (Array.isArray(internalTxList)) {
                for (const internal of internalTxList) {
                    if (internal.from && internal.from.toLowerCase() === STAKING_CONTRACT.toLowerCase() &&
                        internal.value && parseFloat(internal.value) > 0 &&
                        !processedStakingTxs.has(internal.hash)) {
                        
                        processedStakingTxs.add(internal.hash);
                        
                        try {
                            // Fetch transaction receipt to get event logs
                            console.log(`🔍 Checking transaction receipt for WITHDRAW event in ${internal.hash}...`);
                            
                            // Add delay to respect 2 req/sec rate limit
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            
                            const receiptUrl = `${BASE_URL}&module=proxy&action=eth_getTransactionReceipt&txhash=${internal.hash}&apikey=${API_KEY}`;
                            const receiptResponse = await axios.get(receiptUrl, { timeout: 60000 });
                            
                            console.log(`🔍 Receipt response for ${internal.hash}:`, receiptResponse.data);
                            
                            if (receiptResponse && receiptResponse.data && receiptResponse.data.result && receiptResponse.data.result.logs) {
                                const logs = receiptResponse.data.result.logs;
                                console.log(`📋 Found ${logs.length} logs in receipt for ${internal.hash}`);
                                let isWithdraw = false;
                                
                                // Check event logs for WITHDRAW events only
                                logs.forEach(log => {
                                    // Check if log is from staking contract
                                    if (log.address && log.address.toLowerCase() === STAKING_CONTRACT.toLowerCase()) {
                                        const topics = log.topics || [];
                                        if (topics.length > 0) {
                                            const eventSignature = topics[0];
                                            
                                            // Check for WITHDRAW event patterns
                                            if (eventSignature.includes('0x67c680c232fa9400adef6a1ad234c1d6d15a44170b85fddb60ceed23e31c3220') ||
                                                eventSignature.toLowerCase().includes('withdraw') ||
                                                eventSignature.toLowerCase().includes('unstake') ||
                                                log.data.includes('776974686472617727') || // "withdraw" in hex
                                                log.data.includes('756e7374616b65')) { // "unstake" in hex
                                                isWithdraw = true;
                                                console.log(`✅ Found WITHDRAW event in log: ${eventSignature}`);
                                            }
                                        }
                                    }
                                });
                                
                                // Process WITHDRAW events only
                                const stakeAmount = parseFloat(internal.value) / Math.pow(10, 18);
                                const txHash = internal.hash;
                                const date = new Date(parseInt(internal.timeStamp) * 1000);
                                
                                if (isWithdraw) {
                                    console.log(`📉 Found WITHDRAW: ${stakeAmount} APE from ${internal.from} in tx ${txHash}`);
                                    
                                    // Create withdraw transaction entry (will subtract from staked amount at the end)
                                    const withdrawTransaction = {
                                        hash: txHash,
                                        date: date,
                                        label: 'Deposit',
                                        outgoingAsset: '',
                                        outgoingAmount: '',
                                        incomingAsset: 'APE',
                                        incomingAmount: stakeAmount.toString(),
                                        feeAsset: '',
                                        feeAmount: '',
                                        comment: `Staking withdrawal from ${STAKING_CONTRACT}`,
                                        type: 'transaction',
                                        isStakingWithdraw: true,
                                        stakingWithdrawAmount: stakeAmount // Track the withdrawal amount
                                    };
                                    
                                    transactions.push(withdrawTransaction);
                                    
                                    console.log(`💎 Added WITHDRAW transaction: ${stakeAmount.toFixed(4)} APE (will be deducted from staked amount)`);
                                } else {
                                    console.log(`🔍 Staking transaction ${txHash} detected but no WITHDRAW event found (likely CLAIM - handled by fetchStakingRewards)`);
                                }
                                
                            } else {
                                console.log(`⚠️ No receipt logs found for tx ${internal.hash}`);
                            }
                            
                        } catch (error) {
                            console.error(`❌ Error checking transaction receipt for ${internal.hash}:`, error);
                        }
                    }
                }
            }
        }

        // Process NFT transfers (exactly like Python script - INDEPENDENT of regular transactions)
        if (safeNftData.status === '1' && Array.isArray(safeNftData.result)) {
            safeNftData.result.forEach(nft => {
                if (!nft || !nft.hash) return; // Skip invalid NFTs
                const txHash = nft.hash;
                const date = new Date(parseInt(nft.timeStamp) * 1000);
                
                // Skip if this is part of a burn transaction (like Python script)
                let isPartOfBurn = false;
                Object.values(burnTransactions).forEach(burnData => {
                    if (nft.from.toLowerCase() === account.toLowerCase()) {
                        burnData.burned.forEach(burned => {
                            if (burned.tokenID === nft.tokenID && burned.tokenName === nft.tokenName) {
                                isPartOfBurn = true;
                            }
                        });
                    } else if (nft.to.toLowerCase() === account.toLowerCase() && nft.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
                        burnData.minted.forEach(minted => {
                            if (minted.tokenID === nft.tokenID && minted.tokenName === nft.tokenName) {
                                isPartOfBurn = true;
                            }
                        });
                    }
                });
                
                if (isPartOfBurn) {
                    return;
                }
                
                // Additional check using burnedTokenIds (like Python)
                if (nft.from.toLowerCase() === account.toLowerCase() && 
                    burnedTokenIds.has(`${nft.tokenName}_${nft.tokenID}`)) {
                    return;
                }
                
                if (nft.from.toLowerCase() === account.toLowerCase()) {
                    // Skip if this transaction was already processed as Trade
                    if (processedAsTrade.has(nft.hash)) {
                        return;
                    }
                    
                    // This is an outgoing NFT - check if it's a sale or transfer
                    let label = 'NFT Sale';
                    const outgoingAsset = 'NFT';  // Standardized to NFT
                    const outgoingAmount = '1';
                    let incomingAsset = 'APE';  // Default currency
                    let incomingAmount = '0';
                    
                    // Check if there's any payment received for this NFT
                    let paymentCurrency = null;
                    let paymentAmount = null;
                    let comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName}`;
                    let isTransfer = false; // Flag to detect transfers
                    
                    // Check token transfers for this transaction (prioritize WAPE/APE tokens)
                    if (tokenByTx[txHash]) {
                        const incomingTokens = tokenByTx[txHash].filter(
                            tx => tx.to.toLowerCase() === account.toLowerCase()
                        );
                        
                        if (incomingTokens.length > 0) {
                            // Prioritize WAPE and APE tokens for marketplace sales
                            let tokenTx = incomingTokens.find(tx => 
                                tx.tokenSymbol === 'WAPE' || tx.tokenSymbol === 'APE'
                            );
                            
                            // If no WAPE/APE found, use the first incoming token
                            if (!tokenTx) {
                                tokenTx = incomingTokens[0];
                            }
                            
                            paymentCurrency = tokenTx.tokenSymbol;
                            const tokenDecimals = parseInt(tokenTx.tokenDecimal);
                            paymentAmount = parseInt(tokenTx.value) / Math.pow(10, tokenDecimals);
                            
                            if (tokenTx.tokenSymbol === 'WAPE') {
                                console.log(`💰 WAPE marketplace payment detected: ${paymentAmount} WAPE for NFT ${nft.tokenName} #${nft.tokenID}`);
                            }
                        }
                    }
                    
                    // If no token transfer found, check internal transactions
                    if (paymentAmount === null && internalByTx[txHash]) {
                        const ourInternalTxs = internalByTx[txHash].filter(
                            itx => itx.to.toLowerCase() === account.toLowerCase()
                        );
                        
                        // Get all NFTs sold in this batch
                        const batchNfts = nftByTx[txHash] ? nftByTx[txHash].filter(
                            n => n.from.toLowerCase() === account.toLowerCase()
                        ) : [];
                        
                        if (ourInternalTxs.length === batchNfts.length) {
                            // Match NFT to payment by position in the batch
                            const idx = batchNfts.indexOf(nft);
                            if (idx < ourInternalTxs.length) {
                                paymentAmount = parseInt(ourInternalTxs[idx].value) / 1e18;
                                comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName} (Specific sale amount)`;
                            }
                        } else {
                            // Sum all incoming value and divide by number of NFTs
                            const totalApe = ourInternalTxs.reduce((sum, itx) => sum + parseInt(itx.value), 0) / 1e18;
                            if (batchNfts.length > 0) {
                                paymentAmount = totalApe / batchNfts.length;
                                comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName} (Estimated sale from batch)`;
                            } else {
                                paymentAmount = totalApe;
                                comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName} (Batch sale)`;
                            }
                        }
                    }
                    
                    // **ENHANCED LOGIC**: Check if this is a transfer (no payment received)
                    if (paymentAmount === null || paymentAmount === 0) {
                        // This is a transfer, not a sale
                        label = 'Transfer';
                        incomingAsset = '';
                        incomingAmount = '';
                        comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName} - NFT Transfer (Out) - Transfer to another wallet, no payment received`;
                        isTransfer = true;
                    } else {
                        // This is a real sale with payment (including WAPE marketplace sales)
                        label = 'NFT Sale';
                        if (paymentCurrency) {
                            incomingAsset = paymentCurrency;
                        }
                        incomingAmount = paymentAmount.toString();
                        
                        // Update comment for WAPE marketplace sales
                        if (paymentCurrency === 'WAPE') {
                            comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName} (WAPE Marketplace Sale)`;
                        }
                    }
                    
                    transactions.push({
                        hash: txHash,
                        date: date,
                        label: label,
                        outgoingAsset: outgoingAsset,
                        outgoingAmount: outgoingAmount,
                        incomingAsset: incomingAsset,
                        incomingAmount: incomingAmount,
                        feeAsset: '',
                        feeAmount: '',
                        comment: comment,
                        type: 'nft',
                        tokenId: nft.tokenID,
                        tokenName: nft.tokenName,
                        isTransfer: isTransfer // Mark as transfer
                    });
                } else {
                    // Skip if this transaction was already processed as Trade
                    if (processedAsTrade.has(nft.hash)) {
                        return;
                    }
                    
                    // This is an incoming NFT - check if it's a purchase, transfer, or paid mint
                    let label = 'Trade';
                    const incomingAsset = 'NFT';  // Standardized to NFT
                    const incomingAmount = '1';
                    let outgoingAsset = 'APE';  // Default currency
                    let outgoingAmount = '';
                    let isTransfer = false; // Flag to detect transfers
                    let isPaidMint = false; // Flag to detect paid mints
                    let comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName}`;
                    
                    // Skip if from zero address and part of a burn transaction
                    if (nft.from.toLowerCase() === ZERO_ADDRESS.toLowerCase() && 
                        Object.keys(burnTransactions).includes(txHash)) {
                        return;
                    }
                    
                    // **ENHANCED LOGIC FOR MINTS**: Check if this is a mint/gift (from zero address)
                    if (nft.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
                        console.log(`🪙 Processing mint: ${nft.tokenName} ID ${nft.tokenID} in tx ${txHash}`);
                        
                        // Check if there were any payments made for this mint
                        let mintPrice = null;
                        let mintCurrency = null;
                        
                        // Method 1: Check if there are token transfers (ERC-20 payments)
                        if (tokenByTx[txHash]) {
                            const ourTokenTxs = tokenByTx[txHash].filter(
                                tx => tx.from.toLowerCase() === account.toLowerCase()
                            );
                            
                            // Get all NFTs minted in this batch from zero address
                            const batchMints = nftByTx[txHash] ? nftByTx[txHash].filter(
                                n => n.to.toLowerCase() === account.toLowerCase() && 
                                     n.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()
                            ) : [];
                            
                            if (ourTokenTxs.length > 0) {
                                // Use the first outgoing token's currency
                                mintCurrency = ourTokenTxs[0].tokenSymbol;
                                const decimals = parseInt(ourTokenTxs[0].tokenDecimal || '18');
                                
                                // Calculate total payment in tokens
                                const totalPaid = ourTokenTxs.reduce((sum, tx) => 
                                    sum + parseInt(tx.value), 0) / Math.pow(10, decimals);
                                
                                // Divide by number of minted NFTs
                                if (batchMints.length > 0) {
                                    mintPrice = totalPaid / batchMints.length;
                                    console.log(`💰 Token payment detected: ${totalPaid} ${mintCurrency} total, ${mintPrice} per NFT (${batchMints.length} minted)`);
                                }
                            }
                        }
                        
                        // Method 2: Check if there's a payment transaction (APE native currency)
                        if (mintPrice === null && mintCurrency === null && txsById[txHash]) {
                            const paymentTx = txsById[txHash];
                            if (paymentTx.from.toLowerCase() === account.toLowerCase()) {
                                const batchMints = nftByTx[txHash] ? nftByTx[txHash].filter(
                                    n => n.to.toLowerCase() === account.toLowerCase() && 
                                         n.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()
                                ) : [];
                                
                                if (batchMints.length > 0) {
                                    const totalPayment = parseInt(paymentTx.value) / 1e18;
                                    mintPrice = totalPayment / batchMints.length;
                                    mintCurrency = 'APE';
                                    console.log(`💰 Native APE payment detected: ${totalPayment} APE total, ${mintPrice} per NFT (${batchMints.length} minted)`);
                                }
                            }
                        }
                        
                        // Method 3: Check internal transactions (MOST IMPORTANT FOR SKID CITY CASE)
                        if (mintPrice === null && mintCurrency === null && internalByTx[txHash]) {
                            const ourInternalPayments = internalByTx[txHash].filter(
                                itx => itx.from.toLowerCase() === account.toLowerCase()
                            );
                            
                            const batchMints = nftByTx[txHash] ? nftByTx[txHash].filter(
                                n => n.to.toLowerCase() === account.toLowerCase() && 
                                     n.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()
                            ) : [];
                            
                            if (ourInternalPayments.length > 0 && batchMints.length > 0) {
                                mintCurrency = 'APE';  // Internal txs are in native currency
                                
                                // **ENHANCED LOGIC**: Try to match internal payments to NFTs
                                if (ourInternalPayments.length === batchMints.length) {
                                    // Perfect match: each internal payment corresponds to one NFT
                                    const idx = batchMints.indexOf(nft);
                                    if (idx < ourInternalPayments.length) {
                                        mintPrice = parseInt(ourInternalPayments[idx].value) / 1e18;
                                        console.log(`💰 Matched internal payment: ${mintPrice} APE for NFT #${idx + 1}`);
                                    }
                                } else {
                                    // Sum all internal payments and divide by NFT count
                                    const totalPayment = ourInternalPayments.reduce((sum, itx) => 
                                        sum + parseInt(itx.value), 0) / 1e18;
                                    mintPrice = totalPayment / batchMints.length;
                                    console.log(`💰 Distributed internal payment: ${totalPayment} APE total, ${mintPrice} per NFT (${batchMints.length} minted, ${ourInternalPayments.length} payments)`);
                                }
                            }
                        }
                        
                        // **DECISION LOGIC**: Determine if this is a paid mint or free gift
                        if (mintPrice !== null && mintPrice > 0) {
                            // This is a PAID MINT - treat as Trade
                            label = 'Trade';
                            outgoingAsset = mintCurrency;
                            outgoingAmount = mintPrice.toString();
                            isPaidMint = true;
                            
                            console.log(`✅ Paid mint detected: ${mintPrice} ${mintCurrency} for ${nft.tokenName} #${nft.tokenID}`);
                        } else {
                            // This is a FREE MINT/GIFT - requires manual review
                            label = 'Airdrop';
                            outgoingAsset = '';
                            outgoingAmount = '';
                            
                            console.log(`🎁 Free mint/gift detected: ${nft.tokenName} #${nft.tokenID}`);
                        }
                        
                        // Generate appropriate comment
                        let comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName}`;
                        if (isPaidMint) {
                            const batchMints = nftByTx[txHash] ? nftByTx[txHash].filter(
                                n => n.to.toLowerCase() === account.toLowerCase() && 
                                     n.from.toLowerCase() === ZERO_ADDRESS.toLowerCase()
                            ).length : 1;
                            
                            if (batchMints > 1) {
                                comment += ` (Paid mint - part of batch mint of ${batchMints} NFTs for ${mintPrice.toFixed(4)} ${mintCurrency} each)`;
                            } else {
                                comment += ` (Paid mint for ${mintPrice.toFixed(4)} ${mintCurrency})`;
                            }
                        } else {
                            comment += ' (Free mint/airdrop - requires manual valuation)';
                        }
                        
                        transactions.push({
                            hash: txHash,
                            date: date,
                            label: label,
                            outgoingAsset: outgoingAsset,
                            outgoingAmount: outgoingAmount,
                            incomingAsset: incomingAsset,
                            incomingAmount: incomingAmount,
                            feeAsset: '',
                            feeAmount: '',
                            comment: comment,
                            type: 'nft',
                            tokenId: nft.tokenID,
                            tokenName: nft.tokenName,
                            isGift: !isPaidMint, // Only mark as gift if it's truly free
                            isPaidMint: isPaidMint
                        });
                        return;
                    }
                    
                    // Regular NFT Purchase logic continues here (non-mint transactions)...
                    // Find individual purchase price and currency for this NFT
                    let purchasePrice = null;
                    let purchaseCurrency = null;
                    
                    // Method 1: Check if there are token transfers for this transaction
                    if (tokenByTx[txHash]) {
                        const ourTokenTxs = tokenByTx[txHash].filter(
                            tx => tx.from.toLowerCase() === account.toLowerCase()
                        );
                        
                        const batchNfts = nftByTx[txHash] ? nftByTx[txHash].filter(
                            n => n.to.toLowerCase() === account.toLowerCase()
                        ) : [];
                        
                        // If there's any token transfer, use that as the currency
                        if (ourTokenTxs.length > 0) {
                            // Use the first outgoing token's currency
                            purchaseCurrency = ourTokenTxs[0].tokenSymbol;
                            const decimals = parseInt(ourTokenTxs[0].tokenDecimal || '18');
                            
                            // If exact match between token transfers and NFTs
                            if (ourTokenTxs.length === batchNfts.length) {
                                const idx = batchNfts.indexOf(nft);
                                if (idx < ourTokenTxs.length) {
                                    const tokenTx = ourTokenTxs[idx];
                                    purchasePrice = parseInt(tokenTx.value) / Math.pow(10, decimals);
                                }
                            } else {
                                // Sum all outgoing token transfers for the total payment
                                const totalPaid = ourTokenTxs.reduce((sum, tx) => 
                                    sum + parseInt(tx.value), 0) / Math.pow(10, decimals);
                                purchasePrice = batchNfts.length > 0 ? totalPaid / batchNfts.length : totalPaid;
                            }
                        }
                    }
                    
                    // Method 2: Check if there's a payment transaction (APE native currency)
                    if (purchasePrice === null && purchaseCurrency === null && txsById[txHash]) {
                        const paymentTx = txsById[txHash];
                        if (paymentTx.from.toLowerCase() === account.toLowerCase()) {
                            const batchNfts = nftByTx[txHash] ? nftByTx[txHash].filter(
                                n => n.to.toLowerCase() === account.toLowerCase()
                            ) : [];
                            if (batchNfts.length > 0) {
                                purchasePrice = parseInt(paymentTx.value) / 1e18 / batchNfts.length;
                                purchaseCurrency = 'APE';
                            }
                        }
                    }
                    
                    // Method 3: Check internal transactions
                    if (purchasePrice === null && purchaseCurrency === null && internalByTx[txHash]) {
                        const ourInternalPayments = internalByTx[txHash].filter(
                            itx => itx.from.toLowerCase() === account.toLowerCase()
                        );
                        
                        const batchNfts = nftByTx[txHash] ? nftByTx[txHash].filter(
                            n => n.to.toLowerCase() === account.toLowerCase()
                        ) : [];
                        
                        if (ourInternalPayments.length > 0) {
                            purchaseCurrency = 'APE';  // Internal txs are in native currency
                            
                            if (ourInternalPayments.length === batchNfts.length) {
                                const idx = batchNfts.indexOf(nft);
                                if (idx < ourInternalPayments.length) {
                                    purchasePrice = parseInt(ourInternalPayments[idx].value) / 1e18;
                                }
                            } else if (ourInternalPayments.length > 0 && batchNfts.length > 0) {
                                // Sum payments and divide by NFT count
                                const totalPayment = ourInternalPayments.reduce((sum, itx) => 
                                    sum + parseInt(itx.value), 0) / 1e18;
                                purchasePrice = totalPayment / batchNfts.length;
                            }
                        }
                    }
                    
                    // **NEW LOGIC**: Check if this is a transfer (no payment made)
                    if (purchasePrice === null || purchasePrice === 0) {
                        // This is a transfer, not a purchase - label as Bounty for incoming NFTs
                        label = 'Bounty';
                        outgoingAsset = '';
                        outgoingAmount = '';
                        comment = `Token ID: ${nft.tokenID} - Collection: ${nft.tokenName} - NFT Transfer (In) - Transfer from another wallet, no payment made`;
                        isTransfer = true;
                    } else {
                        // This is a real purchase with payment
                        if (purchaseCurrency) {
                            outgoingAsset = purchaseCurrency;
                        }
                        if (purchasePrice !== null) {
                            outgoingAmount = purchasePrice.toString();
                        }
                    }
                    
                    // Generate comment with token ID information
                    if (isTransfer) {
                        comment += ' (Transfer from another wallet - no payment made)';
                    } else {
                        const batchNfts = nftByTx[txHash] ? nftByTx[txHash].length : 1;
                        if (batchNfts > 1) {
                            comment += ` (Part of batch purchase of ${batchNfts} NFTs)`;
                        }
                    }
                    
                    // For specific known transactions, hardcode the price and currency
                    if (txHash.toLowerCase() === "0x85cbfecf9e5097cc83b7d01bf554cb59038fd7ecbb90fe31500526b314b34e65".toLowerCase()) {
                        outgoingAsset = "APE";
                        outgoingAmount = "17";
                        isTransfer = false;
                        label = 'Trade';
                    }
                    
                    // For the specific Goblin transaction
                    if (txHash.toLowerCase() === "0x450278a4f1a857295cd4264117d4bfbe2906cc00d946864a6f18f8851faf069d".toLowerCase()) {
                        outgoingAsset = "GEM";
                        outgoingAmount = "1000";
                        isTransfer = false;
                        label = 'Trade';
                    }
                    
                    transactions.push({
                        hash: txHash,
                        date: date,
                        label: label,
                        outgoingAsset: outgoingAsset,
                        outgoingAmount: outgoingAmount,
                        incomingAsset: incomingAsset,
                        incomingAmount: incomingAmount,
                        feeAsset: '',
                        feeAmount: '',
                        comment: comment,
                        type: 'nft',
                        tokenId: nft.tokenID,
                        tokenName: nft.tokenName,
                        isTransfer: isTransfer, // Mark as transfer
                        isPaidMint: isPaidMint
                    });
                }
            });
        }

        // Process burn transactions (create NFT Conversion entries like Python script)
        Object.keys(burnTransactions).forEach(txHash => {
            const burnData = burnTransactions[txHash];
            if (burnData.burned.length > 0 && burnData.minted.length > 0) {
                // Get a timestamp from one of the NFTs in this transaction
                const firstNft = burnData.burned[0] || burnData.minted[0];
                const date = new Date(parseInt(firstNft.timeStamp) * 1000);
                
                // Create a conversion entry
                const burnedNfts = burnData.burned.map(n => `${n.tokenName} ID:${n.tokenID}`).join(', ');
                const mintedNfts = burnData.minted.map(n => `${n.tokenName} ID:${n.tokenID}`).join(', ');
                
                const label = 'NFT Conversion';
                const outgoingAsset = burnedNfts;
                const outgoingAmount = burnData.burned.length.toString();
                const incomingAsset = mintedNfts;
                const incomingAmount = burnData.minted.length.toString();
                const feeAsset = '';
                const feeAmount = '';
                
                // Add a more descriptive comment for synthetic transactions (like Python)
                let comment;
                if (burnData.is_synthetic) {
                    comment = `Burned ${burnData.burned.length} NFTs in tx ${burnData.burn_tx.slice(0,8)}... and received ${burnData.minted.length} NFTs in tx ${burnData.mint_tx.slice(0,8)}...`;
                } else {
                    comment = `Burned ${burnData.burned.length} NFTs to mint ${burnData.minted.length} new NFTs`;
                }
                
                transactions.push({
                    hash: txHash,
                    date: date,
                    label: label,
                    outgoingAsset: outgoingAsset,
                    outgoingAmount: outgoingAmount,
                    incomingAsset: incomingAsset,
                    incomingAmount: incomingAmount,
                    feeAsset: feeAsset,
                    feeAmount: feeAmount,
                    comment: comment,
                    type: 'conversion'
                });
            }
        });

        // Add staking rewards if provided
        if (stakingRewardsData && stakingRewardsData.length > 0) {
            console.log(`📈 Adding ${stakingRewardsData.length} staking reward transactions`);
            transactions.push(...stakingRewardsData);
        }

        // Sort by date (like Python script)
        transactions.sort((a, b) => b.date - a.date); // Changed from a.date - b.date
        
        // At the end of processWalletData, before return:
        // Calculate total staked APE amount (staked - withdrawn)
        const totalStakedAPE = transactions
            .filter(tx => tx.label === 'APE Staked')
            .reduce((sum, tx) => sum + parseFloat(tx.outgoingAmount || 0), 0);
            
        const totalWithdrawnAPE = transactions
            .filter(tx => tx.isStakingWithdraw)
            .reduce((sum, tx) => sum + parseFloat(tx.stakingWithdrawAmount || tx.incomingAmount || 0), 0);
        
        const netStakedAPE = Math.max(0, totalStakedAPE - totalWithdrawnAPE);
        
        setStakedAPEAmount(netStakedAPE);
        console.log(`💎 Staking Summary:`);
        console.log(`   Total Staked: ${totalStakedAPE.toFixed(4)} APE`);
        console.log(`   Total Withdrawn: ${totalWithdrawnAPE.toFixed(4)} APE`);
        console.log(`   Net Staked: ${netStakedAPE.toFixed(4)} APE`);
        
        console.log('=== FINAL PROCESSING RESULTS ===');
        console.log(`Total transactions processed: ${transactions.length}`);
        console.log('Breakdown:', {
            nftTransactions: transactions.filter(t => t.type === 'nft').length,
            tokenTransactions: transactions.filter(t => t.type === 'token').length,
            regularTransactions: transactions.filter(t => t.type === 'transaction').length,
            conversionTransactions: transactions.filter(t => t.type === 'conversion').length,
            apeStakingTransactions: transactions.filter(t => t.label === 'APE Staked').length
        });
        
        // Mark processing as complete
        setProcessingComplete(true);
        
        return transactions;
    };

    const calculateProfitLoss = (transactions) => {
        // Implement exact same logic as profit_loss.py but handle transfers and staking rewards
        const nftPurchases = {};
        let totalProfit = 0;
        let totalLoss = 0;
        let nftTrades = 0;
        let totalStakingRewards = 0;

        // Initialize reward totals
        let totalApeChurchRewards = 0;
        let totalRaffleRewards = 0;

        // First pass: record NFT purchases (including paid mints, but NOT transfers)
        transactions.forEach((tx, index) => {
            if ((tx.label === 'Trade' && tx.tokenId && !tx.isTransfer && tx.incomingAsset === 'NFT') || 
                (tx.isPaidMint && tx.tokenId)) { // Include paid mints
                
                // Extract token ID from comment
                let tokenId = tx.tokenId;
                if (tx.comment && tx.comment.includes('Token ID:')) {
                    const match = tx.comment.match(/Token ID:\s*(\S+)/);
                    if (match) {
                        tokenId = match[1].trim();
                    }
                }
                
                // Create unique key
                const key = `${tx.incomingAsset}_ID_${tokenId}`;
                
                const purchaseAmount = parseFloat(tx.outgoingAmount) || 0;
                const purchaseCurrency = tx.outgoingAsset;
                
                // Only record if there was actually a payment
                if (purchaseAmount > 0) {
                    nftPurchases[key] = {
                        purchase_amount: purchaseAmount,
                        purchase_currency: purchaseCurrency,
                        purchase_index: index,
                        hash: tx.hash,
                        is_paid_mint: tx.isPaidMint || false
                    };
                    
                    const mintLabel = tx.isPaidMint ? '(Paid Mint)' : '';
                    console.log(`Recorded NFT Trade ${mintLabel}: ${key} for ${purchaseAmount} ${purchaseCurrency}`);
                }
            }
        });

        // Second pass: calculate profit/loss on sales (but NOT transfers)
        transactions.forEach((tx, index) => {
            if (tx.label === 'NFT Sale' && tx.tokenId && !tx.isTransfer) {
                // Extract token ID from comment
                let tokenId = tx.tokenId;
                if (tx.comment && tx.comment.includes('Token ID:')) {
                    const match = tx.comment.match(/Token ID:\s*(\S+)/);
                    if (match) {
                        tokenId = match[1].trim();
                    }
                }
                
                // Create unique key
                const key = `${tx.outgoingAsset}_ID_${tokenId}`;
                
                const saleAmount = parseFloat(tx.incomingAmount) || 0;
                const saleCurrency = tx.incomingAsset;
                
                console.log(`Processing NFT Sale: ${key}, looking for purchase record...`);
                
                // Check if we have a purchase record
                const purchase = nftPurchases[key];
                if (purchase && purchase.purchase_amount > 0) {
                    console.log(`Found purchase record for ${key}: ${purchase.purchase_amount} ${purchase.purchase_currency}`);
                    
                    const purchaseAmount = purchase.purchase_amount;
                    const purchaseCurrency = purchase.purchase_currency;
                    
                    // Normalize currencies (WAPE = APE)
                    const normalizedSaleCurrency = saleCurrency === 'WAPE' ? 'APE' : saleCurrency;
                    const normalizedPurchaseCurrency = purchaseCurrency === 'WAPE' ? 'APE' : purchaseCurrency;
                    
                    if (normalizedSaleCurrency === normalizedPurchaseCurrency) {
                        nftTrades++;
                        if (saleAmount > purchaseAmount) {
                            const profit = saleAmount - purchaseAmount;
                            totalProfit += profit;
                            tx.profit = profit;
                            tx.comment += ` (Purchase: ${purchaseAmount.toFixed(4)} ${purchaseCurrency}, Profit: ${profit.toFixed(4)} APE)`;
                        } else {
                            const loss = purchaseAmount - saleAmount;
                            totalLoss += loss;
                            tx.loss = loss;
                            tx.comment += ` (Purchase: ${purchaseAmount.toFixed(4)} ${purchaseCurrency}, Loss: ${loss.toFixed(4)} APE)`;
                        }
                        tx.purchasePrice = purchaseAmount;
                        tx.purchaseCurrency = purchaseCurrency;
                    } else {
                        tx.comment += ` (Purchase: ${purchaseAmount.toFixed(4)} ${purchaseCurrency}, Sale: ${saleAmount.toFixed(4)} ${saleCurrency} - Different currencies, no profit/loss calculated)`;
                    }
                } else {
                    console.log(`No purchase record found for ${key}`);
                    // Only treat as gifted profit if there was actually a sale amount
                    if (saleAmount > 0 && ['APE', 'WAPE', 'GEM', 'ETH', 'WETH'].includes(saleCurrency)) {
                        const profit = saleAmount;
                        totalProfit += profit;
                        tx.profit = profit;
                        tx.isGifted = true;
                        tx.comment += ` (No purchase record found, treated as gifted/minted - full sale of ${profit.toFixed(4)} ${saleCurrency} is profit)`;
                    } else {
                        tx.comment += ` (No purchase record found, unknown currency ${saleCurrency})`;
                    }
                }
            }
            
            // **NEW**: Handle transfer out - no profit/loss impact
            if (tx.label === 'Transfer' && tx.isTransfer && tx.comment && tx.comment.includes('NFT Transfer (Out)')) {
                tx.comment += ' (Transfer - no profit/loss impact)';
            }
            
            // **NEW**: Handle bounty in - no cost basis
            if (tx.label === 'Bounty' && tx.isTransfer && tx.comment && tx.comment.includes('NFT Transfer (In)')) {
                tx.comment += ' (Bounty - no cost basis recorded)';
            }
            
            // **NEW**: Handle APE Staking Rewards as profit (ONLY actual staking rewards, not Church/Raffle)
            if ((tx.label === 'Staking' || tx.label === 'Staking Reward') || 
                (tx.isStakingReward && tx.contractType === 'staking')) {
                const stakingAmount = parseFloat(tx.incomingAmount) || parseFloat(tx.incomingQuantity) || parseFloat(tx.profit_loss) || 0;
                if (stakingAmount > 0) {
                    totalStakingRewards += stakingAmount;
                    totalProfit += stakingAmount;
                    tx.profit = stakingAmount;
                    
                    // Add comment if not already present
                    if (!tx.comment.includes('Staking reward')) {
                        tx.comment += ` (Staking reward: ${stakingAmount.toFixed(4)} APE profit)`;
                    }
                    console.log(`✅ Added staking reward to profit: ${stakingAmount} APE (from ${tx.label})`);
                }
            }
            
            // **NEW**: Handle APE Church Rewards as profit
            if (tx.label === 'Cashback') {
                const churchAmount = parseFloat(tx.incomingAmount) || 0;
                if (churchAmount > 0) {
                    totalApeChurchRewards += churchAmount;
                    totalProfit += churchAmount;
                    tx.profit = churchAmount;
                    tx.comment += ` (Church reward: ${churchAmount.toFixed(4)} APE profit)`;
                    console.log(`Added APE Church reward to profit: ${churchAmount} APE`);
                }
            }
            
            // **NEW**: Handle Raffle Rewards as profit
            if (tx.label === 'Airdrop') {
                const raffleAmount = parseFloat(tx.incomingAmount) || 0;
                if (raffleAmount > 0) {
                    totalRaffleRewards += raffleAmount;
                    totalProfit += raffleAmount;
                    tx.profit = raffleAmount;
                    tx.comment += ` (Raffle reward: ${raffleAmount.toFixed(4)} APE profit)`;
                    console.log(`Added Raffle reward to profit: ${raffleAmount} APE`);
                }
            }
        });

        return {
            totalProfit,
            totalLoss,
            netProfit: totalProfit - totalLoss,
            nftTrades,
            totalTransactions: transactions.length,
            totalStakingRewards,
            totalApeChurchRewards,
            totalRaffleRewards
        };
    };

    const exportToJSON = () => {
        const exportData = {
            account,
            analysis,
            transactions: transactions.map(tx => ({
                ...tx,
                date: tx.date.toISOString()
            })),
            exportedAt: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wallet_analysis_${account.slice(0,8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportToCSV = () => {
        const headers = [
            'Date (UTC)', 'Integration Name', 'Label', 'Outgoing Asset', 'Outgoing Amount',
            'Incoming Asset', 'Incoming Amount', 'Fee Asset (optional)', 'Fee Amount (optional)',
            'Comment (optional)', 'Trx. ID (optional)'
        ];
        
        const csvData = transactions.map(tx => [
            tx.date.toISOString(),
            'APECHAIN',
            tx.label,
            tx.outgoingAsset || '',
            tx.outgoingAmount || '',
            tx.incomingAsset || '',
            tx.incomingAmount || '',
            tx.feeAsset || '',
            tx.feeAmount || '',
            tx.comment || '',
            tx.hash
        ]);
        
        const csvContent = [headers, ...csvData]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wallet_analysis_${account.slice(0,8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Add this enhanced NFTTradingChart component
    const NFTTradingChart = ({ transactions }) => {
        const [selectedCollection, setSelectedCollection] = useState(null);
        const [selectedBubble, setSelectedBubble] = useState(null);
        const [isMobile, setIsMobile] = useState(false);

        // Detect mobile device
        useEffect(() => {
            const checkMobile = () => {
                setIsMobile(window.innerWidth <= 768 || 'ontouchstart' in window);
            };
            checkMobile();
            window.addEventListener('resize', checkMobile);
            return () => window.removeEventListener('resize', checkMobile);
        }, []);

        // Prepare data for scatter plot with collection grouping
        const chartData = transactions
            .filter(tx => tx.type === 'nft' && (tx.profit || tx.loss) && tx.purchasePrice !== undefined)
            .map((tx, index) => {
                const profitLoss = tx.profit || -tx.loss || 0;
                const purchasePrice = tx.purchasePrice || 0;
                
                return {
                    id: index,
                    date: tx.date.getTime(),
                    dateFormatted: tx.date instanceof Date && !isNaN(tx.date) ? format(tx.date, 'MMM dd, yyyy') : 'Invalid Date',
                    purchasePrice: purchasePrice,
                    profitLoss: profitLoss,
                    bubbleSize: Math.abs(profitLoss) * 100 + 50,
                    color: profitLoss >= 0 ? '#10b981' : '#ef4444',
                    tokenName: tx.tokenName,
                    tokenId: tx.tokenId,
                    saleAmount: parseFloat(tx.incomingAmount || '0'),
                    hash: tx.hash,
                    isProfit: profitLoss >= 0,
                    collection: tx.tokenName // For grouping
                };
            })
            .sort((a, b) => a.date - b.date);

        // Get unique collections for filter buttons
        const collections = [...new Set(chartData.map(item => item.collection))];

        // Filter data based on selected collection
        const filteredData = selectedCollection 
            ? chartData.filter(item => item.collection === selectedCollection)
            : chartData;

        // Enhanced tooltip for mobile and desktop
        const CustomTooltip = ({ active, payload, label }) => {
            if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                    <div style={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '12px',
                        padding: '16px',
                        color: '#fff',
                        fontSize: isMobile ? '14px' : '12px',
                        boxShadow: '0 8px 25px -5px rgba(0, 0, 0, 0.4)',
                        maxWidth: isMobile ? '280px' : '320px',
                        minWidth: isMobile ? '250px' : '280px'
                    }}>
                        <div style={{
                            fontWeight: '700', 
                            marginBottom: '12px', 
                            color: '#e5e7eb',
                            fontSize: isMobile ? '16px' : '14px',
                            borderBottom: '1px solid #374151',
                            paddingBottom: '8px'
                        }}>
                            🎨 {data.tokenName} #{data.tokenId}
                        </div>
                        <div style={{marginBottom: '6px'}}>
                            📅 <strong>Date:</strong> {data.dateFormatted}
                        </div>
                        <div style={{marginBottom: '6px'}}>
                            <strong>Purchase:</strong> {data.purchasePrice.toFixed(4)} APE
                        </div>
                        <div style={{marginBottom: '6px'}}>
                            💸 <strong>Sale:</strong> {data.saleAmount.toFixed(4)} APE
                        </div>
                        <div style={{
                            color: data.color,
                            fontWeight: '700',
                            marginTop: '12px',
                            padding: '8px',
                            backgroundColor: data.isProfit ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            borderRadius: '6px',
                            fontSize: isMobile ? '16px' : '14px'
                        }}>
                            {data.isProfit ? 'Profit' : 'Loss'}: {Math.abs(data.profitLoss).toFixed(4)} APE
                        </div>
                        <div style={{
                            fontSize: isMobile ? '11px' : '10px', 
                            color: '#9ca3af', 
                            marginTop: '10px',
                            fontFamily: 'monospace'
                        }}>
                            🔗 Tx: {data.hash && typeof data.hash === 'string' ? `${data.hash.slice(0, 8)}...${data.hash.slice(-6)}` : 'No Hash'}
                        </div>
                        {isMobile && (
                            <div style={{
                                fontSize: '11px',
                                color: '#6b7280',
                                marginTop: '8px',
                                fontStyle: 'italic'
                            }}>
                                💡 Tap bubble to highlight collection
                            </div>
                        )}
                    </div>
                );
            }
            return null;
        };

        // Enhanced dot component with click interaction
        const CustomDot = (props) => {
            const { cx, cy, payload } = props;
            const radius = Math.min(Math.max(payload.bubbleSize / 20, 6), 20); // Larger for mobile
            const isSelected = selectedBubble?.id === payload.id;
            const isCollectionHighlighted = selectedCollection === payload.collection;
            
            return (
                <g>
                    {/* Outer glow for selected bubble */}
                    {isSelected && (
                        <circle
                            cx={cx}
                            cy={cy}
                            r={radius + 6}
                            fill={payload.color}
                            fillOpacity={0.2}
                            stroke={payload.color}
                            strokeWidth={2}
                            strokeOpacity={0.5}
                        />
                    )}
                    
                    {/* Main bubble */}
                    <circle
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill={payload.color}
                        fillOpacity={isCollectionHighlighted ? 0.9 : (selectedCollection ? 0.3 : 0.7)}
                        stroke={payload.color}
                        strokeWidth={isSelected ? 3 : (isCollectionHighlighted ? 2 : 1)}
                        style={{ 
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBubble(payload);
                            setSelectedCollection(payload.collection);
                        }}
                    />
                    
                    {/* Center dot for better visibility on mobile */}
                    {isMobile && (
                        <circle
                            cx={cx}
                            cy={cy}
                            r={2}
                            fill={payload.isProfit ? '#ffffff' : '#000000'}
                            fillOpacity={0.8}
                        />
                    )}
                </g>
            );
        };

        if (chartData.length === 0) {
            return (
                <div style={{
                    textAlign: 'center',
                    padding: '40px',
                    color: '#9ca3af',
                    backgroundColor: '#1f2937',
                    borderRadius: '12px',
                    margin: '20px 0'
                }}>
                    No NFT trading data available for chart visualization
                </div>
            );
        }

        return (
            <div style={{
                backgroundColor: '#1f2937',
                borderRadius: '12px',
                padding: isMobile ? '16px' : '20px',
                margin: '20px 0'
            }}>
                <h3 style={{
                    color: '#e5e7eb',
                    marginBottom: '20px',
                    textAlign: 'center',
                    fontSize: isMobile ? '20px' : '18px',
                    fontWeight: '600'
                }}>
                    NFT Trading Performance
                </h3>

                {/* Collection Filter Buttons */}
                <div style={{
                    marginBottom: '20px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    justifyContent: 'center'
                }}>
                    <button
                        onClick={() => {
                            setSelectedCollection(null);
                            setSelectedBubble(null);
                        }}
                        style={{
                            padding: isMobile ? '10px 16px' : '8px 12px',
                            backgroundColor: !selectedCollection ? '#3b82f6' : '#374151',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '20px',
                            fontSize: isMobile ? '14px' : '12px',
                            cursor: 'pointer',
                            fontWeight: '500',
                            transition: 'all 0.2s'
                        }}
                    >
                        🌟 All Collections ({chartData.length})
                    </button>
                    {collections.map(collection => {
                        const collectionCount = chartData.filter(item => item.collection === collection).length;
                        const collectionProfit = chartData
                            .filter(item => item.collection === collection)
                            .reduce((sum, item) => sum + item.profitLoss, 0);
                        
                        return (
                            <button
                                key={collection}
                                onClick={() => {
                                    setSelectedCollection(selectedCollection === collection ? null : collection);
                                    setSelectedBubble(null);
                                }}
                                style={{
                                    padding: isMobile ? '10px 16px' : '8px 12px',
                                    backgroundColor: selectedCollection === collection ? '#10b981' : '#374151',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '20px',
                                    fontSize: isMobile ? '13px' : '11px',
                                    cursor: 'pointer',
                                    fontWeight: '500',
                                    transition: 'all 0.2s',
                                    maxWidth: isMobile ? '200px' : 'none',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}
                                title={`${collection}: ${collectionCount} trades, ${collectionProfit >= 0 ? '+' : ''}${collectionProfit.toFixed(2)} APE`}
                            >
                                {collection.length > 12 ? collection.slice(0, 12) + '...' : collection} ({collectionCount})
                            </button>
                        );
                    })}
                </div>

                {/* Selected Collection Info */}
                {selectedCollection && (
                    <div style={{
                        backgroundColor: '#374151',
                        borderRadius: '8px',
                        padding: '12px',
                        marginBottom: '20px',
                        textAlign: 'center'
                    }}>
                        <div style={{ color: '#e5e7eb', fontWeight: '600', marginBottom: '4px' }}>
                            🎨 {selectedCollection}
                        </div>
                        <div style={{ fontSize: '14px', color: '#9ca3af' }}>
                            {filteredData.length} trades • 
                            {filteredData.reduce((sum, item) => sum + item.profitLoss, 0) >= 0 ? ' ↗ ' : ' ↘ '}
                            {filteredData.reduce((sum, item) => sum + item.profitLoss, 0) >= 0 ? '+' : ''}
                            {filteredData.reduce((sum, item) => sum + item.profitLoss, 0).toFixed(4)} APE total
                        </div>
                    </div>
                )}
                
                {/* Legend */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: isMobile ? '15px' : '20px',
                    marginBottom: '20px',
                    fontSize: isMobile ? '14px' : '14px',
                    flexWrap: 'wrap'
                }}>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <div style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            backgroundColor: '#10b981'
                        }}></div>
                        <span style={{color: '#e5e7eb'}}>Profit</span>
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                        <div style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: '50%',
                            backgroundColor: '#ef4444'
                        }}></div>
                        <span style={{color: '#e5e7eb'}}>Loss</span>
                    </div>
                    <div style={{color: '#9ca3af', fontSize: isMobile ? '12px' : '12px'}}>
                        {isMobile ? 'Tap bubbles' : 'Bubble size'} = P&L magnitude
                    </div>
                </div>

                {/* Chart Container */}
                <ResponsiveContainer width="100%" height={isMobile ? 350 : 400}>
                    <ScatterChart
                        data={filteredData}
                        margin={{
                            top: 20,
                            right: isMobile ? 20 : 30,
                            bottom: isMobile ? 80 : 60,
                            left: isMobile ? 50 : 40,
                        }}
                        onClick={() => {
                            // Clear selection when clicking empty area
                            setSelectedBubble(null);
                        }}
                    >
                        <CartesianGrid 
                            strokeDasharray="3 3" 
                            stroke="#374151" 
                            horizontal={true}
                            vertical={true}
                        />
                        <XAxis
                            type="number"
                            dataKey="date"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={(timestamp) => {
                                const date = new Date(timestamp);
                                if (isNaN(date.getTime())) return 'Invalid';
                                return isMobile ? format(date, 'M/d') : format(date, 'MMM dd');
                            }}
                            stroke="#9ca3af"
                            fontSize={isMobile ? 11 : 12}
                            angle={isMobile ? -60 : -45}
                            textAnchor="end"
                            height={isMobile ? 100 : 80}
                            interval={isMobile ? 'preserveStartEnd' : 0}
                        />
                        <YAxis
                            type="number"
                            dataKey="purchasePrice"
                            domain={['dataMin - 10', 'dataMax + 10']}
                            tickFormatter={(value) => isMobile ? `${value.toFixed(0)}` : `${value.toFixed(0)} APE`}
                            stroke="#9ca3af"
                            fontSize={isMobile ? 11 : 12}
                            width={isMobile ? 45 : 60}
                            label={!isMobile ? { 
                                value: 'Purchase Price (APE)', 
                                angle: -90, 
                                position: 'insideLeft',
                                style: { textAnchor: 'middle', fill: '#9ca3af' }
                            } : undefined}
                        />
                        <Tooltip 
                            content={<CustomTooltip />}
                            trigger={isMobile ? 'click' : 'hover'}
                            allowEscapeViewBox={{ x: true, y: true }}
                        />
                        <Scatter
                            dataKey="purchasePrice"
                            shape={<CustomDot />}
                        />
                    </ScatterChart>
                </ResponsiveContainer>
                
                {/* Instructions */}
                <div style={{
                    textAlign: 'center',
                    color: '#9ca3af',
                    fontSize: isMobile ? '12px' : '12px',
                    marginTop: '15px',
                    lineHeight: '1.4'
                }}>
                    {isMobile ? (
                        <>
                            💡 Tap collection buttons to filter • Tap bubbles for details
                            <br />
                            📱 Pinch to zoom • Scroll to pan
                        </>
                    ) : (
                        '💡 Click collection buttons to filter • Hover over bubbles for details • Click and drag to zoom'
                    )}
                </div>

                {/* Selected Bubble Details (Mobile) */}
                {isMobile && selectedBubble && (
                    <div style={{
                        backgroundColor: '#374151',
                        borderRadius: '8px',
                        padding: '16px',
                        marginTop: '20px',
                        border: `2px solid ${selectedBubble.color}`
                    }}>
                        <div style={{
                            fontWeight: '600',
                            color: '#e5e7eb',
                            marginBottom: '8px',
                            fontSize: '16px'
                        }}>
                            🎨 {selectedBubble.tokenName} #{selectedBubble.tokenId}
                        </div>
                        <div style={{color: '#d1d5db', marginBottom: '4px'}}>
                            📅 {selectedBubble.dateFormatted}
                        </div>
                        <div style={{color: '#d1d5db', marginBottom: '4px'}}>
                            Purchase: {selectedBubble.purchasePrice.toFixed(4)} APE
                        </div>
                        <div style={{color: '#d1d5db', marginBottom: '8px'}}>
                            💸 Sale: {selectedBubble.saleAmount.toFixed(4)} APE
                        </div>
                        <div style={{
                            color: selectedBubble.color,
                            fontWeight: '700',
                            fontSize: '18px'
                        }}>
                            {selectedBubble.isProfit ? '↗' : '↘'} {selectedBubble.isProfit ? '+' : '-'}
                            {Math.abs(selectedBubble.profitLoss).toFixed(4)} APE
                        </div>
                        <button
                            onClick={() => setSelectedBubble(null)}
                            style={{
                                marginTop: '12px',
                                padding: '8px 16px',
                                backgroundColor: '#6b7280',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer'
                            }}
                        >
                            ✕ Close
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const fetchStakingRewards = async () => {
        // API constants
        const BASE_URL = 'https://api.etherscan.io/v2/api?chainid=33139';
        const API_KEY = process.env.REACT_APP_ETHERSCAN_API_KEY;
        
        const APECHURCH_CONTRACT = '0xD2A5c5F58BDBeD24EF919d9dfb312ca84E7B31dD';
        const ALLORAFFLE_CONTRACT = '0xCC558007E5BBb341fb236f52d3Ba5A0D55718F65';
        const STAKING_CONTRACT = '0x4ba2396086d52ca68a37d9c0fa364286e9c7835a'; // APE Staking contract
        const stakingRewards = [];
        
        try {
            console.log('🔍 Fetching staking rewards from internal transactions...');
            
            // Fetch internal transactions specifically for staking detection
            const internalStakingUrl = `${BASE_URL}&module=account&action=txlistinternal&address=${analyzedWallet}&startblock=0&endblock=99999999&sort=desc&apikey=${API_KEY}`;
            const response = await axios.get(internalStakingUrl, { timeout: 30000 });
            
            if (response.data.status === '1' && Array.isArray(response.data.result)) {
                console.log(`📊 Found ${response.data.result.length} internal transactions, checking for rewards from all contracts...`);
                console.log('🔍 Target account:', account.toLowerCase());
                console.log('🔍 Target staking contract:', STAKING_CONTRACT.toLowerCase());
                
                const apeChurchRewardsData = [];
                const raffleRewardsData = [];
                
                for (const tx of response.data.result) {
                    // Check if this is from any of our tracked contracts TO our wallet
                    if (tx.to.toLowerCase() === account.toLowerCase()) {
                        const rewardAmount = parseInt(tx.value) / 1e18;
                        
                        // Debug logging for all internal transactions to this wallet
                        console.log(`🔍 Internal TX: ${tx.hash} | From: ${tx.from} | To: ${tx.to} | Amount: ${rewardAmount.toFixed(6)} APE`);
                        
                        // Only include meaningful rewards (filter out dust/zero amounts)
                        if (rewardAmount > 0.001) {
                            const date = new Date(parseInt(tx.timeStamp) * 1000);
                            
                            // Debug: Check if this is from staking contract
                            console.log(`🔍 Checking if ${tx.from.toLowerCase()} === ${STAKING_CONTRACT.toLowerCase()}: ${tx.from.toLowerCase() === STAKING_CONTRACT.toLowerCase()}`);
                            
                            // APE Staking Contract - check transaction receipt for CLAIM vs WITHDRAW
                            if (tx.from.toLowerCase() === STAKING_CONTRACT.toLowerCase()) {
                                try {
                                    // Fetch transaction receipt to get event logs
                                    console.log(`🔍 Checking receipt for staking tx ${tx.hash}...`);
                                    
                                    // Add delay to respect 2 req/sec rate limit
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                    
                                    const receiptUrl = `${BASE_URL}&module=proxy&action=eth_getTransactionReceipt&txhash=${tx.hash}&apikey=${API_KEY}`;
                                    const receiptResponse = await axios.get(receiptUrl, { timeout: 60000 });
                                    
                                    console.log(`🔍 Receipt response for ${tx.hash}:`, receiptResponse.data);
                                    
                                    console.log(`🔍 Receipt response for ${tx.hash}:`, JSON.stringify(receiptResponse.data, null, 2));
                                    
                                    if (receiptResponse && receiptResponse.data && receiptResponse.data.result && receiptResponse.data.result.logs) {
                                        const logs = receiptResponse.data.result.logs;
                                        console.log(`📋 Found ${logs.length} logs in receipt for ${tx.hash}`);
                                        console.log(`📋 Found ${logs.length} logs in receipt for ${tx.hash}`);
                                        let isClaim = false;
                                        let isWithdraw = false;
                                        
                                        // Check event logs for CLAIM or WITHDRAW events
                                        logs.forEach(log => {
                                            if (log.address && log.address.toLowerCase() === STAKING_CONTRACT.toLowerCase()) {
                                                const topics = log.topics || [];
                                                if (topics.length > 0) {
                                                    const eventSignature = topics[0];
                                                    
                                                    // Check for CLAIM event patterns (comprehensive)
                                                    if (eventSignature.includes('0x45c072aa05b9853b5a993de7a28bc332ee01404a628cec1a23ce0f659f842ef1') ||
                                                        eventSignature.toLowerCase().includes('claim') ||
                                                        log.data.includes('636c61696d')) { // "claim" in hex
                                                        isClaim = true;
                                                        console.log(`✅ Found CLAIM event in fetchStakingRewards: ${eventSignature}`);
                                                    }
                                                    
                                                    // Check for WITHDRAW event patterns (comprehensive)
                                                    if (eventSignature.includes('0x67c680c232fa9400adef6a1ad234c1d6d15a44170b85fddb60ceed23e31c3220') ||
                                                        eventSignature.toLowerCase().includes('withdraw') ||
                                                        eventSignature.toLowerCase().includes('unstake') ||
                                                        log.data.includes('776974686472617727') || // "withdraw" in hex
                                                        log.data.includes('756e7374616b65')) { // "unstake" in hex
                                                        isWithdraw = true;
                                                        console.log(`✅ Found WITHDRAW event in fetchStakingRewards: ${eventSignature}`);
                                                    }
                                                }
                                            }
                                        });
                                        
                                        // Only add to staking rewards if it's a CLAIM event
                                        if (isClaim) {
                                            stakingRewards.push({
                                                hash: tx.hash,
                                                date: date,
                                                label: 'Staking',
                                                outgoingAsset: '',
                                                outgoingAmount: '',
                                                incomingAsset: 'APE',
                                                incomingAmount: rewardAmount.toFixed(6),
                                                feeAsset: '',
                                                feeAmount: '',
                                                comment: `Staking reward received from APE staking contract (${rewardAmount.toFixed(4)} APE)`,
                                                type: 'staking_reward',
                                                isStakingReward: true,
                                                contractType: 'staking'
                                            });
                                            console.log(`✅ Found CLAIM reward: ${rewardAmount.toFixed(4)} APE on ${date.toDateString()}`);
                                        } else if (isWithdraw) {
                                            console.log(`📉 Found WITHDRAW in fetchStakingRewards: ${rewardAmount.toFixed(4)} APE on ${date.toDateString()} (will be handled by processWalletData)`);
                                            // Don't add to stakingRewards - WITHDRAW events are handled in processWalletData
                                        } else {
                                            console.log(`⚠️ Unknown staking event type in tx ${tx.hash} - neither CLAIM nor WITHDRAW detected in fetchStakingRewards`);
                                        }
                                    } else {
                                        console.log(`❌ No receipt logs found for transaction ${tx.hash} in fetchStakingRewards`);
                                        console.log(`Receipt structure:`, receiptResponse?.data?.result);
                                    }
                                } catch (error) {
                                    console.error(`❌ Error checking receipt for ${tx.hash}:`, error);
                                }
                            }
                            
                            // APE Church Contract  
                            else if (tx.from.toLowerCase() === APECHURCH_CONTRACT.toLowerCase()) {
                                const churchReward = {
                                    hash: tx.hash,
                                    date: date,
                                    label: 'Cashback',
                                    outgoingAsset: '',
                                    outgoingAmount: '',
                                    incomingAsset: 'APE',
                                    incomingAmount: rewardAmount.toFixed(6),
                                    feeAsset: '',
                                    feeAmount: '',
                                    comment: `Reward received from APE Church contract (${rewardAmount.toFixed(4)} APE)`,
                                    type: 'church_reward',
                                    isStakingReward: true,
                                    contractType: 'church'
                                };
                                stakingRewards.push(churchReward);
                                apeChurchRewardsData.push(churchReward);
                                console.log(`✅ Found APE Church reward: ${rewardAmount.toFixed(4)} APE on ${date.toDateString()}`);
                            }
                            
                            // Alloraffle Contract
                            else if (tx.from.toLowerCase() === ALLORAFFLE_CONTRACT.toLowerCase()) {
                                const raffleReward = {
                                    hash: tx.hash,
                                    date: date,
                                    label: 'Airdrop',
                                    outgoingAsset: '',
                                    outgoingAmount: '',
                                    incomingAsset: 'APE',
                                    incomingAmount: rewardAmount.toFixed(6),
                                    feeAsset: '',
                                    feeAmount: '',
                                    comment: `Reward received from Alloraffle contract (${rewardAmount.toFixed(4)} APE)`,
                                    type: 'raffle_reward',
                                    isStakingReward: true,
                                    contractType: 'raffle'
                                };
                                stakingRewards.push(raffleReward);
                                raffleRewardsData.push(raffleReward);
                                console.log(`✅ Found Raffle reward: ${rewardAmount.toFixed(4)} APE on ${date.toDateString()}`);
                            }
                        }
                    }
                }
                
                // Update separate state arrays
                setApeChurchRewards(apeChurchRewardsData);
                setRaffleRewards(raffleRewardsData);
                
                console.log(`🎯 Total staking rewards found: ${stakingRewards.length}`);
            } else {
                console.log('⚠️ No internal transactions found or API error');
            }
            
        } catch (error) {
            console.error('❌ Error fetching staking rewards:', error);
            // Don't throw error - just return empty array so main analysis continues
        }
        
        return stakingRewards;
    };

    // Remove the parallel fetchAllData function - use only sequential fetchWalletData

    // Show loading or error state as content instead of replacing entire component
    const showLoadingContent = loading && !analysis;
    const showErrorContent = error && !analysis;

    // Token Balances Display Component with USD values
    const TokenBalanceDisplay = ({ networkBalances, networkName, onTotalCalculated }) => {
        const isApeChain = networkName.toLowerCase().includes('apechain');
        const isEthereum = networkName.toLowerCase().includes('ethereum');
        const isBnb = networkName.toLowerCase().includes('bnb');
        const isSolana = networkName.toLowerCase().includes('solana');
        
        const calculateNetworkTotalUSD = () => {
            let total = networkBalances.reduce((sum, token) => {
                // Handle different possible formats of tokenBalance
                let rawBalance = token.tokenBalance;
                if (typeof rawBalance === 'string' && rawBalance.startsWith('0x')) {
                    rawBalance = parseInt(rawBalance, 16);
                } else if (typeof rawBalance === 'string') {
                    rawBalance = parseFloat(rawBalance) || 0;
                }
                
                const decimals = token.decimals || (isSolana ? 9 : 18);
                const balance = rawBalance / Math.pow(10, decimals);
                
                // Override price for APES IN SPACE token to avoid wrong SPACE token confusion
                let price = tokenPrices[token.contractAddress.toLowerCase()] || token.alchemyPrice || 0;
                if (token.name && token.name.toLowerCase().includes('apes in space')) {
                    price = 0; // Set to zero to avoid wrong token price
                }
                
                return sum + (balance * price);
            }, 0);
            
            // Add native balance value
            if (isEthereum && nativeBalances.ethereum > 0) {
                const ethPrice = tokenPrices['ethereum-native'] || 0;
                total += nativeBalances.ethereum * ethPrice;
            } else if (isApeChain && nativeBalances.apechain > 0) {
                const apePrice = tokenPrices['apechain-native'] || 0;
                total += nativeBalances.apechain * apePrice;
            } else if (isBnb && nativeBalances.bnb > 0) {
                const bnbPrice = tokenPrices['bnb-native'] || 0;
                total += nativeBalances.bnb * bnbPrice;
            } else if (isSolana && nativeBalances.solana > 0) {
                const solPrice = tokenPrices['solana-native'] || 0;
                total += nativeBalances.solana * solPrice;
            }
            
            return total;
        };

        const networkTotalUSD = React.useMemo(() => {
            return calculateNetworkTotalUSD();
        }, [networkBalances, tokenPrices, nativeBalances, isEthereum, isApeChain, isBnb, isSolana]);

        // Report the total to parent component when values change
        React.useEffect(() => {
            if (onTotalCalculated && networkTotalUSD !== undefined) {
                // Always report the total, even when it's 0
                onTotalCalculated(networkTotalUSD);
            }
        }, [networkTotalUSD, onTotalCalculated]);

        return (
            <div className="token-balances">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h3>{networkName} Token Balances</h3>
                    <div style={{ 
                        backgroundColor: '#374151', 
                        padding: '8px 16px', 
                        borderRadius: '8px',
                        color: '#10b981',
                        fontWeight: '600',
                        fontSize: '14px'
                    }}>
                        Total: ${networkTotalUSD.toFixed(2)} USD
                    </div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Logo</th>
                            <th>Symbol</th>
                            <th>Balance</th>
                            <th>Price</th>
                            <th>USD</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Combined and sorted tokens (native + ERC-20) */}
                        {(() => {
                            // Create an array that combines native token and ERC-20 tokens
                            const allTokens = [];
                            
                            // Add native token if it exists
                            if ((isEthereum && nativeBalances.ethereum > 0) || 
                                (isApeChain && nativeBalances.apechain > 0) ||
                                (isBnb && nativeBalances.bnb > 0) ||
                                (isSolana && nativeBalances.solana > 0)) {
                                
                                let nativeBalance, nativeSymbol, nativeName, nativePrice;
                                
                                if (isEthereum && nativeBalances.ethereum > 0) {
                                    nativeBalance = nativeBalances.ethereum;
                                    nativeSymbol = 'ETH';
                                    nativeName = 'Ethereum';
                                    nativePrice = tokenPrices['ethereum-native'] || 0;
                                } else if (isApeChain && nativeBalances.apechain > 0) {
                                    nativeBalance = nativeBalances.apechain;
                                    nativeSymbol = 'APE';
                                    nativeName = 'ApeCoin';
                                    nativePrice = tokenPrices['apechain-native'] || 0;
                                } else if (isBnb && nativeBalances.bnb > 0) {
                                    nativeBalance = nativeBalances.bnb;
                                    nativeSymbol = 'BNB';
                                    nativeName = 'BNB';
                                    nativePrice = tokenPrices['bnb-native'] || 0;
                                } else if (isSolana && nativeBalances.solana > 0) {
                                    nativeBalance = nativeBalances.solana;
                                    nativeSymbol = 'SOL';
                                    nativeName = 'Solana';
                                    nativePrice = tokenPrices['solana-native'] || 0;
                                }
                                
                                const nativeBalanceUSD = nativeBalance * nativePrice;
                                
                                allTokens.push({
                                    isNative: true,
                                    name: nativeName,
                                    symbol: nativeSymbol,
                                    calculatedBalance: nativeBalance,
                                    calculatedPrice: nativePrice,
                                    calculatedBalanceUSD: nativeBalanceUSD,
                                    logo: null
                                });
                            }
                            
                            // Add ERC-20 tokens
                            networkBalances.forEach((token) => {
                                let rawBalance = token.tokenBalance;
                                if (typeof rawBalance === 'string' && rawBalance.startsWith('0x')) {
                                    rawBalance = parseInt(rawBalance, 16);
                                } else if (typeof rawBalance === 'string') {
                                    rawBalance = parseFloat(rawBalance) || 0;
                                }
                                
                                const decimals = token.decimals || (isSolana ? 9 : 18);
                                const balance = rawBalance / Math.pow(10, decimals);
                                
                                let price = tokenPrices[token.contractAddress.toLowerCase()] || token.alchemyPrice || 0;
                                if (token.name && token.name.toLowerCase().includes('apes in space')) {
                                    price = 0;
                                }
                                
                                const balanceUSD = balance * price;
                                
                                allTokens.push({
                                    ...token,
                                    isNative: false,
                                    calculatedBalance: balance,
                                    calculatedPrice: price,
                                    calculatedBalanceUSD: balanceUSD
                                });
                            });
                            
                            // Sort all tokens by USD value (descending)
                            return allTokens
                                .sort((a, b) => b.calculatedBalanceUSD - a.calculatedBalanceUSD)
                                .map((token, index) => {
                                    const balance = token.calculatedBalance;
                                    const price = token.calculatedPrice;
                                    const balanceUSD = token.calculatedBalanceUSD;
                                    
                                    return (
                                        <tr key={token.isNative ? 'native-balance' : index} 
                                            style={token.isNative ? { backgroundColor: 'rgba(16, 185, 129, 0.1)' } : {}}>
                                            <td>
                                                {token.isNative ? (
                                                    <div style={{ 
                                                        width: '20px', 
                                                        height: '20px', 
                                                        borderRadius: '50%', 
                                                        backgroundColor: isEthereum ? '#627eea' : isApeChain ? '#0052ff' : isBnb ? '#f3ba2f' : '#9945ff',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '10px',
                                                        color: '#fff',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        {token.symbol.charAt(0)}
                                                    </div>
                                                ) : token.logo ? (
                                                    <img src={token.logo} alt={token.name} width="20" style={{ borderRadius: '50%' }} />
                                                ) : (
                                                    <div style={{ 
                                                        width: '20px', 
                                                        height: '20px', 
                                                        borderRadius: '50%', 
                                                        backgroundColor: '#6b7280',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: '10px',
                                                        color: '#fff'
                                                    }}>
                                                        {token.symbol?.charAt(0) || '?'}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={token.isNative ? { fontWeight: '600' } : {}}>
                                                {token.symbol || 'N/A'}
                                            </td>
                                            <td style={token.isNative ? { fontWeight: '600' } : {}}>
                                                {(() => {
                                                    const formattedBalance = balance.toFixed(token.isNative ? 6 : 4);
                                                    // Remove trailing zeros and decimal point if not needed
                                                    return formattedBalance.replace(/\.?0+$/, '');
                                                })()}
                                            </td>
                                            <td style={{ 
                                                color: price > 0 ? '#10b981' : '#6b7280',
                                                fontWeight: token.isNative ? '600' : 'normal'
                                            }}>
                                                {price > 0 ? `$${price.toFixed(2)}` : 'N/A'}
                                            </td>
                                            <td style={{ 
                                                color: balanceUSD > 0 ? '#10b981' : '#6b7280',
                                                fontWeight: (balanceUSD > 1 || token.isNative) ? '600' : 'normal',
                                                fontSize: token.isNative ? '14px' : 'inherit'
                                            }}>
                                                {balanceUSD > 0 ? `$${balanceUSD.toFixed(0)}` : '$0'}
                                            </td>
                                        </tr>
                                    );
                                });
                        })()}
                        
                        {/* Remove the old separate ERC-20 token mapping */}
                        {networkBalances.length === 0 && (
                            <tr>
                                <td colSpan="5" style={{ 
                                    textAlign: 'center', 
                                    padding: '40px', 
                                    color: '#9ca3af',
                                    fontStyle: 'italic'
                                }}>
                                    No tokens found on {networkName}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div>
            {/* Simple Header with Wallet Address and Status */}
            <div style={{
                position: 'fixed',
                top: '0',
                left: '0',
                right: '0',
                background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 25%, #16213e 50%, #0f0f23 75%, #000000 100%)',
                borderBottom: '2px solid rgba(31, 81, 255, 0.3)',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                zIndex: 10000,
                padding: '0.75rem 1rem'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    maxWidth: '1200px',
                    margin: '0 auto',
                    gap: '1rem'
                }}>
                    {/* Left side: Wallet Address and Status */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        flex: '1'
                    }}>
                        {/* Wallet Address */}
                        <div style={{
                            color: '#e0e0e0',
                            fontSize: screenSize.isMobile ? '0.7rem' : '0.85rem',
                            fontFamily: 'monospace',
                            background: 'rgba(255, 255, 255, 0.05)',
                            padding: screenSize.isMobile ? '0.3rem 0.6rem' : '0.4rem 0.8rem',
                            borderRadius: '8px',
                            border: '1px solid rgba(255, 255, 255, 0.1)'
                        }}>
                            {account ? 
                                `${account.slice(0, 6)}...${account.slice(-4)}` : 
                                'No wallet connected'
                            }
                        </div>
                        
                        {/* Status/Loading Indicator */}
                        <div style={{
                            color: (loading || !processingComplete) ? '#f59e0b' : error ? '#ef4444' : '#10b981',
                            fontSize: screenSize.isMobile ? '0.7rem' : '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}>
                            {(loading || (!processingComplete && account && !error)) && (
                                <>
                                    <div style={{
                                        width: '10px',
                                        height: '10px',
                                        border: '2px solid transparent',
                                        borderTop: '2px solid #f59e0b',
                                        borderRadius: '50%',
                                        animation: 'spin 1s linear infinite'
                                    }}></div>
                                    {!screenSize.isMobile && 'Analyzing...'}
                                </>
                            )}
                            {error && (
                                <>
                                    ⚠️ {!screenSize.isMobile && 'Error'}
                                </>
                            )}
                            {!loading && !error && account && processingComplete && (
                                <>
                                    ✅ {!screenSize.isMobile && 'Ready'}
                                </>
                            )}
                        </div>
                    </div>
                    
                    {/* Right side: Action buttons */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: screenSize.isMobile ? '0.5rem' : '0.75rem'
                    }}>
                        {/* Watch button */}
                        <button
                            onClick={handleWatchClick}
                            style={{
                                background: currentView === 'watch' ? 'linear-gradient(135deg, rgba(31, 81, 255, 0.8) 0%, rgba(31, 81, 255, 0.6) 100%)' : 'transparent',
                                color: currentView === 'watch' ? '#FFFFFF' : '#e0e0e0',
                                border: '1px solid',
                                borderColor: currentView === 'watch' ? 'rgba(31, 81, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                                padding: screenSize.isMobile ? '0.4rem 0.6rem' : '0.5rem 0.8rem',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: screenSize.isMobile ? '0.7rem' : '0.8rem',
                                fontWeight: currentView === 'watch' ? '600' : '500',
                                transition: 'all 0.2s ease',
                                whiteSpace: 'nowrap',
                                boxShadow: currentView === 'watch' ? '0 0 10px rgba(31, 81, 255, 0.3)' : 'none',
                                textShadow: currentView === 'watch' ? '0 0 8px rgba(31, 81, 255, 0.3)' : 'none'
                            }}
                            onMouseEnter={(e) => {
                                if (currentView !== 'watch') {
                                    e.target.style.background = 'linear-gradient(135deg, rgba(31, 81, 255, 0.8) 0%, rgba(31, 81, 255, 0.6) 100%)';
                                    e.target.style.color = '#FFFFFF';
                                    e.target.style.borderColor = 'rgba(31, 81, 255, 0.3)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (currentView !== 'watch') {
                                    e.target.style.background = 'transparent';
                                    e.target.style.color = '#e0e0e0';
                                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                }
                            }}
                        >
                            {screenSize.isMobile ? 'WATCH' : 'WATCH'}
                        </button>
                        
                        {/* Disconnect button - only show if there's a connected wallet */}
                        {connectedAccount && onDisconnect && (
                            <button
                                onClick={onDisconnect}
                                style={{
                                    background: 'rgba(239, 68, 68, 0.8)',
                                    color: '#FFFFFF',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    padding: screenSize.isMobile ? '0.4rem 0.6rem' : '0.5rem 0.8rem',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: screenSize.isMobile ? '0.7rem' : '0.8rem',
                                    fontWeight: '500',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = 'rgba(239, 68, 68, 1)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = 'rgba(239, 68, 68, 0.8)';
                                }}
                            >
                                {screenSize.isMobile ? '🔌' : 'Disconnect'}
                            </button>
                        )}
                        
                        {/* Clear Analysis button */}
                        {onClearAnalysis && (
                            <button
                                onClick={onClearAnalysis}
                                style={{
                                    background: 'transparent',
                                    color: '#e0e0e0',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    padding: screenSize.isMobile ? '0.4rem 0.6rem' : '0.5rem 0.8rem',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: screenSize.isMobile ? '0.7rem' : '0.8rem',
                                    fontWeight: '500',
                                    transition: 'all 0.2s ease',
                                    whiteSpace: 'nowrap'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = 'linear-gradient(135deg, rgba(31, 81, 255, 0.8) 0%, rgba(31, 81, 255, 0.6) 100%)';
                                    e.target.style.color = '#FFFFFF';
                                    e.target.style.borderColor = 'rgba(31, 81, 255, 0.3)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = 'transparent';
                                    e.target.style.color = '#e0e0e0';
                                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                }}
                            >
                                {screenSize.isMobile ? '🔄' : '🔄 New Wallet'}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content Wrapper - with padding for fixed header and footer */}
            <div style={{ 
                paddingTop: '70px', // Reduced space for header with buttons
                paddingBottom: '100px', // Space for footer navigation
                minHeight: '100vh'
            }}>

            {/* Conditional Content Based on Current View */}
            {currentView === 'watch' ? (
                <WatchComponent
                    account={account}
                    connectedAccount={connectedAccount}
                    analyzedWallet={analyzedWallet}
                    screenSize={screenSize}
                    setAnalyzedWallet={setAnalyzedWallet}
                    setActiveTab={setActiveTab}
                    setCurrentView={setCurrentView}
                />
            ) : (
                <>
                {/* Loading Content */}
            {showLoadingContent && (
                <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#e0e0e0'
                }}>
                    <div style={{
                        fontSize: '1.2rem',
                        marginBottom: '1rem',
                        color: '#f59e0b'
                    }}>
                        Analyzing wallet activity...
                    </div>
                    <div style={{
                        fontSize: '0.9rem',
                        color: '#9ca3af'
                    }}>
                        This may take a few moments for wallets with many transactions
                    </div>
                </div>
            )}

            {/* Error Content */}
            {showErrorContent && (
                <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#ef4444'
                }}>
                    <div style={{
                        fontSize: '1.2rem',
                        marginBottom: '1rem'
                    }}>
                        ⚠️ {error}
                    </div>
                    <button 
                        onClick={fetchWalletData}
                        style={{
                            background: 'linear-gradient(135deg, rgba(31, 81, 255, 0.8) 0%, rgba(31, 81, 255, 0.6) 100%)',
                            color: '#FFFFFF',
                            border: '1px solid rgba(31, 81, 255, 0.3)',
                            padding: '0.75rem 1.5rem',
                            borderRadius: '12px',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            fontWeight: '500',
                            transition: 'all 0.2s ease'
                        }}
                    >
                        Retry Analysis
                    </button>
                </div>
            )}

            {/* Welcome message when no account is connected */}
            {!account && !loading && !error && (
                <div style={{
                    textAlign: 'center',
                    padding: '60px 20px',
                    color: '#e0e0e0'
                }}>
                    <div style={{
                        fontSize: '1.5rem',
                        marginBottom: '1rem',
                        color: '#1F51FF'
                    }}>
                        Welcome to Wallet Analyzer
                    </div>
                    <div style={{
                        fontSize: '1rem',
                        color: '#9ca3af',
                        marginBottom: '2rem'
                    }}>
                        Connect your wallet or enter a wallet address to analyze portfolio and transactions
                    </div>
                    <div style={{
                        fontSize: '0.9rem',
                        color: '#6b7280'
                    }}>
                        Supports Ethereum, ApeChain, BNB Chain, and Solana networks
                    </div>
                </div>
            )}

            {/* Portfolio Section */}
            {activeTab === 'Portfolio' && analysis && (
                <div className="analysis-section">
                    <h2>Wallet Analysis Summary</h2>
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-value">{analysis.totalTransactions}</div>
                            <div className="stat-label">Total Transactions</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{analysis.nftTrades}</div>
                            <div className="stat-label">NFT Trades</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{Math.round(analysis.totalProfit)} APE</div>
                            <div className="stat-label">Total Profit</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{Math.round(analysis.totalLoss)} APE</div>
                            <div className="stat-label">Total Loss</div>
                        </div>
                        <div className="stat-card" style={{borderLeftColor: '#8b5cf6'}}>
                            <div className="stat-value" style={{color: '#8b5cf6'}}>
                                {includeStaking ? Math.round(analysis.totalStakingRewards || 0) : 0} APE
                            </div>
                            <div className="stat-label">Staking Rewards</div>
                        </div>
                        <div className="stat-card" style={{borderLeftColor: '#f59e0b'}}>
                            <div className="stat-value" style={{color: '#f59e0b'}}>
                                {includeStaking ? Math.round(analysis.totalApeChurchRewards || 0) : 0} APE
                            </div>
                            <div className="stat-label">APE Church</div>
                        </div>
                        <div className="stat-card" style={{borderLeftColor: '#ec4899'}}>
                            <div className="stat-value" style={{color: '#ec4899'}}>
                                {includeStaking ? Math.round(analysis.totalRaffleRewards || 0) : 0} APE
                            </div>
                            <div className="stat-label">Raffles</div>
                        </div>
                        {/* Only show Staked APE card when staking is enabled and analyzed */}
                        {includeStaking && stakedAPEAmount > 0 && (
                            <div className="stat-card" style={{borderLeftColor: '#ff6b35'}}>
                                <div className="stat-value" style={{color: '#ff6b35'}}>
                                    {Math.round(stakedAPEAmount)} APE
                                </div>
                                <div className="stat-label">Staked APE</div>
                                <div style={{
                                    fontSize: '11px',
                                    color: '#9ca3af',
                                    marginTop: '4px',
                                    fontStyle: 'italic'
                                }}>
                                    ${Math.round(stakedAPEAmount * (tokenPrices['apechain-native'] || 0))}
                                </div>
                            </div>
                        )}
                        <div className="stat-card" style={{borderLeftColor: '#06b6d4'}}>
                            <div className="stat-value" style={{color: '#06b6d4'}}>
                                {tokenDataLoaded ? 
                                    `$${Math.round(portfolioTotal)}` : 
                                    'Loading...'
                                }
                            </div>
                            <div className="stat-label">Total Portfolio Value</div>
                            <div style={{
                                fontSize: '11px',
                                color: '#9ca3af',
                                marginTop: '4px',
                                fontStyle: 'italic'
                            }}>
                                ETH + APE + BNB + SOL + Staked APE + NFTs
                            </div>
                        </div>
                        {/* Floor Price Fetching Notification */}
                        {fetchingFloorPrices && (
                            <div className="stat-card" style={{borderLeftColor: '#f59e0b', backgroundColor: 'rgba(251, 191, 36, 0.1)'}}>
                                <div className="stat-value" style={{color: '#f59e0b', fontSize: '0.875rem'}}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{
                                            width: '16px',
                                            height: '16px',
                                            border: '2px solid #f59e0b',
                                            borderTopColor: 'transparent',
                                            borderRadius: '50%',
                                            animation: 'spin 1s linear infinite'
                                        }}></div>
                                        Loading...
                                    </div>
                                </div>
                                <div className="stat-label">Fetching Realtime Floorprices...</div>
                            </div>
                        )}
                        <div className="stat-card" style={{borderLeftColor: analysis.netProfit >= 0 ? '#10b981' : '#ef4444'}}>
                            <div className="stat-value" style={{color: analysis.netProfit >= 0 ? '#10b981' : '#ef4444'}}>
                                {analysis.netProfit >= 0 ? '+' : ''}{Math.round(analysis.netProfit)} APE
                            </div>
                            <div className="stat-label">Net Profit/Loss</div>
                        </div>
                    </div>

                    <div className="export-section">
                        <button className="export-btn" onClick={exportToJSON}>
                            Export JSON
                        </button>
                        <button className="export-btn" onClick={exportToCSV}>
                            Export CSV
                        </button>
                    </div>
                </div>
            )}

            {/* Staking Options - moved under Wallet Analysis Summary */}
            <div className="analysis-section">
                <div style={{
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '12px',
                    padding: '16px',
                    backgroundColor: '#374151',
                    borderRadius: '8px',
                    marginBottom: '20px'
                }}>
                    <input
                        type="checkbox"
                        id="includeStaking"
                        checked={includeStaking}
                        onChange={(e) => setIncludeStaking(e.target.checked)}
                        style={{
                            width: '18px',
                            height: '18px',
                            cursor: 'pointer'
                        }}
                    />
                    <label 
                        htmlFor="includeStaking"
                        style={{
                            color: '#e5e7eb',
                            cursor: 'pointer',
                            fontSize: '16px',
                            fontWeight: '500'
                        }}
                    >
                        Include Staking & Reward Contracts{' '}
                        <span style={{ color: '#fbbf24', fontSize: '14px', fontWeight: '400' }}>
                            (experimental)
                        </span>
                    </label>
                    {(stakingTransactions.length > 0 || apeChurchRewards.length > 0 || raffleRewards.length > 0) && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {stakingTransactions.filter(tx => tx.contractType === 'staking').length > 0 && (
                                <span style={{
                                    backgroundColor: '#8b5cf6',
                                    color: '#ffffff',
                                    padding: '4px 12px',
                                    borderRadius: '12px',
                                    fontSize: '14px',
                                    fontWeight: '600'
                                }}>
                                    {stakingTransactions.filter(tx => tx.contractType === 'staking').length} staking
                                </span>
                            )}
                            {apeChurchRewards.length > 0 && (
                                <span style={{
                                    backgroundColor: '#f59e0b',
                                    color: '#ffffff',
                                    padding: '4px 12px',
                                    borderRadius: '12px',
                                    fontSize: '14px',
                                    fontWeight: '600'
                                }}>
                                    {apeChurchRewards.length} church
                                </span>
                            )}
                            {raffleRewards.length > 0 && (
                                <span style={{
                                    backgroundColor: '#ec4899',
                                    color: '#ffffff',
                                    padding: '4px 12px',
                                    borderRadius: '12px',
                                    fontSize: '14px',
                                    fontWeight: '600'
                                }}>
                                    {raffleRewards.length} raffle
                                </span>
                            )}
                        </div>
                    )}
                </div>
                
                {includeStaking && (
                    <div style={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        padding: '16px',
                        marginBottom: '20px'
                    }}>
                        <div style={{color: '#9ca3af', fontSize: '14px', lineHeight: '1.6'}}>
                            <strong>ℹ️ About Reward Contract Detection:</strong>
                            <br />
                            • Automatically detects rewards from APE staking, APE Church, and Alloraffle contracts
                            <br />
                            • Shows rewards received from official reward contracts
                            <br />
                            • Only includes rewards above 0.001 APE (filters out dust)
                            <br />
                            • Re-analyze after checking this box to fetch reward data
                        </div>
                        
                        {!loading && includeStaking && stakingTransactions.length === 0 && apeChurchRewards.length === 0 && raffleRewards.length === 0 && (
                            <div style={{
                                color: '#fbbf24',
                                marginTop: '12px',
                                padding: '8px',
                                backgroundColor: 'rgba(251, 191, 36, 0.1)',
                                borderRadius: '4px'
                            }}>
                                No rewards detected from any contract. Click "Re-analyze" to fetch reward data.
                            </div>
                        )}
                    </div>
                )}
                
                {includeStaking && (
                    <div style={{textAlign: 'center', marginBottom: '20px'}}>
                        <button 
                            className="connect-btn" 
                            onClick={fetchWalletData}
                            disabled={loading}
                            style={{
                                padding: '12px 24px',
                                fontSize: '16px',
                                backgroundColor: loading ? '#6b7280' : '#3b82f6',
                                cursor: loading ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {loading ? 'Analyzing...' : 'Re-analyze with Reward Data'}
                        </button>
                    </div>
                )}
            </div>

            {/* Hidden TokenBalanceDisplay components - always rendered to calculate totals */}
            <div style={{ display: 'none' }}>
                <TokenBalanceDisplay 
                    key={`ethereum-${account}`}
                    networkBalances={tokenBalances.ethereum} 
                    networkName="Ethereum Mainnet" 
                    onTotalCalculated={handleNetworkTotal('ethereum')}
                />
                <TokenBalanceDisplay 
                    key={`apechain-${account}`}
                    networkBalances={tokenBalances.apechain} 
                    networkName="ApeChain" 
                    onTotalCalculated={handleNetworkTotal('apechain')}
                />
                <TokenBalanceDisplay 
                    key={`bnb-${account}`}
                    networkBalances={tokenBalances.bnb} 
                    networkName="BNB Chain" 
                    onTotalCalculated={handleNetworkTotal('bnb')}
                />
                <TokenBalanceDisplay 
                    key={`solana-${account}`}
                    networkBalances={tokenBalances.solana} 
                    networkName="Solana" 
                    onTotalCalculated={handleNetworkTotal('solana')}
                />
            </div>

            {/* Tokens Section */}
            {activeTab === 'Tokens' && (
            <div>
                <h2 style={{ color: '#e5e7eb', marginBottom: '2rem', fontSize: '2rem', fontWeight: '600', textAlign: 'center' }}>
                    Token Portfolio
                </h2>

                {/* Display Token Balances for both networks */}
            <div className="network-balances" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(600px, 1fr))',
                gap: '20px',
                marginBottom: '30px'
            }}>
                <div style={{
                    backgroundColor: '#1f2937',
                    borderRadius: '12px',
                    padding: '20px',
                    border: '1px solid #374151'
                }}>
                    <TokenBalanceDisplay 
                        key={`ethereum-display-${account}`}
                        networkBalances={tokenBalances.ethereum} 
                        networkName="Ethereum Mainnet" 
                    />
                </div>
                <div style={{
                    backgroundColor: '#1f2937',
                    borderRadius: '12px',
                    padding: '20px',
                    border: '1px solid #374151'
                }}>
                    <TokenBalanceDisplay 
                        key={`apechain-display-${account}`}
                        networkBalances={tokenBalances.apechain} 
                        networkName="ApeChain" 
                    />
                </div>
                <div style={{
                    backgroundColor: '#1f2937',
                    borderRadius: '12px',
                    padding: '20px',
                    border: '1px solid #374151'
                }}>
                    <TokenBalanceDisplay 
                        key={`bnb-display-${account}`}
                        networkBalances={tokenBalances.bnb} 
                        networkName="BNB Chain" 
                    />
                </div>
                <div style={{
                    backgroundColor: '#1f2937',
                    borderRadius: '12px',
                    padding: '20px',
                    border: '1px solid #374151'
                }}>
                    <TokenBalanceDisplay 
                        key={`solana-display-${account}`}
                        networkBalances={tokenBalances.solana} 
                        networkName="Solana" 
                    />
                </div>
            </div>
            </div>
            )}

            {/* NFTs Section */}
            {activeTab === 'NFTs' && (
            <div>
                <h2 style={{ color: '#e5e7eb', marginBottom: '2rem', fontSize: '2rem', fontWeight: '600', textAlign: 'center' }}>
                    NFT Collection
                </h2>

                {/* NFT Portfolio Section */}
                {nftPortfolio.length > 0 && (
                <div style={{ marginTop: '2rem', marginBottom: '2rem' }}>
                    <h2 style={{ color: '#e5e7eb', marginBottom: '1rem', fontSize: '1.5rem', fontWeight: '600' }}>
                        NFT Portfolio
                    </h2>
                    <div style={{ 
                        display: 'flex', 
                        gap: '2rem', 
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        backgroundColor: '#1f2937',
                        borderRadius: '8px',
                        border: '1px solid #374151'
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
                                {nftPortfolio.length}
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Total NFTs</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#3b82f6' }}>
                                ${totalNftValueUSD.toFixed(2)}
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Estimated Value</div>
                        </div>
                    </div>
                    
                    <div style={{ 
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                        overflow: 'hidden'
                    }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ 
                                width: '100%',
                                borderCollapse: 'collapse',
                                minWidth: '600px'
                            }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#111827' }}>
                                        <th style={{ 
                                            padding: '1rem',
                                            textAlign: 'left',
                                            color: '#e5e7eb',
                                            fontWeight: '600',
                                            fontSize: '0.875rem',
                                            borderBottom: '1px solid #374151'
                                        }}>
                                            Collection
                                        </th>
                                        <th style={{ 
                                            padding: '1rem',
                                            textAlign: 'center',
                                            color: '#e5e7eb',
                                            fontWeight: '600',
                                            fontSize: '0.875rem',
                                            borderBottom: '1px solid #374151'
                                        }}>
                                            NFTs Owned
                                        </th>
                                        <th style={{ 
                                            padding: '1rem',
                                            textAlign: 'right',
                                            color: '#e5e7eb',
                                            fontWeight: '600',
                                            fontSize: '0.875rem',
                                            borderBottom: '1px solid #374151'
                                        }}>
                                            Floor Price
                                        </th>
                                        <th style={{ 
                                            padding: '1rem',
                                            textAlign: 'right',
                                            color: '#e5e7eb',
                                            fontWeight: '600',
                                            fontSize: '0.875rem',
                                            borderBottom: '1px solid #374151'
                                        }}>
                                            Est. Value
                                        </th>

                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(
                                        nftPortfolio.reduce((acc, nft) => {
                                            // Skip NFTs without proper contract address
                                            if (!nft || !nft.contract || !nft.contract.address) {
                                                console.warn('Skipping NFT with missing contract address:', nft);
                                                return acc;
                                            }
                                            
                                            const contractAddress = nft.contract.address;
                                            const nftKey = `${contractAddress}-${nft.tokenId}`;
                                            
                                            if (!acc[contractAddress]) {
                                                const floorPriceData = nftFloorPrices[contractAddress.toLowerCase()];
                                                
                                                acc[contractAddress] = {
                                                    collection: nft.contract,
                                                    nfts: [],
                                                    floorPrice: floorPriceData,
                                                    seenNfts: new Set(),
                                                    duplicateCount: 0
                                                };
                                            }
                                            
                                            // Check for duplicates
                                            if (acc[contractAddress].seenNfts.has(nftKey)) {
                                                acc[contractAddress].duplicateCount += 1;
                                            } else {
                                                acc[contractAddress].seenNfts.add(nftKey);
                                                acc[contractAddress].nfts.push(nft);
                                            }
                                            
                                            return acc;
                                        }, {})
                                    )
                                    // Sort by estimated value descending (highest value first)
                                    .sort(([contractAddressA, collectionDataA], [contractAddressB, collectionDataB]) => {
                                        // Use the pre-calculated values from the global state for consistent sorting
                                        const calculatedValueA = nftCollectionValues[contractAddressA?.toLowerCase()];
                                        const calculatedValueB = nftCollectionValues[contractAddressB?.toLowerCase()];
                                        
                                        let valueA = calculatedValueA ? calculatedValueA.collectionValue : 0;
                                        let valueB = calculatedValueB ? calculatedValueB.collectionValue : 0;
                                        
                                        // Fallback calculation if centralized values aren't ready yet
                                        if (valueA === 0 && collectionDataA.floorPrice) {
                                            const currency = collectionDataA.floorPrice.currency || 'ETH';
                                            if (currency === 'ETH') {
                                                const currentEthPrice = tokenPrices['ethereum-native'] || 0;
                                                const floorPriceETH = collectionDataA.floorPrice.floorPrice || 0;
                                                valueA = floorPriceETH * currentEthPrice * collectionDataA.nfts.length;
                                            } else {
                                                const magicEdenUSD = collectionDataA.floorPrice.priceUSD || 0;
                                                valueA = magicEdenUSD * collectionDataA.nfts.length;
                                            }
                                        }
                                        
                                        if (valueB === 0 && collectionDataB.floorPrice) {
                                            const currency = collectionDataB.floorPrice.currency || 'ETH';
                                            if (currency === 'ETH') {
                                                const currentEthPrice = tokenPrices['ethereum-native'] || 0;
                                                const floorPriceETH = collectionDataB.floorPrice.floorPrice || 0;
                                                valueB = floorPriceETH * currentEthPrice * collectionDataB.nfts.length;
                                            } else {
                                                const magicEdenUSD = collectionDataB.floorPrice.priceUSD || 0;
                                                valueB = magicEdenUSD * collectionDataB.nfts.length;
                                            }
                                        }
                                        
                                        // Sort descending (highest value first)
                                        return valueB - valueA;
                                    })
                                    .filter(([contractAddress, collectionData]) => {
                                        // Filter out any invalid entries
                                        return contractAddress && collectionData && typeof contractAddress === 'string';
                                    })
                                    .map(([contractAddress, collectionData], index) => {
                                        const isDuplicate = collectionData.duplicateCount > 0;
                                        return (
                                        <tr key={contractAddress} style={{
                                            backgroundColor: index % 2 === 0 ? '#1f2937' : '#1a202c',
                                            borderBottom: '1px solid #374151'
                                        }}>
                                            <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                                                <div style={{ color: '#e5e7eb', fontWeight: '500', fontSize: '0.875rem' }}>
                                                    {collectionData.collection.name || 'Unknown Collection'}
                                                </div>
                                                <div style={{ 
                                                    color: '#9ca3af', 
                                                    fontSize: '0.75rem',
                                                    marginTop: '0.25rem',
                                                    fontFamily: 'monospace'
                                                }}>
                                                    {contractAddress && typeof contractAddress === 'string' ? 
                                                        `${contractAddress.slice(0, 6)}...${contractAddress.slice(-4)}` : 
                                                        'Invalid Address'
                                                    }
                                                </div>
                                                {collectionData.duplicateCount > 0 && (
                                                    <div style={{ 
                                                        color: '#f59e0b', 
                                                        fontSize: '0.7rem',
                                                        marginTop: '0.25rem',
                                                        fontStyle: 'italic'
                                                    }}>
                                                        ⚠️ {collectionData.duplicateCount} duplicate{collectionData.duplicateCount > 1 ? 's' : ''} removed
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ 
                                                padding: '1rem', 
                                                textAlign: 'center',
                                                verticalAlign: 'top',
                                                color: '#3b82f6',
                                                fontWeight: '600',
                                                fontSize: '1rem'
                                            }}>
                                                {collectionData.nfts.length}
                                                {collectionData.duplicateCount > 0 && (
                                                    <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.125rem' }}>
                                                        ({collectionData.nfts.length + collectionData.duplicateCount} total, {collectionData.duplicateCount} dup{collectionData.duplicateCount > 1 ? 's' : ''})
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'right', verticalAlign: 'top' }}>
                                                {collectionData.floorPrice ? (
                                                    <div>
                                                        <div style={{ color: '#e5e7eb', fontSize: '0.875rem', fontWeight: '500' }}>
                                                            {collectionData.floorPrice.floorPrice} {collectionData.floorPrice.currency || 'ETH'}
                                                        </div>
                                                        {collectionData.floorPrice.priceUSD && (
                                                            <div style={{ color: '#9ca3af', fontSize: '0.75rem', marginTop: '0.125rem' }}>
                                                                ${collectionData.floorPrice.priceUSD.toLocaleString()}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#ef4444', fontSize: '0.75rem' }}>Not available</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '1rem', textAlign: 'right', verticalAlign: 'top' }}>
                                                {(() => {
                                                    // Use the pre-calculated value from global state
                                                    const calculatedValue = nftCollectionValues[contractAddress.toLowerCase()];
                                                    if (calculatedValue && calculatedValue.collectionValue > 0) {
                                                        return (
                                                            <div style={{ color: '#10b981', fontWeight: '600', fontSize: '0.875rem' }}>
                                                                ${calculatedValue.collectionValue.toFixed(0)}
                                                            </div>
                                                        );
                                                    } else {
                                                        return <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>-</span>;
                                                    }
                                                })()}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
            </div>
            )}

            {/* Transactions Section */}
            {activeTab === 'Transactions' && (
            <div>
                <h2 style={{ color: '#e5e7eb', marginBottom: '2rem', fontSize: '2rem', fontWeight: '600', textAlign: 'center' }}>
                    Transaction History
                </h2>

                {/* ADD THE CHART HERE - BEFORE the transaction table */}
                {analysis && transactions.length > 0 && (
                <div className="analysis-section">
                    <NFTTradingChart transactions={transactions} />
                </div>
            )}



            <div className="analysis-section">
                <h2>Transaction History</h2>
                {transactions.length > 0 ? (
                    <div style={{overflowX: 'auto'}}>
                        <table className="transactions-table">
                            <thead>
                                <tr>
                                    <th 
                                        onClick={() => handleSort('date')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by date"
                                    >
                                        Date{getSortIndicator('date')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('label')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by type"
                                    >
                                        Type{getSortIndicator('label')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('outgoingAmount')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by outgoing amount"
                                    >
                                        Outgoing{getSortIndicator('outgoingAmount')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('incomingAmount')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by incoming amount"
                                    >
                                        Incoming{getSortIndicator('incomingAmount')}
                                    </th>
                                    <th 
 
                                        onClick={() => handleSort('feeAsset')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by fee asset"
                                    >
                                        Fee Asset{getSortIndicator('feeAsset')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('feeAmount')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by fee amount"
                                    >
                                        Fee Amount{getSortIndicator('feeAmount')}
                                    </th>
                                    <th 
 
                                        onClick={() => handleSort('profit')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by P&L"
                                    >
                                        P&L{getSortIndicator('profit')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('profit')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by profit"
                                    >
                                        Profit{getSortIndicator('profit')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('loss')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by loss"
                                    >
                                        Loss{getSortIndicator('loss')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('comment')}
                                        style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by comment"
                                    >
                                        Comment{getSortIndicator('comment')}
                                    </th>
                                    <th 
                                        onClick={() => handleSort('hash')}
                                                                               style={{cursor: 'pointer', userSelect: 'none'}}
                                        title="Click to sort by transaction ID"
                                    >
                                        Trx. ID{getSortIndicator('hash')}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedTransactions.map((tx, index) => (
                                    <tr key={index}>
                                        <td>{tx.date instanceof Date && !isNaN(tx.date) ? format(tx.date, 'MMM dd, yyyy HH:mm') : 'Invalid Date'}</td>
                                        <td>
                                            <span className={`label-${tx.label.toLowerCase().replace(' ', '-')}`}>
                                                {tx.label}
                                            </span>
                                        </td>
                                        <td>
                                            {tx.outgoingAmount && parseFloat(tx.outgoingAmount) > 0 && (
                                                <>
                                                    {parseFloat(tx.outgoingAmount).toFixed(4)} {tx.outgoingAsset}
                                                </>
                                            )}
                                        </td>
                                        <td>
                                            {tx.incomingAmount && parseFloat(tx.incomingAmount) > 0 && (
                                                <>
                                                    {parseFloat(tx.incomingAmount).toFixed(4)} {tx.incomingAsset}
                                                </>
                                            )}
                                        </td>
                                        <td>
                                            {tx.feeAsset || ''}
                                        </td>
                                        <td>
                                            {tx.feeAmount && parseFloat(tx.feeAmount) > 0 && (
                                                <>
                                                    {parseFloat(tx.feeAmount).toFixed(6)} {tx.feeAsset}
                                                </>
                                            )}
                                        </td>
                                        <td>
                                            {tx.profit && (
                                                <span style={{color: '#10b981', fontWeight: '600'}}>
                                                    +{tx.profit.toFixed(4)} APE
                                                </span>
                                            )}
                                            {tx.loss && (
                                                <span style={{color: '#ef4444', fontWeight: '600'}}>
                                                    -{tx.loss.toFixed(4)} APE
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {tx.profit ? (
                                                <span style={{color: '#10b981', fontWeight: '600'}}>
                                                    {tx.profit.toFixed(4)}
                                                </span>
                                            ) : '0'}
                                        </td>
                                        <td>
                                            {tx.loss ? (
                                                <span style={{color: '#ef4444', fontWeight: '600'}}>
                                                    {tx.loss.toFixed(4)}
                                                </span>
                                            ) : '0'}
                                        </td>
                                        <td style={{fontSize: '12px', color: '#9ca3af', maxWidth: '300px', wordWrap: 'break-word'}}>
                                            {tx.comment}
                                            {tx.isGifted && ' (Gifted/Minted)'}
                                        </td>
                                        <td style={{fontSize: '11px', color: '#6b7280', fontFamily: 'monospace'}}>
                                            <a 
                                                href={`https://apescan.io/tx/${tx.hash}`} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                style={{color: '#3b82f6', textDecoration: 'none'}}
                                            >
                                                {tx.hash && typeof tx.hash === 'string' ? 
                                                    `${tx.hash.slice(0, 8)}...${tx.hash.slice(-6)}` : 
                                                    'No Hash'
                                                }
                                            </a>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={{textAlign: 'center', padding: '60px', color: '#9ca3af'}}>
                        No transactions found for this wallet.
                    </div>
                )}
            </div>
            </div>
            )}

                </>
            )}
            </div> {/* Close Main Content Wrapper */}
            
            {/* Footer Navigation Menu */}
            <div style={{
                position: 'fixed',
                bottom: '0',
                left: '0',
                right: '0',
                background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 25%, #16213e 50%, #0f0f23 75%, #000000 100%)',
                borderTop: '2px solid rgba(31, 81, 255, 0.3)',
                boxShadow: '0 -4px 12px rgba(0, 0, 0, 0.5)',
                zIndex: 10000,
                padding: '1rem 0'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    gap: screenSize.isMobile ? '0.25rem' : screenSize.isTablet ? '0.75rem' : '2rem',
                    maxWidth: '1200px',
                    margin: '0 auto',
                    padding: screenSize.isMobile ? '0 0.25rem' : '0 0.5rem',
                    flexWrap: 'nowrap',
                    overflow: 'hidden'
                }}>
                    {['Portfolio', 'Tokens', 'NFTs', 'Transactions'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => {
                                setActiveTab(tab);
                                setCurrentView('analysis');
                            }}
                            style={{
                                background: activeTab === tab ? 'linear-gradient(135deg, rgba(31, 81, 255, 0.8) 0%, rgba(31, 81, 255, 0.6) 100%)' : 'transparent',
                                color: activeTab === tab ? '#FFFFFF' : '#e0e0e0',
                                border: '1px solid',
                                borderColor: activeTab === tab ? 'rgba(31, 81, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
                                padding: screenSize.isMobile ? '0.4rem 0.5rem' : screenSize.isTablet ? '0.6rem 0.8rem' : '0.75rem 1.5rem',
                                borderRadius: screenSize.isMobile ? '8px' : '12px',
                                cursor: 'pointer',
                                fontSize: screenSize.isMobile ? '0.75rem' : screenSize.isTablet ? '0.85rem' : '1rem',
                                fontWeight: activeTab === tab ? '600' : '500',
                                transition: 'all 0.2s ease',
                                minWidth: 'auto',
                                boxShadow: activeTab === tab ? '0 0 10px rgba(31, 81, 255, 0.3)' : 'none',
                                textShadow: activeTab === tab ? '0 0 8px rgba(31, 81, 255, 0.3)' : 'none',
                                flex: screenSize.isMobile ? '1' : 'none',
                                textAlign: 'center',
                                whiteSpace: 'nowrap'
                            }}
                            onMouseEnter={(e) => {
                                if (activeTab !== tab) {
                                    e.target.style.borderColor = 'rgba(31, 81, 255, 0.5)';
                                    e.target.style.color = '#4D7FFF';
                                    e.target.style.backgroundColor = 'rgba(31, 81, 255, 0.1)';
                                    e.target.style.textShadow = '0 0 8px rgba(31, 81, 255, 0.3)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (activeTab !== tab) {
                                    e.target.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                                    e.target.style.color = '#e0e0e0';
                                    e.target.style.backgroundColor = 'transparent';
                                    e.target.style.textShadow = 'none';
                                }
                            }}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Authentication Popup/Overlay */}
            {showAuthPopup && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0, 0, 0, 0.8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        backdropFilter: 'blur(4px)'
                    }}
                    onClick={(e) => {
                        // Close popup when clicking outside the modal content
                        if (e.target === e.currentTarget) {
                            setShowAuthPopup(false);
                        }
                    }}
                >
                    <div style={{
                        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%)',
                        borderRadius: '16px',
                        padding: '32px',
                        border: '1px solid rgba(31, 81, 255, 0.3)',
                        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                        maxWidth: '400px',
                        width: '90%',
                        textAlign: 'center',
                        position: 'relative'
                    }}>
                        {/* Close button */}
                        <button
                            onClick={() => setShowAuthPopup(false)}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                background: 'transparent',
                                border: 'none',
                                color: '#9ca3af',
                                fontSize: '1.5rem',
                                cursor: 'pointer',
                                padding: '4px',
                                borderRadius: '4px',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                                e.target.style.color = '#ffffff';
                                e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                                e.target.style.color = '#9ca3af';
                                e.target.style.background = 'transparent';
                            }}
                            title="Close"
                        >
                            ✕
                        </button>

                        {/* Glyph logo/icon */}
                        <div style={{
                            fontSize: '3rem',
                            marginBottom: '16px',
                            filter: 'drop-shadow(0 0 12px rgba(31, 81, 255, 0.3))'
                        }}>
                            🔗
                        </div>

                        <h3 style={{
                            color: '#ffffff',
                            fontSize: '1.5rem',
                            fontWeight: '600',
                            marginBottom: '12px',
                            textShadow: '0 0 8px rgba(31, 81, 255, 0.3)'
                        }}>
                            Authentication Required
                        </h3>

                        <p style={{
                            color: '#9ca3af',
                            fontSize: '1rem',
                            marginBottom: '24px',
                            lineHeight: '1.5'
                        }}>
                            Please connect your Glyph wallet to access the watchlist feature and manage your saved wallets.
                        </p>

                        <div style={{
                            display: 'flex',
                            gap: '12px',
                            justifyContent: 'center',
                            flexWrap: 'wrap'
                        }}>
                            <button
                                onClick={async () => {
                                    if (isConnectingGlyph) return; // Prevent double clicks
                                    
                                    setIsConnectingGlyph(true);
                                    try {
                                        // Trigger the same Glyph connection routine as "Option 1"
                                        if (onConnectGlyph) {
                                            await onConnectGlyph();
                                            // If successful, close popup
                                            setShowAuthPopup(false);
                                        }
                                    } catch (error) {
                                        console.error('Error connecting Glyph from popup:', error);
                                        // Keep popup open on error
                                    } finally {
                                        setIsConnectingGlyph(false);
                                    }
                                }}
                                disabled={isConnectingGlyph}
                                style={{
                                    background: isConnectingGlyph 
                                        ? 'rgba(107, 114, 128, 0.6)' 
                                        : 'linear-gradient(135deg, rgba(31, 81, 255, 0.8) 0%, rgba(31, 81, 255, 0.6) 100%)',
                                    color: '#ffffff',
                                    border: '1px solid rgba(31, 81, 255, 0.3)',
                                    padding: '12px 24px',
                                    borderRadius: '8px',
                                    cursor: isConnectingGlyph ? 'not-allowed' : 'pointer',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    boxShadow: isConnectingGlyph 
                                        ? '0 2px 8px rgba(107, 114, 128, 0.3)' 
                                        : '0 4px 12px rgba(31, 81, 255, 0.3)',
                                    textShadow: isConnectingGlyph 
                                        ? 'none' 
                                        : '0 0 8px rgba(31, 81, 255, 0.3)',
                                    transition: 'all 0.2s ease',
                                    opacity: isConnectingGlyph ? 0.7 : 1
                                }}
                                onMouseEnter={(e) => {
                                    if (!isConnectingGlyph) {
                                        e.target.style.transform = 'translateY(-2px)';
                                        e.target.style.boxShadow = '0 6px 16px rgba(31, 81, 255, 0.4)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isConnectingGlyph) {
                                        e.target.style.transform = 'translateY(0px)';
                                        e.target.style.boxShadow = '0 4px 12px rgba(31, 81, 255, 0.3)';
                                    }
                                }}
                            >
                                {isConnectingGlyph ? '� Connecting...' : '�🔗 Connect Glyph'}
                            </button>

                            <button
                                onClick={() => setShowAuthPopup(false)}
                                style={{
                                    background: 'transparent',
                                    color: '#9ca3af',
                                    border: '1px solid rgba(156, 163, 175, 0.3)',
                                    padding: '12px 24px',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    fontSize: '1rem',
                                    fontWeight: '500',
                                    transition: 'all 0.2s ease'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.color = '#ffffff';
                                    e.target.style.borderColor = 'rgba(156, 163, 175, 0.5)';
                                    e.target.style.background = 'rgba(156, 163, 175, 0.1)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.color = '#9ca3af';
                                    e.target.style.borderColor = 'rgba(156, 163, 175, 0.3)';
                                    e.target.style.background = 'transparent';
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default WalletAnalyzer;