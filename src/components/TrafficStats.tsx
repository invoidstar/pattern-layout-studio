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
      className="traffic-stats"
      aria-label="Pattern Layout Studio traffic statistics"
      title="当前 Pattern Layout Studio 页面独立统计（Busuanzi Page UV / PV）"
    >
      <span>
        <b id="busuanzi_page_uv">—</b>
        <em>访客 UV</em>
      </span>
      <i />
      <span>
        <b id="busuanzi_page_pv">—</b>
        <em>浏览量 PV</em>
      </span>
    </span>
  );
}
