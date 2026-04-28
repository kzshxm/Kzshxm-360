import React, { useState, useRef, useEffect } from 'react';
import Viewer360 from './components/Viewer360';
import { Upload, Image as ImageIcon, X, FolderPlus, LogIn, LogOut, Cloud, Save, Share2 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import { MarkerData } from './components/Viewer360';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
export const storage = getStorage(app);

export interface SceneItem {
  id: string;
  url: string;
  file?: File;
  name: string;
  type: 'image' | 'video';
}

export default function App() {
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<User | null>(null);
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [tourId, setTourId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    return () => unsub();
  }, []);

  useEffect(() => {
    const loadTour = async () => {
      const qs = new URLSearchParams(window.location.search);
      // Local state fallback
      if (qs.has('state')) {
        try {
          const decoded = JSON.parse(atob(qs.get('state') as string));
          if (decoded.scenes && Array.isArray(decoded.scenes) && decoded.scenes.length > 0) {
            setScenes(decoded.scenes);
            if (decoded.currentSceneId) {
               setCurrentSceneId(decoded.currentSceneId);
            } else {
               setCurrentSceneId(decoded.scenes[0].id);
            }
          }
        } catch(e) {}
      } else if (qs.has('tour')) {
        // Cloud Tour
        const tId = qs.get('tour');
        if (tId) {
          try {
            const snap = await getDoc(doc(db, 'tours', tId));
            if (snap.exists()) {
              const data = snap.data();
              if (data.scenes && Array.isArray(data.scenes)) {
                setScenes(data.scenes);
                setCurrentSceneId(data.scenes[0].id);
                setTourId(tId);
                // markers are passed via state... wait, markers should be passed to viewer too.
                // we'll need to encode markers in state for now, or pass them somehow.
                const stateUrl = new URL(window.location.href);
                stateUrl.searchParams.set('state', btoa(JSON.stringify({
                  markersByScene: data.markers || {}
                })));
                window.history.replaceState({}, '', stateUrl.toString());
              }
            } else {
              alert("Tour not found.");
            }
          } catch (error) {
            console.error("Failed to load tour:", error);
            alert("Failed to load tour.");
          }
        }
      }
    };
    loadTour();
  }, []);

  const handleCloudShare = async (markersByScene: Record<string, MarkerData[]>) => {
    if (!user) {
      alert("Please sign in first to save your tour.");
      signInWithPopup(auth, new GoogleAuthProvider()).catch(console.error);
      return;
    }

    let title = prompt("Enter a title for this tour:");
    if (!title) return;

    setIsSavingToCloud(true);
    try {
      // Upload local files
      const newScenes = await Promise.all(scenes.map(async (scene) => {
        if (scene.file) {
          const fileRef = ref(storage, `tours/${user.uid}/${Date.now()}_${scene.file.name}`);
          const snapshot = await uploadBytesResumable(fileRef, scene.file);
          const downloadUrl = await getDownloadURL(snapshot.ref);
          return {
            id: scene.id,
            url: downloadUrl,
            name: scene.name,
            type: scene.type
          };
        }
        // If it's already a cloud URL, just pass it
        return {
           id: scene.id,
           url: scene.url,
           name: scene.name,
           type: scene.type
        };
      }));

      const newTourId = tourId || (Date.now().toString() + Math.random().toString(36).slice(2));
      const payload: any = {
        userId: user.uid,
        title,
        scenes: newScenes,
        markers: markersByScene,
        updatedAt: serverTimestamp(),
      };
      if (!tourId) {
         payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, 'tours', newTourId), payload, { merge: true });
      
      setTourId(newTourId);
      // update scenes without file objects
      setScenes(newScenes);

      const url = new URL(window.location.href);
      url.searchParams.set('tour', newTourId);
      // Remove local state
      url.searchParams.delete('state');
      window.history.replaceState({}, '', url.toString());
      navigator.clipboard.writeText(url.toString());
      alert("Tour saved successfully! Link copied to clipboard.");

    } catch (error: any) {
      console.error(error);
      if (error && error.code === 'storage/unauthorized') {
         alert("Storage unauthorized. To fix this, please visit the Firebase Console -> Storage -> Rules, and set them to: \n\nallow read, write: if request.auth != null;");
      } else {
         alert("Error saving tour. Check console for details.");
      }
    } finally {
      setIsSavingToCloud(false);
    }
  };

  const handleFilesProcess = (files?: FileList | null | File[]) => {
    if (!files) return;
    const newScenes: SceneItem[] = [];
    const filesArray = Array.from(files);
    
    for (const file of filesArray) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        newScenes.push({
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          url: URL.createObjectURL(file),
          file,
          name: file.name,
          type: file.type.startsWith('image/') ? 'image' : 'video'
        });
      }
    }

    if (newScenes.length > 0) {
      setScenes(prev => {
        const updated = [...prev, ...newScenes];
        if (!currentSceneId) {
          setCurrentSceneId(updated[0].id);
        }
        return updated;
      });
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    handleFilesProcess(event.target.files);
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFilesProcess(e.dataTransfer.files);
  };

  const loadDemo = () => {
    const id = 'demo-scene-1';
    setScenes([{
      id,
      url: 'https://cdn.eso.org/images/large/eso0932a.jpg',
      name: 'Milky Way Demo',
      type: 'image'
    }]);
    setCurrentSceneId(id);
  };

  const handleClose = () => {
    setScenes([]);
    setCurrentSceneId(null);
  };

  return (
    <div className="w-full h-screen bg-gray-950 flex flex-col font-sans text-gray-100 overflow-hidden">
      {scenes.length === 0 || !currentSceneId ? (
        <div 
          className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-br from-gray-900 to-black relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-4 border-4 border-blue-500 border-dashed rounded-3xl z-20 bg-blue-500/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <p className="text-3xl font-bold text-blue-400">Drop files here</p>
            </div>
          )}
          <div className="max-w-md w-full bg-gray-900/40 backdrop-blur-xl border border-gray-800 rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center z-10 relative">
            <div className="w-20 h-20 bg-blue-500/10 text-blue-400 rounded-full flex items-center justify-center mb-6 ring-1 ring-blue-500/20">
              <ImageIcon className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-semibold mb-2 text-white">360° Studio</h1>
            <p className="text-gray-400 mb-8 max-w-sm">
              Upload equirectangular images or videos to explore them. Upload multiple to link them together into a virtual tour.
            </p>
            
            <input 
              type="file" 
              multiple
              accept="image/*, video/*" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
            />
            
            <div className="flex flex-col w-full gap-3">
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3.5 px-6 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
              >
                <Upload className="w-5 h-5" />
                Upload Media
              </button>
              
              <button 
                onClick={loadDemo}
                className="w-full py-3.5 px-6 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl font-medium transition-colors border border-gray-700 flex items-center justify-center gap-2"
              >
                Load Milky Way Demo
              </button>
            </div>
          </div>
        </div>
      ) : (
        <Viewer360 
          scenes={scenes} 
          currentSceneId={currentSceneId} 
          onNavigate={setCurrentSceneId}
          onAddScene={(files) => handleFilesProcess(files)}
          onClose={handleClose} 
          onCloudShare={handleCloudShare}
          isSavingToCloud={isSavingToCloud}
        />
      )}
    </div>
  );
}
