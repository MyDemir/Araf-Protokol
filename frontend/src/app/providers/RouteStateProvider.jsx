import React from 'react';

const RouteStateContext = React.createContext(null);

export const RouteStateProvider = ({ children, initialContext = 'home' }) => {
  const [currentContext, setCurrentContext] = React.useState(initialContext);

  const value = React.useMemo(() => ({
    currentContext,
    setCurrentContext,
    // Compatibility aliases for existing `currentView` semantics.
    currentView: currentContext,
    setCurrentView: setCurrentContext,
  }), [currentContext]);

  return (
    <RouteStateContext.Provider value={value}>
      {children}
    </RouteStateContext.Provider>
  );
};

export const useRouteState = () => {
  const ctx = React.useContext(RouteStateContext);
  if (!ctx) throw new Error('useRouteState must be used within RouteStateProvider');
  return ctx;
};

export default RouteStateContext;
