import { defineChain } from 'viem'

export const apeChain = defineChain({
  id: 33139,
  name: 'APE Chain',
  nativeCurrency: {
    decimals: 18,
    name: 'APE',
    symbol: 'APE',
  },
  rpcUrls: {
    default: {
      http: ['https://apechain.calderachain.xyz/http'],
    },
  },
  blockExplorers: {
    default: { 
      name: 'APE Chain Explorer', 
      url: 'https://apechain.calderachain.xyz' 
    },
  },
})
