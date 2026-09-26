import {useState} from 'react';

const A4={w:2970,h:2100};const SQUARE={w:3500,h:3500};

export default function App(){
 const [src,setSrc]=useState<string>();const [size,setSize]=useState('');const [out,setOut]=useState<string>();const [msg,setMsg]=useState('');
 function load(file:File){const r=new FileReader();r.onload=()=>{const i=new Image();i.onload=()=>{setSrc(String(r.result));setSize(`${i.width}×${i.height}`);setMsg(i.width===3500&&i.height===3500?'3500 → A4 mode':i.width===2970&&i.height===2100?'A4 → 3500 mode':'Unsupported size')};i.src=String(r.result)};r.readAsDataURL(file)}
 function convert(){if(!src)return;const i=new Image();i.onload=()=>{const target=size==='3500×3500'?A4:SQUARE;const c=document.createElement('canvas');c.width=target.w;c.height=target.h;const x=c.getContext('2d')!;x.fillStyle='#aaaaaa';x.fillRect(0,0,c.width,c.height);if(size==='3500×3500'){x.drawImage(i,0,0)}else{x.drawImage(i,(3500-i.width)/2,(3500-i.height)/2)}setOut(c.toDataURL('image/png'));};i.src=src}
 return <main><h1>Pattern Layout Studio</h1><p>No-scale converter: 3500×3500 ↔ A4 2970×2100. Parts are not resized.</p><input type="file" accept="image/png" onChange={e=>e.target.files&&load(e.target.files[0])}/><h3>{size}</h3><h3>{msg}</h3><button onClick={convert}>Convert</button>{out&&<><h3>Preview</h3><img src={out}/><br/><a download="pattern.png" href={out}>Download PNG</a></>}</main>
}
