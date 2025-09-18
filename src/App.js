import React, { useState, useEffect } from 'react';
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

function App() {
    const [account, setAccount] = useState(null);
    const [provider, setProvider] = useState(null);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState(null);
    const [manualAddress, setManualAddress] = useState('');
    const [addressToAnalyze, setAddressToAnalyze] = useState(null);

    useEffect(() => {
        checkUrlParameters();
        checkConnection();
    }, []);

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

    const checkConnection = async () => {
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_accounts' });
                if (accounts.length > 0) {
                    // Fixed: Don't create a new provider, just use window.ethereum directly
                    setProvider(window.ethereum);
                    setAccount(accounts[0]);
                    
                    // Only set addressToAnalyze if there's no URL parameter (URL takes priority)
                    const urlParams = new URLSearchParams(window.location.search);
                    const walletParam = urlParams.get('wallet');
                    
                    if (!walletParam) {
                        setAddressToAnalyze(accounts[0]);
                        updateUrlWithWallet(accounts[0]);
                    }
                }
            } catch (error) {
                console.error('Error checking connection:', error);
            }
        }
    };

    const connectWallet = async () => {
        if (typeof window.ethereum === 'undefined') {
            setError('MetaMask is not installed. Please install MetaMask to connect your wallet.');
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            // Request account access
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            
            if (accounts.length === 0) {
                throw new Error('No accounts found');
            }

            // Check if we're on the right network
            const chainId = await window.ethereum.request({ method: 'eth_chainId' });
            
            if (chainId !== APECHAIN_CONFIG.chainId) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: APECHAIN_CONFIG.chainId }],
                    });
                } catch (switchError) {
                    if (switchError.code === 4902) {
                        try {
                            await window.ethereum.request({
                                method: 'wallet_addEthereumChain',
                                params: [APECHAIN_CONFIG],
                            });
                        } catch (addError) {
                            throw new Error('Failed to add ApeChain network');
                        }
                    } else {
                        throw new Error('Failed to switch to ApeChain network');
                    }
                }
            }

            // Fixed: Use window.ethereum directly instead of creating a new provider
            setProvider(window.ethereum);
            setAccount(accounts[0]);
            setAddressToAnalyze(accounts[0]);
            setManualAddress(''); // Clear manual input when wallet connects
            
            // Update URL with connected wallet address
            updateUrlWithWallet(accounts[0]);

            // Add account change listener
            window.ethereum.on('accountsChanged', handleAccountsChanged);
            window.ethereum.on('chainChanged', handleChainChanged);

        } catch (error) {
            console.error('Error connecting wallet:', error);
            if (error.code === 4001) {
                setError('Connection rejected by user.');
            } else if (error.code === -32002) {
                setError('Connection request already pending. Please check MetaMask.');
            } else {
                setError(error.message || 'Failed to connect wallet');
            }
        } finally {
            setIsConnecting(false);
        }
    };

    const handleAccountsChanged = (accounts) => {
        if (accounts.length === 0) {
            // User disconnected
            disconnectWallet();
        } else if (accounts[0] !== account) {
            // User switched accounts
            setAccount(accounts[0]);
            setAddressToAnalyze(accounts[0]);
            updateUrlWithWallet(accounts[0]);
        }
    };

    const handleChainChanged = (chainId) => {
        // Reload the page when chain changes (recommended by MetaMask)
        window.location.reload();
    };

    const disconnectWallet = () => {
        // Remove event listeners
        if (window.ethereum && window.ethereum.removeListener) {
            window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
            window.ethereum.removeListener('chainChanged', handleChainChanged);
        }
        
        setProvider(null);
        setAccount(null);
        setAddressToAnalyze(null);
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
        setManualAddress('');
        if (!account) {
            // Only clear if no wallet is connected
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
                <h1>ApeObserver</h1>
                <p>Analyze wallet transactions and calculate NFT trading profit/loss on APE Chain</p>
            </div>

            {!addressToAnalyze ? (
                <div className="wallet-connect">
                    <h2>Get Started</h2>
                    
                    {/* Wallet Connection Section */}
                    <div className="connection-option">
                        <h3>Option 1: Connect Your Wallet</h3>
                        <p>Connect your MetaMask wallet to analyze your own transactions</p>
                        <button 
                            className="connect-btn" 
                            onClick={connectWallet}
                            disabled={isConnecting}
                        >
                            {isConnecting ? '🔄 Connecting...' : '🦊 Connect MetaMask'}
                        </button>
                    </div>

                    <div className="divider">
                        <span>OR</span>
                    </div>

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
                <div>
                    <div className="wallet-info">
                        <h3>Analyzing Wallet</h3>
                        <p>
                            <strong>Address:</strong> 
                            <a 
                                href={`https://apescan.io/address/${addressToAnalyze}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{color: '#3b82f6', textDecoration: 'none', marginLeft: '8px'}}
                            >
                                {addressToAnalyze ? `${addressToAnalyze.slice(0, 7)}...${addressToAnalyze.slice(-5)}` : addressToAnalyze}
                            </a>
                            {!account && new URLSearchParams(window.location.search).get('wallet') && (
                                <span style={{
                                    marginLeft: '12px',
                                    fontSize: '12px',
                                    color: '#10b981',
                                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    border: '1px solid rgba(16, 185, 129, 0.2)'
                                }}>
                                    🔗 Loaded from URL
                                </span>
                            )}
                        </p>
                        <div className="wallet-actions">
                            {account && (
                                <button className="disconnect-btn" onClick={disconnectWallet}>
                                    🔌 Disconnect Wallet
                                </button>
                            )}
                            <button className="clear-btn" onClick={clearAnalysis}>
                                🔄 Analyze Different Wallet
                            </button>
                        </div>
                    </div>

                    <WalletAnalyzer account={addressToAnalyze} />
                </div>
            )}
        </div>
    );
}

export default App;