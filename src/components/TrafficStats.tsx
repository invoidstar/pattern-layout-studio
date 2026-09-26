import { useEffect } from 'react';

const SCRIPT_ID = 'busuanzi-counter-script';
const SCRIPT_SRC = 'https://cdn.busuanzi.cc/busuanzi/3.6.9/busuanzi.min.js';

export default function TrafficStats() {
  useEffect(() => {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  return (
    <span className="traffic-stats" aria-label="Site traffic statistics">
      <span>
        <b id="busuanzi_site_uv">—</b>
        <em>访客</em>
      </span>
      <i />
      <span>
        <b id="busuanzi_site_pv">—</b>
        <em>访问</em>
      </span>
    </span>
  );
}
