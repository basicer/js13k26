
// zzfxV - global volume
export var zzfxV=.1

// zzfxR - global sample rate
export const zzfxR=44100

// zzfxX - the common audio context
export var zzfxX=new(window.AudioContext||webkitAudioContext);

// zzfx() - the universal entry point -- returns a AudioBufferSourceNode
export var zzfx=(t)=>()=>zzfxP(zzfxG(...t))

// zzfxP() - the sound player -- returns a AudioBufferSourceNode
export var zzfxP=(...t)=>{let e=zzfxX.createBufferSource(),f=zzfxX.createBuffer(t.length,t[0].length,zzfxR);t.map((d,i)=>f.getChannelData(i).set(d)),e.buffer=f,e.connect(zzfxX.destination),e.start();return e}

const M=Math;

// zzfxG() - the sound generator -- returns an array of sample data
export var zzfxG = (p=1,k=.05,b=220,e=0,r=0,t=.1,q=0,D=1,u=0,y=0,v=0,z=0,l=0,E=0,A=0,F=0,c=0,w=1,m=0,B=0,N=0)=>{    
    let d=2*M.PI,G=u*=500*d/zzfxR/zzfxR,C=b*=(1-k+2*k*M.random(k=[]))*d/zzfxR,g=0,H=0,a=0,n=1,I=0,J=0,f=0,
    h=N<0?-1:1,x=d*h*N*2/zzfxR,L=M.cos(x),Z=M.sin,K=Z(x)/4,O=1+K,X=-2*L/O,Y=(1-K)/O,P=(1+h*L)/2/O,
    Q=-(h+L)/O,S=P,T=0,U=0,V=0,W=0;e=zzfxR*e+9;m*=zzfxR;r*=zzfxR;t*=zzfxR;c*=zzfxR;y*=500*d/zzfxR**3;
    A*=d/zzfxR;v*=d/zzfxR;z*=zzfxR;l=zzfxR*l|0;p*=zzfxV;
    for(h=e+m+r+t+c|0;a<h;k[a++]=f*p)++J%(100*F|0)||(f=q?1<q?2<q?3<q?4<q?(g/d%1<D/2)*2-1:Z(g**3):M.max(M.min(M.tan(g)
    ,1),-1):1-(2*g/d%2+2)%2:1-4*M.abs(M.round(g/d)-g/d):Z(g),f=(l?1-B+B*Z(d*a/l):1)*(4<q?
    f:(f<0?-1:1)*M.abs(f)**D)*(a<e?a/e:a<e+m?1-(a-e)/m*(1-w):a<e+m+r?w:a<h-c?(h-a-c)/t*w:
    0),f=c?f/2+(c>a?0:(a<h-c?1:(h-a)/c)*k[a-c|0]/2/p):f,N?f=W=S*T+Q*(T=U)+P*(U=f)-Y*V-X*(
    V=W):0),x=(b+=u+=y)*M.cos(A*H++),g+=x+x*E*Z(a**5),n&&++n>z&&(b+=v,C+=v,n=0),!l||++I%l
    ||(b=C,u=G,n=n||1); return k
}

//! ZzFXM (v2.0.3) | (C) Keith Clark | MIT | https://github.com/keithclark/ZzFXM
export var zzfxM=(n,f,t,e=125)=>{let l,o,z,r,g,h,x,a,u,c,d,i,m,p,G,M=0,R=[],b=[],j=[],k=0,q=0,s=1,v={},w=zzfxR/e*60>>2;for(;s;k++)R=[s=a=d=m=0],t.map((e,d)=>{for(x=f[e][k]||[0,0,0],s|=!!f[e][k],G=m+(f[e][0].length-2-!a)*w,p=d==t.length-1,o=2,r=m;o<x.length+p;a=++o){for(g=x[o],u=o==x.length+p-1&&p||c!=(x[0]||0)|g|0,z=0;z<w&&a;z++>w-99&&u?i+=(i<1)/99:0)h=(1-i)*R[M++]/2||0,b[r]=(b[r]||0)-h*q+h,j[r]=(j[r++]||0)+h*q+h;g&&(i=g%1,q=x[1]||0,(g|=0)&&(R=v[[c=x[M=0]||0,g]]=v[[c,g]]||(l=[...n[c]],l[2]*=2**((g-12)/12),g>0?zzfxG(...l):[])))}m=G});return[b,j]}

