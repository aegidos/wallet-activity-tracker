import React, { useState, useEffect } from 'react';
import { GlyphWalletProvider, useGlyph, useNativeGlyphConnection } from '@use-glyph/sdk-react';
import { apeChain } from 'viem/chains';
import { useAccount } from 'wagmi';
import WalletAnalyzer from './components/WalletAnalyzer';

const APECHAIN_CONFIG = {
    chainId: '0x8173', // 33139 in hex
    chainName: 'ApeChain',
    nativeCurrency: {
        name: 'ApeCoin',
        symbol: 'APE',
        decimals: 18
    },
    rpcUrls: ['https://apechain.calderachain.xyz/http'],
    blockExplorerUrls: ['https://apescan.io/']
};

// Main App component that includes Glyph providers
function App() {
    return (
        <GlyphWalletProvider chains={[apeChain]} askForSignature={true}>
            <AppContent />
        </GlyphWalletProvider>
    );
}

// Inner component with wallet logic
function AppContent() {
    const { user, authenticated, ready, login, logout } = useGlyph();
    const { connect } = useNativeGlyphConnection();
    const { isConnected } = useAccount();
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState(null);
    const [manualAddress, setManualAddress] = useState('');
    const [addressToAnalyze, setAddressToAnalyze] = useState(null);
    const [selectedLinkedWallet, setSelectedLinkedWallet] = useState(null);

    useEffect(() => {
        checkUrlParameters();
    }, []);

    // Handle Glyph authentication
    useEffect(() => {
        if (ready && authenticated && user) {
            // If user has linked wallets, default to the first linked wallet for analysis
            if (user.linkedWallets && user.linkedWallets.length > 0) {
                const defaultWallet = user.linkedWallets[0].address;
                setSelectedLinkedWallet(defaultWallet);
                
                // Only set addressToAnalyze if there's no URL parameter (URL takes priority)
                const urlParams = new URLSearchParams(window.location.search);
                const walletParam = urlParams.get('wallet');
                
                if (!walletParam) {
                    setAddressToAnalyze(defaultWallet);
                    updateUrlWithWallet(defaultWallet);
                }
            } else {
                // Fallback to main wallet if no linked wallets
                const mainWallet = user.evmWallet;
                if (mainWallet) {
                    const urlParams = new URLSearchParams(window.location.search);
                    const walletParam = urlParams.get('wallet');
                    
                    if (!walletParam) {
                        setAddressToAnalyze(mainWallet);
                        updateUrlWithWallet(mainWallet);
                    }
                }
            }
        }
    }, [ready, authenticated, user]);

    const checkUrlParameters = () => {
        // Check if there's a wallet address in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const walletParam = urlParams.get('wallet');
        
        if (walletParam) {
            // Validate the address format
            if (/^0x[a-fA-F0-9]{40}$/.test(walletParam)) {
                console.log('🔗 Wallet address found in URL:', walletParam);
                setAddressToAnalyze(walletParam);
                setManualAddress(walletParam); // Also populate the input field
                // Don't show error since we're auto-loading
                setError(null);
            } else {
                setError('Invalid wallet address in URL parameter');
            }
        }
    };

    const updateUrlWithWallet = (address) => {
        if (!address) return;
        
        const url = new URL(window.location);
        const currentWallet = url.searchParams.get('wallet');
        
        // Only update if the address is different to avoid unnecessary updates
        if (currentWallet !== address) {
            url.searchParams.set('wallet', address);
            
            // Update URL without reloading the page
            window.history.pushState({}, '', url.toString());
            console.log('🔗 Updated URL with wallet address:', address);
        }
    };



    const connectWallet = async () => {
        setIsConnecting(true);
        setError(null);

        try {
            if (!isConnected) {
                // First connect the wallet
                await connect();
            }
            // Then authenticate with Glyph
            await login();
            setManualAddress(''); // Clear manual input when wallet connects
        } catch (error) {
            console.error('Error connecting to Glyph:', error);
            setError('Failed to connect to Glyph account. Please try again.');
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnectWallet = () => {
        logout();
        setAddressToAnalyze(null);
        setSelectedLinkedWallet(null);
        setManualAddress('');
        setError(null);
        
        // Clear wallet parameter from URL
        const url = new URL(window.location);
        url.searchParams.delete('wallet');
        window.history.pushState({}, '', url.toString());
    };

    const handleManualAddressSubmit = (e) => {
        e.preventDefault();
        setError(null);
        
        // Basic validation
        if (!manualAddress.trim()) {
            setError('Please enter a wallet address');
            return;
        }
        
        // Check if it looks like a valid Ethereum address
        if (!/^0x[a-fA-F0-9]{40}$/.test(manualAddress.trim())) {
            setError('Please enter a valid Ethereum address (0x followed by 40 hexadecimal characters)');
            return;
        }

        const trimmedAddress = manualAddress.trim();
        setAddressToAnalyze(trimmedAddress);
        
        // Update URL with observed wallet address
        updateUrlWithWallet(trimmedAddress);
    };

    const handleAddressChange = (e) => {
        setManualAddress(e.target.value);
        setError(null);
    };

    const clearAnalysis = () => {
        setAddressToAnalyze(null);
        setSelectedLinkedWallet(null);
        setManualAddress('');
        if (!authenticated) {
            // Only clear if no Glyph account is connected
            setError(null);
        }
        
        // Clear wallet parameter from URL
        const url = new URL(window.location);
        url.searchParams.delete('wallet');
        window.history.pushState({}, '', url.toString());
    };

    return (
        <div className="container">
            <div className="header">
                <h1 style={{ 
                    marginTop: '0.5rem', 
                    marginBottom: '0.5rem', 
                    fontFamily: '"Bebas Neue", cursive',
                    fontSize: '3rem',
                    letterSpacing: '2px'
                }}>APEOBSERVER</h1>
                <p style={{ margin: '0', marginBottom: '-10.5rem' }}>Analyze wallet transactions and calculate NFT trading profit/loss on APE Chain</p>
            </div>

            {!addressToAnalyze ? (
                <div className="wallet-connect">
                    <div style={{ height: '2rem' }}></div>
                    
                    {/* Wallet Connection Section */}
                    {!authenticated ? (
                        <>
                            <div className="connection-option">
                                <h3>Option 1: Connect Your Glyph Account</h3>
                                <p>Connect your Glyph account to analyze your linked wallet transactions</p>
                                <button 
                                    className="connect-btn" 
                                    onClick={connectWallet}
                                    disabled={isConnecting}
                                >
                                    {isConnecting ? '🔄 Connecting...' : '🔗 Connect Glyph'}
                                </button>
                            </div>

                            <div className="divider">
                                <span>OR</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="connection-option">
                                <h3>🔗 Connected to Glyph</h3>
                                <p>Welcome {user?.name || 'Glyph User'}! Select a wallet to analyze:</p>
                                
                                {/* Linked Wallets Selection */}
                                {user?.linkedWallets && user.linkedWallets.length > 0 && (
                                    <div className="wallet-selection">
                                        <h4>📱 Linked Wallets (Recommended)</h4>
                                        <p>Select one of your linked wallets for analysis:</p>
                                        {user.linkedWallets.map((wallet, index) => (
                                            <button
                                                key={wallet.address}
                                                className={`wallet-option ${selectedLinkedWallet === wallet.address ? 'selected' : ''}`}
                                                onClick={() => {
                                                    setSelectedLinkedWallet(wallet.address);
                                                    setAddressToAnalyze(wallet.address);
                                                    updateUrlWithWallet(wallet.address);
                                                }}
                                            >
                                                <span className="wallet-label">
                                                    📱 {wallet.walletClientType?.split('_').join(' ') || `Linked Wallet ${index + 1}`}
                                                </span>
                                                <span className="wallet-address">
                                                    {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                
                                {/* Main Wallet Option */}
                                {user?.evmWallet && (
                                    <div className="wallet-selection">
                                        <h4>🏠 Main Wallet</h4>
                                        <button
                                            className={`wallet-option ${selectedLinkedWallet === null && addressToAnalyze === user.evmWallet ? 'selected' : ''}`}
                                            onClick={() => {
                                                setSelectedLinkedWallet(null);
                                                setAddressToAnalyze(user.evmWallet);
                                                updateUrlWithWallet(user.evmWallet);
                                            }}
                                        >
                                            <span className="wallet-label">🏠 Main Glyph Wallet</span>
                                            <span className="wallet-address">
                                                {user.evmWallet.slice(0, 6)}...{user.evmWallet.slice(-4)}
                                            </span>
                                        </button>
                                    </div>
                                )}
                                
                                <button 
                                    className="disconnect-btn" 
                                    onClick={disconnectWallet}
                                    style={{ marginTop: '1rem' }}
                                >
                                    🔌 Disconnect Glyph
                                </button>
                            </div>

                            <div className="divider">
                                <span>OR</span>
                            </div>
                        </>
                    )}

                    {/* Manual Address Section */}
                    <div className="connection-option">
                        <h3>Option 2: Observe Any Wallet</h3>
                        <p>Enter any APE Chain wallet address to analyze its transactions</p>
                        <form onSubmit={handleManualAddressSubmit} className="address-form">
                            <div className="input-group">
                                <input
                                    type="text"
                                    value={manualAddress}
                                    onChange={handleAddressChange}
                                    placeholder="0x... (paste wallet address here)"
                                    className="address-input"
                                />
                                <button 
                                    type="submit" 
                                    className="observe-btn"
                                    disabled={!manualAddress.trim()}
                                >
                                    🔍 Observe
                                </button>
                            </div>
                        </form>
                    </div>

                    {error && (
                        <div className="error">
                            ⚠️ {error}
                        </div>
                    )}
                </div>
            ) : (
                <WalletAnalyzer 
                    account={addressToAnalyze} 
                    connectedAccount={authenticated && user ? (selectedLinkedWallet || user.evmWallet) : null}
                    onDisconnect={disconnectWallet}
                    onClearAnalysis={clearAnalysis}
                    onConnectGlyph={connectWallet}
                />
            )}
        </div>
    );
}

export default App;