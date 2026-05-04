import React from 'react';
import { ThemeProvider } from './ThemeProvider';
import { CopyProvider } from './CopyProvider';
import { SessionProvider } from './SessionProvider';
import { ContractActionProvider } from './ContractActionProvider';
import { ToastProvider } from './ToastProvider';
import { RouteStateProvider } from './RouteStateProvider';

export const AppProviders = ({ children, initialContext = 'home' }) => {
  return (
    <ThemeProvider>
      <CopyProvider>
        <SessionProvider>
          <ContractActionProvider>
            <ToastProvider>
              <RouteStateProvider initialContext={initialContext}>
                {children}
              </RouteStateProvider>
            </ToastProvider>
          </ContractActionProvider>
        </SessionProvider>
      </CopyProvider>
    </ThemeProvider>
  );
};

export default AppProviders;
