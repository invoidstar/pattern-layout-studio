import { useEffect } from 'react';

const SCRIPT_ID = 'busuanzi-counter-script';
const SCRIPT_SRC =
  'https://cdn.busuanzi.cc/busuanzi/3.6.9/busuanzi.min.js';

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
    <span
      className="traffic-stats traffic-stats-pv"
      aria-label="Site page views"
      title="本站总浏览量（Busuanzi PV）"
    >
      <em>浏览量</em>
      <b id="busuanzi_site_pv">—</b>
    </span>
  );
}
