import React from 'react';
import { SystemStatusBar } from './SystemStatusBar';
import { ContextNavigation } from './ContextNavigation';
import { ContextOutlet } from './ContextOutlet';
import { ContextPanel } from './ContextPanel';
import { ModalHost } from './ModalHost';
import { MobileTopBar } from './MobileTopBar';
import { MobileBottomNav } from './MobileBottomNav';

export const AppShell = ({
  children,
  status = null,
  navigation = null,
  panel = null,
  outlet = null,
  modals = null,
  mobileTop = null,
  mobileBottom = null,
}) => {
  return (
    <>
      {status ? <SystemStatusBar {...status} /> : null}
      <MobileTopBar>{mobileTop}</MobileTopBar>
      <div className="flex flex-col md:flex-row min-h-0 flex-1">
        <ContextNavigation>{navigation}</ContextNavigation>
        <ContextPanel>{panel}</ContextPanel>
        <ContextOutlet>{outlet || children}</ContextOutlet>
      </div>
      <MobileBottomNav>{mobileBottom}</MobileBottomNav>
      <ModalHost>{modals}</ModalHost>
    </>
  );
};

export default AppShell;
