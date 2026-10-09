import Icon from './ui/Icon';

export type MobileTab = 'canvas' | 'source' | 'parts';

interface MobileNavigationProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

export default function MobileNavigation({
  active,
  onChange,
}: MobileNavigationProps) {
  const tabs = [
    { id: 'canvas' as const, title: '画布', icon: 'canvas' as const },
    { id: 'source' as const, title: '原图', icon: 'image' as const },
    { id: 'parts' as const, title: '零件', icon: 'layers' as const },
  ];
  return (
    <nav className="v2-mobile-nav" aria-label="手机端工作区域切换">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`v2-mobile-tab ${active === tab.id ? 'active' : ''}`}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onChange(tab.id)}
        >
          <Icon name={tab.icon} size={21}/>
          <span>{tab.title}</span>
        </button>
      ))}
    </nav>
  );
}
