// Replace the entire WalletConnector component with this simple address input:

import React, { useState } from 'react';

const WalletConnector = ({ onWalletConnect }) => {
    const [address, setAddress] = useState('');
    const [error, setError] = useState(null);

    const handleSubmit = (e) => {
        e.preventDefault();
        
        // Basic validation
        if (!address) {
            setError('Please enter a wallet address');
            return;
        }
        
        if (!address.startsWith('0x') || address.length !== 42) {
            setError('Please enter a valid Ethereum address (42 characters starting with 0x)');
            return;
        }
        
        setError(null);
        onWalletConnect(address.toLowerCase());
    };

    const handleInputChange = (e) => {
        const value = e.target.value.trim();
        setAddress(value);
        
        // Clear error when user starts typing a valid address
        if (error && value.length > 10) {
            setError(null);
        }
    };

    return (
        <div className="wallet-connector">
            <form onSubmit={handleSubmit} style={{
                display: 'flex', 
                flexDirection: 'column', 
                gap: '15px', 
                maxWidth: '500px', 
                margin: '0 auto'
            }}>
                <div>
                    <label htmlFor="wallet-address" style={{
                        display: 'block', 
                        marginBottom: '8px', 
                        fontSize: '14px', 
                        fontWeight: '500',
                        color: '#e5e7eb'
                    }}>
                        Wallet Address:
                    </label>
                    <input
                        id="wallet-address"
                        type="text"
                        placeholder="0x742d35Cc6418C48532c5A8e5dcca4389473c85f2"
                        value={address}
                        onChange={handleInputChange}
                        style={{
                            width: '100%',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            border: '1px solid #374151',
                            backgroundColor: '#1f2937',
                            color: '#fff',
                            fontSize: '14px',
                            fontFamily: 'monospace',
                            outline: 'none',
                            transition: 'border-color 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                        onBlur={(e) => e.target.style.borderColor = '#374151'}
                    />
                    {error && (
                        <div style={{
                            marginTop: '8px',
                            padding: '8px 12px',
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fca5a5',
                            borderRadius: '6px',
                            color: '#dc2626',
                            fontSize: '13px'
                        }}>
                            ⚠️ {error}
                        </div>
                    )}
                </div>
                
                <button 
                    type="submit"
                    className="connect-btn"
                    style={{
                        padding: '12px 24px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = '#2563eb'}
                    onMouseOut={(e) => e.target.style.backgroundColor = '#3b82f6'}
                >
                    🔍 Analyze Wallet
                </button>
            </form>
            
            <div style={{
                marginTop: '20px',
                padding: '15px',
                backgroundColor: '#1f2937',
                borderRadius: '8px',
                border: '1px solid #374151'
            }}>
                <h4 style={{
                    margin: '0 0 10px 0',
                    color: '#e5e7eb',
                    fontSize: '14px',
                    fontWeight: '600'
                }}>
                    📝 Example Addresses:
                </h4>
                <div style={{fontSize: '12px', color: '#9ca3af', lineHeight: '1.5'}}>
                    <div>• <code>0x742d35Cc6418C48532c5A8e5dcca4389473c85f2</code></div>
                    <div>• <code>0x8ba1f109551bD432803012645Hac136c22C177e9</code></div>
                </div>
            </div>
        </div>
    );
};

export default WalletConnector;