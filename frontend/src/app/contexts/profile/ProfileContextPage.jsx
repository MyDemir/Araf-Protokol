import React from 'react';
import { ProfileNav } from './ProfilePanels';
import ProfileContextPanel from './ProfileContextPanel';

export const ProfileContextPage = (props) => {
  const { lang = 'EN', initialActiveTab = 'account', setInitialActiveTab } = props;
  const [activeTab, setActiveTabState] = React.useState(initialActiveTab || 'account');
  React.useEffect(() => {
    if (initialActiveTab) setActiveTabState(initialActiveTab);
  }, [initialActiveTab]);
  const setActiveTab = (nextTab) => {
    setActiveTabState(nextTab);
    setInitialActiveTab?.(nextTab);
  };

  return (
    <div className="w-full max-w-[1200px] px-4 md:px-8">
      <h1 className="text-2xl font-bold text-white mb-1">{lang === 'TR' ? 'Profil Merkezi' : 'Profile Center'}</h1>
      <p className="text-sm text-slate-400 mb-4">{lang === 'TR' ? 'Profil ve işlem ayarlarınızı yönetin.' : 'Manage your profile and trade settings.'}</p>
      <ProfileNav lang={lang} activeTab={activeTab} setActiveTab={setActiveTab} />
      <ProfileContextPanel activeTab={activeTab} {...props} />
    </div>
  );
};

export default ProfileContextPage;
