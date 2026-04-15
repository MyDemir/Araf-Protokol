import React from 'react';
import { ENV_ERRORS } from './useAppController';

// [TR] Eksik env değişkenleri için kapatılabilir uyarı şeridi
// [EN] Dismissible warning strip for missing env variables
export const EnvWarningBanner = () => {
  const [visible, setVisible] = React.useState(true);
  if (ENV_ERRORS.length === 0 || !visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-950/95 border-b border-red-800/60 backdrop-blur-sm flex items-center justify-between px-4 py-1.5 shadow-lg">
      <span className="text-red-400 text-[11px] font-mono flex items-center gap-2">
        <span className="text-red-500">⚠</span>
        {ENV_ERRORS.join(' · ')}
      </span>
      <button
        onClick={() => setVisible(false)}
        className="ml-4 text-red-500 hover:text-white transition text-sm leading-none shrink-0"
        aria-label="Kapat"
      >✕</button>
    </div>
  );
};

// [TR] Fonksiyon ad parity'si için wrapper render helper'ları
// [EN] Wrapper render helpers to preserve function-name parity
export const renderWalletModal = (controller) => controller.renderWalletModal();
export const renderFeedbackModal = (controller) => controller.renderFeedbackModal();
export const renderMakerModal = (controller) => controller.renderMakerModal();
export const renderProfileModal = (controller) => controller.renderProfileModal();
export const renderTermsModal = (controller) => controller.renderTermsModal();

export default function AppModals({ controller }) {
  return (
    <>
      {renderWalletModal(controller)}
      {renderFeedbackModal(controller)}
      {renderMakerModal(controller)}
      {renderProfileModal(controller)}
      {renderTermsModal(controller)}
    </>
  );
}
