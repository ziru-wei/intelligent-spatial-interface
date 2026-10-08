// Landmark-seeded segmentation. Detect at low resolution, segment original RGB at
// higher resolution; remove GrabCut islands that are not attached to a hand seed.
function segmentHands(cv,canvas,hands){
 const {width,height}=canvas,ctx=canvas.getContext('2d'),mask=new Uint8Array(width*height);
 if(!hands.length)return mask;
 const seed=new OffscreenCanvas(width,height),c=seed.getContext('2d'),coreCanvas=new OffscreenCanvas(width,height),core=coreCanvas.getContext('2d');
 c.fillStyle='rgb(0,0,0)';c.fillRect(0,0,width,height);
 for(const landmarks of hands){
  const p=landmarks.map(v=>({x:v.x*width,y:v.y*height})),palm=Math.hypot(p[5].x-p[17].x,p[5].y-p[17].y),pad=Math.max(8,palm*.70);
  const xs=p.map(v=>v.x),ys=p.map(v=>v.y);
  c.fillStyle='rgb(170,170,170)';c.fillRect(Math.min(...xs)-pad,Math.min(...ys)-pad,Math.max(...xs)-Math.min(...xs)+2*pad,Math.max(...ys)-Math.min(...ys)+2*pad);
  const polygon=(ids,value,scale,target=c)=>{const center=ids.reduce((s,i)=>({x:s.x+p[i].x/ids.length,y:s.y+p[i].y/ids.length}),{x:0,y:0});target.fillStyle=`rgb(${value},${value},${value})`;target.beginPath();ids.forEach((i,k)=>{const x=center.x+(p[i].x-center.x)*scale,y=center.y+(p[i].y-center.y)*scale;k?target.lineTo(x,y):target.moveTo(x,y);});target.closePath();target.fill();};
  polygon([0,1,5,9,13,17],255,1.05);
  const chains=[[0,1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
  for(const [value,radius] of [[255,.20],[85,.055]]){
   if(value===85){polygon([0,5,9,13,17],85,.65);polygon([0,5,9,13,17],255,.65,core);}
   c.lineCap='round';c.lineJoin='round';c.strokeStyle=`rgb(${value},${value},${value})`;c.lineWidth=Math.max(1,palm*radius);
   for(const brush of value===85?[c,core]:[c]){brush.lineCap='round';brush.lineJoin='round';brush.lineWidth=c.lineWidth;if(brush===core)brush.strokeStyle='white';for(const chain of chains){brush.beginPath();chain.forEach((i,k)=>k?brush.lineTo(p[i].x,p[i].y):brush.moveTo(p[i].x,p[i].y));brush.stroke();}}
  }
 }
 const pixels=c.getImageData(0,0,width,height).data,corePixels=core.getImageData(0,0,width,height).data,rgba=cv.matFromImageData(ctx.getImageData(0,0,width,height)),rgb=new cv.Mat(),labels=new cv.Mat(height,width,cv.CV_8UC1),background=new cv.Mat(),foreground=new cv.Mat();
 const binary=new cv.Mat(height,width,cv.CV_8UC1),components=new cv.Mat(),kernel=cv.Mat.ones(3,3,cv.CV_8U);
 try{
  cv.cvtColor(rgba,rgb,cv.COLOR_RGBA2RGB);
  // Anti-aliased seed edges are uncertain; never accidentally make them hard foreground.
  for(let i=0;i<mask.length;i++){const v=pixels[i*4];labels.data[i]=corePixels[i*4]===255?1:v===0?0:v===255?3:2;}
  cv.grabCut(rgb,labels,new cv.Rect(),background,foreground,4,cv.GC_INIT_WITH_MASK);
  for(let i=0;i<mask.length;i++)binary.data[i]=labels.data[i]===cv.GC_FGD||labels.data[i]===cv.GC_PR_FGD?255:0;
  cv.morphologyEx(binary,binary,cv.MORPH_CLOSE,kernel);
  cv.connectedComponents(binary,components,8,cv.CV_32S);
  const keep=new Set();
  for(let i=0;i<mask.length;i++)if(corePixels[i*4]===255&&binary.data[i])keep.add(components.data32S[i]);
  for(let i=0;i<mask.length;i++)binary.data[i]=keep.has(components.data32S[i])?255:0;
  // A one-pixel safety rim prevents effects cutting into a finger's edge.
  cv.dilate(binary,binary,kernel);mask.set(binary.data);
 }finally{rgba.delete();rgb.delete();labels.delete();background.delete();foreground.delete();binary.delete();components.delete();kernel.delete();}
 return mask;
}
