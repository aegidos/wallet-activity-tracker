import { createContext } from 'react';

const WalletContext = createContext();

const WalletWrapper = ({ children }) => {
  return (
    <WalletContext.Provider value={{}}>
      {children}
    </WalletContext.Provider>
  );
};

export default WalletWrapper;
export { WalletContext };