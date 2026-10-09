import Icon from './ui/Icon';

interface AppHeaderProps {
  onAnnouncements: () => void;
}

export default function AppHeader({ onAnnouncements }: AppHeaderProps) {
  return (
    <header className="v2-topbar">
      <a className="v2-brand" href="./" aria-label="Pattern Layout Studio 首页">
        <span className="v2-brand-mark"><Icon name="layers" size={23}/></span>
        <span className="v2-brand-copy">
          <strong>Pattern Layout Studio</strong>
          <small>图纸拆件与智能排版</small>
        </span>
      </a>
      <nav className="v2-topnav" aria-label="主导航">
        <span className="v2-nav-current">工作台</span>
        <button type="button" className="v2-nav-link" onClick={onAnnouncements}>
          <Icon name="bell" size={16}/> 更新公告
        </button>
      </nav>
      <button type="button" className="v2-announcement-compact" onClick={onAnnouncements} aria-label="查看更新公告">
        <Icon name="bell" size={19}/>
        <span className="v2-announcement-dot"/>
      </button>
    </header>
  );
}
