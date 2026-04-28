import React, { Suspense, useState, useEffect, useRef, useMemo } from 'react';
import { Canvas, useThree, ThreeEvent, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, useProgress, DeviceOrientationControls } from '@react-three/drei';
import * as THREE from 'three';
import { 
  ZoomIn, ZoomOut, Maximize, Minimize, X, Play, Pause, RotateCcw, 
  Sparkles, MapPin, ChevronRight, Info, Square, Headphones, Activity,
  Smartphone, Map, Settings2, Link as LinkIcon, DoorOpen, Layers,
  Volume2, VolumeX, Cloud
} from 'lucide-react';
import { analyzeSceneWithAI, generateTourSpeech, SceneAnalysis } from '../services/ai';
import { SceneItem } from '../App';

interface MarkerData {
  id: string;
  position: THREE.Vector3;
  label: string;
  description?: string;
  isCustom?: boolean;
  targetSceneId?: string | null;
}

function Loader() {
  const { progress } = useProgress();
  return (
    <Html center>
      <div className="flex flex-col items-center justify-center p-6 bg-black/60 rounded-2xl backdrop-blur-md text-white shadow-2xl border border-white/10 w-48">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-lg font-medium">{progress.toFixed(0)}%</p>
      </div>
    </Html>
  );
}

function MarkerPoint({ marker, onClick }: { marker: MarkerData, onClick: () => void }) {
  const isPortal = !!marker.targetSceneId;
  return (
    <Html position={marker.position} center>
      <div 
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`w-8 h-8 rounded-full border-2 border-white shadow-[0_0_15px_rgba(0,0,0,0.5)] flex items-center justify-center cursor-pointer hover:scale-125 transition-transform group ${isPortal ? 'bg-indigo-500/80 shadow-indigo-500/50' : 'bg-blue-500/80 shadow-blue-500/50'}`}
      >
        {isPortal ? <DoorOpen className="w-4 h-4 text-white" /> : <div className="w-2 h-2 bg-white rounded-full"></div>}
        <div className="absolute top-10 whitespace-nowrap bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-lg text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity border border-white/10 pointer-events-none">
          {marker.label} {isPortal && "(Teleport)"}
        </div>
      </div>
    </Html>
  );
}

function SceneDisplayer({ sceneItem, markers, onAddMarker, onVideoLoaded }: { sceneItem: SceneItem, markers: MarkerData[], onAddMarker: (m: MarkerData, isPortal: boolean) => void, onVideoLoaded?: (video: HTMLVideoElement | null) => void }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let active = true;
    let currentVideo: HTMLVideoElement | null = null;
    
    if (sceneItem.type === 'video') {
      const video = document.createElement('video');
      currentVideo = video;
      video.src = sceneItem.url;
      video.crossOrigin = 'Anonymous';
      video.loop = true;
      video.muted = false;
      video.playsInline = true;
      video.autoplay = true;
      video.play().catch(e => {
        console.warn("Video autplay failed, falling back to muted", e);
        video.muted = true;
        video.play().catch(e => console.warn("Video autplay muted failed", e));
      });
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;
      setTexture(tex);
      if (onVideoLoaded) onVideoLoaded(video);
    } else {
      new THREE.TextureLoader().load(sceneItem.url, (tex) => {
        if (!active) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.repeat.x = -1;
        setTexture(tex);
      });
      if (onVideoLoaded) onVideoLoaded(null);
    }
    return () => { 
      active = false; 
      if (currentVideo) {
        currentVideo.pause();
        currentVideo.removeAttribute('src');
        currentVideo.load();
      }
      if (onVideoLoaded) onVideoLoaded(null);
    };
  }, [sceneItem, onVideoLoaded]);

  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const position = e.point.clone().normalize().multiplyScalar(490);
    // Add custom marker, or let's say Shift+DoubleClick to make a Portal
    const isPortal = e.shiftKey;
    onAddMarker({
      id: Date.now().toString(),
      position,
      label: isPortal ? `New Portal` : `Custom Point ${markers.length + 1}`,
      isCustom: true
    }, isPortal);
  };

  if (!texture) return <Loader />;

  return (
    <mesh onDoubleClick={handleDoubleClick}>
      <sphereGeometry args={[500, 60, 40]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} />
    </mesh>
  );
}

function CameraController({ 
  fov, 
  setFov,
  targetPos,
  setTargetPos,
  setAutoRotate,
  onCameraUpdate
}: { 
  fov: number; 
  setFov: React.Dispatch<React.SetStateAction<number>>;
  targetPos: THREE.Vector3 | null;
  setTargetPos: React.Dispatch<React.SetStateAction<THREE.Vector3 | null>>;
  setAutoRotate: React.Dispatch<React.SetStateAction<boolean>>;
  onCameraUpdate: (azimuth: number) => void;
}) {
  const { camera, gl } = useThree();

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTargetPos(null);
      setAutoRotate(false);
      setFov((prev) => Math.max(20, Math.min(120, prev + e.deltaY * 0.05)));
    };

    let startDist = 0;
    let startFov = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if(e.touches.length > 0) {
        setTargetPos(null);
        setAutoRotate(false);
      }
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        startDist = Math.sqrt(dx * dx + dy * dy);
        startFov = (camera as THREE.PerspectiveCamera).fov;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const currentDist = Math.sqrt(dx * dx + dy * dy);
        const scale = startDist / currentDist;
        setFov(Math.max(20, Math.min(120, startFov * scale)));
      }
    };

    const el = gl.domElement;
    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: false });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
    };
  }, [setFov, gl.domElement, camera, setTargetPos, setAutoRotate]);

  useFrame((state, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * 5 * delta;
      cam.updateProjectionMatrix();
    } else if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (targetPos) {
      camera.position.lerp(targetPos, 5 * delta);
      if (camera.position.distanceTo(targetPos) < 0.01) {
        setTargetPos(null);
      }
    }
    
    // Calculate azimuth for radar
    const v = new THREE.Vector3(0, 0, -1);
    v.applyQuaternion(camera.quaternion);
    const azimuth = Math.atan2(v.x, v.z); 
    onCameraUpdate(azimuth);
  });

  return null;
}

function coordsToVector(x: number, y: number): THREE.Vector3 {
  const radius = 490;
  const theta = (1 - x) * 2 * Math.PI - Math.PI; 
  const phi = y * Math.PI; 
  const vx = -radius * Math.sin(phi) * Math.cos(theta);
  const vy = radius * Math.cos(phi);
  const vz = -radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(vx, vy, vz);
}

export default function Viewer360({ 
  scenes, 
  currentSceneId, 
  onNavigate, 
  onAddScene, 
  onClose,
  onCloudShare,
  isSavingToCloud
}: { 
  scenes: SceneItem[], 
  currentSceneId: string, 
  onNavigate: (id: string) => void,
  onAddScene: (files: FileList | null) => void,
  onClose: () => void,
  onCloudShare?: (markersByScene: Record<string, MarkerData[]>) => void,
  isSavingToCloud?: boolean
}) {
  const currentScene = scenes.find(s => s.id === currentSceneId) || scenes[0];
  const initialFov = typeof window !== 'undefined' && window.innerWidth < window.innerHeight ? 100 : 75;
  const [fov, setFov] = useState(initialFov);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  
  const [markersByScene, setMarkersByScene] = useState<Record<string, MarkerData[]>>({});
  const markers = markersByScene[currentSceneId] || [];
  
  const [targetPos, setTargetPos] = useState<THREE.Vector3 | null>(null);
  const [sceneInfo, setSceneInfo] = useState<SceneAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  
  // UI states
  const [showPanel, setShowPanel] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [useDeviceOrientation, setUseDeviceOrientation] = useState(false);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  
  // Filters
  const [filters, setFilters] = useState({ brightness: 100, contrast: 100, saturation: 100 });
  
  // Minimap
  const minimapArrowRef = useRef<HTMLDivElement>(null);
  
  const handleCameraUpdate = React.useCallback((azimuth: number) => {
    if (minimapArrowRef.current) {
        const minimapRotation = -azimuth;
        minimapArrowRef.current.style.transform = `rotate(${minimapRotation + Math.PI}rad)`;
    }
  }, []);
  
  // Tour
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [isAutoTouring, setIsAutoTouring] = useState(false);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const tourIndexRef = useRef<{isTouring: boolean, index: number}>({ isTouring: false, index: -1 });

  const markersRef = useRef(markers);
  useEffect(() => { markersRef.current = markers; }, [markers]);

  const sceneInfoRef = useRef(sceneInfo);
  useEffect(() => { sceneInfoRef.current = sceneInfo; }, [sceneInfo]);

  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<any>(null);

  // URL state sync
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      if (qs.has('state')) {
        const decoded = JSON.parse(atob(qs.get('state') as string));
        if (decoded.markersByScene) {
          setMarkersByScene(decoded.markersByScene);
        }
      }
    } catch(e) {}
  }, []);

  const handleCopyLink = () => {
    const dataToSave = {
      markersByScene,
      scenes: scenes.filter(s => !s.url.startsWith('blob:')),
      currentSceneId
    };
    const encoded = btoa(JSON.stringify(dataToSave));
    const url = new URL(window.location.href);
    url.searchParams.set('state', encoded);
    navigator.clipboard.writeText(url.toString());
    alert("Shareable link copied to clipboard! (Note: Only online URLs and demo scenes can be shared, not locally uploaded files)");
  };

  const stopVoice = () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); audioSourceRef.current.disconnect(); } catch (e) {}
      audioSourceRef.current = null;
    }
    window.speechSynthesis.cancel();
    setIsPlayingVoice(false);
  };

  const playVoice = async (text: string, onEnd?: () => void) => {
    stopVoice();
    setIsPlayingVoice(true);
    
    // Attempt high quality AI voice
    const speechOutput = await generateTourSpeech(text);
    
    if (speechOutput && typeof speechOutput === 'string') {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const binaryString = atob(speechOutput);
        const buffer = new ArrayBuffer(binaryString.length);
        const uint8View = new Uint8Array(buffer);
        for (let i = 0; i < binaryString.length; i++) {
          uint8View[i] = binaryString.charCodeAt(i);
        }
        const int16View = new Int16Array(buffer);
        const audioBuffer = ctx.createBuffer(1, int16View.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16View.length; i++) {
          channelData[i] = int16View[i] / 32768.0;
        }
        
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => {
          setIsPlayingVoice(false);
          if (onEnd) setTimeout(() => onEnd(), 500); 
        };
        source.start();
        audioSourceRef.current = source;
        return;
      } catch (err: any) {
        console.warn("PCM playback error, falling back:", err?.message || err);
      }
    }
    
    // Fallback to local speech synthesis
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => {
      setIsPlayingVoice(false);
      if (onEnd) setTimeout(() => onEnd(), 500);
    };
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => () => stopVoice(), []);

  const nextTourStop = () => {
    if (!tourIndexRef.current.isTouring) return;
    
    const index = tourIndexRef.current.index + 1;
    tourIndexRef.current.index = index;
    const mktList = markersRef.current;
    
    if (index < mktList.length) {
      const m = mktList[index];
      handleMarkerClick(m, true);
      setTimeout(() => {
        if (!tourIndexRef.current.isTouring) return;
        playVoice(`${m.label}. ${m.description || ""}`, nextTourStop);
      }, 1500);
    } else {
      playVoice(`That concludes the tour of this scene.`, () => {
        setIsAutoTouring(false);
        tourIndexRef.current.isTouring = false;
      });
    }
  };

  const startTour = async () => {
    if (!sceneInfoRef.current) return;
    setIsAutoTouring(true);
    setShowPanel(true);
    tourIndexRef.current = { isTouring: true, index: -1 };
    await playVoice(`Welcome to the tour of ${sceneInfoRef.current.title}. ${sceneInfoRef.current.description}`, nextTourStop);
  };

  const stopTour = () => {
    setIsAutoTouring(false);
    tourIndexRef.current.isTouring = false;
    stopVoice();
  };

  const toggleTour = () => {
    if (isAutoTouring) stopTour();
    else startTour();
  };

  useEffect(() => {
    let isMounted = true;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setSceneInfo(null);
    
    stopTour();
    
    if (currentScene.type === 'video') {
       setIsAnalyzing(false);
       setSceneInfo({ title: '360° Video', description: 'Immersive spherical video playing.', pointsOfInterest: []});
       return;
    }
    
    analyzeSceneWithAI(currentScene.url, currentScene.file).then(analysis => {
      if (!isMounted) return;
      setIsAnalyzing(false);
      if (analysis) {
        if ('error' in analysis) {
          setAnalysisError(analysis.error);
        } else {
          setSceneInfo(analysis);
          const aiMarkers = analysis.pointsOfInterest.map((poi, i) => ({
            id: `ai-marker-${i}`,
            label: poi.label,
            description: poi.description,
            position: coordsToVector(poi.coordinates.x, poi.coordinates.y),
            isCustom: false
          }));
          
          setMarkersByScene(prev => {
            const current = prev[currentSceneId] || [];
            const newMarkers = [...current.filter(m => m.isCustom || m.targetSceneId), ...aiMarkers];
            return { ...prev, [currentSceneId]: newMarkers };
          });
        }
      }
    });

    return () => { isMounted = false; };
  }, [currentSceneId, currentScene.url]);

  useEffect(() => {
    const handleResize = () => {
      const isPortrait = window.innerWidth < window.innerHeight;
      setFov(isPortrait ? 100 : 75);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => console.error(err.message));
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleZoomIn = () => {
    setTargetPos(null);
    setFov(prev => Math.max(20, prev - 15));
  };
  
  const handleZoomOut = () => {
    setTargetPos(null);
    setFov(prev => Math.min(120, prev + 15));
  };
  
  const handleResetView = () => {
    const isPortrait = window.innerWidth < window.innerHeight;
    setFov(isPortrait ? 100 : 75);
    setAutoRotate(false);
    setTargetPos(null);
    if (controlsRef.current) {
        if (controlsRef.current.reset) controlsRef.current.reset();
    }
  };

  const handleMarkerClick = (marker: MarkerData, fromTour = false) => {
    setAutoRotate(false);
    setActiveMarkerId(marker.id);
    
    if (marker.targetSceneId && !fromTour) {
        onNavigate(marker.targetSceneId);
        return;
    }
    
    if (isPlayingVoice && !isAutoTouring) stopVoice();
    if (!isAutoTouring && !fromTour) {
        playVoice(`${marker.label}. ${marker.description || ""}`);
    }

    const newPos = marker.position.clone().normalize().multiplyScalar(-0.1);
    setTargetPos(newPos);
    setFov(prev => Math.max(50, prev - 15));
  };
  
  const addMarker = (m: MarkerData, isPortal: boolean) => {
    if (isPortal && scenes.length > 1) {
        const otherScene = scenes.find(s => s.id !== currentSceneId);
        if (otherScene) m.targetSceneId = otherScene.id;
    }
    setMarkersByScene(prev => ({
        ...prev,
        [currentSceneId]: [...(prev[currentSceneId] || []), m]
    }));
  };
  
  const toggleDeviceOrientation = async () => {
    if (!useDeviceOrientation && typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const response = await (DeviceOrientationEvent as any).requestPermission();
        if (response === 'granted') {
          setUseDeviceOrientation(true);
        } else {
          alert('Permission for device orientation was denied.');
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      setUseDeviceOrientation(!useDeviceOrientation);
    }
  };

  const toggleVideoMute = () => {
    if (videoEl) {
      videoEl.muted = !videoEl.muted;
      setIsVideoMuted(videoEl.muted);
    }
  };

  const zoomPercentage = Math.round(((120 - fov) / 100) * 100 + 50);

  const handleVideoLoaded = React.useCallback((v: HTMLVideoElement | null) => {
    setVideoEl(v);
    if (v) setIsVideoMuted(v.muted);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-gray-950 group/viewer overflow-hidden flex flex-col items-center justify-center font-sans tracking-tight">
      <Canvas 
        camera={{ position: [0, 0, 0.1] }} 
        gl={{ antialias: true }}
        style={{ 
          filter: `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%)` 
        }}
      >
        <CameraController 
          fov={fov} setFov={setFov} 
          targetPos={targetPos} setTargetPos={setTargetPos} 
          setAutoRotate={setAutoRotate} 
          onCameraUpdate={handleCameraUpdate}
        />
        <Suspense fallback={null}>
          <SceneDisplayer 
            sceneItem={currentScene} 
            markers={markers} 
            onAddMarker={addMarker} 
            onVideoLoaded={handleVideoLoaded}
          />
          {markers.map(m => (
            <MarkerPoint key={m.id} marker={m} onClick={() => handleMarkerClick(m)} />
          ))}
        </Suspense>
        
        {useDeviceOrientation ? (
           <DeviceOrientationControls ref={controlsRef} />
        ) : (
          <OrbitControls
            ref={controlsRef}
            enableZoom={false}
            enablePan={false}
            enableDamping={true}
            dampingFactor={0.05}
            autoRotate={autoRotate}
            autoRotateSpeed={1.0}
            rotateSpeed={-0.4}
          />
        )}
      </Canvas>
      
      {/* Feature Menu top left */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
         <h2 className="text-white text-sm font-medium bg-black/40 backdrop-blur-md px-3 py-1.5 rounded border border-white/10 shadow-lg select-none">
          360° Studio
        </h2>
        <div className="flex gap-2">
            <button 
              onClick={() => setShowConfig(!showConfig)}
              className={`bg-black/50 hover:bg-black/70 backdrop-blur-md p-2.5 rounded-xl transition-all border shadow-lg ${showConfig ? 'text-blue-400 border-blue-500/50' : 'text-white/80 border-white/10'}`}
              title="Image Adjustments"
            >
              <Settings2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setShowMinimap(!showMinimap)}
              className={`bg-black/50 hover:bg-black/70 backdrop-blur-md p-2.5 rounded-xl transition-all border shadow-lg ${showMinimap ? 'text-blue-400 border-blue-500/50' : 'text-white/80 border-white/10'}`}
              title="Toggle Minimap"
            >
              <Map className="w-4 h-4" />
            </button>
            {scenes.length > 1 && (
               <div className="bg-black/50 backdrop-blur-md px-3 py-2 rounded-xl flex items-center gap-2 border border-white/10">
                 <Layers className="w-4 h-4 text-white/50" />
                 <select 
                    className="bg-transparent text-white text-xs font-medium outline-none cursor-pointer w-24"
                    value={currentSceneId}
                    onChange={e => onNavigate(e.target.value)}
                 >
                   {scenes.map(s => <option key={s.id} value={s.id} className="bg-gray-900">{s.name}</option>)}
                 </select>
               </div>
            )}
        </div>
        
        {/* Enhancements Panel */}
        {showConfig && (
            <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-4 w-64 mt-2 shadow-2xl flex flex-col gap-4">
               <div>
                 <label className="text-xs text-white/70 flex justify-between mb-1">
                    Brightness <span>{filters.brightness}%</span>
                 </label>
                 <input type="range" min="50" max="150" value={filters.brightness} onChange={e => setFilters({...filters, brightness:Number(e.target.value)})} className="w-full accent-blue-500" />
               </div>
               <div>
                 <label className="text-xs text-white/70 flex justify-between mb-1">
                    Contrast <span>{filters.contrast}%</span>
                 </label>
                 <input type="range" min="50" max="150" value={filters.contrast} onChange={e => setFilters({...filters, contrast:Number(e.target.value)})} className="w-full accent-blue-500" />
               </div>
               <div>
                 <label className="text-xs text-white/70 flex justify-between mb-1">
                    Saturation <span>{filters.saturation}%</span>
                 </label>
                 <input type="range" min="0" max="200" value={filters.saturation} onChange={e => setFilters({...filters, saturation:Number(e.target.value)})} className="w-full accent-blue-500" />
               </div>
            </div>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        {videoEl && (
          <button 
            onClick={toggleVideoMute}
            className={`bg-black/50 hover:bg-black/70 backdrop-blur-md p-2.5 rounded-xl transition-all border shadow-lg active:scale-95 ${!isVideoMuted ? 'text-blue-400 border-blue-500/50' : 'text-white border-white/10'}`}
            title={isVideoMuted ? "Unmute Video" : "Mute Video"}
          >
            {isVideoMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        )}
        <button 
          onClick={handleCopyLink}
          className="bg-black/50 hover:bg-black/70 backdrop-blur-md text-white p-2.5 rounded-xl transition-all border border-white/10 shadow-lg active:scale-95 flex items-center justify-center"
          title="Share Link (Local)"
        >
          <LinkIcon className="w-5 h-5" />
        </button>
        {onCloudShare && (
          <button 
            onClick={() => onCloudShare(markersByScene)}
            disabled={isSavingToCloud}
            className="bg-blue-600/80 hover:bg-blue-500/80 backdrop-blur-md text-white p-2.5 rounded-xl transition-all border border-blue-400/30 shadow-lg active:scale-95 flex items-center justify-center"
            title="Save & Share to Cloud"
          >
            {isSavingToCloud ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Cloud className="w-5 h-5" />}
          </button>
        )}
        <button 
          onClick={toggleDeviceOrientation}
          className={`bg-black/50 hover:bg-black/70 backdrop-blur-md p-2.5 rounded-xl transition-all border shadow-lg active:scale-95 md:hidden ${useDeviceOrientation ? 'text-blue-400 border-blue-500/50' : 'text-white border-white/10'}`}
          title="Use Device Orientation"
        >
          <Smartphone className="w-5 h-5" />
        </button>
        <button 
          onClick={toggleFullscreen}
          className="bg-black/50 hover:bg-black/70 backdrop-blur-md text-white p-2.5 rounded-xl transition-all border border-white/10 shadow-lg active:scale-95"
          title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </button>
      </div>

      <div className="absolute bottom-6 right-4 z-10 flex flex-col items-center gap-3">
        <div className="bg-black/50 backdrop-blur-md text-white/90 text-xs font-semibold px-2 py-1.5 rounded-md text-center border border-white/10 shadow-lg select-none min-w-[50px]">
          {zoomPercentage}%
        </div>
        <div className="flex flex-col bg-black/50 backdrop-blur-md rounded-xl border border-white/10 shadow-lg overflow-hidden">
          <button 
            onClick={handleZoomIn}
            disabled={fov <= 20}
            className="p-3 text-white hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors border-b border-white/10 active:bg-white/30"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button 
            onClick={handleZoomOut}
            disabled={fov >= 120}
            className="p-3 text-white hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors active:bg-white/30"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      {/* Minimap */}
      {showMinimap && currentScene.type === 'image' && (
         <div className="absolute bottom-6 left-4 z-10 w-48 h-24 bg-black/80 rounded-xl overflow-hidden border border-white/20 shadow-2xl flex items-center justify-center p-1 pointer-events-none">
             <div className="relative w-full h-full bg-black rounded-lg overflow-hidden flex items-center justify-center">
                 <img src={currentScene.url} className="w-full h-full object-cover opacity-80" alt="Minimap" />
                 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 z-20">
                    <div className="w-2 h-2 rounded-full bg-blue-500 absolute top-1 left-1.5 border border-white/50"></div>
                    {/* View Cone */}
                    <div 
                        ref={minimapArrowRef}
                        className="absolute inset-0 border-t-[8px] border-l-[8px] border-r-[8px] border-t-white/80 border-l-transparent border-r-transparent origin-center rounded-full scale-[2]"
                        style={{ transform: `rotate(${Math.PI}rad)` }}
                    ></div>
                 </div>
             </div>
         </div>
      )}

      {/* Main Bottom Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 transition-all">
          <div className="flex bg-gray-900/80 backdrop-blur-xl rounded-full border border-white/10 shadow-2xl p-1.5 overflow-hidden ring-1 ring-white/5">
            <button 
              onClick={() => { setTargetPos(null); setAutoRotate(!autoRotate); setUseDeviceOrientation(false); }}
              className={`w-12 h-12 flex items-center justify-center rounded-full transition-all ${autoRotate ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-gray-300 active:scale-95'}`}
            >
              {autoRotate ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-1" />}
            </button>
            <button 
              onClick={handleResetView}
              className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-white/10 text-gray-300 transition-all active:scale-95"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          </div>
          {(sceneInfo || isAnalyzing) && (
            <button 
              onClick={() => setShowPanel(!showPanel)}
              className={`bg-gray-900/80 hover:bg-black backdrop-blur-xl px-6 py-3 min-h-[60px] rounded-full font-medium transition-all active:scale-95 border border-white/10 flex items-center gap-2 shadow-2xl hover:shadow-white/20 ${showPanel ? 'text-blue-400' : 'text-white'}`}
            >
              <Info className="w-5 h-5" />
              <span className="hidden sm:inline">{showPanel ? "Hide Guide" : "Tour Guide"}</span>
            </button>
          )}
          <button 
              onClick={onClose}
              className="bg-gray-900/80 hover:bg-red-950/80 backdrop-blur-xl text-white px-6 py-3 min-h-[60px] rounded-full font-medium transition-all active:scale-95 border border-white/10 flex items-center gap-2 shadow-2xl hover:shadow-white/20"
            >
              <X className="w-5 h-5" />
              <span className="hidden sm:inline">Close</span>
            </button>
      </div>

      {/* AI Tour Guide Panel */}
      <div 
        className={`absolute top-0 right-0 h-full w-80 sm:w-96 bg-black/60 backdrop-blur-xl border-l border-white/10 p-6 flex flex-col transform transition-transform duration-500 ease-in-out z-20 shadow-2xl ${showPanel && (sceneInfo || isAnalyzing || analysisError) ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {(sceneInfo || isAnalyzing || analysisError) && (
          <button 
            onClick={() => setShowPanel(!showPanel)}
            className={`absolute top-1/2 -translate-y-1/2 -left-12 w-12 h-20 flex items-center justify-center bg-black/60 hover:bg-black/80 backdrop-blur-xl rounded-l-xl border border-white/10 border-r-0 text-white shadow-[-5px_0_15px_rgba(0,0,0,0.5)] transition-colors z-50`}
            title={showPanel ? "Collapse panel" : "Expand panel"}
          >
            <ChevronRight className={`w-6 h-6 transition-transform duration-500 delay-100 ${showPanel ? 'rotate-0' : 'rotate-180'}`} />
          </button>
        )}

        {isAnalyzing ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-white">
            <Sparkles className="w-10 h-10 animate-pulse text-blue-400" />
            <p className="text-lg font-medium animate-pulse">AI is exploring the scene...</p>
            <p className="text-xs text-white/50 text-center px-4">Analyzing features, identifying landmarks, and preparing your guided tour.</p>
          </div>
        ) : analysisError ? (
          <div className="text-white flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
               <Sparkles className="w-5 h-5 text-blue-400" />
               <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400">AI Tour Guide Error</h3>
            </div>
            <h2 className="text-xl font-semibold leading-tight mb-3 text-red-300">Feature Unavailable</h2>
            <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl">
              <p className="text-white/80 text-sm leading-relaxed">{analysisError}</p>
            </div>
            
            <div className="mt-8 overflow-y-auto custom-scrollbar pr-2">
              <h3 className="text-xs font-semibold text-white/50 mb-3 uppercase tracking-wider flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Locations
              </h3>
              {markers.map(m => (
                <button 
                  key={m.id}
                  onClick={() => handleMarkerClick(m)}
                  className={`w-full text-left p-4 rounded-xl border transition-all duration-300 mb-2 ${m.id === activeMarkerId ? 'bg-blue-600/20 border-blue-500/50 shadow-lg' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}`}
                >
                  <div className="font-semibold text-sm mb-1 flex justify-between items-center text-white/90">
                     {m.label}
                     {m.targetSceneId ? <span className="text-[10px] bg-indigo-500/50 px-1.5 py-0.5 rounded text-white flex items-center gap-1"><DoorOpen className="w-3 h-3"/>Portal</span> : <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">Custom</span>}
                  </div>
                  {m.description && <p className="text-white/60 text-xs leading-relaxed line-clamp-2">{m.description}</p>}
                </button>
              ))}
            </div>
          </div>
        ) : sceneInfo && (
          <div className="text-white flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
               <Sparkles className="w-5 h-5 text-blue-400" />
               <h3 className="text-xs font-bold uppercase tracking-widest text-blue-400">AI Tour Guide</h3>
            </div>
            <h2 className="text-2xl font-semibold leading-tight mb-3">{sceneInfo.title}</h2>
            <p className="text-white/70 text-sm leading-relaxed mb-6">{sceneInfo.description}</p>
            
            <button 
              onClick={toggleTour}
              className={`w-full py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-all mb-4 flex-shrink-0 ${
                isAutoTouring 
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)]'
                : 'bg-white/10 hover:bg-white/20 text-white border border-white/20'
              }`}
            >
              {isAutoTouring ? (
                <>
                  <Square className="w-4 h-4 fill-current" /> Stop Audio Tour
                  {isPlayingVoice && <Activity className="w-4 h-4 animate-pulse" />}
                </>
              ) : (
                <>
                  <Headphones className="w-5 h-5" /> Start Auto Tour
                </>
              )}
            </button>

            <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              <h3 className="text-xs font-semibold text-white/50 mb-3 uppercase tracking-wider flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Points of Interest
              </h3>
              {markers.map(m => (
                <button 
                  key={m.id}
                  onClick={() => handleMarkerClick(m)}
                  className={`w-full text-left p-4 rounded-xl border transition-all duration-300 group ${m.id === activeMarkerId ? 'bg-blue-600/20 border-blue-500/50 shadow-lg' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'}`}
                >
                  <div className="font-semibold text-sm mb-1 flex justify-between items-center text-white/90 group-hover:text-white">
                     {m.label}
                     {m.targetSceneId ? (
                        <span className="text-[10px] bg-indigo-500/50 px-1.5 py-0.5 rounded text-white flex items-center gap-1"><DoorOpen className="w-3 h-3"/> Portal</span>
                     ) : m.isCustom ? (
                        <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded">Custom</span>
                     ) : (
                        <Sparkles className="w-3 h-3 text-blue-300 opacity-50" />
                     )}
                  </div>
                  {m.description && <p className="text-white/60 text-xs leading-relaxed line-clamp-2">{m.description}</p>}
                </button>
              ))}
              {markers.length === 0 && (
                 <p className="text-xs text-white/40 italic">No points of interest identified.</p>
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t border-white/10 flex-shrink-0">
               <p className="text-xs text-white/40 text-center mb-1">Double-click on the image to add custom markers.</p>
               <p className="text-xs text-white/40 text-center">Shift + Double-click to add a Portal.</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
