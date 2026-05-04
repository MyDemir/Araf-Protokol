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
  systemStatusProps = null,
  navigation = null,
  panel = null,
  outlet = null,
  modals = null,
  mobileTop = null,
  mobileBottom = null,
}) => {
  return (
    <>
      <SystemStatusBar {...(systemStatusProps || {})}>{status}</SystemStatusBar>
      <MobileTopBar>{mobileTop}</MobileTopBar>
      <ContextNavigation>{navigation}</ContextNavigation>
      <ContextPanel>{panel}</ContextPanel>
      <ContextOutlet>{outlet || children}</ContextOutlet>
      <MobileBottomNav>{mobileBottom}</MobileBottomNav>
      <ModalHost>{modals}</ModalHost>
    </>
  );
};

export default AppShell;
