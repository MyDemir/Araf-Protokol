import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

import { WagmiProvider, createConfig, http } from 'wagmi'
import { base, baseSepolia } from 'wagmi/chains'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// L-05 Fix: Global hata sınırı — render hatalarında uygulamanın tamamen çökmesini önler
import ErrorBoundary from './components/ErrorBoundary.jsx'

const config = createConfig({
  chains: [base, baseSepolia],
  connectors: [
    injected(), // MetaMask, Rabby vb. yerel cüzdanlar
    coinbaseWallet({ appName: 'Araf Protocol' }),
    // GEÇİCİ OLARAK UYUTULDU (403 Reown hatasını engellemek için)
    // walletConnect({ projectId: '3fcc6b444f67d32e656910629a888c34' }),
  ],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
})

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
