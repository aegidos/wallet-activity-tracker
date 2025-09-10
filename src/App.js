import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
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

    useEffect(() => {
        checkConnection();
    }, []);

    const checkConnection = async () => {
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ 
                    method: 'eth_accounts' 
                });
                if (accounts.length > 0) {
                    const provider = new ethers.BrowserProvider(window.ethereum);
                    setProvider(provider);
                    setAccount(accounts[0]);
                }
            } catch (error) {
                console.error('Error checking connection:', error);
            }
        }
    };

    const connectWallet = async () => {
        if (typeof window.ethereum === 'undefined') {
            setError('MetaMask is not installed. Please install MetaMask to continue.');
            return;
        }

        setIsConnecting(true);
        setError(null);

        try {
            // Request account access
            const accounts = await window.ethereum.request({
                method: 'eth_requestAccounts'
            });

            // Check if we're on ApeChain, if not, try to switch
            const chainId = await window.ethereum.request({ 
                method: 'eth_chainId' 
            });

            if (chainId !== APECHAIN_CONFIG.chainId) {
                try {
                    await window.ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: APECHAIN_CONFIG.chainId }],
                    });
                } catch (switchError) {
                    // If the chain doesn't exist, add it
                    if (switchError.code === 4902) {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [APECHAIN_CONFIG],
                        });
                    } else {
                        throw switchError;
                    }
                }
            }

            const provider = new ethers.BrowserProvider(window.ethereum);
            setProvider(provider);
            setAccount(accounts[0]);

        } catch (error) {
            console.error('Error connecting wallet:', error);
            setError('Failed to connect wallet. Please try again.');
        } finally {
            setIsConnecting(false);
        }
    };

    const disconnectWallet = () => {
        setAccount(null);
        setProvider(null);
        setError(null);
    };

    return (
        <div className="container">
            <div className="header">
                <h1>ApeObserver</h1>
                <p>Analyze your wallet activity, NFT trades, and calculate profit/loss</p>
            </div>

            {error && (
                <div className="error">
                    ⚠️ {error}
                </div>
            )}

            {!account ? (
                <div className="wallet-connect">
                    <h2>Connect Your Wallet</h2>
                    <p>
                        Connect your ApeChain wallet to analyze your transaction history and calculate profit/loss
                    </p>
                    <button 
                        className="connect-btn" 
                        onClick={connectWallet}
                        disabled={isConnecting}
                    >
                        {isConnecting ? (
                            <>🔄 Connecting...</>
                        ) : (
                            <>🦊 Connect MetaMask</>
                        )}
                    </button>
                </div>
            ) : (
                <>
                    <div className="wallet-info">
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px'}}>
                            <div>
                                <h3>Connected Wallet</h3>
                                <p>{account}</p>
                            </div>
                            <button 
                                className="disconnect-btn" 
                                onClick={disconnectWallet}
                            >
                                Disconnect
                            </button>
                        </div>
                    </div>

                    <WalletAnalyzer account={account} provider={provider} />
                </>
            )}
        </div>
    );
}

export default App;