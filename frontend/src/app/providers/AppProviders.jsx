import React from 'react';
import { ThemeProvider } from './ThemeProvider';
import { CopyProvider } from './CopyProvider';
import { SessionProvider } from './SessionProvider';

export const AppProviders = ({ children }) => {
  return (
    <ThemeProvider>
      <CopyProvider>
        <SessionProvider>
          {children}
        </SessionProvider>
      </CopyProvider>
    </ThemeProvider>
  );
};

export default AppProviders;
